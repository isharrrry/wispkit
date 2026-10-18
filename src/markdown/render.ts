/**
 * 把 Markdown 源码渲染成 HTML。
 *
 * 复用内置 Markdown 引擎的隐藏命令 `markdown.api.render`
 * （markdown-language-features/dist/extension.js: id="markdown.api.render", execute(text) => (await engine.render(text)).html）。
 * 走它的好处是 `markdown.markdownItPlugins` 贡献点会被自动应用 —— 内置的
 * markdown-math（KaTeX）与 mermaid-markdown-features（把 mermaid fence 变成
 * `<div class="mermaid">`）都靠这条通路生效。
 */

export const RENDER_COMMAND = 'markdown.api.render';

export interface RenderResult {
	readonly html: string;
	readonly error?: string;
}

export async function renderMarkdownHtml(
	text: string,
	executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>,
	renderInput?: unknown,
): Promise<RenderResult> {
	try {
		// 传文档对象（而非字符串）时，内置引擎会把文档 URI 填进 `env.currentDocument`
		// （markdownEngine.ts:206 `currentDocument: typeof input === 'string' ? undefined : input.uri`）。
		// 第三方 markdown-it 插件依赖它：drawio 的 `data-doc-uri` 是它预览里"编辑"按钮的
		// 唯一来源，缺了它按钮根本不会生成。
		const html = await executeCommand(RENDER_COMMAND, renderInput ?? text);
		if (typeof html === 'string') {
			return { html };
		}
		return { html: '', error: `markdown.api.render 返回了非字符串（${typeof html}）` };
	} catch (error) {
		return { html: '', error: error instanceof Error ? error.message : String(error) };
	}
}
