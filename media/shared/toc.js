/**
 * 左侧目录导航：从渲染结果里收集标题 → 建树 → 跟随高亮 → 点击定位。
 * 不依赖任何宿主数据（不需要 data-line 源映射）。
 *
 * 交互：目录栏宽度可拖拽（双击复位）、整栏可收纳、层级可逐个或整体折叠、
 * 点击定位时会把目标标题滚进视野并把对应目录项展开+高亮。
 */

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const ACTIVE_OFFSET_PX = 24;
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 120;
/** 拖拽上限按布局宽度取比例，避免把正文挤没。 */
const MAX_WIDTH_RATIO = 0.6;

const KEY_WIDTH = 'wispkit.toc.width';
const KEY_SIDEBAR = 'wispkit.toc.sidebar';

/**
 * 找最近的、**用户本来就能滚**的祖先容器。
 *
 * 不能拿 `scrollIntoView` 顶替：它会连 `overflow: hidden` 的祖先一起滚（`hidden` 仍然
 * 创建滚动容器，只是不显示滚动条），于是滚完正文之后还会把整个文档顶上去 —— 表现就是
 * 「点目录条目跳转后工具栏被顶出视野」。这里只认 `auto` / `scroll` / `overlay`，
 * 那才是用户预期中的滚动区。找不到返回 null，由调用方决定退路。
 */
function scrollableAncestor(element) {
	const view = element?.ownerDocument?.defaultView;
	if (!view) {
		return null;
	}
	let node = element.parentElement;
	while (node) {
		const overflowY = view.getComputedStyle(node).overflowY;
		const scrolls = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
		if (scrolls && node.scrollHeight > node.clientHeight) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

export function createTableOfContents(options) {
	const content = options.content;
	const nav = options.nav;
	const splitter = options.splitter ?? null;
	const layout = nav.parentElement ?? null;
	const storage = options.storage ?? null;
	/** 观察它的尺寸变化来作废标题位置缓存（正文层；没有时退回正文容器）。 */
	const resizeTarget = options.resizeTarget ?? content;
	/** 正文是否处于大文档虚拟化（`content-visibility: auto`），决定跳转后要不要补正。 */
	const isVirtualized = typeof options.virtualized === 'function' ? options.virtualized : () => false;

	const readSetting = (key, fallback) => {
		try {
			const value = storage?.get?.(key);
			return typeof value === 'string' && value !== '' ? value : fallback;
		} catch {
			return fallback;
		}
	};
	const writeSetting = (key, value) => {
		try {
			storage?.set?.(key, value);
		} catch {
			// 持久化失败不影响本次使用
		}
	};

	// Markdown 规范只有六级标题（h1–h6），默认全部收录；`wispkit.toc.depth` 可再收窄。
	let depth = options.depth ?? 6;
	let enabled = options.enabled !== false;
	let headings = [];
	let byId = new Map();
	const collapsedIds = new Set();
	let activeElement = null;
	let frame = 0;

	let sidebarVisible = readSetting(KEY_SIDEBAR, '1') !== '0';
	let width = Number.parseInt(readSetting(KEY_WIDTH, ''), 10);
	if (!Number.isFinite(width)) {
		width = DEFAULT_WIDTH;
	}
	width = Math.max(MIN_WIDTH, width);

	const clampWidth = value => {
		const available = layout?.getBoundingClientRect?.().width ?? 0;
		// jsdom 里布局尺寸为 0，此时只保证下限，不因 0 而把宽度压成负数
		const upper = available > 0 ? Math.max(MIN_WIDTH, available * MAX_WIDTH_RATIO) : Number.MAX_SAFE_INTEGER;
		return Math.round(Math.min(Math.max(value, MIN_WIDTH), upper));
	};

	const applyWidth = () => {
		nav.style.width = `${width}px`;
	};

	const applySidebar = () => {
		const visible = enabled && sidebarVisible;
		nav.hidden = !visible;
		if (splitter) {
			splitter.hidden = !visible;
		}
		if (visible) {
			applyWidth();
		}
	};

	const setActive = element => {
		if (element === activeElement) {
			return;
		}
		if (activeElement) {
			activeElement.classList.remove('wispkit-toc-active');
			activeElement.removeAttribute('aria-current');
		}
		activeElement = element;
		if (activeElement) {
			activeElement.classList.add('wispkit-toc-active');
			activeElement.setAttribute('aria-current', 'true');
		}
	};

	/**
	 * 标题在「正文滚动坐标」里的位置缓存。
	 *
	 * 原来每帧对**所有标题**调 `getBoundingClientRect()`：400 KB、上千标题的文档里
	 * 每次滚动都要触发一次全文档布局，点目录跳转后尤其明显。缓存之后每帧只做一次
	 * 二分查找；只有尺寸真的变了才重新量一遍。缓存失效来源：
	 * - 重建 / 缩放 / 窗口或正文尺寸变化（ResizeObserver）；
	 * - 老引擎没有 ResizeObserver 时，每 500 ms 在滚动里核对一次 scrollHeight 兜底。
	 */
	let positions = null;
	let positionScrollHeight = -1;
	let lastHeightCheck = 0;

	const measurePositions = () => {
		if (!headings.length) {
			positions = [];
			return;
		}
		// 换算到「scrollTop = 0 时的视觉位置」：rect.top - 容器 rect.top + scrollTop。
		// CSS zoom 作用在内层正文层上，scrollTop 与 rect 的差值都是放大后的像素，单位一致。
		const base = content.getBoundingClientRect().top - content.scrollTop;
		positions = headings.map(entry => entry.element.getBoundingClientRect().top - base);
		positionScrollHeight = content.scrollHeight;
	};

	const updateActive = () => {
		if (headings.length === 0) {
			setActive(null);
			return;
		}
		if (!positions || positions.length !== headings.length) {
			measurePositions();
		}
		const y = content.scrollTop + ACTIVE_OFFSET_PX;
		let low = 0;
		let high = positions.length - 1;
		let best = 0;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (positions[mid] <= y) {
				best = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		setActive(headings[best]?.link ?? null);
	};

	const onScroll = () => {
		if (frame) {
			return;
		}
		frame = requestAnimationFrame(() => {
			frame = 0;
			// scrollHeight 变了 = 图片 / mermaid / 虚拟化块改变了布局；位置缓存要重算。
			// 每秒最多查一次，避免每帧强制布局。
			const now = Date.now();
			if (positions && now - lastHeightCheck > 500) {
				lastHeightCheck = now;
				if (content.scrollHeight !== positionScrollHeight) {
					positions = null;
				}
			}
			updateActive();
		});
	};

	/** 缩放 / 正文重建后由调用方作废缓存；下一次滚动或 reveal 自动重算。 */
	const invalidatePositions = () => {
		positions = null;
		positionScrollHeight = -1;
	};

	/*
	 * 只在**宽度**变化时作废缓存（窗口缩放、目录栏拖宽改变正文宽度）。
	 * 高度变化在虚拟化文档里几乎每次滚动都会发生（块从估算高度换成真实高度），
	 * 若跟着作废，就退化成每帧重新量所有标题 —— 正是这次要消掉的卡顿。
	 * 高度引起的真实偏移变化由上面的 500 ms scrollHeight 兜底检查接管。
	 */
	let resizeObserver = null;
	let observedWidth = null;
	const ResizeObserverCtor = content.ownerDocument?.defaultView?.ResizeObserver ?? null;
	if (typeof ResizeObserverCtor === 'function' && resizeTarget) {
		resizeObserver = new ResizeObserverCtor(entries => {
			const width = entries[0]?.contentRect?.width ?? null;
			if (width === null) {
				invalidatePositions();
				return;
			}
			if (observedWidth !== null && Math.abs(width - observedWidth) > 0.5) {
				invalidatePositions();
			}
			observedWidth = width;
		});
		resizeObserver.observe(resizeTarget);
	}

	const setBranchCollapsed = (id, collapsed) => {
		const entry = byId.get(id);
		if (!entry?.list) {
			return;
		}
		if (collapsed) {
			collapsedIds.add(id);
		} else {
			collapsedIds.delete(id);
		}
		entry.item.classList.toggle('wispkit-toc-collapsed', collapsed);
		entry.twisty?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
	};

	const toggleBranch = id => setBranchCollapsed(id, !collapsedIds.has(id));

	/** 展开某个目录项的所有祖先层级；返回是否命中目录树。 */
	const unfoldTo = id => {
		const entry = byId.get(id);
		if (!entry) {
			return false;
		}
		let parent = entry.item.parentElement;
		while (parent) {
			const parentItem = parent.closest?.('.wispkit-toc-item');
			if (!parentItem) {
				break;
			}
			const parentId = parentItem.dataset.headingId;
			if (parentId) {
				setBranchCollapsed(parentId, false);
			}
			parent = parentItem.parentElement;
		}
		return true;
	};

	const build = () => {
		nav.textContent = '';
		headings = [];
		byId = new Map();
		collapsedIds.clear();
		invalidatePositions();
		setActive(null);

		if (!enabled) {
			applySidebar();
			return;
		}

		const elements = Array.from(content.querySelectorAll(HEADING_SELECTOR))
			.filter(element => Number(element.tagName.slice(1)) <= depth);

		elements.forEach((element, index) => {
			if (!element.id) {
				element.id = `wispkit-heading-${index}`;
			}
		});

		const root = document.createElement('ul');
		root.className = 'wispkit-toc-list';

		const stack = [{ level: 0, list: root }];
		for (const element of elements) {
			const level = Number(element.tagName.slice(1));
			while (stack.length > 1 && stack[stack.length - 1].level >= level) {
				stack.pop();
			}
			const parent = stack[stack.length - 1];

			const item = document.createElement('li');
			item.className = `wispkit-toc-item wispkit-toc-level-${level}`;
			item.dataset.headingId = element.id;

			const link = document.createElement('a');
			link.className = 'wispkit-toc-link';
			link.href = `#${element.id}`;
			link.textContent = element.textContent?.trim() || element.id;
			link.title = link.textContent;
			link.addEventListener('click', event => {
				event.preventDefault();
				reveal(element.id);
			});

			item.appendChild(link);

			// 下一层标题挂到当前标题下（有子标题时才建子列表）
			const childList = document.createElement('ul');
			childList.className = 'wispkit-toc-list';
			item.appendChild(childList);

			parent.list.appendChild(item);
			const entry = { element, link, item, list: null, twisty: null };
			headings.push(entry);
			byId.set(element.id, entry);
			stack.push({ level, list: childList });
		}

		// 去掉没有子项的空列表，并给有子项的条目装上折叠按钮
		for (const entry of headings) {
			const childList = entry.list ?? entry.item.lastElementChild;
			if (!childList || childList.children.length === 0) {
				childList?.remove();
				entry.list = null;
				continue;
			}
			entry.list = childList;

			const twisty = document.createElement('button');
			twisty.type = 'button';
			twisty.className = 'wispkit-toc-twisty';
			twisty.tabIndex = -1;
			twisty.setAttribute('aria-label', '展开或折叠子层级');
			twisty.setAttribute('aria-expanded', 'true');
			// 内联 SVG 箭头（sprite 由页面提供）。折叠态由 CSS 旋转同一个图标表达 ——
			// `<use>` 的 href 换不了，旋转比塞两个图标简单。
			twisty.innerHTML = '<svg class="wispkit-toc-twisty-icon" aria-hidden="true" focusable="false">'
				+ '<use href="#wispkit-icon-chevron-down"></use></svg>';
			twisty.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				toggleBranch(entry.element.id);
			});
			entry.twisty = twisty;
			entry.item.insertBefore(twisty, entry.item.firstChild);
			entry.item.classList.add('wispkit-toc-branch');
		}

		nav.appendChild(root);
		applySidebar();
		updateActive();
	};

	let revealToken = 0;

	/**
	 * 用户一旦自己滚动 / 点击正文，就放弃正在进行的补正 —— 否则虚拟化文档里
	 * 最长 1.2 s 的追帧会把用户刚滚出去的位置又拽回标题。
	 */
	const cancelReveal = () => {
		revealToken += 1;
	};
	content.addEventListener('wheel', cancelReveal, { passive: true });
	content.addEventListener('pointerdown', cancelReveal, { passive: true });
	content.addEventListener('keydown', cancelReveal);

	/**
	 * 虚拟化文档跳转后的补正。
	 *
	 * `content-visibility: auto` 的元素在视口外只有 `contain-intrinsic-size` 的估算高度，
	 * 第一次滚动到的位置可能差几十到几百像素；目标块被真正渲染后高度变了，位置也跟着变。
	 * 这里按帧补滚，直到连续 3 帧差值都小于 1px（最长 1.2 s）—— 只对虚拟化文档生效，
	 * 普通文档一次就准，没必要多跑布局。
	 */
	const settleReveal = (element, scroller) => {
		if (!isVirtualized()) {
			return;
		}
		const view = element.ownerDocument?.defaultView;
		if (!view?.requestAnimationFrame) {
			return;
		}
		const token = ++revealToken;
		const startedAt = Date.now();
		let stableFrames = 0;
		const step = () => {
			if (token !== revealToken || !element.isConnected) {
				return;
			}
			const delta = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			if (Math.abs(delta) > 1) {
				scroller.scrollTop += delta;
				invalidatePositions();
				stableFrames = 0;
			} else {
				stableFrames += 1;
			}
			// 虚拟化块从「估算高度」变成真实高度的过程可能持续多帧（尤其是缩放后
			// 表格 / 图高度全部变化），3 帧不够；以「连续 3 帧差值 < 1px」为收敛条件，
			// 最长追 1.2 s。只量目标一个元素，代价远低于一次全量布局。
			const elapsed = Date.now() - startedAt;
			if (stableFrames < 3 && elapsed < 1200) {
				view.requestAnimationFrame(step);
			}
		};
		view.requestAnimationFrame(step);
	};

	/** 定位到某个标题：展开祖先、滚动正文、高亮目录项、让目录项自身可见。 */
	const reveal = id => {
		const entry = byId.get(id);
		if (!entry) {
			return false;
		}
		unfoldTo(id);
		// 只滚真正的滚动区（正文容器），绝不滚整个文档 —— 见 scrollableAncestor 的说明。
		const scroller = scrollableAncestor(entry.element);
		if (scroller) {
			// 只量目标这一个元素；不需要为了滚动重建整张位置表。
			const delta = entry.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			scroller.scrollTop += delta;
			settleReveal(entry.element, scroller);
		} else {
			entry.element.scrollIntoView?.({ block: 'start', behavior: 'auto' });
		}
		setActive(entry.link);
		// `nearest` 只在目录项不在视野里时才滚，而它的滚动容器就是目录栏自己，
		// 所以这一步不会波及文档。
		entry.link.scrollIntoView?.({ block: 'nearest' });
		return true;
	};

	const setAllCollapsed = collapsed => {
		for (const entry of headings) {
			if (entry.list) {
				setBranchCollapsed(entry.element.id, collapsed);
			}
		}
	};

	/**
	 * 目录栏在正文左边还是右边 —— 决定拖拽位移与宽度的加减关系。
	 * 位置由 `.wispkit-toc-right` 类表达（CSS order 负责视觉顺序），
	 * 所以这里不能读 DOM 顺序：order 不改变 DOM 顺序。
	 */
	const navOnLeft = () => !nav.closest?.('.wispkit-toc-right');

	const attachSplitter = () => {
		if (!splitter) {
			return;
		}
		let dragging = false;

		const onPointerDown = event => {
			if (event.button !== undefined && event.button !== 0) {
				return;
			}
			dragging = true;
			nav.classList.add('wispkit-toc-resizing');
			splitter.setPointerCapture?.(event.pointerId);
			event.preventDefault();
		};
		const onPointerMove = event => {
			if (!dragging) {
				return;
			}
			const box = layout?.getBoundingClientRect?.() ?? { left: 0, right: 0 };
			// 目录栏在右边时宽度是「布局右边缘到指针」；照搬左边的算式会让拖拽方向反过来
			width = clampWidth(navOnLeft() ? event.clientX - box.left : box.right - event.clientX);
			applyWidth();
		};
		const onPointerUp = event => {
			if (!dragging) {
				return;
			}
			dragging = false;
			nav.classList.remove('wispkit-toc-resizing');
			splitter.releasePointerCapture?.(event.pointerId);
			writeSetting(KEY_WIDTH, String(width));
		};

		splitter.addEventListener('pointerdown', onPointerDown);
		splitter.addEventListener('pointermove', onPointerMove);
		splitter.addEventListener('pointerup', onPointerUp);
		splitter.addEventListener('pointercancel', onPointerUp);
		splitter.addEventListener('dblclick', () => {
			width = DEFAULT_WIDTH;
			applyWidth();
			writeSetting(KEY_WIDTH, String(width));
		});
	};

	attachSplitter();
	content.addEventListener('scroll', onScroll, { passive: true });

	return {
		rebuild: build,
		reveal,
		expandAll() {
			setAllCollapsed(false);
		},
		collapseAll() {
			setAllCollapsed(true);
		},
		setSidebarVisible(visible) {
			sidebarVisible = visible;
			applySidebar();
			writeSetting(KEY_SIDEBAR, visible ? '1' : '0');
		},
		toggleSidebar() {
			this.setSidebarVisible(!sidebarVisible);
			return enabled && sidebarVisible;
		},
		setConfig(next) {
			depth = next.tocDepth ?? depth;
			enabled = next.tocEnabled !== false;
			build();
		},
		get headingCount() {
			return headings.length;
		},
		get sidebarVisible() {
			return enabled && sidebarVisible;
		},
		get navWidth() {
			return width;
		},
		invalidatePositions,
		dispose() {
			content.removeEventListener('scroll', onScroll);
			content.removeEventListener('wheel', cancelReveal);
			content.removeEventListener('pointerdown', cancelReveal);
			content.removeEventListener('keydown', cancelReveal);
			resizeObserver?.disconnect?.();
			if (frame) {
				cancelAnimationFrame(frame);
			}
		},
	};
}
