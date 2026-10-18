import * as path from 'node:path';

/** 约定：配置放在被浏览文件夹的 `.WispkitView/` 下（也兼容直接放在文件夹根上）。 */
export const WISPKIT_VIEW_FOLDER = '.WispkitView';
export const WISPKIT_VIEW_MANIFEST = 'Wispkit.json';

export interface WispkitViewManifest {
	readonly title?: string;
	/** 入口文件，**相对被点击的那个文件夹**（例如 `.WispkitView/index.html`）。 */
	readonly entry: string;
	/** 用来打开入口的 viewType，例如 `wispkit.html`。 */
	readonly openWith: string;
}

export interface ManifestParseResult {
	readonly manifest?: WispkitViewManifest;
	readonly error?: string;
}

export function parseManifest(text: string): ManifestParseResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return { error: `Wispkit.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
	}

	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { error: 'Wispkit.json 的顶层必须是一个对象。' };
	}

	const record = value as Record<string, unknown>;
	const entry = record.entry;
	const openWith = record.openWith;

	if (typeof entry !== 'string' || !entry.trim()) {
		return { error: 'Wispkit.json 缺少 entry（要打开的入口文件，相对所在文件夹）。' };
	}
	if (typeof openWith !== 'string' || !openWith.trim()) {
		return { error: 'Wispkit.json 缺少 openWith（viewType，例如 wispkit.html）。' };
	}

	const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined;
	return { manifest: { title, entry: entry.trim(), openWith: openWith.trim() } };
}

/** 查找顺序：先 `<folder>/.WispkitView/Wispkit.json`，再 `<folder>/Wispkit.json`。 */
export function manifestPaths(folderPath: string): string[] {
	return [
		path.join(folderPath, WISPKIT_VIEW_FOLDER, WISPKIT_VIEW_MANIFEST),
		path.join(folderPath, WISPKIT_VIEW_MANIFEST),
	];
}

/** 把 entry 解析成绝对路径；跑到文件夹外面就判为非法（配置文件不该能指到别处去）。 */
export function resolveEntryPath(folderPath: string, entry: string): string | undefined {
	const resolved = path.resolve(folderPath, entry);
	const relative = path.relative(folderPath, resolved);
	if (relative === '') {
		return undefined;
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined;
	}
	return resolved;
}
