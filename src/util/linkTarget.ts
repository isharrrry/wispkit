/**
 * Webview 页面里被点到的 `<a href>` → 宿主可执行的打开目标。
 *
 * 为什么必须自己解析：页面里的 `<base href>` 只能指向 `webview.asWebviewUri(文档)`
 * —— 否则相对图片 / 样式 / 脚本都加载不出来。代价是**相对链接会被浏览器解析成
 * webview 资源 URL**（桌面版形如 `https://file+.vscode-resource.vscode-cdn.net/...`，
 * Bench 里是宿主自己的 `/__resource/...`）。webview 外壳按 `https:` 白名单把它当外部
 * 链接交给系统浏览器（Markdown 视图"点链接跳浏览器"的原因）；不实现链接点击的宿主
 * （Bench）则毫无反应。所以点击要在页面里截住，把**原始 href** 送回扩展，由这里
 * 相对于文档位置解析成本地路径 / 外部 URL。
 *
 * 纯函数、不依赖 `vscode`，单元测试可以直接覆盖全部边界。
 */

export type LinkTargetKind = 'external' | 'file' | 'ignore';

export interface LinkTarget {
	readonly kind: LinkTargetKind;
	/** 原始 href（已 trim）。external 直接用它打开。 */
	readonly href: string;
	/** file：解码后的绝对路径，统一正斜杠；Windows 盘符保留 `d:` 形式。 */
	readonly path?: string;
	/** file：1 基行号（`vscode://file/x.md:7`、`x.md#L7`）。 */
	readonly line?: number;
}

/** `vscode://file/...`、`vscode-insider://file/...`（VS Code 白名单里的两种写法）。 */
const VSCODE_FILE_HREF = /^vscode(?:-insiders?)?:\/\/file\/(.*)$/i;

/** URI scheme。`D:/x` 会被误判成 scheme `d`，所以调用前先用 WINDOWS_DRIVE_PATH 排除。 */
const URI_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/** 可以直接交给系统的 scheme（webview 外壳白名单也是这几类）。 */
const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/** 不该由扩展打开的 scheme（脚本 / 内联数据 / 宿主自造协议）。 */
const UNSAFE_SCHEMES = new Set(['javascript', 'data', 'blob', 'about', 'vbscript']);

function ignore(href: string): LinkTarget {
	return { kind: 'ignore', href };
}

function fileTarget(href: string, path: string, line: number | undefined): LinkTarget {
	return { kind: 'file', href, path, line };
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** `L12` / `L12-L20`（GitHub 风格）→ 12。 */
function lineFromFragment(fragment: string | undefined): number | undefined {
	if (!fragment) {
		return undefined;
	}
	const match = /^L(\d+)(?:-L?\d+)?$/i.exec(fragment);
	return match ? toLine(Number(match[1])) : undefined;
}

function toLine(value: number): number | undefined {
	return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

/** 拆出路径末尾的 `:行号`（只认数字；`solid-320x240.gif` 不会被切）。 */
function splitLineSuffix(value: string): { pathText: string; line?: number } {
	const match = /^(.*):(\d+)$/.exec(value);
	if (!match || /^[a-zA-Z]:$/.test(match[1])) {
		return { pathText: value };
	}
	return { pathText: match[1], line: toLine(Number(match[2])) };
}

/** `#fragment` 与 `?query` 都从路径里剥掉（fragment 只用来识别 `#L12`）。 */
function splitHashAndQuery(value: string): { pathText: string; fragment: string } {
	const hashIndex = value.indexOf('#');
	const fragment = hashIndex >= 0 ? value.slice(hashIndex + 1) : '';
	let pathText = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
	const queryIndex = pathText.indexOf('?');
	if (queryIndex >= 0) {
		pathText = pathText.slice(0, queryIndex);
	}
	return { pathText, fragment };
}

function isAbsoluteFsPath(path: string): boolean {
	return WINDOWS_DRIVE_PATH.test(path) || path.startsWith('/') || path.startsWith('//');
}

/** URI 的 path 在 Windows 盘符前会多一个 `/`（`/d:/x`），统一成 `d:/x`。 */
export function toFsPath(path: string): string {
	return path.replace(/^\/([a-zA-Z]:)/, '$1');
}

/**
 * 正斜杠路径归一化：折叠 `.`/`..`、去掉重复斜杠、盘符小写。
 * 保留 UNC 前缀 `//server/share` 与 POSIX 根 `/`。
 */
export function normalizeFsPath(input: string): string {
	const unified = input.replace(/\\/g, '/');
	const driveMatch = /^\/?([a-zA-Z]):(?=\/|$)/.exec(unified);
	const drive = driveMatch ? driveMatch[1].toLowerCase() : undefined;
	const rest = driveMatch ? unified.slice(driveMatch[0].length) : unified;
	const unc = !drive && rest.startsWith('//');
	const absolute = drive !== undefined || rest.startsWith('/');

	const segments: string[] = [];
	for (const part of rest.split('/')) {
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			if (segments.length > 0 && segments[segments.length - 1] !== '..') {
				segments.pop();
			} else if (!absolute && !drive) {
				segments.push('..');
			}
			continue;
		}
		segments.push(part);
	}

	const prefix = drive !== undefined ? `${drive}:/` : unc ? '//' : absolute ? '/' : '';
	return `${prefix}${segments.join('/')}`;
}

function joinFsPath(base: string, relative: string): string {
	return base.endsWith('/') ? `${base}${relative}` : `${base}/${relative}`;
}

function dirnameFsPath(path: string): string {
	const normalized = normalizeFsPath(path);
	const index = normalized.lastIndexOf('/');
	if (index < 0) {
		return normalized;
	}
	if (index === 0) {
		return '/';
	}
	const dir = normalized.slice(0, index);
	return /^[a-zA-Z]:$/.test(dir) ? `${dir}/` : dir;
}

function isWindowsPath(path: string): boolean {
	return /^\/?[a-zA-Z]:/.test(path);
}

export interface VscodeFileHrefParts {
	/** 解码并归一化后的路径（不做"相对当前文档"的拼接）。 */
	readonly path: string;
	readonly line?: number;
}

/**
 * `vscode://file/<路径>[:行号][#L行号]` → 路径与行号。
 * 供链接解析与 HTML 改写共用，避免两处正则对 `#L10` / 编码的处理慢慢跑偏。
 */
export function parseVscodeFileHrefParts(href: string): VscodeFileHrefParts | undefined {
	const match = VSCODE_FILE_HREF.exec(typeof href === 'string' ? href.trim() : '');
	if (!match) {
		return undefined;
	}

	const split = splitHashAndQuery(match[1]);
	// 先解码再拆行号：markdown-it 会把冒号规范成 `%3A`（实测链接里是
	// `vscode://file/d%3A/...md%3A7`），在原始串上匹配 `:数字` 会漏掉行号、
	// 甚至把它混进文件名。
	const decoded = safeDecode(split.pathText).replace(/\\/g, '/');
	const lineSuffix = splitLineSuffix(decoded);
	const line = lineSuffix.line ?? lineFromFragment(safeDecode(split.fragment));
	if (!lineSuffix.pathText) {
		return undefined;
	}
	return { path: normalizeFsPath(lineSuffix.pathText), line };
}

/** `vscode://file/<路径>[:行号][#L行号]` → 本地文件。 */
function parseVscodeFileHref(href: string, documentPath: string): LinkTarget | undefined {
	const parts = parseVscodeFileHrefParts(href);
	if (!parts) {
		return undefined;
	}
	// 规范写法是绝对路径；写了相对路径也按"相对当前文档"处理，不要交给 Uri.file
	// （那会相对扩展宿主的进程目录，指向不可预期的位置）。
	const path = isAbsoluteFsPath(parts.path)
		? parts.path
		: normalizeFsPath(joinFsPath(dirnameFsPath(documentPath), parts.path));
	return fileTarget(href, path, parts.line);
}

/** `file:///d:/x.md` / `file://server/share/x.md` → 本地文件。 */
function parseFileHref(href: string): LinkTarget {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return ignore(href);
	}

	let pathname = safeDecode(url.pathname);
	if (url.host && url.host !== 'localhost') {
		pathname = `//${url.host}${pathname}`;
	}
	const lineSuffix = splitLineSuffix(pathname);
	const line = lineSuffix.line ?? lineFromFragment(safeDecode(url.hash.replace(/^#/, '')));
	const path = normalizeFsPath(lineSuffix.pathText);
	return path ? fileTarget(href, path, line) : ignore(href);
}

/** 相对 / 绝对本地路径（含用户手写的 `vscode://file/` 之外的普通写法）。 */
function resolveFileHref(href: string, documentPath: string, workspaceRootPath: string | undefined): LinkTarget {
	const split = splitHashAndQuery(href);
	const decodedRaw = safeDecode(split.pathText).replace(/\\/g, '/');
	const lineSuffix = splitLineSuffix(decodedRaw);
	const line = lineSuffix.line ?? lineFromFragment(safeDecode(split.fragment));
	const decoded = lineSuffix.pathText;
	if (!decoded) {
		return ignore(href);
	}

	if (isAbsoluteFsPath(decoded)) {
		// `/x.md` 在 Markdown 里是"工作区根相对"（与内置预览的解析一致），
		// 不是磁盘根目录。没有工作区根时，Windows 上无法确定盘符 → 放弃；
		// POSIX 文档上 `/x.md` 本来就是绝对路径，照常打开。
		if (decoded.startsWith('/') && !decoded.startsWith('//') && !WINDOWS_DRIVE_PATH.test(decoded)) {
			const root = workspaceRootPath ? toFsPath(workspaceRootPath) : undefined;
			if (root) {
				return fileTarget(href, normalizeFsPath(joinFsPath(root, decoded.replace(/^\/+/, ''))), line);
			}
			return isWindowsPath(documentPath)
				? ignore(href)
				: fileTarget(href, normalizeFsPath(decoded), line);
		}
		return fileTarget(href, normalizeFsPath(decoded), line);
	}

	// 没有文档路径（untitled: 之类）时，相对链接没有解析基准 —— 不要拼出
	// `/foo.md` 这种指向磁盘根的假路径。
	if (!documentPath) {
		return ignore(href);
	}
	const dir = dirnameFsPath(documentPath);
	return fileTarget(href, normalizeFsPath(joinFsPath(dir, decoded)), line);
}

/**
 * 解析一个 `<a>` 的原始 href。
 *
 * @param rawHref 元素上的原始属性值（**不是** 浏览器解析后的 `anchor.href`）。
 * @param documentPath 文档的 URI path（`vscode.Uri#path`，例如 `/d:/ws/doc.md`）。
 * @param workspaceRootPath 文档所属工作区根的 URI path（可选；`/开头` 的链接要用）。
 */
export function resolveLinkTarget(rawHref: string, documentPath: string, workspaceRootPath?: string): LinkTarget {
	const href = typeof rawHref === 'string' ? rawHref.trim() : '';
	if (!href) {
		return ignore(href);
	}

	// 页内锚点 / 纯查询串：交给浏览器与 webview 外壳处理（滚动、目录定位）。
	if (href.startsWith('#') || href.startsWith('?')) {
		return ignore(href);
	}

	const vscodeFile = parseVscodeFileHref(href, documentPath);
	if (vscodeFile) {
		return vscodeFile;
	}

	if (!WINDOWS_DRIVE_PATH.test(href)) {
		const schemeMatch = URI_SCHEME.exec(href);
		if (schemeMatch) {
			const scheme = schemeMatch[1].toLowerCase();
			if (scheme === 'file') {
				return parseFileHref(href);
			}
			if (EXTERNAL_SCHEMES.has(scheme)) {
				return { kind: 'external', href };
			}
			// `vscode://settings/...` 之类：交回系统协议处理器，和 VS Code 内置行为一致。
			if (scheme === 'vscode' || scheme === 'vscode-insider' || scheme === 'vscode-insiders') {
				return { kind: 'external', href };
			}
			if (UNSAFE_SCHEMES.has(scheme)) {
				return ignore(href);
			}
			return ignore(href);
		}
		// `//example.com/x`：协议相对 URL（不是 UNC —— UNC 用反斜杠写）。
		if (href.startsWith('//')) {
			return { kind: 'external', href: `https:${href}` };
		}
	}

	return resolveFileHref(href, documentPath, workspaceRootPath);
}
