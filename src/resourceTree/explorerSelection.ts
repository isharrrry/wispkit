import * as path from 'node:path';
import { folderNameFromPath } from './model';
import { toStoredPath, type WorkspaceFolderLike } from './paths';

/**
 * 资源管理器右键「添加到自定义资源管理」的实参归一化与批量添加计划。
 *
 * VS Code 的 `explorer/context` 对单选和多选都传两个实参（已在 1.137.0 真机探针确认）：
 *   args[0] = 被点击项 Uri
 *   args[1] = 完整选区 Uri[]（含被点击项）
 * 命令也可能被程序化调用成 `(Uri)` 或 `(Uri[])`，所以这里两种形态都接受。
 *
 * 模块不依赖 vscode，便于单测；stat 由调用方注入。
 */

export interface UriLike {
	readonly fsPath?: string;
	readonly path?: string;
}

export interface ExplorerFolderItem {
	readonly name: string;
	readonly path: string;
}

export type UriClassification = 'directory' | 'not-directory' | { readonly error: string };

export interface ExplorerAddOptions {
	readonly folders: readonly WorkspaceFolderLike[];
	readonly classify: (uri: UriLike) => Promise<UriClassification>;
	/** 仅单选目录时调用；多选不逐个弹输入框。 */
	readonly promptName?: (defaultName: string) => Promise<string | undefined>;
}

export type ExplorerAddPlan =
	| { readonly kind: 'no-selection' }
	| { readonly kind: 'invalid-single' }
	| { readonly kind: 'stat-failed'; readonly message: string }
	| { readonly kind: 'no-folders'; readonly skipped: number }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'ready'; readonly items: readonly ExplorerFolderItem[]; readonly skipped: number };

export function isUriLike(value: unknown): value is UriLike {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.fsPath === 'string' || typeof record.path === 'string';
}

export function uriPath(uri: UriLike): string {
	return typeof uri.fsPath === 'string' && uri.fsPath.length > 0 ? uri.fsPath : (uri.path ?? '');
}

/** 同一批次去重用的真实路径键（Windows 不区分大小写，与 paths.samePath 一致）。 */
function selectionKey(uri: UriLike): string {
	const resolved = path.resolve(uriPath(uri)).replace(/\\/g, '/').replace(/\/+$/, '');
	return path.sep === '\\' ? resolved.toLowerCase() : resolved;
}

/** 把 `(Uri)`、`(Uri[])`、`(clickedUri, selectedUris[])` 与混合垃圾统一成一个有序、同批去重的列表。 */
export function normalizeExplorerSelection(args: readonly unknown[]): UriLike[] {
	const ordered: UriLike[] = [];
	for (const arg of args) {
		if (Array.isArray(arg)) {
			for (const item of arg) {
				if (isUriLike(item)) {
					ordered.push(item);
				}
			}
		} else if (isUriLike(arg)) {
			ordered.push(arg);
		}
	}
	// 真机形态下 args[1] 是完整选区，以它为主保持资源管理器里的选择顺序；
	// 单独的 Uri（被点击项）以及其它实参作为补充，最后统一去重。
	const selected = Array.isArray(args[1]) ? args[1].filter(isUriLike) : [];
	const candidates = selected.length > 0 ? [...selected, ...ordered] : ordered;
	const seen = new Set<string>();
	const result: UriLike[] = [];
	for (const candidate of candidates) {
		if (!uriPath(candidate)) {
			continue;
		}
		const key = selectionKey(candidate);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(candidate);
	}
	return result;
}

/**
 * 过滤非目录、生成待添加项。
 *
 * 只有「归一化后恰好一个候选」时才沿用旧的输入框改名行为；多选（含 1 文件 + 1 文件夹）
 * 直接使用 basename，避免每项弹一次输入框卡住，也与「添加文件夹」对话框多选、
 * 外部拖拽多选的行为一致。
 */
export async function planExplorerFolderAdd(
	args: readonly unknown[],
	options: ExplorerAddOptions,
): Promise<ExplorerAddPlan> {
	const uris = normalizeExplorerSelection(args);
	if (uris.length === 0) {
		return { kind: 'no-selection' };
	}
	const items: ExplorerFolderItem[] = [];
	let skipped = 0;
	let firstError: string | undefined;
	for (const uri of uris) {
		const classification = await options.classify(uri);
		if (classification === 'directory') {
			const fsPath = uriPath(uri);
			items.push({
				name: folderNameFromPath(fsPath),
				path: toStoredPath(fsPath, options.folders),
			});
		} else if (classification === 'not-directory') {
			skipped += 1;
		} else {
			skipped += 1;
			firstError ??= classification.error;
		}
	}
	if (uris.length === 1 && items.length === 0) {
		return firstError === undefined
			? { kind: 'invalid-single' }
			: { kind: 'stat-failed', message: firstError };
	}
	if (items.length === 0) {
		return { kind: 'no-folders', skipped };
	}
	if (uris.length === 1 && options.promptName) {
		const input = await options.promptName(items[0].name);
		if (input === undefined) {
			return { kind: 'cancelled' };
		}
		const name = input.trim() || items[0].name;
		items[0] = { name, path: items[0].path };
	}
	return { kind: 'ready', items, skipped };
}
