import * as vscode from 'vscode';
import * as path from 'node:path';
import { createStore, parseStoreJson, serializeStore, type ResourceTreeStore } from './model';
import { isInside, type WorkspaceFolderLike } from './paths';
import {
	DEFAULT_STORAGE_RELATIVE,
	decodeStoreText,
	includeWorkspaceFolderInStorageDescription,
	resolveStoragePath,
	temporarySiblingPath,
	writeFileAtomically,
} from './storageCore';

/**
 * 资源树的落盘位置与读写。
 *
 * 默认放在**第一个工作区文件夹**的 `.WispkitView/resource-tree.json`；可以用
 * `wispkit.resourceTree.file` 改到别的相对 / 绝对路径。文件是普通 JSON，
 * 用户可以在外部编辑后点视图标题栏的「刷新」重新加载。
 *
 * 写入采用「同目录临时文件 + rename」：一次写入失败不会清空旧文件。
 */

export { DEFAULT_STORAGE_RELATIVE };

export interface LoadResult {
	readonly exists: boolean;
	readonly store: ResourceTreeStore;
	readonly warnings: readonly string[];
	readonly error?: string;
}

export interface StorageResolution {
	readonly uri?: vscode.Uri;
	readonly error?: string;
	readonly usedDefault?: boolean;
}

export function workspaceFolderLikes(): WorkspaceFolderLike[] {
	return (vscode.workspace.workspaceFolders ?? []).map(folder => ({
		name: folder.name,
		fsPath: folder.uri.fsPath,
	}));
}

function configuredStoragePath(): string {
	const configuration = vscode.workspace.getConfiguration('wispkit');
	const raw: unknown = configuration.get('resourceTree.file', DEFAULT_STORAGE_RELATIVE);
	return typeof raw === 'string' ? raw : '';
}

/**
 * 当前配置指向的存储文件。
 *
 * 解析失败时返回 `error`（而不是静默退回默认文件）：用户改错配置后
 * 必须看到明确提示，且当前内存中的树不能被换掉。
 */
/** 工作区内的路径用所属文件夹的 URI 拼接，保留 remote / virtual 工作区 scheme。 */
function uriForPath(fsPath: string, folders: readonly vscode.WorkspaceFolder[]): vscode.Uri {
	let best: { folder: vscode.WorkspaceFolder; relative: string } | undefined;
	for (const folder of folders) {
		if (!isInside(folder.uri.fsPath, fsPath)) {
			continue;
		}
		const relative = path.relative(folder.uri.fsPath, fsPath);
		if (!best || folder.uri.fsPath.length > best.folder.uri.fsPath.length) {
			best = { folder, relative };
		}
	}
	if (!best) {
		return vscode.Uri.file(fsPath);
	}
	const segments = best.relative.split(/[\\/]/).filter(segment => segment.length > 0);
	return segments.length > 0 ? vscode.Uri.joinPath(best.folder.uri, ...segments) : best.folder.uri;
}

export function currentStorageResolution(): StorageResolution {
	const resolution = resolveStoragePath(configuredStoragePath(), workspaceFolderLikes());
	if (!resolution.path) {
		return {
			error: resolution.error ?? '无法确定资源树文件的存储位置。',
			usedDefault: resolution.usedDefault,
		};
	}
	return {
		uri: uriForPath(resolution.path, vscode.workspace.workspaceFolders ?? []),
		usedDefault: resolution.usedDefault,
	};
}

export function currentStorageUri(): vscode.Uri | undefined {
	return currentStorageResolution().uri;
}

/** 视图标题旁的简短说明：优先显示工作区相对路径。 */
export function storageDescription(uri: vscode.Uri | undefined): string {
	if (!uri) {
		return '未打开工作区';
	}
	if (uri.scheme === 'file') {
		// 多根时带根名：否则标题里只有 `.WispkitView/resource-tree.json`，
		// 移除 / 重排根后看不出存储已经切换到另一个根。
		const includeFolder = includeWorkspaceFolderInStorageDescription(vscode.workspace.workspaceFolders?.length ?? 0);
		const relative = vscode.workspace.asRelativePath(uri, includeFolder);
		return relative || uri.fsPath;
	}
	return uri.toString();
}

export function isFileNotFound(error: unknown): boolean {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function readStore(uri: vscode.Uri): Promise<LoadResult> {
	let stat: vscode.FileStat;
	try {
		stat = await vscode.workspace.fs.stat(uri);
	} catch (error) {
		if (isFileNotFound(error)) {
			return { exists: false, store: createStore(), warnings: [] };
		}
		return {
			exists: false,
			store: createStore(),
			warnings: [],
			error: `无法访问资源树文件 ${uri.fsPath || uri.toString()}：${errorText(error)}`,
		};
	}
	if (stat.type & vscode.FileType.Directory) {
		return {
			exists: true,
			store: createStore(),
			warnings: [],
			error: `资源树路径是一个目录：${uri.fsPath || uri.toString()}。wispkit.resourceTree.file 必须指向一个 JSON 文件。`,
		};
	}
	let bytes: Uint8Array;
	try {
		bytes = await vscode.workspace.fs.readFile(uri);
	} catch (error) {
		return {
			exists: true,
			store: createStore(),
			warnings: [],
			error: `读取资源树文件失败：${errorText(error)}`,
		};
	}
	const parsed = parseStoreJson(decodeStoreText(bytes));
	return { exists: true, store: parsed.store, warnings: parsed.warnings, error: parsed.error };
}

/** 把任意文本原子地写到 URI（导出与资源树保存共用）。 */
export async function writeTextAtomically(uri: vscode.Uri, text: string): Promise<void> {
	const slash = uri.path.lastIndexOf('/');
	const parent = uri.with({ path: slash > 0 ? uri.path.slice(0, slash) : '/' });
	try {
		await vscode.workspace.fs.createDirectory(parent);
	} catch {
		// 目录已存在 / 虚拟文件系统不支持建目录：继续尝试写文件，失败会在下面抛出。
	}
	const temporary = uri.with({ path: temporarySiblingPath(uri.path) });
	await writeFileAtomically({
		writeFile: async (target, data) => {
			await vscode.workspace.fs.writeFile(target, data);
		},
		rename: async (source, target) => {
			await vscode.workspace.fs.rename(source, target, { overwrite: true });
		},
		delete: async target => {
			await vscode.workspace.fs.delete(target, { useTrash: false, recursive: false });
		},
	}, uri, temporary, new TextEncoder().encode(text));
}

export async function writeStore(uri: vscode.Uri, store: ResourceTreeStore): Promise<void> {
	await writeTextAtomically(uri, serializeStore(store));
}
