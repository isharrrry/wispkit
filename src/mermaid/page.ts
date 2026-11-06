import { escapeAttribute, escapeHtml } from '../util/html';

/**
 * `.mmd` / `.mermaid` 文件浏览页。
 *
 * 页面只放一个静态骨架：真正的图表由 VS Code 内置的 Mermaid 预览脚本
 * （`markdown.previewScripts` 贡献）扫描 `.mermaid` 容器后渲染。宿主不自己
 * 实现 Mermaid 渲染器，与 Markdown 视图保持同一条渲染管线。
 *
 * 没有可用的 Mermaid 预览脚本时退化为源码模式：同一个页面、同一个工具栏，
 * 只是把源码放进 `<pre>`，3D 浏览仍然可用。
 */

export interface MermaidPageStatus {
	readonly kindName: string;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly canOpen3d: boolean;
	readonly note?: string;
}

export interface MermaidPageScript {
	readonly src: string;
	readonly type?: 'module';
}

export interface MermaidPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly fileName: string;
	readonly filePath: string;
	readonly source: string;
	readonly mode: 'diagram' | 'source';
	readonly status: MermaidPageStatus;
	/** 顶部提示条；缺省时用 status.note。 */
	readonly hint?: string;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	readonly contributionStyles: readonly string[];
	readonly contributionScripts: readonly MermaidPageScript[];
}

export function mermaidStatusLabel(status: MermaidPageStatus): string {
	return `${status.kindName} · ${status.nodeCount} 节点 · ${status.edgeCount} 边`;
}

function stageMarkup(options: MermaidPageOptions): string {
	if (options.mode === 'source') {
		return `<pre class="wispkit-mmd-source" id="wispkit-mmd-source-view">${escapeHtml(options.source)}</pre>`;
	}
	// `.mermaid` 的 textContent 就是 Mermaid 源码，内置预览脚本据此渲染。
	return `<div class="mermaid" id="wispkit-mmd-diagram">${escapeHtml(options.source)}</div>`;
}

export function renderMermaidPage(options: MermaidPageOptions): string {
	const banner = options.hint ?? options.status.note;
	const payload = escapeAttribute(JSON.stringify({
		fileName: options.fileName,
		filePath: options.filePath,
		mode: options.mode,
	}));

	const styles = [...options.contributionStyles, options.runtimeStyle]
		.map(href => `<link rel="stylesheet" type="text/css" href="${escapeAttribute(href)}">`)
		.join('\n\t');

	const scripts = options.contributionScripts
		.map(script => {
			const type = script.type ? ` type="${escapeAttribute(script.type)}"` : '';
			return `<script async${type} src="${escapeAttribute(script.src)}" nonce="${options.nonce}" charset="UTF-8"></script>`;
		})
		.join('\n\t');

	const footHint = options.mode === 'diagram'
		? '滚轮缩放 · Alt + 拖动平移 · 悬停图表右上角出现缩放控件'
		: '当前没有可用的 Mermaid 预览脚本，按源码显示；3D 可视化浏览仍然可用。';

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-mmd-data" data-wispkit="${payload}">
	${styles}
</head>
<body>
	<div class="wispkit-mmd-app">
		<header class="wispkit-mmd-toolbar" role="toolbar" aria-label="Wispkit Mermaid">
			<span class="wispkit-mmd-file" id="wispkit-mmd-file" title="${escapeAttribute(options.filePath)}">${escapeHtml(options.fileName)}</span>
			<span class="wispkit-mmd-badge" id="wispkit-mmd-kind">${escapeHtml(mermaidStatusLabel(options.status))}</span>
			<span class="wispkit-mmd-spacer"></span>
			<button type="button" class="wispkit-mmd-btn wispkit-mmd-btn-primary" id="wispkit-mmd-3d"
				title="把这张图的拓扑放进 3D 场景浏览"${options.status.canOpen3d ? '' : ' disabled'}>3D 可视化浏览</button>
			<button type="button" class="wispkit-mmd-btn" id="wispkit-mmd-source"
				title="用普通文本编辑器打开源码">源码</button>
			<button type="button" class="wispkit-mmd-btn" id="wispkit-mmd-refresh"
				title="重新读取文件并渲染">刷新</button>
		</header>
		<div class="wispkit-mmd-banner" id="wispkit-mmd-banner"${banner ? '' : ' hidden'}>${escapeHtml(banner ?? '')}</div>
		<main class="wispkit-mmd-stage" id="wispkit-mmd-stage" data-mode="${options.mode}">
			${stageMarkup(options)}
		</main>
		<footer class="wispkit-mmd-foot" id="wispkit-mmd-foot">${escapeHtml(footHint)}</footer>
	</div>
	${scripts}
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
