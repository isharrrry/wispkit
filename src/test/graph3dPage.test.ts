import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { installDom } from './helpers/dom';
import { renderGraph3dPage, type Graph3dPayload } from '../graph3d/page';
import type { GraphElement } from '../graph3d/types';

function sampleElement(): GraphElement {
	return {
		id: 'g1',
		name: '登录流程 · 流程图',
		kind: 'flowchart',
		language: 'mermaid',
		line: 3,
		source: 'flowchart TD\nA-->B',
		nodes: [
			{ id: 'A', label: '开始' },
			{ id: 'B', label: '结束' },
		],
		edges: [{ source: 'A', target: 'B' }],
	};
}

function render(payload: Graph3dPayload, title = '3D 可视化浏览：a.md'): string {
	return renderGraph3dPage({
		title,
		csp: "default-src 'none'; script-src 'nonce-fixed-nonce'; style-src 'self' vscode-resource: 'unsafe-inline';",
		nonce: 'fixed-nonce',
		runtimeScript: 'vscode-resource://ext/media/dist/graph3d.js',
		runtimeStyle: 'vscode-resource://ext/media/graph3d.css',
		payload,
	});
}

describe('graph3d/page', () => {
	const payload: Graph3dPayload = {
		fileName: 'a.md',
		filePath: '/work/a.md',
		elements: [sampleElement()],
	};

	it('页面包含左右下拉、合并 / 刷新 / 重置、布局算法、间隔滑杆与三个 3D 容器', () => {
		const html = render(payload);
		for (const id of [
			'wispkit-3d-left-select',
			'wispkit-3d-right-select',
			'wispkit-3d-merge',
			'wispkit-3d-refresh',
			'wispkit-3d-reset',
			'wispkit-3d-algorithm',
			'wispkit-3d-spacing',
			'wispkit-3d-spacing-value',
			'wispkit-3d-edge-labels',
			'wispkit-3d-splitter',
			'wispkit-3d-left-stage',
			'wispkit-3d-right-stage',
			'wispkit-3d-merged-stage',
			'wispkit-3d-left-tooltip',
			'wispkit-3d-right-tooltip',
			'wispkit-3d-merged-tooltip',
		]) {
			assert.ok(html.includes(`id="${id}"`), `页面缺少 #${id}`);
		}
		assert.ok(html.includes('data-side="merged"'), '合并容器默认存在但隐藏');
		assert.ok(html.includes('id="wispkit-3d-merged"'), '合并容器的 id 必须存在');
		assert.ok(html.includes('type="range"'), '间隔应该可调');
		assert.ok(/id="wispkit-3d-edge-labels"[^>]*type="checkbox"[^>]*checked/.test(html),
			'数据流名称复选框默认显示');
		for (const algorithm of ['auto', 'compact', 'compact-mutex', 'louvain', 'radial', 'layered', 'force', 'force-mutex']) {
			assert.ok(html.includes(`<option value="${algorithm}"`), `布局算法缺少 ${algorithm} 选项`);
		}
		assert.ok(html.includes('紧凑分层'), '布局下拉要有紧凑分层');
		assert.ok(html.includes('Louvain 壳内 FR-3D'), '布局下拉要有 Louvain 管线');
		assert.ok(html.includes('互斥 · 紧凑分层'), '布局下拉要有互斥紧凑分层');
		assert.ok(html.includes('互斥 · 3D 力导向'), '布局下拉要有互斥 3D 力导向');
		assert.ok(/value="compact-mutex"[^>]*title="[^"]*核心节点拉到布局两端/.test(html),
			'互斥选项要在 title 里说明核心节点会被拉到两端');
		assert.ok(html.includes('左键拖动旋转'), '需要交互提示');
		assert.ok(html.includes('悬停节点看注释'), '需要提示可以悬停看注释');
	});

	it('CSP / nonce / 外部脚本正确，未引入内联脚本', () => {
		const html = render(payload);
		assert.ok(html.includes('http-equiv="Content-Security-Policy"'));
		assert.ok(html.includes("script-src 'nonce-fixed-nonce'"));
		assert.ok(html.includes('nonce="fixed-nonce"'));
		assert.ok(html.includes('src="vscode-resource://ext/media/dist/graph3d.js"'));
		assert.ok(html.includes('href="vscode-resource://ext/media/graph3d.css"'));
		assert.strictEqual((html.match(/<script\b/g) ?? []).length, 1, '只允许一个带 nonce 的外部脚本');
	});

	it('完整图元素数据通过 meta data 属性传给前端，可原样解析', () => {
		const html = render(payload);
		const dom = installDom(html);
		const meta = dom.window.document.getElementById('wispkit-3d-data') as HTMLElement;
		assert.ok(meta, '必须存在数据 meta');
		const decoded = JSON.parse(meta.dataset.wispkit ?? '{}');
		assert.strictEqual(decoded.fileName, 'a.md');
		assert.strictEqual(decoded.elements.length, 1);
		assert.deepStrictEqual(decoded.elements[0].nodes.map((node: any) => node.label), ['开始', '结束']);
		dom.window.close();
	});

	it('节点的图片 data URL 原样传到 webview（base64 特殊字符不被破坏）', () => {
		const image = {
			src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			alt: '图示',
			path: 'D:\\docs\\img\\a+b=c.png',
			mime: 'image/png',
		};
		const element: GraphElement = {
			...sampleElement(),
			nodes: [{ id: 'A', label: '图示', image }, { id: 'B', label: '结束' }],
		};
		const html = render({ ...payload, elements: [element] });
		const dom = installDom(html);
		const meta = dom.window.document.getElementById('wispkit-3d-data') as HTMLElement;
		const decoded = JSON.parse(meta.dataset.wispkit ?? '{}');
		assert.strictEqual(decoded.elements[0].nodes[0].image.src, image.src);
		assert.strictEqual(decoded.elements[0].nodes[0].image.alt, '图示');
		dom.window.close();
	});

	it('标题与文件名会做 HTML 转义', () => {
		const html = render(payload, '<img src=x onerror=alert(1)>');
		assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
		assert.ok(!html.includes('<img src=x'));
	});

	it('CSS 定义分栏、拖动条、气泡舞台与浅色主题', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'graph3d.css'), 'utf8');
		for (const selector of [
			'.wispkit-3d-toolbar',
			'.wispkit-3d-panes',
			'.wispkit-3d-pane',
			'.wispkit-3d-stage',
			'.wispkit-3d-splitter',
			'.wispkit-3d-range',
			'.wispkit-3d-algorithm-field',
			'.wispkit-3d-checkbox',
			'.wispkit-3d-tooltip',
			'.wispkit-3d-tooltip-title',
			'.wispkit-3d-tooltip-body',
			'body.vscode-light .wispkit-3d-stage',
		]) {
			assert.ok(css.includes(selector), `CSS 缺少 ${selector}`);
		}
		assert.ok(css.includes('cursor: col-resize'));
		assert.ok(css.includes('cursor: grab'));
	});
});
