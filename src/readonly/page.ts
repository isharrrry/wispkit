import { escapeAttribute, escapeHtml } from '../util/html';
import { detectSyntax, highlightToHtml, type ReadonlySyntax } from './highlight';

export interface ReadonlyPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly text: string;
	readonly totalBytes: number;
	readonly shownLines: number;
	readonly truncated: boolean;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	/** 决定高亮规则。缺省时按文件名（`title`）推断。 */
	readonly syntax?: ReadonlySyntax;
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '未知大小';
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}

/** 横幅文案：明确告诉用户"没加载的部分不会渲染"，避免误以为文件只有这么长。 */
export function readonlyBanner(options: Pick<ReadonlyPageOptions, 'shownLines' | 'totalBytes' | 'truncated'>): string {
	return options.truncated
		? `只读模式 · 只加载了前 ${options.shownLines} 行（文件共 ${formatBytes(options.totalBytes)}），未加载的部分不会渲染`
		: `只读模式 · ${options.shownLines} 行 · ${formatBytes(options.totalBytes)}`;
}

/**
 * 行号栏：一行一个 span，行高由 CSS 的 `--wispkit-readonly-line-height` 统一决定 ——
 * 必须与正文用同一个变量、同一套字体度量（`readonly.css` 里有对应的契约断言），否则行号会串行。
 */
export function renderGutter(text: string): string {
	const lineCount = Math.max(1, text.split('\n').length);
	const numbers: string[] = [];
	for (let line = 1; line <= lineCount; line++) {
		numbers.push(`<span class="wispkit-readonly-gutter-line">${line}</span>`);
	}
	return numbers.join('');
}

/**
 * 行号与正文放进**同一个滚动容器**：只读视图不像 XAML 那样有 textarea 叠层，
 * 所以不需要任何滚动同步代码，行号天然跟着正文走。
 */
export function renderReadonlyPage(options: ReadonlyPageOptions): string {
	const syntax = options.syntax ?? detectSyntax(options.title);
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body>
	<div class="wispkit-readonly-banner" id="wispkit-readonly-banner">${escapeHtml(readonlyBanner(options))}</div>
	<div class="wispkit-readonly-scroll" id="wispkit-readonly-scroll" tabindex="0">
		<div class="wispkit-readonly-code">
			<div class="wispkit-readonly-gutter" aria-hidden="true">${renderGutter(options.text)}</div>
			<pre class="wispkit-readonly-text" id="wispkit-readonly-text"><code id="wispkit-readonly-code">${highlightToHtml(options.text, syntax)}</code></pre>
		</div>
	</div>
	<button type="button" class="wispkit-readonly-unlock" id="wispkit-readonly-unlock" title="解除只读：改用 VS Code 原生编辑器打开此文件">解锁编辑</button>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
