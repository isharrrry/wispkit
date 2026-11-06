import { escapeAttribute, escapeHtml } from '../util/html';
import {
	subtreeIconMarkup,
	subtreeIconSprite,
	type SubtreeColumnView,
	type SubtreeCommandView,
	type SubtreeToolView,
} from '../subtree/page';
import type { CompareLocationGroup } from './locations';

/**
 * 「对比浏览」页面：左右两个独立的树浏览面板，共用一套列表样式与列定义。
 *
 * 页面本身只写静态骨架与初始配置，行数据/路径跳转全部经宿主的 `wispkit.compare.*`
 * 消息往返 —— 与子树浏览一致，读盘永远发生在扩展宿主。
 */

export interface ComparePaneView {
	readonly id: 'left' | 'right';
	readonly root: string;
	readonly title: string;
	/** 默认位置不可用而回退时的说明；显示在该侧状态栏。 */
	readonly note?: string;
}

export interface CompareViewConfig {
	readonly panes: readonly ComparePaneView[];
	readonly columns: readonly SubtreeColumnView[];
	/** 路径下拉的候选位置；打开下拉时宿主还会再推一次最新数据。 */
	readonly locationGroups: readonly CompareLocationGroup[];
	/**
	 * 右键菜单里的文件操作（与子树浏览右侧操作栏同一份来源）。
	 * 旧页面 / 单测没给时前端当作空列表。
	 */
	readonly commands?: readonly SubtreeCommandView[];
	/** 「工具」区配置（与子树浏览共用 `wispkit.subtree.tools`）。 */
	readonly tools?: readonly SubtreeToolView[];
}

export interface ComparePageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	/** `media/compare.js`（ESM）。 */
	readonly runtimeScript: string;
	/** `media/compare.css`。 */
	readonly runtimeStyle: string;
	/** `media/subtree.css`（行/单元格/图标样式复用子树浏览）。 */
	readonly baseStyle: string;
	readonly config: CompareViewConfig;
}

function columnWidthVariables(columns: readonly SubtreeColumnView[]): string {
	return columns
		.map(column => `--wispkit-col-${column.id}:${column.width}px;`)
		.join('');
}

function paneMarkup(pane: ComparePaneView): string {
	const id = pane.id;
	return `<section class="wispkit-compare-pane" id="wispkit-compare-pane-${id}" data-pane="${id}" aria-label="${escapeAttribute(pane.title)}">
				<div class="wispkit-compare-pathbar" id="wispkit-compare-pathbar-${id}">
					<button type="button" class="wispkit-compare-btn" id="wispkit-compare-up-${id}" title="上一级">${subtreeIconMarkup('arrow-up')}</button>
					<input class="wispkit-compare-input" id="wispkit-compare-input-${id}" type="text" spellcheck="false" autocomplete="off" aria-label="${escapeAttribute(pane.title)}路径" placeholder="输入文件夹路径，回车跳转">
					<button type="button" class="wispkit-compare-btn is-primary" id="wispkit-compare-go-${id}" title="跳转到输入的路径">跳转</button>
					<button type="button" class="wispkit-compare-btn" id="wispkit-compare-dropdown-${id}" aria-haspopup="listbox" aria-expanded="false" title="从常用位置 / 工作区 / 自定义资源管理选择">${subtreeIconMarkup('chevron-down')}</button>
					<button type="button" class="wispkit-compare-btn" id="wispkit-compare-refresh-${id}" title="重新读取当前文件夹">${subtreeIconMarkup('refresh')}</button>
					<div class="wispkit-compare-locations" id="wispkit-compare-locations-${id}" role="listbox" aria-label="${escapeAttribute(pane.title)}路径候选" hidden></div>
				</div>
				<div class="wispkit-compare-pane-status" id="wispkit-compare-status-${id}" role="status" hidden></div>
				<div class="wispkit-compare-tree" id="wispkit-compare-tree-${id}">
					<div class="wispkit-subtree-header" id="wispkit-compare-header-${id}" role="row"></div>
					<div class="wispkit-subtree-rows" id="wispkit-compare-rows-${id}" role="tree" aria-label="${escapeAttribute(pane.title)}目录树" tabindex="0"></div>
				</div>
			</section>`;
}

export function renderComparePage(options: ComparePageOptions): string {
	const { config } = options;
	const left = paneMarkup(config.panes[0] ?? { id: 'left', root: '', title: '左侧' });
	const right = paneMarkup(config.panes[1] ?? { id: 'right', root: '', title: '右侧' });

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-compare-config" data-wispkit="${escapeAttribute(JSON.stringify(config))}">
	<style nonce="${options.nonce}">:root{${columnWidthVariables(config.columns)}}</style>
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.baseStyle)}">
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body>
	${subtreeIconSprite()}
	<div class="wispkit-compare-shell">
		<div class="wispkit-compare-main" id="wispkit-compare-main" style="--wispkit-compare-left: 50%;">
			${left}
			<div class="wispkit-compare-splitter" id="wispkit-compare-splitter" role="separator" aria-orientation="vertical" aria-label="调整左右宽度" title="拖动调整左右宽度，双击复位"></div>
			${right}
		</div>
	</div>
	<script type="module" src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
