/**
 * webview 的 CSP 文本，镜像 VS Code 内置 Markdown 预览的 Strict 级策略
 * （extensions/markdown-language-features/src/preview/documentRenderer.ts:275）。
 *
 * 保持逐字一致是有意为之：内置 Mermaid / KaTeX 扩展的脚本是按这条策略写的
 * （脚本带 nonce、样式走 cspSource、内联样式放行），换一条策略就会把它们拦掉。
 */
export function strictContentSecurityPolicy(cspSource: string, nonce: string): string {
	const rule = cspSource.split(';')[0];
	return `default-src 'none'; img-src 'self' ${rule} https: data:; media-src 'self' ${rule} https: data:; script-src 'nonce-${nonce}'; style-src 'self' ${rule} 'unsafe-inline' https: data:; font-src 'self' ${rule} https: data:;`;
}
