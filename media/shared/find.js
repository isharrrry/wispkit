/**
 * 正文查找（Ctrl+F）：关键字高亮 + 上一个 / 下一个跳转 + 命中计数。
 *
 * 高亮优先用 **CSS Custom Highlight API**（Chromium 105+；当前 VS Code webview 有）：
 * 它只登记 `Range`，一个 DOM 节点都不改 —— 段落就地编辑的 `data-line` 源映射、
 * mermaid / drawio 的异步替换都不会被搜索打扰。
 *
 * 老引擎（扩展自己声明支持到 VS Code 1.71，对应 Chromium 102，没有这个 API）退回到
 * `<mark>` 包裹。退回路径有两个硬约束：
 * 1. 只包裹**落在同一个文本节点内**的匹配 —— 跨节点的 `<mark>` 会被拆得七零八落；
 * 2. 只包前 `FALLBACK_MARK_LIMIT` 个匹配 —— 400 KB 文档里搜一个常见字可能有上万次命中，
 *    逐条改 DOM 反而把页面卡死。命中计数与跳转仍然覆盖全部匹配。
 */

const MATCH_LIMIT = 5000;
const FALLBACK_MARK_LIMIT = 500;
const SEARCH_DEBOUNCE_MS = 90;

const ALL_HIGHLIGHT = 'wispkit-find-match';
const CURRENT_HIGHLIGHT = 'wispkit-find-current';

/** 搜索不会进入这些元素里的文本。 */
const SKIP_SELECTOR = 'script, style, noscript, template, textarea';

/**
 * 「块级」标签用来插分隔符：跨块拼接的文字不能命中（`<p>foo</p><p>bar</p>` 里搜 `foobar`
 * 不该命中），而同一块内被 `<strong>` / `<a>` 拆开的文本应当可以连续命中。
 */
const BLOCK_TAGS = new Set([
	'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
	'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
	'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY',
	'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 纯函数：在一段文本里找所有**不重叠**的命中。
 *
 * 区分大小写走 `indexOf`；不区分走带 `i` 的正则 —— 正则返回的 `index` 始终是**原文**偏移，
 * 不会出现 `toLowerCase()` 改变字符串长度（某些 Unicode 字符会）导致高亮错位的问题。
 *
 * @returns {{ matches: { start: number, end: number }[], truncated: boolean }}
 */
export function findTextMatches(text, query, options = {}) {
	const limit = Number.isFinite(options.limit) && options.limit > 0
		? Math.floor(options.limit)
		: MATCH_LIMIT;
	if (typeof text !== 'string' || typeof query !== 'string' || query.length === 0 || text.length === 0) {
		return { matches: [], truncated: false };
	}

	const matches = [];
	if (options.caseSensitive === true) {
		let from = 0;
		while (matches.length < limit) {
			const index = text.indexOf(query, from);
			if (index < 0) {
				break;
			}
			matches.push({ start: index, end: index + query.length });
			from = index + Math.max(1, query.length);
		}
		const truncated = matches.length >= limit && text.indexOf(query, from) >= 0;
		return { matches, truncated };
	}

	const pattern = new RegExp(escapeRegExp(query), 'gi');
	let found;
	while (matches.length < limit && (found = pattern.exec(text)) !== null) {
		matches.push({ start: found.index, end: found.index + found[0].length });
		if (found[0].length === 0) {
			// 空匹配理论上不会出现（query 非空），但正则的 lastIndex 保护留着更稳。
			pattern.lastIndex += 1;
		}
	}
	const truncated = matches.length >= limit && pattern.exec(text) !== null;
	return { matches, truncated };
}

function closestBlock(node, root) {
	let element = node.parentElement;
	while (element && element !== root) {
		if (BLOCK_TAGS.has(element.tagName)) {
			return element;
		}
		element = element.parentElement;
	}
	return root;
}

/**
 * 把根节点下的文本节点拼成一条可搜索的字符串，并记住每段在字符串里的区间。
 * 块与块之间插入 `\n` 作为边界；同一块内不插，保证 `Hello <strong>World</strong>` 能搜到。
 *
 * 图块（mermaid / drawio）与 SVG 里的文字不参与搜索：图由第三方脚本异步替换，
 * 登记在其中的 Range 随时会失效；替换前的围栏源码也不该被当成正文命中。
 */
export function collectTextSegments(root) {
	const doc = root?.ownerDocument;
	if (!doc?.createTreeWalker) {
		return { text: '', segments: [] };
	}
	const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
		acceptNode(node) {
			if (!node.nodeValue) {
				return 3; /* FILTER_REJECT */
			}
			const parent = node.parentElement;
			if (!parent || parent.closest(SKIP_SELECTOR)
				|| parent.closest('svg, .mermaid, .drawio, .mxgraph')) {
				return 3;
			}
			return 1; /* FILTER_ACCEPT */
		},
	});

	const segments = [];
	let text = '';
	let lastBlock = null;
	let node = walker.nextNode();
	while (node) {
		const block = closestBlock(node, root);
		if (lastBlock !== null && block !== lastBlock) {
			text += '\n';
		}
		const start = text.length;
		text += node.nodeValue;
		segments.push({ node, start, end: text.length });
		lastBlock = block;
		node = walker.nextNode();
	}
	return { text, segments };
}

/** 命中偏移 → 所在文本段（二分；段按 start 递增且互不重叠）。 */
function segmentAt(segments, offset) {
	let low = 0;
	let high = segments.length - 1;
	let candidate = null;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (segments[mid].start <= offset) {
			candidate = segments[mid];
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return candidate && offset < candidate.end ? candidate : null;
}

/** 用当前文本段给一个命中建 DOM Range；命中跨块（理论上被分隔符挡住）时返回 null。 */
function rangeFor(segments, match) {
	const start = segmentAt(segments, match.start);
	const end = segmentAt(segments, match.end - 1);
	if (!start || !end) {
		return null;
	}
	const range = start.node.ownerDocument.createRange();
	range.setStart(start.node, match.start - start.start);
	range.setEnd(end.node, match.end - end.start);
	return range;
}

/** 引擎是否支持 CSS Custom Highlight API。 */
function highlightSupport(doc) {
	const view = doc?.defaultView;
	const registry = view?.CSS?.highlights ?? null;
	const Ctor = view?.Highlight ?? null;
	return registry && typeof Ctor === 'function' ? { registry, Ctor } : null;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.content       滚动容器（跳转时改它的 scrollTop）。
 * @param {HTMLElement} options.root          搜索范围（正文层；不含查找栏）。
 * @param {HTMLElement} options.bar           查找栏根元素。
 * @param {HTMLInputElement} options.input
 * @param {HTMLElement} options.count
 * @param {HTMLButtonElement} [options.prevButton]
 * @param {HTMLButtonElement} [options.nextButton]
 * @param {HTMLButtonElement} [options.caseButton]
 * @param {HTMLButtonElement} [options.closeButton]
 * @param {(open: boolean) => void} [options.onOpenChange]
 */
export function createFinder(options) {
	const content = options.content;
	const root = options.root ?? content;
	const bar = options.bar;
	const input = options.input;
	const count = options.count ?? null;
	const prevButton = options.prevButton ?? null;
	const nextButton = options.nextButton ?? null;
	const caseButton = options.caseButton ?? null;
	const closeButton = options.closeButton ?? null;
	const onOpenChange = typeof options.onOpenChange === 'function' ? options.onOpenChange : null;

	let open = false;
	let caseSensitive = false;
	let query = '';
	let matches = [];
	let segments = [];
	let index = -1;
	let truncated = false;
	let fallingBack = false;
	let marks = [];
	let highlight = null;
	let timer = 0;
	let lastQuery = '';

	const doc = content.ownerDocument;
	const view = doc?.defaultView;

	// 统一走 view 的计时器：模块在 jsdom / 浏览器里都要求这个上下文，不依赖全局同名函数。
	const clearTimer = id => {
		if (view?.clearTimeout) {
			view.clearTimeout(id);
		} else {
			clearTimeout(id);
		}
	};
	const startTimer = (callback, delay) => (view?.setTimeout
		? view.setTimeout(callback, delay)
		: setTimeout(callback, delay));

	const highlightRegistry = () => (highlight ? highlight.registry : null);

	const clearRegistry = () => {
		const registry = highlightRegistry();
		if (registry) {
			registry.delete(ALL_HIGHLIGHT);
			registry.delete(CURRENT_HIGHLIGHT);
		}
		highlight = null;
	};

	const clearMarks = () => {
		for (const mark of marks) {
			const parent = mark?.parentNode;
			if (!parent) {
				continue;
			}
			parent.replaceChild(doc.createTextNode(mark.textContent ?? ''), mark);
			parent.normalize?.();
		}
		marks = [];
	};

	const clearHighlights = () => {
		clearRegistry();
		clearMarks();
		fallingBack = false;
	};

	const updateCount = () => {
		if (!count) {
			return;
		}
		if (!query) {
			count.textContent = '';
			count.classList.remove('wispkit-find-empty');
			return;
		}
		if (matches.length === 0) {
			count.textContent = '0/0';
			count.classList.add('wispkit-find-empty');
			return;
		}
		count.textContent = `${index + 1}/${matches.length}${truncated ? '+' : ''}`;
		count.classList.remove('wispkit-find-empty');
	};

	const setCurrentHighlight = () => {
		if (index < 0 || index >= matches.length) {
			clearRegistryCurrent();
			return;
		}
		if (fallingBack) {
			for (let i = 0; i < marks.length; i += 1) {
				marks[i]?.classList?.toggle('wispkit-find-current', i === index);
			}
			return;
		}
		const range = rangeFor(segments, matches[index]);
		if (!highlight || !range) {
			return;
		}
		highlight.registry.set(CURRENT_HIGHLIGHT, new highlight.Ctor(range));
	};

	function clearRegistryCurrent() {
		const registry = highlightRegistry();
		registry?.delete(CURRENT_HIGHLIGHT);
	}

	const applyHighlights = () => {
		clearHighlights();
		if (matches.length === 0) {
			return;
		}
		const support = highlightSupport(doc);
		if (support) {
			const ranges = [];
			for (const match of matches) {
				const range = rangeFor(segments, match);
				if (range) {
					ranges.push(range);
				}
			}
			highlight = support;
			support.registry.set(ALL_HIGHLIGHT, new support.Ctor(...ranges));
			return;
		}

		// 老引擎退回 <mark>：倒序处理，后一次 splitText 不会让前面命中的偏移失效。
		fallingBack = true;
		marks = new Array(matches.length).fill(null);
		const limit = Math.min(matches.length, FALLBACK_MARK_LIMIT);
		for (let i = limit - 1; i >= 0; i -= 1) {
			const match = matches[i];
			const start = segmentAt(segments, match.start);
			const end = segmentAt(segments, match.end - 1);
			if (!start || start !== end) {
				continue;
			}
			const range = rangeFor(segments, match);
			if (!range) {
				continue;
			}
			const mark = doc.createElement('mark');
			mark.className = 'wispkit-find-hit';
			try {
				range.surroundContents(mark);
				marks[i] = mark;
			} catch {
				// 跨节点 / 节点不允许插入时放弃这一条的视觉高亮，不影响计数与跳转。
			}
		}
		// 包完 mark 后文本内容不变、文本节点被拆分；跳转用的映射要按新 DOM 重建一次。
		segments = collectTextSegments(root).segments;
	};

	const scrollToRange = range => {
		if (!range) {
			return false;
		}
		let rect = null;
		try {
			const rects = range.getClientRects?.();
			rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect?.();
		} catch {
			rect = null;
		}
		const box = content.getBoundingClientRect?.() ?? { top: 0 };
		if (rect && (rect.width > 0 || rect.height > 0)) {
			const offset = Math.max(16, Math.round((content.clientHeight || 0) * 0.25));
			content.scrollTop += rect.top - box.top - offset;
			return true;
		}
		// 没有布局信息（或命中在尚未渲染的块里）时，退到起始文本节点所在的块。
		const element = range.startContainer?.parentElement;
		if (!element) {
			return false;
		}
		const elementRect = element.getBoundingClientRect?.();
		if (elementRect && (elementRect.width > 0 || elementRect.height > 0)) {
			content.scrollTop += elementRect.top - box.top - 24;
			return true;
		}
		return false;
	};

	const scrollToActive = () => {
		if (index < 0 || index >= matches.length) {
			return false;
		}
		return scrollToRange(rangeFor(segments, matches[index]));
	};

	const runSearch = ({ keepIndex = false, keepScroll = false } = {}) => {
		if (timer) {
			clearTimer(timer);
			timer = 0;
		}
		clearHighlights();
		query = input?.value ?? '';
		lastQuery = query;
		if (!query) {
			matches = [];
			segments = [];
			index = -1;
			truncated = false;
			updateCount();
			return 0;
		}

		const collected = collectTextSegments(root);
		segments = collected.segments;
		const found = findTextMatches(collected.text, query, { caseSensitive });
		matches = found.matches;
		truncated = found.truncated;
		index = matches.length > 0 ? (keepIndex ? Math.min(Math.max(index, 0), matches.length - 1) : 0) : -1;
		applyHighlights();
		setCurrentHighlight();
		updateCount();
		if (!keepScroll && index >= 0) {
			scrollToActive();
		}
		return matches.length;
	};

	const scheduleSearch = () => {
		if (timer) {
			clearTimer(timer);
		}
		timer = startTimer(() => {
			timer = 0;
			runSearch();
		}, SEARCH_DEBOUNCE_MS);
	};

	const flush = () => {
		if (timer) {
			runSearch();
		}
	};

	const goTo = step => {
		if (matches.length === 0) {
			// 还没搜过（例如 F3 直接进来）：先按当前输入跑一次再跳。
			if (input?.value) {
				runSearch();
			}
			if (matches.length === 0) {
				return false;
			}
		}
		index = ((index + step) % matches.length + matches.length) % matches.length;
		setCurrentHighlight();
		updateCount();
		scrollToActive();
		return true;
	};

	const syncCaseButton = () => {
		if (caseButton) {
			caseButton.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false');
			caseButton.classList.toggle('wispkit-find-active', caseSensitive);
		}
	};

	const openWith = prefill => {
		const wasOpen = open;
		open = true;
		if (bar) {
			bar.hidden = false;
		}
		content.classList.add('wispkit-find-open');
		if (typeof prefill === 'string') {
			input.value = prefill;
		}
		if (!input.value) {
			input.value = lastQuery;
		}
		if (input.value) {
			runSearch({ keepIndex: true });
		} else {
			clearHighlights();
			matches = [];
			segments = [];
			index = -1;
			query = '';
			updateCount();
		}
		input.focus?.();
		input.select?.();
		if (!wasOpen && onOpenChange) {
			onOpenChange(true);
		}
		return true;
	};

	const close = () => {
		if (timer) {
			clearTimer(timer);
			timer = 0;
		}
		lastQuery = input?.value ?? lastQuery;
		const wasOpen = open;
		open = false;
		if (bar) {
			bar.hidden = true;
		}
		content.classList.remove('wispkit-find-open');
		input?.blur?.();
		clearHighlights();
		matches = [];
		segments = [];
		index = -1;
		query = '';
		truncated = false;
		updateCount();
		if (wasOpen && onOpenChange) {
			onOpenChange(false);
		}
		return true;
	};

	const selectedText = () => {
		try {
			const selection = view?.getSelection?.();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
				return '';
			}
			const text = selection.toString();
			if (!text || text.length > 200 || /[\r\n]/.test(text)) {
				return '';
			}
			const anchor = selection.anchorNode;
			if (anchor && !content.contains(anchor)) {
				return '';
			}
			return text;
		} catch {
			return '';
		}
	};

	const openFromShortcut = () => {
		if (open) {
			flush();
			input.focus?.();
			input.select?.();
			return;
		}
		const selection = selectedText();
		openWith(selection || '');
	};

	const onDocumentKeydown = event => {
		const ctrl = event.ctrlKey || event.metaKey;
		if (ctrl && !event.altKey && String(event.key).toLowerCase() === 'f') {
			event.preventDefault();
			openFromShortcut();
			return;
		}
		if (event.key === 'F3') {
			event.preventDefault();
			if (!open) {
				openWith('');
			}
			goTo(event.shiftKey ? -1 : 1);
			return;
		}
		// 段落编辑也监听 Esc（取消当前段）。它先冒泡到正文容器并 preventDefault，
		// 这里不再顺手把查找栏也关掉 —— 一次按键只做一件事。
		if (event.key === 'Escape' && open && !event.defaultPrevented) {
			event.preventDefault();
			close();
		}
	};

	const onInputKeydown = event => {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (timer) {
				runSearch();
			}
			goTo(event.shiftKey ? -1 : 1);
		}
	};

	const onInput = () => {
		scheduleSearch();
	};

	doc.addEventListener('keydown', onDocumentKeydown);
	input?.addEventListener('keydown', onInputKeydown);
	input?.addEventListener('input', onInput);
	prevButton?.addEventListener('click', () => goTo(-1));
	nextButton?.addEventListener('click', () => goTo(1));
	closeButton?.addEventListener('click', close);
	caseButton?.addEventListener('click', () => {
		caseSensitive = !caseSensitive;
		syncCaseButton();
		runSearch();
	});
	syncCaseButton();

	return {
		open: openWith,
		openFromShortcut,
		close,
		runSearch,
		next: () => goTo(1),
		prev: () => goTo(-1),
		setQuery(text) {
			const wasOpen = open;
			input.value = typeof text === 'string' ? text : '';
			open = true;
			if (bar) {
				bar.hidden = false;
			}
			content.classList.add('wispkit-find-open');
			if (!wasOpen && onOpenChange) {
				onOpenChange(true);
			}
			return runSearch();
		},
		setCaseSensitive(value) {
			caseSensitive = value === true;
			syncCaseButton();
			if (query) {
				runSearch({ keepIndex: true });
			}
			return caseSensitive;
		},
		/** 正文被整篇替换：旧 Range / mark 全部失效，查找栏若开着就按原查询重跑。 */
		contentReplaced() {
			clearHighlights();
			matches = [];
			segments = [];
			truncated = false;
			if (open) {
				// 保留当前命中序号与滚动位置：编辑器自动更新（或保存回推）时
				// 不该把正在看的内容弹回第一处命中。
				runSearch({ keepIndex: true, keepScroll: true });
			} else {
				index = -1;
				updateCount();
			}
		},
		dispose() {
			doc.removeEventListener('keydown', onDocumentKeydown);
			input?.removeEventListener('keydown', onInputKeydown);
			input?.removeEventListener('input', onInput);
		},
		get isOpen() {
			return open;
		},
		get query() {
			return query;
		},
		get matchCount() {
			return matches.length;
		},
		get activeIndex() {
			return index;
		},
		get truncated() {
			return truncated;
		},
		get caseSensitive() {
			return caseSensitive;
		},
		get markedCount() {
			return marks.filter(Boolean).length;
		},
		/** 仅供自检：当前是否走 Highlight API。 */
		get usesHighlightApi() {
			return Boolean(highlight);
		},
	};
}
