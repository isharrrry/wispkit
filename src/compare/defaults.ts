import * as path from 'node:path';

/**
 * 「对比浏览」的默认位置与路径输入解析。
 *
 * 这里刻意不 import vscode / fs：默认位置只做候选排序，是否存在由调用方注入的
 * `isDirectory` 判断；路径输入也只做字符串处理。这样平台差异与各种奇怪的输入
 * 都能在 mocha 里直接覆盖，且**任何输入都不应抛异常** —— 页面必须能打开。
 */

export type CompareRootKind = 'desktop' | 'recent' | 'home';

export interface CompareRoot {
	readonly path: string;
	readonly label: string;
	readonly kind: CompareRootKind;
	/** 默认位置不可用而回退时给出的说明，显示在该侧状态栏。 */
	readonly note?: string;
}

export interface DefaultRootsInput {
	/** `process.platform` 的值；测试里可以传 `'win32' | 'darwin' | 'linux'`。 */
	readonly platform: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly home: string;
	/** 同步判断一个路径是不是真实存在的文件夹；不允许抛异常。 */
	readonly isDirectory: (fsPath: string) => boolean;
}

export interface DefaultRootsResult {
	readonly left: CompareRoot;
	readonly right: CompareRoot;
}

function pathFor(platform: string): path.PlatformPath {
	return platform === 'win32' ? path.win32 : path.posix;
}

/** Windows 环境变量名大小写不敏感；测试里传普通对象也按这个规则查。 */
export function envValue(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	const direct = env[name];
	if (typeof direct === 'string' && direct.trim()) {
		return direct.trim();
	}
	const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
	const value = key ? env[key] : undefined;
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniquePaths(candidates: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const candidate of candidates) {
		if (!candidate || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		out.push(candidate);
	}
	return out;
}

/** 桌面候选：OneDrive 重定向与中文目录名都覆盖到，顺序即优先级。 */
export function desktopCandidates(
	platform: string,
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string[] {
	const impl = pathFor(platform);
	const candidates: string[] = [];
	const xdg = envValue(env, 'XDG_DESKTOP_DIR');
	if (xdg && impl.isAbsolute(xdg)) {
		candidates.push(impl.normalize(xdg));
	}
	candidates.push(impl.join(home, 'Desktop'));
	if (platform === 'win32') {
		const oneDrive = envValue(env, 'OneDrive') ?? envValue(env, 'OneDriveConsumer');
		if (oneDrive) {
			candidates.push(impl.join(oneDrive, 'Desktop'), impl.join(oneDrive, '桌面'));
		}
		candidates.push(impl.join(home, 'OneDrive', 'Desktop'), impl.join(home, 'OneDrive', '桌面'));
	}
	candidates.push(impl.join(home, '桌面'));
	return uniquePaths(candidates);
}

/** Windows「最近使用」候选；其他系统没有等价目录，返回空数组由调用方回退。 */
export function recentCandidates(
	platform: string,
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string[] {
	if (platform !== 'win32') {
		return [];
	}
	const impl = path.win32;
	const candidates: string[] = [];
	const appData = envValue(env, 'APPDATA');
	if (appData) {
		candidates.push(impl.join(appData, 'Microsoft', 'Windows', 'Recent'));
	}
	candidates.push(impl.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Recent'));
	return uniquePaths(candidates);
}

function safeHome(platform: string, home: string): string {
	const value = typeof home === 'string' ? home.trim() : '';
	if (value) {
		return value;
	}
	return platform === 'win32' ? 'C:\\' : '/';
}

/**
 * 默认左右根目录：
 *   - 左：桌面（找不到就用主目录）；
 *   - 右：`%APPDATA%\Microsoft\Windows\Recent`；非 Windows 或不存在时用主目录。
 * 永远不会抛异常，回退原因写进 `note`。
 */
export function computeDefaultRoots(input: DefaultRootsInput): DefaultRootsResult {
	const platform = typeof input.platform === 'string' ? input.platform : 'linux';
	const home = safeHome(platform, input.home);
	const isDirectory = typeof input.isDirectory === 'function' ? input.isDirectory : () => false;
	const probe = (candidate: string): boolean => {
		try {
			return isDirectory(candidate) === true;
		} catch {
			return false;
		}
	};

	const desktop = desktopCandidates(platform, input.env ?? {}, home).find(probe);
	const left: CompareRoot = desktop
		? { path: desktop, label: '桌面', kind: 'desktop' }
		: {
			path: home,
			label: '主目录',
			kind: 'home',
			note: '未找到桌面文件夹，左侧已打开主目录。',
		};

	const recent = recentCandidates(platform, input.env ?? {}, home).find(probe);
	const right: CompareRoot = recent
		? { path: recent, label: '最近使用', kind: 'recent' }
		: {
			path: home,
			label: '主目录',
			kind: 'home',
			note: platform === 'win32'
				? '未找到 Windows「最近使用」文件夹，右侧已打开主目录。'
				: '当前系统没有 Windows「最近使用」文件夹，右侧已打开主目录。',
		};

	return { left, right };
}

// ── 路径输入 ──────────────────────────────────────────────────────────────

export interface ResolveInputOptions {
	readonly input: string;
	/** 相对路径的基准（通常是对应一侧当前的根目录）。 */
	readonly base: string;
	readonly home: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly platform: string;
}

export interface ResolvedPath {
	readonly path: string;
}

export interface PathInputError {
	readonly error: string;
}

export type PathInputResult = ResolvedPath | PathInputError;

function stripSurroundingQuotes(value: string): string {
	const match = /^(['"])(.*)\1$/s.exec(value);
	return match ? match[2].trim() : value;
}

function expandEnvironment(
	value: string,
	env: Readonly<Record<string, string | undefined>>,
): PathInputResult {
	let missing: string | undefined;
	// 只认 Windows 风格的环境变量名，避免把文件名里的 `%` 误当成占位符。
	const withPercent = value.replace(/%([A-Za-z_][A-Za-z0-9_()]*)%/g, (match, name: string) => {
		const found = envValue(env, name.trim());
		if (found === undefined) {
			if (!missing) {
				missing = name.trim();
			}
			return match;
		}
		return found;
	});
	if (missing) {
		return { error: `环境变量 %${missing}% 未定义。` };
	}

	let missingBraces: string | undefined;
	const withBraces = withPercent.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
		const found = envValue(env, name);
		if (found === undefined) {
			if (!missingBraces) {
				missingBraces = name;
			}
			return match;
		}
		return found;
	});
	if (missingBraces) {
		return { error: `环境变量 \${${missingBraces}} 未定义。` };
	}
	return { path: withBraces };
}

function fileUriToPath(value: string, platform: string): PathInputResult {
	const impl = pathFor(platform);
	try {
		const url = new URL(value);
		let pathname = decodeURIComponent(url.pathname);
		if (url.hostname) {
			pathname = `//${url.hostname}${pathname}`;
		}
		if (platform === 'win32') {
			if (/^\/[A-Za-z]:/.test(pathname)) {
				pathname = pathname.slice(1);
			}
			pathname = pathname.replace(/\//g, '\\');
		}
		return { path: impl.normalize(pathname) };
	} catch {
		return { error: 'file:// 路径无法解析。' };
	}
}

/**
 * 解析路径输入框：
 *   - 去掉首尾空白与成对引号；
 *   - `~` / `~/` / `~\` 展开成主目录；
 *   - `%VAR%` 与 `${VAR}` 展开环境变量，未定义时返回可读错误；
 *   - 支持 `file://` URI；
 *   - 相对路径按 `base` 解析。
 */
export function resolveCompareInput(options: ResolveInputOptions): PathInputResult {
	const platform = typeof options.platform === 'string' ? options.platform : 'linux';
	const impl = pathFor(platform);
	const home = safeHome(platform, options.home);
	const env = options.env ?? {};

	let text = typeof options.input === 'string' ? options.input.trim() : '';
	text = stripSurroundingQuotes(text);
	if (!text) {
		return { error: '请输入文件夹路径。' };
	}

	if (/^file:\/\//i.test(text)) {
		const parsed = fileUriToPath(text, platform);
		if ('error' in parsed) {
			return parsed;
		}
		text = parsed.path;
	}

	if (text === '~') {
		text = home;
	} else if (text.startsWith('~/') || text.startsWith('~\\')) {
		text = impl.join(home, text.slice(2));
	} else if (text.startsWith('~')) {
		return { error: '暂不支持 ~用户名 形式的路径，请使用 ~/ 或绝对路径。' };
	}

	const expanded = expandEnvironment(text, env);
	if ('error' in expanded) {
		return expanded;
	}
	const value = expanded.path.trim();
	if (!value) {
		return { error: '请输入文件夹路径。' };
	}

	const base = typeof options.base === 'string' && options.base.trim() ? options.base.trim() : home;
	const resolved = impl.isAbsolute(value) ? impl.normalize(value) : impl.resolve(base, value);
	return { path: resolved };
}
