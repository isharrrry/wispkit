/**
 * 子树视图自研文件操作的**纯逻辑**部分（不 import vscode，可直接单测）。
 *
 * 为什么要自研而不是复用内置命令：`filesExplorer.rename`、`explorer.newFile`、
 * `filesExplorer.paste` 这些都**不接受 URI 参数**，只作用于资源管理器里选中的条目 ——
 * 传进去的 uri 被忽略。要做「作用于子树表格选中项」，只能自己用 `workspace.fs` 实现，
 * 这一层负责其中可以脱离文件系统测试的部分（名字校验、冲突去重、粘贴目标计算）。
 */

export type ClipboardOp = 'copy' | 'cut';

export interface ClipboardState {
	readonly op: ClipboardOp;
	readonly paths: readonly string[];
}

/** Windows 保留设备名：以它们为文件名（或带扩展名）会被系统拒绝。 */
const RESERVED_NAMES = new Set([
	'CON', 'PRN', 'AUX', 'NUL',
	'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
	'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * 校验用户输入的新名称。返回 `undefined` 表示合法，否则是给用户看的中文原因。
 */
export function validateEntryName(name: string): string | undefined {
	const trimmed = name.trim();
	if (!trimmed) {
		return '名称不能为空。';
	}
	if (trimmed === '.' || trimmed === '..') {
		return '名称不能是 . 或 ..';
	}
	if (/[\\/]/.test(trimmed)) {
		return '名称里不能有路径分隔符（\\ 或 /）。';
	}
	if (/[<>:"|?*\u0000-\u001f]/.test(trimmed)) {
		return '名称里不能有 < > : " | ? * 或控制字符。';
	}

	const stem = trimmed.split('.')[0]?.toUpperCase() ?? '';
	if (RESERVED_NAMES.has(stem)) {
		return `${stem} 是 Windows 保留名，换一个。`;
	}
	return undefined;
}

/**
 * 比较用的大小写归一。Windows 文件系统大小写不敏感（`A.txt` 与 `a.txt` 不能共存），
 * 所以冲突检测按小写比较；这在本机目标平台上是正确的取舍。
 */
export function normalizeFileNameForComparison(name: string): string {
	return name.toLowerCase();
}

/**
 * 在 `existing` 已经占用的名字里，为 `desired` 找一个不冲突的：
 * `a.txt` → `a 副本.txt` → `a 副本 2.txt` …
 */
export function uniqueName(existing: ReadonlySet<string>, desired: string): string {
	const taken = new Set<string>();
	for (const name of existing) {
		taken.add(normalizeFileNameForComparison(name));
	}

	if (!taken.has(normalizeFileNameForComparison(desired))) {
		return desired;
	}

	const dot = desired.lastIndexOf('.');
	// `.gitignore` 这种以点开头的没有「扩展名」可拆
	const hasExtension = dot > 0;
	const stem = hasExtension ? desired.slice(0, dot) : desired;
	const extension = hasExtension ? desired.slice(dot) : '';

	for (let n = 1; n <= 999; n += 1) {
		const suffix = n === 1 ? ' 副本' : ` 副本 ${n}`;
		const candidate = `${stem}${suffix}${extension}`;
		if (!taken.has(normalizeFileNameForComparison(candidate))) {
			return candidate;
		}
	}
	return `${stem} 副本 ${existing.size + 1}${extension}`;
}

/**
 * 算出粘贴后每个源文件的目标**名称**（不是完整路径 —— 目标目录由调用方决定，
 * 多选时每个源都落到同一个目录，所以只需要名字）。
 *
 * 同名冲突时用 `uniqueName` 依次让位；同一批里先算出来的名字会立刻进入占用集合，
 * 否则两个 `a.txt`（来自不同目录）会算出同一个目标名。
 */
export function pasteTargetNames(
	sources: readonly string[],
	existingNames: ReadonlySet<string>,
	basenameOf: (fullPath: string) => string,
): string[] {
	const taken = new Set<string>(existingNames);
	const out: string[] = [];

	for (const source of sources) {
		const desired = basenameOf(source);
		const name = uniqueName(taken, desired);
		taken.add(name);
		out.push(name);
	}
	return out;
}

/**
 * 粘贴的**目标目录**：
 * - 选中的是文件夹（单个）→ 它自己。
 * - 选中的是文件、或什么都没选 → 用 `fallbackDir`（根目录 / 该文件的父目录）。
 */
export function resolvePasteDirectory(
	selectedPaths: readonly string[],
	isDirectory: (path: string) => boolean,
	directoryOf: (path: string) => string,
	rootPath: string,
): string {
	if (selectedPaths.length === 0) {
		return rootPath;
	}
	const first = selectedPaths[0];
	if (selectedPaths.length === 1 && isDirectory(first)) {
		return first;
	}
	// 多选或选中的是文件：落到第一个选中项的父目录，比静默用根目录更可预期
	return isDirectory(first) ? first : directoryOf(first);
}

/** 剪贴板状态栏文案；没有内容时返回 `undefined`。 */
export function describeClipboard(state: ClipboardState | undefined): string | undefined {
	if (!state || state.paths.length === 0) {
		return undefined;
	}
	const verb = state.op === 'cut' ? '剪切' : '复制';
	return `剪贴板：已${verb} ${state.paths.length} 项`;
}

/**
 * 删除前的确认文案。`count` 是选中项数量，`first` 用来在单删时把名字摆出来。
 */
export function deleteConfirmation(count: number, first: string): string {
	if (count === 1) {
		return `确定删除 ${first} 吗？可以从回收站恢复。`;
	}
	return `确定删除这 ${count} 项吗？可以从回收站恢复。`;
}
