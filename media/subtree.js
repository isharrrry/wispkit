/**
 * 子树浏览前端。纯自包含 ESM —— 宿主用 `<script type="module" src="media/subtree.js" nonce=...>`
 * 直接引它，不经 esbuild 打包（也就没有 dist 产物）。
 *
 * 树的观感对齐资源管理器：紧凑行、懒加载展开、多列（列由宿主按配置下发）。
 * 单元格文本与**排序**都由宿主负责（它有原始 size/mtime，前端只有格式化文本），
 * 前端只做摆放、选择与交互。
 */

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
/** 最后一条发出的消息，供自动化断言「批量操作真的带上了所有选中项」。 */
let lastMessage = null;

function post(message) {
	lastMessage = message;
	hostApi?.postMessage(message);
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

function applyLevel(path, rows, error) {
	levels.set(path, { rows: Array.isArray(rows) ? rows : [], error: error ?? undefined });
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

/** 条目图标：能用主题就用主题（与资源管理器一致），否则回退自绘。 */
function makeItemIcon(row, className) {
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

	return element;
}

function scrollRowIntoView(path) {
	const element = Array.from(rowsElement?.querySelectorAll('.wispkit-subtree-row') ?? [])
		.find(row => row.dataset.path === path);
	element?.scrollIntoView?.({ block: 'nearest' });
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

	button.addEventListener('click', () => options.onClick());
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
		default:
			return false;
	}
}

const DEFAULT_DISABLED_REASON = {
	any: '请先在子树里选中条目',
	single: '需要恰好选中一个条目',
	two: '需要恰好选中两个条目',
	folders: '需要选中一个文件夹',
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
function runCommand(command) {
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
			let buttonTitle = commandTitle(command);
			if (enabled) {
				if (command.id === 'wispkit.subtree.paste' && config.clipboard) {
					buttonTitle += `（${config.clipboard}）`;
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
				onClick: () => runCommand(command),
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

document.getElementById('wispkit-subtree-refresh')?.addEventListener('click', () => {
	levels.clear();
	expanded.clear();
	pendingExpand.clear();
	renderTree();
	setStatus(READING);
	requestLevel(config.rootPath);
});

document.getElementById('wispkit-subtree-collapse-all')?.addEventListener('click', () => {
	expanded.clear();
	pendingExpand.clear();
	renderTree();
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
		applyLevel(message.path, message.rows, message.error);
	} else if (message.type === 'wispkit.subtree.config') {
		applyConfig(message.config);
	} else if (message.type === 'wispkit.subtree.status') {
		setStatus(message.message, message.kind);
	}
});

/* ---------------------------------------------------------------- 键盘：Ctrl+A 全选、字母跳转 */

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
	if (event.key.length !== 1 || !/\S/.test(event.key)) {
		return;
	}

	typeAheadBuffer += event.key.toLowerCase();
	if (typeAheadTimer) {
		clearTimeout(typeAheadTimer);
	}
	typeAheadTimer = setTimeout(() => {
		typeAheadBuffer = '';
	}, 700);

	const match = visibleRows().find(row => row.name.toLowerCase().startsWith(typeAheadBuffer));
	if (!match) {
		return;
	}

	event.preventDefault();
	selection = [match.path];
	anchorPath = match.path;
	renderTree();
	renderActions();
	scrollRowIntoView(match.path);
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
		typeAhead: text => {
			typeAheadBuffer = text.toLowerCase();
			const match = visibleRows().find(row => row.name.toLowerCase().startsWith(typeAheadBuffer));
			if (match) {
				selection = [match.path];
				anchorPath = match.path;
				renderTree();
				renderActions();
			}
			return match ? match.name : null;
		},
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
