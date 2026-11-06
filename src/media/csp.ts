/**
 * 图片 / 视频视图的 CSP。纯函数，放这里是为了不 import vscode，单测可直接跑。
 */

/** 图片视图：`img-src` 必须放行 `data:`（data URI 图片），脚本只认 nonce。 */
export function imageContentSecurityPolicy(cspSource: string, nonce: string): string {
	return `default-src 'none'; img-src data: ${cspSource}; connect-src ${cspSource}; script-src 'nonce-${nonce}'; style-src ${cspSource} 'nonce-${nonce}';`;
}

/** 视频视图：`media-src` 必须放行 webview 资源源，否则 `<video>` 会被拒载。 */
export function videoContentSecurityPolicy(cspSource: string, nonce: string): string {
	return `default-src 'none'; media-src ${cspSource}; img-src data: ${cspSource}; connect-src ${cspSource}; script-src 'nonce-${nonce}'; style-src ${cspSource} 'nonce-${nonce}';`;
}
