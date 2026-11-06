import { escapeAttribute, escapeHtml } from '../util/html';
import type { WebviewIconTheme } from './iconTheme';

export interface SubtreeColumnView {
	readonly id: string;
	readonly label: string;
	readonly align: 'left' | 'right';
	readonly width: number;
}

export interface SubtreeCommandView {
	readonly id: string;
	readonly label: string;
	/** `native` = Wispkit 自己实现（走 fileAction 消息）；`builtin` / 扩展 id 走 command 消息。 */
	readonly kind: string;
	readonly source: string;
	readonly group: string;
	readonly icon: string;
	/** 对选中项的要求：`any` / `single` / `folders` / `two`，前端据此置灰。 */
	readonly appliesTo: string;
	/** 置灰时作为 title 的原因说明。 */
	readonly disabledReason?: string;
}

export interface SubtreeToolView {
	readonly label: string;
	readonly command: string;
	readonly shell: string;
}

export interface SubtreeSortView {
	readonly key: string;
	readonly direction: string;
}

export interface SubtreeViewConfig {
	readonly rootPath: string;
	readonly rootName: string;
	/** Windows 上拿不到真实属主，用登录用户名近似（见 README）。 */
	readonly owner: string;
	/** 顺序即列顺序。 */
	readonly columns: readonly SubtreeColumnView[];
	readonly commands: readonly SubtreeCommandView[];
	readonly tools: readonly SubtreeToolView[];
	/** 宿主持有的排序状态；前端只负责点列头，重排由宿主下发。 */
	readonly sort: SubtreeSortView;
	/** 剪贴板文案（没有内容时为 undefined / 缺省），显示在「粘贴」按钮的 title 上。 */
	readonly clipboard?: string;
	/**
	 * 用户当前图标主题的图标（URI 表）。有值则条目用主题自己的图标、
	 * 与资源管理器完全一致；缺省（主题不可解析等）则回退到内联自绘 sprite。
	 */
	readonly iconTheme?: WebviewIconTheme;
}

export interface SubtreePageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	/** `media/subtree.js`（ESM，用 type="module" 引入）。 */
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	readonly config: SubtreeViewConfig;
}

/**
 * 图标：内联 SVG sprite，一次放进页面，前端用 `<use href="#wispkit-icon-x">` 引用。
 *
 * 为什么不引 codicon 字体：webview 拿不到 VS Code 内部的字体资源，随包分发字体又要动
 * `esbuild.mjs` / `.vscodeignore`。内联 sprite **零第三方依赖、零额外请求**，
 * 且线条统一用 `stroke="currentColor"` —— 颜色自动跟随主题（含高对比度主题）。
 */
const ICONS: Readonly<Record<string, string>> = {
	refresh: '<path d="M13.5 3A6 6 0 1 0 13.5 13"/><path d="M10.5 1.5 14 3 12.5 6.5"/>',
	'collapse-all': '<path d="M3 11.5 8 6.5 13 11.5"/><path d="M3 5.5h10"/>',
	'expand-all': '<path d="M3 4.5 8 9.5 13 4.5"/><path d="M3 10.5h10"/>',
	// 文件夹用主题的文件夹色（资源管理器里文件夹也是这个视觉锚点）；其余图标一律 currentColor，
	// 形状负责区分类型。变量不存在时 fallback 到 currentColor，所以高对比度主题下也不会失色。
	folder: '<g stroke="var(--vscode-symbolIcon-folderForeground, currentColor)"><path d="M1.5 12.5v-9h4l1.5 2h7.5v7z"/></g>',
	'folder-open': '<g stroke="var(--vscode-symbolIcon-folderForeground, currentColor)">'
		+ '<path d="M1.5 12.5v-9h4l1.5 2h4.4l-1 2.2h4.3l-1.6 4.8z"/></g>',
	file: '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>',
	// 以下 8 个是"按类型"的图标：形状与通用 file 明显区分，且都保持 file 的折角轮廓，
	// 让一列图标看起来仍是同一套。
	'file-code': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M6.2 9.2 4.8 10.8l1.4 1.6M9.8 9.2l1.4 1.6-1.4 1.6"/>',
	'file-config': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<circle cx="8" cy="10.6" r="1.5"/><path d="M8 7.7v1M8 12.5v1"/>',
	'file-markdown': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M5.2 12.4V8.8l1.5 2 1.5-2v3.6"/>',
	'file-image': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<circle cx="6.2" cy="8.9" r="0.9"/><path d="M4.6 13.2 6.9 10.6l1.5 1.6 1.5-2 1.6 3"/>',
	'file-archive': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M6.8 7.3h1.4M6.8 9.3h1.4M6.8 11.3h1.4"/>',
	'file-data': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M5.4 9.4h5.2M5.4 12h5.2"/>',
	'file-text': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M5.4 9h5.2M5.4 11h5.2M5.4 13h3"/>',
	'file-media': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M6.3 8.7 10 10.7l-3.7 2z"/>',
	'file-shell': '<path d="M3.5 1.5h5l4 4v9h-9z"/><path d="M8.5 1.5v4h4"/>'
		+ '<path d="M5.4 9.2 7 10.8 5.4 12.4M8.5 12.4h2.3"/>',
	cut: '<path d="M4.5 2.5 10 11M11.5 2.5 6 11"/><circle cx="4" cy="13" r="1.6"/><circle cx="12" cy="13" r="1.6"/>',
	copy: '<rect x="5.5" y="5.5" width="9" height="9" rx="1.2"/><path d="M10.5 5.5v-4h-9v9h4"/>',
	paste: '<rect x="3" y="3" width="10" height="12" rx="1.2"/><path d="M6 3V1.5h4V3"/>',
	rename: '<path d="M2 14l1-3.5 8-8 2.5 2.5-8 8z"/><path d="M10.5 3.5 13 6"/>',
	trash: '<path d="M2.5 4.5h11M6 4.5V2.5h4v2"/><path d="M4 4.5l1 10h6l1-10"/>',
	reveal: '<path d="M6.5 2.5H2.5v11h11V9.5"/><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/>',
	'new-folder': '<path d="M1.5 13.5v-9h4l1.5 2h3.5"/><path d="M12 8.5v6M9 11.5h6"/>',
	'new-file': '<path d="M3.5 1.5h5l4 4v2.5"/><path d="M8.5 1.5v4h4"/><path d="M12 8.5v6M9 11.5h6"/>',
	link: '<path d="M6.5 9.5a2.8 2.8 0 0 1 0-4l1.5-1.5a2.8 2.8 0 0 1 4 4l-1 1"/>'
		+ '<path d="M9.5 6.5a2.8 2.8 0 0 1 0 4l-1.5 1.5a2.8 2.8 0 0 1-4-4l1-1"/>',
	terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.2"/><path d="M4.5 6.5 6.5 8.5 4.5 10.5M8.5 10.5h3"/>',
	compare: '<path d="M4.5 1.5v13M11.5 1.5v13"/><path d="M1.5 4.5h6M8.5 11.5h6"/>',
	extension: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M6 6h4v4H6z"/>',
	action: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
	'sort-asc': '<path d="M4 10 8 6 12 10"/>',
	'sort-desc': '<path d="M4 6 8 10 12 6"/>',
	'arrow-up': '<path d="M8 13V3M4.5 6.5 8 3l3.5 3.5"/>',
	'chevron-down': '<path d="M4 6l4 4 4-4"/>',
};

export const SUBTREE_ICON_NAMES: readonly string[] = Object.keys(ICONS);

export function subtreeIconSprite(): string {
	const symbols = Object.entries(ICONS)
		.map(([name, body]) => `<symbol id="wispkit-icon-${name}" viewBox="0 0 16 16" `
			+ `fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">`
			+ `${body}</symbol>`)
		.join('');
	return `<svg class="wispkit-subtree-sprite" aria-hidden="true" focusable="false" width="0" height="0">${symbols}</svg>`;
}

export function subtreeIconMarkup(name: string, extraClass?: string): string {
	const className = extraClass ? `wispkit-subtree-icon-svg ${extraClass}` : 'wispkit-subtree-icon-svg';
	return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#wispkit-icon-${escapeAttribute(name)}"></use></svg>`;
}

/** 列宽走 CSS 变量，表头与数据行共用同一组值，两处才对得齐。 */
function columnWidthVariables(config: SubtreeViewConfig): string {
	return config.columns
		.map(column => `--wispkit-col-${column.id}:${column.width}px;`)
		.join('');
}

export function renderSubtreePage(options: SubtreePageOptions): string {
	const { config } = options;

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-subtree-config" data-wispkit="${escapeAttribute(JSON.stringify(config))}">
	<style nonce="${options.nonce}">:root{${columnWidthVariables(config)}}</style>
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body>
	${subtreeIconSprite()}
	<div class="wispkit-subtree-shell">
		<div class="wispkit-subtree-toolbar" role="toolbar" aria-label="子树浏览">
			<button type="button" class="wispkit-subtree-btn" id="wispkit-subtree-refresh" title="重新读取整棵树">${subtreeIconMarkup('refresh')}<span>刷新</span></button>
			<button type="button" class="wispkit-subtree-btn" id="wispkit-subtree-collapse-all" title="折叠所有已展开的层级">${subtreeIconMarkup('collapse-all')}<span>全部折叠</span></button>
			<button type="button" class="wispkit-subtree-btn" id="wispkit-subtree-expand-root" title="展开子树里选中文件夹的一层（可多选；没有选中时展开根目录）">${subtreeIconMarkup('expand-all')}<span>展开一层</span></button>
			<button type="button" class="wispkit-subtree-btn" id="wispkit-subtree-dnd-help" title="拖入文件 / 文本，树内按住 Ctrl 拖动条目 = 移动，或把条目拖出到桌面、资源管理器">${subtreeIconMarkup('link')}<span>拖放说明</span></button>
			<span class="wispkit-subtree-toolbar-spacer"></span>
			<span class="wispkit-subtree-status" id="wispkit-subtree-status" role="status"></span>
			<span class="wispkit-subtree-selected-path" id="wispkit-subtree-selected-path" title="${escapeAttribute(config.rootPath)}">${escapeHtml(config.rootPath)}</span>
		</div>
		<div class="wispkit-subtree-main" id="wispkit-subtree-main">
			<div class="wispkit-subtree-tree" id="wispkit-subtree-tree" title="拖入：文件会询问复制/移动，文本等资源会询问存储类型与名称；从系统资源管理器直接拖入即可（不需要按 Shift）。树内拖动条目按住 Ctrl = 直接移动（不再询问，左右树互拖同样适用）。条目也可以直接拖出到桌面/资源管理器。">
				<div class="wispkit-subtree-header" id="wispkit-subtree-header" role="row"></div>
				<div class="wispkit-subtree-rows" id="wispkit-subtree-rows" role="tree" aria-label="目录树" tabindex="0"></div>
			</div>
			<div class="wispkit-subtree-splitter" id="wispkit-subtree-splitter" role="separator" aria-orientation="vertical" title="拖动调整操作栏宽度，双击复位"></div>
			<aside class="wispkit-subtree-actions" id="wispkit-subtree-actions">
				<section class="wispkit-subtree-section" id="wispkit-subtree-commands-section">
					<h2 class="wispkit-subtree-section-title">文件操作<span class="wispkit-subtree-count" id="wispkit-subtree-command-count"></span></h2>
					<div class="wispkit-subtree-list" id="wispkit-subtree-commands"></div>
				</section>
				<section class="wispkit-subtree-section" id="wispkit-subtree-tools-section">
					<h2 class="wispkit-subtree-section-title">工具<span class="wispkit-subtree-count" id="wispkit-subtree-tool-count"></span></h2>
					<div class="wispkit-subtree-list" id="wispkit-subtree-tools"></div>
				</section>
			</aside>
		</div>
	</div>
	<script type="module" src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
