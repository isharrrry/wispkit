/**
 * `.xaml` 视图前端：左源码（可编辑）/ 右渲染图。
 *
 * 源码区是 gutter + textarea 的组合：两者共用同一套字体度量与固定行高，
 * 行号才与文本逐行对齐；textarea 一律 `wrap="off"`，否则长行折行会让行号串位。
 *
 * 缩放与平移直接复用图片视图那套手势核心（shared/panzoom.js），
 * 全屏放大复用 shared/lightbox.js —— 三个视图的行为保持一致。
 */

import { highlightToHtml } from '../src/xaml/highlight';
import { createLightbox } from './shared/lightbox.js';
import { createPanZoom } from './shared/panzoom.js';

const MIN_CODE_WIDTH = 160;
/** 拖拽上限按布局宽度取比例，别把渲染区挤没。 */
const MAX_CODE_RATIO = 0.75;
const DEFAULT_CODE_WIDTH = 460;
const TAB = '    ';

function readConfig() {
	const meta = document.getElementById('wispkit-xaml-config');
	if (!meta) {
		return {};
	}
	try {
		return JSON.parse(meta.dataset.wispkit || '{}');
	} catch {
		return {};
	}
}

// acquireVsCodeApi 只能取一次；取不到（单测里直接 import）就退化成纯前端模式
let hostApi = null;
try {
	hostApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
} catch {
	hostApi = null;
}

/** 界面状态跨会话记住：localStorage 优先，取不到再回退 webview 自身的 state。 */
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

const config = readConfig();
/** 高亮语言由宿主决定（`.xaml` 或 `.xaml.cs`）。 */
const language = config.language === 'csharp' ? 'csharp' : 'xaml';
const layout = document.getElementById('wispkit-xaml-layout');
const codePane = document.getElementById('wispkit-xaml-code-pane');
const gutterElement = document.getElementById('wispkit-xaml-gutter');
const editorElement = document.getElementById('wispkit-xaml-editor');
const splitter = document.getElementById('wispkit-xaml-splitter');
const viewport = document.getElementById('wispkit-xaml-viewport');
const image = document.getElementById('wispkit-xaml-image');
const errorPanel = document.getElementById('wispkit-xaml-error');
const errorTypeElement = document.getElementById('wispkit-xaml-error-type');
const errorMessageElement = document.getElementById('wispkit-xaml-error-message');
const statusElement = document.getElementById('wispkit-xaml-status');
const rerenderButton = document.getElementById('wispkit-xaml-rerender');
const lightboxButton = document.getElementById('wispkit-xaml-lightbox-button');
const fitButton = document.getElementById('wispkit-xaml-fit');
const saveButton = document.getElementById('wispkit-xaml-save');
const dirtyElement = document.getElementById('wispkit-xaml-dirty');
const previewPane = document.getElementById('wispkit-xaml-preview-pane');
const highlightElement = document.getElementById('wispkit-xaml-highlight');
const highlightCodeElement = document.getElementById('wispkit-xaml-highlight-code');
const layoutButtons = {
	both: document.getElementById('wispkit-xaml-layout-all'),
	code: document.getElementById('wispkit-xaml-layout-code'),
	preview: document.getElementById('wispkit-xaml-layout-preview'),
};

/** 脏标记：编辑过显示「未保存」，保存成功才清掉（不做自动保存）。 */
let dirty = false;

function setDirty(value) {
	dirty = Boolean(value);
	if (dirtyElement) {
		dirtyElement.hidden = !dirty;
	}
	return dirty;
}

const dragButton = config.dragButton === 'left' || config.dragButton === 'middle' ? config.dragButton : 'right';
const wheelStep = typeof config.wheelStep === 'number' && config.wheelStep > 1 ? config.wheelStep : 1.1;

/** 三态布局：都显示 / 只代码 / 只渲染；用户手动切过的优先于配置里的初始值。 */
const KEY_LAYOUT = 'wispkit.xaml.layout';
const LAYOUT_MODES = ['both', 'code', 'preview'];

function readLayoutMode() {
	const stored = storage.get(KEY_LAYOUT);
	if (LAYOUT_MODES.includes(stored)) {
		return stored;
	}
	return config.codeVisible === false ? 'preview' : 'both';
}

let layoutMode = readLayoutMode();
let codeWidth = Number.isFinite(config.codeWidth)
	? Math.max(MIN_CODE_WIDTH, config.codeWidth)
	: DEFAULT_CODE_WIDTH;
let panZoom = null;

if (viewport && image) {
	panZoom = createPanZoom(viewport, image, {
		wheelStep,
		dragButton,
		// 与图片视图一致：滚轮直接缩放，不需要按修饰键
		wheelZoom: () => true,
	});
}

const lightboxRoot = document.getElementById('wispkit-xaml-lightbox');
const lightboxViewport = document.getElementById('wispkit-xaml-lightbox-body');
const lightboxStage = document.getElementById('wispkit-xaml-lightbox-stage');
const lightbox = lightboxRoot && lightboxViewport && lightboxStage
	? createLightbox({
		root: lightboxRoot,
		viewport: lightboxViewport,
		stage: lightboxStage,
		titleElement: document.getElementById('wispkit-xaml-lightbox-title'),
		zoomElement: document.getElementById('wispkit-xaml-lightbox-zoom'),
		closeButton: document.getElementById('wispkit-xaml-lightbox-close'),
		resetButton: document.getElementById('wispkit-xaml-lightbox-reset'),
		wheelZoom: () => true,
	})
	: null;

function fitImage() {
	panZoom?.fit();
}

function clampCodeWidth(value) {
	const available = layout?.getBoundingClientRect?.().width ?? 0;
	// jsdom 里布局尺寸为 0，此时只保证下限
	const upper = available > 0 ? Math.max(MIN_CODE_WIDTH, available * MAX_CODE_RATIO) : Number.MAX_SAFE_INTEGER;
	return Math.round(Math.min(Math.max(value, MIN_CODE_WIDTH), upper));
}

function applyCodeWidth() {
	if (!codePane) {
		return;
	}
	// 收纳右侧时要清掉行内宽度：code-pane 是 flex: 0 0 auto，
	// 留着那串像素宽会让渲染区让出的空间空在那儿（就是"右侧隐藏了但区域还在"）。
	codePane.style.width = layoutMode === 'code' ? '' : `${codeWidth}px`;
}

function applyLayout() {
	const showCode = layoutMode !== 'preview';
	const showPreview = layoutMode !== 'code';

	// 供 CSS 选择：`[data-layout='code']` 时让源码区撑满整行
	if (layout) {
		layout.dataset.layout = layoutMode;
	}
	if (codePane) {
		codePane.hidden = !showCode;
	}
	if (previewPane) {
		previewPane.hidden = !showPreview;
	}
	if (splitter) {
		// 只有两侧都在时，分隔条才有意义
		splitter.hidden = !(showCode && showPreview);
	}
	if (showCode) {
		applyCodeWidth();
	}

	for (const [mode, button] of Object.entries(layoutButtons)) {
		if (!button) {
			continue;
		}
		const active = mode === layoutMode;
		button.classList.toggle('wispkit-xaml-btn-active', active);
		button.setAttribute('aria-pressed', active ? 'true' : 'false');
	}

	return layoutMode;
}

function setLayoutMode(mode, persist) {
	if (!LAYOUT_MODES.includes(mode)) {
		return layoutMode;
	}
	layoutMode = mode;
	applyLayout();
	if (persist !== false) {
		storage.set(KEY_LAYOUT, mode);
	}
	return layoutMode;
}

/** 在「都显示」与「只渲染」之间切换（等价于收纳左侧）；返回代码区是否可见。 */
function toggleCode() {
	setLayoutMode(layoutMode === 'preview' ? 'both' : 'preview');
	return layoutMode !== 'preview';
}

function openLightbox() {
	if (!lightbox || !image || !image.getAttribute('src')) {
		return false;
	}
	return lightbox.openImage(image);
}

// ---- 源码编辑区 ----

function editorText() {
	return editorElement ? String(editorElement.value ?? '') : '';
}

function editorLines() {
	return editorText().split('\n');
}

let gutterLines = 0;

/**
 * 重建行号。只在行数变化时重建 —— 每次按键都重建整栏在大文件上会卡。
 */
function syncGutter(force) {
	if (!gutterElement) {
		return 0;
	}
	const lines = editorLines();
	if (!force && lines.length === gutterLines) {
		syncScroll();
		return gutterLines;
	}

	gutterLines = lines.length;
	gutterElement.textContent = '';
	const fragment = document.createDocumentFragment();
	lines.forEach((_line, index) => {
		const number = document.createElement('span');
		number.className = 'wispkit-xaml-gutter-line';
		number.textContent = String(index + 1);
		fragment.append(number);
	});
	gutterElement.append(fragment);
	syncScroll();
	return gutterLines;
}

/** 行号栏与高亮层都不自己滚，靠同步 scrollTop/scrollLeft 跟随编辑器（overflow:hidden 仍可程序化滚动）。 */
function syncScroll() {
	if (!editorElement) {
		return;
	}
	if (gutterElement) {
		gutterElement.scrollTop = editorElement.scrollTop;
	}
	if (highlightElement) {
		highlightElement.scrollTop = editorElement.scrollTop;
		highlightElement.scrollLeft = editorElement.scrollLeft;
	}
}

/**
 * 重算高亮层。整篇重算；超长源码由高亮器自己退化成纯文本，避免每次按键都卡。
 * 末尾补一个换行：`<pre>` 会丢掉最后一个空行，那样高亮层会比 textarea 少一行高度。
 */
function syncHighlight() {
	if (!highlightCodeElement) {
		return false;
	}
	highlightCodeElement.innerHTML = `${highlightToHtml(editorText(), language)}\n`;
	syncScroll();
	return true;
}

function setEditorText(text) {
	if (!editorElement) {
		return;
	}
	editorElement.value = String(text ?? '');
	syncGutter(true);
	syncHighlight();
	// 宿主推来的内容与磁盘一致，不算脏
	setDirty(false);
}

function insertAtCursor(text) {
	if (!editorElement) {
		return false;
	}
	const start = editorElement.selectionStart ?? 0;
	const end = editorElement.selectionEnd ?? start;
	editorElement.setRangeText(text, start, end, 'end');
	syncGutter(false);
	syncHighlight();
	return true;
}

let saveCounter = 0;
let renderCounter = 0;

function saveText() {
	if (!hostApi || !editorElement) {
		setStatus('无法保存：宿主不可用');
		return false;
	}
	setStatus('正在保存…');
	hostApi.postMessage({ type: 'wispkit.saveText', requestId: `save-${++saveCounter}`, text: editorText() });
	return true;
}

function requestRender() {
	if (!hostApi || !editorElement) {
		setStatus('无法渲染：宿主不可用');
		return false;
	}
	setStatus('正在渲染…');
	hostApi.postMessage({ type: 'wispkit.renderXaml', requestId: `render-${++renderCounter}`, text: editorText() });
	return true;
}

function setStatus(text) {
	if (statusElement) {
		statusElement.textContent = text;
	}
}

function updateStatus(result) {
	if (!result || result.ok !== true) {
		setStatus(`渲染失败${result?.errorType ? ` · ${result.errorType}` : ''}`);
		return;
	}
	setStatus([
		'渲染成功',
		result.root ? `root=${result.root}` : '',
		result.width && result.height ? `${result.width}×${result.height}` : '',
		result.mode ? `mode=${result.mode}` : '',
	].filter(Boolean).join(' · '));
}

function showImage(src) {
	if (!image || !viewport) {
		return;
	}
	errorPanel?.setAttribute('hidden', '');
	viewport.removeAttribute('hidden');
	image.setAttribute('src', src);
	if (image.complete && image.naturalWidth > 0) {
		fitImage();
	} else {
		image.addEventListener('load', fitImage, { once: true });
	}
}

function showError(result) {
	viewport?.setAttribute('hidden', '');
	if (!errorPanel) {
		return;
	}
	errorPanel.removeAttribute('hidden');
	if (errorTypeElement) {
		errorTypeElement.textContent = result?.errorType || '未知错误类型';
	}
	if (errorMessageElement) {
		errorMessageElement.textContent = result?.error || '渲染器没有给出原因';
	}
}

/** 宿主在磁盘文件被外部改动时推来的整页更新。 */
function applyUpdate(message) {
	if (typeof message.code === 'string' && editorElement && document.activeElement !== editorElement) {
		setEditorText(message.code);
	}
	const result = message.result ?? {};
	if (typeof message.imageSrc === 'string' && message.imageSrc) {
		showImage(message.imageSrc);
	} else {
		showError(result);
	}
	updateStatus(result);
}

if (editorElement) {
	editorElement.addEventListener('input', () => {
		syncGutter(false);
		syncHighlight();
		setDirty(true);
	});
	editorElement.addEventListener('scroll', syncScroll);
	editorElement.addEventListener('keydown', event => {
		if (event.key === 'Tab') {
			event.preventDefault();
			insertAtCursor(TAB);
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			saveText();
		}
	});
}

// ---- 工具栏 ----

saveButton?.addEventListener('click', () => {
	saveText();
});
rerenderButton?.addEventListener('click', () => {
	requestRender();
});
lightboxButton?.addEventListener('click', () => {
	openLightbox();
});
fitButton?.addEventListener('click', () => {
	fitImage();
});
layoutButtons.both?.addEventListener('click', () => {
	setLayoutMode('both');
});
layoutButtons.code?.addEventListener('click', () => {
	setLayoutMode('code');
});
layoutButtons.preview?.addEventListener('click', () => {
	setLayoutMode('preview');
});

// ---- 源码栏宽度 ----

if (splitter && layout) {
	let dragging = false;

	splitter.addEventListener('pointerdown', event => {
		if (event.button !== 0) {
			return;
		}
		dragging = true;
		splitter.classList.add('wispkit-xaml-resizing');
		splitter.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	});
	splitter.addEventListener('pointermove', event => {
		if (!dragging) {
			return;
		}
		const left = layout.getBoundingClientRect().left;
		codeWidth = clampCodeWidth(event.clientX - left);
		applyCodeWidth();
	});
	const endDrag = event => {
		if (!dragging) {
			return;
		}
		dragging = false;
		splitter.classList.remove('wispkit-xaml-resizing');
		splitter.releasePointerCapture?.(event.pointerId);
	};
	splitter.addEventListener('pointerup', endDrag);
	splitter.addEventListener('pointercancel', endDrag);
	splitter.addEventListener('dblclick', () => {
		codeWidth = DEFAULT_CODE_WIDTH;
		applyCodeWidth();
	});
}

// ---- 宿主消息 ----

window.addEventListener('message', event => {
	const message = event.data;
	if (!message || typeof message !== 'object') {
		return;
	}
	if (message.type === 'wispkit.saveResult') {
		setStatus(message.ok ? '已保存' : `保存失败：${message.error || '未知原因'}`);
		if (message.ok) {
			setDirty(false);
		}
	} else if (message.type === 'wispkit.xamlRendered') {
		if (message.ok && typeof message.imageSrc === 'string' && message.imageSrc) {
			showImage(message.imageSrc);
		} else {
			showError(message);
		}
		updateStatus(message);
	} else if (message.type === 'wispkit.xaml.update') {
		applyUpdate(message);
	} else if (message.type === 'wispkit.xaml.error') {
		showError(message.result ?? {});
		updateStatus(message.result ?? {});
	}
});

// ---- 初始化 ----

syncGutter(true);
applyLayout();
syncHighlight();
if (image && image.complete && image.naturalWidth > 0) {
	fitImage();
} else {
	image?.addEventListener('load', fitImage, { once: true });
}
window.addEventListener('resize', () => {
	fitImage();
});

/**
 * 自检用：按真实手势路径模拟一次右键拖动（走 panzoom 自己的 pointer 处理）。
 * 程序化派发的 pointer 事件没有"已按下"状态，浏览器会让 setPointerCapture 抛 NotFoundError，
 * 所以这里临时把它换掉 —— 平移本身不依赖指针捕获。
 */
function pan(dx, dy) {
	if (!viewport || !panZoom) {
		return false;
	}
	const buttonIndex = dragButton === 'left' ? 0 : dragButton === 'middle' ? 1 : 2;
	const EventCtor = typeof window.PointerEvent === 'function' ? window.PointerEvent : window.MouseEvent;

	const originalSet = viewport.setPointerCapture;
	const originalRelease = viewport.releasePointerCapture;
	viewport.setPointerCapture = () => { };
	viewport.releasePointerCapture = () => { };

	try {
		const fire = (type, x, y) => viewport.dispatchEvent(new EventCtor(type, {
			bubbles: true,
			cancelable: true,
			button: buttonIndex,
			buttons: 4,
			clientX: x,
			clientY: y,
			pointerId: 1,
			pointerType: 'mouse',
		}));
		fire('pointerdown', 200, 200);
		fire('pointermove', 200 + dx, 200 + dy);
		fire('pointerup', 200 + dx, 200 + dy);
		return true;
	} finally {
		if (originalSet) {
			viewport.setPointerCapture = originalSet;
		} else {
			delete viewport.setPointerCapture;
		}
		if (originalRelease) {
			viewport.releasePointerCapture = originalRelease;
		} else {
			delete viewport.releasePointerCapture;
		}
	}
}

// 供自动化验证读取：断言项不依赖人眼看
Object.defineProperty(window, '__wispkitSelftest', {
	configurable: true,
	value: {
		editorText,
		gutterLineCount: () => (gutterElement ? gutterElement.querySelectorAll('.wispkit-xaml-gutter-line').length : 0),
		gutterScrollTop: () => (gutterElement ? gutterElement.scrollTop : 0),
		/** 兼容旧钩子：现在指的是编辑器里的行数。 */
		codeLineCount: () => editorLines().length,
		imageLoaded: () => Boolean(image && image.complete && image.naturalWidth > 0),
		zoom: () => (panZoom ? panZoom.scale : 1),
		pan,
		toggleCode,
		openLightbox,
		splitterWidth: () => codeWidth,
		setEditorText,
		typeText: text => {
			if (!editorElement) {
				return false;
			}
			editorElement.value = `${editorElement.value}${text}`;
			editorElement.dispatchEvent(new window.Event('input', { bubbles: true }));
			return true;
		},
		save: saveText,
		requestRender,
		isDirty: () => dirty,
		layoutMode: () => layoutMode,
		setLayoutMode,
		codeVisible: () => layoutMode !== 'preview',
		previewVisible: () => layoutMode !== 'code',
		/** 高亮层的可见字符必须与编辑器逐字相同，否则光标会与显示错位。 */
		highlightText: () => (highlightCodeElement ? highlightCodeElement.textContent : ''),
		highlightHtml: () => (highlightCodeElement ? highlightCodeElement.innerHTML : ''),
		highlightScrollTop: () => (highlightElement ? highlightElement.scrollTop : 0),
		scrollEditorTo: top => {
			if (!editorElement) {
				return false;
			}
			editorElement.scrollTop = top;
			editorElement.dispatchEvent(new window.Event('scroll'));
			return true;
		},
	},
});
