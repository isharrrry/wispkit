/**
 * 刷新（重新解析 Markdown）后恢复左右下拉的选择。
 *
 * 这里的边界条件在真机验收里踩到过：用户主动把左侧选成「不选」后点刷新，
 * 旧实现会无条件把左侧改回第 1 个图元素。规则：
 *   - 之前选中的元素还在（按 id，其次按 name）→ 保持；
 *   - 之前选中的元素被删掉、但文档里还有别的图元素 → 退回第 1 个；
 *   - 用户主动「不选」且文档本来就有图元素 → 保持「不选」；
 *   - 文档本来没有图元素、刷新后有了 → 自动选第 1 个（否则左侧空白让人以为没解析出来）。
 */

export interface SelectableElement {
	readonly id: string;
	readonly name: string;
}

function findIndex(
	previous: SelectableElement | undefined,
	elements: readonly SelectableElement[],
): number {
	if (!previous) {
		return -1;
	}
	const byId = elements.findIndex(element => element.id === previous.id);
	if (byId >= 0) {
		return byId;
	}
	return elements.findIndex(element => element.name === previous.name);
}

export function resolveLeftSelection(
	previous: SelectableElement | undefined,
	elements: readonly SelectableElement[],
	hadElements: boolean,
): number {
	const index = findIndex(previous, elements);
	if (index >= 0) {
		return index;
	}
	if (elements.length === 0) {
		return -1;
	}
	if (previous) {
		return 0;
	}
	return hadElements ? -1 : 0;
}

export function resolveRightSelection(
	previous: SelectableElement | undefined,
	elements: readonly SelectableElement[],
): number {
	return findIndex(previous, elements);
}
