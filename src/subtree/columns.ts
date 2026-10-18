import type { TreeEntry } from './types';

export type ColumnId = 'name' | 'ext' | 'size' | 'mtime' | 'ctime' | 'atime' | 'owner' | 'mode' | 'type';

export interface ColumnDefinition {
	readonly id: ColumnId;
	readonly label: string;
	readonly align: 'left' | 'right';
	/** 列宽（像素）。表头与数据行共用，保证两处对齐。 */
	readonly width: number;
}

/**
 * 配置缺失或全部非法时的回退列。
 * **`package.json` 里 `wispkit.subtree.columns` 的 default 应与此保持一致** ——
 * 正常路径下生效的是那份 default，这里的回退只在配置被写坏时兜底。
 */
export const DEFAULT_COLUMNS: readonly ColumnId[] = ['name', 'size', 'type', 'mtime', 'ctime', 'owner'];

export const COLUMN_DEFINITIONS: readonly ColumnDefinition[] = [
	{ id: 'name', label: '名称', align: 'left', width: 280 },
	{ id: 'ext', label: '扩展名', align: 'left', width: 80 },
	{ id: 'size', label: '大小', align: 'right', width: 90 },
	{ id: 'mtime', label: '修改时间', align: 'left', width: 160 },
	{ id: 'ctime', label: '创建时间', align: 'left', width: 160 },
	{ id: 'atime', label: '访问时间', align: 'left', width: 160 },
	{ id: 'owner', label: '用户', align: 'left', width: 130 },
	{ id: 'mode', label: '权限', align: 'left', width: 100 },
	{ id: 'type', label: '类型', align: 'left', width: 100 },
];

const COLUMN_IDS: ReadonlySet<string> = new Set(COLUMN_DEFINITIONS.map(definition => definition.id));

/** 配置里可能拼错、重复或留着旧值：过滤未知项、去重；一个都不剩时回退默认列而不是渲染空表。 */
export function resolveColumns(configured: unknown): ColumnId[] {
	if (!Array.isArray(configured)) {
		return [...DEFAULT_COLUMNS];
	}

	const seen = new Set<ColumnId>();
	const resolved: ColumnId[] = [];
	for (const item of configured) {
		if (typeof item !== 'string' || !COLUMN_IDS.has(item)) {
			continue;
		}
		const id = item as ColumnId;
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		resolved.push(id);
	}

	return resolved.length > 0 ? resolved : [...DEFAULT_COLUMNS];
}

export function columnDefinition(id: ColumnId): ColumnDefinition {
	return COLUMN_DEFINITIONS.find(definition => definition.id === id)
		?? { id, label: id, align: 'left', width: 120 };
}

export function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '-';
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** 本地时间，秒级；拿不到时间戳（0/NaN）显示 `-`。 */
export function formatTime(milliseconds: number): string {
	if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
		return '-';
	}

	const date = new Date(milliseconds);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
		+ `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 权限位 → `rwxr-xr-x`；未知（Windows）显示 `-`。 */
export function formatMode(mode: number): string {
	if (!Number.isFinite(mode) || mode <= 0) {
		return '-';
	}

	const bits = mode & 0o777;
	const flag = (shift: number, mask: number, character: string): string => (bits & (mask << shift) ? character : '-');
	return [
		flag(6, 4, 'r'), flag(6, 2, 'w'), flag(6, 1, 'x'),
		flag(3, 4, 'r'), flag(3, 2, 'w'), flag(3, 1, 'x'),
		flag(0, 4, 'r'), flag(0, 2, 'w'), flag(0, 1, 'x'),
	].join('');
}

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) {
		return '-';
	}
	return name.slice(dot + 1);
}

/** 扩展名 → 归类。顺序即优先级，所以「网页」要排在「代码」前面（html/css 同时像两者）。 */
const FILE_CATEGORIES: ReadonlyArray<readonly [string, readonly string[]]> = [
	['网页', ['html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte']],
	['图片', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'heic', 'avif', 'psd']],
	['音视频', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv']],
	['压缩包', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'cab', 'iso']],
	['数据', ['csv', 'tsv', 'db', 'sqlite', 'sqlite3', 'parquet', 'xlsx', 'xls', 'ods', 'mdb']],
	['代码', [
		'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'fs', 'vb', 'java', 'kt', 'scala', 'groovy',
		'py', 'pyw', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'go', 'rs', 'rb', 'php', 'pl',
		'swift', 'm', 'mm', 'lua', 'r', 'jl', 'dart', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'sql',
	]],
	['配置', [
		'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'config', 'xml', 'xsd', 'xsl',
		'props', 'properties', 'env', 'editorconfig', 'gitignore', 'gitattributes', 'npmrc', 'lock', 'gradle', 'cmake', 'mk',
	]],
	['文档', ['md', 'markdown', 'mdx', 'txt', 'log', 'rst', 'adoc', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'tex', 'epub']],
	['字体', ['ttf', 'otf', 'woff', 'woff2', 'eot', 'fon']],
	['可执行', ['exe', 'dll', 'so', 'dylib', 'msi', 'app', 'bin', 'lib', 'pdb', 'o', 'obj', 'class', 'jar', 'wasm']],
];

/** 资源管理器式的「类型」：先按扩展名归类，认不出才回落到「xxx 文件」。 */
export function fileCategory(entry: TreeEntry): string {
	if (entry.isDirectory) {
		return '文件夹';
	}

	const extension = extensionOf(entry.name).toLowerCase();
	if (extension === '-') {
		return '文件';
	}

	for (const [label, extensions] of FILE_CATEGORIES) {
		if (extensions.includes(extension)) {
			return label;
		}
	}
	return `${extension} 文件`;
}

export interface CellContext {
	/** 当前用户。Windows 上拿不到真实属主，用登录用户名作近似（README 已注明）。 */
	readonly owner: string;
}

export function formatCell(id: ColumnId, entry: TreeEntry, context: CellContext): string {
	switch (id) {
		case 'name':
			return entry.name;
		case 'ext':
			return entry.isDirectory ? '-' : extensionOf(entry.name);
		case 'size':
			return entry.isDirectory ? '-' : formatSize(entry.size);
		case 'mtime':
			return formatTime(entry.mtime);
		case 'ctime':
			return formatTime(entry.ctime);
		case 'atime':
			return formatTime(entry.atime);
		case 'owner':
			return context.owner || '-';
		case 'mode':
			return formatMode(entry.mode);
		case 'type':
			return fileCategory(entry);
		default:
			return '-';
	}
}
