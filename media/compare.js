/**
 * 对比浏览前端。ESM，宿主用 `<script type="module" src=...>` 直接引。
 *
 * 左右两侧是**相互独立**的树浏览实例：各自的根目录、已展开层级、下拉候选与
 * 状态栏互不影响。读盘与路径解析全部在扩展宿主，这里只负责渲染与消息往返。
 */

import { createContextMenu } from './shared/contextmenu.js';
import { MAX_DROP_STRING_CHARS, readDroppedFiles, snapshotDrop } from './shared/filedrop.js';

const READING = '正在打开…';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;
const SPLIT_KEY = 'wispkit.compare.split';

/** 与子树浏览一致的分组顺序（前端不 import src，只能抄一份）。 */
const GROUP_ORDER = ['clipboard', 'edit', 'path', 'navigate', 'compare', 'extension', 'other'];
const GROUP_LABELS = {
	clipboard: '剪贴板',
	edit: '编辑',
	path: '路径',
	navigate: '导航',
	compare: '比较',
	extension: '扩展提供',
	other: '其他',
};
const DEFAULT_DISABLED_REASON = {
	any: '请先在对比浏览里选中条目',
	single: '需要恰好选中一个条目',
	two: '需要恰好选中两个条目',
	folders: '需要选中一个文件夹',
};

function readConfig() {
	const meta = document.getElementById('wispkit-compare-config');
	if (!meta) {
		return null;
	}
	try {
		return JSON.parse(meta.dataset.wispkit || 'null');
	} catch {
		return null;
	}
}

let hostApi = null;
try {
	hostApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
} catch {
	hostApi = null;
}

let config = readConfig() ?? { panes: [], columns: [], locationGroups: [], commands: [], tools: [] };
let locationGroups = Array.isArray(config.locationGroups) ? config.locationGroups : [];
const contextMenu = createContextMenu();
let requestSeed = 0;
let lastMessage = null;
let splitPercent = DEFAULT_SPLIT;
let draggingSplitter = false;

/** 本扩展拖拽源写进 DataTransfer 的私有类型（对比浏览自己的标识）。 */
const COMPARE_DRAG_MIME = 'application/x-wispkit-compare';
/** 子树浏览的私有类型：从对比浏览拖到子树面板时也能被认成「内部拖拽」。 */
const SUBTREE_DRAG_MIME = 'application/x-wispkit-subtree';
/** 拖拽会话最长存活时间：正常拖拽几秒内必有 drop / dragend，超时视为残留。 */
const DRAG_SESSION_MAX_AGE_MS = 30_000;
/**
 * 本页发起、尚未结束的拖拽。记住 dragstart 那一刻的 Ctrl/Cmd/Shift 状态 ——
 * 用户「先按下 Ctrl 再拖」之后可能在松手前就放开了，drop 时只看事件键态会漏判。
 */
let dragSession = null;

/** @type {Map<string, any>} */
const panes = new Map();

function post(message) {
	lastMessage = message;
	hostApi?.postMessage(message);
}

function byId(id) {
	return document.getElementById(id);
}

function makeIcon(name, className) {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', className ?? 'wispkit-subtree-icon-svg');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const use = document.createElementNS(SVG_NS, 'use');
	use.setAttribute('href', `#wispkit-icon-${name}`);
	svg.appendChild(use);
	return svg;
}

function setStatus(pane, message, kind) {
	pane.statusText = message ?? '';
	pane.statusKind = kind ?? '';
	renderStatus(pane);
}

function renderStatus(pane) {
	const element = pane.elements.status;
	if (!element) {
		return;
	}
	const text = pane.statusText || pane.note || '';
	element.textContent = text;
	element.classList.toggle('is-error', pane.statusKind === 'error');
	element.hidden = !text;
}

function createPane(definition) {
	const id = definition.id;
	return {
		id,
		root: typeof definition.root === 'string' ? definition.root : '',
		title: typeof definition.title === 'string' ? definition.title : id,
		note: typeof definition.note === 'string' ? definition.note : '',
		statusText: '',
		statusKind: '',
		levels: new Map(),
		expanded: new Set(),
		selection: null,
		elements: {
			section: byId(`wispkit-compare-pane-${id}`),
			tree: byId(`wispkit-compare-tree-${id}`),
			pathbar: byId(`wispkit-compare-pathbar-${id}`),
			input: byId(`wispkit-compare-input-${id}`),
			go: byId(`wispkit-compare-go-${id}`),
			up: byId(`wispkit-compare-up-${id}`),
			refresh: byId(`wispkit-compare-refresh-${id}`),
			dropdown: byId(`wispkit-compare-dropdown-${id}`),
			locations: byId(`wispkit-compare-locations-${id}`),
			status: byId(`wispkit-compare-status-${id}`),
			header: byId(`wispkit-compare-header-${id}`),
			rows: byId(`wispkit-compare-rows-${id}`),
		},
	};
}

// ── 拖拽：左侧 → 右侧（默认复制，按住 Ctrl/Shift = 移动） ────────────────

/** 取仍然有效的拖拽会话；超时的残留会话直接丢掉。 */
function activeDragSession() {
	if (dragSession && Date.now() - dragSession.at > DRAG_SESSION_MAX_AGE_MS) {
		dragSession = null;
	}
	return dragSession;
}

/** DataTransfer 的类型列表（环境不支持时为空数组）。 */
function dragTypes(dataTransfer) {
	try {
		return Array.from(dataTransfer?.types ?? []).map(type => String(type).toLowerCase());
	} catch {
		return [];
	}
}

/**
 * 这次拖拽是不是从 Wispkit 面板里拖出来的？
 *
 * 系统/其他应用拖入一定带 `Files`：即使上一次内部拖拽因异常没收到 dragend、
 * `dragSession` 还残留，也绝不能再把系统文件当成内部拖拽 —— 资源管理器里
 * Ctrl 是复制，误判成移动会删源文件。
 *
 * 左右两侧在同一个文档里，靠 `dragSession` 就能认出；跨面板（子树 → 对比浏览）
 * 只能看 dragstart 写入的私有 MIME。
 */
function isInternalDrag(dataTransfer) {
	const types = dragTypes(dataTransfer);
	if (types.includes('files')) {
		return false;
	}
	if (activeDragSession()) {
		return true;
	}
	return types.some(type => type === COMPARE_DRAG_MIME || type === SUBTREE_DRAG_MIME);
}

/**
 * 是否处于「移动」语义：对比浏览**默认复制**，按住 Ctrl/Cmd 才是移动。
 * Shift 作为备用键（某些键盘布局 / 远程环境里 Ctrl 拖拽会被系统吞掉）。
 */
function isMoveDrag(event) {
	return isInternalDrag(event?.dataTransfer)
		&& (Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey)
			|| Boolean(activeDragSession()?.moveModifier));
}

/** 绝对路径 → `file://` URL。逐段编码，避免空格 / `#` / `?` 把 URL 拆坏。 */
function toFileUrl(fsPath) {
	const value = String(fsPath ?? '').replace(/\\/g, '/');
	if (/^[A-Za-z]:\//.test(value)) {
		const drive = value.slice(0, 2);
		const segments = value.slice(3).split('/').filter(Boolean).map(encodeURIComponent);
		return `file:///${drive}/${segments.join('/')}`;
	}
	if (value.startsWith('//')) {
		const parts = value.slice(2).split('/').filter(Boolean);
		const host = parts.shift() ?? '';
		return `file://${host}/${parts.map(encodeURIComponent).join('/')}`;
	}
	if (value.startsWith('/')) {
		const segments = value.split('/').filter(Boolean).map(encodeURIComponent);
		return `file:///${segments.join('/')}`;
	}
	return `file:///${encodeURIComponent(value)}`;
}

/**
 * 拖出时写进 DataTransfer 的全部载荷。
 *
 * - `text/uri-list` / `ResourceURLs` / `CodeFiles`：拖回 VS Code 或另一个
 *   Wispkit 面板时能被识别成资源；
 * - `DownloadURL`：拖到桌面 / 资源管理器时由 Chromium 落成**真实文件**（只支持单个文件）；
 * - `text/plain`：给普通文本目标一个可读路径。
 */
function dragPayloadForRow(row) {
	const uri = toFileUrl(row.path);
	return {
		paths: [row.path],
		text: row.path,
		uriList: uri,
		resourceUrls: JSON.stringify([uri]),
		codeFiles: JSON.stringify([row.path]),
		downloadUrl: row.isDirectory
			? undefined
			: `application/octet-stream:${row.name}:${uri}`,
	};
}

/** 解析 `text/uri-list`（跨面板拖动时前端拿不到源页面的 dragSession）。 */
function parseUriList(text) {
	return String(text ?? '')
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#'));
}

/** 在某一侧的已读层级里找行对象。 */
function findRow(pane, path) {
	for (const level of pane.levels.values()) {
		const found = level.rows.find(row => row.path === path);
		if (found) {
			return found;
		}
	}
	return null;
}

/** 事件命中的行（空白区域返回 null）。 */
function rowForEvent(pane, event) {
	const element = event.target?.closest?.('.wispkit-subtree-row');
	return element ? findRow(pane, element.dataset.path) : null;
}

/** 行的放置目标：文件夹落到自己，文件落到父目录，空白区域落到该侧根目录。 */
function targetDirForRow(pane, row) {
	if (!row) {
		return pane.root;
	}
	if (row.isDirectory) {
		return row.path;
	}
	return row.parentPath || pane.root;
}

function findRowElement(pane, path) {
	return Array.from(pane.elements.rows?.querySelectorAll('.wispkit-subtree-row') ?? [])
		.find(element => element.dataset.path === path) ?? null;
}

function clearDropHighlight() {
	for (const pane of panes.values()) {
		for (const element of pane.elements.rows?.querySelectorAll('.is-drop-target') ?? []) {
			element.classList.remove('is-drop-target');
		}
		pane.elements.tree?.classList.remove('is-drop-root', 'is-move-drop');
	}
}

function highlightDropTarget(pane, row, moveHint) {
	clearDropHighlight();
	const tree = pane.elements.tree;
	if (!tree) {
		return;
	}
	tree.classList.toggle('is-move-drop', moveHint);
	const targetDir = targetDirForRow(pane, row);
	const element = targetDir === pane.root ? null : findRowElement(pane, targetDir);
	if (element) {
		element.classList.add('is-drop-target');
	} else {
		// 目标是该侧根目录（根没有对应的行）：整棵树给一圈提亮
		tree.classList.add('is-drop-root');
	}
}

// ── 指针拖拽（不依赖 HTML5 原生拖拽）──────────────────────────────────────
//
// VS Code 1.137 / Electron 的 webview 里，鼠标在可拖拽条目上按下并移动后，
// Chromium 会进入原生 OLE 拖拽循环。实测这条路径会让 VS Code 主进程持续
// 卡死（Responding=false、单核 100%、drop 永远不触发），而且和 DownloadURL
// 无关。这里改成 pointerdown/pointermove/pointerup 自己跟踪拖拽：
// 不使用 draggable，也不进入原生拖拽循环。

const POINTER_DRAG_THRESHOLD = 5;

/** 当前指针拖拽会话（一次只有一个）。 */
let pointerDrag = null;

function pointerMoveHint(event, drag) {
	return Boolean(
		event?.ctrlKey
		|| event?.metaKey
		|| event?.shiftKey
		|| drag?.moveModifierAtStart,
	);
}

function pointerInsideViewport(event) {
	return event.clientX >= 0
		&& event.clientY >= 0
		&& event.clientX < window.innerWidth
		&& event.clientY < window.innerHeight;
}

function createDragGhost(row) {
	const ghost = document.createElement('div');
	ghost.className = 'wispkit-compare-drag-ghost';
	ghost.setAttribute('aria-hidden', 'true');
	ghost.textContent = row.name;
	document.body.appendChild(ghost);
	return ghost;
}

/** 拖到 webview 外时把气泡贴到窗口边缘，仍能看见「松开 = 复制/移动」提示。 */
function positionDragGhost(ghost, event) {
	if (!ghost) {
		return;
	}
	// 按气泡自身尺寸夹取：拖出视口时把整条提示留在窗口内，而不是只露一角
	const width = ghost.offsetWidth || 0;
	const height = ghost.offsetHeight || 0;
	const maxX = Math.max(0, (window.innerWidth || 0) - width - 8);
	const maxY = Math.max(0, (window.innerHeight || 0) - height - 8);
	const x = Math.min(Math.max(event.clientX + 14, 0), maxX);
	const y = Math.min(Math.max(event.clientY + 12, 0), maxY);
	ghost.style.transform = `translate(${x}px, ${y}px)`;
}

function updateDragGhost(ghost, row, moveHint, outside = false) {
	if (!ghost) {
		return;
	}
	const label = `${row.name} · ${moveHint ? '移动' : '复制'}`;
	ghost.textContent = outside
		? `${row.name} · 松开 = ${moveHint ? '移动到' : '复制到'}资源管理器`
		: label;
	ghost.classList.toggle('is-move', moveHint);
	ghost.classList.toggle('is-copy', !moveHint);
	ghost.classList.toggle('is-outside', outside);
}

/** 指针下的放置目标（行 / 该侧根目录 / 无）。 */
function updatePointerDropTarget(drag, event) {
	const outside = !pointerInsideViewport(event);
	const hit = outside ? null : document.elementFromPoint(event.clientX, event.clientY);
	const paneElement = hit?.closest?.('.wispkit-compare-pane') ?? null;
	const targetPane = paneElement ? panes.get(paneElement.dataset.pane) : null;
	const moveHint = pointerMoveHint(event, drag);
	// 系统光标 + 跟随气泡是「正在拖拽」最直接的反馈：copy / move
	document.body.classList.toggle('is-copy-drag', !moveHint);
	document.body.classList.toggle('is-move-drag', moveHint);
	if (!targetPane) {
		clearDropHighlight();
		drag.targetPane = null;
		drag.targetRow = null;
		updateDragGhost(drag.ghost, drag.row, moveHint, outside);
		return;
	}
	const rowElement = hit.closest?.('.wispkit-subtree-row') ?? null;
	const targetRow = rowElement ? findRow(targetPane, rowElement.dataset.path) : null;
	highlightDropTarget(targetPane, targetRow, moveHint);
	drag.targetPane = targetPane;
	drag.targetRow = targetRow;
	updateDragGhost(drag.ghost, drag.row, moveHint, false);
}

function removePointerDragListeners() {
	window.removeEventListener('pointermove', onPointerDragMove, true);
	window.removeEventListener('pointerup', onPointerDragUp, true);
	window.removeEventListener('pointercancel', onPointerCancelDrag, true);
	window.removeEventListener('keydown', onPointerDragKeydown, true);
	window.removeEventListener('blur', onPointerDragBlur, true);
}

function finishPointerDrag(resetHighlight = true) {
	const drag = pointerDrag;
	if (!drag) {
		return;
	}
	pointerDrag = null;
	removePointerDragListeners();
	document.body.classList.remove('is-wispkit-pointer-drag', 'is-copy-drag', 'is-move-drag');
	drag.element.classList.remove('is-dragging');
	drag.ghost?.remove();
	if (resetHighlight) {
		clearDropHighlight();
	}
	try {
		drag.element.releasePointerCapture?.(drag.pointerId);
	} catch {
		// 元素已经被重绘时释放捕获会抛错，忽略
	}
	const pending = drag.pendingRenderPanes;
	if (pending && pending.size > 0) {
		for (const pane of pending) {
			if (panes.get(pane.id) === pane) {
				renderRows(pane);
			}
		}
	}
}

function cancelPointerDrag() {
	finishPointerDrag();
}

function onPointerDragMove(event) {
	const drag = pointerDrag;
	if (!drag) {
		return;
	}
	if (!drag.active) {
		const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
		if (distance < POINTER_DRAG_THRESHOLD) {
			return;
		}
		drag.active = true;
		selectOnlyForDrag(drag.pane, drag.row.path);
		drag.element.classList.add('is-dragging');
		document.body.classList.add('is-wispkit-pointer-drag');
		drag.ghost = createDragGhost(drag.row);
	}
	drag.lastX = event.clientX;
	drag.lastY = event.clientY;
	updatePointerDropTarget(drag, event);
	positionDragGhost(drag.ghost, event);
	event.preventDefault();
}

function onPointerDragUp(event) {
	const drag = pointerDrag;
	if (!drag) {
		return;
	}
	if (!drag.active) {
		// 没有越过阈值：保留普通点击 / 双击行为
		finishPointerDrag(false);
		return;
	}
	updatePointerDropTarget(drag, event);
	const targetPane = drag.targetPane;
	const targetRow = drag.targetRow;
	const moveRequested = pointerMoveHint(event, drag);
	const ctrlKey = Boolean(event.ctrlKey || event.metaKey);
	const shiftKey = Boolean(event.shiftKey);
	const sourcePath = drag.row.path;
	const sourcePane = drag.pane;
	finishPointerDrag();
	// 拖拽结束后的 click 不应该把刚拖过的行当成一次点选
	suppressNextClick();
	// 拖到 webview 之外松手 = 拖出到系统（资源管理器 / 桌面）
	if (!pointerInsideViewport(event)) {
		setStatus(sourcePane, moveRequested ? '正在移动到资源管理器…' : '正在复制到资源管理器…', '');
		post({
			type: 'wispkit.compare.dragOut',
			pane: sourcePane.id,
			paths: [sourcePath],
			ctrlKey,
			shiftKey,
			moveRequested,
		});
		return;
	}
	if (!targetPane) {
		return;
	}
	const targetDir = targetDirForRow(targetPane, targetRow);
	if (!targetDir) {
		setStatus(targetPane, '没有可放置的目标文件夹。', 'error');
		return;
	}
	setStatus(targetPane, moveRequested ? '正在移动…' : '正在复制…', '');
	post({
		type: 'wispkit.compare.drop',
		pane: targetPane.id,
		targetDir,
		paths: [sourcePath],
		uris: [],
		internalDrag: true,
		moveRequested,
		ctrlKey,
		shiftKey,
		sourcePane: sourcePane.id,
	});
}

function suppressNextClick() {
	const handler = event => {
		window.removeEventListener('click', handler, true);
		event.preventDefault();
		event.stopPropagation();
	};
	window.addEventListener('click', handler, true);
	setTimeout(() => window.removeEventListener('click', handler, true), 0);
}

function onPointerCancelDrag() {
	finishPointerDrag();
}

function onPointerDragKeydown(event) {
	if (event.key === 'Escape') {
		event.preventDefault();
		finishPointerDrag();
	}
}

function onPointerDragBlur() {
	finishPointerDrag();
}

function beginPointerDrag(pane, row, element, event) {
	if (pointerDrag || event.button !== 0) {
		return;
	}
	// 展开箭头等按钮上的按下不启动拖拽
	if (event.target?.closest?.('button')) {
		return;
	}
	pointerDrag = {
		pane,
		row,
		element,
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		lastX: event.clientX,
		lastY: event.clientY,
		active: false,
		moveModifierAtStart: Boolean(event.ctrlKey || event.metaKey || event.shiftKey),
		targetPane: null,
		targetRow: null,
		ghost: null,
		pendingRenderPanes: new Set(),
	};
	try {
		element.setPointerCapture?.(event.pointerId);
	} catch {
		// 某些环境不支持指针捕获，仍可在窗口内拖动
	}
	window.addEventListener('pointermove', onPointerDragMove, true);
	window.addEventListener('pointerup', onPointerDragUp, true);
	window.addEventListener('pointercancel', onPointerCancelDrag, true);
	window.addEventListener('keydown', onPointerDragKeydown, true);
	window.addEventListener('blur', onPointerDragBlur, true);
}

/** 拖动一个未选中的行时把它变成唯一选中项；不重绘，避免拖拽图像丢失。 */
function selectOnlyForDrag(pane, path) {
	pane.selection = path;
	for (const element of pane.elements.rows?.querySelectorAll('.wispkit-subtree-row') ?? []) {
		const selected = element.dataset.path === path;
		element.classList.toggle('is-selected', selected);
		element.setAttribute('aria-selected', selected ? 'true' : 'false');
	}
}

/** drop 的完整处理：识别 → 取源路径 → 交给宿主落盘。 */
function handlePaneDrop(pane, event) {
	event.preventDefault();
	event.stopPropagation();
	const internal = isInternalDrag(event.dataTransfer);
	// 外部来源只接 `text/uri-list`（从 VS Code 资源管理器拖入）；系统文件的
	// `Files` 拖拽由 document 捕获阶段的处理器读取内容，不走这里。
	if (!internal && !dragTypes(event.dataTransfer).includes('text/uri-list')) {
		return;
	}
	const row = rowForEvent(pane, event);
	const targetDir = targetDirForRow(pane, row);
	// 键态与拖拽会话都要在同步阶段取值：进入异步后事件对象可能已被复用
	const moveRequested = isMoveDrag(event);
	const ctrlKey = Boolean(event.ctrlKey || event.metaKey);
	const shiftKey = Boolean(event.shiftKey);
	const session = activeDragSession();
	const paths = session?.paths ? Array.from(session.paths) : [];
	let uris = [];
	if (paths.length === 0 && event.dataTransfer) {
		try {
			uris = parseUriList(event.dataTransfer.getData('text/uri-list'));
		} catch {
			uris = [];
		}
	}
	dragSession = null;
	clearDropHighlight();
	if (!targetDir) {
		setStatus(pane, '没有可放置的目标文件夹。', 'error');
		return;
	}
	if (paths.length === 0 && uris.length === 0) {
		setStatus(pane, '没有可拖动的条目。', 'error');
		return;
	}
	setStatus(pane, moveRequested ? '正在移动…' : '正在复制…');
	post({
		type: 'wispkit.compare.drop',
		pane: pane.id,
		targetDir,
		paths,
		uris,
		internalDrag: internal,
		moveRequested,
		ctrlKey,
		shiftKey,
	});
}

/** 系统文件拖入：读取 File 内容后交给宿主落盘。 */
async function handleExternalFileDrop(event) {
	event.preventDefault();
	event.stopPropagation();
	const paneElement = event.target?.closest?.('.wispkit-compare-pane') ?? null;
	const pane = paneElement ? panes.get(paneElement.dataset.pane) : null;
	if (!pane) {
		return;
	}
	const row = rowForEvent(pane, event);
	const targetDir = targetDirForRow(pane, row);
	const snapshot = snapshotDrop(event.dataTransfer);
	const strings = (await Promise.all(snapshot.stringPromises))
		.filter(Boolean)
		.filter(item => item.text.length <= MAX_DROP_STRING_CHARS);
	const files = await readDroppedFiles(snapshot.fileObjects);

	if (snapshot.directories.length > 0) {
		setStatus(pane, `暂不支持拖入文件夹：${snapshot.directories.join('、')}`, 'error');
		if (files.length === 0 && strings.length === 0) {
			return;
		}
	}
	if (files.length === 0 && strings.length === 0) {
		setStatus(pane, '没有可导入的内容。', 'error');
		return;
	}
	if (!targetDir) {
		setStatus(pane, '没有可放置的目标文件夹。', 'error');
		return;
	}

	setStatus(pane, '正在接收拖入的内容…');
	post({
		type: 'wispkit.compare.drop',
		pane: pane.id,
		targetDir,
		paths: [],
		uris: [],
		files,
		strings,
		internalDrag: false,
		moveRequested: false,
		ctrlKey: Boolean(event.ctrlKey || event.metaKey),
		shiftKey: Boolean(event.shiftKey),
	});
}

/**
 * 路径比较键：统一分隔符；Windows 路径（盘符 / UNC）大小写不敏感。
 *
 * 必要：宿主里 `Uri.fsPath` 会把盘符规范成小写（`D:\x` → `d:\x`），而面板根目录
 * 来自用户输入 / 默认位置，可能是大写。直接字符串比较会漏刷新源面板。
 */
function pathKey(value) {
	const text = String(value ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '');
	return /^[A-Za-z]:\//.test(text) || text.startsWith('//') ? text.toLowerCase() : text;
}

/** 在已读层级里找到与 `value` 等价的缓存键；根目录统一用 `pane.root`。 */
function matchingLevelPath(pane, value) {
	if (pane.levels.has(value)) {
		return value;
	}
	const key = pathKey(value);
	for (const existing of pane.levels.keys()) {
		if (pathKey(existing) === key) {
			return existing;
		}
	}
	return key === pathKey(pane.root) ? pane.root : null;
}

/** 宿主落盘结束后：更新状态、清掉被移走条目的缓存、重读受影响的层级。 */
function applyDropResult(message) {
	const pane = panes.get(String(message.pane ?? ''));
	if (!pane) {
		return;
	}
	setStatus(pane, String(message.message ?? ''), message.error ? 'error' : '');
	const moved = Array.isArray(message.moved) ? message.moved.map(String) : [];
	for (const eachPane of panes.values()) {
		for (const movedPath of moved) {
			for (const key of Array.from(eachPane.levels.keys())) {
				if (isSameOrUnder(key, movedPath)) {
					eachPane.levels.delete(key);
					eachPane.expanded.delete(key);
				}
			}
			if (eachPane.selection && isSameOrUnder(eachPane.selection, movedPath)) {
				eachPane.selection = null;
			}
		}
		const refresh = Array.isArray(message.refresh?.[eachPane.id]) ? message.refresh[eachPane.id] : [];
		const seen = new Set();
		for (const dir of refresh) {
			const value = String(dir ?? '');
			if (!value || seen.has(value)) {
				continue;
			}
			seen.add(value);
			// 只刷新前端真正读过的层，避免给未展开的目录塞一份将来会过期的缓存
			const levelPath = matchingLevelPath(eachPane, value);
			if (levelPath) {
				requestLevel(eachPane, levelPath);
			}
		}
		if (moved.length > 0) {
			renderRows(eachPane);
		}
	}
}

/** 右键菜单操作完成后：清掉已删除条目的缓存，并重读指定目录（只读已缓存的层）。 */
function applyRefreshDirs(message) {
	const dirs = Array.isArray(message.dirs) ? message.dirs.map(String) : [];
	const removed = Array.isArray(message.removed) ? message.removed.map(String) : [];
	for (const pane of panes.values()) {
		for (const removedPath of removed) {
			for (const key of Array.from(pane.levels.keys())) {
				if (isSameOrUnder(key, removedPath)) {
					pane.levels.delete(key);
					pane.expanded.delete(key);
				}
			}
			if (pane.selection && isSameOrUnder(pane.selection, removedPath)) {
				pane.selection = null;
			}
		}
		const seen = new Set();
		for (const dir of dirs) {
			const key = pathKey(dir);
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			const levelPath = matchingLevelPath(pane, dir);
			if (levelPath) {
				requestLevel(pane, levelPath);
			}
		}
		renderRows(pane);
	}
}

/** `candidate` 是否等于 `parent` 或在其子树内（统一分隔符与 Windows 大小写）。 */
function isSameOrUnder(candidate, parent) {
	const child = pathKey(candidate);
	const root = pathKey(parent);
	if (!root) {
		return false;
	}
	return child === root || child.startsWith(`${root}/`);
}

// ── 右键菜单：与操作栏共用 config.commands，每项带图标 ─────────────────

function selectionShape(pane) {
	const row = pane.selection ? findRow(pane, pane.selection) : null;
	return {
		count: pane.selection ? 1 : 0,
		directoryCount: row?.isDirectory ? 1 : 0,
		unknown: Boolean(pane.selection && !row),
	};
}

function isApplicableForContext(pane, command) {
	const shape = selectionShape(pane);
	if (shape.unknown) {
		return false;
	}
	if (command.appliesTo === 'folders') {
		// 右键文件时新建 / 粘贴落到它的父目录（宿主按此实现），所以不置灰
		return true;
	}
	switch (command.appliesTo) {
		case 'any':
			return shape.count > 0;
		case 'single':
			return shape.count === 1;
		case 'two':
			return shape.count === 2;
		default:
			return false;
	}
}

function commandTitle(command, enabled) {
	if (command.kind === 'native') {
		if (enabled) {
			return `Wispkit 文件操作（作用于对比浏览选中项）：${command.label}`;
		}
		return `来自扩展 ${command.source}：${command.id}`;
	}
	if (command.kind === 'builtin') {
		return `内置命令：${command.id}`;
	}
	return `来自扩展 ${command.source}：${command.id}`;
}

function runPaneCommand(pane, command) {
	const paths = pane.selection ? [pane.selection] : [];
	if (command.kind === 'native') {
		post({ type: 'wispkit.compare.fileAction', pane: pane.id, action: command.id, paths });
		return;
	}
	post({ type: 'wispkit.compare.command', pane: pane.id, command: command.id, paths });
}

function expandOneLevel(pane, path) {
	const level = pane.levels.get(path);
	if (!level) {
		pane.expanded.add(path);
		renderRows(pane);
		requestLevel(pane, path);
		return;
	}
	const childFolders = level.rows.filter(row => row.isDirectory);
	if (childFolders.length === 0) {
		return;
	}
	const allExpanded = childFolders.every(row => pane.expanded.has(row.path));
	for (const row of childFolders) {
		if (allExpanded) {
			pane.expanded.delete(row.path);
		} else {
			pane.expanded.add(row.path);
			if (!pane.levels.has(row.path)) {
				requestLevel(pane, row.path);
			}
		}
	}
	renderRows(pane);
}

function buildContextMenuItems(pane, row) {
	const items = [];
	if (row) {
		if (row.isDirectory) {
			const isExpanded = pane.expanded.has(row.path);
			items.push({
				label: isExpanded ? '折叠' : '展开',
				icon: isExpanded ? 'collapse-all' : 'expand-all',
				title: row.path,
				run: () => toggleExpand(pane, row.path),
			});
			items.push({
				label: '展开一层',
				icon: 'expand-all',
				title: `展开 ${row.path} 的直接子文件夹`,
				run: () => expandOneLevel(pane, row.path),
			});
		} else {
			items.push({
				label: '打开',
				icon: 'file',
				title: row.path,
				run: () => post({ type: 'wispkit.compare.open', pane: pane.id, path: row.path }),
			});
		}
		items.push({ separator: true });
	} else {
		items.push({
			label: '刷新',
			icon: 'refresh',
			run: () => {
				setStatus(pane, READING);
				post({ type: 'wispkit.compare.refresh', pane: pane.id });
			},
		});
		items.push({
			label: '展开一层',
			icon: 'expand-all',
			title: '展开当前文件夹的直接子文件夹',
			run: () => expandOneLevel(pane, pane.root),
		});
		items.push({
			label: '全部折叠',
			icon: 'collapse-all',
			run: () => {
				pane.expanded.clear();
				renderRows(pane);
			},
		});
		items.push({ separator: true });
	}

	const commands = Array.isArray(config.commands) ? config.commands : [];
	const buckets = new Map();
	for (const command of commands) {
		const bucket = buckets.get(command.group);
		if (bucket) {
			bucket.push(command);
		} else {
			buckets.set(command.group, [command]);
		}
	}
	let firstGroup = true;
	for (const group of GROUP_ORDER) {
		const bucket = buckets.get(group);
		if (!bucket || bucket.length === 0) {
			continue;
		}
		if (!firstGroup) {
			items.push({ separator: true });
		}
		firstGroup = false;
		for (const command of bucket) {
			const enabled = isApplicableForContext(pane, command);
			items.push({
				label: command.label,
				icon: command.icon || 'action',
				title: enabled
					? commandTitle(command, true)
					: `${command.label} 不可用：${command.disabledReason || DEFAULT_DISABLED_REASON[command.appliesTo] || '当前选中状态不适用'}`,
				disabled: !enabled,
				run: () => runPaneCommand(pane, command),
			});
		}
	}

	const tools = Array.isArray(config.tools) ? config.tools : [];
	if (tools.length > 0) {
		items.push({ separator: true });
		tools.forEach((tool, index) => {
			items.push({
				label: tool.label,
				icon: 'terminal',
				badge: tool.shell,
				title: `${tool.command}（执行方式：${tool.shell}）`,
				disabled: !pane.selection,
				run: () => post({
					type: 'wispkit.compare.tool',
					pane: pane.id,
					index,
					paths: pane.selection ? [pane.selection] : [],
				}),
			});
		});
	}

	return items;
}

function openContextMenu(pane, row, x, y) {
	if (row) {
		if (pane.selection !== row.path) {
			pane.selection = row.path;
			renderRows(pane);
		}
	} else if (pane.selection) {
		pane.selection = null;
		renderRows(pane);
	}
	return contextMenu.open(buildContextMenuItems(pane, row), x, y);
}

// ── 表头 / 行 ─────────────────────────────────────────────────────────────

function makeCell(column) {
	const cell = document.createElement('span');
	cell.className = 'wispkit-subtree-cell';
	cell.dataset.column = column.id;
	if (column.align === 'right') {
		cell.dataset.align = 'right';
	}
	return cell;
}

function renderHeader(pane) {
	const header = pane.elements.header;
	if (!header) {
		return;
	}
	header.textContent = '';
	for (const column of config.columns ?? []) {
		const cell = makeCell(column);
		cell.textContent = column.label;
		cell.title = column.label;
		header.appendChild(cell);
	}
}

function rowIconName(row, expanded) {
	if (row.isDirectory) {
		return expanded ? 'folder-open' : 'folder';
	}
	return 'file';
}

function makeRow(pane, row, depth) {
	const element = document.createElement('div');
	element.className = 'wispkit-subtree-row';
	element.setAttribute('role', 'treeitem');
	element.dataset.path = row.path;
	element.dataset.depth = String(depth);
	element.style.setProperty('--wispkit-depth', String(depth));
	if (pane.selection === row.path) {
		element.classList.add('is-selected');
		element.setAttribute('aria-selected', 'true');
	}

	for (const column of config.columns ?? []) {
		const cell = makeCell(column);
		if (column.id === 'name') {
			const isExpanded = pane.expanded.has(row.path);

			const twisty = document.createElement('button');
			twisty.type = 'button';
			twisty.className = `wispkit-subtree-twisty${row.isDirectory ? '' : ' is-leaf'}`;
			twisty.textContent = isExpanded ? '▾' : '▸';
			twisty.setAttribute('aria-label', isExpanded ? '折叠' : '展开');
			twisty.addEventListener('click', event => {
				event.stopPropagation();
				if (row.isDirectory) {
					toggleExpand(pane, row.path);
				}
			});

			const indent = document.createElement('span');
			indent.className = 'wispkit-subtree-indent';

			const icon = makeIcon(rowIconName(row, isExpanded), 'wispkit-subtree-icon-svg wispkit-subtree-item-icon');

			const name = document.createElement('span');
			name.className = 'wispkit-subtree-name';
			name.textContent = row.cells?.name ?? row.name;
			name.title = row.path;

			cell.append(indent, twisty, icon, name);
		} else {
			cell.textContent = row.cells?.[column.id] ?? '-';
			cell.title = cell.textContent;
		}
		element.appendChild(cell);
	}

	element.addEventListener('click', () => {
		pane.selection = row.path;
		renderRows(pane);
	});
	element.addEventListener('dblclick', () => {
		if (row.isDirectory) {
			navigate(pane, row.path);
		} else {
			post({ type: 'wispkit.compare.open', pane: pane.id, path: row.path });
		}
	});

	// 不用 HTML5 原生拖拽：VS Code 的 Electron webview 会在鼠标拖动时进入
	// 原生 OLE 拖拽循环并卡死主进程（见 pointerDrag 段注释）。draggable 保持
	// false，拖拽完全由 pointerdown/pointermove/pointerup 驱动。
	element.draggable = false;
	element.addEventListener('pointerdown', event => {
		beginPointerDrag(pane, row, element, event);
	});
	// 保留 dragstart/dragend 监听：自动化探针（__wispkitCompareSelftest.startDrag）
	// 直接派发合成事件时仍能走原来的数据载荷与会话逻辑。
	element.addEventListener('dragstart', event => {
		if (!event.dataTransfer) {
			return;
		}
		selectOnlyForDrag(pane, row.path);
		const payload = dragPayloadForRow(row);
		// 「先按下 Ctrl 再拖」= 移动：在 dragstart 记下来，松手前放开 Ctrl 也算数
		dragSession = {
			paths: payload.paths,
			moveModifier: Boolean(event.ctrlKey || event.metaKey || event.shiftKey),
			at: Date.now(),
		};
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData('text/plain', payload.text);
		event.dataTransfer.setData('text/uri-list', payload.uriList);
		event.dataTransfer.setData('ResourceURLs', payload.resourceUrls);
		event.dataTransfer.setData('CodeFiles', payload.codeFiles);
		try {
			event.dataTransfer.setData(COMPARE_DRAG_MIME, '1');
			// 子树面板也认这个类型：从对比浏览拖到子树时按内部拖拽处理
			event.dataTransfer.setData(SUBTREE_DRAG_MIME, '1');
		} catch {
			// 环境拒绝自定义类型时，同一文档内仍靠 dragSession 识别
		}
		if (payload.downloadUrl) {
			try {
				event.dataTransfer.setData('DownloadURL', payload.downloadUrl);
			} catch {
				// 某些环境拒绝这个自定义类型，不影响 URI 列表
			}
		}
		element.classList.add('is-dragging');
		// 注意：dragstart 里不要同步写状态栏 —— 状态栏出现会改变行布局，
		// 拖拽源随之位移，Chromium 会直接取消整次拖拽。
	});
	element.addEventListener('dragend', () => {
		element.classList.remove('is-dragging');
		dragSession = null;
		clearDropHighlight();
	});

	return element;
}

function renderInto(pane, container, path, depth) {
	const level = pane.levels.get(path);
	if (!level) {
		return;
	}
	if (level.error) {
		const error = document.createElement('div');
		error.className = 'wispkit-subtree-error';
		error.textContent = level.error;
		container.appendChild(error);
		return;
	}
	if (level.rows.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'wispkit-subtree-empty';
		empty.textContent = '（空文件夹）';
		container.appendChild(empty);
		return;
	}
	for (const row of level.rows) {
		container.appendChild(makeRow(pane, row, depth));
		if (row.isDirectory && pane.expanded.has(row.path)) {
			renderInto(pane, container, row.path, depth + 1);
		}
	}
}

function renderRows(pane) {
	const rows = pane.elements.rows;
	if (!rows) {
		return;
	}
	if (pointerDrag?.active) {
		// 拖拽期间重绘会把拖拽源元素从 DOM 里摘掉；推迟到拖拽结束再画
		pointerDrag.pendingRenderPanes.add(pane);
		return;
	}
	rows.textContent = '';
	renderInto(pane, rows, pane.root, 0);
}

function renderPane(pane) {
	renderRows(pane);
	renderStatus(pane);
}

// ── 消息 / 动作 ───────────────────────────────────────────────────────────

function requestLevel(pane, path) {
	requestSeed += 1;
	post({
		type: 'wispkit.compare.read',
		pane: pane.id,
		requestId: String(requestSeed),
		path,
	});
}

function toggleExpand(pane, path) {
	if (pane.expanded.has(path)) {
		pane.expanded.delete(path);
		renderRows(pane);
		return;
	}
	pane.expanded.add(path);
	renderRows(pane);
	if (!pane.levels.has(path)) {
		setStatus(pane, READING);
		requestLevel(pane, path);
	}
}

function navigate(pane, value) {
	const input = typeof value === 'string' ? value : (pane.elements.input?.value ?? '');
	if (!input.trim()) {
		setStatus(pane, '请输入文件夹路径。', 'error');
		return;
	}
	setStatus(pane, READING);
	post({ type: 'wispkit.compare.navigate', pane: pane.id, input });
}

function applyLevel(message) {
	const pane = panes.get(String(message.pane ?? ''));
	if (!pane) {
		return;
	}
	const path = String(message.path ?? '');
	if (!path) {
		return;
	}
	pane.levels.set(path, {
		rows: Array.isArray(message.rows) ? message.rows : [],
		error: typeof message.error === 'string' && message.error ? message.error : undefined,
	});
	if (pane.statusText === READING) {
		setStatus(pane, '');
	} else {
		renderStatus(pane);
	}
	renderRows(pane);
}

function applyRoot(message) {
	const pane = panes.get(String(message.pane ?? ''));
	if (!pane) {
		return;
	}
	pane.root = String(message.root ?? '');
	if (typeof message.title === 'string' && message.title) {
		pane.title = message.title;
	}
	pane.note = '';
	pane.levels.clear();
	pane.expanded.clear();
	pane.selection = null;
	if (pane.elements.input) {
		pane.elements.input.value = pane.root;
	}
	setStatus(pane, '');
	renderRows(pane);
}

function applyStatus(message) {
	const pane = panes.get(String(message.pane ?? ''));
	if (!pane) {
		return;
	}
	setStatus(pane, String(message.message ?? ''), message.kind);
}

function applyLocations(groups) {
	locationGroups = Array.isArray(groups) ? groups : [];
	for (const pane of panes.values()) {
		if (pane.elements.locations && !pane.elements.locations.hidden) {
			renderLocations(pane);
		}
	}
}

// ── 路径下拉 ─────────────────────────────────────────────────────────────

function hideLocations(pane) {
	if (!pane.elements.locations) {
		return;
	}
	pane.elements.locations.hidden = true;
	pane.elements.dropdown?.setAttribute('aria-expanded', 'false');
}

function hideAllLocations() {
	for (const pane of panes.values()) {
		hideLocations(pane);
	}
}

function renderLocations(pane) {
	const container = pane.elements.locations;
	if (!container) {
		return;
	}
	container.textContent = '';
	let count = 0;
	for (const group of locationGroups) {
		const locations = Array.isArray(group?.locations) ? group.locations : [];
		if (locations.length === 0) {
			continue;
		}
		const title = document.createElement('div');
		title.className = 'wispkit-compare-location-group-title';
		title.textContent = String(group.title ?? '');
		container.appendChild(title);

		for (const location of locations) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'wispkit-compare-location';
			button.dataset.path = String(location.path ?? '');
			button.dataset.group = String(group.title ?? '');
			button.disabled = !location.path;
			button.title = String(location.description ?? location.path ?? '');

			const label = document.createElement('span');
			label.className = 'wispkit-compare-location-label';
			label.textContent = String(location.label ?? '');
			const description = document.createElement('span');
			description.className = 'wispkit-compare-location-path';
			description.textContent = String(location.description ?? '');
			button.append(label, description);

			button.addEventListener('click', () => {
				if (!location.path) {
					return;
				}
				hideLocations(pane);
				if (pane.elements.input) {
					pane.elements.input.value = String(location.path);
				}
				navigate(pane, String(location.path));
			});
			container.appendChild(button);
			count += 1;
		}
	}
	if (count === 0) {
		const empty = document.createElement('div');
		empty.className = 'wispkit-compare-location-empty';
		empty.textContent = '没有可用的位置：资源树里还没有文件夹，工作区也未打开。';
		container.appendChild(empty);
	}
}

function toggleLocations(pane) {
	const container = pane.elements.locations;
	if (!container) {
		return;
	}
	const willOpen = container.hidden;
	hideAllLocations();
	if (!willOpen) {
		return;
	}
	container.hidden = false;
	pane.elements.dropdown?.setAttribute('aria-expanded', 'true');
	renderLocations(pane);
	// 资源树是外部的 JSON，可能在面板打开期间被改过；每次打开都重新取一次。
	post({ type: 'wispkit.compare.locations' });
}

// ── 分隔条 ───────────────────────────────────────────────────────────────

const mainElement = byId('wispkit-compare-main');
const splitter = byId('wispkit-compare-splitter');

function clampSplit(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		return DEFAULT_SPLIT;
	}
	return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, number));
}

function applySplit(value) {
	splitPercent = clampSplit(value);
	mainElement?.style.setProperty('--wispkit-compare-left', `${splitPercent}%`);
	return splitPercent;
}

function storedSplit() {
	try {
		const value = Number(window.localStorage?.getItem(SPLIT_KEY));
		return Number.isFinite(value) && value > 0 ? clampSplit(value) : DEFAULT_SPLIT;
	} catch {
		return DEFAULT_SPLIT;
	}
}

function saveSplit() {
	try {
		window.localStorage?.setItem(SPLIT_KEY, String(Math.round(splitPercent)));
	} catch {
		// 存不了不影响使用
	}
}

function splitFromPointer(clientX) {
	const rect = mainElement?.getBoundingClientRect?.();
	const width = rect && rect.width > 0 ? rect.width : (window.innerWidth || 1000);
	const origin = rect && rect.width > 0 ? rect.left : 0;
	return applySplit(((clientX - origin) / width) * 100);
}

if (splitter && mainElement) {
	applySplit(storedSplit());
	splitter.addEventListener('pointerdown', event => {
		draggingSplitter = true;
		splitter.classList.add('is-dragging');
		splitter.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	});
	splitter.addEventListener('pointermove', event => {
		if (!draggingSplitter) {
			return;
		}
		splitFromPointer(event.clientX);
	});
	const stopDragging = () => {
		if (!draggingSplitter) {
			return;
		}
		draggingSplitter = false;
		splitter.classList.remove('is-dragging');
		saveSplit();
	};
	splitter.addEventListener('pointerup', stopDragging);
	splitter.addEventListener('pointercancel', stopDragging);
	splitter.addEventListener('dblclick', () => {
		applySplit(DEFAULT_SPLIT);
		saveSplit();
	});
}

// ── 初始化 ───────────────────────────────────────────────────────────────

for (const definition of config.panes ?? []) {
	const pane = createPane(definition);
	panes.set(pane.id, pane);
	renderHeader(pane);
	renderStatus(pane);
	if (pane.elements.input) {
		pane.elements.input.value = pane.root;
	}
	if (pane.elements.rows) {
		pane.elements.rows.title = '拖动条目到另一侧或拖出到资源管理器：默认复制；按住 Ctrl（或 Shift）放下 = 移动。右键任意条目可打开与子树浏览一致的文件操作菜单。';
	}

	pane.elements.input?.addEventListener('keydown', event => {
		// 中文输入法确认候选词也会发 Enter，此时不能当成跳转。
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			navigate(pane);
		} else if (event.key === 'Escape') {
			hideLocations(pane);
		}
	});
	pane.elements.go?.addEventListener('click', () => navigate(pane));
	pane.elements.up?.addEventListener('click', () => {
		post({ type: 'wispkit.compare.up', pane: pane.id });
	});
	pane.elements.refresh?.addEventListener('click', () => {
		if (!pane.root) {
			return;
		}
		setStatus(pane, READING);
		post({ type: 'wispkit.compare.refresh', pane: pane.id });
	});
	pane.elements.dropdown?.addEventListener('click', event => {
		event.stopPropagation();
		toggleLocations(pane);
	});

	const section = pane.elements.section;
	if (section) {
		section.addEventListener('contextmenu', event => {
			if (event.target?.closest?.('.wispkit-compare-pathbar')) {
				return;
			}
			event.preventDefault();
			openContextMenu(pane, rowForEvent(pane, event), event.clientX, event.clientY);
		});

		section.addEventListener('dragover', event => {
			const types = dragTypes(event.dataTransfer);
			const internal = isInternalDrag(event.dataTransfer);
			// 从 VS Code 资源管理器拖入时只有 uri-list，没有 Files；也给出放置高亮。
			const externalUri = !types.includes('files') && types.includes('text/uri-list');
			if (!internal && !externalUri) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const moveHint = internal && isMoveDrag(event);
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = moveHint ? 'move' : 'copy';
			}
			highlightDropTarget(pane, rowForEvent(pane, event), moveHint);
		});
		section.addEventListener('dragleave', event => {
			if (!section.contains(event.relatedTarget)) {
				clearDropHighlight();
			}
		});
		section.addEventListener('drop', event => {
			handlePaneDrop(pane, event);
		});
	}

	if (pane.root) {
		renderRows(pane);
		setStatus(pane, READING);
		requestLevel(pane, pane.root);
	} else {
		setStatus(pane, '没有可浏览的根目录。', 'error');
	}
}

/*
 * 系统文件拖入：VS Code 的 webview pre script 会在 dragenter 时把 iframe 设成
 * pointer-events:none，把整次拖拽转交给工作台。这里在 document 的**捕获**阶段先
 * preventDefault + stopPropagation；只拦截带 `Files` 的纯文件拖拽，uri-list 拖拽
 * 仍走各 pane 自己的监听器。
 */
const isExternalFileDrag = event => dragTypes(event?.dataTransfer).includes('files');

function paneForEvent(event) {
	const element = event.target?.closest?.('.wispkit-compare-pane') ?? null;
	return element ? panes.get(element.dataset.pane) ?? null : null;
}

document.addEventListener('dragenter', event => {
	if (!isExternalFileDrag(event)) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
}, true);

document.addEventListener('dragover', event => {
	if (!isExternalFileDrag(event)) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'copy';
	}
	const pane = paneForEvent(event);
	if (pane) {
		highlightDropTarget(pane, rowForEvent(pane, event), false);
	} else {
		clearDropHighlight();
	}
}, true);

document.addEventListener('drop', event => {
	if (!isExternalFileDrag(event)) {
		return;
	}
	void handleExternalFileDrop(event);
}, true);

window.addEventListener('dragend', () => {
	clearDropHighlight();
});

document.addEventListener('mousedown', event => {
	for (const pane of panes.values()) {
		const container = pane.elements.locations;
		if (!container || container.hidden) {
			continue;
		}
		if (!pane.elements.pathbar?.contains(event.target)) {
			hideLocations(pane);
		}
	}
});

window.addEventListener('message', event => {
	const message = event.data;
	if (!message || typeof message !== 'object') {
		return;
	}
	switch (message.type) {
		case 'wispkit.compare.level':
			applyLevel(message);
			return;
		case 'wispkit.compare.root':
			applyRoot(message);
			return;
		case 'wispkit.compare.status':
			applyStatus(message);
			return;
		case 'wispkit.compare.locations':
			applyLocations(message.groups);
			return;
		case 'wispkit.compare.dropResult':
			applyDropResult(message);
			return;
		case 'wispkit.compare.refreshDirs':
			applyRefreshDirs(message);
			return;
		default:
			return;
	}
});

/** 供自动化验证读取：断言项不依赖人眼。 */
Object.defineProperty(window, '__wispkitCompareSelftest', {
	value: {
		panes: () => Array.from(panes.keys()),
		root: id => panes.get(id)?.root ?? '',
		inputValue: id => panes.get(id)?.elements.input?.value ?? '',
		setInput: (id, value) => {
			const pane = panes.get(id);
			if (pane?.elements.input) {
				pane.elements.input.value = String(value ?? '');
			}
			return panes.get(id)?.elements.input?.value ?? '';
		},
		navigate: (id, value) => {
			const pane = panes.get(id);
			if (!pane) {
				return null;
			}
			navigate(pane, value);
			return lastMessage;
		},
		up: id => {
			post({ type: 'wispkit.compare.up', pane: id });
			return lastMessage;
		},
		refresh: id => {
			post({ type: 'wispkit.compare.refresh', pane: id });
			return lastMessage;
		},
		rows: id => {
			const pane = panes.get(id);
			return Array.from(pane?.elements.rows?.querySelectorAll('.wispkit-subtree-row') ?? []).map(row => ({
				path: row.dataset.path,
				depth: Number(row.dataset.depth),
				cells: Array.from(row.querySelectorAll('.wispkit-subtree-cell')).map(cell => {
					const name = cell.querySelector('.wispkit-subtree-name');
					return name ? name.textContent : cell.textContent;
				}),
			}));
		},
		rowCount: id => panes.get(id)?.elements.rows?.querySelectorAll('.wispkit-subtree-row').length ?? 0,
		expand: (id, path) => {
			const pane = panes.get(id);
			if (!pane) {
				return false;
			}
			pane.expanded.add(path);
			renderRows(pane);
			return pane.expanded.has(path);
		},
		collapse: (id, path) => {
			const pane = panes.get(id);
			if (!pane) {
				return false;
			}
			pane.expanded.delete(path);
			renderRows(pane);
			return pane.expanded.has(path);
		},
		applyLevel: (id, path, rows, error) => {
			applyLevel({ pane: id, path, rows, error });
		},
		applyRoot: (id, root, title) => {
			applyRoot({ pane: id, root, title });
		},
		applyStatus: (id, message, kind) => {
			applyStatus({ pane: id, message, kind });
		},
		applyLocations: groups => applyLocations(groups),
		toggleLocations: id => {
			const pane = panes.get(id);
			if (!pane) {
				return false;
			}
			toggleLocations(pane);
			return pane.elements.locations ? !pane.elements.locations.hidden : false;
		},
		locations: id => {
			const pane = panes.get(id);
			return Array.from(pane?.elements.locations?.querySelectorAll('.wispkit-compare-location') ?? []).map(button => ({
				label: button.querySelector('.wispkit-compare-location-label')?.textContent ?? '',
				path: button.dataset.path ?? '',
				group: button.dataset.group ?? '',
				disabled: Boolean(button.disabled),
			}));
		},
		clickLocation: (id, path) => {
			const pane = panes.get(id);
			const button = Array.from(pane?.elements.locations?.querySelectorAll('.wispkit-compare-location') ?? [])
				.find(candidate => candidate.dataset.path === path);
			button?.click();
			return Boolean(button);
		},
		status: id => {
			const pane = panes.get(id);
			const element = pane?.elements.status;
			return element && !element.hidden ? element.textContent : '';
		},
		dragSession: () => activeDragSession(),
		dropResult: message => applyDropResult(message),

		// —— 右键菜单 ——
		contextMenu: () => ({
			open: contextMenu.isOpen,
			labels: contextMenu.labels,
			icons: contextMenu.icons,
			disabled: contextMenu.disabledLabels,
		}),
		openContextMenu: (id, path, x = 12, y = 12) => {
			const pane = panes.get(id);
			if (!pane) {
				return false;
			}
			const row = path ? findRow(pane, path) : null;
			if (path && !row) {
				return false;
			}
			return openContextMenu(pane, row, x, y);
		},
		clickContextMenu: label => contextMenu.click(label),
		closeContextMenu: () => contextMenu.close(),
		selection: id => panes.get(id)?.selection ?? null,

		startDrag: (id, path, modifiers = {}) => {
			const pane = panes.get(id);
			const element = pane ? findRowElement(pane, path) : null;
			if (!element) {
				return null;
			}
			const event = new window.Event('dragstart', { bubbles: true, cancelable: true });
			const store = new Map();
			const dataTransfer = {
				types: [],
				effectAllowed: 'none',
				setData(type, value) {
					store.set(type, String(value));
					if (!this.types.includes(type)) {
						this.types.push(type);
					}
				},
				getData(type) {
					return store.get(type) ?? '';
				},
				setDragImage() { /* jsdom / 自动化环境不需要拖拽图像 */ },
			};
			Object.assign(event, {
				ctrlKey: Boolean(modifiers.ctrlKey),
				metaKey: Boolean(modifiers.metaKey),
				shiftKey: Boolean(modifiers.shiftKey),
				dataTransfer,
			});
			element.dispatchEvent(event);
			return { dataTransfer, types: dataTransfer.types };
		},
		simulateDrop: (id, options = {}) => {
			const pane = panes.get(id);
			if (!pane?.elements.section) {
				return null;
			}
			const event = new window.Event('drop', { bubbles: true, cancelable: true });
			const dataTransfer = {
				types: Array.isArray(options.types) ? options.types : [],
				getData: type => String(options.data?.[type] ?? ''),
				dropEffect: 'none',
			};
			Object.assign(event, {
				ctrlKey: Boolean(options.ctrlKey),
				metaKey: Boolean(options.metaKey),
				shiftKey: Boolean(options.shiftKey),
				dataTransfer,
			});
			if (options.rowPath) {
				const row = findRowElement(pane, options.rowPath);
				row?.dispatchEvent(event);
				if (!row) {
					return null;
				}
			} else {
				pane.elements.section.dispatchEvent(event);
			}
			return lastMessage;
		},
		highlight: id => {
			const pane = panes.get(id);
			return {
				root: Boolean(pane?.elements.tree?.classList.contains('is-drop-root')),
				move: Boolean(pane?.elements.tree?.classList.contains('is-move-drop')),
				rows: Array.from(pane?.elements.rows?.querySelectorAll('.is-drop-target') ?? []).map(el => el.dataset.path),
			};
		},
		setSplit: value => applySplit(value),
		getSplit: () => splitPercent,
		lastMessage: () => lastMessage,
		clearLastMessage: () => {
			lastMessage = null;
		},
		rootElement: () => mainElement?.style.getPropertyValue('--wispkit-compare-left') ?? '',
	},
});
