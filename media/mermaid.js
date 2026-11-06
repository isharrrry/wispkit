/**
 * `.mmd` / `.mermaid` 浏览页的宿主桥。
 *
 * 图表渲染本身交给 `markdown.previewScripts` 贡献的内置 Mermaid 脚本；
 * 这里只负责工具栏（刷新 / 源码 / 3D）与「文档变更后原地重渲染」：
 * 改掉 `.mermaid` 容器的 textContent，再派发内置脚本监听的事件即可。
 */

const vscodeApi = (() => {
	try {
		return typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
	} catch {
		return undefined;
	}
})();

function byId(id) {
	return document.getElementById(id);
}

const ui = {
	diagram: byId('wispkit-mmd-diagram'),
	sourceView: byId('wispkit-mmd-source-view'),
	kind: byId('wispkit-mmd-kind'),
	banner: byId('wispkit-mmd-banner'),
	open3d: byId('wispkit-mmd-3d'),
	refresh: byId('wispkit-mmd-refresh'),
	openSource: byId('wispkit-mmd-source'),
	stage: byId('wispkit-mmd-stage'),
};

function post(type) {
	if (vscodeApi) {
		vscodeApi.postMessage({ type });
	}
}

function setBanner(text) {
	if (!ui.banner) {
		return;
	}
	ui.banner.textContent = text ?? '';
	ui.banner.hidden = !text;
}

function setStatus(status) {
	if (!status) {
		return;
	}
	if (ui.kind) {
		ui.kind.textContent = `${status.kindName} · ${status.nodeCount} 节点 · ${status.edgeCount} 边`;
	}
	if (ui.open3d) {
		ui.open3d.disabled = !status.canOpen3d;
		ui.open3d.title = status.canOpen3d
			? '把这张图的拓扑放进 3D 场景浏览'
			: '没有解析出可显示的节点';
	}
}

ui.refresh?.addEventListener('click', () => post('wispkit.mmd.refresh'));
ui.openSource?.addEventListener('click', () => post('wispkit.mmd.openSource'));
ui.open3d?.addEventListener('click', () => {
	if (!ui.open3d.disabled) {
		post('wispkit.mmd.open3d');
	}
});

window.addEventListener('message', event => {
	const message = event.data;
	if (!message || message.type !== 'wispkit.mmd.update' || typeof message.source !== 'string') {
		return;
	}
	if (ui.diagram) {
		ui.diagram.textContent = message.source;
		// 内置 Mermaid 预览脚本在 window 上监听这个事件，收到后重新扫描 `.mermaid`。
		window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'));
	} else if (ui.sourceView) {
		ui.sourceView.textContent = message.source;
	}
	setStatus(message.status);
	setBanner(typeof message.hint === 'string' ? message.hint : message.status?.note);
});

Object.defineProperty(window, '__wispkitMermaidSelftest', {
	value: {
		mode: () => ui.stage?.dataset.mode,
		source: () => (ui.diagram ? ui.diagram.textContent : ui.sourceView ? ui.sourceView.textContent : ''),
		status: () => ui.kind?.textContent ?? '',
		open3dEnabled: () => Boolean(ui.open3d && !ui.open3d.disabled),
	},
});
