import { escapeAttribute, escapeHtml } from '../util/html';
import { highlightToHtml, type HighlightLanguage } from './highlight';
import type { XamlRenderResult } from './renderer';

/** 传给前端的最小状态（宽度/可见性等交互状态由前端自己管，只把初始值带过去）。 */
export interface XamlViewConfig {
	readonly wheelStep: number;
	readonly dragButton: 'left' | 'right' | 'middle';
	readonly codeVisible: boolean;
	readonly codeWidth: number;
}

/** 三态布局：都显示 / 只代码（收纳右侧）/ 只渲染（收纳左侧）。 */
export type XamlLayoutMode = 'both' | 'code' | 'preview';

export interface XamlPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	/** 源码全文（`.xaml.cs` 时是 C# 源码）。 */
	readonly code: string;
	/** 决定高亮规则。 */
	readonly language: HighlightLanguage;
	/** 渲染出的 PNG 地址；失败时为空，此时页面显示错误面板。 */
	readonly imageSrc?: string;
	/** 渲染结果，用来决定显示图片还是错误面板，以及状态栏文案。 */
	readonly result: XamlRenderResult;
	/** 渲染对象不是本文件时（`.xaml.cs` 渲染同名 `.xaml`）在状态栏标注出来。 */
	readonly renderTargetName?: string;
	/** 覆盖错误面板的「常见原因」提示。 */
	readonly errorHint?: string;
	readonly config: XamlViewConfig;
}

/**
 * 行号栏：一行一个 span，行高由 `--wispkit-xaml-line-height` 统一决定 ——
 * 与右边的 textarea / 高亮层用同一个变量、同一套字体度量，行号才不会串行。
 */
export function renderGutter(code: string): string {
	const lineCount = Math.max(1, code.split(/\r?\n/).length);
	const numbers: string[] = [];
	for (let line = 1; line <= lineCount; line++) {
		numbers.push(`<span class="wispkit-xaml-gutter-line">${line}</span>`);
	}
	return numbers.join('');
}

/** 高亮层内容。末尾补一个换行：`<pre>` 会丢掉最后一个空行，导致高度比 textarea 少一行。 */
export function renderHighlight(code: string, language: HighlightLanguage): string {
	return `${highlightToHtml(code, language)}\n`;
}

function renderStatus(result: XamlRenderResult, renderTargetName?: string): string {
	const target = renderTargetName ? `渲染对象 ${renderTargetName}` : undefined;
	if (!result.ok) {
		return [`渲染失败${result.errorType ? ` · ${result.errorType}` : ''}`, target]
			.filter((part): part is string => Boolean(part))
			.join(' · ');
	}
	const parts = [
		'渲染成功',
		result.root ? `root=${result.root}` : undefined,
		result.width && result.height ? `${result.width}×${result.height}` : undefined,
		result.mode ? `mode=${result.mode}` : undefined,
		target,
	].filter((part): part is string => Boolean(part));
	return parts.join(' · ');
}

function renderErrorPanel(result: XamlRenderResult, hint: string): string {
	return `<div class="wispkit-xaml-error" id="wispkit-xaml-error"${result.ok ? ' hidden' : ''}>
			<h2 class="wispkit-xaml-error-title">渲染失败</h2>
			<p class="wispkit-xaml-error-type" id="wispkit-xaml-error-type">${escapeHtml(result.errorType ?? '未知错误类型')}</p>
			<pre class="wispkit-xaml-error-message" id="wispkit-xaml-error-message">${escapeHtml(result.error ?? '渲染器没有给出原因')}</pre>
			<p class="wispkit-xaml-error-hint">${hint}</p>
		</div>`;
}

const DEFAULT_ERROR_HINT = '常见原因：<code>x:Class</code> 指向的类型没有编译进程序集 · XAML 里绑定了事件处理器而代码里没有 · 引用了自定义控件（<code>clr-namespace</code> / <code>assembly=</code>）。给渲染器补上目标程序集（<code>--assembly</code>）后重试。';

/**
 * 工具栏图标：内联 SVG sprite，一次放进页面，前端用 `<use href="#wispkit-icon-x">` 引用。
 *
 * 与子树视图（`src/subtree/page.ts`）和 Markdown 视图（`src/markdown/page.ts`）同一套做法：
 * symbol 上写 `stroke="currentColor"`，颜色完全由 CSS 的 `color` 决定 —— 所以悬停、
 * 三态按钮的激活态（`.wispkit-xaml-btn-active`）与高对比度主题都会自动正确，
 * 不需要为每个状态单独配色。内联 sprite **零第三方依赖、零额外请求**，
 * 也不用动 `esbuild.mjs` / `.vscodeignore`（不引字体文件）。
 */
const ICONS: Readonly<Record<string, string>> = {
	save: '<path d="M2.5 2.5h8L13.5 5.5v8h-11z"/><path d="M5.5 2.5v4h5v-4"/><path d="M4.5 13.5v-4h7v4"/>',
	rerender: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.5 2.2v3.6H10"/>',
	lightbox: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/><path d="M5 7h4"/><path d="M7 5v4"/>',
	fit: '<path d="M2.5 6V2.5H6"/><path d="M10 2.5h3.5V6"/><path d="M13.5 10v3.5H10"/><path d="M6 13.5H2.5V10"/>',
	'layout-all': '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M8 3.5v9"/>',
	'layout-code': '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M6.5 3.5v9"/><path d="M13 6.5 10.5 8 13 9.5"/>',
	'layout-preview': '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M9.5 3.5v9"/><path d="M3 6.5 5.5 8 3 9.5"/>',
	reset: '<circle cx="8" cy="8" r="5"/><path d="M8 5.5V8l2 1.5"/>',
	close: '<path d="M4.5 4.5l7 7"/><path d="M11.5 4.5l-7 7"/>',
};

export const XAML_ICON_NAMES: readonly string[] = Object.keys(ICONS);

export function xamlIconSprite(): string {
	const symbols = Object.entries(ICONS)
		.map(([name, body]) => `<symbol id="wispkit-icon-${name}" viewBox="0 0 16 16" `
			+ `fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">`
			+ `${body}</symbol>`)
		.join('');
	return `<svg class="wispkit-xaml-sprite" aria-hidden="true" focusable="false" width="0" height="0">${symbols}</svg>`;
}

function iconMarkup(name: string): string {
	return `<svg class="wispkit-xaml-btn-icon" aria-hidden="true" focusable="false">`
		+ `<use href="#wispkit-icon-${escapeAttribute(name)}"></use></svg>`;
}

/**
 * 按钮 = 图标 + 文字节点。图标只出现在标记里，脚本对它只切 class、不碰子节点，
 * 所以图标不会被运行时改写抹掉。
 */
function toolbarButton(id: string, icon: string, label: string, title: string): string {
	return `<button type="button" class="wispkit-xaml-btn" id="${escapeAttribute(id)}" title="${escapeAttribute(title)}">`
		+ `${iconMarkup(icon)}<span class="wispkit-xaml-btn-label">${escapeHtml(label)}</span></button>`;
}

function layoutButton(
	id: string,
	mode: XamlLayoutMode,
	current: XamlLayoutMode,
	icon: string,
	label: string,
	title: string,
): string {
	const active = mode === current;
	return `<button type="button" class="wispkit-xaml-btn${active ? ' wispkit-xaml-btn-active' : ''}" id="${escapeAttribute(id)}" title="${escapeAttribute(title)}" aria-pressed="${active ? 'true' : 'false'}">`
		+ `${iconMarkup(icon)}<span class="wispkit-xaml-btn-label">${escapeHtml(label)}</span></button>`;
}

export function renderXamlPage(options: XamlPageOptions): string {
	const hasImage = Boolean(options.imageSrc) && options.result.ok;
	// `<img>` 始终存在（重渲染成功后要往里塞新图），没有图时不写 src，避免空 src 去请求当前页面
	const imageSrcAttribute = options.imageSrc ? ` src="${escapeAttribute(options.imageSrc)}"` : '';
	const image = `<img class="wispkit-xaml-image" id="wispkit-xaml-image"${imageSrcAttribute} alt="${escapeAttribute(options.title)}" draggable="false">`;

	const layoutMode = (options.config.codeVisible === false ? 'preview' : 'both') as XamlLayoutMode;
	const showCode = layoutMode !== 'preview';
	const showPreview = layoutMode !== 'code';
	const errorHint = options.errorHint ?? DEFAULT_ERROR_HINT;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-xaml-config" data-wispkit="${escapeAttribute(JSON.stringify({ ...options.config, language: options.language, layoutMode }))}">
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body>
	${xamlIconSprite()}
	<div class="wispkit-xaml-shell">
		<div class="wispkit-xaml-toolbar" role="toolbar" aria-label="Wispkit XAML">
			${toolbarButton('wispkit-xaml-save', 'save', '保存', '保存到文件（Ctrl+S）')}
			${toolbarButton('wispkit-xaml-rerender', 'rerender', '重新渲染', '用编辑区当前内容重新渲染')}
			${toolbarButton('wispkit-xaml-lightbox-button', 'lightbox', '放大查看', '全屏放大查看渲染结果')}
			${toolbarButton('wispkit-xaml-fit', 'fit', '适应窗口', '缩放到适应窗口')}
			<span class="wispkit-xaml-toolbar-separator" role="separator"></span>
			<div class="wispkit-xaml-layout-group" role="group" aria-label="布局">
				${layoutButton('wispkit-xaml-layout-all', 'both', layoutMode, 'layout-all', '都显示', '左右并排：源码 + 渲染')}
				${layoutButton('wispkit-xaml-layout-code', 'code', layoutMode, 'layout-code', '收纳右侧', '只显示源码，收纳渲染区')}
				${layoutButton('wispkit-xaml-layout-preview', 'preview', layoutMode, 'layout-preview', '收纳左侧', '只显示渲染，收纳源码区')}
			</div>
			<span class="wispkit-xaml-toolbar-spacer"></span>
			<span class="wispkit-xaml-dirty" id="wispkit-xaml-dirty" role="status" hidden>未保存</span>
			<span class="wispkit-xaml-status" id="wispkit-xaml-status">${escapeHtml(renderStatus(options.result, options.renderTargetName))}</span>
		</div>
		<div class="wispkit-xaml-layout" id="wispkit-xaml-layout">
			<div class="wispkit-xaml-code-pane" id="wispkit-xaml-code-pane"${showCode ? '' : ' hidden'}>
				<div class="wispkit-xaml-gutter" id="wispkit-xaml-gutter" aria-hidden="true">${renderGutter(options.code)}</div>
				<div class="wispkit-xaml-editor-wrap" id="wispkit-xaml-editor-wrap">
					<pre class="wispkit-xaml-highlight" id="wispkit-xaml-highlight" aria-hidden="true"><code id="wispkit-xaml-highlight-code">${renderHighlight(options.code, options.language)}</code></pre>
					<textarea class="wispkit-xaml-editor" id="wispkit-xaml-editor" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="源码">${escapeHtml(options.code)}</textarea>
				</div>
			</div>
			<div class="wispkit-xaml-splitter" id="wispkit-xaml-splitter" role="separator" aria-orientation="vertical" title="拖动调整源码栏宽度，双击复位"${showCode && showPreview ? '' : ' hidden'}></div>
			<div class="wispkit-xaml-preview-pane" id="wispkit-xaml-preview-pane"${showPreview ? '' : ' hidden'}>
				<div class="wispkit-xaml-viewport" id="wispkit-xaml-viewport"${hasImage ? '' : ' hidden'}>${image}</div>
				${renderErrorPanel(options.result, errorHint)}
			</div>
		</div>
	</div>
	<div class="wispkit-xaml-lightbox" id="wispkit-xaml-lightbox" role="dialog" aria-modal="true" aria-label="放大查看" hidden>
		<div class="wispkit-xaml-lightbox-bar">
			<span class="wispkit-xaml-lightbox-title" id="wispkit-xaml-lightbox-title"></span>
			<span class="wispkit-xaml-lightbox-zoom" id="wispkit-xaml-lightbox-zoom"></span>
			${toolbarButton('wispkit-xaml-lightbox-reset', 'reset', '复位', '复位（双击画面亦可）')}
			${toolbarButton('wispkit-xaml-lightbox-close', 'close', '关闭', '关闭（Esc）')}
		</div>
		<div class="wispkit-xaml-lightbox-body" id="wispkit-xaml-lightbox-body">
			<div class="wispkit-xaml-lightbox-stage" id="wispkit-xaml-lightbox-stage"></div>
		</div>
	</div>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
