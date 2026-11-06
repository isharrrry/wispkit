/**
 * 子树浏览前端。ESM —— 宿主用 `<script type="module" src="media/subtree.js" nonce=...>`
 * 直接引它（共享的右键菜单 / 拖入读取模块用相对 import），不经 esbuild 打包。
 *
 * 树的观感对齐资源管理器：紧凑行、懒加载展开、多列（列由宿主按配置下发）。
 * 单元格文本与**排序**都由宿主负责（它有原始 size/mtime，前端只有格式化文本），
 * 前端只做摆放、选择与交互。
 */

import { createContextMenu } from './shared/contextmenu.js';
import { MAX_DROP_STRING_CHARS, readDroppedFiles, snapshotDrop } from './shared/filedrop.js';

const READING = '正在读取…';

/** 与 explorerCommands.ts 的 COMMAND_GROUP_ORDER / LABELS 对应（前端不 import src，只能抄一份）。 */
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

const SVG_NS = 'http://www.w3.org/2000/svg';

function readConfig() {
	const meta = document.getElementById('wispkit-subtree-config');
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

/** 页面内右键菜单（VS Code 没有从 webview 弹原生菜单的 API）。 */
const contextMenu = createContextMenu();

let config = readConfig() ?? {
	rootPath: '', rootName: '', owner: '', columns: [], commands: [], tools: [], sort: { key: 'name', direction: 'asc' },
};

const rowsElement = document.getElementById('wispkit-subtree-rows');
const headerElement = document.getElementById('wispkit-subtree-header');
const commandsElement = document.getElementById('wispkit-subtree-commands');
const toolsElement = document.getElementById('wispkit-subtree-tools');
const toolsSection = document.getElementById('wispkit-subtree-tools-section');
const selectedPathElement = document.getElementById('wispkit-subtree-selected-path');
const statusElement = document.getElementById('wispkit-subtree-status');
const actionsElement = document.getElementById('wispkit-subtree-actions');
const splitter = document.getElementById('wispkit-subtree-splitter');

/** path -> { rows, error }；只有展开过的层级才会在这里。 */
const levels = new Map();
const expanded = new Set();
/** 点「展开一层」时目标层还没读过：读回来再展开，而不是让用户再点一次。 */
const pendingExpand = new Set();
/** 有序的多选集合（顺序即 Shift 范围与批量操作的顺序）。 */
let selection = [];
let anchorPath = null;
let sortState = { key: 'name', direction: 'asc' };
let requestSeed = 0;
let typeAheadBuffer = '';
let typeAheadTimer = null;
/** 输入法组合期间不处理 keydown（此时 key 恒为 'Process'），落字后走 compositionend。 */
let typeAheadComposing = false;
/** 连击重置时间：与资源管理器一致的体感，超过就当作新的一次输入。 */
const TYPE_AHEAD_RESET_MS = 700;
/** 最后一条发出的消息，供自动化断言「批量操作真的带上了所有选中项」。 */
let lastMessage = null;
/**
 * 本页发起、尚未结束的拖拽。记住 dragstart 那一刻的 Ctrl/Cmd 状态 ——
 * 用户「先按下 Ctrl 再拖」之后可能在松手前就放开了 Ctrl，drop 时只看事件
 * 的 ctrlKey 会漏判。
 */
let dragSession = null;
/** 拖拽会话的最长存活时间：正常拖拽几秒内必有 drop / dragend，超时视为残留。 */
const DRAG_SESSION_MAX_AGE_MS = 30_000;

function post(message, transfer) {
	lastMessage = message;
	if (transfer && transfer.length > 0) {
		hostApi?.postMessage(message, transfer);
	} else {
		hostApi?.postMessage(message);
	}
}

function setStatus(message, kind) {
	if (!statusElement) {
		return;
	}
	statusElement.textContent = message ?? '';
	statusElement.classList.toggle('is-error', kind === 'error');
}

function nextRequestId() {
	requestSeed += 1;
	return `${requestSeed}`;
}

function requestLevel(path) {
	post({ type: 'wispkit.subtree.read', requestId: nextRequestId(), path });
}

/* ---------------------------------------------------------------- 拖拽：条目拖出 / 内容拖入 */

/**
 * 本扩展拖拽源写进 DataTransfer 的私有类型（拖拽数据存储里的 MIME 一律小写）。
 *
 * drop 时用它区分「从 Wispkit 子树里拖出来的条目」和「从系统/其他应用拖进来的文件」：
 * 只有前者才把 Ctrl 当作移动。系统文件拖入时 Ctrl 在资源管理器里恰恰是**复制**，
 * 反着解释会误删源文件。
 */
const WISPKIT_DRAG_TYPE = 'application/x-wispkit-subtree';

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
 * 这次 drop 是不是从 Wispkit 子树拖出来的？
 *
 * - 系统/其他应用拖入一定带 `Files` 类型：即使上一次内部拖拽因为异常没收到
 *   dragend、`dragSession` 还残留，也绝不能再把系统文件当成内部拖拽
 *   （Windows 资源管理器里 Ctrl 是复制，误判会删源文件）；
 * - 同页拖动：dragstart 设置了 `dragSession`，一定是我们自己；
 * - 左右两个子树面板互拖：目标页收不到源的 dragstart，只能看 dragstart 写入的私有 MIME。
 */
function isWispkitDrag(dataTransfer) {
	const types = dragTypes(dataTransfer);
	if (types.includes('files')) {
		return false;
	}
	if (activeDragSession()) {
		return true;
	}
	return types.some(type => type === WISPKIT_DRAG_TYPE);
}

/** 拖动过程中是否处于「Ctrl/Cmd = 移动」语义（含 dragstart 时按下、中途松开的）。 */
function isMoveDrag(event) {
	return isWispkitDrag(event?.dataTransfer)
		&& (Boolean(event?.ctrlKey || event?.metaKey) || Boolean(activeDragSession()?.moveModifier));
}

/**
 * 绝对路径 → `file://` URL。逐段编码，避免空格 / `#` / `?` 把 URL 拆坏；
 * Windows 盘符保留 `D:` 原样（`file:///D:/a%20b`）。
 */
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
 * - `text/uri-list` / `ResourceURLs` / `CodeFiles`：拖回 VS Code 内部时能被识别成资源；
 * - `DownloadURL`：拖到桌面 / 资源管理器时由 Chromium 落成**真实文件**（只支持单个文件，
 *   与 VS Code 自己的标签页拖出行为一致）；
 * - `text/plain`：给普通文本目标（终端、编辑器）一个可读路径。
 */
function dragPayloadForRows(rows) {
	const paths = rows.map(row => row.path);
	const uris = paths.map(toFileUrl);
	const firstFile = rows.find(row => !row.isDirectory);
	return {
		paths,
		text: paths.join('\r\n'),
		uriList: uris.join('\r\n'),
		resourceUrls: JSON.stringify(uris),
		codeFiles: JSON.stringify(paths),
		downloadUrl: firstFile
			? `application/octet-stream:${firstFile.name}:${toFileUrl(firstFile.path)}`
			: undefined,
	};
}

/** 拖放目标：文件行落到它的父目录；文件夹行落到自己；空白处落到选中文件夹或根。 */
function dropTargetForRow(row) {
	if (!row) {
		const selected = selection.length === 1 ? findRow(selection[0]) : null;
		return selected?.isDirectory ? selected.path : config.rootPath;
	}
	if (row.isDirectory) {
		return row.path;
	}
	if (row.parentPath) {
		return row.parentPath;
	}
	const value = String(row.path ?? '');
	const slash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
	if (slash > 0) {
		return slash === 2 && value[1] === ':' ? value.slice(0, 3) : value.slice(0, slash);
	}
	return config.rootPath;
}

function clearDropHighlight() {
	for (const element of rowsElement?.querySelectorAll('.is-drop-target') ?? []) {
		element.classList.remove('is-drop-target');
	}
	rowsElement?.closest('.wispkit-subtree-tree')?.classList.remove('is-move-drop');
}

function highlightDropTarget(row) {
	clearDropHighlight();
	if (!row || !rowsElement) {
		return;
	}
	const target = row.isDirectory ? row : findRow(row.parentPath);
	if (!target) {
		return;
	}
	for (const element of rowsElement.querySelectorAll('.wispkit-subtree-row')) {
		if (element.dataset.path === target.path) {
			element.classList.add('is-drop-target');
			break;
		}
	}
}

// ── 指针拖拽（不依赖 HTML5 原生拖拽）──────────────────────────────────────
//
// VS Code 1.137 / Electron 的 webview 里，`draggable=true` 的行一旦被鼠标
// 拖动，Chromium 就会进入原生 OLE 拖拽循环。真机上这个循环不会正常结束：
// 主进程 Responding=false、单核 100%，drop / dragend 都不触发，拖到系统资源
// 管理器时尤其明显。这里和对比浏览一样改成 pointerdown/pointermove/pointerup
// 自己跟踪拖拽，**不设置 draggable**，从源头上不进原生拖拽循环。

const POINTER_DRAG_THRESHOLD = 5;

/** 当前指针拖拽会话（一次只有一个）。 */
let pointerDrag = null;
/** 拖拽结束后要吞掉一次 click，避免把松手当成点选。 */
let suppressNextClick = false;

function dragGhostLabel(rows, moveHint, outside) {
	const label = rows.length > 1 ? `${rows.length} 个条目` : rows[0]?.name ?? '条目';
	if (outside) {
		return `${label} · 松开 = ${moveHint ? '移动到' : '复制到'}资源管理器`;
	}
	return `${label} · ${moveHint ? '移动' : '复制'}`;
}

function createDragGhost(rows, moveHint) {
	const ghost = document.createElement('div');
	ghost.className = 'wispkit-subtree-drag-ghost';
	ghost.setAttribute('aria-hidden', 'true');
	ghost.textContent = dragGhostLabel(rows, moveHint, false);
	ghost.classList.toggle('is-move', moveHint);
	ghost.classList.toggle('is-copy', !moveHint);
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
	ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function updateDragGhost(ghost, rows, moveHint, outside = false) {
	if (!ghost) {
		return;
	}
	ghost.textContent = dragGhostLabel(rows, moveHint, outside);
	ghost.classList.toggle('is-move', moveHint);
	ghost.classList.toggle('is-copy', !moveHint);
	ghost.classList.toggle('is-outside', outside);
}

function pointerDragMoveHint(event, drag) {
	return Boolean(event?.ctrlKey || event?.metaKey || drag?.moveModifierAtStart);
}

function pointerDragRows(drag) {
	return drag.rows?.length ? drag.rows : [drag.row];
}

function pointerInsideViewport(event) {
	return event.clientX >= 0
		&& event.clientY >= 0
		&& event.clientX < window.innerWidth
		&& event.clientY < window.innerHeight;
}

/** 指针下的树内行（不在树区域内返回 null）。 */
function pointerDragHitRow(event) {
	if (!pointerInsideViewport(event) || !treeElement) {
		return null;
	}
	const hit = document.elementFromPoint(event.clientX, event.clientY);
	if (!hit || !treeElement.contains(hit)) {
		return null;
	}
	const rowElement = hit.closest?.('.wispkit-subtree-row') ?? null;
	return rowElement ? findRow(rowElement.dataset.path) : null;
}

function updatePointerDropTarget(drag, event) {
	const outside = !pointerInsideViewport(event);
	const row = outside ? null : pointerDragHitRow(event);
	const insideTree = !outside && (Boolean(row) || Boolean(treeElement?.contains(
		document.elementFromPoint(event.clientX, event.clientY),
	)));
	const moveHint = pointerDragMoveHint(event, drag);
	if (insideTree) {
		highlightDropTarget(row);
		treeElement?.classList.toggle('is-move-drop', moveHint);
	} else {
		clearDropHighlight();
	}
	// 鼠标光标本身就是「正在拖拽」最直接的反馈：copy / move 系统光标 + 跟随气泡
	document.body.classList.toggle('is-copy-drag', !moveHint);
	document.body.classList.toggle('is-move-drag', moveHint);
	drag.targetRow = row;
	drag.insideTree = insideTree;
	updateDragGhost(drag.ghost, pointerDragRows(drag), moveHint, outside);
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
	document.body.classList.remove('is-wispkit-pointer-drag');
	document.body.classList.remove('is-copy-drag', 'is-move-drag');
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
		if (!isSelected(drag.row.path)) {
			selectOnlyForDrag(drag.row.path);
		}
		drag.rows = selection.map(path => findRow(path)).filter(Boolean);
		if (drag.rows.length === 0) {
			drag.rows = [drag.row];
		}
		drag.element.classList.add('is-dragging');
		document.body.classList.add('is-wispkit-pointer-drag');
		drag.ghost = createDragGhost(drag.rows, pointerDragMoveHint(event, drag));
	}
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
	const rows = pointerDragRows(drag);
	const paths = rows.map(row => row.path);
	const moveRequested = pointerDragMoveHint(event, drag);
	const ctrlKey = Boolean(event.ctrlKey || event.metaKey);
	const shiftKey = Boolean(event.shiftKey);
	const insideTree = drag.insideTree;
	const targetRow = drag.targetRow;
	finishPointerDrag();
	// 拖到 webview 之外松手 = 拖出到系统（资源管理器 / 桌面）
	if (!pointerInsideViewport(event)) {
		post({ type: 'wispkit.subtree.dragOut', paths, ctrlKey, shiftKey, moveRequested });
		return;
	}
	suppressNextClick = true;
	if (!insideTree) {
		return;
	}
	const targetDir = dropTargetForRow(targetRow);
	if (!targetDir) {
		setStatus('没有可放置的目标文件夹。', 'error');
		return;
	}
	// 与原来的 drag/drop 走同一条宿主消息：宿主按 uri-list 解析源路径
	const uriList = paths.map(toFileUrl).join('\r\n');
	setStatus(moveRequested ? '正在移动…' : '正在复制…');
	post({
		type: 'wispkit.subtree.drop',
		targetDir,
		files: [],
		strings: [{ kind: 'string', mime: 'text/uri-list', text: uriList }],
		shiftKey,
		ctrlKey,
		internalDrag: true,
		moveRequested,
	});
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

function beginPointerDrag(row, element, event) {
	if (pointerDrag || event.button !== 0) {
		return;
	}
	// 展开箭头等按钮上的按下不启动拖拽
	if (event.target?.closest?.('button')) {
		return;
	}
	pointerDrag = {
		row,
		element,
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		active: false,
		moveModifierAtStart: Boolean(event.ctrlKey || event.metaKey),
		rows: null,
		targetRow: null,
		insideTree: false,
		ghost: null,
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

document.addEventListener('click', event => {
	if (!suppressNextClick) {
		return;
	}
	suppressNextClick = false;
	event.preventDefault();
	event.stopPropagation();
}, true);

/** drop 的完整处理：读取 → 发给宿主（宿主负责询问与落盘）。 */
async function handleDrop(event) {
	event.preventDefault();
	event.stopPropagation();
	const rowElement = event.target?.closest?.('.wispkit-subtree-row');
	const row = rowElement ? findRow(rowElement.dataset.path) : null;
	const targetDir = dropTargetForRow(row);
	// 修饰键状态要在同步阶段取值：进入 await 后事件对象可能已被复用。
	const internalDrag = isWispkitDrag(event.dataTransfer);
	const ctrlKey = Boolean(event.ctrlKey || event.metaKey);
	const moveRequested = internalDrag && (ctrlKey || Boolean(activeDragSession()?.moveModifier));
	dragSession = null;
	clearDropHighlight();

	const snapshot = snapshotDrop(event.dataTransfer);
	const strings = (await Promise.all(snapshot.stringPromises))
		.filter(Boolean)
		.filter(item => item.text.length <= MAX_DROP_STRING_CHARS);
	const files = await readDroppedFiles(snapshot.fileObjects);

	if (snapshot.directories.length > 0) {
		setStatus(`暂不支持拖入文件夹：${snapshot.directories.join('、')}`, 'error');
		if (files.length === 0 && strings.length === 0) {
			return;
		}
	}
	if (files.length === 0 && strings.length === 0) {
		setStatus('没有可导入的内容。', 'error');
		return;
	}

	setStatus(moveRequested ? '正在移动拖入的条目…' : '正在接收拖入的内容…');
	const buffers = files.map(file => file.data).filter(Boolean);
	post({
		type: 'wispkit.subtree.drop',
		targetDir,
		files,
		strings,
		shiftKey: Boolean(event.shiftKey),
		// 原始键态 + 派生结论一起给宿主：宿主只信「内部拖拽 + 明确要求移动」
		ctrlKey,
		internalDrag,
		moveRequested,
	}, buffers);
}

/**
 * 层级刷新后，选中列表里可能留下过期路径（刚被删除 / 重命名的条目）。
 * 清掉它们，免得后续操作还在对已经不存在的条目下手。
 */
function pruneSelection() {
	const alive = selection.filter(path => findRow(path));
	if (alive.length === selection.length) {
		return;
	}
	selection = alive;
	if (anchorPath && !findRow(anchorPath)) {
		anchorPath = null;
	}
}

function applyLevel(path, rows, error, icons) {
	levels.set(path, { rows: Array.isArray(rows) ? rows : [], error: error ?? undefined });
	if (icons && typeof icons === 'object') {
		for (const [filePath, dataUri] of Object.entries(icons)) {
			if (typeof dataUri === 'string' && dataUri.startsWith('data:image/')) {
				fileIconByPath.set(filePath, dataUri);
			}
		}
	}
	pruneSelection();
	if (pendingExpand.has(path) && !error) {
		pendingExpand.delete(path);
		expandOneLevel(path);
		return;
	}
	renderTree();
}

function applyConfig(next) {
	if (!next || typeof next !== 'object') {
		return;
	}
	const rootChanged = next.rootPath !== config.rootPath;
	config = next;
	sortState = { key: next.sort?.key ?? 'name', direction: next.sort?.direction ?? 'asc' };
	renderHeader();
	renderActions();
	if (rootChanged || !levels.has(config.rootPath)) {
		levels.clear();
		expanded.clear();
		selection = [];
		anchorPath = null;
		renderTree();
		requestLevel(config.rootPath);
	}
}

/**
 * 文件类型 → 图标名的规则表，顺序即优先级。
 *
 * 与 `src/subtree/columns.ts` 的 `fileCategory()` 是**两件事**：那边给的是给人看的中文分类名，
 * 这里只决定用哪个图标。图标是纯展示决策，所以规则留在前端，也便于用 `loadMediaModule` 单测。
 */
const FILE_ICON_RULES = [
	['file-code', ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'pyw', 'pyi',
		'cs', 'fs', 'vb', 'java', 'kt', 'kts', 'go', 'rs', 'rb', 'php', 'swift', 'lua', 'pl', 'r',
		'c', 'h', 'cc', 'cpp', 'cxx', 'hxx', 'hpp', 'm', 'mm', 'css', 'scss', 'less', 'styl', 'sql', 'asm', 's']],
	['file-shell', ['sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd']],
	['file-config', ['json', 'jsonc', 'json5', 'xml', 'xsd', 'xsl', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
		'properties', 'editorconfig', 'env', 'props', 'targets', 'csproj', 'vbproj', 'fsproj', 'sln', 'gradle',
		'lock', 'gitignore', 'npmrc', 'eslintrc', 'prettierrc']],
	['file-markdown', ['md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc']],
	['file-image', ['png', 'jpg', 'jpeg', 'jpe', 'bmp', 'gif', 'ico', 'webp', 'avif', 'svg', 'tif', 'tiff', 'psd', 'raw']],
	['file-archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'iso', 'jar', 'nupkg']],
	['file-media', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v']],
	['file-data', ['csv', 'tsv', 'dat', 'db', 'sqlite', 'sqlite3', 'mdb', 'xls', 'xlsx', 'ods', 'parquet', 'log', 'dump']],
	['file-text', ['txt', 'text', 'rtf', 'nfo', 'lst']],
];

/**
 * 取小写扩展名。点号开头的隐藏文件（`.gitignore` → `gitignore`）与结尾点号（`a.`）
 * 都算"没有扩展名" —— 与 `src/subtree/columns.ts` 的口径保持一致。
 */
function extensionOf(name) {
	const base = String(name ?? '');
	const dot = base.lastIndexOf('.');
	if (dot <= 0 || dot === base.length - 1) {
		return base.startsWith('.') && dot <= 0 ? base.slice(1).toLowerCase() : '';
	}
	return base.slice(dot + 1).toLowerCase();
}

/**
 * 条目用哪个图标：文件夹区分展开态；文件按扩展名归类；认不出的用通用文件图标。
 *
 * **不影响哪一列可见** —— 扩展名直接从名字取，所以用户把"扩展名"列关掉图标照样正确。
 */
function iconFor(row) {
	if (row.isDirectory) {
		return expanded.has(row.path) ? 'folder-open' : 'folder';
	}
	const ext = extensionOf(row.name ?? row.cells?.name);
	for (const [icon, extensions] of FILE_ICON_RULES) {
		if (extensions.includes(ext)) {
			return icon;
		}
	}
	return 'file';
}

/**
 * 用户图标主题给出的图标 URI；主题不可用时返回 null，调用方回退到内联自绘 sprite。
 *
 * 匹配顺序与资源管理器一致：**先完整文件名 → 再扩展名 → 最后默认文件图标**。
 */
function themeIconUri(row) {
	const theme = config.iconTheme;
	if (!theme) {
		return null;
	}
	if (row.isDirectory) {
		return expanded.has(row.path) ? theme.folderExpanded : theme.folder;
	}
	const name = String(row.name ?? row.cells?.name ?? '').toLowerCase();
	const byName = theme.byFileName?.[name];
	if (byName) {
		return byName;
	}
	const ext = extensionOf(name);
	const byExt = ext ? theme.byExtension?.[ext] : undefined;
	return byExt || theme.file;
}

/**
 * 用主题图标画一个条目图标。
 *
 * 用 CSS `mask-image` 而不是 `<img>`：主题里的 svg 全部是 `fill="currentColor"` 的单色图标
 * （实测 117 个文件的硬编码颜色数为 0），mask 配合 `background-color: currentColor`
 * 能跟随前景/选中态，而 `<img>` 会把它们渲染成 svg 自己的默认色（黑），反而不一致。
 */
function makeThemeIcon(uri, className) {
	const span = document.createElement('span');
	span.className = className ?? 'wispkit-subtree-icon';
	span.setAttribute('aria-hidden', 'true');
	span.style.setProperty('--wispkit-subtree-icon-mask', `url("${uri}")`);
	return span;
}

/*
 * `.lnk` / `.exe` 的真实图标（宿主从文件本身抽出来的 PNG data URI）。
 * 图标主题只能按扩展名给一个通用图标，而这两类文件的意义就在「是哪一个程序」。
 */
const fileIconByPath = new Map();

/** 条目图标：文件自带图标 > 图标主题 > 内联自绘。 */
function makeItemIcon(row, className) {
	const own = row.isDirectory ? undefined : fileIconByPath.get(row.path);
	if (own) {
		const img = document.createElement('img');
		img.className = 'wispkit-subtree-icon wispkit-subtree-item-icon wispkit-subtree-own-icon';
		img.src = own;
		img.alt = '';
		img.draggable = false;
		img.setAttribute('aria-hidden', 'true');
		return img;
	}
	const uri = themeIconUri(row);
	if (uri) {
		return makeThemeIcon(uri, 'wispkit-subtree-icon wispkit-subtree-item-icon');
	}
	return makeIcon(iconFor(row), className);
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

function makeCell(column) {
	const cell = document.createElement('span');
	cell.className = 'wispkit-subtree-cell';
	cell.dataset.column = column.id;
	if (column.align === 'right') {
		cell.dataset.align = 'right';
	}
	return cell;
}

/** 表头：列名可点（排序）+ 右缘可拖（列宽）。两者互不干扰。 */
function renderHeader() {
	if (!headerElement) {
		return;
	}
	headerElement.textContent = '';

	for (const column of config.columns) {
		const cell = makeCell(column);
		cell.dataset.sortable = 'true';
		if (sortState.key === column.id) {
			cell.dataset.sorted = sortState.direction;
			cell.setAttribute('aria-sort', sortState.direction === 'asc' ? 'ascending' : 'descending');
		}
		cell.title = `按${column.label}排序`;

		const label = document.createElement('span');
		label.className = 'wispkit-subtree-header-label';
		label.textContent = column.label;
		cell.appendChild(label);

		if (sortState.key === column.id) {
			cell.appendChild(makeIcon(
				sortState.direction === 'asc' ? 'sort-asc' : 'sort-desc',
				'wispkit-subtree-icon-svg wispkit-subtree-sort-indicator',
			));
		}

		const handle = document.createElement('span');
		handle.className = 'wispkit-subtree-resize';
		handle.dataset.column = column.id;
		handle.title = '拖动调整列宽，双击复位该列';
		cell.appendChild(handle);

		cell.addEventListener('click', event => {
			if (event.target === handle) {
				return;
			}
			toggleSort(column.id);
		});

		headerElement.appendChild(cell);
	}
}

function toggleSort(key) {
	const direction = sortState.key === key && sortState.direction === 'asc' ? 'desc' : 'asc';
	sortState = { key, direction };
	renderHeader();
	// 重排交给宿主：它手上有原始值，而且缓存了已读层级，不用重新读盘
	post({
		type: 'wispkit.subtree.sort',
		key,
		direction,
		paths: Array.from(levels.keys()),
	});
}

function isSelected(path) {
	return selection.includes(path);
}

function makeRow(row, depth) {
	const element = document.createElement('div');
	element.className = 'wispkit-subtree-row';
	element.setAttribute('role', 'treeitem');
	element.dataset.path = row.path;
	element.dataset.depth = String(depth);
	element.style.setProperty('--wispkit-depth', String(depth));
	if (isSelected(row.path)) {
		element.classList.add('is-selected');
		element.setAttribute('aria-selected', 'true');
	}

	for (const column of config.columns) {
		const cell = makeCell(column);
		if (column.id === 'name') {
			const isExpanded = expanded.has(row.path);

			const twisty = document.createElement('button');
			twisty.type = 'button';
			twisty.className = `wispkit-subtree-twisty${row.isDirectory ? '' : ' is-leaf'}`;
			twisty.textContent = isExpanded ? '▾' : '▸';
			twisty.setAttribute('aria-label', isExpanded ? '折叠' : '展开');
			twisty.addEventListener('click', event => {
				event.stopPropagation();
				if (row.isDirectory) {
					toggle(path => path === row.path, row.path);
				}
			});

			// 层级缩进放在单元格**内部**的占位元素上，而不是给单元格加 padding-left ——
			// 单元格是 content-box，padding 会撑宽它本身，把后面每一列一起推右。
			const indent = document.createElement('span');
			indent.className = 'wispkit-subtree-indent';

			const icon = makeItemIcon(row, 'wispkit-subtree-icon-svg wispkit-subtree-item-icon');

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

	element.addEventListener('click', event => {
		selectRow(row, event);
		renderTree();
		renderActions();
		scrollRowIntoView(row.path);
	});
	element.addEventListener('dblclick', () => {
		if (row.isDirectory) {
			toggle(path => path === row.path, row.path);
		} else {
			post({ type: 'wispkit.subtree.open', path: row.path });
		}
	});

	// 不用 HTML5 原生拖拽：VS Code webview 里它会进入原生 OLE 拖拽循环并卡死
	// VS Code（拖到系统资源管理器时必现，见 pointerDrag 段注释）。draggable 保持
	// false，真实鼠标拖动完全由 pointerdown/pointermove/pointerup 驱动。
	element.draggable = false;
	element.addEventListener('pointerdown', event => {
		beginPointerDrag(row, element, event);
	});
	// 保留 dragstart/dragend 监听：自动化探针 / 单测直接派发合成事件时仍走原逻辑。
	element.addEventListener('dragstart', event => {
		if (!isSelected(row.path)) {
			selectOnlyForDrag(row.path);
		}
		const rows = selection.map(path => findRow(path)).filter(Boolean);
		if (rows.length === 0 || !event.dataTransfer) {
			return;
		}
		const payload = dragPayloadForRows(rows);
		// 「先按下 Ctrl 再拖」= 移动：在 dragstart 记下来，drop 时即使 Ctrl 已松开也算数
		dragSession = { moveModifier: Boolean(event.ctrlKey || event.metaKey), at: Date.now() };
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData('text/plain', payload.text);
		event.dataTransfer.setData('text/uri-list', payload.uriList);
		event.dataTransfer.setData('ResourceURLs', payload.resourceUrls);
		event.dataTransfer.setData('CodeFiles', payload.codeFiles);
		try {
			// 跨子树面板拖拽时目标页看不到上面的 dragSession，只能靠这个私有类型认出「是自己人」
			event.dataTransfer.setData(WISPKIT_DRAG_TYPE, '1');
		} catch {
			// 环境拒绝自定义类型时，同页拖动仍靠 dragSession 识别
		}
		// Chromium 只认单文件 DownloadURL：拖到桌面/资源管理器会落成真实文件
		if (payload.downloadUrl) {
			try {
				event.dataTransfer.setData('DownloadURL', payload.downloadUrl);
			} catch {
				// 某些环境拒绝这个自定义类型，不影响 URI 列表
			}
		}
		element.classList.add('is-dragging');
		// 状态栏文案会占宽；`media/subtree.css` 里已保证工具栏按钮不被压缩、不会把
		// 工具栏撑高（撑高会让拖拽源行整体位移，Chromium 会因此取消整次拖拽）。
		setStatus(`正在拖动 ${rows.length} 个条目…（按住 Ctrl 放下 = 直接移动）`);
	});
	element.addEventListener('dragend', () => {
		element.classList.remove('is-dragging');
		dragSession = null;
		setStatus('');
	});

	return element;
}

function scrollRowIntoView(path) {
	const element = Array.from(rowsElement?.querySelectorAll('.wispkit-subtree-row') ?? [])
		.find(row => row.dataset.path === path);
	element?.scrollIntoView?.({ block: 'nearest' });
}

function resetTypeAhead() {
	typeAheadBuffer = '';
	typeAheadTimer = null;
}

/** 按键跳转是否启用（设置项 `wispkit.subtree.typeAhead`，缺省开启）。 */
function typeAheadEnabled() {
	return config.typeAhead !== false;
}

/** 从 startIndex 起环形找第一个以 needle 开头的名字。 */
function findRowByNameFrom(rows, needle, startIndex) {
	const total = rows.length;
	for (let offset = 0; offset < total; offset += 1) {
		const row = rows[(startIndex + offset) % total];
		if (String(row.name ?? '').toLowerCase().startsWith(needle)) {
			return row;
		}
	}
	return null;
}

/**
 * 按键跳转（学资源管理器）：
 * - 连续输入累积成前缀，停顿超过 `TYPE_AHEAD_RESET_MS` 就当新的一次输入；
 * - 新一次输入从**当前选中项的下一个**开始找，所以连按同一个字母会依次往下跳；
 * - 累积前缀找不到时退化成单字符循环（连按 a、a、a 仍能逐个走）；
 * - 中文靠输入法：组合结束后用 `compositionend` 的文本整体匹配，不去猜拼音。
 *
 * 匹配只对**当前可见行**做一次前缀比较，行数上限就是单层条目上限，所以没有按数量
 * 分级启用的必要；开关只是让人能彻底关掉它。
 */
function applyTypeAhead(chunk, options = {}) {
	if (!typeAheadEnabled()) {
		return null;
	}
	const text = String(chunk ?? '');
	if (!text) {
		return null;
	}
	const rows = visibleRows();
	if (rows.length === 0) {
		return null;
	}

	const replace = options.replace === true;
	const continuing = !replace && typeAheadBuffer.length > 0;
	const anchorIndex = rows.findIndex(row => row.path === anchorPath);
	const needle = (replace ? text : typeAheadBuffer + text).toLowerCase();

	let startIndex = 0;
	if (continuing) {
		startIndex = Math.max(anchorIndex, 0);
	} else if (!replace && anchorIndex >= 0) {
		startIndex = anchorIndex + 1;
	}

	let matched = findRowByNameFrom(rows, needle, startIndex);
	if (!matched && continuing && startIndex !== 0) {
		matched = findRowByNameFrom(rows, needle, 0);
	}
	if (!matched && !replace && needle.length > 1 && text.length === 1) {
		const single = text.toLowerCase();
		const from = anchorIndex >= 0 ? anchorIndex + 1 : 0;
		matched = findRowByNameFrom(rows, single, from) ?? findRowByNameFrom(rows, single, 0);
		typeAheadBuffer = single;
	} else {
		typeAheadBuffer = needle;
	}

	if (typeAheadTimer) {
		clearTimeout(typeAheadTimer);
	}
	typeAheadTimer = setTimeout(resetTypeAhead, TYPE_AHEAD_RESET_MS);

	if (!matched) {
		return null;
	}
	selection = [matched.path];
	anchorPath = matched.path;
	renderTree();
	renderActions();
	scrollRowIntoView(matched.path);
	return matched.name;
}

/**
 * 展开/折叠。折叠只改本地状态（已读过的层级留在缓存里），展开时才请求宿主读盘。
 */
function toggle(_matcher, path) {
	if (expanded.has(path)) {
		expanded.delete(path);
		renderTree();
		return;
	}
	expanded.add(path);
	renderTree();
	if (!levels.has(path)) {
		setStatus(READING);
		requestLevel(path);
	}
}

/** 按渲染顺序摊平的可见行 —— Shift 范围选、Ctrl+A、type-ahead 都以它为准。 */
function visibleRows() {
	const out = [];
	const walk = path => {
		const level = levels.get(path);
		if (!level || level.error) {
			return;
		}
		for (const row of level.rows) {
			out.push(row);
			if (row.isDirectory && expanded.has(row.path)) {
				walk(row.path);
			}
		}
	};
	walk(config.rootPath);
	return out;
}

function findRow(path) {
	for (const level of levels.values()) {
		const found = level.rows.find(row => row.path === path);
		if (found) {
			return found;
		}
	}
	return null;
}

/** 多选：无修饰键=单选、Ctrl/Cmd=切换、Shift=从锚点连选。 */
function selectRow(row, event) {
	const paths = visibleRows().map(item => item.path);

	if (event?.shiftKey && anchorPath) {
		const from = paths.indexOf(anchorPath);
		const to = paths.indexOf(row.path);
		if (from >= 0 && to >= 0) {
			const [low, high] = from <= to ? [from, to] : [to, from];
			selection = paths.slice(low, high + 1);
			return;
		}
	}

	if (event?.ctrlKey || event?.metaKey) {
		selection = selection.includes(row.path)
			? selection.filter(path => path !== row.path)
			: [...selection, row.path];
		anchorPath = row.path;
		return;
	}

	selection = [row.path];
	anchorPath = row.path;
}

/**
 * 拖动一个**未选中**的行时把它变成唯一选中项。
 *
 * 这里刻意不重绘整棵树：dragstart 里替换掉拖拽源元素会让浏览器丢失拖拽图像，
 * 所以只同步 DOM 上的 class 与右侧操作栏。
 */
function selectOnlyForDrag(path) {
	selection = [path];
	anchorPath = path;
	for (const element of rowsElement?.querySelectorAll('.wispkit-subtree-row') ?? []) {
		const selected = element.dataset.path === path;
		element.classList.toggle('is-selected', selected);
		element.setAttribute('aria-selected', selected ? 'true' : 'false');
	}
	renderActions();
}

function renderInto(container, path, depth) {
	const level = levels.get(path);
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
		container.appendChild(makeRow(row, depth));
		if (row.isDirectory && expanded.has(row.path)) {
			renderInto(container, row.path, depth + 1);
		}
	}
}

function renderTree() {
	if (!rowsElement) {
		return;
	}
	rowsElement.textContent = '';
	renderInto(rowsElement, config.rootPath, 0);
}

function makeActionButton(options) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'wispkit-subtree-action';
	button.disabled = !options.enabled;
	button.title = options.title;
	if (options.commandId) {
		button.dataset.commandId = options.commandId;
	}
	if (options.toolIndex !== undefined) {
		button.dataset.toolIndex = String(options.toolIndex);
	}

	button.appendChild(makeIcon(options.icon));

	const label = document.createElement('span');
	label.className = 'wispkit-subtree-action-label';
	label.textContent = options.label;
	button.appendChild(label);

	if (options.badge) {
		const badge = document.createElement('span');
		badge.className = 'wispkit-subtree-action-badge';
		badge.textContent = options.badge;
		button.appendChild(badge);
	}

	button.addEventListener('click', () => options.onClick(button));
	return button;
}

/**
 * 选中信息的唯一出口是**工具栏最右**那个完整路径。
 *
 * 右侧操作栏里原来还有一块「未选中条目 / 名称+路径」的重复展示，已去掉 ——
 * 它和工具栏说的是同一件事，挤在操作区上方反而占地方（用户反馈）。
 */
function renderSelectionInfo() {
	if (!selectedPathElement) {
		return;
	}
	if (selection.length === 0) {
		selectedPathElement.textContent = config.rootPath;
		selectedPathElement.title = config.rootPath;
	} else if (selection.length === 1) {
		selectedPathElement.textContent = selection[0];
		selectedPathElement.title = selection[0];
	} else {
		selectedPathElement.textContent = `${selection[0]}（+${selection.length - 1} 项）`;
		selectedPathElement.title = selection.join('\n');
	}
}

/** 选中项的形状 —— 与宿主 `isCommandApplicable` 的输入保持一致。 */
function selectionShape() {
	let directoryCount = 0;
	let unknown = false;
	for (const path of selection) {
		const row = findRow(path);
		if (!row) {
			unknown = true;
			continue;
		}
		if (row.isDirectory) {
			directoryCount += 1;
		}
	}
	return { count: selection.length, directoryCount, unknown };
}

/**
 * 命令对当前选中项是否适用。置灰**只看这一件事** ——
 * 不是「命令存不存在」（不存在的宿主已经过滤掉了），而是「选中的东西对不对」。
 * 例如选中一个文件时，「新建文件」「新建文件夹」不适用，必须置灰而不是照样能点。
 */
function isApplicable(command) {
	const shape = selectionShape();
	if (shape.unknown) {
		return false;
	}
	switch (command.appliesTo) {
		case 'any':
			return shape.count > 0;
		case 'single':
			return shape.count === 1;
		case 'two':
			return shape.count === 2;
		case 'folders':
			return shape.count === 0 || (shape.directoryCount === shape.count && shape.count > 0);
		case 'files':
			return shape.count > 0 && shape.directoryCount === 0;
		default:
			return false;
	}
}

const DEFAULT_DISABLED_REASON = {
	any: '请先在子树里选中条目',
	single: '需要恰好选中一个条目',
	two: '需要恰好选中两个条目',
	folders: '需要选中一个文件夹',
	files: '需要选中文件',
};

/** `title`：可用时说明这条命令对谁生效，置灰时说明为什么不能用。 */
function commandTitle(command) {
	if (command.kind === 'native') {
		return `Wispkit 文件操作（作用于子树选中项）：${command.label}`;
	}
	if (command.kind === 'builtin') {
		return `内置命令：${command.id}`;
	}
	return `来自扩展 ${command.source}：${command.id}`;
}

/** native 走自研的 fileAction 通道（宿主用 workspace.fs 直接操作选中项），其余走 executeCommand。 */
function runCommand(command, childId) {
	if (childId) {
		// 二级菜单项：目前只有「系统终端打开」，终端类型回传给宿主去选启动方式
		post({ type: 'wispkit.subtree.systemTerminal', kind: childId, paths: [...selection] });
		return;
	}
	if (command.kind === 'native') {
		post({ type: 'wispkit.subtree.fileAction', action: command.id, paths: [...selection] });
		return;
	}
	post({ type: 'wispkit.subtree.command', command: command.id, paths: [...selection] });
}

function renderCommands() {
	if (!commandsElement) {
		return;
	}
	commandsElement.textContent = '';

	const buckets = new Map();
	for (const command of config.commands) {
		const bucket = buckets.get(command.group);
		if (bucket) {
			bucket.push(command);
		} else {
			buckets.set(command.group, [command]);
		}
	}

	const groups = GROUP_ORDER.filter(group => (buckets.get(group)?.length ?? 0) > 0);
	for (const group of groups) {
		// 分组之间画分隔线（第一组不加），让「剪贴板 / 编辑 / 路径…」一眼分得开
		const block = document.createElement('div');
		block.className = 'wispkit-subtree-group';
		block.dataset.group = group;

		const title = document.createElement('div');
		title.className = 'wispkit-subtree-group-title';
		title.textContent = GROUP_LABELS[group] ?? group;
		block.appendChild(title);

		for (const command of buckets.get(group)) {
			const enabled = isApplicable(command);
			const hasChildren = Array.isArray(command.children) && command.children.length > 0;
			let buttonTitle = commandTitle(command);
			if (enabled) {
				if (command.id === 'wispkit.subtree.paste' && config.clipboard) {
					buttonTitle += `（${config.clipboard}）`;
				}
				if (hasChildren) {
					buttonTitle += '（点击选择具体类型）';
				}
			} else {
				buttonTitle = `${command.label} 不可用：`
					+ `${command.disabledReason || DEFAULT_DISABLED_REASON[command.appliesTo] || '当前选中状态不适用'}`;
			}

			block.appendChild(makeActionButton({
				icon: command.icon || 'action',
				label: command.label,
				// 不再挂来源徽标：右侧那个名称是重复信息（用户反馈），来源改由 title 说明
				title: buttonTitle,
				commandId: command.id,
				enabled,
				// 有子项的按钮不给它自己的动作，点了就地展开与右键菜单同一份子项
				onClick: button => {
					if (hasChildren) {
						const rect = button.getBoundingClientRect();
						contextMenu.open(commandChildItems(command), rect.left, rect.bottom + 2);
						return;
					}
					runCommand(command);
				},
			}));
		}

		commandsElement.appendChild(block);
	}
}

function renderTools() {
	if (!toolsElement) {
		return;
	}
	toolsElement.textContent = '';

	// 没配置工具就整块消失，而不是留一句「未配置」占地方
	if (toolsSection) {
		toolsSection.hidden = config.tools.length === 0;
	}
	if (config.tools.length === 0) {
		return;
	}

	config.tools.forEach((tool, index) => {
		toolsElement.appendChild(makeActionButton({
			icon: 'terminal',
			label: tool.label,
			badge: tool.shell,
			title: `${tool.command}（执行方式：${tool.shell}）`,
			toolIndex: index,
			enabled: selection.length > 0,
			onClick: () => post({ type: 'wispkit.subtree.tool', index, paths: [...selection] }),
		}));
	});
}

function renderActions() {
	renderSelectionInfo();
	renderCommands();
	renderTools();

	// 「展开一层」也跟着选中项置灰：选中文件时它没有意义
	const expandButton = document.getElementById('wispkit-subtree-expand-root');
	if (expandButton) {
		const applicable = expandButtonApplicable();
		expandButton.disabled = !applicable;
		expandButton.title = applicable
			? '展开/收起子树里选中文件夹的直接子层级（已全部展开的会收起；可多选；没有选中时作用于根目录）'
			: '展开一层 不可用：选中的是文件，请改选文件夹或取消选中';
	}

	const commandCount = document.getElementById('wispkit-subtree-command-count');
	const toolCount = document.getElementById('wispkit-subtree-tool-count');
	if (commandCount) {
		commandCount.textContent = String(config.commands.length);
	}
	if (toolCount) {
		toolCount.textContent = String(config.tools.length);
	}
}

/* ---------------------------------------------------------------- 右键菜单 */

/**
 * 右键菜单与右侧操作栏共用同一份 `config.commands`，所以**每个条目**都能
 * 在这里找到右侧那些操作，并显示同样的图标。
 *
 * 与操作栏的唯一差别在 `folders` 类命令：右键一个文件时，新建 / 粘贴仍然
 * 有意义（宿主的 createEntry / pasteInto 会落到该文件的父目录），所以这里
 * 不为「选中的是文件」置灰 —— 否则右键菜单就比右侧少了整组操作。
 */
function isApplicableForContext(command) {
	const shape = selectionShape();
	if (shape.unknown) {
		return false;
	}
	if (command.appliesTo === 'folders') {
		return true;
	}
	return isApplicable(command);
}

/** 二级菜单项：右键菜单与右侧操作栏共用同一份，保证两处展开的子项一模一样。 */
function commandChildItems(command) {
	return (command.children || []).map(child => ({
		label: child.label,
		icon: command.icon || 'action',
		title: child.description || child.label,
		run: () => runCommand(command, child.id),
	}));
}

function contextCommandItem(command) {
	const enabled = isApplicableForContext(command);
	const hasChildren = Array.isArray(command.children) && command.children.length > 0;
	let title = commandTitle(command);
	if (enabled) {
		if (command.id === 'wispkit.subtree.paste' && config.clipboard) {
			title += `（${config.clipboard}）`;
		}
		if (hasChildren) {
			title += '（展开选择具体类型）';
		}
	} else {
		title = `${command.label} 不可用：`
			+ `${command.disabledReason || DEFAULT_DISABLED_REASON[command.appliesTo] || '当前选中状态不适用'}`;
	}
	if (hasChildren) {
		return {
			label: command.label,
			icon: command.icon || 'action',
			title,
			disabled: !enabled,
			children: commandChildItems(command),
		};
	}
	return {
		label: command.label,
		icon: command.icon || 'action',
		title,
		disabled: !enabled,
		run: () => runCommand(command),
	};
}

function contextToolItems() {
	return config.tools.map((tool, index) => ({
		label: tool.label,
		icon: 'terminal',
		badge: tool.shell,
		title: `${tool.command}（执行方式：${tool.shell}）`,
		disabled: selection.length === 0,
		run: () => post({ type: 'wispkit.subtree.tool', index, paths: [...selection] }),
	}));
}

function buildContextMenuItems(row) {
	const items = [];

	if (row) {
		if (row.isDirectory) {
			const isExpanded = expanded.has(row.path);
			items.push({
				label: isExpanded ? '折叠' : '展开',
				icon: isExpanded ? 'collapse-all' : 'expand-all',
				title: row.path,
				run: () => toggle(path => path === row.path, row.path),
			});
			items.push({
				label: '展开一层',
				icon: 'expand-all',
				title: `展开 ${row.path} 的直接子文件夹`,
				run: () => expandOneLevel(row.path),
			});
		} else {
			items.push({
				label: '打开',
				icon: iconFor(row),
				title: row.path,
				run: () => post({ type: 'wispkit.subtree.open', path: row.path }),
			});
		}
		items.push({ separator: true });
	} else {
		items.push({ label: '刷新', icon: 'refresh', run: refreshTree });
		items.push({ label: '展开一层', icon: 'expand-all', title: '展开根目录的直接子文件夹', run: () => expandOneLevel(config.rootPath) });
		items.push({ label: '全部折叠', icon: 'collapse-all', run: collapseAllTree });
		items.push({ separator: true });
	}

	const buckets = new Map();
	for (const command of config.commands) {
		const bucket = buckets.get(command.group);
		if (bucket) {
			bucket.push(command);
		} else {
			buckets.set(command.group, [command]);
		}
	}
	let firstGroup = true;
	for (const group of GROUP_ORDER) {
		const commands = buckets.get(group);
		if (!commands || commands.length === 0) {
			continue;
		}
		if (!firstGroup) {
			items.push({ separator: true });
		}
		firstGroup = false;
		for (const command of commands) {
			items.push(contextCommandItem(command));
		}
	}

	const tools = contextToolItems();
	if (tools.length > 0) {
		items.push({ separator: true });
		items.push(...tools);
	}

	return items;
}

function openContextMenu(row, x, y) {
	if (row && !isSelected(row.path)) {
		// 与资源管理器一致：右键未选中项 = 先把它变成当前选中项
		selection = [row.path];
		anchorPath = row.path;
		renderTree();
		renderActions();
	} else if (!row) {
		// 右键空白处 = 操作根目录
		selection = [];
		anchorPath = null;
		renderTree();
		renderActions();
	}
	return contextMenu.open(buildContextMenuItems(row), x, y);
}

/**
 * 「展开一层」：对**选中的文件夹**生效；没选中（或选的是文件）时回退到根目录。
 *
 * 这是**切换**语义：目标文件夹的直接子文件夹若已全部展开，再点一次就收起它们；否则展开。
 * 多选时对每个选中文件夹**各自**切换，而不是按多数状态统一 —— 展开状态本来就是逐条独立的，
 * 逐个切换最贴合"点它就是要翻它一下"的直觉，也不会因为其中一个已展开就把其余的一起收掉。
 *
 * 收起时**不移除后代**的展开记录（与 `toggle` 一致：折叠只改可见性，已读缓存与原状态都留着），
 * 所以重新展开父级时下层的展开状态仍是用户上次看到的样子。
 */
function expandOneLevel(targetPath) {
	const level = levels.get(targetPath);
	if (!level) {
		pendingExpand.add(targetPath);
		setStatus(READING);
		requestLevel(targetPath);
		return;
	}

	const childFolders = level.rows.filter(row => row.isDirectory);
	if (childFolders.length === 0) {
		// 没有子文件夹可展开/收起：不做任何状态改动，避免"点了没反应像是坏了"
		renderTree();
		return;
	}

	const allExpanded = childFolders.every(row => expanded.has(row.path));
	for (const row of childFolders) {
		if (allExpanded) {
			expanded.delete(row.path);
		} else {
			expanded.add(row.path);
			if (!levels.has(row.path)) {
				requestLevel(row.path);
			}
		}
	}
	renderTree();
}

function refreshTree() {
	levels.clear();
	expanded.clear();
	pendingExpand.clear();
	renderTree();
	setStatus(READING);
	requestLevel(config.rootPath);
}

function collapseAllTree() {
	expanded.clear();
	pendingExpand.clear();
	renderTree();
}

document.getElementById('wispkit-subtree-refresh')?.addEventListener('click', refreshTree);
document.getElementById('wispkit-subtree-collapse-all')?.addEventListener('click', collapseAllTree);

document.getElementById('wispkit-subtree-dnd-help')?.addEventListener('click', () => {
	setStatus('拖入：文件会问「复制 / 移动」，文本、HTML、图片等会问存储类型和名称；从系统资源管理器直接拖文件进来即可（不需要按 Shift）。树内拖动条目时按住 Ctrl 再拖 = 直接移动（不再询问）；左右两个子树面板之间互拖同样适用。拖出：指针拖到窗口外松手 = 复制 / 移动到光标下的资源管理器窗口（按住 Ctrl = 移动），找不到窗口时放入剪贴板。右键任意条目或空白处可打开与右侧操作栏相同的文件操作菜单（带图标）。');
});

/**
 * 「展开一层」的对象是**子树表格里选中的文件夹**（支持多选）。
 *
 * 没有选中时退回根目录 —— 首屏还没点任何条目时这个按钮仍然有用。
 * 选中的全是文件时**不适用**（对文件「展开一层」没有意义），按钮置灰。
 */
function expandTargets() {
	const folders = selection
		.map(path => findRow(path))
		.filter(row => row?.isDirectory)
		.map(row => row.path);
	return folders.length > 0 ? folders : [config.rootPath];
}

function expandButtonApplicable() {
	return selection.every(path => findRow(path)?.isDirectory === true) || selection.length === 0;
}

document.getElementById('wispkit-subtree-expand-root')?.addEventListener('click', () => {
	if (!expandButtonApplicable()) {
		return;
	}
	for (const target of expandTargets()) {
		expandOneLevel(target);
	}
});

window.addEventListener('message', event => {
	const message = event.data;
	if (!message || typeof message !== 'object') {
		return;
	}
	if (message.type === 'wispkit.subtree.level') {
		setStatus('');
		applyLevel(message.path, message.rows, message.error, message.icons);
	} else if (message.type === 'wispkit.subtree.config') {
		applyConfig(message.config);
	} else if (message.type === 'wispkit.subtree.status') {
		setStatus(message.message, message.kind);
	}
});

/* ---------------------------------------------------------------- 键盘：Ctrl+A 全选、字母跳转 */

/*
 * 输入法：组合期间的 keydown 全都是 key === 'Process'，单字符过滤会把它挡掉；
 * 落字那一刻才有可用的文本，用 compositionend 接住它，中文文件名因此也能跳。
 */
document.addEventListener('compositionstart', () => {
	typeAheadComposing = true;
});

document.addEventListener('compositionend', event => {
	typeAheadComposing = false;
	const text = typeof event.data === 'string' ? event.data : '';
	if (text) {
		applyTypeAhead(text, { replace: true });
	}
});

document.addEventListener('keydown', event => {
	if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'a') {
		event.preventDefault();
		selection = visibleRows().map(row => row.path);
		anchorPath = selection[0] ?? null;
		renderTree();
		renderActions();
		return;
	}

	if (event.ctrlKey || event.metaKey || event.altKey) {
		return;
	}
	if (typeAheadComposing) {
		return;
	}
	if (event.key.length !== 1 || !/\S/.test(event.key)) {
		return;
	}

	const matched = applyTypeAhead(event.key);
	if (!matched) {
		return;
	}
	event.preventDefault();
});

/* ---------------------------------------------------------------- 列宽：拖拽 + 双击复位 + 记忆 */

const DEFAULT_COLUMN_WIDTHS = {};
for (const column of config.columns) {
	DEFAULT_COLUMN_WIDTHS[column.id] = column.width;
}
const WIDTH_STORAGE_KEY = 'wispkit.subtree.columnWidths';
const MIN_COLUMN_WIDTH = 48;

function storedColumnWidths() {
	try {
		const parsed = JSON.parse(window.localStorage?.getItem(WIDTH_STORAGE_KEY) || '{}');
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function saveColumnWidths(widths) {
	try {
		window.localStorage?.setItem(WIDTH_STORAGE_KEY, JSON.stringify(widths));
	} catch {
		// 存不了就算了，不影响使用
	}
}

/** 当前生效的列宽。存内存而不回读 CSS 变量：jsdom 不解析自定义属性，回读会拿到空值。 */
const columnWidths = { ...DEFAULT_COLUMN_WIDTHS };

function applyColumnWidth(id, width) {
	const clamped = Math.max(MIN_COLUMN_WIDTH, Math.round(Number(width) || MIN_COLUMN_WIDTH));
	columnWidths[id] = clamped;
	document.documentElement.style.setProperty(`--wispkit-col-${id}`, `${clamped}px`);
	return clamped;
}

function defaultWidthOf(id) {
	return DEFAULT_COLUMN_WIDTHS[id];
}

function currentColumnWidth(id) {
	return columnWidths[id] ?? defaultWidthOf(id) ?? 120;
}

for (const [id, width] of Object.entries(storedColumnWidths())) {
	if (defaultWidthOf(id) !== undefined && Number.isFinite(Number(width))) {
		applyColumnWidth(id, Number(width));
	}
}

headerElement?.addEventListener('pointerdown', event => {
	const handle = event.target?.closest?.('.wispkit-subtree-resize');
	if (!handle) {
		return;
	}

	const id = handle.dataset.column;
	if (!id) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	const startX = event.clientX;
	const startWidth = currentColumnWidth(id);
	handle.setPointerCapture?.(event.pointerId);
	handle.classList.add('is-dragging');

	const onMove = moveEvent => {
		const width = Math.max(MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX));
		applyColumnWidth(id, width);
	};
	const onUp = () => {
		handle.classList.remove('is-dragging');
		handle.removeEventListener('pointermove', onMove);
		handle.removeEventListener('pointerup', onUp);
		handle.removeEventListener('pointercancel', onUp);
		saveColumnWidths({ ...storedColumnWidths(), [id]: currentColumnWidth(id) });
	};

	handle.addEventListener('pointermove', onMove);
	handle.addEventListener('pointerup', onUp);
	handle.addEventListener('pointercancel', onUp);
});

headerElement?.addEventListener('dblclick', event => {
	const handle = event.target?.closest?.('.wispkit-subtree-resize');
	if (!handle) {
		return;
	}
	const id = handle.dataset.column;
	const fallback = defaultWidthOf(id);
	if (!id || fallback === undefined) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	applyColumnWidth(id, fallback);
	const widths = storedColumnWidths();
	delete widths[id];
	saveColumnWidths(widths);
});

/* ---------------------------------------------------------------- 操作栏宽度 */

const DEFAULT_ACTIONS_WIDTH = 240;
const MIN_ACTIONS_WIDTH = 160;
const STORAGE_KEY = 'wispkit.subtree.actionsWidth';

function applyActionsWidth(width) {
	actionsElement?.style.setProperty('width', `${width}px`);
}

function storedActionsWidth() {
	try {
		const value = Number(window.localStorage?.getItem(STORAGE_KEY));
		return Number.isFinite(value) && value >= MIN_ACTIONS_WIDTH ? value : DEFAULT_ACTIONS_WIDTH;
	} catch {
		return DEFAULT_ACTIONS_WIDTH;
	}
}

function saveActionsWidth(width) {
	try {
		window.localStorage?.setItem(STORAGE_KEY, String(Math.round(width)));
	} catch {
		// 存不了就算了，不影响使用
	}
}

if (splitter && actionsElement) {
	applyActionsWidth(storedActionsWidth());

	let dragging = false;
	splitter.addEventListener('pointerdown', event => {
		dragging = true;
		splitter.classList.add('is-dragging');
		splitter.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	});
	splitter.addEventListener('pointermove', event => {
		if (!dragging) {
			return;
		}
		const main = document.getElementById('wispkit-subtree-main') ?? splitter.parentElement;
		const right = main ? main.getBoundingClientRect().right : window.innerWidth;
		const width = Math.max(MIN_ACTIONS_WIDTH, Math.min(right - event.clientX, (main?.clientWidth ?? 800) - 200));
		applyActionsWidth(width);
	});
	const stopDragging = () => {
		if (!dragging) {
			return;
		}
		dragging = false;
		splitter.classList.remove('is-dragging');
		saveActionsWidth(actionsElement.getBoundingClientRect().width || DEFAULT_ACTIONS_WIDTH);
	};
	splitter.addEventListener('pointerup', stopDragging);
	splitter.addEventListener('pointercancel', stopDragging);
	splitter.addEventListener('dblclick', () => {
		applyActionsWidth(DEFAULT_ACTIONS_WIDTH);
		saveActionsWidth(DEFAULT_ACTIONS_WIDTH);
	});
}

/* ---------------------------------------------------------------- 拖入：树区域接收 drop */

const treeElement = document.getElementById('wispkit-subtree-tree');
if (treeElement) {
	treeElement.addEventListener('contextmenu', event => {
		// 表头用于排序 / 调列宽，拥有自己的鼠标语义，不弹文件操作菜单
		if (event.target?.closest?.('.wispkit-subtree-header')) {
			return;
		}
		event.preventDefault();
		const rowElement = event.target?.closest?.('.wispkit-subtree-row') ?? null;
		const row = rowElement ? findRow(rowElement.dataset.path) : null;
		openContextMenu(row, event.clientX, event.clientY);
	});

	treeElement.addEventListener('dragover', event => {
		if (!event.dataTransfer) {
			return;
		}
		event.preventDefault();
		const moveHint = isMoveDrag(event);
		// 内部拖拽按 Ctrl 时给「移动」光标与绿色高亮；外部拖入（Ctrl 在资源管理器里是复制）维持复制
		event.dataTransfer.dropEffect = moveHint ? 'move' : 'copy';
		const rowElement = event.target?.closest?.('.wispkit-subtree-row');
		// 顺序要紧：highlightDropTarget 内部会先 clearDropHighlight（会摘掉 is-move-drop）
		highlightDropTarget(rowElement ? findRow(rowElement.dataset.path) : null);
		treeElement.classList.toggle('is-move-drop', moveHint);
	});
	treeElement.addEventListener('dragleave', event => {
		if (!treeElement.contains(event.relatedTarget)) {
			clearDropHighlight();
		}
	});
	treeElement.addEventListener('drop', event => {
		void handleDrop(event);
	});

	/*
	 * 系统文件拖入：VS Code 的 webview pre script 会在 dragenter 时把 iframe 设为
	 * pointer-events:none，把整次拖拽转交工作台（默认当成「拖文件到编辑器」），
	 * 扩展原本收不到 drop —— 除非用户按 Shift。
	 *
	 * 那个 pre script 的监听器挂在 window 的**冒泡**阶段，而且它的 dragenter 会先看
	 * defaultPrevented。这里在 document 的**捕获**阶段先 preventDefault + stopPropagation：
	 * - dragenter 的 defaultPrevented 让 pre script 直接 return，不再通知宿主禁用 iframe；
	 * - stopPropagation 让 dragover / drop 到不了 window 上的 pre script，也就不会发
	 *   'drag' 消息让工作台再次把 iframe 的 pointer-events 关掉。
	 * 事件被截在 document 捕获阶段，不会再走到树元素的监听器，所以高亮与 drop 处理
	 * 在这里按同样的规则复刻一份。
	 *
	 * 只拦截「带 Files 的纯文件拖拽」；树内拖动、从 VS Code 资源管理器拖入的
	 * uri-list 拖拽仍走原来的树监听器。
	 */
	const isExternalFileDrag = event => dragTypes(event?.dataTransfer).includes('files');
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
		const rowElement = event.target?.closest?.('.wispkit-subtree-row');
		highlightDropTarget(rowElement ? findRow(rowElement.dataset.path) : null);
		treeElement.classList.toggle('is-move-drop', false);
	}, true);
	document.addEventListener('drop', event => {
		if (!isExternalFileDrag(event)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		void handleDrop(event);
	}, true);

	// 拖到窗口外松手时不一定有 row 级 dragend（元素可能已被移除），统一兜底清状态
	window.addEventListener('dragend', () => {
		dragSession = null;
		clearDropHighlight();
		for (const element of rowsElement?.querySelectorAll('.is-dragging') ?? []) {
			element.classList.remove('is-dragging');
		}
		if (statusElement?.textContent?.startsWith('正在拖动')) {
			setStatus('');
		}
	});
}

/** 供自动化验证读取：断言项不依赖人眼。 */
Object.defineProperty(window, '__wispkitSelftest', {
	value: {
		columns: () => config.columns.map(column => column.id),
		headers: () => Array.from(headerElement?.querySelectorAll('.wispkit-subtree-cell') ?? []).map(cell => {
			const label = cell.querySelector('.wispkit-subtree-header-label');
			return label ? label.textContent : cell.textContent;
		}),
		rows: () => Array.from(rowsElement?.querySelectorAll('.wispkit-subtree-row') ?? []).map(row => ({
			path: row.dataset.path,
			depth: Number(row.dataset.depth),
			// 名称格里还塞了展开箭头和图标，取值时只取文件名那一段
			cells: Array.from(row.querySelectorAll('.wispkit-subtree-cell')).map(cell => {
				const name = cell.querySelector('.wispkit-subtree-name');
				return name ? name.textContent : cell.textContent;
			}),
		})),
		rowCount: () => rowsElement?.querySelectorAll('.wispkit-subtree-row').length ?? 0,
		commandLabels: () => Array.from(commandsElement?.querySelectorAll('.wispkit-subtree-action') ?? []).map(button => button.textContent),
		toolLabels: () => Array.from(toolsElement?.querySelectorAll('.wispkit-subtree-action') ?? []).map(button => button.textContent),
		select: path => {
			selection = path ? [path] : [];
			anchorPath = path || null;
			renderTree();
			renderActions();
			return selection[0] ?? null;
		},
		/** 多选（等价于 Ctrl 点选若干条）：用于验证批量操作的对象是不是"表格里选中的那些"。 */
		selectMany: paths => {
			selection = [...paths];
			anchorPath = paths[paths.length - 1] ?? null;
			renderTree();
			renderActions();
			return selection.length;
		},
		selectedPath: () => selection[0] ?? null,
		selectedPaths: () => [...selection],
		selectedPathText: () => selectedPathElement?.textContent ?? '',
		expand: path => {
			expanded.add(path);
			renderTree();
			return expanded.has(path);
		},
		collapse: path => {
			expanded.delete(path);
			renderTree();
			return expanded.has(path);
		},
		collapsedCount: () => expanded.size,
		/** 测试用：直接把宿主回包塞进来，不必真的往返消息。 */
		applyLevel,
		applyConfig: next => {
			applyConfig(next);
		},
		status: () => statusElement?.textContent ?? '',
		actionsWidth: () => Math.round(actionsElement?.getBoundingClientRect().width ?? 0),
		rootPath: () => config.rootPath,

		// —— 排序 ——
		sortState: () => ({ ...sortState }),
		sortBy: key => {
			toggleSort(key);
			return { ...sortState };
		},
		sortIndicator: () => {
			const cell = headerElement?.querySelector('.wispkit-subtree-cell[data-sorted]');
			if (!cell) {
				return null;
			}
			const use = cell.querySelector('.wispkit-subtree-sort-indicator use');
			return { column: cell.dataset.column, direction: cell.dataset.sorted, icon: use?.getAttribute('href') ?? '' };
		},

		// —— 多选 ——
		selectWithModifiers: (path, modifiers = {}) => {
			const row = findRow(path);
			if (!row) {
				return null;
			}
			selectRow(row, modifiers);
			renderTree();
			renderActions();
			return [...selection];
		},
		selectAll: () => {
			selection = visibleRows().map(row => row.path);
			anchorPath = selection[0] ?? null;
			renderTree();
			renderActions();
			return [...selection];
		},
		selectedRowCount: () => rowsElement?.querySelectorAll('.wispkit-subtree-row.is-selected').length ?? 0,

		// —— type-ahead ——
		typeAhead: text => applyTypeAhead(text, { replace: true }),
		/** 键盘路径：按单个字符累积（与 keydown 完全同一条逻辑）。 */
		typeAheadKey: key => applyTypeAhead(key),
		typeAheadBuffer: () => typeAheadBuffer,

		// —— 分组 / 图标 / 工具区 ——
		commandGroups: () => Array.from(commandsElement?.querySelectorAll('.wispkit-subtree-group') ?? []).map(block => ({
			group: block.dataset.group,
			title: block.querySelector('.wispkit-subtree-group-title')?.textContent ?? '',
			labels: Array.from(block.querySelectorAll('.wispkit-subtree-action-label')).map(label => label.textContent),
		})),
		actionIcons: () => Array.from(commandsElement?.querySelectorAll('.wispkit-subtree-action use') ?? [])
			.map(use => use.getAttribute('href')),
		toolsSectionHidden: () => Boolean(toolsSection?.hidden),

		// —— 列宽 ——
		columnWidths: () => Object.fromEntries(config.columns.map(column => [column.id, Math.round(currentColumnWidth(column.id))])),
		setColumnWidth: (id, width) => {
			applyColumnWidth(id, width);
			saveColumnWidths({ ...storedColumnWidths(), [id]: Math.round(currentColumnWidth(id)) });
			return Math.round(currentColumnWidth(id));
		},
		storedColumnWidths: () => storedColumnWidths(),
		resetColumnWidth: id => {
			applyColumnWidth(id, defaultWidthOf(id) ?? 120);
			const widths = storedColumnWidths();
			delete widths[id];
			saveColumnWidths(widths);
			return Math.round(currentColumnWidth(id));
		},

		// —— 「展开一层」 ——
		expandOneLevel: path => {
			expandOneLevel(path ?? config.rootPath);
			return expanded.size;
		},
		expandSelected: () => {
			// 与按钮点击走同一条判断：不适用的选中（例如选中了文件）不展开任何东西
			const applicable = expandButtonApplicable();
			const targets = applicable ? expandTargets() : [];
			for (const target of targets) {
				expandOneLevel(target);
			}
			return {
				applicable,
				target: targets[0] ?? null,
				targets,
				expanded: expanded.size,
				disabled: Boolean(document.getElementById('wispkit-subtree-expand-root')?.disabled),
			};
		},
		expandedPaths: () => Array.from(expanded),

		// —— 右键菜单 ——
		contextMenu: () => ({
			open: contextMenu.isOpen,
			labels: contextMenu.labels,
			icons: contextMenu.icons,
			disabled: contextMenu.disabledLabels,
			/** 带子项的条目（右键时展开二级菜单的那些）。 */
			submenus: Array.from(document.querySelectorAll('.wispkit-menu .wispkit-menu-item.has-submenu'))
				.map(item => item.querySelector('.wispkit-menu-label')?.textContent ?? ''),
			submenuLabels: contextMenu.submenuLabels,
		}),
		openContextMenu: (path, x = 12, y = 12) => {
			const row = path ? findRow(path) : null;
			if (path && !row) {
				return false;
			}
			return openContextMenu(row, x, y);
		},
		clickContextMenu: label => contextMenu.click(label),
		openContextSubmenu: label => contextMenu.openSubmenu(label),
		clickContextSubmenu: label => contextMenu.clickInSubmenu(label),
		closeContextMenu: () => contextMenu.close(),

		// —— 拖拽 ——
		toFileUrl,
		dragPayloadFor: paths => dragPayloadForRows(paths.map(path => findRow(path)).filter(Boolean)),
		dropTargetFor: path => dropTargetForRow(path ? findRow(path) : null),
		/** 模拟一次 drop：不必真的构造 DataTransfer，方便单测消息形状。 */
		simulateDrop: async (targetPath, options = {}) => {
			lastMessage = null;
			const row = findRow(targetPath);
			const strings = options.strings ?? [];
			const files = options.files ?? [];
			const dataTransfer = {
				types: options.types ?? strings.map(item => item.mime),
				items: [
					...strings.map(item => ({
						kind: 'string',
						type: item.mime,
						getAsString: callback => callback(item.text),
					})),
					...files.map(item => {
						const bytes = item.bytes ?? new Uint8Array(0);
						return {
							kind: 'file',
							type: item.mime,
							getAsFile: () => ({
								name: item.name,
								type: item.mime,
								size: bytes.byteLength,
								lastModified: 0,
								arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
							}),
						};
					}),
				],
				files: [],
			};
			await handleDrop({
				preventDefault() {},
				stopPropagation() {},
				shiftKey: Boolean(options.shiftKey),
				ctrlKey: Boolean(options.ctrlKey),
				metaKey: Boolean(options.metaKey),
				target: row ? { closest: () => ({ dataset: { path: row.path } }) } : { closest: () => null },
				dataTransfer,
			});
			return lastMessage;
		},
		/** 当前是否有本页发起的拖拽会话（dragstart → drop/dragend）。 */
		dragSession: () => {
			const session = activeDragSession();
			return session ? { moveModifier: session.moveModifier } : null;
		},

		// —— 批量操作消息 ——
		lastMessage: () => lastMessage,
		clickCommandByLabel: label => {
			const button = Array.from(commandsElement?.querySelectorAll('.wispkit-subtree-action') ?? [])
				.find(item => item.querySelector('.wispkit-subtree-action-label')?.textContent === label);
			button?.click();
			return Boolean(button);
		},
		clickToolByLabel: label => {
			const button = Array.from(toolsElement?.querySelectorAll('.wispkit-subtree-action') ?? [])
				.find(item => item.querySelector('.wispkit-subtree-action-label')?.textContent === label);
			button?.click();
			return Boolean(button);
		},
	},
});

renderHeader();
renderActions();
renderTree();
if (config.rootPath) {
	setStatus(READING);
	requestLevel(config.rootPath);
}
