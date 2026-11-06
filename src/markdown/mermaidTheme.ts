/**
 * Markdown 浏览器里的 Mermaid 图表主题。
 *
 * 内置 mermaid-markdown-features 的预览脚本渲染时读两处配置：
 * 1. `#markdown-mermaid[data-config]` —— 明暗两套主题名（`lightModeTheme` / `darkModeTheme`）；
 * 2. body 上的 `vscode-light` / `vscode-dark` 类别 —— 决定取哪一套。
 *
 * 所以「Wispkit 选用某个 Mermaid 主题」= 把两套都写成同一个名字再触发重渲染。
 * `vscode` 是内置扩展的哨兵值：按 VS Code 当前明暗推导配色；其余是 Mermaid 自带主题。
 *
 * 状态与「主题三态」一样是**全局**的（`globalState`），由宿主广播给所有 Markdown 视图。
 */
export const MARKDOWN_MERMAID_THEMES = ['vscode', 'default', 'forest', 'dark', 'neutral', 'base'] as const;

export type MarkdownMermaidTheme = typeof MARKDOWN_MERMAID_THEMES[number];

export const DEFAULT_MARKDOWN_MERMAID_THEME: MarkdownMermaidTheme = 'vscode';

/** `globalState` 里的键。改键名等于丢掉用户已有的选择。 */
export const MARKDOWN_MERMAID_THEME_STATE_KEY = 'wispkit.markdown.mermaidTheme';

export function isMarkdownMermaidTheme(value: unknown): value is MarkdownMermaidTheme {
	return typeof value === 'string' && (MARKDOWN_MERMAID_THEMES as readonly string[]).includes(value);
}

export function normalizeMarkdownMermaidTheme(value: unknown): MarkdownMermaidTheme {
	return isMarkdownMermaidTheme(value) ? value : DEFAULT_MARKDOWN_MERMAID_THEME;
}

/** 与 `escapeAttribute` 对称的解码；只处理该工具会产出的五个实体。 */
function decodeAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function encodeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** 内置扩展的 markdown-it 插件在每次 render 时前置的配置 span。 */
const MERMAID_CONFIG_SPAN = /<span\b[^>]*\bid="markdown-mermaid"[^>]*>/i;

/**
 * 把内置 Mermaid 预览脚本的配置 span 改成 Wispkit 选中的主题。
 *
 * 只改 `lightModeTheme` / `darkModeTheme`，其余字段（`maxTextSize`、鼠标导航、控件显示、
 * 可调整高度等）原样保留 —— 那些仍是用户在 VS Code 设置里的选择。
 * 没有这个 span（未安装内置 Mermaid 扩展 / 该文档没有走 markdown-it 插件）时原样返回。
 *
 * **必须在 HTML 交给 webview 之前改**：预览脚本是 `async` 模块，页面里的运行时脚本
 * 不保证先于它执行；服务端写入是唯一不依赖竞态的通路。
 */
export function applyMermaidThemeToBodyHtml(html: string, theme: unknown): string {
	const mode = normalizeMarkdownMermaidTheme(theme);
	return html.replace(MERMAID_CONFIG_SPAN, tag => {
		const match = /\bdata-config="([^"]*)"/i.exec(tag);
		if (!match) {
			return tag;
		}
		let config: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(decodeAttribute(match[1]));
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return tag;
			}
			config = parsed as Record<string, unknown>;
		} catch {
			// data-config 坏掉时不猜内容：原样保留，让内置扩展自己兜底。
			return tag;
		}
		config.lightModeTheme = mode;
		config.darkModeTheme = mode;
		const attribute = `data-config="${encodeAttribute(JSON.stringify(config))}"`;
		return tag.replace(match[0], () => attribute);
	});
}
