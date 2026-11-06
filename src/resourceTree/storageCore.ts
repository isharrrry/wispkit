import * as path from 'node:path';
import { resolveStoredPath, type WorkspaceFolderLike } from './paths';

/**
 * 存储位置解析与安全写入的**纯逻辑**。
 *
 * 这里刻意不 import vscode：`storage.ts` 负责把结果映射到 `vscode.Uri` /
 * `workspace.fs`，而「配置值怎么解析」「写到临时文件再 rename」这两件事
 * 可以在 mocha 里直接验证（包括失败路径）。
 */

export const DEFAULT_STORAGE_RELATIVE = '.WispkitView/resource-tree.json';

const WORKSPACE_TOKEN_PREFIX = '${workspaceFolder';
const CONTROL_CHARACTERS = /[\x00-\x1f]/;

export interface StoragePathResolution {
	/** 解析后的绝对路径；配置非法时为 undefined。 */
	readonly path?: string;
	/** 配置为空、使用了默认的 `.WispkitView/resource-tree.json`。 */
	readonly usedDefault?: boolean;
	/** 可诊断的配置错误；有值时调用方应提示用户并保留当前树。 */
	readonly error?: string;
}

function folderSummary(folders: readonly WorkspaceFolderLike[]): string {
	if (folders.length === 0) {
		return '（当前没有打开工作区文件夹）';
	}
	return folders
		.map((folder, index) => `${index}: ${folder.name || folder.fsPath}`)
		.join('、');
}

function isAbsolutePath(value: string): boolean {
	return path.isAbsolute(value)
		|| /^[A-Za-z]:[\\/]/.test(value)
		|| /^[\\/]{2}[^\\/]/.test(value);
}

/** Windows 下的非法文件名字符；POSIX 只拒绝控制字符。 */
function findInvalidCharacter(value: string): string | undefined {
	const control = CONTROL_CHARACTERS.exec(value);
	if (control) {
		return JSON.stringify(control[0]);
	}
	if (path.sep === '\\') {
		const withoutDrive = value.replace(/^[A-Za-z]:/, '');
		const match = /[<>"|?*]/.exec(withoutDrive);
		if (match) {
			return `"${match[0]}"`;
		}
	}
	return undefined;
}

/**
 * 把 `wispkit.resourceTree.file` 的配置值解析成绝对路径。
 *
 * 支持：默认值、相对路径（基于第一个工作区）、绝对路径、`${workspaceFolder}` /
 * `${workspaceFolder:名称}` / `${workspaceFolder:序号}`。解析失败时返回 error，
 * **不会**静默退回默认文件——否则用户改错配置后会以为树丢了。
 */
export function resolveStoragePath(
	configured: string,
	folders: readonly WorkspaceFolderLike[],
): StoragePathResolution {
	const raw = typeof configured === 'string' ? configured.trim() : '';
	const value = raw || DEFAULT_STORAGE_RELATIVE;
	const usedDefault = raw.length === 0;

	const invalid = findInvalidCharacter(value);
	if (invalid) {
		return {
			usedDefault,
			error: `路径「${value}」包含非法字符 ${invalid}，不能用作资源树文件。`,
		};
	}
	if (/^[A-Za-z]:[^\\/]/.test(value)) {
		return {
			usedDefault,
			error: `「${value}」不是合法的绝对路径：盘符后需要跟斜杠。`,
		};
	}
	if (/[\\/]$/.test(value) && !/^([A-Za-z]:[\\/]|[\\/])$/.test(value)) {
		return {
			usedDefault,
			error: `「${value}」以目录分隔符结尾，请指定一个 JSON 文件路径。`,
		};
	}

	if (value.startsWith(WORKSPACE_TOKEN_PREFIX)) {
		const resolved = resolveStoredPath(value, folders);
		if (!resolved) {
			return {
				usedDefault,
				error: `无法解析工作区占位符「${value}」。可用工作区：${folderSummary(folders)}；`
					+ '写法：${workspaceFolder}、${workspaceFolder:名称}、${workspaceFolder:序号}。',
			};
		}
		return { path: resolved, usedDefault };
	}

	if (isAbsolutePath(value)) {
		return { path: path.normalize(value), usedDefault };
	}

	if (folders.length === 0) {
		return {
			usedDefault,
			error: `没有打开工作区文件夹，无法解析相对路径「${value}」。`,
		};
	}
	return { path: path.resolve(folders[0].fsPath, value), usedDefault };
}

/**
 * 视图标题里的存储路径是否带工作区根名称。
 *
 * 多根工作区里只显示 `.WispkitView/resource-tree.json` 看不出文件属于哪个根，
 * 移除 / 重排根后也无法从标题判断存储是否已经切换；单根则保持原来的短路径。
 */
export function includeWorkspaceFolderInStorageDescription(folderCount: number): boolean {
	return folderCount > 1;
}

/** 解码磁盘内容；容忍外部编辑器写入的 UTF-8 BOM。 */
export function decodeStoreText(bytes: Uint8Array): string {
	const text = new TextDecoder('utf-8').decode(bytes);
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

let tempSequence = 0;

/** 同一目录下的临时文件后缀；同一进程内不会重复。 */
export function storageTempSuffix(): string {
	tempSequence += 1;
	return `${process.pid.toString(36)}-${Date.now().toString(36)}-${tempSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 目标文件的**同目录**临时路径。
 *
 * 必须同目录：跨卷 rename 不具备原子性，甚至直接失败。
 */
export function temporarySiblingPath(target: string, suffix: string = storageTempSuffix()): string {
	return `${target}.tmp-${suffix}`;
}

export type ExternalChangeKind = 'none' | 'created' | 'deleted' | 'modified';

/**
 * 写入前比较「扩展最后一次确认的规范化文本」与「当前磁盘上的规范化文本」。
 *
 * 只比较规范化后的内容（`serializeStore` 的结果），所以外部仅调整缩进 / 加 BOM
 * 不算冲突；真正的树内容变化、外部新建、外部删除都会返回对应的种类。
 * 调用方在 `modified` / `created` / `deleted` 时必须先向用户确认，不能静默覆盖。
 */
export function classifyExternalChange(
	lastPersistedText: string | undefined,
	diskText: string | undefined,
): ExternalChangeKind {
	if (lastPersistedText === undefined) {
		return diskText === undefined ? 'none' : 'created';
	}
	if (diskText === undefined) {
		return 'deleted';
	}
	return diskText === lastPersistedText ? 'none' : 'modified';
}

export interface AtomicWriteOperations<Handle> {
	writeFile(target: Handle, data: Uint8Array): Promise<void>;
	rename(source: Handle, target: Handle): Promise<void>;
	delete(target: Handle): Promise<void>;
}

async function cleanupQuietly(operation: Promise<unknown>): Promise<void> {
	try {
		await operation;
	} catch {
		// 清理失败不能盖住原始错误；下一次写入会用自己的临时文件。
	}
}

/**
 * 先写临时文件、成功后再 rename 覆盖目标。
 *
 * 失败语义：
 *   - 写临时文件失败 → 目标文件一个字节都不会动；
 *   - rename 失败     → 目标文件仍是旧内容；
 *   - 任何一步失败都会尽力删除临时文件。
 *
 * 这样即使磁盘满 / 进程被终止，也不会出现「旧文件被清空、新内容只写了一半」。
 */
export async function writeFileAtomically<Handle>(
	operations: AtomicWriteOperations<Handle>,
	target: Handle,
	temporary: Handle,
	data: Uint8Array,
): Promise<void> {
	try {
		await operations.writeFile(temporary, data);
	} catch (error) {
		await cleanupQuietly(operations.delete(temporary));
		throw error;
	}
	try {
		await operations.rename(temporary, target);
	} catch (error) {
		await cleanupQuietly(operations.delete(temporary));
		throw error;
	}
}
