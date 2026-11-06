import * as assert from 'assert';
import { looksLikeAsciiTree, parseAsciiTree } from '../graph3d/ascii';
import type { GraphNode } from '../graph3d/types';

function labels(nodes: readonly GraphNode[]): string[] {
	return nodes.map(node => node.label);
}

function edgeLabels(target: ReturnType<typeof parseAsciiTree>): string[] {
	const byId = new Map(target.nodes.map(node => [node.id, node.label]));
	return target.edges.map(edge => `${byId.get(edge.source)} > ${byId.get(edge.target)}`);
}

describe('graph3d/ascii', () => {
	it('解析 Unicode 制表符树：根、两层子节点、5 条边', () => {
		const graph = parseAsciiTree([
			'project',
			'├── src',
			'│   ├── a.ts',
			'│   └── b.ts',
			'└── test',
			'    └── c.ts',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['project', 'src', 'a.ts', 'b.ts', 'test', 'c.ts']);
		assert.deepStrictEqual(edgeLabels(graph), [
			'project > src',
			'src > a.ts',
			'src > b.ts',
			'project > test',
			'test > c.ts',
		]);
	});

	it('解析 ASCII 画法 +-- / |   / `--', () => {
		const graph = parseAsciiTree([
			'root',
			'+-- a',
			'|   +-- b',
			'`-- c',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'a', 'b', 'c']);
		assert.deepStrictEqual(edgeLabels(graph), ['root > a', 'a > b', 'root > c']);
	});

	it('两行以上连接线才认定为树；普通 Markdown 列表不误判', () => {
		assert.strictEqual(looksLikeAsciiTree('- one\n- two\n  - three'), false);
		assert.strictEqual(looksLikeAsciiTree('const x = 1;\nif (x) { return x; }'), false);
		assert.strictEqual(looksLikeAsciiTree('├── only one line'), false);
		assert.strictEqual(looksLikeAsciiTree('root\n├── a\n└── b'), true);
	});

	it('支持多棵树根（同一代码块里的森林）', () => {
		const graph = parseAsciiTree([
			'one',
			'├── a',
			'two',
			'└── b',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['one', 'a', 'two', 'b']);
		assert.deepStrictEqual(edgeLabels(graph), ['one > a', 'two > b']);
	});

	it('没有根的片段把第一个 ├── 当根，不会丢掉整棵树', () => {
		const graph = parseAsciiTree([
			'├── a',
			'│   └── b',
			'└── c',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['a', 'b', 'c']);
		assert.deepStrictEqual(edgeLabels(graph), ['a > b', 'a > c']);
	});

	it('缩进但没有连接线的行视为上一个节点的续行', () => {
		const graph = parseAsciiTree([
			'root',
			'├── a very long',
			'    label continued',
			'└── b',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'a very long label continued', 'b']);
	});

	it('制表符按 4 空格处理，括号 / 表情等标签原样保留', () => {
		const graph = parseAsciiTree('root\n\t├── dir (核心)\n\t└── file ✅\n');
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'dir (核心)', 'file ✅']);
		assert.deepStrictEqual(edgeLabels(graph), ['root > dir (核心)', 'root > file ✅']);
	});

	it('只有连接线没有标签的行被忽略，空内容返回空图', () => {
		const graph = parseAsciiTree('root\n├── a\n│\n└── b');
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'a', 'b']);
		const empty = parseAsciiTree('');
		assert.strictEqual(empty.nodes.length, 0);
		assert.strictEqual(empty.edges.length, 0);
	});

	it('ASCII 画法只要有两行带标签连接线就算树（不要求竖线）', () => {
		assert.strictEqual(looksLikeAsciiTree('root\n+-- a\n+-- b'), true);
		assert.strictEqual(looksLikeAsciiTree('root\n`-- a\n`-- b'), true);
		assert.strictEqual(looksLikeAsciiTree('root\n\\-- a\n\\-- b'), true);
		const plus = parseAsciiTree('root\n+-- a\n+-- b');
		assert.deepStrictEqual(labels(plus.nodes), ['root', 'a', 'b']);
		assert.deepStrictEqual(edgeLabels(plus), ['root > a', 'root > b']);
		const backtick = parseAsciiTree('root\n`-- a\n|   `-- b\n`-- c');
		assert.deepStrictEqual(labels(backtick.nodes), ['root', 'a', 'b', 'c']);
		assert.deepStrictEqual(edgeLabels(backtick), ['root > a', 'a > b', 'root > c']);
	});

	it('ASCII 方框 / Markdown 表格不会被当成树', () => {
		const frame = ['+---------+', '| content |', '+---------+'].join('\n');
		assert.strictEqual(looksLikeAsciiTree(frame), false);
		assert.strictEqual(looksLikeAsciiTree('| a | b |\n|---|---|\n| 1 | 2 |\n|---|---|'), false);
		assert.strictEqual(looksLikeAsciiTree('a -- b\nc -- d'), false);
	});

	it('带标题的 ASCII 方框（Unicode / 纯 ASCII）不会被当成树', () => {
		const unicodeBox = [
			'┌──── 扩展宿主 ────┐',
			'│ src/a.ts          │',
			'│ src/b.ts          │',
			'└───────────────────┘',
			'┌──── 前端 ────────┐',
			'│ media/a.js        │',
			'└───────────────────┘',
		].join('\n');
		assert.strictEqual(looksLikeAsciiTree(unicodeBox), false);
		const asciiBox = [
			'+---- title ----+',
			'| a             |',
			'| b             |',
			'+---------------+',
		].join('\n');
		assert.strictEqual(looksLikeAsciiTree(asciiBox), false);
	});

	it('行尾空格不影响缩进与层级', () => {
		const graph = parseAsciiTree([
			'root   ',
			'├── a   ',
			'│   ├── b   ',
			'└── c   ',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'a', 'b', 'c']);
		assert.deepStrictEqual(edgeLabels(graph), ['root > a', 'a > b', 'root > c']);
	});

	it('Unicode 圆角分支符也支持，超过 600 个节点会截断', () => {
		const rounded = parseAsciiTree('root\n╰── a\n╰── b');
		assert.deepStrictEqual(labels(rounded.nodes), ['root', 'a', 'b']);
		const lines = ['root'];
		for (let index = 0; index < 700; index += 1) {
			lines.push(`├── n${index}`);
		}
		const large = parseAsciiTree(lines.join('\n'));
		assert.strictEqual(large.nodes.length, 600);
		assert.ok(large.nodes.every(node => node.label.length <= 240));
	});

	it('行尾 # / // 注释挂到条目上，不会留在标签里', () => {
		const graph = parseAsciiTree([
			'root  # 根注释',
			'├── src   # 源码目录',
			'│   └── main.ts   // 入口文件',
			'└── C# 项目   # 语言名不算标签',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'src', 'main.ts', 'C# 项目']);
		const commentOf = (label: string) => graph.nodes.find(node => node.label === label)?.comment;
		assert.strictEqual(commentOf('root'), '根注释');
		assert.strictEqual(commentOf('src'), '源码目录');
		assert.strictEqual(commentOf('main.ts'), '入口文件');
		// `C#` 里的 # 没有前导空白，不当注释分隔符。
		assert.strictEqual(commentOf('C# 项目'), '语言名不算标签');
	});

	it('整行注释与未重复 # 的折行注释都合并到条目注释', () => {
		const graph = parseAsciiTree([
			'root',
			'├── a   # 第一行',
			'│       # 第二行',
			'│       第三行（列对齐的折行，没有 #）',
			'├── b',
			'│   # 独立注释行',
			'└── c',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'a', 'b', 'c']);
		const commentOf = (label: string) => graph.nodes.find(node => node.label === label)?.comment;
		assert.strictEqual(commentOf('a'), '第一行\n第二行\n第三行（列对齐的折行，没有 #）');
		assert.strictEqual(commentOf('b'), '独立注释行');
		assert.strictEqual(commentOf('c'), undefined);
	});

	it('开头 / 结尾的纯注释行不会变成节点', () => {
		const graph = parseAsciiTree([
			'# 文件头注释',
			'root',
			'├── a   # A 的注释',
			'└── b',
			'# 文件尾注释',
		].join('\n'));
		assert.deepStrictEqual(labels(graph.nodes), ['root', 'a', 'b']);
		assert.strictEqual(graph.nodes.find(node => node.label === 'a')?.comment, 'A 的注释');
	});
});
