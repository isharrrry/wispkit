/**
 * 把 HTML 里的 `vscode://file/<路径>[:行号]` 链接改写成 `command:` 链接。
 *
 * 为什么需要改写：webview 外壳会把点击到的链接上报给宿主，宿主的
 * `isSupportedLink` 只放行 http/https/mailto/vscode(+insider)，其余 scheme 必须
 * 落在 `contentOptions.enableCommandUris` 分支上。`vscode:` 虽在白名单里，但会
 * 绕经系统协议处理器（可能另起窗口）；改成 `command:` 则直连当前窗口。
 */

const VSCODE_FILE_LINK = /^vscode:\/\/file\/(.+?)(?::(\d+))?$/;

export interface OpenCommandArgs {
	readonly resource: string;
	readonly selection?: {
		readonly start: { readonly line: number; readonly character: number };
		readonly end: { readonly line: number; readonly character: number };
	};
}

/** `d:\a\b.md` / `/home/a/b.md` → `file:///d:/a/b.md` / `file:///home/a/b.md` */
export function fileUriFromPath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`;
	return `file://${encodeURI(rooted).replace(/[?#]/g, character => encodeURIComponent(character))}`;
}

/**
 * `vscode://file/d:/a/b.md:207` → `command:vscode.open?<encodeURIComponent(JSON)>`
 * 非 `vscode://file/` 形式返回 undefined（调用方保持原链接不动）。
 */
export function rewriteVscodeFileLink(href: string): string | undefined {
	const match = VSCODE_FILE_LINK.exec(href.trim());
	if (!match) {
		return undefined;
	}

	const filePath = decodeURIComponent(match[1]);
	const line = match[2] ? Number(match[2]) : undefined;
	const args: OpenCommandArgs = line === undefined || !Number.isFinite(line) || line < 1
		? { resource: fileUriFromPath(filePath) }
		: {
			resource: fileUriFromPath(filePath),
			selection: {
				start: { line: line - 1, character: 0 },
				end: { line: line - 1, character: 0 },
			},
		};

	return `command:vscode.open?${encodeURIComponent(JSON.stringify([args.resource, args.selection ? { selection: args.selection } : undefined].filter(value => value !== undefined)))}`;
}

/** 改写整篇 HTML 里所有 `href="vscode://file/..."`。 */
export function rewriteVscodeFileLinksInHtml(html: string): string {
	return html.replace(/(\bhref\s*=\s*)(["'])vscode:\/\/file\/([^"']*)\2/gi, (match, prefix: string, quote: string, rest: string) => {
		const rewritten = rewriteVscodeFileLink(`vscode://file/${rest}`);
		return rewritten ? `${prefix}${quote}${rewritten}${quote}` : match;
	});
}
