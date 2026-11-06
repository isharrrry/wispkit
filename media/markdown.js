import { createContextMenu } from './shared/contextmenu.js';
import { createLightbox } from './shared/lightbox.js';
import { installLinkRouter } from './shared/links.js';
import {
	blockStartLine,
	countLines,
	fenceSpanInRange,
	findBlockSpan,
	mapBlocksToSpans,
	pickPendingSourceLine,
	replaceParagraphVerbatim,
	sliceParagraphVerbatim,
} from './shared/paragraph.js';
import { createFinder } from './shared/find.js';
import { createPageZoom } from './shared/pagezoom.js';
import { createTableOfContents } from './shared/toc.js';

function readConfig() {
	const meta = document.getElementById('wispkit-config');
	if (!meta) {
		return {};
	}
	try {
		return JSON.parse(meta.dataset.wispkit || '{}');
	} catch {
		return {};
	}
}

/**
 * 第三方 Markdown 预览脚本（例如内置 mermaid 扩展的 `markdown-preview-out/index.js`）
 * 监听的是 **window** 上的这个事件：window.addEventListener("vscode.markdown.updateContent", init)
 * 所以每次内容变化都要在 window 上派发一次。
 */
function notifyPreviewScripts() {
	window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'));
}

// acquireVsCodeApi 只能取一次；取不到（例如单测里直接 import）就退化成纯前端模式
let hostApi = null;
try {
	hostApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
} catch {
	hostApi = null;
}

/**
 * 少量界面状态（目录栏宽度 / 是否收纳）跨会话记住。
 * localStorage 在 webview 里可能被隔离，因此同时镜像到 webview 自身的 state。
 */
const storage = {
	get(key) {
		try {
			const value = window.localStorage?.getItem(key);
			if (typeof value === 'string' && value !== '') {
				return value;
			}
		} catch {
			// 忽略存储不可用
		}
		try {
			const value = hostApi?.getState?.()?.[key];
			return typeof value === 'string' ? value : null;
		} catch {
			return null;
		}
	},
	set(key, value) {
		try {
			window.localStorage?.setItem(key, value);
		} catch {
			// 忽略存储不可用
		}
		try {
			hostApi?.setState?.({ ...(hostApi.getState?.() ?? {}), [key]: value });
		} catch {
			// 忽略存储不可用
		}
	},
};

/* ---------------------------------------------------------------- 主题三态 */

/**
 * `light` / `auto` / `dark` —— 顺序就是工具栏里从左到右的三个图标。
 *
 * `auto` 完全跟随 VS Code 当前颜色主题；另外两个是**强制**明暗，靠
 * `media/markdown.css` 里 `html.wispkit-theme-*` 覆盖 `--vscode-*` 变量。
 *
 * 状态是**全局**的：由宿主存在 `globalState` 并广播给所有 Markdown webview。
 * webview 自己的 `localStorage` / `state` 按面板隔离，做得到「当前文档记住」，
 * 做不到用户要的「对所有 md 文档生效」。
 */
const THEME_MODES = ['light', 'auto', 'dark'];
const DEFAULT_THEME_MODE = 'auto';
/** webview 宿主写在 body 上的明暗类别（VS Code pre/index.html 的 applyStyles）。 */
const HOST_THEME_CLASSES = ['vscode-light', 'vscode-dark', 'vscode-high-contrast', 'vscode-high-contrast-light'];

function isThemeMode(value) {
	return THEME_MODES.includes(value);
}

function normalizeThemeMode(value) {
	return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
}

function readHostThemeKind() {
	const kind = document.body?.dataset?.vscodeThemeKind;
	return typeof kind === 'string' ? kind : '';
}

/** 首屏模式来自服务端写在 `<html data-wispkit-theme>` 上的值（避免先闪一下再跳）。 */
let themeMode = normalizeThemeMode(document.documentElement?.dataset?.wispkitTheme);
/** 宿主真实的明暗类别；强制模式会临时改掉 body 的类，切回「跟随」时靠它还原。 */
let hostThemeKind = readHostThemeKind();

function forcedBodyClass(mode) {
	return mode === 'light' ? 'vscode-light' : mode === 'dark' ? 'vscode-dark' : null;
}

/**
 * 强制模式要连 body 的明暗类别一起改：内置 `markdown.css` 仍按
 * `.vscode-light` / `.vscode-dark` 选标题与表格边线，mermaid 预览扩展也按它
 * 决定图表明暗（`vsCodeTheme.ts` 的 `isDarkVsCodeTheme`）。只改 `<html>` 的类，
 * 正文换了、图表还是另一套配色。
 */
function syncForcedBodyKind() {
	const body = document.body;
	const target = forcedBodyClass(themeMode);
	if (!body || !target) {
		return;
	}
	const alreadyClean = body.classList.contains(target)
		&& HOST_THEME_CLASSES.every(kind => kind === target || !body.classList.contains(kind));
	if (alreadyClean) {
		return;
	}
	body.classList.remove(...HOST_THEME_CLASSES);
	body.classList.add(target);
}

/** 切回「跟随主题」：把 body 的类别还原成宿主当前的主题类别。 */
function restoreHostBodyKind() {
	const body = document.body;
	if (!body) {
		return;
	}
	const kind = hostThemeKind || readHostThemeKind();
	body.classList.remove(...HOST_THEME_CLASSES);
	if (HOST_THEME_CLASSES.includes(kind)) {
		body.classList.add(kind);
		// 高对比浅色在 VS Code 里同时带 `vscode-high-contrast`（向后兼容）
		if (kind === 'vscode-high-contrast-light') {
			body.classList.add('vscode-high-contrast');
		}
	}
}

/** 三个按钮的选中态只看 `aria-pressed`，脚本不碰 class / 子节点（与编辑开关同一约定）。 */
function syncThemeButtons() {
	for (const button of document.querySelectorAll('.wispkit-theme-option')) {
		button.setAttribute('aria-pressed', button.dataset.themeMode === themeMode ? 'true' : 'false');
	}
}

/**
 * 应用主题模式。
 * - `persist: false`：宿主广播回来的消息，不能再发一次，否则来回打转；
 * - `notify: false`：首屏初始化，第三方脚本本来就会按当前主题首次渲染。
 */
function applyThemeMode(mode, { notify = true, persist = true } = {}) {
	const next = normalizeThemeMode(mode);
	const changed = next !== themeMode;
	themeMode = next;

	const root = document.documentElement;
	if (root) {
		root.classList.toggle('wispkit-theme-light', next === 'light');
		root.classList.toggle('wispkit-theme-dark', next === 'dark');
		root.classList.toggle('wispkit-theme-auto', next === 'auto');
		root.dataset.wispkitTheme = next;
	}

	syncThemeButtons();
	if (next === 'auto') {
		// 首屏本来就是 auto：body 的类别归宿主所有，不能动
		if (changed) {
			const kind = readHostThemeKind();
			if (kind) {
				hostThemeKind = kind;
			}
			restoreHostBodyKind();
		}
	} else {
		syncForcedBodyKind();
	}

	if (changed && notify) {
		// mermaid 等第三方脚本按 body 明暗与实时 CSS 变量渲染，主题变了必须让它们重画。
		// **重画前必须先把已渲染的图表还原成源码**：内置 mermaid 脚本的 init 会先删掉
		// `.mermaid > svg`，再读容器的 textContent 当源码 —— 不还原就只剩空字符串，
		// 图会直接消失（用户反馈的「切主题 mermaid 变空白」）。
		refreshMermaidDiagrams();
	}
	if (persist) {
		hostApi?.postMessage({ type: 'wispkit.setTheme', mode: next });
	}
	return next;
}

/**
 * 宿主换主题（或初始化时第一次写 body 类）会改 body 的 class 与
 * `data-vscode-theme-kind`：
 * - `auto`：配色已被宿主换好，只需叫第三方脚本重画（mermaid 不会自己重渲染）；
 * - 强制：把被宿主覆盖掉的明暗类别重新压回目标值。
 *
 * 回调里先判断「是否已经一致」再写：我们自己的写入会再触发一轮，第二轮直接收敛，
 * 不会死循环。
 */
const themeKindObserver = {
	observer: null,

	start() {
		const Ctor = document.body?.ownerDocument?.defaultView?.MutationObserver ?? null;
		if (!Ctor) {
			return;
		}
		this.observer = new Ctor(() => this.handle());
		this.observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
	},

	handle() {
		const kind = readHostThemeKind();
		const previous = hostThemeKind;
		const hostChanged = kind !== '' && kind !== previous;
		if (kind !== '') {
			hostThemeKind = kind;
		}
		if (themeMode === 'auto') {
			// 初始化时宿主第一次写类不算「换主题」，不必让第三方脚本白重画一次。
			// 真换了主题同样要先还原 mermaid 源码，原因见 applyThemeMode。
			if (previous !== '' && hostChanged) {
				refreshMermaidDiagrams();
			}
			return;
		}
		syncForcedBodyKind();
	},
};

const config = readConfig();
const content = document.getElementById('wispkit-content');
const nav = document.getElementById('wispkit-toc');
const editorToggle = document.getElementById('wispkit-editor-toggle');
const saveButton = document.getElementById('wispkit-save');
const dirtyBadge = document.getElementById('wispkit-dirty');
/**
 * 正文层：工具栏缩放作用在它身上（不是滚动容器本身，原因见 shared/pagezoom.js）。
 * 老页面 / 测试里若没有这一层，退回 content，功能照常但缩放会作用在滚动容器上。
 */
const zoomLayer = document.getElementById('wispkit-zoom-layer') ?? content;

/* ---------------------------------------------------------------- Mermaid 图表主题 */

/**
 * 与内置 mermaid-markdown-features 的 `validMermaidThemes` 完全一致。
 * `vscode` 是它自己的哨兵值：按 body 明暗与实时 CSS 变量推导配色；其余是 Mermaid 原生主题。
 */
const MERMAID_THEMES = ['vscode', 'default', 'forest', 'dark', 'neutral', 'base'];
const DEFAULT_MERMAID_THEME = 'vscode';

function isMermaidTheme(value) {
	return MERMAID_THEMES.includes(value);
}

function normalizeMermaidTheme(value) {
	return isMermaidTheme(value) ? value : DEFAULT_MERMAID_THEME;
}

const mermaidThemeSelect = document.getElementById('wispkit-mermaid-theme');
/** 服务端写进 `<html data-wispkit-mermaid-theme>`；缺失时退回下拉框的初始值。 */
let mermaidTheme = normalizeMermaidTheme(
	document.documentElement?.dataset?.wispkitMermaidTheme ?? mermaidThemeSelect?.value,
);

/**
 * 把当前主题写进内置扩展每次渲染时读取的 `#markdown-mermaid` 配置 span。
 *
 * HTML 渲染时宿主已经改过一次（`applyMermaidThemeToBodyHtml`）；这里管的是
 * 运行期切换，以及正文整体替换后（宿主会重新渲染，span 也跟着换新的）。
 * `dataset.config` 自动做 HTML 实体解码，所以不需要手写编解码。
 */
function applyMermaidThemeToConfigSpan() {
	const span = document.getElementById('markdown-mermaid');
	if (!span) {
		return false;
	}
	let config = {};
	try {
		const parsed = JSON.parse(span.dataset.config || '{}');
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			config = parsed;
		}
	} catch {
		// 配置坏了就只用最小集合（主题两字段），其余交给内置扩展默认值
	}
	config.lightModeTheme = mermaidTheme;
	config.darkModeTheme = mermaidTheme;
	span.dataset.config = JSON.stringify(config);
	return true;
}

/** 离容器最近的、最外层的 `.mermaid-wrapper`（内置扩展每次重渲染都会再套一层）。 */
function outermostMermaidWrapper(container) {
	let outermost = null;
	for (let element = container.parentElement; element && element !== zoomLayer; element = element.parentElement) {
		if (element.classList?.contains('mermaid-wrapper')) {
			outermost = element;
		}
	}
	return outermost;
}

/**
 * 还原一个 `.mermaid` 容器里的 **Mermaid 源码**。
 *
 * 内置扩展渲染时会先把源码写进 `data-vscode-context.mermaidSource`（解析成 JSON），
 * 再清空容器、塞入 SVG —— 这是唯一可靠的源码副本。刚还原过、还没被重新渲染的容器
 * 没有 svg 子节点，此时 `textContent` 本身就是源码。
 */
function mermaidSourceOf(container) {
	try {
		const context = JSON.parse(container.dataset?.vscodeContext || '{}');
		if (typeof context.mermaidSource === 'string' && context.mermaidSource.trim()) {
			// 内置脚本已接管：哪怕还在 parse/render 途中（container 可能已被清空），
			// 这也是可信源码，必须还原 —— 否则紧接着的 init 会读到空字符串。
			return { source: context.mermaidSource.trim(), fromRender: true };
		}
	} catch {
		// 非法 JSON：继续走 textContent 兜底
	}
	if (!container.querySelector('svg')) {
		const text = container.textContent ?? '';
		return { source: text.trim() ? text.trim() : '', fromRender: false };
	}
	return { source: '', fromRender: false };
}

/**
 * 让所有已渲染的 Mermaid 图恢复成「源码 + 干净的 `.mermaid` 容器」。
 *
 * 这是修复「切主题后图变空白」的关键：内置预览脚本的 `init()` 会先删掉
 * `.mermaid > svg`，再读 `textContent` 当源码；如果容器里只剩 SVG，删完就是空字符串，
 * 图就永远不会再画出来。还原时把整条 `.mermaid-wrapper`（含缩放控件 / 拖拽手柄）
 * 一并换掉，也避免反复切主题时 wrapper 层层嵌套。
 *
 * @returns {number} 还原的容器数量（0 表示这条路径没有可还原的图）
 */
function restoreMermaidSources() {
	if (!zoomLayer?.querySelectorAll) {
		return 0;
	}
	let restored = 0;
	for (const container of [...zoomLayer.querySelectorAll('.mermaid')]) {
		const wrapper = outermostMermaidWrapper(container);
		const { source, fromRender } = mermaidSourceOf(container);
		// 内置脚本接管过（data 里有源码）就必须还原，哪怕它正在解析、容器暂时是空的；
		// 没接管过的纯源码容器（没有 svg、没有 wrapper）保持原样，不碰它的 id / 属性。
		const rendered = fromRender || Boolean(container.querySelector('svg')) || Boolean(wrapper);
		if (!rendered || !source) {
			continue;
		}
		const fresh = zoomLayer.ownerDocument.createElement('div');
		fresh.className = 'mermaid';
		fresh.textContent = source;
		(wrapper ?? container).replaceWith(fresh);
		restored += 1;
	}
	return restored;
}

/**
 * 按当前 Mermaid 主题重画全部图表：写配置 → 还原源码 → 通知预览脚本。
 * 返回值只用于自检 / e2e 断言。
 */
function refreshMermaidDiagrams() {
	const configUpdated = applyMermaidThemeToConfigSpan();
	const restored = restoreMermaidSources();
	notifyPreviewScripts();
	return { configUpdated, restored };
}

function syncMermaidThemeControl() {
	if (mermaidThemeSelect && mermaidThemeSelect.value !== mermaidTheme) {
		mermaidThemeSelect.value = mermaidTheme;
	}
}

/**
 * 切换 Mermaid 图表主题。
 * - `persist: false`：宿主广播回来的消息，不能再发一次；
 * - `notify: false`：首屏初始化，页面 HTML 已经按目标主题生成，不必重画。
 */
function applyMermaidTheme(value, { notify = true, persist = true } = {}) {
	const next = normalizeMermaidTheme(value);
	const changed = next !== mermaidTheme;
	mermaidTheme = next;
	syncMermaidThemeControl();
	if (document.documentElement) {
		document.documentElement.dataset.wispkitMermaidTheme = next;
	}
	if (changed && notify) {
		refreshMermaidDiagrams();
	}
	if (persist) {
		hostApi?.postMessage({ type: 'wispkit.setMermaidTheme', theme: next });
	}
	return next;
}

const toc = createTableOfContents({
	content,
	nav,
	splitter: document.getElementById('wispkit-splitter'),
	depth: config.tocDepth,
	enabled: config.tocEnabled,
	storage,
	resizeTarget: zoomLayer,
	virtualized: () => zoomLayer.classList.contains('wispkit-virtualized'),
});

const lightbox = createLightbox({
	root: document.getElementById('wispkit-lightbox'),
	viewport: document.getElementById('wispkit-lightbox-body'),
	stage: document.getElementById('wispkit-lightbox-stage'),
	titleElement: document.getElementById('wispkit-lightbox-title'),
	zoomElement: document.getElementById('wispkit-lightbox-zoom'),
	closeButton: document.getElementById('wispkit-lightbox-close'),
	resetButton: document.getElementById('wispkit-lightbox-reset'),
	wheelZoom: () => true,
});

/* ---------------------------------------------------------------- 正文多级缩放 */

const zoomOutButton = document.getElementById('wispkit-zoom-out');
const zoomInButton = document.getElementById('wispkit-zoom-in');
const zoomValueButton = document.getElementById('wispkit-zoom-reset');

/**
 * 档位固定 50%–300%；`storage` 里记的是倍率（"1.5"），下次打开同一文档沿用。
 * 缩放后目录的标题位置全部变了，缓存必须作废（toc.invalidatePositions）。
 */
const pageZoom = createPageZoom({
	target: zoomLayer,
	initial: storage.get('wispkit.zoom'),
	storage,
	onChange: ({ percent, atMin, atMax }) => {
		if (zoomValueButton) {
			zoomValueButton.textContent = `${percent}%`;
			zoomValueButton.setAttribute('aria-label', `当前缩放 ${percent}%，点击重置为 100%`);
		}
		if (zoomOutButton) {
			zoomOutButton.disabled = atMin;
		}
		if (zoomInButton) {
			zoomInButton.disabled = atMax;
		}
		toc.invalidatePositions?.();
	},
});

zoomOutButton?.addEventListener('click', () => pageZoom.zoomOut({ persist: true }));
zoomInButton?.addEventListener('click', () => pageZoom.zoomIn({ persist: true }));
zoomValueButton?.addEventListener('click', () => pageZoom.reset({ persist: true }));

document.addEventListener('keydown', event => {
	if (!(event.ctrlKey || event.metaKey) || event.altKey) {
		return;
	}
	const key = event.key;
	if (key === '=' || key === '+') {
		event.preventDefault();
		pageZoom.zoomIn({ persist: true });
	} else if (key === '-' || key === '_') {
		event.preventDefault();
		pageZoom.zoomOut({ persist: true });
	} else if (key === '0') {
		event.preventDefault();
		pageZoom.reset({ persist: true });
	}
});

// Ctrl+滚轮：与 VS Code 图片视图的习惯一致。这里拦掉浏览器自己的页面缩放
// （preventDefault），只按档位放大/缩小。
content.addEventListener('wheel', event => {
	if (!event.ctrlKey) {
		return;
	}
	event.preventDefault();
	if (event.deltaY < 0) {
		pageZoom.zoomIn({ persist: true });
	} else if (event.deltaY > 0) {
		pageZoom.zoomOut({ persist: true });
	}
}, { passive: false });

/**
 * 大文档虚拟化：正文元素足够多时给正文层挂 `wispkit-virtualized`，
 * CSS 用 `content-visibility: auto` 跳过视口外块的排版与绘制。
 *
 * 这是「400 KB + 多图多表，点目录卡顿」的主治：点击目录会跳到很远的位置，
 * 不虚拟化时浏览器要为整篇文档布局/栅格化所有表格与 mermaid SVG。
 * 阈值取「正文文字 18 万字」或「元素 4000 个」或「表格 / 代码 / 图 40 个」任一，
 * 普通文档不会进虚拟化，避免 `contain-intrinsic-size` 的估算误差影响滚动条。
 */
const VIRTUALIZE_MIN_CHARS = 180000;
const VIRTUALIZE_MIN_ELEMENTS = 4000;
const VIRTUALIZE_MIN_HEAVY = 40;
const VIRTUALIZE_KEEP_CLASS = 'wispkit-virtualize-keep';
const DIAGRAM_SELECTOR = 'svg, .mermaid, .mermaid-wrapper, .drawio, .mxgraph';

/** 这个顶层块是不是（或含有）图？图块必须保持真实布局，见 markdown.css 里的说明。 */
function isDiagramBlock(element) {
	return element.matches?.(DIAGRAM_SELECTOR) || Boolean(element.querySelector?.(DIAGRAM_SELECTOR));
}

/** 给所有图块顶层子节点打上「不虚拟化」标记；幂等，已标记的跳过。 */
function markVirtualizeKeep() {
	if (!zoomLayer || zoomLayer === content) {
		return;
	}
	for (const child of zoomLayer.children) {
		if (child.classList.contains(VIRTUALIZE_KEEP_CLASS)) {
			continue;
		}
		if (isDiagramBlock(child)) {
			child.classList.add(VIRTUALIZE_KEEP_CLASS);
		}
	}
}

function closestLayerChild(node) {
	let element = node?.nodeType === 1 ? node : node?.parentElement ?? null;
	while (element && element.parentElement !== zoomLayer) {
		element = element.parentElement;
	}
	return element?.parentElement === zoomLayer ? element : null;
}

/**
 * 图块是**异步**出现的：mermaid 脚本可能把原来的顶层块包进新的 `.mermaid-wrapper`。
 * 观察器在 DOM 变动的微任务里同步补标记 —— 它早于 mermaid 自己排的
 * `requestAnimationFrame(initialize)`，所以那一次 SVG 测量看到的是真实布局。
 */
const MutationObserverCtor = zoomLayer.ownerDocument?.defaultView?.MutationObserver ?? null;
const virtualizeKeepObserver = typeof MutationObserverCtor === 'function' && zoomLayer !== content
	? new MutationObserverCtor(records => {
		if (!zoomLayer.classList.contains('wispkit-virtualized')) {
			return;
		}
		for (const record of records) {
			for (const node of record.addedNodes) {
				const child = node?.parentElement === zoomLayer ? node : closestLayerChild(record.target);
				if (child?.nodeType === 1 && !child.classList.contains(VIRTUALIZE_KEEP_CLASS) && isDiagramBlock(child)) {
					child.classList.add(VIRTUALIZE_KEEP_CLASS);
				}
			}
		}
	})
	: null;
virtualizeKeepObserver?.observe(zoomLayer, { childList: true, subtree: true });

function updateVirtualization() {
	if (!zoomLayer || zoomLayer === content) {
		return false;
	}
	markVirtualizeKeep();
	const heavy = zoomLayer.querySelectorAll('table, pre, .mermaid, .drawio, .mxgraph').length;
	const elementCount = zoomLayer.getElementsByTagName('*').length;
	let virtual = heavy >= VIRTUALIZE_MIN_HEAVY || elementCount >= VIRTUALIZE_MIN_ELEMENTS;
	if (!virtual && elementCount >= 1000) {
		// 纯文字长文（表格/图不多）也要照顾；`textContent` 只在这种边缘场景跑一次。
		virtual = (zoomLayer.textContent?.length ?? 0) >= VIRTUALIZE_MIN_CHARS;
	}
	zoomLayer.classList.toggle('wispkit-virtualized', virtual);
	// 块的估算尺寸换了，目录的标题位置缓存随之作废。
	toc.invalidatePositions?.();
	return virtual;
}

/* ---------------------------------------------------------------- 正文查找 */

const find = createFinder({
	content,
	root: zoomLayer,
	bar: document.getElementById('wispkit-find'),
	input: document.getElementById('wispkit-find-input'),
	count: document.getElementById('wispkit-find-count'),
	prevButton: document.getElementById('wispkit-find-prev'),
	nextButton: document.getElementById('wispkit-find-next'),
	caseButton: document.getElementById('wispkit-find-case'),
	closeButton: document.getElementById('wispkit-find-close'),
	onOpenChange: open => {
		const toggle = document.getElementById('wispkit-find-toggle');
		toggle?.setAttribute('aria-pressed', open ? 'true' : 'false');
		toggle?.classList.toggle('wispkit-active', open);
		// 开/关查找会启用/停用正文虚拟化，块高度整体换一套 —— 目录位置缓存作废。
		toc.invalidatePositions?.();
	},
});
document.getElementById('wispkit-find-toggle')?.addEventListener('click', () => find.openFromShortcut());

function refresh() {
	updateVirtualization();
	// 正文（连同内置扩展重新生成的配置 span）可能刚被整体换掉：先按当前主题改配置，
	// 再让预览脚本扫描渲染。首屏也走这里 —— 如果 async 模块脚本恰好抢在前面已经画过，
	// refreshMermaidDiagrams 会先把源码还原回来，不会让第二次 init 读到空容器。
	refreshMermaidDiagrams();
	toc.rebuild();
}

/**
 * 重建正文。**保留滚动位置**：段落编辑提交后宿主会把整篇重渲染并推回来，
 * 不保留的话每次改一段都会被弹回文首。
 */
function applyBodyHtml(bodyHtml) {
	lightbox.close();
	paragraph.closeInput({ restore: false });
	const scrollTop = content.scrollTop;
	// 重建会移除全部旧节点，产生成百上千条 mutation。先停掉接力观察，免得把「重建」
	// 误判成「第三方替换」而把旧块的行号错配给新容器 —— 重建之后 pending 必须是空的。
	sourceRelay.stop();
	zoomLayer.innerHTML = bodyHtml;
	content.scrollTop = scrollTop;
	sourceRelay.start();
	refresh();
	// 正文换了，查找栏若开着要按同一查询在新 DOM 上重跑（mermaid 在另一个块里，不参与搜索）。
	find.contentReplaced();
}

/** 按钮上的文字节点：图标在标记里，脚本只改这个 span，不会把图标抹掉。 */
function setButtonLabel(button, label, title) {
	const span = button?.querySelector?.('.wispkit-btn-label');
	if (span) {
		span.textContent = label;
	} else if (button) {
		button.textContent = label;
	}
	if (button && title) {
		button.title = title;
	}
}

/* ---------------------------------------------------------------- 目录栏位置 */

const TOC_SIDE_KEY = 'wispkit.toc.side';

/** 目录栏位置：默认右侧（用户要求），可切到左侧。 */
function readTocSide() {
	return storage.get(TOC_SIDE_KEY) === 'left' ? 'left' : 'right';
}

let tocSide = readTocSide();

/**
 * 用 CSS `order` 换视觉顺序，不动 DOM —— 拖拽方向由 `.wispkit-toc-right` 判定，
 * 而 `order` 不改变 DOM 顺序，所以两处必须看同一个信号，否则拖拽会反向。
 */
function applyTocSide() {
	const layout = nav?.parentElement;
	if (layout) {
		layout.classList.toggle('wispkit-toc-right', tocSide === 'right');
		layout.classList.toggle('wispkit-toc-left', tocSide === 'left');
	}

	const button = document.getElementById('wispkit-toc-side');
	setButtonLabel(
		button,
		tocSide === 'right' ? '目录靠左' : '目录靠右',
		tocSide === 'right' ? '把目录栏移到左侧' : '把目录栏移到右侧',
	);
	const icon = button?.querySelector?.('use');
	icon?.setAttribute?.('href', tocSide === 'right' ? '#wispkit-icon-arrow-left' : '#wispkit-icon-arrow-right');
	return tocSide;
}

function toggleTocSide() {
	tocSide = tocSide === 'right' ? 'left' : 'right';
	applyTocSide();
	storage.set(TOC_SIDE_KEY, tocSide);
	return tocSide;
}

/* ---------------------------------------------------------------- 段落就地编辑 */

/**
 * 编辑模式 = **当前段落就地编辑**，不分栏、不新开视图：
 * 点正文里任意一块，那一段原地变成源码编辑框（内容是它在 Markdown 原文里的文字），
 * 其余段落保持渲染后的样子。提交时把改动写回整篇源码并整篇保存，
 * 宿主重渲染后内容被替换回来 —— 于是那一恢复成渲染态。
 *
 * 源码↔渲染块的对应关系来自内置引擎写在每个块上的 `data-line`
 * （见 `media/shared/paragraph.js` 顶部注释）。
 */
const paragraphState = {
	mode: false,
	/** 整篇 Markdown 源码；段落编辑就是改它再整篇写回。 */
	source: '',
	loaded: false,
	saveRequestId: 0,
	/** 当前打开的那一段：{ span, textarea, block, html }。 */
	open: null,
};

function setDirty(dirty, text) {
	if (dirtyBadge) {
		dirtyBadge.textContent = text ?? '未保存';
		dirtyBadge.hidden = !(dirty && paragraphState.mode);
	}
	paragraphState.dirty = dirty;
}

function rawBlockItems() {
	return mapBlocksToSpans(content.querySelectorAll('[data-line]'), countLines(paragraphState.source));
}

/**
 * 映射表。取之前先把「渲染容器还没接住源映射」的补上 ——
 * mermaid / drawio 是**异步**替换的，容器可能晚于 `applyBodyHtml` 一拍才出现，
 * 首屏时 `source` 也可能还没到。与其赌某个时机，不如谁要用谁先补齐（幂等）。
 */
function blockItems() {
	if (sourceRelay.hasUnmapped()) {
		sourceRelay.reconcile(rawBlockItems());
	}
	return rawBlockItems();
}

/** 按内容一次算准编辑框高度（`max-height` 由 CSS 兜底，超长时内部滚动）。 */
function fitParagraphInput(textarea) {
	textarea.style.height = 'auto';
	textarea.style.height = `${textarea.scrollHeight}px`;
}

const RENDERED_CONTAINER_SELECTOR = '.mermaid, .mxgraph, .drawio, .katex, .katex-display';

/**
 * 这个节点是不是「渲染后被换掉、于是丢了 `data-line` 祖先」的块？
 * mermaid 与 drawio 的容器、katex 的公式都属于这一类 —— 它们的原始 `<pre data-line>`
 * 被前端脚本整个替换掉了，所以祖先链上再也找不到源映射。
 */
function isRenderedBlock(node) {
	return Boolean(node?.closest?.(RENDERED_CONTAINER_SELECTOR));
}

/**
 * 源映射接力 —— 「mermaid 在编辑模式点击后没反应」的根治。
 *
 * 第三方预览脚本（内置 mermaid / drawio / katex 扩展）会把原始
 * `<pre data-line class="code-line">` **整个换掉**，换成自己的容器，`data-line` 随之丢失，
 * 于是编辑模式下点它们定位不到源码。那个脚本我们改不了，所以在这儿把映射「接住」：
 * 看到带 `data-line` 的块被移除、同时（或随后）有渲染容器插入时，把那条源映射搬到新容器上。
 *
 * 这样 `locate` 的第一级（沿祖先链找 `data-line`）就直接命中，不再依赖「前后邻居夹区间」
 * 那条兜底 —— 后者在**两个 mermaid 块紧挨着**时会夹到两段围栏，按它"宁可不动也不猜错"
 * 的约定只能放弃，于是靠后的那个永远点不开。兜底保留着：接力失败时它是唯一退路。
 */
/** 会被替换成渲染容器的**块级**标签：行内 katex 是 `<span>`，不在其中，也就不参与配对。 */
const BLOCK_CONTAINER_TAGS = new Set(['DIV', 'PRE', 'SECTION', 'FIGURE', 'P', 'CENTER']);

/** 收集被移除的块自己带的源映射（元素本身，或它子树里带 `data-line` 的后代）。 */
function collectLineValues(node, out) {
	if (!node || node.nodeType !== 1) {
		return;
	}
	const line = blockStartLine(node);
	if (line !== null) {
		out.push(line);
		return;
	}
	for (const child of Array.from(node.children ?? [])) {
		collectLineValues(child, out);
	}
}

/** 这个新插入的节点是不是「该接住源映射」的渲染容器？ */
function isRelayContainer(node) {
	if (typeof node.matches !== 'function' || !node.matches(RENDERED_CONTAINER_SELECTOR)) {
		return false;
	}
	if (!BLOCK_CONTAINER_TAGS.has(node.tagName)) {
		return false;
	}
	return blockStartLine(node) === null;
}

function collectRenderContainers(node, out) {
	if (!node || node.nodeType !== 1) {
		return;
	}
	if (isRelayContainer(node)) {
		out.push(node);
		return;
	}
	for (const child of Array.from(node.children ?? [])) {
		collectRenderContainers(child, out);
	}
}

const sourceRelay = {
	observer: null,
	/** 已看到「带 data-line 的块被移除」、但还没配到容器的行（FIFO，与插入顺序对应）。 */
	pending: [],

	/**
	 * 从 `document.defaultView` 取构造函数：真机 webview 与 jsdom 都有，而纯 node 上下文
	 * 没有全局 `MutationObserver` —— 那种环境（单测里直接 import 模块）退化成「不接力」，
	 * 由邻居兜底继续工作。不写全局 `MutationObserver` 也是为了避免 ReferenceError：
	 * 事件回调里抛错是静默的，点了没反应却看不见任何线索。
	 */
	observerCtor() {
		return content?.ownerDocument?.defaultView?.MutationObserver ?? null;
	},

	start() {
		this.pending.length = 0;
		const Ctor = this.observerCtor();
		this.stop();
		if (!Ctor) {
			return;
		}
		this.observer = new Ctor(records => this.handle(records));
		this.observer.observe(content, { childList: true, subtree: true });
	},

	stop() {
		this.observer?.disconnect?.();
		this.observer = null;
	},

	handle(records) {
		const containers = [];
		for (const record of records) {
			if (record.type !== 'childList') {
				continue;
			}
			for (const node of record.removedNodes) {
				collectLineValues(node, this.pending);
			}
			for (const node of record.addedNodes) {
				collectRenderContainers(node, containers);
			}
		}
		for (const container of containers) {
			this.attach(container);
		}
	},

	/** 把一条待配对的源映射交给容器；配不上就什么都不做（邻居兜底仍然可用）。 */
	attach(container) {
		if (blockStartLine(container) !== null) {
			// 已经有源映射的容器不动 —— 免得把别人的行号覆盖上去
			return false;
		}
		const index = pickPendingSourceLine(paragraphState.source, this.pending);
		if (index < 0) {
			return false;
		}
		const [line] = this.pending.splice(index, 1);
		container.setAttribute('data-line', String(line));
		container.classList?.add('code-line');
		return true;
	},

	/**
	 * 补漏：**首屏浏览时 `source` 还没到**（以前只在进编辑模式时才请求），
	 * `pickPendingSourceLine` 的自校验拿不到源码只能返回 -1，接力整条放弃 ——
	 * 于是 mermaid 容器永远缺 `data-line`，而**前一个段落会把整段围栏算进自己的区间**
	 * （实测：点标题开出的编辑框装下了 88 行、2065px 高的整张图）。
	 *
	 * 所以 source 到手后、以及每次取映射表前都扫一遍：用前后邻居夹区间，并且
	 * **只在区间里恰好一段围栏**时才写，仍然是「宁可不动也不猜错」。
	 */
	reconcile(items) {
		if (!content || typeof paragraphState.source !== 'string') {
			return 0;
		}
		const targets = Array.from(content.querySelectorAll(RENDERED_CONTAINER_SELECTOR))
			.filter(node => isRelayContainer(node));
		if (!targets.length) {
			return 0;
		}
		// 一次算完再统一写：边算边写会让后面容器的邻居区间被刚补的块切窄，结果不稳定
		const list = items ?? rawBlockItems();
		const resolved = [];
		for (const node of targets) {
			const bounds = neighborBounds(list, node);
			if (!bounds) {
				continue;
			}
			const fence = fenceSpanInRange(paragraphState.source, bounds.from, bounds.to);
			if (fence) {
				resolved.push({ node, line: fence.startLine });
			}
		}
		for (const { node, line } of resolved) {
			node.setAttribute('data-line', String(line));
			node.classList?.add('code-line');
		}
		return resolved.length;
	},

	/** 有没有「渲染容器还没接住源映射」。补漏的前置判断，也是它的幂等开关。 */
	hasUnmapped() {
		if (!content) {
			return false;
		}
		return Array.from(content.querySelectorAll(RENDERED_CONTAINER_SELECTOR))
			.some(node => isRelayContainer(node));
	},
};

/**
 * `Node.DOCUMENT_POSITION_*` 的规范固定值。
 * 不写 `Node.XXX` 是因为前端模块在测试沙箱（node 上下文 + jsdom）里没有全局 `Node`，
 * 那样会抛 ReferenceError —— 而在事件处理器里抛错是**静默**的（点击毫无反应、控制台之外看不见），
 * 排查代价很高。这两个值是 DOM 规范钉死的，用字面量不依赖运行环境。
 */
const DOCUMENT_POSITION_PRECEDING = 2;
const DOCUMENT_POSITION_FOLLOWING = 4;

/**
 * 用 DOM 顺序上紧挨着 `block` 的前一个 / 后一个**带 `data-line` 的块**夹出源码区间。
 *
 * 两个边界**都取邻居的 `startLine`**，这是关键：`block` 之所以落到这里，正是因为它是
 * 「渲染后丢了 `data-line`」的那类块（mermaid / drawio / katex），而它的源码行此刻被
 * **前一个块的区间吃了进去** —— 前一个块的 `endLine` 是"再下一个已知块的起始行"，
 * 用它当区间下界会得到 `from === to` 的空区间，于是永远定位不到。取 `startLine` 才是
 * 「从上一个块开始、到下一个块为止」这个真区间。某一侧没有邻居时退化到 0 / 总行数。
 */
function neighborBounds(items, block) {
	const total = countLines(paragraphState.source);
	let from = 0;
	let to = total;
	for (const item of items) {
		if (!item.element.isConnected) {
			continue;
		}
		const position = item.element.compareDocumentPosition(block);
		if (position & DOCUMENT_POSITION_FOLLOWING) {
			from = Math.max(from, item.span.startLine);
		} else if (position & DOCUMENT_POSITION_PRECEDING) {
			to = Math.min(to, item.span.startLine);
		}
	}
	return to > from ? { from, to } : null;
}

const paragraph = {
	/** 点了一段：先提交上一段，再就地为这一段开编辑框。 */
	openAt(block) {
		if (!paragraphState.mode) {
			return null;
		}
		// **必须先提交再算映射**：正在编辑的那一段此刻在 DOM 里是 textarea 而不是原块，
		// 映射表会少一项，索引整体前移，于是"点下一段"会点到错的地方。
		if (paragraphState.open) {
			if (paragraphState.open.block === block) {
				return paragraphState.open;
			}
			paragraph.commit();
		}

		const hit = paragraph.locate(block);
		if (!hit) {
			return null;
		}

		// 用 verbatim 版取原文：**连尾随的分隔空行一起**放进编辑框，于是空行看得见也删得掉
		// （用户提过「建议空白的行也能编辑和去除」）；提交时走同样的 verbatim 语义。
		const textarea = paragraph.createInput(sliceParagraphVerbatim(paragraphState.source, hit.span));
		hit.element.replaceWith(textarea);
		paragraphState.open = { span: hit.span, textarea, block: hit.element };
		// 插入文档之后再量高度 —— 脱离文档时 `scrollHeight` 恒为 0
		fitParagraphInput(textarea);
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		return paragraphState.open;
	},

	/**
	 * 点这个节点该编辑哪一段。常规情形沿祖先链找 `data-line`；找不到时（mermaid / drawio /
	 * katex 渲染后把原始 `<pre data-line>` 整个换掉了）退一步，用前后邻居块夹出的源码区间
	 * 定位那段围栏。定位不到就返回 null，调用方会当成「点了不该编辑的地方」而只提交当前段。
	 */
	locate(block) {
		const items = blockItems();
		const direct = findBlockSpan(items, block);
		if (direct) {
			return direct;
		}
		if (!isRenderedBlock(block)) {
			return null;
		}
		const bounds = neighborBounds(items, block);
		if (!bounds) {
			return null;
		}
		const fence = fenceSpanInRange(paragraphState.source, bounds.from, bounds.to);
		return fence ? { element: block, span: fence } : null;
	},

	/** 建编辑框；输入过程中自动跟随内容增高。高度在调用方插入文档后统一算一次。 */
	createInput(text) {
		const textarea = document.createElement('textarea');
		textarea.className = 'wispkit-paragraph-input';
		textarea.spellcheck = false;
		textarea.value = text;
		textarea.setAttribute('aria-label', '这一段 Markdown 的原文');
		textarea.title = '回车 = 空一行（分出新段落）；Shift+回车 = 段内换行（Markdown 软换行）';
		textarea.addEventListener('input', () => fitParagraphInput(textarea));
		// 单个回车只写进一个 `\n`，而在 CommonMark 里那只是**软换行** —— 渲染时并回同一段，
		// 文字直接连在一起，于是用户看到的是「换了行却没有渲染效果」。分段要靠空行，
		// 所以这里把回车补成空行：编辑框里显示的仍然是它将要写回源码的字面内容
		// （verbatim 语义不破），只是按键语义跟上了 Markdown。
		// `Ctrl+Enter` 不在这里处理 —— 它是"提交这一段"，由文档级 keydown 负责。
		textarea.addEventListener('keydown', event => {
			if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
				return;
			}
			event.preventDefault();
			// `setRangeText` 能保住撤销栈与选区语义（直接改 `value` 会把光标弹到末尾）；
			// 它**不会触发 `input` 事件**，所以要自己再量一次高度。
			const start = textarea.selectionStart ?? textarea.value.length;
			const end = textarea.selectionEnd ?? start;
			textarea.setRangeText('\n\n', start, end, 'end');
			fitParagraphInput(textarea);
		});
		return textarea;
	},

	/** 提交当前段：无改动就只关掉编辑框。 */
	commit() {
		const open = paragraphState.open;
		if (!open) {
			return false;
		}
		const text = open.textarea.value;
		// verbatim：不补分隔空行 —— 编辑框里本来就带着它们，用户删了就该真的删掉。
		// 没碰空行时 `text` 与区间原文逐字相同，于是 `next === source`，走"无需保存"分支。
		const next = replaceParagraphVerbatim(paragraphState.source, open.span, text);
		paragraph.closeInput({ restore: true });

		if (next === paragraphState.source) {
			return false;
		}
		paragraphState.source = next;
		setDirty(true);
		save();
		return true;
	},

	/** 放弃当前段的修改。 */
	cancel() {
		const open = paragraphState.open;
		if (!open) {
			return false;
		}
		paragraph.closeInput({ restore: true });
		return true;
	},

	/** 关掉编辑框。`restore: false` 用于「内容马上要被整篇替换」的场合，避免无谓的 DOM 抖动。 */
	closeInput({ restore }) {
		const open = paragraphState.open;
		if (!open) {
			return;
		}
		paragraphState.open = null;
		if (restore && open.textarea.isConnected) {
			open.textarea.replaceWith(open.block);
		}
	},

	get isOpen() {
		return Boolean(paragraphState.open);
	},
};

function setEditMode(active) {
	paragraphState.mode = active;
	if (content) {
		content.classList.toggle('wispkit-editing', active);
	}
	if (saveButton) {
		saveButton.hidden = !active;
	}
	// 滑动开关：开/关**只由 `aria-checked` 表达**（轨道底色与滑块位移全在 CSS 里按它选），
	// 图标名从 `data-icon-on/off` 读 —— 脚本不硬编码图标，改图标只需改 page.ts 一处。
	if (editorToggle) {
		editorToggle.setAttribute('aria-checked', active ? 'true' : 'false');
		const icon = editorToggle.querySelector('use');
		const name = active ? editorToggle.dataset.iconOn : editorToggle.dataset.iconOff;
		if (icon && name) {
			icon.setAttribute('href', `#wispkit-icon-${name}`);
		}
	}
	setButtonLabel(
		editorToggle,
		active ? '编辑中' : '编辑',
		active
			? '退出段落编辑（会先提交当前段）'
			: '进入段落编辑模式：点正文任意一段，就地改它的 Markdown 原文',
	);
	setDirty(paragraphState.dirty === true);

	if (!active) {
		paragraph.commit();
		return;
	}
	if (!paragraphState.loaded) {
		hostApi?.postMessage({ type: 'wispkit.requestSource' });
	}
}

function save() {
	if (!paragraphState.mode) {
		return;
	}
	const requestId = ++paragraphState.saveRequestId;
	hostApi?.postMessage({ type: 'wispkit.save', requestId, text: paragraphState.source });
}

/**
 * 判断节点是不是元素。**故意不用 `instanceof Element`**：前端模块在测试沙箱
 * （node 上下文 + jsdom）里没有全局 `Element`，那样会抛 ReferenceError，而事件处理器里
 * 抛错是**静默**的 —— 表现为"点了没反应"，控制台之外完全看不见。`nodeType === 1`
 * 是等价判定，且不依赖运行环境。
 */
function isElement(node) {
	return Boolean(node) && typeof node === 'object' && node.nodeType === 1;
}

/**
 * 编辑模式下的点击：默认「点哪一段改哪一段」。
 * 但已渲染的图（mermaid / drawio / 图片）反过来 —— 改源码时正需要放大核对图对不对，
 * 所以它们优先交给放大模态框；想改那段围栏源码，点图外的正文即可。
 */
function handleEditClick(event) {
	const target = event.target;
	if (!isElement(target) || !content.contains(target)) {
		// 点到了编辑模式之外：提交当前段即可
		paragraph.commit();
		return;
	}
	if (target.classList.contains('wispkit-paragraph-input')) {
		return;
	}
	const svg = target.closest('svg');
	if (svg && content.contains(svg)) {
		event.preventDefault();
		paragraph.commit();
		lightbox.openSvg(svg);
		return;
	}
	const image = target.closest('img');
	if (image) {
		event.preventDefault();
		paragraph.commit();
		lightbox.openImage(image);
		return;
	}
	if (paragraph.openAt(target)) {
		event.preventDefault();
	} else {
		paragraph.commit();
	}
}

/* ---------------------------------------------------------------- 内容区交互 */

/**
 * 内容区点击：
 * - 编辑模式 → 段落就地编辑
 * - `#锚点` → 交给目录树定位（展开祖先 + 高亮），不是标题就放行走默认行为
 * - 图片 / 图表(svg) → 打开放大模态框
 */
function onClickContent(event) {
	const target = event.target;
	if (!isElement(target)) {
		return;
	}

	if (paragraphState.mode) {
		handleEditClick(event);
		return;
	}

	const anchor = target.closest('a');
	if (anchor) {
		const href = anchor.getAttribute('href') ?? '';
		if (href.startsWith('#')) {
			const id = decodeURIComponent(href.slice(1));
			if (id && toc.reveal(id)) {
				event.preventDefault();
			}
		}
		return;
	}

	const image = target.closest('img');
	if (image) {
		event.preventDefault();
		lightbox.openImage(image);
		return;
	}

	// mermaid / drawio 渲染出的 svg（含内嵌标记），点击即放大
	const svg = target.closest('svg');
	if (svg && content.contains(svg)) {
		lightbox.openSvg(svg);
	}
}

content.addEventListener('click', onClickContent);

/**
 * 链接点击：把原始 href 送回宿主解析（相对路径 → 文档所在目录）。
 * 编辑模式下不拦 —— 点正文任何位置都应该是"改这一段"，包括链接。
 */
if (hostApi) {
	installLinkRouter({
		canHandle: () => !paragraphState.mode,
		onOpenLink: href => hostApi.postMessage({ type: 'wispkit.openLink', href }),
	});
}

content.addEventListener('keydown', event => {
	if (!paragraphState.open) {
		return;
	}
	if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		paragraph.commit();
	} else if (event.key === 'Escape') {
		event.preventDefault();
		paragraph.cancel();
	} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
		event.preventDefault();
		paragraph.commit();
		save();
	}
});

document.addEventListener('keydown', event => {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && paragraphState.mode && !paragraphState.open) {
		event.preventDefault();
		save();
	}
});

/**
 * 右键菜单：图片 / mermaid / drawio 图。
 * webview 里的图片地址是 vscode-webview:// 形式，反解不出真实路径 ——
 * 所以前端只报"第几个元素"，路径与源码一律由宿主回原文里取。
 */
const menu = createContextMenu();
let lastMediaRequest = null;

function postMedia(request) {
	lastMediaRequest = request;
	hostApi?.postMessage({ type: 'wispkit.media', ...request });
}

function resolveMediaTarget(target) {
	if (!(target instanceof Element) || !content.contains(target)) {
		return null;
	}

	const image = target.closest('img');
	if (image) {
		const images = Array.from(content.querySelectorAll('img'));
		return {
			kind: 'image',
			index: images.indexOf(image),
			element: image,
			alt: image.getAttribute('alt') ?? '',
			src: image.getAttribute('src') ?? '',
		};
	}

	const svg = target.closest('svg');
	if (!svg) {
		return null;
	}

	// mermaid / drawio 的渲染结果都包在各自的容器里；容器顺序与源码块顺序一致。
	const scope = svg.closest('.mermaid, .drawio');
	const kind = scope ? (scope.classList.contains('mermaid') ? 'mermaid' : 'drawio') : 'svg';
	const selector = kind === 'mermaid' ? '.mermaid' : '.drawio';
	const index = scope
		? Array.from(content.querySelectorAll(selector)).indexOf(scope)
		: Array.from(content.querySelectorAll('svg')).indexOf(svg);
	return { kind, index, element: svg, alt: '', src: '' };
}

function serializeSvg(element) {
	const clone = element.cloneNode(true);
	clone.removeAttribute('id');
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	return new XMLSerializer().serializeToString(clone);
}

function mediaRequest(media, action, extra) {
	return { action, kind: media.kind, index: media.index, alt: media.alt, ...extra };
}

function buildMediaMenu(media) {
	const items = [
		{
			label: '放大查看',
			run: () => {
				if (media.kind === 'image') {
					lightbox.openImage(media.element);
				} else {
					lightbox.openSvg(media.element);
				}
			},
		},
	];

	if (media.kind === 'image') {
		items.push(
			{
				label: '另存为…',
				run: () => postMedia(mediaRequest(media, 'saveAs', {
					src: media.src,
					data: media.src.startsWith('data:') ? media.src : undefined,
				})),
			},
			{ label: '复制路径', run: () => postMedia(mediaRequest(media, 'copyPath', { src: media.src })) },
			{ label: '复制 Markdown 文本', run: () => postMedia(mediaRequest(media, 'copyText')) },
		);
		return items;
	}

	if (media.kind === 'drawio') {
		items.push({ label: '用 Draw.io 编辑器打开', run: () => postMedia(mediaRequest(media, 'editDrawio')) });
	}
	items.push(
		{ label: '另存为 SVG…', run: () => postMedia(mediaRequest(media, 'saveAs', { data: serializeSvg(media.element) })) },
		{ label: '复制源码', run: () => postMedia(mediaRequest(media, 'copyText')) },
	);
	return items;
}

content.addEventListener('contextmenu', event => {
	const media = resolveMediaTarget(event.target);
	if (!media) {
		return;
	}
	event.preventDefault();
	menu.open(buildMediaMenu(media), event.clientX, event.clientY);
});

document.getElementById('wispkit-sidebar-toggle')?.addEventListener('click', () => toc.toggleSidebar());
document.getElementById('wispkit-toc-side')?.addEventListener('click', () => toggleTocSide());
document.getElementById('wispkit-expand-all')?.addEventListener('click', () => toc.expandAll());
document.getElementById('wispkit-collapse-all')?.addEventListener('click', () => toc.collapseAll());
editorToggle?.addEventListener('click', () => setEditMode(!paragraphState.mode));
saveButton?.addEventListener('click', () => {
	paragraph.commit();
	save();
});

// 主题三态：点哪一段选哪一段；真正的「全局持久化」在宿主（见 markdownProvider）
for (const button of document.querySelectorAll('.wispkit-theme-option')) {
	button.addEventListener('click', () => applyThemeMode(button.dataset.themeMode));
}
// Mermaid 图表主题：改一次就重画全部图；宿主负责落盘并广播给其它 Markdown 标签页
mermaidThemeSelect?.addEventListener('change', () => applyMermaidTheme(mermaidThemeSelect.value));

// 位置以记住的为准（初始 HTML 已经按默认的「右侧」渲染，避免首屏闪一下再跳）
applyTocSide();
// 主题同理：HTML 里已经写好初始 class，这里只补按钮选中态与 body 明暗类别
applyThemeMode(themeMode, { notify: false, persist: false });
applyMermaidTheme(mermaidTheme, { notify: false, persist: false });
themeKindObserver.start();

window.addEventListener('message', event => {
	const message = event.data;
	if (!message || typeof message !== 'object') {
		return;
	}
	if (message.type === 'wispkit.update') {
		if (typeof message.source === 'string' && !paragraphState.open) {
			paragraphState.source = message.source;
			paragraphState.loaded = true;
		}
		applyBodyHtml(message.bodyHtml ?? '');
		if (message.config) {
			toc.setConfig(message.config);
		}
	} else if (message.type === 'wispkit.config') {
		toc.setConfig(message.config ?? {});
	} else if (message.type === 'wispkit.theme') {
		// 宿主广播：别的 Markdown 标签页切了主题，当前视图跟着变；不要回发。
		// 非法值直接忽略 —— 不能 normalize 成 auto，那等于「悄悄切回跟随主题」。
		if (isThemeMode(message.mode)) {
			applyThemeMode(message.mode, { persist: false });
		}
	} else if (message.type === 'wispkit.mermaidTheme') {
		// 宿主广播：Mermaid 图表主题同步到所有 Markdown 视图。
		if (isMermaidTheme(message.theme)) {
			applyMermaidTheme(message.theme, { persist: false });
		}
	} else if (message.type === 'wispkit.source') {
		paragraphState.source = typeof message.text === 'string' ? message.text : '';
		paragraphState.loaded = true;
		setDirty(false);
		// 源码到手：把首屏被第三方脚本替换掉、当时还没法校验行号的块补上（可能空操作）
		sourceRelay.reconcile();
	} else if (message.type === 'wispkit.saveResult') {
		if (message.requestId === paragraphState.saveRequestId) {
			setDirty(!message.ok, message.ok ? undefined : `保存失败：${message.error ?? '未知原因'}`);
		}
	}
});

// 首次渲染：内容已在 webview.html 里，只需让第三方脚本与目录接管。
// 等 DOM 就绪再派发，避免第三方脚本在内容解析完之前抓空。
// 接力观察必须在 refresh **之前**就位：第三方脚本正是在 refresh 派发事件之后替换正文的。
sourceRelay.start();
// 首屏就把源码要过来：第三方脚本替换块时，源映射接力要用它校验行号；
// 只在进编辑模式时才请求的话，首屏的 mermaid 容器永远接不住 `data-line`
// （那个空洞会让**前一段**把整段围栏算进自己的区间，编辑框装下整张图）。
if (!paragraphState.loaded) {
	hostApi?.postMessage({ type: 'wispkit.requestSource' });
}
// 先在同步阶段判一次大文档：正文此时已经解析完（脚本在 body 末尾），
// 尽早挂上虚拟化类，首屏就不必排版视口外的表格 / 图。
updateVirtualization();
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', refresh, { once: true });
} else {
	refresh();
}

// 供自动化验证读取：断言项不依赖人眼看
Object.defineProperty(window, '__wispkitSelftest', {
	value: {
		headingCount: () => toc.headingCount,
		tocLinkCount: () => nav.querySelectorAll('a').length,
		notifyPreviewScripts,
		openImage: element => lightbox.openImage(element),
		openSvg: element => lightbox.openSvg(element),
		lightboxOpen: () => lightbox.isOpen,
		reveal: id => toc.reveal(id),
		toggleSidebar: () => toc.toggleSidebar(),
		expandAll: () => toc.expandAll(),
		collapseAll: () => toc.collapseAll(),
		sidebarVisible: () => toc.sidebarVisible,
		tocSide: () => tocSide,
		toggleTocSide,
		navWidth: () => toc.navWidth,

		// —— 正文多级缩放 ——
		zoomPercent: () => pageZoom.percent,
		zoomLevel: () => pageZoom.level,
		setZoom: value => pageZoom.set(value, { persist: true }),
		zoomIn: () => pageZoom.zoomIn({ persist: true }),
		zoomOut: () => pageZoom.zoomOut({ persist: true }),
		resetZoom: () => pageZoom.reset({ persist: true }),
		zoomLayerStyle: () => zoomLayer.getAttribute('style') ?? '',
		/** 大文档虚拟化是否生效（content-visibility: auto）。 */
		virtualized: () => zoomLayer.classList.contains('wispkit-virtualized'),

		// —— 正文查找 ——
		openFind: prefill => find.open(prefill),
		openFindFromShortcut: () => find.openFromShortcut(),
		closeFind: () => find.close(),
		findOpen: () => find.isOpen,
		findQuery: () => find.query,
		setFindQuery: text => find.setQuery(text),
		findMatchCount: () => find.matchCount,
		findActiveIndex: () => find.activeIndex,
		findTruncated: () => find.truncated,
		findNext: () => find.next(),
		findPrev: () => find.prev(),
		findCaseSensitive: () => find.caseSensitive,
		setFindCaseSensitive: value => find.setCaseSensitive(value),
		findMarkedCount: () => find.markedCount,
		findUsesHighlightApi: () => find.usesHighlightApi,

		// —— 主题三态 ——
		themeMode: () => themeMode,
		setThemeMode: mode => applyThemeMode(mode),
		themeChecked: () => document.querySelector('.wispkit-theme-option[aria-pressed="true"]')?.dataset?.themeMode ?? null,
		themeOptionCount: () => document.querySelectorAll('.wispkit-theme-option').length,
		hostThemeKind: () => readHostThemeKind(),

		// —— Mermaid 图表主题 ——
		mermaidTheme: () => mermaidTheme,
		setMermaidTheme: value => applyMermaidTheme(value),
		mermaidThemeCount: () => mermaidThemeSelect?.options?.length ?? 0,
		mermaidThemeValue: () => mermaidThemeSelect?.value ?? null,
		/** 配置 span 里当前写入的明暗主题（没有内置 Mermaid 扩展时为 null）。 */
		mermaidConfigThemes: () => {
			const span = document.getElementById('markdown-mermaid');
			if (!span) {
				return null;
			}
			try {
				const config = JSON.parse(span.dataset.config || '{}');
				return { light: config.lightModeTheme ?? null, dark: config.darkModeTheme ?? null };
			} catch {
				return { error: 'invalid data-config' };
			}
		},
		mermaidContainerCount: () => zoomLayer.querySelectorAll('.mermaid').length,
		mermaidRenderedCount: () => zoomLayer.querySelectorAll('.mermaid svg').length,
		mermaidWrapperCount: () => zoomLayer.querySelectorAll('.mermaid-wrapper').length,
		/** 主动走一遍「还原源码 → 重画」通路；e2e 可用于模拟主题切换。 */
		refreshMermaidDiagrams,
		openContextMenu: selector => {
			const element = content.querySelector(selector);
			if (!element) {
				return null;
			}
			element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 12 }));
			return menu.labels;
		},
		clickMenu: label => menu.click(label),
		menuOpen: () => menu.isOpen,
		closeMenu: () => menu.close(),
		lastMediaRequest: () => lastMediaRequest,

		// —— 段落就地编辑 ——
		setEditMode,
		editModeActive: () => paragraphState.mode,
		isDirty: () => paragraphState.dirty === true,
		dirtyText: () => dirtyBadge?.textContent ?? '',
		sourceText: () => paragraphState.source,
		setSource: text => {
			paragraphState.source = typeof text === 'string' ? text : '';
			paragraphState.loaded = true;
		},
		/** 按 DOM 顺序点开第 index 个块，返回它的 span。先提交上一段，块序才稳定。 */
		openParagraphAt: index => {
			paragraph.commit();
			const item = blockItems()[index];
			if (!item) {
				return null;
			}
			paragraph.openAt(item.element);
			return paragraphState.open?.span ?? null;
		},
		blockSpans: () => blockItems().map(item => item.span),
		blockCount: () => blockItems().length,
		openSpan: () => paragraphState.open?.span ?? null,
		paragraphValue: () => paragraphState.open?.textarea?.value ?? '',
		typeInParagraph: text => {
			const open = paragraphState.open;
			if (!open) {
				return false;
			}
			open.textarea.value = text;
			return true;
		},
		commitParagraph: () => paragraph.commit(),
		cancelParagraph: () => paragraph.cancel(),
		paragraphInputVisible: () => Boolean(paragraphState.open?.textarea?.isConnected),
		saveNow: save,
		/** 待配对的源映射条数（重建之后必须是 0 —— 重建不算「第三方替换」）。 */
		relayPendingCount: () => sourceRelay.pending.length,
	},
});
