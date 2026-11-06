import type { ResourceTreeStore, ResourceTreeNode } from '../resourceTree/model';
import {
	displayStoredPath,
	resolveStoredPath,
	type WorkspaceFolderLike,
} from '../resourceTree/paths';
import type { CompareRoot } from './defaults';

/**
 * 「对比浏览」两侧路径下拉的候选位置。
 *
 * 纯数据：输入是资源树 store 与工作区列表，输出是可直接 JSON 给 webview 的分组。
 * 自定义资源管理里的**虚拟组**不可浏览，只作为 label 的层级前缀出现。
 */

export type CompareLocationKind = 'common' | 'workspace' | 'resourceTree';

export interface CompareLocation {
	readonly label: string;
	/** 可浏览的真实路径；无法解析工作区占位符时为空字符串，前端置灰。 */
	readonly path: string;
	readonly description: string;
	readonly kind: CompareLocationKind;
}

export interface CompareLocationGroup {
	readonly title: string;
	readonly locations: readonly CompareLocation[];
}

export interface BuildLocationsInput {
	readonly left: CompareRoot;
	readonly right: CompareRoot;
	readonly home: string;
	readonly workspaceFolders: readonly WorkspaceFolderLike[];
	readonly store?: ResourceTreeStore;
	readonly folderLikes?: readonly WorkspaceFolderLike[];
	readonly tempDirectory?: string;
}

function normalizeKey(fsPath: string): string {
	if (!fsPath) {
		return '';
	}
	return fsPath.replace(/[\\/]+$/, '').toLowerCase();
}

function folderLocations(
	nodes: readonly ResourceTreeNode[],
	trail: readonly string[],
	likes: readonly WorkspaceFolderLike[],
	out: CompareLocation[],
): void {
	for (const node of nodes) {
		if (node.type === 'folder') {
			const resolved = resolveStoredPath(node.path, likes);
			out.push({
				label: [...trail, node.name].join(' / '),
				path: resolved ?? '',
				description: resolved ?? `${displayStoredPath(node.path, likes)}（无法解析工作区占位符）`,
				kind: 'resourceTree',
			});
			folderLocations(node.children, [...trail, node.name], likes, out);
		} else {
			// 虚拟组不对应磁盘目录，只出现在 label 前缀里。
			folderLocations(node.children, [...trail, node.name], likes, out);
		}
	}
}

export function buildLocationGroups(input: BuildLocationsInput): CompareLocationGroup[] {
	const groups: CompareLocationGroup[] = [];
	const common: CompareLocation[] = [];
	const seen = new Set<string>();

	const addCommon = (label: string, fsPath: string, kind: CompareLocationKind = 'common'): void => {
		const key = normalizeKey(fsPath);
		if (!fsPath || seen.has(key)) {
			return;
		}
		seen.add(key);
		common.push({ label, path: fsPath, description: fsPath, kind });
	};

	addCommon(input.left.label, input.left.path);
	addCommon(input.right.label, input.right.path);
	addCommon('主目录', input.home);
	addCommon('临时目录', input.tempDirectory ?? '');
	if (common.length > 0) {
		groups.push({ title: '常用位置', locations: common });
	}

	if (input.workspaceFolders.length > 0) {
		groups.push({
			title: '工作区',
			locations: input.workspaceFolders.map(folder => ({
				label: folder.name || folder.fsPath,
				path: folder.fsPath,
				description: folder.fsPath,
				kind: 'workspace' as const,
			})),
		});
	}

	if (input.store) {
		const locations: CompareLocation[] = [];
		folderLocations(
			input.store.roots,
			[],
			input.folderLikes ?? input.workspaceFolders,
			locations,
		);
		if (locations.length > 0) {
			groups.push({ title: '自定义资源管理', locations });
		}
	}

	return groups;
}
