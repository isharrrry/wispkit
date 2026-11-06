import { folderNameFromPath, type ResourceTreeNode } from './model';
import type { CachedFolderState } from './folderStateCache';

/**
 * TreeItem 的呈现规则。
 *
 * 单独抽出来是为了能在 mocha 里直接测：provider 本身依赖 vscode，
 * 而「警告文案 / 路径说明 / 点击命令」这几条是用户能直接看到的契约。
 */

/**
 * `unknown` 表示「异步 stat 还没回来」：首次展开时先按普通文件夹图标展示，
 * 补取完成后 provider 会再刷新一次；如果只显示 warning 会让首次渲染闪烁。
 */
export type FolderState = CachedFolderState | 'unresolved' | 'unknown';

/** 缓存查询结果 → 呈现状态；从未检查过的路径为 unknown。 */
export function folderStateFromCached(state: CachedFolderState | undefined): FolderState {
	return state ?? 'unknown';
}

/**
 * 判断文件夹状态。`lookup` 对存在的路径返回 directory / file / broken-link，
 * 对不存在的路径抛错（与 stat 抛错的语义一致）。
 */
export function folderStateFrom(
	fsPath: string | undefined,
	lookup: (candidate: string) => 'directory' | 'file' | 'broken-link',
): FolderState {
	const value = fsPath?.trim();
	if (!value) {
		return 'unresolved';
	}
	try {
		return lookup(value);
	} catch {
		return 'missing';
	}
}

/** 文件夹节点的 description：目录内显示相对路径，异常状态给警告文案。 */
export function folderDescription(name: string, state: FolderState, relative: string): string {
	if (state === 'missing') {
		return '⚠ 文件夹不存在';
	}
	if (state === 'broken-link') {
		// stat 对断链会成功返回只有 SymbolicLink 位的项；不能报「不是文件夹」，
		// 否则用户会以为路径指向了文件，而实际是链接目标被删除 / 移动了。
		return '⚠ 链接已断开';
	}
	if (state === 'file') {
		return '⚠ 不是文件夹';
	}
	if (state === 'unresolved') {
		return '⚠ 路径无法解析';
	}
	if (state === 'unknown') {
		// 状态还没取回来：不显示警告，避免首次展开时闪一下「不存在」。
		return '';
	}
	// 相对路径和显示名相同时（例如工作区根下的 docs），重复一遍没有意义。
	return relative && relative !== name ? relative : '';
}

/** tooltip 里“当前是否可打开”的提示。 */
export function folderOpenHint(state: FolderState): string {
	if (state === 'unknown') {
		return '正在检查文件夹状态…';
	}
	if (state === 'broken-link') {
		return '⚠ 链接目标不存在，当前不可打开';
	}
	return state === 'directory' ? '点击可在 Wispkit 子树浏览器中打开' : '⚠ 当前不可打开';
}

/**
 * 单击节点的命令。
 *
 * 文件夹 → 打开子树面板；虚拟组 → 同一个命令，由命令层提示“不能浏览”。
 * 两种节点都给 command，避免用户点了虚拟组却毫无反馈。
 */
export function clickCommandFor(node: ResourceTreeNode): { command: string; title: string } {
	return {
		command: 'wispkit.resourceTree.openFolder',
		title: node.type === 'folder' ? '浏览文件夹' : '虚拟组不能浏览',
	};
}

/**
 * 「在终端中打开」的终端标签名。
 *
 * 需求要求标签优先用用户起的别名：`node.name` 就是树里的显示名（添加时可改，
 * 之后还能重命名），没有别名时它本身就是文件夹名。只有手工编辑 JSON 等情况
 * 导致名字为空白时，才回退到路径最后一段，避免出现无标题终端。
 */
export function terminalNameFor(node: ResourceTreeNode): string {
	const name = node.name.trim();
	if (name) {
		return name;
	}
	return node.type === 'folder' ? folderNameFromPath(node.path) : '终端';
}
