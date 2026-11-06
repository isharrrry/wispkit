import { escapeAttribute } from '../util/html';
import { rewriteVscodeFileLinksInHtml } from '../util/linkRewrite';

/**
 * HTML 视图要放行页面自带的脚本与样式（"浏览 HTML"的本意），所以**不能**同时给出 nonce：
 * CSP3 下 `script-src` 里一旦出现 nonce，`'unsafe-inline'` 就会被忽略。
 */
export function permissiveContentSecurityPolicy(cspSource: string): string {
	const rule = cspSource.split(';')[0];
	return [
		`default-src 'none'`,
		`img-src 'self' ${rule} data: https: http:`,
		`media-src 'self' ${rule} https: http:`,
		`script-src 'self' ${rule} 'unsafe-inline' 'unsafe-eval' https: http:`,
		`style-src 'self' ${rule} 'unsafe-inline' https: http:`,
		`font-src 'self' ${rule} data: https: http:`,
		`connect-src 'self' ${rule} https: http:`,
		`frame-src 'self' ${rule} https: http:`,
	].join('; ') + ';';
}

export function injectIntoHead(html: string, head: string): string {
	if (head.length === 0) {
		return html;
	}
	const headOpen = /<head\b[^>]*>/i.exec(html);
	if (headOpen) {
		const at = headOpen.index + headOpen[0].length;
		return `${html.slice(0, at)}\n${head}${html.slice(at)}`;
	}
	const htmlOpen = /<html\b[^>]*>/i.exec(html);
	if (htmlOpen) {
		const at = htmlOpen.index + htmlOpen[0].length;
		return `${html.slice(0, at)}\n<head>\n${head}\n</head>${html.slice(at)}`;
	}
	return `<head>\n${head}\n</head>\n${html}`;
}

export interface HtmlPageOptions {
	/** 文档的 webview 资源 URL；相对 css/js/图片靠它加载。 */
	readonly baseHref?: string;
	readonly cspSource: string;
	/**
	 * 链接路由脚本的 webview URL。页面里的相对链接会被 `<base>` 解析成宿主资源 URL，
	 * 点击必须由前端截住、把原始 href 送回扩展 —— 详见 `media/shared/links.js`。
	 */
	readonly scriptSrc?: string;
}

export function buildHtmlFromSource(source: string, options: HtmlPageOptions): string {
	const rewritten = rewriteVscodeFileLinksInHtml(source);
	const script = options.scriptSrc
		? `<script defer src="${escapeAttribute(options.scriptSrc)}"></script>`
		: '';
	const head = [
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(permissiveContentSecurityPolicy(options.cspSource))}">`,
		options.baseHref ? `<base href="${escapeAttribute(options.baseHref)}">` : '',
		script,
	].filter(part => part.length > 0).join('\n');
	return injectIntoHead(rewritten, head);
}
