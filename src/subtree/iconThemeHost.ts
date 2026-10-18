import * as vscode from 'vscode';

import { iconRelativePath, mergeLanguageIcons, parseIconTheme, type IconThemeDefinition, type WebviewIconTheme } from './iconTheme';

/**
 * 图标主题的**宿主侧**：定位定义文件、读盘解析、转成 webview URI。
 * 纯解析在 `iconTheme.ts`（那个文件不依赖 vscode，便于单测）。
 *
 * 前端用 CSS `mask-image` + `background-color: currentColor` 渲染这些 svg：
 * 主题本身就是单色 currentColor 的，mask 不丢信息，也不必把 svg 内容搬进页面。
 */

/** 当前 `workbench.iconTheme` 配置的主题 id。 */
function activeIconThemeId(): string | undefined {
	const value: unknown = vscode.workspace.getConfiguration('workbench').get('iconTheme');
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 定位当前图标主题的定义文件（同步；找不到返回 undefined）。
 *
 * 主题可能在**内置**扩展里（本机的 `vscode-modern-icons` 就在
 * `resources/app/extensions/theme-modern-icons`），所以遍历 `extensions.all`，
 * 不假设它在用户扩展目录，也不硬编码任何安装路径。
 */
export function findIconThemeFile(): vscode.Uri | undefined {
	const id = activeIconThemeId();
	if (!id) {
		return undefined;
	}
	for (const extension of vscode.extensions.all) {
		const contributes = (extension.packageJSON as { contributes?: { iconThemes?: unknown } })?.contributes;
		const themes = contributes?.iconThemes;
		if (!Array.isArray(themes)) {
			continue;
		}
		for (const theme of themes) {
			const entry = theme as { id?: unknown; path?: unknown };
			if (entry?.id === id && typeof entry.path === 'string') {
				return vscode.Uri.joinPath(extension.extensionUri, entry.path);
			}
		}
	}
	return undefined;
}

/** 解析结果按「定义文件路径」缓存一次，避免每次开面板都重新读盘与解析。 */
let cached: { key: string; definition: IconThemeDefinition } | undefined;

/**
 * 读盘 + 解析。任何一环失败都返回 undefined，调用方据此回退自绘 sprite。
 *
 * 与 URI 转换分开是顺序上的硬约束：`localResourceRoots` 必须在 `createWebviewPanel`
 * 时给出（那时还没有 webview 对象），而 `asWebviewUri` 又必须在拿到 webview 之后才能调。
 * 所以：先同步拿目录 → 建面板 → await 本函数 → 再用 `toWebviewIconTheme` 同步转 URI。
 */
export async function loadIconThemeDefinition(): Promise<
	{ definition: IconThemeDefinition; root: vscode.Uri } | undefined
> {
	const file = findIconThemeFile();
	if (!file) {
		return undefined;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
	} catch {
		return undefined;
	}
	const key = file.toString();
	if (cached?.key !== key) {
		const definition = parseIconTheme(raw);
		if (!definition) {
			return undefined;
		}
		cached = { key, definition };
	}
	if (!cached) {
		return undefined;
	}
	return { definition: cached.definition, root: vscode.Uri.joinPath(file, '..') };
}

/**
 * 建「小写扩展名 → VS Code 语言 id」的桥。
 *
 * 图标主题的 `languageIds` 键是**语言 id**（`markdown`、`javascript`），而我们要按文件名
 * 查图标，所以必须先把扩展名映射成语言 id。这个对应关系由各扩展的
 * `contributes.languages[].extensions` 声明（VS Code 自己也用它，本机实测能拿到 349 条：
 * `md→markdown`、`mjs→javascript`、`json→json`、`cs→csharp`、`xaml→xml`）。
 *
 * 遍历 `extensions.all` 而不是内置表：语言贡献可能来自任意扩展，且内置扩展也在 all 里。
 * 同一个扩展名被多个语言声明时取**第一个**（与 VS Code「先注册先算」的行为一致）。
 */
export function buildExtensionToLanguageId(): Record<string, string> {
	const map: Record<string, string> = {};
	for (const extension of vscode.extensions.all) {
		const languages = (extension.packageJSON as { contributes?: { languages?: unknown } })?.contributes
			?.languages;
		if (!Array.isArray(languages)) {
			continue;
		}
		for (const language of languages) {
			const entry = language as { id?: unknown; extensions?: unknown };
			if (typeof entry.id !== 'string' || !Array.isArray(entry.extensions)) {
				continue;
			}
			for (const raw of entry.extensions) {
				if (typeof raw !== 'string') {
					continue;
				}
				const key = raw.replace(/^\./, '').trim().toLowerCase();
				if (key && !(key in map)) {
					map[key] = entry.id;
				}
			}
		}
	}
	return map;
}

/**
 * 把解析结果转成该 webview 可用的 URI 表（同步）。`asWebviewUri` 抛错，
 * 或默认文件/文件夹图标转不出来时返回 undefined —— 那也意味着回退。
 */
export function toWebviewIconTheme(
	definition: IconThemeDefinition,
	root: vscode.Uri,
	webview: vscode.Webview,
): WebviewIconTheme | undefined {
	const toUri = (name: string): string | undefined => {
		const raw = definition.paths[name];
		if (!raw) {
			return undefined;
		}
		const relative = iconRelativePath(raw);
		if (!relative) {
			return undefined;
		}
		try {
			return webview.asWebviewUri(vscode.Uri.joinPath(root, relative)).toString();
		} catch {
			return undefined;
		}
	};

	const convert = (table: Readonly<Record<string, string>>): Record<string, string> => {
		const out: Record<string, string> = {};
		for (const [key, name] of Object.entries(table)) {
			const uri = toUri(name);
			if (uri) {
				out[key] = uri;
			}
		}
		return out;
	};

	/**
	 * 扩展名 → 图标名。合并口径（含 `languageIds` 这一层）见 `mergeLanguageIcons`。
	 */
	const mergedExtension = mergeLanguageIcons(definition, buildExtensionToLanguageId());

	const defaultFile = toUri(definition.file);
	const defaultFolder = toUri(definition.folder);
	if (!defaultFile || !defaultFolder) {
		return undefined;
	}

	return {
		file: defaultFile,
		folder: defaultFolder,
		folderExpanded: toUri(definition.folderExpanded) ?? defaultFolder,
		byExtension: convert(mergedExtension),
		byFileName: convert(definition.byFileName),
	};
}
