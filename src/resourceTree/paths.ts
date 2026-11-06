import * as path from 'node:path';

/**
 * 资源树里的路径统一用「工作区占位符 + POSIX 分隔符」保存：
 *
 *   ${workspaceFolder}/src
 *   ${workspaceFolder:docs}/assets
 *   D:/external/shared
 *
 * 这样同一份 JSON 换到另一台机器 / 另一个工作区目录时，工作区内的文件夹
 * 仍然能解析；工作区外的绝对路径保持原样（换机器自然失效，但不会误指到别处）。
 */

export interface WorkspaceFolderLike {
	readonly name: string;
	readonly fsPath: string;
}

const TOKEN_PATTERN = /^\$\{workspaceFolder(?::([^}]*))?\}(?:\/(.*))?$/;

function toPosix(value: string): string {
	return value.replace(/\\/g, '/');
}

function isWindows(): boolean {
	return path.sep === '\\';
}

function normalizeForCompare(value: string): string {
	const resolved = path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
	return isWindows() ? resolved.toLowerCase() : resolved;
}

export function isInside(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function samePath(left: string, right: string): boolean {
	return normalizeForCompare(left) === normalizeForCompare(right);
}

function findWorkspaceFolder(
	fsPath: string,
	folders: readonly WorkspaceFolderLike[],
): { folder: WorkspaceFolderLike; index: number } | undefined {
	let best: { folder: WorkspaceFolderLike; index: number } | undefined;
	for (let index = 0; index < folders.length; index += 1) {
		const folder = folders[index];
		if (!folder.fsPath || !isInside(folder.fsPath, fsPath)) {
			continue;
		}
		if (!best || folder.fsPath.length > best.folder.fsPath.length) {
			best = { folder, index };
		}
	}
	return best;
}

export function tokenForFolder(folder: WorkspaceFolderLike, index: number): string {
	if (index === 0) {
		return '${workspaceFolder}';
	}
	const name = folder.name && !folder.name.includes('}') ? folder.name : String(index);
	return `\${workspaceFolder:${name}}`;
}

/** 磁盘绝对路径 → JSON 里保存的路径（尽量用工作区占位符）。 */
export function toStoredPath(fsPath: string, folders: readonly WorkspaceFolderLike[]): string {
	const resolved = path.resolve(fsPath);
	const match = findWorkspaceFolder(resolved, folders);
	if (!match) {
		return toPosix(resolved);
	}
	const relative = path.relative(match.folder.fsPath, resolved);
	const token = tokenForFolder(match.folder, match.index);
	if (!relative) {
		return token;
	}
	return `${token}/${toPosix(relative)}`;
}

/** JSON 路径 → 磁盘绝对路径；占位符解析不了时返回 undefined（不要静默指向错误目录）。 */
export function resolveStoredPath(stored: string, folders: readonly WorkspaceFolderLike[]): string | undefined {
	const value = stored.trim();
	if (!value) {
		return undefined;
	}
	const token = TOKEN_PATTERN.exec(value);
	if (token) {
		const selector = (token[1] ?? '').trim();
		let folder: WorkspaceFolderLike | undefined;
		if (!selector) {
			folder = folders[0];
		} else if (/^\d+$/.test(selector)) {
			folder = folders[Number(selector)];
		} else {
			folder = folders.find(item => item.name === selector)
				?? folders.find(item => item.name.toLowerCase() === selector.toLowerCase());
		}
		if (!folder) {
			return undefined;
		}
		const rest = (token[2] ?? '').replace(/\//g, path.sep);
		const resolved = rest ? path.resolve(folder.fsPath, rest) : path.resolve(folder.fsPath);
		if (!isInside(folder.fsPath, resolved)) {
			return undefined;
		}
		return resolved;
	}
	if (path.isAbsolute(value)) {
		return path.normalize(value);
	}
	// 没有占位符的相对路径：按第一个工作区解析，方便手工编辑 JSON。
	const first = folders[0];
	if (!first) {
		return undefined;
	}
	return path.resolve(first.fsPath, value);
}

/** 给 TreeItem 的 tooltip / description 用的人类可读路径。 */
export function displayStoredPath(stored: string, folders: readonly WorkspaceFolderLike[]): string {
	const resolved = resolveStoredPath(stored, folders);
	return resolved ?? stored;
}

/** 用于判断两个节点是否指向同一真实文件夹（Windows 大小写不敏感）。 */
export function pathKey(stored: string, folders: readonly WorkspaceFolderLike[]): string {
	const resolved = resolveStoredPath(stored, folders);
	return normalizeForCompare(resolved ?? stored);
}
