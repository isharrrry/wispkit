import * as assert from 'assert';
import { extractGraphElements } from '../graph3d/markdownElements';

describe('graph3d/markdownElements', () => {
	it('按标题命名 Mermaid 与 ASCII 树，并记录代码块行号', () => {
		const markdown = [
			'# 架构',
			'',
			'## 登录流程',
			'',
			'```mermaid',
			'flowchart TD',
			'A[开始] --> B[结束]',
			'```',
			'',
			'## 目录结构',
			'',
			'```',
			'src',
			'├── a.ts',
			'└── b.ts',
			'```',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.strictEqual(elements.length, 2);
		assert.deepStrictEqual(elements.map(element => [element.name, element.kind, element.line]), [
			['登录流程 · 流程图', 'flowchart', 5],
			['目录结构 · ASCII 树', 'ascii-tree', 12],
		]);
		assert.strictEqual(elements[1].nodes.length, 3);
	});

	it('Mermaid frontmatter 标题优先于最近的 Markdown 标题', () => {
		const markdown = [
			'## 小节',
			'```mermaid',
			'---',
			'title: 自定义标题',
			'---',
			'flowchart TD',
			'A-->B',
			'```',
		].join('\n');
		const [element] = extractGraphElements(markdown);
		assert.strictEqual(element.name, '自定义标题 · 流程图');
	});

	it('同名图元素自动加序号，标题层级变化会切换命名', () => {
		const markdown = [
			'# A',
			'## 图',
			'```mermaid',
			'flowchart TD',
			'A-->B',
			'```',
			'```mermaid',
			'flowchart LR',
			'C-->D',
			'```',
			'# B',
			'```mermaid',
			'flowchart TD',
			'E-->F',
			'```',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.deepStrictEqual(elements.map(element => element.name), [
			'图 · 流程图',
			'图 · 流程图 (2)',
			'B · 流程图',
		]);
	});

	it('忽略普通代码块；ASCII 识别仅在 text / 无语言等围栏里生效', () => {
		const markdown = [
			'```js',
			'root',
			'├── not-a-tree',
			'└── because-language-is-js',
			'```',
			'```text',
			'tree',
			'├── a',
			'└── b',
			'```',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].kind, 'ascii-tree');
		assert.strictEqual(elements[0].language, 'text');
	});

	it('支持 ~~~ 围栏与带属性的 info 字符串', () => {
		const markdown = [
			'~~~{.mermaid}',
			'flowchart TD',
			'A-->B',
			'~~~',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].language, 'mermaid');
	});

	it('无标题、无节点时用 fallbackName 命名', () => {
		const markdown = [
			'```mermaid',
			'```',
		].join('\n');
		const [element] = extractGraphElements(markdown, { fallbackName: '设计稿' });
		assert.strictEqual(element.name, '设计稿 · Mermaid 图');
		assert.strictEqual(element.nodes.length, 0);
		assert.ok(element.note);
	});

	it('从第一个节点名兜底命名，且不会把普通 Markdown 当图', () => {
		const markdown = [
			'```mermaid',
			'flowchart TD',
			'开始 --> 结束',
			'```',
			'普通段落里有 ├── 但不是代码块。',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].name, '开始 · 流程图');
	});

	it('空文档返回空数组', () => {
		assert.deepStrictEqual(extractGraphElements(''), []);
		assert.deepStrictEqual(extractGraphElements('# 只有标题\n\n没有图。'), []);
	});

	it('正文里未加围栏的 Unicode 树也能被提取，并按最近标题命名', () => {
		const markdown = [
			'# 目录',
			'',
			'结构如下：',
			'',
			'project',
			'├── src',
			'│   ├── a.ts',
			'│   └── b.ts',
			'└── test',
			'',
			'以上是目录，不是树的一部分。',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].kind, 'ascii-tree');
		assert.strictEqual(elements[0].name, '目录 · ASCII 树');
		assert.strictEqual(elements[0].line, 5);
		assert.deepStrictEqual(elements[0].nodes.map(node => node.label), ['project', 'src', 'a.ts', 'b.ts', 'test']);
		assert.strictEqual(elements[0].edges.length, 4);
		assert.ok(!elements[0].nodes.some(node => node.label.includes('以上是目录')), '树后面的正文不能被吞进节点');
	});

	it('正文裸树里的缩进注释行纳入树，并挂到最近节点', () => {
		const markdown = [
			'root',
			'├── a',
			'    # a 的整行注释',
			'└── b',
		].join('\n');
		const [element] = extractGraphElements(markdown);
		assert.ok(element, '注释行不能把裸树截断成不足两行连接线');
		assert.deepStrictEqual(element.nodes.map(node => node.label), ['root', 'a', 'b']);
		assert.strictEqual(element.nodes.find(node => node.label === 'a')?.comment, 'a 的整行注释');
		assert.strictEqual(element.edges.length, 2);
	});

	it('正文裸树支持 ASCII +-- 画法，没有标题时用第一个节点命名', () => {
		const markdown = ['root', '+-- a', '+-- b', ''].join('\n');
		const [element] = extractGraphElements(markdown);
		assert.strictEqual(element.kind, 'ascii-tree');
		assert.strictEqual(element.name, 'root · ASCII 树');
		assert.strictEqual(element.language, 'text');
		assert.deepStrictEqual(element.nodes.map(node => node.label), ['root', 'a', 'b']);
	});

	it('正文列表 / 表格 / 普通段落 / 非 text 围栏不会被误判为树', () => {
		const markdown = [
			'# 不是树',
			'',
			'- 列表一',
			'- 列表二',
			'  - 嵌套',
			'',
			'| a | b |',
			'|---|---|',
			'| 1 | 2 |',
			'',
			'这是普通正文，提到 ├── 也不是代码块。',
			'',
			'```js',
			'root',
			'├── a',
			'└── b',
			'```',
		].join('\n');
		assert.deepStrictEqual(extractGraphElements(markdown), []);
	});

	it('text 围栏里的带标题方框示意图不会被当成 ASCII 树', () => {
		const markdown = [
			'```text',
			'┌──── 扩展宿主 ────┐',
			'│ src/a.ts          │',
			'│ src/b.ts          │',
			'└───────────────────┘',
			'```',
		].join('\n');
		assert.deepStrictEqual(extractGraphElements(markdown), []);
	});

	it('围栏图与正文裸树按文档顺序编号，互不重复', () => {
		const markdown = [
			'## 一',
			'',
			'裸树：',
			'',
			'root',
			'├── a',
			'└── b',
			'',
			'```mermaid',
			'flowchart TD',
			'A-->B',
			'```',
		].join('\n');
		const elements = extractGraphElements(markdown);
		assert.deepStrictEqual(elements.map(element => [element.id, element.name, element.line]), [
			['g1', '一 · ASCII 树', 5],
			['g2', '一 · 流程图', 9],
		]);
		assert.strictEqual(elements[0].language, 'text');
	});

	it('BOM 与 CRLF 不影响围栏识别和命名', () => {
		const markdown = '\uFEFF# 标题\r\n\r\n```mermaid\r\nflowchart TD\r\nA-->B\r\n```\r\n';
		const [element] = extractGraphElements(markdown);
		assert.strictEqual(element.name, '标题 · 流程图');
		assert.deepStrictEqual(element.nodes.map(node => node.label), ['A', 'B']);
	});

	it('未闭合围栏一直读到文末，也不会把围栏里的 # 当标题', () => {
		const markdown = '```mermaid\nflowchart TD\nA-->B\n# 这行在围栏里\n';
		const [element] = extractGraphElements(markdown, { fallbackName: '文档' });
		assert.strictEqual(element.name, 'A · 流程图');
		assert.strictEqual(element.nodes.length, 2);
		assert.strictEqual(element.line, 1);
	});

	it('更长围栏不会被内部的三反引号提前关闭', () => {
		const markdown = ['````mermaid', 'flowchart TD', 'A-->B', '```', '````', ''].join('\n');
		const elements = extractGraphElements(markdown);
		assert.strictEqual(elements.length, 1);
		assert.strictEqual(elements[0].kind, 'flowchart');
		assert.strictEqual(elements[0].nodes.length, 2);
	});

	it('标题层级回退会切换命名（### 之后回到 #）', () => {
		const markdown = [
			'# A',
			'## B',
			'### C',
			'```mermaid',
			'flowchart TD',
			'X-->Y',
			'```',
			'# D',
			'```mermaid',
			'flowchart LR',
			'M-->N',
			'```',
		].join('\n');
		assert.deepStrictEqual(extractGraphElements(markdown).map(element => element.name), [
			'C · 流程图',
			'D · 流程图',
		]);
	});

	it('超过 MAX_ELEMENTS(200) 时只保留前 200 个图元素', () => {
		const parts: string[] = [];
		for (let index = 0; index < 250; index += 1) {
			parts.push(`## 图 ${index}`, '', '```mermaid', 'flowchart TD', `A${index}-->B${index}`, '```', '');
		}
		const elements = extractGraphElements(parts.join('\n'));
		assert.strictEqual(elements.length, 200);
		assert.deepStrictEqual(elements.map(element => element.id), Array.from({ length: 200 }, (_, index) => `g${index + 1}`));
		assert.strictEqual(elements[199].nodes.length, 2);
		assert.strictEqual(elements[199].name, '图 199 · 流程图');
	});

	it('超长标签按 240 字符截断，Mermaid 与 ASCII 都不例外', () => {
		const long = 'x'.repeat(1000);
		const markdown = [
			'```mermaid',
			'flowchart TD',
			`A[${long}] --> B`,
			'```',
			'```text',
			'root',
			`├── ${long}`,
			'└── b',
			'```',
		].join('\n');
		const [mermaid, ascii] = extractGraphElements(markdown);
		assert.strictEqual(mermaid.nodes.find(node => node.id === 'A')?.label.length, 240);
		assert.strictEqual(ascii.nodes[1].label.length, 240);
	});

	it('没有围栏的 Mermaid 原文不会被当成图', () => {
		assert.deepStrictEqual(extractGraphElements('flowchart TD\nA-->B'), []);
	});
});
