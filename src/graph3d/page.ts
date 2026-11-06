import type { GraphElement } from './types';
import { escapeAttribute, escapeHtml } from '../util/html';

/** 宿主传给 webview 的完整初始数据。 */
export interface Graph3dPayload {
	readonly fileName: string;
	readonly filePath: string;
	readonly elements: readonly GraphElement[];
}

export interface Graph3dPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	readonly payload: Graph3dPayload;
}

/**
 * 3D 浏览器的页面骨架。
 *
 * 注意：这里只放**静态**控件；图元素下拉、气泡、连线都由 `media/graph3d.js`
 * 在 three.js 里生成。宿主把完整图元素 JSON 放进 `<meta data-wispkit>`，
 * 避免在 HTML 里拼接大段脚本字符串（CSP 也不允许内联脚本）。
 */
const ICONS: Readonly<Record<string, string>> = {
	refresh: '<path d="M13.5 3A6 6 0 1 0 13.5 13"/><path d="M10.5 1.5 14 3 12.5 6.5"/>',
	reset: '<circle cx="8" cy="8" r="5.5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
	merge: '<circle cx="4.5" cy="10.5" r="2.5"/><circle cx="11.5" cy="10.5" r="2.5"/><path d="M5 6.5 8 3l3 3.5"/><path d="M8 3v7"/>',
	split: '<path d="M2 8h12"/><path d="M5 4 2 8l3 4M11 4l3 4-3 4"/>',
	graph: '<circle cx="8" cy="3" r="1.6"/><circle cx="3" cy="12" r="1.6"/><circle cx="13" cy="12" r="1.6"/>'
		+ '<path d="M7.3 4.4 4 10.4M8.7 4.4 12 10.4M4.7 12h6.6"/>',
	spacing: '<path d="M2 8h12"/><path d="M4.5 3.5v9M11.5 3.5v9"/>',
	layout: '<path d="M8 2 14 5 8 8 2 5z"/><path d="m2 8 6 3 6-3"/><path d="m2 11 6 3 6-3"/>',
};

function iconSprite(): string {
	const symbols = Object.entries(ICONS)
		.map(([name, body]) => `<symbol id="wispkit-3d-icon-${name}" viewBox="0 0 16 16" `
			+ `fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">`
			+ `${body}</symbol>`)
		.join('');
	return `<svg class="wispkit-3d-sprite" aria-hidden="true" focusable="false" width="0" height="0">${symbols}</svg>`;
}

function iconMarkup(name: string): string {
	return `<svg class="wispkit-3d-btn-icon" aria-hidden="true" focusable="false">`
		+ `<use href="#wispkit-3d-icon-${escapeAttribute(name)}"></use></svg>`;
}

function pane(side: 'left' | 'right' | 'merged'): string {
	const title = side === 'left' ? '左侧图元素' : side === 'right' ? '右侧图元素' : '合并视图';
	const empty = side === 'merged' ? '左侧与右侧都选中后才能合并。' : '选择上方的图元素后在这里绘制。';
	return `<section class="wispkit-3d-pane" data-side="${side}" id="wispkit-3d-${side}" hidden>
		<header class="wispkit-3d-pane-head">
			<span class="wispkit-3d-pane-title" id="wispkit-3d-${side}-title">${title}</span>
			<span class="wispkit-3d-pane-stats" id="wispkit-3d-${side}-stats"></span>
		</header>
		<div class="wispkit-3d-stage" id="wispkit-3d-${side}-stage" role="img" aria-label="${title} 3D 视图">
			<div class="wispkit-3d-tooltip" id="wispkit-3d-${side}-tooltip" role="tooltip" hidden></div>
		</div>
		<div class="wispkit-3d-pane-hint">左键拖动旋转 · 右键拖动平移 · 滚轮缩放 · 悬停节点看注释</div>
		<div class="wispkit-3d-overlay wispkit-3d-empty" id="wispkit-3d-${side}-empty">${escapeHtml(empty)}</div>
		<div class="wispkit-3d-overlay wispkit-3d-error" id="wispkit-3d-${side}-error" hidden></div>
	</section>`;
}

export function renderGraph3dPage(options: Graph3dPageOptions): string {
	const payload = escapeAttribute(JSON.stringify(options.payload));
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-3d-data" data-wispkit="${payload}">
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body>
	${iconSprite()}
	<div class="wispkit-3d-app">
		<div class="wispkit-3d-toolbar" role="toolbar" aria-label="3D 可视化浏览">
			<div class="wispkit-3d-toolbar-group wispkit-3d-select-group">
				<label class="wispkit-3d-field" for="wispkit-3d-left-select">
					<span class="wispkit-3d-field-label">左图元素</span>
					<select id="wispkit-3d-left-select" class="wispkit-3d-select"></select>
				</label>
				<label class="wispkit-3d-field" for="wispkit-3d-right-select">
					<span class="wispkit-3d-field-label">右图元素</span>
					<select id="wispkit-3d-right-select" class="wispkit-3d-select"></select>
				</label>
			</div>
			<span class="wispkit-3d-toolbar-sep" aria-hidden="true"></span>
			<div class="wispkit-3d-toolbar-group">
				<button type="button" class="wispkit-3d-btn" id="wispkit-3d-merge" disabled title="把左右两个图元素合并为一个 3D，同名节点会合并">${iconMarkup('merge')}<span class="wispkit-3d-btn-label">合并左右</span></button>
				<button type="button" class="wispkit-3d-btn" id="wispkit-3d-reset" title="把相机复位到能看全整张图的位置">${iconMarkup('reset')}<span class="wispkit-3d-btn-label">重置视角</span></button>
				<button type="button" class="wispkit-3d-btn" id="wispkit-3d-refresh" title="重新读取文件，重新解析所有图元素">${iconMarkup('refresh')}<span class="wispkit-3d-btn-label">刷新</span></button>
			</div>
			<span class="wispkit-3d-toolbar-sep" aria-hidden="true"></span>
			<label class="wispkit-3d-field wispkit-3d-algorithm-field" for="wispkit-3d-algorithm" title="选择布局算法，切换后立即重新布局并重绘">
				<span class="wispkit-3d-field-label">${iconMarkup('layout')}布局</span>
				<select id="wispkit-3d-algorithm" class="wispkit-3d-select" aria-label="3D 布局算法">
					<option value="auto">自动（按拓扑）</option>
					<option value="compact">紧凑分层</option>
					<option value="compact-mutex" title="合并左右图时，把两侧各自的核心节点拉到布局两端，融合节点留在中间">互斥 · 紧凑分层</option>
					<option value="louvain">Louvain 壳内 FR-3D</option>
					<option value="radial">径向树</option>
					<option value="layered">分层环</option>
					<option value="force">3D 力导向</option>
					<option value="force-mutex" title="合并左右图时，把两侧各自的核心节点拉到布局两端，融合节点留在中间">互斥 · 3D 力导向</option>
				</select>
			</label>
			<label class="wispkit-3d-field wispkit-3d-spacing-field" for="wispkit-3d-spacing" title="调整节点间距，松开后重新布局">
				<span class="wispkit-3d-field-label">${iconMarkup('spacing')}间隔</span>
				<input id="wispkit-3d-spacing" class="wispkit-3d-range" type="range" min="0.25" max="3" step="0.05" value="1" aria-label="节点间距">
				<output id="wispkit-3d-spacing-value" class="wispkit-3d-output" for="wispkit-3d-spacing">1.00×</output>
			</label>
			<label class="wispkit-3d-field wispkit-3d-check-field" for="wispkit-3d-edge-labels" title="在数据流连线中间显示名称，文字样式与节点气泡一致">
				<input id="wispkit-3d-edge-labels" class="wispkit-3d-checkbox" type="checkbox" checked>
				<span class="wispkit-3d-field-label">显示数据流名称</span>
			</label>
			<span class="wispkit-3d-toolbar-spacer"></span>
			<span class="wispkit-3d-status" id="wispkit-3d-status" role="status"></span>
		</div>
		<div class="wispkit-3d-panes" id="wispkit-3d-panes">
			${pane('left')}
			<div class="wispkit-3d-splitter" id="wispkit-3d-splitter" role="separator" aria-orientation="vertical" title="拖动调整左右区域占比" hidden></div>
			${pane('right')}
			${pane('merged')}
		</div>
	</div>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
