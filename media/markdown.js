import { createContextMenu } from './shared/contextmenu.js';
import { createLightbox } from './shared/lightbox.js';
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

const config = readConfig();
const content = document.getElementById('wispkit-content');
const nav = document.getElementById('wispkit-toc');
const editorToggle = document.getElementById('wispkit-editor-toggle');
const saveButton = document.getElementById('wispkit-save');
const dirtyBadge = document.getElementById('wispkit-dirty');

const toc = createTableOfContents({
	content,
	nav,
	splitter: document.getElementById('wispkit-splitter'),
	depth: config.tocDepth,
	enabled: config.tocEnabled,
	storage,
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

function refresh() {
	notifyPreviewScripts();
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
	content.innerHTML = bodyHtml;
	content.scrollTop = scrollTop;
	sourceRelay.start();
	refresh();
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

function blockItems() {
	return mapBlocksToSpans(content.querySelectorAll('[data-line]'), countLines(paragraphState.source));
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
		textarea.wrap = 'off';
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

/** 编辑模式下的点击：交给段落编辑，不触发图片放大等浏览行为。 */
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

// 位置以记住的为准（初始 HTML 已经按默认的「右侧」渲染，避免首屏闪一下再跳）
applyTocSide();

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
	} else if (message.type === 'wispkit.source') {
		paragraphState.source = typeof message.text === 'string' ? message.text : '';
		paragraphState.loaded = true;
		setDirty(false);
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
