/**
 * `.lnk` / `.exe` 的打开方式决策。纯函数，不 import vscode，便于单测。
 *
 * 三种用户可见的结果：
 * - `system`：交回操作系统，行为与资源管理器双击一致（含工作目录）；
 * - `subtree`：在 Wispkit 自己的子树面板里跳到目标文件夹；
 * - `file`：用 VS Code 打开目标文件（落在当前窗口）；
 * - `ask`：弹一次选择，让用户当场决定这一次怎么开。
 */

export type ShellLinkOpenBehavior = 'system' | 'internal' | 'ask';
export type ExecutableOpenBehavior = 'system' | 'viewer' | 'ask';

/** 内部打开且目标是文件夹时的落点。 */
export type FolderTargetAction = 'subtree' | 'system';

export type LinkPlan =
	| { readonly kind: 'system' }
	| { readonly kind: 'ask' }
	| { readonly kind: 'unresolved' }
	| { readonly kind: 'subtree'; readonly path: string }
	| { readonly kind: 'file'; readonly path: string };

export type ExecutablePlan =
	| { readonly kind: 'system' }
	| { readonly kind: 'viewer' }
	| { readonly kind: 'ask' };

export interface ResolvedLinkTarget {
	/** lnk 里解析出来的目标路径；缺失时为 undefined。 */
	readonly targetPath?: string;
	/** 目标是否看起来是文件夹（由 lnk 解析器的纯文本启发式给出）。 */
	readonly targetIsFolder: boolean;
}

/** 非空且不是纯空白的目标才算可用。 */
function usablePath(value: string | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function planShellLinkOpen(
	behavior: ShellLinkOpenBehavior,
	folderTarget: FolderTargetAction,
	resolved: ResolvedLinkTarget,
): LinkPlan {
	if (behavior === 'ask') {
		return { kind: 'ask' };
	}
	if (behavior === 'system') {
		return { kind: 'system' };
	}

	const targetPath = usablePath(resolved.targetPath);
	if (!targetPath) {
		// 没有目标路径就没法内部打开：不假装成功，交给调用方提示。
		return { kind: 'unresolved' };
	}
	if (resolved.targetIsFolder) {
		return folderTarget === 'system' ? { kind: 'system' } : { kind: 'subtree', path: targetPath };
	}
	return { kind: 'file', path: targetPath };
}

export function planExecutableOpen(behavior: ExecutableOpenBehavior): ExecutablePlan {
	if (behavior === 'ask') {
		return { kind: 'ask' };
	}
	if (behavior === 'viewer') {
		return { kind: 'viewer' };
	}
	return { kind: 'system' };
}

/** 大小写不敏感的后缀判断，`uri.path` 与 `fsPath` 都能用。 */
export function isShellLinkPath(filePath: string): boolean {
	return /\.lnk$/i.test(filePath);
}

export function isExecutablePath(filePath: string): boolean {
	return /\.exe$/i.test(filePath);
}
