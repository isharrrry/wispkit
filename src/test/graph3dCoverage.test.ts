import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { layoutGraph, type GraphLayout } from '../graph3d/layout';
import { extractGraphElements } from '../graph3d/markdownElements';
import { mergeElements } from '../graph3d/merge';
import { parseMermaid } from '../graph3d/mermaid';
import type { GraphElement, GraphKind, ParsedGraph } from '../graph3d/types';

/**
 * 3D 可视化的「解析 × 布局 × 合并」覆盖矩阵。
 *
 * 这里不重复各解析器的单元测试，而是按验收口径检查端到端结果：
 *   - demo/R3-mermaid 的四个真实文档全部能解析；
 *   - 每种 Mermaid 图种都有非空节点 / 边（象限图按定义没有边）；
 *   - 每种图的布局策略正确、坐标有限、节点不重叠（不是一团 / 空白）；
 *   - 合并后的图仍然可布局。
 */

function elementFrom(parsed: ParsedGraph, id = 'e1'): GraphElement {
	return {
		id,
		name: id,
		kind: parsed.kind,
		language: 'mermaid',
		line: 1,
		source: '',
		direction: parsed.direction,
		nodes: parsed.nodes,
		edges: parsed.edges,
		groups: parsed.groups,
		title: parsed.title,
		note: parsed.note,
	};
}

function assertFiniteLayout(layout: GraphLayout): void {
	for (const node of layout.nodes) {
		assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z), `节点 ${node.id} 坐标必须是有限数`);
		assert.ok(Number.isFinite(node.radius) && node.radius > 0, `节点 ${node.id} 半径必须为正`);
	}
	for (const edge of layout.edges) {
		for (const point of edge.points) {
			assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), `边 ${edge.index} 坐标必须是有限数`);
		}
	}
	assert.ok(Number.isFinite(layout.bounds.radius) && layout.bounds.radius > 0, '包围半径必须为正');
}

/** 两两检查球体不重叠；用于确认布局不是「挤成一团」。 */
function assertNoOverlap(layout: GraphLayout, label: string): void {
	for (let left = 0; left < layout.nodes.length; left += 1) {
		for (let right = left + 1; right < layout.nodes.length; right += 1) {
			const a = layout.nodes[left];
			const b = layout.nodes[right];
			const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			assert.ok(
				distance + 1e-6 >= a.radius + b.radius,
				`${label}：节点 ${a.label} 与 ${b.label} 重叠（距离 ${distance.toFixed(3)} < ${(a.radius + b.radius).toFixed(3)}）`,
			);
		}
	}
}

function edgeEndpointsExist(parsed: ParsedGraph): boolean {
	const ids = new Set(parsed.nodes.map(node => node.id));
	return parsed.edges.every(edge => ids.has(edge.source) && ids.has(edge.target));
}

function demo(name: string): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'R3-mermaid', name), 'utf8');
}

describe('graph3d/覆盖矩阵：demo/R3-mermaid', () => {
	it('01-types：9 个图元素覆盖全部主流图种，节点 / 边非空且布局可用', () => {
		const elements = extractGraphElements(demo('01-types.md'), { fallbackName: '01-types' });
		assert.deepStrictEqual(elements.map(element => element.kind), [
			'flowchart', 'sequence', 'class', 'state', 'er', 'journey', 'gantt', 'pie', 'gitgraph',
		]);
		const names = new Set<string>();
		for (const element of elements) {
			assert.ok(element.name.length > 0, `${element.kind} 必须有名字`);
			names.add(element.name);
			assert.ok(element.nodes.length > 0, `${element.kind} 必须解析出节点`);
			assert.ok(element.edges.length > 0, `${element.kind} 必须解析出边`);
			assert.ok(element.nodes.every(node => node.label.trim().length > 0), `${element.kind} 不能有空标签`);
			assert.ok(edgeEndpointsExist(element), `${element.kind} 的边端点必须存在`);
			const layout = layoutGraph(element);
			assert.notStrictEqual(layout.strategy, 'empty', `${element.kind} 不能布局成空图`);
			assert.strictEqual(layout.nodes.length, element.nodes.length);
			assertFiniteLayout(layout);
			assertNoOverlap(layout, element.kind);
		}
		assert.strictEqual(names.size, elements.length, '图元素名字必须唯一');
	});

	it('02-large：宽图 / 高图 / 密集图都能布局且不重叠', () => {
		const elements = extractGraphElements(demo('02-large.md'), { fallbackName: '02-large' });
		assert.deepStrictEqual(elements.map(element => [element.kind, element.nodes.length, element.edges.length]), [
			['flowchart', 12, 12],
			['flowchart', 16, 15],
			['flowchart', 11, 11],
		]);
		for (const element of elements) {
			const layout = layoutGraph(element);
			assertFiniteLayout(layout);
			assertNoOverlap(layout, element.name);
		}
	});

	it('03-edge：空 fence、语法错误、单节点都能降级而不崩', () => {
		const elements = extractGraphElements(demo('03-edge.md'), { fallbackName: '03-edge' });
		assert.strictEqual(elements.length, 6);
		const empty = elements[2];
		assert.strictEqual(empty.kind, 'unknown');
		assert.strictEqual(empty.nodes.length, 0);
		assert.ok(empty.note, '空 fence 必须留下 note');
		assert.strictEqual(layoutGraph(empty).strategy, 'empty');

		const broken = elements[3];
		assert.ok(broken.nodes.length >= 1, '语法错误图至少保留能识别的节点');
		assertFiniteLayout(layoutGraph(broken));

		const single = elements[4];
		assert.strictEqual(single.nodes.length, 1);
		assert.strictEqual(layoutGraph(single).strategy, 'single');

		assert.strictEqual(new Set(elements.map(element => element.name)).size, elements.length);
		for (const element of elements) {
			assertFiniteLayout(layoutGraph(element));
		}
	});

	it('04-many：20 张图全部解析，编号与名字唯一，布局互不串扰', () => {
		const elements = extractGraphElements(demo('04-many.md'), { fallbackName: '04-many' });
		assert.strictEqual(elements.length, 20);
		assert.deepStrictEqual(elements.map(element => element.id), Array.from({ length: 20 }, (_, index) => `g${index + 1}`));
		assert.strictEqual(new Set(elements.map(element => element.name)).size, 20);
		for (const element of elements) {
			assert.strictEqual(element.kind, 'flowchart');
			assert.strictEqual(element.nodes.length, 4);
			assert.strictEqual(element.edges.length, 3);
			const layout = layoutGraph(element);
			assertFiniteLayout(layout);
			assertNoOverlap(layout, element.name);
		}
	});
});

interface Fixture {
	readonly title: string;
	readonly source: string;
	readonly kind: GraphKind;
	readonly strategy: GraphLayout['strategy'];
	readonly nodeCount: number;
	readonly edgeCount: number;
}

const FIXTURES: readonly Fixture[] = [
	{
		title: 'flowchart（子图 + 链式 + & + 标签箭头 + 环）',
		kind: 'flowchart',
		strategy: 'layered',
		nodeCount: 5,
		edgeCount: 7,
		source: [
			'flowchart TD',
			'subgraph 前端',
			'  A[开始] --> B{判断}',
			'end',
			'B -->|是| C([处理])',
			'B -->|否| D((结束))',
			'C --> D',
			'D --> A',
			'A & B --> E[汇总]',
		].join('\n'),
	},
	{
		title: 'sequence',
		kind: 'sequence',
		strategy: 'sequence',
		nodeCount: 2,
		edgeCount: 2,
		source: [
			'sequenceDiagram',
			'  participant U as 用户',
			'  participant S as 系统',
			'  U->>S: 请求',
			'  S-->>U: 响应',
		].join('\n'),
	},
	{
		title: 'class',
		kind: 'class',
		strategy: 'layered',
		nodeCount: 3,
		edgeCount: 2,
		source: [
			'classDiagram',
			'  class A {',
			'    +x',
			'  }',
			'  A <|-- B',
			'  B --> C : uses',
		].join('\n'),
	},
	{
		title: 'state',
		kind: 'state',
		strategy: 'layered',
		nodeCount: 4,
		edgeCount: 4,
		source: [
			'stateDiagram-v2',
			'  [*] --> A',
			'  A --> B : go',
			'  B --> A : back',
			'  B --> [*]',
		].join('\n'),
	},
	{
		title: 'er',
		kind: 'er',
		strategy: 'layered',
		nodeCount: 3,
		edgeCount: 2,
		source: [
			'erDiagram',
			'  A ||--o{ B : has',
			'  B ||--o{ C : has',
		].join('\n'),
	},
	{
		title: 'mindmap',
		kind: 'mindmap',
		strategy: 'tree',
		nodeCount: 4,
		edgeCount: 3,
		source: [
			'mindmap',
			'  root((根))',
			'    A[分支]',
			'      A1(叶子)',
			'    B(分支 B)',
		].join('\n'),
	},
	{
		title: 'gitGraph',
		kind: 'gitgraph',
		strategy: 'layered',
		nodeCount: 4,
		edgeCount: 4,
		source: [
			'gitGraph',
			'  commit id: "a"',
			'  commit id: "b"',
			'  branch dev',
			'  checkout dev',
			'  commit id: "c"',
			'  checkout main',
			'  merge dev',
		].join('\n'),
	},
	{
		title: 'journey',
		kind: 'journey',
		strategy: 'layered',
		nodeCount: 2,
		edgeCount: 1,
		source: [
			'journey',
			'  title 打开文件',
			'  section 打开',
			'    双击: 5: 用户',
			'    渲染: 4: 系统',
		].join('\n'),
	},
	{
		title: 'gantt',
		kind: 'gantt',
		strategy: 'layered',
		nodeCount: 2,
		edgeCount: 1,
		source: [
			'gantt',
			'  title 里程碑',
			'  dateFormat YYYY-MM-DD',
			'  section 扩展',
			'    计划: done, 2026-10-01, 3d',
			'    实现: active, 2d',
		].join('\n'),
	},
	{
		title: 'timeline',
		kind: 'timeline',
		strategy: 'layered',
		nodeCount: 3,
		edgeCount: 2,
		source: [
			'timeline',
			'  title 时间线',
			'  2002 : 事件 A : 事件 B',
			'  2003 : 事件 C',
		].join('\n'),
	},
	{
		title: 'pie',
		kind: 'pie',
		strategy: 'tree',
		nodeCount: 3,
		edgeCount: 2,
		source: [
			'pie title 占比',
			'  "A" : 60',
			'  "B" : 40',
		].join('\n'),
	},
	{
		title: 'quadrant',
		kind: 'quadrant',
		strategy: 'quadrant',
		nodeCount: 3,
		edgeCount: 0,
		source: [
			'quadrantChart',
			'  title 象限',
			'  quadrant-1 高',
			'  point A: [0.1, 0.9]',
			'  point B: [0.9, 0.1]',
			'  point C: [0.5, 0.5]',
		].join('\n'),
	},
	{
		title: 'unknown（requirementDiagram 兜底）',
		kind: 'unknown',
		strategy: 'layered',
		nodeCount: 2,
		edgeCount: 1,
		source: [
			'requirementDiagram',
			'  requirement 登录 {',
			'    id: 1',
			'  }',
		].join('\n'),
	},
];

describe('graph3d/覆盖矩阵：Mermaid 图种 × 布局', () => {
	for (const fixture of FIXTURES) {
		it(`${fixture.title}：节点 / 边数量、策略、坐标、不重叠`, () => {
			const parsed = parseMermaid(fixture.source);
			assert.strictEqual(parsed.kind, fixture.kind);
			assert.strictEqual(parsed.nodes.length, fixture.nodeCount);
			assert.strictEqual(parsed.edges.length, fixture.edgeCount);
			assert.ok(parsed.nodes.every(node => node.label.trim().length > 0));
			assert.ok(edgeEndpointsExist(parsed));
			const layout = layoutGraph(elementFrom(parsed, fixture.kind));
			assert.strictEqual(layout.strategy, fixture.strategy);
			assert.strictEqual(layout.nodes.length, fixture.nodeCount);
			assert.strictEqual(layout.edges.length, fixture.edgeCount);
			assertFiniteLayout(layout);
			assertNoOverlap(layout, fixture.title);
		});
	}

	it('所有图种（含未知兜底）都不会返回空节点', () => {
		for (const fixture of FIXTURES) {
			const parsed = parseMermaid(fixture.source);
			assert.ok(parsed.nodes.length > 0, `${fixture.title} 必须有节点`);
			if (fixture.kind !== 'quadrant') {
				assert.ok(parsed.edges.length > 0, `${fixture.title} 必须有边`);
			}
			assert.strictEqual(layoutGraph(elementFrom(parsed, fixture.kind)).nodes.length, parsed.nodes.length);
		}
	});
});

describe('graph3d/覆盖矩阵：合并 + 布局', () => {
	it('跨图同名合并后仍能布局，共享节点把两张图连成一个整体', () => {
		const left = parseMermaid('flowchart TD\n开始-->处理\n处理-->结束');
		const right = parseMermaid('flowchart LR\n开始-->审核\n审核-->结束');
		const merged = mergeElements(elementFrom(left, 'L'), elementFrom(right, 'R'));
		assert.strictEqual(merged.mergedNodeCount, 2);
		assert.strictEqual(merged.element.kind, 'merged');
		assert.strictEqual(merged.element.nodes.length, 4);
		assert.strictEqual(merged.element.edges.length, 4);
		const layout = layoutGraph(merged.element);
		assert.strictEqual(layout.nodes.length, 4);
		assert.strictEqual(layout.edges.length, 4);
		assertFiniteLayout(layout);
		assertNoOverlap(layout, '合并图');
	});
});
