import { escapeAttribute, escapeHtml } from '../util/html';
import {
	DEFAULT_MARKDOWN_MERMAID_THEME,
	MARKDOWN_MERMAID_THEMES,
	type MarkdownMermaidTheme,
} from './mermaidTheme';
import { DEFAULT_MARKDOWN_THEME_MODE, type MarkdownThemeMode } from './theme';

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
	/**
	 * 全局主题模式（宿主 globalState）。服务端直接写进 `<html>` 的 class / data 属性，
	 * 首屏就是目标明暗，不会先闪一下 VS Code 当前主题再跳。
	 */
	readonly themeMode?: MarkdownThemeMode;
	/**
	 * Mermaid 图表主题（宿主 globalState）。服务端写进 `<html data-wispkit-mermaid-theme>`
	 * 与工具栏下拉框的初始选中项；正文里的 `#markdown-mermaid` 配置 span 另由宿主
	 * 用 `applyMermaidThemeToBodyHtml` 改写（预览脚本是 async 模块，不能依赖脚本时序）。
	 */
	readonly mermaidTheme?: MarkdownMermaidTheme;
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
	search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/>',
	'zoom-in': '<circle cx="6.6" cy="6.6" r="4.2"/><path d="M9.7 9.7 14 14"/><path d="M6.6 4.7v3.8M4.7 6.6h3.8"/>',
	'zoom-out': '<circle cx="6.6" cy="6.6" r="4.2"/><path d="M9.7 9.7 14 14"/><path d="M4.7 6.6h3.8"/>',
	'chevron-up': '<path d="M4 10 8 6 12 10"/>',
	close: '<path d="M4 4l8 8M12 4l-8 8"/>',
	save: '<path d="M2.5 2.5h8L13.5 5.5v8h-11z"/><path d="M5.5 2.5v4h5v-4"/><path d="M4.5 13.5v-4h7v4"/>',
	'chevron-down': '<path d="M4 6 8 10 12 6"/>',
	lock: '<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4"/><path d="M5.7 7V5.3a2.3 2.3 0 0 1 4.6 0V7"/>',
	// 主题三态：左浅色（太阳）/ 中跟随主题（显示器）/ 右深色（月亮）
	sun: '<circle cx="8" cy="8" r="3.1"/>'
		+ '<path d="M8 1.3v1.7M8 13v1.7M1.3 8h1.7M13 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"/>',
	monitor: '<rect x="1.7" y="2.6" width="12.6" height="8.4" rx="1.2"/><path d="M8 11v2.3M5.5 13.3h5"/>',
	moon: '<path d="M13.3 9.6A5.4 5.4 0 0 1 6.4 2.7a5.7 5.7 0 1 0 6.9 6.9z"/>',
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

/**
 * 图标必须带 `width` / `height` **属性**（不能用 CSS 代替）：
 * 外部样式表（内置 markdown.css / 本扩展 markdown.css）是 webview 资源链接，
 * 样式生效前内联 `<svg>` 会按替换元素的默认尺寸 **300×150** 撑开 —— 表现为
 * 打开 Markdown 时工具栏突然出现几个巨大的图标，等样式到了再跳回 14px。
 * 属性是 CSS 之前就生效的兜底，CSS 仍可用类选择器覆盖（滑块里就是 10px）。
 */
function iconMarkup(name: string, size = 14): string {
	return `<svg class="wispkit-btn-icon" aria-hidden="true" focusable="false" width="${size}" height="${size}">`
		+ `<use href="#wispkit-icon-${escapeAttribute(name)}"></use></svg>`;
}

/** 按钮 = 图标 + 可被脚本改写的文字节点（图标只在标记里，脚本不会碰它）。 */
function toolbarButton(id: string, icon: string, label: string, title: string, attrs = ''): string {
	return `<button type="button" class="wispkit-btn" id="${escapeAttribute(id)}" title="${escapeAttribute(title)}"${attrs}>`
		+ `${iconMarkup(icon)}<span class="wispkit-btn-label">${escapeHtml(label)}</span></button>`;
}

/**
 * 纯图标按钮：文字只进 `title` / `aria-label`。
 * 工具栏已经很长，放大/缩小/查找这类成组控件再用文字会把正文挤窄；
 * 图标是 sprite 引用，颜色随 `currentColor` 自动适配主题。
 */
function iconButton(id: string, icon: string, title: string): string {
	return `<button type="button" class="wispkit-btn wispkit-btn-icon-only" id="${escapeAttribute(id)}" `
		+ `title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}">${iconMarkup(icon)}</button>`;
}

/**
 * 首屏关键样式：外部样式表到达前先把工具栏的形状定住。
 *
 * 放在 `<link>` **之前**，同特异性下后加载的外部表仍然胜出 —— 这里只兜底
 * 首屏那一瞬间，不参与最终外观。图标尺寸已在标记里用 width/height 兜底，
 * 这条规则同时覆盖 `display`（inline SVG 的基线间隙）。
 */
const CRITICAL_STYLE = '.wispkit-icon-sprite{position:absolute;width:0;height:0;overflow:hidden}'
	+ '.wispkit-shell{display:flex;flex-direction:column;height:100vh}'
	+ '.wispkit-toolbar{display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:4px 6px}'
	+ '.wispkit-btn{display:inline-flex;align-items:center;gap:5px}'
	// 作者样式里的 display 会盖掉 UA 对 `[hidden]` 的 display:none —— 保存按钮
	// 初始是 hidden 的，不补这条会在外部样式表到达前闪出来。
	+ '.wispkit-btn[hidden],.wispkit-dirty[hidden]{display:none}'
	+ '.wispkit-find[hidden]{display:none}'
	+ '.wispkit-btn-icon{display:block;flex:none;width:14px;height:14px}'
	+ '.wispkit-find{position:absolute;z-index:20}'
	+ '.wispkit-switch{display:inline-flex;align-items:center;gap:6px}'
	+ '.wispkit-switch-track{position:relative;flex:none;width:28px;height:16px}'
	+ '.wispkit-switch-thumb{position:absolute;top:50%;transform:translateY(-50%);display:flex;'
	+ 'align-items:center;justify-content:center;width:14px;height:14px}'
	+ '.wispkit-switch-thumb .wispkit-btn-icon{width:10px;height:10px}'
	+ '.wispkit-theme-switch{display:inline-flex;align-items:center;flex:none}'
	+ '.wispkit-theme-option{display:inline-flex;align-items:center;justify-content:center;'
	+ 'width:26px;height:20px;padding:0}'
	+ '.wispkit-mermaid-theme{display:inline-flex;align-items:center;gap:4px;flex:none}'
	+ '.wispkit-mermaid-theme select{font:inherit;height:20px;max-width:120px}';

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
		+ `<span class="wispkit-switch-thumb">${iconMarkup(iconOff, 10)}</span>`
		+ `</span><span class="wispkit-btn-label">${escapeHtml(label)}</span></button>`;
}

/**
 * 主题三态切换：三个**图标按钮**并排，从左到右依次是
 * 浅色 / 跟随主题 / 深色，当前项用 `aria-pressed` 表达。
 *
 * 为什么不是「一个按钮循环三态」：点击前看不出另外两个状态存在，
 * 用户要求的是「默认第二个图标、左侧浅色、右侧深色」这种**位置可见**的三态。
 * `data-theme-mode` 是前端切换时唯一要读的信号，改顺序只改这里。
 */
const THEME_OPTIONS: readonly { readonly mode: MarkdownThemeMode; readonly icon: string; readonly label: string }[] = [
	{ mode: 'light', icon: 'sun', label: '浅色模式' },
	{ mode: 'auto', icon: 'monitor', label: '跟随主题（随 VS Code 明暗自动切换）' },
	{ mode: 'dark', icon: 'moon', label: '深色模式' },
];

function themeSwitch(active: MarkdownThemeMode): string {
	const options = THEME_OPTIONS.map(option => `<button type="button" class="wispkit-theme-option" `
		+ `data-theme-mode="${option.mode}" aria-pressed="${option.mode === active ? 'true' : 'false'}" `
		+ `title="${escapeAttribute(option.label)}" aria-label="${escapeAttribute(option.label)}">`
		+ `${iconMarkup(option.icon)}</button>`).join('');
	return `<span class="wispkit-theme-switch" id="wispkit-theme" role="group" aria-label="主题模式">${options}</span>`;
}

/**
 * Mermaid 图表主题下拉框。
 *
 * 选项就是内置 Mermaid 扩展认识的六个主题名；`vscode` 跟随 VS Code 明暗推导配色，
 * 其余为 Mermaid 自带主题。用户切换后前端会先把所有已渲染图表还原成源码，
 * 再让预览脚本按新主题重画（不还原源码的话，脚本第二次扫描只会读到空容器）。
 */
const MERMAID_THEME_LABELS: Readonly<Record<MarkdownMermaidTheme, string>> = {
	vscode: '跟随主题',
	default: '默认 default',
	forest: '森林 forest',
	dark: '深色 dark',
	neutral: '中性 neutral',
	base: '基础 base',
};

function mermaidThemeSelect(active: MarkdownMermaidTheme): string {
	const options = MARKDOWN_MERMAID_THEMES.map(theme => `<option value="${escapeAttribute(theme)}"`
		+ `${theme === active ? ' selected' : ''}>${escapeHtml(MERMAID_THEME_LABELS[theme])}</option>`).join('');
	return `<label class="wispkit-mermaid-theme" title="Mermaid 图表主题">`
		+ `<span class="wispkit-mermaid-theme-label" aria-hidden="true">Mermaid</span>`
		+ `<select id="wispkit-mermaid-theme" aria-label="Mermaid 图表主题">${options}</select></label>`;
}

/**
 * 写成 html 的行内 style：`<style>` 是 raw text 元素、实体不会被解码，
 * 字体名里的引号只能靠属性转义这条通路带过去。
 */
/**
 * 正文查找栏：Ctrl+F 呼出，浮在正文右上角（绝对定位在 `.wispkit-main` 里）。
 *
 * 用**静态标记 + `hidden`** 而不是脚本动态创建：CSP 下不过 innerHTML，
 * 首屏结构稳定，脚本只负责显隐与内容；按钮图标同样走 sprite。
 * 输入框、计数、大小写、上一个/下一个、关闭的顺序与 VS Code 内置查找栏一致。
 */
function findBar(): string {
	return `<div class="wispkit-find" id="wispkit-find" role="search" aria-label="在文档中查找" hidden>`
		+ `<input class="wispkit-find-input" id="wispkit-find-input" type="text" autocomplete="off" spellcheck="false" `
		+ `placeholder="在文档中查找" aria-label="在文档中查找">`
		+ `<span class="wispkit-find-count" id="wispkit-find-count" aria-live="polite"></span>`
		+ `<button type="button" class="wispkit-find-btn" id="wispkit-find-case" title="区分大小写" `
		+ `aria-label="区分大小写" aria-pressed="false">Aa</button>`
		+ `<button type="button" class="wispkit-find-btn" id="wispkit-find-prev" title="上一个（Shift+Enter / Shift+F3）" `
		+ `aria-label="上一个匹配">${iconMarkup('chevron-up')}</button>`
		+ `<button type="button" class="wispkit-find-btn" id="wispkit-find-next" title="下一个（Enter / F3）" `
		+ `aria-label="下一个匹配">${iconMarkup('chevron-down')}</button>`
		+ `<button type="button" class="wispkit-find-btn" id="wispkit-find-close" title="关闭（Esc）" `
		+ `aria-label="关闭查找">${iconMarkup('close')}</button>`
		+ `</div>`;
}

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
	const themeMode = options.themeMode ?? DEFAULT_MARKDOWN_THEME_MODE;
	const mermaidTheme = options.mermaidTheme ?? DEFAULT_MARKDOWN_MERMAID_THEME;

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
<html lang="en" class="wispkit-theme-${themeMode}" data-wispkit-theme="${themeMode}" data-wispkit-mermaid-theme="${mermaidTheme}"${htmlStyle}>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	${base}
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-config" data-wispkit="${escapeAttribute(JSON.stringify(options.config))}">
	<style>${CRITICAL_STYLE}</style>
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
			<span class="wispkit-toolbar-sep" aria-hidden="true"></span>
			<span class="wispkit-zoom-group" role="group" aria-label="页面缩放">
				${iconButton('wispkit-zoom-out', 'zoom-out', '缩小（Ctrl+- / Ctrl+滚轮向下）')}
				<button type="button" class="wispkit-btn wispkit-zoom-value" id="wispkit-zoom-reset" title="重置为 100%（Ctrl+0）" aria-live="polite">100%</button>
				${iconButton('wispkit-zoom-in', 'zoom-in', '放大（Ctrl+= / Ctrl+滚轮向上）')}
			</span>
			${iconButton('wispkit-find-toggle', 'search', '在文档中查找（Ctrl+F）')}
			<span class="wispkit-toolbar-spacer"></span>
			${mermaidThemeSelect(mermaidTheme)}
			${themeSwitch(themeMode)}
		</div>
		<div class="wispkit-layout wispkit-toc-right" id="wispkit-layout">
			<nav id="wispkit-toc" class="wispkit-toc" aria-label="Table of contents"></nav>
			<div class="wispkit-splitter" id="wispkit-splitter" role="separator" aria-orientation="vertical" title="拖动调整目录宽度，双击复位"></div>
			<div class="wispkit-main" id="wispkit-main">
				<main id="wispkit-content" class="wispkit-content vscode-body" tabindex="0">
					<div class="wispkit-zoom-layer" id="wispkit-zoom-layer">${options.bodyHtml}</div>
				</main>
				${findBar()}
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
