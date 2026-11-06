import * as assert from 'assert';
import { installDom } from './helpers/dom';
import { mermaidStatusLabel, renderMermaidPage, type MermaidPageOptions } from '../mermaid/page';
import { mermaidFileStatus } from '../mermaid/status';

const SOURCE = 'flowchart LR\nA["a<b"] --> B[结束]';

function options(overrides: Partial<MermaidPageOptions> = {}): MermaidPageOptions {
	return {
		title: 'flow.mmd',
		csp: "default-src 'none'; script-src 'nonce-fixed';",
		nonce: 'fixed',
		fileName: 'flow.mmd',
		filePath: 'D:\\work\\flow.mmd',
		source: SOURCE,
		mode: 'diagram',
		status: mermaidFileStatus(SOURCE),
		runtimeScript: 'vscode-resource://ext/media/dist/mermaid.js',
		runtimeStyle: 'vscode-resource://ext/media/mermaid.css',
		contributionStyles: ['vscode-resource://mermaid/preview.css'],
		contributionScripts: [{ src: 'vscode-resource://mermaid/preview.js', type: 'module' }],
		...overrides,
	};
}

describe('mermaid/status', () => {
	it('与 3D 解析器共用计数：图种 + 节点 + 边', () => {
		const status = mermaidFileStatus(SOURCE);
		assert.strictEqual(status.kindName, '流程图');
		assert.strictEqual(status.nodeCount, 2);
		assert.strictEqual(status.edgeCount, 1);
		assert.strictEqual(status.canOpen3d, true);
		assert.strictEqual(mermaidStatusLabel(status), '流程图 · 2 节点 · 1 边');
	});

	it('空文件没有可打开 3D 的节点', () => {
		const status = mermaidFileStatus('');
		assert.strictEqual(status.nodeCount, 0);
		assert.strictEqual(status.canOpen3d, false);
		assert.ok(status.note, '解析器应给出空图说明');
	});
});

describe('mermaid/page', () => {
	it('图形模式：.mermaid 容器、工具栏、状态与外部脚本齐全', () => {
		const html = renderMermaidPage(options());
		assert.ok(html.includes('id="wispkit-mmd-diagram"'));
		assert.ok(html.includes('class="mermaid"'), '内置预览脚本按 .mermaid 选择器渲染');
		assert.ok(html.includes('a&lt;b'), '源码必须转义后放进 textContent');
		assert.ok(html.includes('流程图 · 2 节点 · 1 边'));
		assert.ok(html.includes('id="wispkit-mmd-3d"'));
		assert.ok(!/id="wispkit-mmd-3d"[^>]*disabled/.test(html), '有节点时 3D 入口可用');
		assert.ok(html.includes('id="wispkit-mmd-source"'));
		assert.ok(html.includes('id="wispkit-mmd-refresh"'));
		assert.ok(html.includes('href="vscode-resource://mermaid/preview.css"'));
		assert.ok(html.includes('type="module"'));
		assert.ok(html.includes('nonce="fixed"'));
		assert.ok(html.includes('src="vscode-resource://ext/media/dist/mermaid.js"'));
		assert.strictEqual((html.match(/<script\b/g) ?? []).length, 2, '一个贡献脚本 + 一个宿主脚本');
	});

	it('源码模式：预格式化源码 + 提示条，没有 .mermaid 容器', () => {
		const html = renderMermaidPage(options({
			mode: 'source',
			source: '',
			status: mermaidFileStatus(''),
			hint: '没有检测到 Mermaid 预览扩展。',
		}));
		assert.ok(html.includes('id="wispkit-mmd-source-view"'));
		assert.ok(!html.includes('id="wispkit-mmd-diagram"'));
		assert.ok(html.includes('没有检测到 Mermaid 预览扩展。'));
		assert.ok(!/id="wispkit-mmd-banner"[^>]*hidden/.test(html), '有提示时必须显示横幅');
		assert.ok(/id="wispkit-mmd-3d"[^>]*disabled/.test(html), '没有节点时禁用 3D 入口');
	});

	it('数据 meta 可原样解析，CSP 与 nonce 来自宿主', () => {
		const html = renderMermaidPage(options());
		const dom = installDom(html);
		const meta = dom.window.document.getElementById('wispkit-mmd-data') as HTMLElement;
		assert.ok(meta);
		const payload = JSON.parse(meta.dataset.wispkit ?? '{}');
		assert.strictEqual(payload.fileName, 'flow.mmd');
		assert.strictEqual(payload.filePath, 'D:\\work\\flow.mmd');
		assert.strictEqual(payload.mode, 'diagram');

		const csp = dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]');
		assert.ok(csp?.getAttribute('content')?.includes("script-src 'nonce-fixed'"));
	});
});
