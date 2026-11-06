import { displayWidth } from './types';

/**
 * 3D 气泡里的文字排版（纯函数，不依赖 DOM / three）。
 *
 * 背景：节点名称画进一个 Sprite。以前按固定宽度折行、只保留前 4 行，
 * 超出的字符被**静默丢掉** —— 长文件名 / 长标题在气泡里只剩前半截。
 * 这里改成：
 *   1. 长名称且没有手动换行时，先把空格、斜杠、反斜杠、横杠换成换行；
 *   2. 按注入的测量函数折行，**不丢弃任何字符**；
 *   3. 二分搜索折行宽度，让整块文字的宽高比接近气泡可用区域的宽高比 ——
 *      Sprite 等比缩放后字号最大，文字仍然完整。
 *
 * 测量函数由调用方注入（webview 用 canvas `measureText`，单测里用字符宽度模拟）。
 */

/** 超过这个显示宽度（中文按 2）才算「长名称」，才启用分隔符预换行。 */
export const LONG_LABEL_WIDTH = 16;

/**
 * 预换行：长名称没有手动换行时，把分隔符换成换行。
 *
 * 只把**分隔符本身**换成换行（`src/graph3d/layout.ts` → `src` / `graph3d` / `layout.ts`），
 * 不删字符；短名称和已经带换行的名称原样返回。横杠包含 Unicode 连字符族
 * （U+2010–U+2015），覆盖中文里常见的 `—`。
 */
export function preWrapLabel(text: string, longWidth = LONG_LABEL_WIDTH): string {
	const label = String(text ?? '').replace(/\r\n?/g, '\n');
	if (label.includes('\n')) {
		return label;
	}
	if (displayWidth(label) <= longWidth) {
		return label;
	}
	return label
		.replace(/[ \t　]+/g, '\n')
		.replace(/[\\/]+/g, '\n')
		.replace(/[-‐-―]+/g, '\n')
		.replace(/\n{2,}/g, '\n')
		.replace(/^\n+|\n+$/g, '');
}

/**
 * 把一行文本切成可断行的最小单位。
 *
 * 中文逐字；英文优先在 `. _ / -` 与 camelCase 边界断开，避免把单词拦腰切开；
 * 空白保留为独立 token，折行时用于分隔（行尾空白会被 trim 掉）。
 */
function tokenize(text: string): string[] {
	const raw = text.match(/[⺀-鿿]|[^\s⺀-鿿]+|\s+/g) ?? [];
	const tokens: string[] = [];
	for (const token of raw) {
		if (/^\s+$/.test(token) || /[⺀-鿿]/.test(token)) {
			tokens.push(token);
			continue;
		}
		const parts = token
			.split(/(?<=[._/-])|(?<=[a-z])(?=[A-Z])/)
			.filter(part => part.length > 0);
		tokens.push(...(parts.length > 0 ? parts : [token]));
	}
	return tokens;
}

function wrapSingleLine(
	measure: (text: string) => number,
	text: string,
	maxWidth: number,
): string[] {
	const tokens = tokenize(text);
	const lines: string[] = [];
	let line = '';
	for (const token of tokens) {
		let rest = token;
		while (rest.length > 0) {
			const candidate = line + rest;
			if (measure(candidate) <= maxWidth) {
				line = candidate;
				break;
			}
			if (line.trim().length > 0) {
				lines.push(line.trimEnd());
				line = '';
				rest = rest.trimStart();
				continue;
			}
			// 单个超长 token（英文单词 / 文件名）按字符切开，否则永远放不进气泡。
			let take = 1;
			while (take < rest.length && measure(rest.slice(0, take + 1)) <= maxWidth) {
				take += 1;
			}
			lines.push(rest.slice(0, take));
			rest = rest.slice(take);
		}
	}
	if (line.trim().length > 0) {
		lines.push(line.trimEnd());
	}
	return lines.length > 0 ? lines : [''];
}

/**
 * 按给定宽度折行，显式换行符保留（空行也保留），结果永远至少一行。
 * 与旧实现的关键区别：**不截断**，调用方拿到的是全部字符。
 */
export function wrapLabelText(
	measure: (text: string) => number,
	text: string,
	maxWidth: number,
): string[] {
	const lines: string[] = [];
	for (const raw of String(text ?? '').split('\n')) {
		lines.push(...wrapSingleLine(measure, raw, maxWidth));
	}
	return lines.length > 0 ? lines : [''];
}

export interface LabelFitMetrics {
	readonly measureMain: (text: string) => number;
	readonly measureDetail: (text: string) => number;
	readonly mainLineHeight: number;
	readonly detailLineHeight: number;
	readonly padding: number;
	/** 气泡可用区域的宽高比（宽 / 高）；文字块越接近它，缩放后字号越大。 */
	readonly targetAspect: number;
	readonly minLineWidth: number;
	readonly maxLineWidth: number;
	/** 次要文字最多显示几行；缺省 3。 */
	readonly detailLimit?: number;
}

export interface LabelFit {
	readonly mainLines: readonly string[];
	readonly detailLines: readonly string[];
	readonly width: number;
	readonly height: number;
}

/**
 * 计算「主文字 + 次要文字」的折行与画布尺寸。
 *
 * 在 `[minLineWidth, maxLineWidth]` 上二分：宽度越大文字块越扁（宽高比越大），
 * 取宽高比最接近 `targetAspect` 的那一版。主文字**全部保留**，只有次要文字
 * 按 `detailLimit` 限行（detail 是类成员 / ER 字段这类附属信息）。
 */
export function fitLabelText(
	mainText: string,
	detail: readonly string[],
	metrics: LabelFitMetrics,
): LabelFit {
	const detailLimit = Math.max(0, metrics.detailLimit ?? 3);
	const detailSource = detail.map(value => String(value ?? '')).join('\n');

	const evaluate = (lineWidth: number): LabelFit & { aspect: number; distance: number } => {
		const mainLines = wrapLabelText(metrics.measureMain, mainText, lineWidth);
		const detailLines = detailLimit > 0 && detailSource.length > 0
			? wrapLabelText(metrics.measureDetail, detailSource, lineWidth).slice(0, detailLimit)
			: [];
		let contentWidth = 0;
		for (const line of mainLines) {
			contentWidth = Math.max(contentWidth, metrics.measureMain(line));
		}
		for (const line of detailLines) {
			contentWidth = Math.max(contentWidth, metrics.measureDetail(line));
		}
		const width = contentWidth + metrics.padding * 2;
		const height = metrics.padding * 2
			+ mainLines.length * metrics.mainLineHeight
			+ detailLines.length * metrics.detailLineHeight;
		const aspect = height > 0 ? width / height : 0;
		return {
			mainLines,
			detailLines,
			width,
			height,
			aspect,
			distance: Math.abs(aspect - metrics.targetAspect),
		};
	};

	const lower = Math.max(1, Math.min(metrics.minLineWidth, metrics.maxLineWidth));
	const upper = Math.max(lower, metrics.maxLineWidth);
	// 固定宽度（短名称 / 预换行 / 手写换行）没有搜索空间：直接算一遍，
	// 否则每个节点会白白重复 20 次折行 + 测量，几百个节点时能明显拖慢重建。
	if (upper <= lower) {
		const only = evaluate(upper);
		return { mainLines: only.mainLines, detailLines: only.detailLines, width: only.width, height: only.height };
	}
	let best = evaluate(upper);
	let low = lower;
	let high = upper;
	for (let step = 0; step < 20; step += 1) {
		const mid = (low + high) / 2;
		const candidate = evaluate(mid);
		if (candidate.distance < best.distance) {
			best = candidate;
		}
		if (candidate.aspect < metrics.targetAspect) {
			low = mid;
		} else {
			high = mid;
		}
	}
	for (const width of [low, high]) {
		const candidate = evaluate(width);
		if (candidate.distance < best.distance) {
			best = candidate;
		}
	}
	return {
		mainLines: best.mainLines,
		detailLines: best.detailLines,
		width: best.width,
		height: best.height,
	};
}
