import * as assert from 'assert';
import { extractMermaidFileElements } from '../graph3d/mermaidFile';
import { extractElementsForSource, graphSourceKind } from '../graph3d/sources';

describe('graph3d/mermaidFile：独立 .mmd 文件', () => {
	it('整份文件解析为一个图元素，frontmatter 标题优先于文件名', () => {
		const elements = extractMermaidFileElements([
			'---',
			'title: 登录流程',
			'---',
			'flowchart TD',
			'  A[开始] --> B{校验}',
			'  B -->|通过| C[结束]',
		].join('\n'), { fallbackName: 'login' });

		assert.strictEqual(elements.length, 1);
		const element = elements[0];
		assert.strictEqual(element.id, 'g1');
		assert.strictEqual(element.name, '登录流程 · 流程图');
		assert.strictEqual(element.title, '登录流程');
		assert.strictEqual(element.kind, 'flowchart');
		assert.strictEqual(element.language, 'mermaid');
		assert.strictEqual(element.line, 1);
		// 解析器把 TD 归一成 TB（3D 布局只区分上下 / 左右）。
		assert.strictEqual(element.direction, 'TB');
		assert.deepStrictEqual(element.nodes.map(node => [node.id, node.label, node.shape]), [
			['A', '开始', 'box'],
			['B', '校验', 'diamond'],
			['C', '结束', 'box'],
		]);
		assert.deepStrictEqual(element.edges.map(edge => [edge.source, edge.target, edge.label]), [
			['A', 'B', undefined],
			['B', 'C', '通过'],
		]);
	});

	it('没有 title 时用文件名兜底，并追加图种', () => {
		const elements = extractMermaidFileElements('flowchart LR\nA[甲] --> B[乙]', { fallbackName: 'pipeline' });
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].name, 'pipeline · 流程图');
		assert.strictEqual(elements[0].title, undefined);
	});

	it('BOM 与 CRLF 归一化，源码里不残留 \\r', () => {
		const elements = extractMermaidFileElements('\uFEFFflowchart LR\r\nA[甲] --> B[乙]\r\n', { fallbackName: 'x' });
		assert.strictEqual(elements.length, 1);
		assert.ok(!elements[0].source.includes('\r'));
		assert.ok(elements[0].source.startsWith('flowchart LR\n'));
	});

	it('空白、只有注释或只有 init 指令时没有图元素', () => {
		assert.deepStrictEqual(extractMermaidFileElements('', { fallbackName: 'empty' }), []);
		assert.deepStrictEqual(extractMermaidFileElements('   \n\t\n', { fallbackName: 'blank' }), []);
		assert.deepStrictEqual(
			extractMermaidFileElements('%%{init: {"theme": "dark"}}%%\n%% 只有注释\n', { fallbackName: 'comments' }),
			[],
		);
	});

	it('未支持的图种走通用兜底，并带上 note', () => {
		const elements = extractMermaidFileElements([
			'requirementDiagram',
			'  requirement A {',
			'    id: 1',
			'    text: 需求一',
			'  }',
		].join('\n'), { fallbackName: 'req' });
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].kind, 'unknown');
		assert.ok(elements[0].nodes.length > 0);
		assert.ok((elements[0].note ?? '').includes('通用兜底'));
		assert.strictEqual(elements[0].name, 'req · 通用图');
	});
});

describe('graph3d/sources：输入文件类型分派', () => {
	it('识别 Markdown 与 Mermaid 扩展名（大小写不敏感）', () => {
		assert.strictEqual(graphSourceKind('D:\\work\\a.md'), 'markdown');
		assert.strictEqual(graphSourceKind('/work/a.MARKDOWN'), 'markdown');
		assert.strictEqual(graphSourceKind('D:\\work\\a.mmd'), 'mermaid');
		assert.strictEqual(graphSourceKind('/work/a.MERMAID'), 'mermaid');
		assert.strictEqual(graphSourceKind('/work/a.md?v=1'), 'markdown');
		assert.strictEqual(graphSourceKind('/work/a.txt'), undefined);
		assert.strictEqual(graphSourceKind('/work/mmd'), undefined);
	});

	it('extractElementsForSource 按类型分派：mermaid 单图 / markdown 多元素', () => {
		const mermaid = extractElementsForSource('mermaid', 'flowchart LR\nA --> B', 'single');
		assert.strictEqual(mermaid.length, 1);
		assert.strictEqual(mermaid[0].name, 'single · 流程图');

		const markdown = extractElementsForSource('markdown', [
			'# 一级标题',
			'',
			'```mermaid',
			'flowchart LR',
			'A --> B',
			'```',
			'',
			'```mermaid',
			'sequenceDiagram',
			'A->>B: 你好',
			'```',
		].join('\n'), 'doc');
		assert.strictEqual(markdown.length, 2);
		assert.deepStrictEqual(markdown.map(element => element.id), ['g1', 'g2']);
	});
});
