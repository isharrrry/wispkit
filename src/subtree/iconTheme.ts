/**
 * 图标主题的**纯解析** —— 这个文件刻意不 import `vscode`，因此可以在 node 测试环境里
 * 直接单测（宿主侧的读盘与 URI 转换见 `iconThemeHost.ts`）。
 *
 * 为什么要用用户自己的图标主题：子树视图的图标要和资源管理器里看到的**完全一致**，
 * 唯一可靠的做法就是拿当前 `workbench.iconTheme` 那份定义来用。
 *
 * 只支持「SVG 图标主题」这一种形态：`iconDefinitions[名].iconPath` 指向一个 .svg 文件。
 * 本机在用的 `vscode-modern-icons` 正是这种 —— json 里**没有 `fonts` 块**，117 个图标
 * 全是磁盘上的 .svg，且全部用 `fill="currentColor"`（硬编码颜色数为 0）。
 *
 * 字体形态的主题（有 `fonts`，或 `iconDefinitions` 里带 `fontCharacter`）一律返回
 * undefined，由调用方回退到自绘的 SVG sprite —— 与其去解析字形码，不如明确回退。
 */

export interface IconThemeDefinition {
	/** 默认文件图标名（json 的 `file`）。 */
	readonly file: string;
	/** 文件夹收起 / 展开图标名。 */
	readonly folder: string;
	readonly folderExpanded: string;
	/** 小写扩展名（不含点）→ 图标名。 */
	readonly byExtension: Readonly<Record<string, string>>;
	/** 小写完整文件名 → 图标名。 */
	readonly byFileName: Readonly<Record<string, string>>;
	/**
	 * VS Code **语言 id** → 图标名（json 的 `languageIds`）。
	 *
	 * 这一层是资源管理器实际用到的第三级映射，缺了它就会大面积不一致：主题的
	 * `fileExtensions` 往往**故意留空**（本机 `vscode-modern-icons` 里 `md`/`json`/`js`/`mjs`
	 * 全是空字符串），真正的图标由语言 id 决定 —— 真机实测资源管理器把 `package.json`
	 * 画成 `json.svg`、`esbuild.mjs` 画成 `javascript.svg`，靠的就是这一层。
	 * 扩展名 → 语言 id 的桥由宿主侧建（见 `iconThemeHost.ts`）。
	 */
	readonly byLanguage: Readonly<Record<string, string>>;
	/** 图标名 → 相对主题文件的路径（如 `./images/file.svg`）。 */
	readonly paths: Readonly<Record<string, string>>;
}

/** 传给 webview 的形态：图标名已经换成该 webview 可用的 URI。 */
export interface WebviewIconTheme {
	readonly file: string;
	readonly folder: string;
	readonly folderExpanded: string;
	readonly byExtension: Readonly<Record<string, string>>;
	readonly byFileName: Readonly<Record<string, string>>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** 扩展名 / 文件名一律按小写规范化后再查表，与资源管理器的匹配口径一致。 */
function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * 把主题 json 里写的图标路径规整成可直接 join 的相对路径。
 *
 * 真实主题写的是 `./images/file.svg`（带 `./` 前缀）；也有主题写 `images\x.svg`。
 * 统一去掉 `./` 并转成 `/` 分隔，避免 `Uri.joinPath` 拼出 `.../fileicons/./images/file.svg`
 * 这类带 `./` 段的路径 —— 那会让 asWebviewUri 出来的地址取不到文件，图标整片消失。
 */
export function iconRelativePath(raw: string): string {
	return raw.trim().replace(/^\.\//, '').replace(/\\/g, '/');
}

/**
 * 把「扩展名 → 图标名」合成一张表，口径与资源管理器一致。
 *
 * VS Code 查文件图标的顺序是 **fileNames → fileExtensions → languageIds → file**。
 * `fileNames` 由前端单独先查；这里处理后面两级：`languageIds` 的键是语言 id，
 * 所以先用 `extToLanguage`（扩展名 → 语言 id）把它按扩展名展开（低优先级），
 * 再让 `fileExtensions` 覆盖（高优先级）。结果就是一张可直接按扩展名查的表。
 *
 * 这一层不能省：主题常常把 `fileExtensions` 里那些键**留空**，图标其实由语言 id 决定
 * （真机实测：资源管理器把 `package.json` 画成 `json.svg`、`esbuild.mjs` 画成
 * `javascript.svg`，而主题里 `json`/`mjs` 的扩展名映射都是空字符串）。
 */
export function mergeLanguageIcons(
	definition: IconThemeDefinition,
	extToLanguage: Readonly<Record<string, string>>,
): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const [ext, languageId] of Object.entries(extToLanguage)) {
		const icon = definition.byLanguage[languageId];
		if (icon) {
			merged[normalizeKey(ext)] = icon;
		}
	}
	for (const [ext, icon] of Object.entries(definition.byExtension)) {
		merged[normalizeKey(ext)] = icon;
	}
	return merged;
}

/**
 * 解析图标主题 json。不是可用的 SVG 主题时返回 undefined（**调用方必须回退自绘**）。
 */
export function parseIconTheme(raw: unknown): IconThemeDefinition | undefined {
	const root = asRecord(raw);
	if (!root || root.fonts !== undefined) {
		return undefined;
	}
	const definitions = asRecord(root.iconDefinitions);
	if (!definitions) {
		return undefined;
	}

	const paths: Record<string, string> = {};
	for (const [name, value] of Object.entries(definitions)) {
		const entry = asRecord(value);
		const iconPath = entry?.iconPath;
		if (typeof iconPath === 'string' && iconPath.length > 0) {
			paths[name] = iconPath;
		} else if (typeof entry?.fontCharacter === 'string') {
			// 混进字形定义 → 整体放弃，避免一半图标一半字形
			return undefined;
		}
	}

	/** 图标名必须真实存在且带 svg 路径，否则视为缺失。 */
	const pick = (value: unknown, fallback: string | undefined): string | undefined => {
		const name = typeof value === 'string' ? value : undefined;
		return name && paths[name] ? name : fallback;
	};

	const file = pick(root.file, undefined);
	const folder = pick(root.folder, undefined);
	if (!file || !folder) {
		return undefined;
	}

	const collect = (value: unknown): Record<string, string> => {
		const table = asRecord(value);
		const out: Record<string, string> = {};
		if (!table) {
			return out;
		}
		for (const [key, iconName] of Object.entries(table)) {
			if (typeof iconName === 'string' && paths[iconName]) {
				out[normalizeKey(key)] = iconName;
			}
		}
		return out;
	};

	return {
		file,
		folder,
		folderExpanded: pick(root.folderExpanded, folder) as string,
		byExtension: collect(root.fileExtensions),
		byFileName: collect(root.fileNames),
		byLanguage: collect(root.languageIds),
		paths,
	};
}
