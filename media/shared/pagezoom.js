/**
 * 正文多级缩放（工具栏 − / 百分比 / +，Ctrl+-、Ctrl+=、Ctrl+0 与 Ctrl+滚轮）。
 *
 * 缩放对象是 `.wispkit-content` 里的 **`.wispkit-zoom-layer`**，不是滚动容器本身：
 * - 作用在滚动容器上时，容器自己的宽高也被 `zoom` 放大，会溢出布局，
 *   而且它的 `scrollHeight` 不跟着放大 —— 滚到底也看不到最后一段（实测 Chromium）。
 * - 作用在普通 auto 宽度的内层块上，Chromium 用「先按 1/zoom 排版、再整体放大」处理，
 *   正文宽度不变、文字与图表按比例变大，滚动高度也正确计入（实测 scrollHeight = 内容高度 × zoom）。
 *
 * 级别是固定档位（50%–300%，共 13 级），不是连续倍率 —— 用户按一次就跨一级，
 * 「多级放大缩小」可预期；Ctrl+滚轮也复用同一套档位。
 */

/** 从小到大；100% 必须存在，重置就是回到它。 */
export const DEFAULT_ZOOM_LEVELS = Object.freeze([
	0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
]);

const DEFAULT_LEVEL = 1;

/**
 * 任意输入 → 最接近的档位倍率。
 * 接受倍率（`1.5`）、百分比（`"150%"`、`150`）与数字字符串；非法值回落到 100%。
 * 两种写法都认，是因为持久化里存的是倍率，而用户手改/旧版本可能是百分比。
 */
export function normalizeZoom(value, levels = DEFAULT_ZOOM_LEVELS) {
	const list = levels?.length ? levels : DEFAULT_ZOOM_LEVELS;
	const raw = typeof value === 'string' ? value.trim().replace(/%$/, '') : value;
	const numeric = typeof raw === 'number' ? raw : Number.parseFloat(raw);
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return list.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : list[0];
	}
	const ratio = numeric > 10 ? numeric / 100 : numeric;
	let best = list[0];
	for (const level of list) {
		if (Math.abs(level - ratio) < Math.abs(best - ratio)) {
			best = level;
		}
	}
	return best;
}

/** 倍率 → 整数百分比（用于按钮文字）。 */
export function zoomPercent(level) {
	return Math.round((Number.isFinite(level) ? level : 1) * 100);
}

/** 图块（mermaid / drawio）容器与内部元素：这些元素的测量需要除以缩放倍率，见下方说明。 */
const DIAGRAM_SELECTOR = '.mermaid-wrapper, .mermaid, .drawio, .mxgraph';

/**
 * 修正第三方图块在 CSS zoom 下的测量。
 *
 * 内置 mermaid 扩展会在渲染后用 `svg.getBoundingClientRect()` 量高度、用容器
 * `getBoundingClientRect()` 量宽度，再把结果**当成 CSS px** 写回
 * `container.style.height` / `transform: translate()`。祖先有 `zoom: 2` 时
 * rect 已经是放大后的屏幕尺寸，写回去又被 zoom 放大一次：容器高度翻倍、图向右偏。
 *
 * 所以对「正文层内、图块内」的元素把 rect 的宽高除以当前倍率，left/top 保持屏幕坐标
 * （mermaid 的滚轮锚点用 left/top 减 clientX/clientY，那里必须还是屏幕坐标系）。
 * 只影响图块；标题、正文、表格、搜索 Range 的测量保持原样。
 */
function installDiagramMeasurementFix(doc, target, getLevel) {
	const ElementCtor = doc?.defaultView?.Element;
	if (!ElementCtor || !target) {
		return;
	}
	const proto = ElementCtor.prototype;
	if (proto.__wispkitZoomMeasurementPatched) {
		return;
	}
	const native = proto.getBoundingClientRect;
	Object.defineProperty(proto, '__wispkitZoomMeasurementPatched', { value: true, configurable: true });
	proto.getBoundingClientRect = function patchedGetBoundingClientRect() {
		const rect = native.call(this);
		const level = getLevel();
		if (level === 1 || typeof this.closest !== 'function') {
			return rect;
		}
		if (!this.closest(DIAGRAM_SELECTOR) || !target.contains(this)) {
			return rect;
		}
		const width = rect.width / level;
		const height = rect.height / level;
		const scaled = {
			x: rect.x,
			y: rect.y,
			left: rect.left,
			top: rect.top,
			width,
			height,
			right: rect.left + width,
			bottom: rect.top + height,
		};
		scaled.toJSON = () => ({ ...scaled });
		return scaled;
	};
}

function scrollRatio(target) {
	const scroller = target?.parentElement;
	const scrollHeight = Number(scroller?.scrollHeight);
	const clientHeight = Number(scroller?.clientHeight);
	const scrollTop = Number(scroller?.scrollTop);
	if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || !Number.isFinite(scrollTop)) {
		return null;
	}
	const max = scrollHeight - clientHeight;
	return { scroller, scrollTop, ratio: max > 0 ? scrollTop / max : 0 };
}

function restoreRatio(saved) {
	if (!saved) {
		return;
	}
	const { scroller, ratio } = saved;
	const max = Number(scroller.scrollHeight) - Number(scroller.clientHeight);
	if (Number.isFinite(max) && max > 0) {
		scroller.scrollTop = ratio * max;
	} else {
		scroller.scrollTop = saved.scrollTop;
	}
}

/**
 * @param {object} options
 * @param {HTMLElement|null} options.target  被缩放的层（写入 `style.zoom`）。
 * @param {readonly number[]} [options.levels]
 * @param {unknown} [options.initial]        持久化值（倍率或百分比）。
 * @param {{get?: (key: string) => string|null, set?: (key: string, value: string) => void}} [options.storage]
 * @param {string} [options.storageKey]
 * @param {(state: { level: number, index: number, percent: number, atMin: boolean, atMax: boolean }) => void} [options.onChange]
 */
export function createPageZoom(options = {}) {
	const levels = options.levels?.length ? [...options.levels] : [...DEFAULT_ZOOM_LEVELS];
	const target = options.target ?? null;
	const storage = options.storage ?? null;
	const storageKey = options.storageKey ?? 'wispkit.zoom';
	const onChange = typeof options.onChange === 'function' ? options.onChange : null;

	let index = levels.indexOf(normalizeZoom(options.initial, levels));
	if (index < 0) {
		index = Math.max(0, levels.indexOf(DEFAULT_LEVEL));
	}

	/** patch 读的是「已经实际生效」的倍率，避免写 style 前后的中间态。 */
	let appliedLevel = levels[index];
	installDiagramMeasurementFix(target?.ownerDocument, target, () => appliedLevel);

	const state = () => ({
		level: levels[index],
		index,
		percent: zoomPercent(levels[index]),
		atMin: index === 0,
		atMax: index === levels.length - 1,
	});

	const apply = ({ persist = false, preserveScroll = true, notify = true } = {}) => {
		const level = levels[index];
		appliedLevel = level;
		const saved = preserveScroll ? scrollRatio(target) : null;
		if (target) {
			// 100% 时移除内联属性：不留下 `zoom: 1` 这种会让某些引擎走不同排版路径的值。
			if (level === 1) {
				target.style.removeProperty('zoom');
			} else {
				target.style.zoom = String(level);
			}
		}
		restoreRatio(saved);
		if (persist && storage?.set) {
			storage.set(storageKey, String(level));
		}
		if (notify && onChange) {
			onChange(state());
		}
		return state();
	};

	const setIndex = (nextIndex, options = {}) => {
		const clamped = Math.max(0, Math.min(levels.length - 1, Math.trunc(nextIndex)));
		const changed = clamped !== index;
		index = clamped;
		// 没换档位也回调一次：按钮的 disabled 状态与标签可以借此重新同步。
		return apply({ persist: changed && options.persist !== false, ...options });
	};

	// 首屏直接套用记住的档位；不落盘（否则只是打开文档就会写一次），也不去动滚动位置。
	apply({ persist: false, preserveScroll: false });

	return {
		get level() {
			return levels[index];
		},
		get index() {
			return index;
		},
		get percent() {
			return zoomPercent(levels[index]);
		},
		get atMin() {
			return index === 0;
		},
		get atMax() {
			return index === levels.length - 1;
		},
		/** 设为任意值（倍率或百分比），会吸附到最近档位。 */
		set(value, opts = {}) {
			return setIndex(levels.indexOf(normalizeZoom(value, levels)), opts);
		},
		/** 放大一级；已到上限就保持不动（并重新同步控件状态）。 */
		zoomIn(opts = {}) {
			return setIndex(index + 1, opts);
		},
		zoomOut(opts = {}) {
			return setIndex(index - 1, opts);
		},
		reset(opts = {}) {
			return setIndex(Math.max(0, levels.indexOf(DEFAULT_LEVEL)), opts);
		},
		state,
	};
}
