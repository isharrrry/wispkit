/**
 * Markdown 浏览器的主题模式。
 *
 * 三个状态的顺序就是工具栏里从左到右的顺序：浅色 / 跟随主题 / 深色。
 * `auto` 完全交给 VS Code 当前颜色主题；另外两个是**强制**明暗，只作用于
 * Wispkit 的 Markdown 视图，不改 VS Code 自己的主题。
 *
 * 这是**全局状态**（存在 `context.globalState`），由宿主广播给所有打开中的
 * Markdown webview —— webview 的 `localStorage` / `state` 都按面板隔离，
 * 做不到「对所有 md 文档生效」。
 */
export const MARKDOWN_THEME_MODES = ['light', 'auto', 'dark'] as const;

export type MarkdownThemeMode = typeof MARKDOWN_THEME_MODES[number];

export const DEFAULT_MARKDOWN_THEME_MODE: MarkdownThemeMode = 'auto';

/** `globalState` 里的键。改键名等于丢掉用户已有的选择。 */
export const MARKDOWN_THEME_STATE_KEY = 'wispkit.markdown.themeMode';

export function isMarkdownThemeMode(value: unknown): value is MarkdownThemeMode {
	return typeof value === 'string' && (MARKDOWN_THEME_MODES as readonly string[]).includes(value);
}

/** 把持久化 / 消息里的任意值收敛成合法模式；非法值回落到默认（跟随主题）。 */
export function normalizeMarkdownThemeMode(value: unknown): MarkdownThemeMode {
	return isMarkdownThemeMode(value) ? value : DEFAULT_MARKDOWN_THEME_MODE;
}
