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

export function buildHtmlFromSource(source: string, baseHref: string | undefined, cspSource: string): string {
	const rewritten = rewriteVscodeFileLinksInHtml(source);
	const head = [
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(permissiveContentSecurityPolicy(cspSource))}">`,
		baseHref ? `<base href="${escapeAttribute(baseHref)}">` : '',
	].filter(part => part.length > 0).join('\n');
	return injectIntoHead(rewritten, head);
}
