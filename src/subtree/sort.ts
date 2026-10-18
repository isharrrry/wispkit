import { extensionOf, fileCategory, type ColumnId } from './columns';
import type { TreeEntry } from './types';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
	readonly key: ColumnId;
	readonly direction: SortDirection;
}

/** 与资源管理器一致：默认按名称升序。 */
export const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' };

/**
 * 排序用的**原始**可比较值。单元格文本是给人看的（`1.5 KB` 比不出大小），
 * 所以排序必须回到原始值，而不是拿格式化结果比。
 */
function sortValue(entry: TreeEntry, key: ColumnId, owner: string): string | number {
	switch (key) {
		case 'size':
			return entry.isDirectory ? 0 : entry.size;
		case 'mtime':
			return entry.mtime;
		case 'ctime':
			return entry.ctime;
		case 'atime':
			return entry.atime;
		case 'mode':
			return entry.mode;
		case 'owner':
			return owner;
		case 'ext':
			return entry.isDirectory ? '' : extensionOf(entry.name);
		case 'type':
			return fileCategory(entry);
		default:
			return entry.name;
	}
}

function compareValues(left: string | number, right: string | number): number {
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	return String(left).localeCompare(String(right), 'zh-Hans-CN');
}

/**
 * 文件夹**始终**排在前面（和资源管理器一样），升降序只作用于组内 ——
 * 否则点一下降序，文件夹会全跑到列表末尾，反而不像资源管理器。
 * 同值时按名称升序兜底，保证顺序稳定、可复现。
 */
export function sortEntries(
	entries: readonly TreeEntry[],
	state: SortState,
	owner: string,
): TreeEntry[] {
	const factor = state.direction === 'desc' ? -1 : 1;
	return [...entries].sort((left, right) => {
		if (left.isDirectory !== right.isDirectory) {
			return left.isDirectory ? -1 : 1;
		}

		const result = compareValues(sortValue(left, state.key, owner), sortValue(right, state.key, owner));
		if (result !== 0) {
			return result * factor;
		}
		return left.name.localeCompare(right.name, 'zh-Hans-CN');
	});
}

/** 点同一列切方向，点别的列回到升序。 */
export function nextSortState(current: SortState, key: ColumnId): SortState {
	if (current.key !== key) {
		return { key, direction: 'asc' };
	}
	return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

/** 前端来的消息不可信：列不在当前配置里、方向不是枚举值都判为非法。 */
export function parseSortState(
	key: unknown,
	direction: unknown,
	columns: readonly ColumnId[],
): SortState | undefined {
	if (typeof key !== 'string' || !columns.includes(key as ColumnId)) {
		return undefined;
	}
	if (direction !== 'asc' && direction !== 'desc') {
		return undefined;
	}
	return { key: key as ColumnId, direction };
}
