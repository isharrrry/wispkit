/**
 * 「对比浏览」左右拖动的**纯逻辑**：拖拽意图判定、路径去重、刷新目录计算。
 *
 * 不 import vscode / fs —— 拖放语义（默认复制、按住 Ctrl 才移动）是产品约定，
 * 必须在没有文件系统的单测里也能覆盖到，宿主只负责真正的读盘与落盘。
 */

import * as path from 'node:path';

/**
 * 对比浏览拖拽源写入 DataTransfer 的私有类型。
 *
 * 左右两侧在同一个 webview 文档里，正常情况下靠前端的拖拽会话就能认出「自己人」；
 * 这个 MIME 是给跨面板（子树浏览 → 对比浏览）准备的识别依据。
 */
export const COMPARE_DRAG_MIME = 'application/x-wispkit-compare';

/** 子树浏览器的私有类型：从子树拖进对比浏览时也能被认成内部拖拽。 */
export const SUBTREE_DRAG_MIME = 'application/x-wispkit-subtree';

/**
 * 这次 drop 是否明确要求「移动」。
 *
 * 对比浏览的默认动作是**复制**，只有「拖拽源自 Wispkit 面板」且「前端明确要求移动」
 * 两个条件同时成立才移动。系统 / 其他应用拖入的 Ctrl 在资源管理器里恰恰是复制，
 * 不能反过来解释成移动（会误删源文件）。
 */
export function isMoveDropRequested(message: {
	readonly internalDrag?: unknown;
	readonly moveRequested?: unknown;
	/** 原始键态：保留在消息里便于诊断，但**不作为**移动依据。 */
	readonly ctrlKey?: unknown;
}): boolean {
	return message.internalDrag === true && message.moveRequested === true;
}

/** 前端传来的路径数组：去掉非字符串、空串与重复项，保持原顺序。 */
export function readDropPaths(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== 'string') {
			continue;
		}
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/**
 * `candidate` 是否在 `root` 里面（含相等）。用于两个判断：
 * - 拖放目标必须落在该侧浏览根目录内；
 * - 文件夹不能放进它自己的子孙里。
 */
export function isSameOrInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 拖放完成后需要重新读取的目录：
 * - 目标目录（复制/移动都会改变它）；
 * - 移动时还有每个源的父目录（源被拿走了）。
 * 复制不改源目录，不刷新。
 */
export function refreshDirectories(
	targetDir: string,
	sources: readonly string[],
	operation: 'copy' | 'move',
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (value: string): void => {
		if (value && !seen.has(value)) {
			seen.add(value);
			out.push(value);
		}
	};
	add(targetDir);
	if (operation === 'move') {
		for (const source of sources) {
			add(path.dirname(source));
		}
	}
	return out;
}
