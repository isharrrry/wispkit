import { escapeAttribute, escapeHtml } from '../util/html';

/** 只传前端确实要用的字段；宿主侧的完整配置留在宿主。 */
export interface MarkdownViewConfig {
	readonly tocEnabled: boolean;
	readonly tocDepth: number;
}

/**
 * 正文排版，取自内置预览的 `markdown.preview.*` 设置。
 * 字段缺省 = 不注入该变量，交给 `markdown.css` 里的兜底值（与内置预览一致）。
 */
export interface MarkdownTypography {
	readonly fontFamily?: string;
	readonly fontSize?: number;
	/** 已是合法 CSS 值：数字表示字号倍数，带单位则原样使用。 */
	readonly lineHeight?: string;
}

export interface WebviewScript {
	readonly src: string;
	readonly type?: 'module';
}

export interface MarkdownPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly baseHref?: string;
	readonly contributionStyles: readonly string[];
	readonly contributionScripts: readonly WebviewScript[];
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	readonly bodyHtml: string;
	readonly config: MarkdownViewConfig;
	readonly typography: MarkdownTypography;
}

/**
 * 工具栏图标：内联 SVG sprite，一次放进页面，前端用 `<use href="#wispkit-icon-x">` 引用。
 *
 * 与子树视图同一套做法（`src/subtree/page.ts` 的 ICONS）：`stroke="currentColor"` 让颜色
 * 自动跟随主题与选中态；内联 sprite **零第三方依赖、零额外请求**，也不用动
 * `esbuild.mjs` / `.vscodeignore`（不引字体文件）。
 */
const ICONS: Readonly<Record<string, string>> = {
	toc: '<path d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8"/>'
		+ '<circle cx="2.6" cy="3.5" r="0.9"/><circle cx="2.6" cy="8" r="0.9"/><circle cx="2.6" cy="12.5" r="0.9"/>',
	'arrow-left': '<path d="M13 8H3"/><path d="M6.5 4.5 3 8l3.5 3.5"/>',
	'arrow-right': '<path d="M3 8h10"/><path d="M9.5 4.5 13 8l-3.5 3.5"/>',
	'expand-all': '<path d="M3 4.5 8 9.5 13 4.5"/><path d="M3 11h10"/>',
	'collapse-all': '<path d="M3 11.5 8 6.5 13 11.5"/><path d="M3 4.5h10"/>',
	edit: '<path d="M2 14l1-3.5 8-8 2.5 2.5-8 8z"/><path d="M10.5 3.5 13 6"/>',
	preview: '<path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"/>'
		+ '<circle cx="8" cy="8" r="1.9"/>',
	save: '<path d="M2.5 2.5h8L13.5 5.5v8h-11z"/><path d="M5.5 2.5v4h5v-4"/><path d="M4.5 13.5v-4h7v4"/>',
	'chevron-down': '<path d="M4 6 8 10 12 6"/>',
	lock: '<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4"/><path d="M5.7 7V5.3a2.3 2.3 0 0 1 4.6 0V7"/>',
};

export const MARKDOWN_ICON_NAMES: readonly string[] = Object.keys(ICONS);

export function markdownIconSprite(): string {
	const symbols = Object.entries(ICONS)
		.map(([name, body]) => `<symbol id="wispkit-icon-${name}" viewBox="0 0 16 16" `
			+ `fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">`
			+ `${body}</symbol>`)
		.join('');
	return `<svg class="wispkit-icon-sprite" aria-hidden="true" focusable="false" width="0" height="0">${symbols}</svg>`;
}

function iconMarkup(name: string): string {
	return `<svg class="wispkit-btn-icon" aria-hidden="true" focusable="false">`
		+ `<use href="#wispkit-icon-${escapeAttribute(name)}"></use></svg>`;
}

/** 按钮 = 图标 + 可被脚本改写的文字节点（图标只在标记里，脚本不会碰它）。 */
function toolbarButton(id: string, icon: string, label: string, title: string, attrs = ''): string {
	return `<button type="button" class="wispkit-btn" id="${escapeAttribute(id)}" title="${escapeAttribute(title)}"${attrs}>`
		+ `${iconMarkup(icon)}<span class="wispkit-btn-label">${escapeHtml(label)}</span></button>`;
}

/**
 * 滑动开关（`role="switch"`）：轨道 + 滑块，滑块里的图标随开/关切换。
 *
 * 开/关**只由 `aria-checked` 表达**（轨道与滑块的位移全在 CSS 里按它选），
 * 所以前端切换时只需改 `aria-checked` 与滑块内那一个 `<use href>` —— 不用碰 class，
 * 也不会把图标或滑块抹掉（它只改属性，不重写子节点）。
 * 两个图标名走 `data-icon-*`，前端不硬编码，改图标只改这一处。
 */
function switchButton(id: string, iconOn: string, iconOff: string, label: string, title: string): string {
	return `<button type="button" class="wispkit-switch" id="${escapeAttribute(id)}" role="switch" `
		+ `aria-checked="false" title="${escapeAttribute(title)}" `
		+ `data-icon-on="${escapeAttribute(iconOn)}" data-icon-off="${escapeAttribute(iconOff)}">`
		+ `<span class="wispkit-switch-track" aria-hidden="true">`
		+ `<span class="wispkit-switch-thumb">${iconMarkup(iconOff)}</span>`
		+ `</span><span class="wispkit-btn-label">${escapeHtml(label)}</span></button>`;
}

/**
 * 写成 html 的行内 style：`<style>` 是 raw text 元素、实体不会被解码，
 * 字体名里的引号只能靠属性转义这条通路带过去。
 */
function typographyStyle(typography: MarkdownTypography): string | undefined {
	const parts = [
		typography.fontFamily ? `--markdown-font-family:${typography.fontFamily}` : '',
		typography.fontSize !== undefined ? `--markdown-font-size:${typography.fontSize}px` : '',
		typography.lineHeight ? `--markdown-line-height:${typography.lineHeight}` : '',
	].filter(part => part.length > 0);

	return parts.length > 0 ? parts.join(';') : undefined;
}

export function renderMarkdownPage(options: MarkdownPageOptions): string {
	const base = options.baseHref ? `<base href="${escapeAttribute(options.baseHref)}">` : '';
	const style = typographyStyle(options.typography);
	const htmlStyle = style ? ` style="${escapeAttribute(style)}"` : '';

	// 镜像 documentRenderer.ts:237（样式 link 不带 nonce）与 :249（脚本带 async/type/nonce/charset）。
	const styles = [...options.contributionStyles, options.runtimeStyle]
		.map(href => `<link rel="stylesheet" type="text/css" href="${escapeAttribute(href)}">`)
		.join('\n\t');

	const scripts = options.contributionScripts
		.map(script => {
			const type = script.type ? ` type="${escapeAttribute(script.type)}"` : '';
			return `<script async${type} src="${escapeAttribute(script.src)}" nonce="${options.nonce}" charset="UTF-8"></script>`;
		})
		.join('\n\t');

	return `<!DOCTYPE html>
<html lang="en"${htmlStyle}>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	${base}
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-config" data-wispkit="${escapeAttribute(JSON.stringify(options.config))}">
	${styles}
</head>
<body>
	${markdownIconSprite()}
	<div class="wispkit-shell">
		<div class="wispkit-toolbar" role="toolbar" aria-label="Wispkit">
			${switchButton('wispkit-editor-toggle', 'edit', 'lock', '编辑', '进入段落编辑模式：点正文任意一段，就地改它的 Markdown 原文')}
			<span class="wispkit-dirty" id="wispkit-dirty" role="status" hidden>未保存</span>
			${toolbarButton('wispkit-save', 'save', '保存', '保存到文件（Ctrl+S）', ' hidden')}
			<span class="wispkit-toolbar-sep" aria-hidden="true"></span>
			${toolbarButton('wispkit-sidebar-toggle', 'toc', '目录', '显示 / 隐藏目录栏')}
			${toolbarButton('wispkit-toc-side', 'arrow-left', '目录靠左', '把目录栏移到左侧')}
			${toolbarButton('wispkit-expand-all', 'expand-all', '展开', '展开全部层级')}
			${toolbarButton('wispkit-collapse-all', 'collapse-all', '折叠', '折叠全部层级')}
			<span class="wispkit-toolbar-spacer"></span>
		</div>
		<div class="wispkit-layout wispkit-toc-right" id="wispkit-layout">
			<nav id="wispkit-toc" class="wispkit-toc" aria-label="Table of contents"></nav>
			<div class="wispkit-splitter" id="wispkit-splitter" role="separator" aria-orientation="vertical" title="拖动调整目录宽度，双击复位"></div>
			<div class="wispkit-main" id="wispkit-main">
				<main id="wispkit-content" class="wispkit-content vscode-body" tabindex="0">${options.bodyHtml}</main>
			</div>
		</div>
	</div>
	<div class="wispkit-lightbox" id="wispkit-lightbox" role="dialog" aria-modal="true" aria-label="放大查看" hidden>
		<div class="wispkit-lightbox-bar">
			<span class="wispkit-lightbox-title" id="wispkit-lightbox-title"></span>
			<span class="wispkit-lightbox-zoom" id="wispkit-lightbox-zoom"></span>
			<button type="button" class="wispkit-btn" id="wispkit-lightbox-reset" title="复位（双击画面亦可）">复位</button>
			<button type="button" class="wispkit-btn" id="wispkit-lightbox-close" title="关闭（Esc）">关闭</button>
		</div>
		<div class="wispkit-lightbox-body" id="wispkit-lightbox-body">
			<div class="wispkit-lightbox-stage" id="wispkit-lightbox-stage"></div>
		</div>
	</div>
	${scripts}
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
