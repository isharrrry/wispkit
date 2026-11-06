import * as assert from 'assert';
import { parseAsciiTree } from '../graph3d/ascii';
import { elementSizeInfo, layoutGraph, type GraphLayout } from '../graph3d/layout';
import { extractGraphElements } from '../graph3d/markdownElements';
import { parseMermaid } from '../graph3d/mermaid';
import { mergeElements } from '../graph3d/merge';
import type { GraphEdge, GraphElement, GraphNode, ParsedGraph } from '../graph3d/types';

function elementFrom(parsed: ParsedGraph, id = 'e1'): GraphElement {
	return {
		id,
		name: '测试图',
		kind: parsed.kind,
		language: 'mermaid',
		line: 1,
		source: '',
		direction: parsed.direction,
		nodes: parsed.nodes,
		edges: parsed.edges,
		groups: parsed.groups,
	};
}

function assertFinite(layout: GraphLayout): void {
	for (const node of layout.nodes) {
		assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z), `节点 ${node.id} 坐标必须是有限数`);
		assert.ok(node.radius > 0, `节点 ${node.id} 半径必须为正`);
	}
	for (const edge of layout.edges) {
		for (const point of edge.points) {
			assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), `边 ${edge.index} 的坐标必须是有限数`);
		}
	}
}

function nodeY(layout: GraphLayout, id: string): number {
	const node = layout.nodes.find(item => item.id === id);
	assert.ok(node, `布局里应该有节点 ${id}`);
	return node.y;
}

function nodeById(layout: GraphLayout, id: string) {
	const node = layout.nodes.find(item => item.id === id);
	assert.ok(node, `布局里应该有节点 ${id}`);
	return node;
}

function mergedFrom(leftSource: string, rightSource: string): GraphElement {
	return mergeElements(
		elementFrom(parseMermaid(leftSource), 'left'),
		elementFrom(parseMermaid(rightSource), 'right'),
	).element;
}

describe('graph3d/layout', () => {
	const asciiTree = parseAsciiTree([
		'project',
		'├── src',
		'│   ├── a.ts',
		'│   └── b.ts',
		'└── test',
		'    └── c.ts',
	].join('\n'));
	const asciiElement = elementFrom(asciiTree, 'ascii');

	it('树使用 tree 策略：根在原点，子节点向 -Y 展开', () => {
		const layout = layoutGraph(asciiElement);
		assert.strictEqual(layout.strategy, 'tree');
		assert.deepStrictEqual(layout.nodes.map(node => node.id), ['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
		const root = layout.nodes.find(node => node.id === 'a0')!;
		assert.strictEqual(root.x, 0);
		assert.strictEqual(root.y, 0);
		assert.strictEqual(root.z, 0);
		assert.ok(nodeY(layout, 'a1') < 0, '第一层应该在根的下方');
		assert.ok(nodeY(layout, 'a2') < nodeY(layout, 'a1'), '第二层应该更深');
		assertFinite(layout);
	});

	it('间隔倍率会整体放大布局，且被钳制在 0.25–3', () => {
		const small = layoutGraph(asciiElement, { spacing: 0.5 });
		const normal = layoutGraph(asciiElement, { spacing: 1 });
		const large = layoutGraph(asciiElement, { spacing: 2 });
		assert.ok(small.bounds.radius < normal.bounds.radius);
		assert.ok(normal.bounds.radius < large.bounds.radius);
		assert.strictEqual(layoutGraph(asciiElement, { spacing: 0 }).spacing, 0.25);
		assert.strictEqual(layoutGraph(asciiElement, { spacing: 99 }).spacing, 3);
	});

	it('DAG 流程图使用 layered 策略：同一层共享主轴坐标', () => {
		const flow = parseMermaid([
			'flowchart TD',
			'A --> B',
			'A --> C',
			'B --> D',
			'C --> D',
		].join('\n'));
		const layout = layoutGraph(elementFrom(flow));
		assert.strictEqual(layout.strategy, 'layered');
		assert.strictEqual(nodeY(layout, 'A'), 0);
		assert.strictEqual(nodeY(layout, 'B'), nodeY(layout, 'C'));
		assert.ok(nodeY(layout, 'D') < nodeY(layout, 'B'));
		assertFinite(layout);
	});

	it('有环流程图用 SCC 缩点分层：环内节点同层且布局确定', () => {
		const cycle = parseMermaid([
			'flowchart TD',
			'A --> B',
			'B --> C',
			'C --> A',
		].join('\n'));
		const first = layoutGraph(elementFrom(cycle));
		const second = layoutGraph(elementFrom(cycle));
		assert.strictEqual(first.strategy, 'layered');
		assert.deepStrictEqual(first, second, '同一张图两次布局必须完全一致');
		assert.strictEqual(nodeY(first, 'A'), nodeY(first, 'B'));
		assert.strictEqual(nodeY(first, 'B'), nodeY(first, 'C'));
		assertFinite(first);
	});

	it('ER 的环没有明确上下游，回退到确定性 3D 力导向', () => {
		const er = parseMermaid([
			'erDiagram',
			'A ||--o{ B : 拥有',
			'B ||--o{ A : 反向',
		].join('\n'));
		const first = layoutGraph(elementFrom(er));
		const second = layoutGraph(elementFrom(er));
		assert.strictEqual(first.strategy, 'force');
		assert.deepStrictEqual(first, second);
		assertFinite(first);
	});

	it('时序图：参与者沿 X 排开、消息向下弯出弧线', () => {
		const sequence = parseMermaid([
			'sequenceDiagram',
			'participant A as 用户',
			'participant B as 系统',
			'A->>B: 登录',
			'B-->>A: 结果',
		].join('\n'));
		const layout = layoutGraph(elementFrom(sequence));
		assert.strictEqual(layout.strategy, 'sequence');
		for (const node of layout.nodes) {
			assert.strictEqual(node.y, 0);
			assert.strictEqual(node.z, 0);
		}
		assert.ok(layout.nodes[0].x < layout.nodes[1].x);
		for (const edge of layout.edges) {
			assert.strictEqual(edge.points.length, 3, '消息应该是二次贝塞尔');
			assert.ok(edge.points[1].y < 0, '弧线应朝 -Y（时间向下）');
		}
		assertFinite(layout);
	});

	it('象限图按 detail 里的 [x,y] 直接落点', () => {
		const quadrant: GraphElement = {
			id: 'q',
			name: '象限',
			kind: 'quadrant',
			language: 'mermaid',
			line: 1,
			source: '',
			nodes: [
				{ id: 'a', label: '低低', detail: ['x 0.2 / y 0.8'] },
				{ id: 'b', label: '高高', detail: ['x 0.8 / y 0.2'] },
			],
			edges: [],
		};
		const layout = layoutGraph(quadrant);
		assert.strictEqual(layout.strategy, 'quadrant');
		const a = layout.nodes.find(node => node.id === 'a')!;
		const b = layout.nodes.find(node => node.id === 'b')!;
		assert.ok(a.x < b.x);
		assert.ok(a.y > b.y);
		assertFinite(layout);
	});

	it('单节点 / 空图有稳定结果', () => {
		const single = layoutGraph({
			id: 's', name: '单节点', kind: 'flowchart', language: 'mermaid', line: 1, source: '',
			nodes: [{ id: 'A', label: 'A' }], edges: [],
		});
		assert.strictEqual(single.strategy, 'single');
		assert.strictEqual(single.nodes.length, 1);
		const empty = layoutGraph({
			id: 'e', name: '空', kind: 'flowchart', language: 'mermaid', line: 1, source: '',
			nodes: [], edges: [],
		});
		assert.strictEqual(empty.strategy, 'empty');
		assert.strictEqual(empty.nodes.length, 0);
		assert.strictEqual(empty.bounds.radius, 1);
	});

	it('多个互不相连的分量并排摆放，不会重叠成一团', () => {
		const flow = parseMermaid([
			'flowchart TD',
			'A --> B',
			'C --> D',
		].join('\n'));
		const layout = layoutGraph(elementFrom(flow));
		assert.strictEqual(layout.nodes.length, 4);
		const a = layout.nodes.find(node => node.id === 'A')!;
		const c = layout.nodes.find(node => node.id === 'C')!;
		assert.ok(Math.abs(a.x - c.x) > a.radius + c.radius, '两个分量的根节点应拉开距离');
		assertFinite(layout);
	});

	it('象限图的 [x,y] 语义与输入顺序无关', () => {
		const forward = parseMermaid('quadrantChart\n A: [0.1, 0.9]\n B: [0.9, 0.1]');
		const reversed: GraphElement = {
			...elementFrom(forward, 'q'),
			nodes: [...forward.nodes].reverse(),
		};
		const first = layoutGraph(elementFrom(forward, 'q'));
		const second = layoutGraph(reversed);
		assert.strictEqual(first.strategy, 'quadrant');
		assert.strictEqual(second.strategy, 'quadrant');
		const position = (layout: GraphLayout, label: string) => layout.nodes.find(node => node.label === label)!;
		const a1 = position(first, 'A');
		const b1 = position(first, 'B');
		const a2 = position(second, 'A');
		const b2 = position(second, 'B');
		assert.ok(a1.x < b1.x && a1.y > b1.y, 'A 应该在左上、B 在右下');
		assert.ok(a2.x < b2.x && a2.y > b2.y, '节点顺序颠倒后象限位置不能跟着颠倒');
		assertFinite(first);
		assertFinite(second);
	});

	it('600 节点上限内的大图布局是有限且自洽的', () => {
		const lines = ['flowchart TD'];
		for (let index = 0; index < 700; index += 1) {
			lines.push(`N${index} --> N${index + 1}`);
		}
		const parsed = parseMermaid(lines.join('\n'));
		const layout = layoutGraph(elementFrom(parsed, 'big'));
		assert.strictEqual(layout.nodes.length, 600);
		assert.ok(layout.edges.length <= 600);
		assertFinite(layout);
		const ids = new Set(layout.nodes.map(node => node.id));
		assert.ok(layout.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
	});

	it('合并图保留两侧节点，同名节点只出现一次', () => {
		const markdown = [
			'```mermaid',
			'flowchart TD',
			'A[开始] --> B[处理]',
			'B --> C[结束]',
			'```',
			'```mermaid',
			'flowchart LR',
			'X[开始] --> Y[审核]',
			'Y --> Z[结束]',
			'```',
		].join('\n');
		const [left, right] = extractGraphElements(markdown);
		assert.ok(left && right);
		const merged = mergeElements(left, right);
		assert.strictEqual(merged.element.nodes.length, 4);
		const layout = layoutGraph(merged.element, { spacing: 1.2 });
		assert.strictEqual(layout.nodes.length, 4);
		assert.strictEqual(layout.edges.length, 4);
		assertFinite(layout);
	});

	it('节点注释会原样带到布局结果，供前端悬停 tooltip 使用', () => {
		const graph = parseAsciiTree([
			'root   # 根注释',
			'└── child   # 子节点注释',
		].join('\n'));
		const layout = layoutGraph(elementFrom(graph));
		assert.strictEqual(layout.nodes.find(node => node.id === 'a0')?.comment, '根注释');
		assert.strictEqual(layout.nodes.find(node => node.id === 'a1')?.comment, '子节点注释');
	});

	it('显式算法可覆盖自动选择，非法值回落到 auto', () => {
		assert.strictEqual(layoutGraph(asciiElement, { algorithm: 'radial' }).strategy, 'tree');
		assert.strictEqual(layoutGraph(asciiElement, { algorithm: 'radial' }).algorithm, 'radial');
		assert.strictEqual(layoutGraph(asciiElement, { algorithm: 'layered' }).strategy, 'layered');
		assert.strictEqual(layoutGraph(asciiElement, { algorithm: 'force' }).strategy, 'force');
		const invalid = layoutGraph(asciiElement, { algorithm: 'nope' as never });
		assert.strictEqual(invalid.algorithm, 'auto');
		assert.strictEqual(invalid.strategy, 'tree');
	});

	it('时序图 / 象限图保留用户选择但使用语义布局', () => {
		const sequence = parseMermaid([
			'sequenceDiagram',
			'A->>B: 登录',
		].join('\n'));
		const sequenceLayout = layoutGraph(elementFrom(sequence), { algorithm: 'compact' });
		assert.strictEqual(sequenceLayout.strategy, 'sequence');
		assert.strictEqual(sequenceLayout.algorithm, 'compact');
		const quadrant: GraphElement = {
			id: 'q', name: '象限', kind: 'quadrant', language: 'mermaid', line: 1, source: '',
			nodes: [
				{ id: 'a', label: 'A', detail: ['x 0.2 / y 0.8'] },
				{ id: 'b', label: 'B', detail: ['x 0.8 / y 0.2'] },
			],
			edges: [],
		};
		const quadrantLayout = layoutGraph(quadrant, { algorithm: 'louvain' });
		assert.strictEqual(quadrantLayout.strategy, 'quadrant');
		assert.strictEqual(quadrantLayout.algorithm, 'louvain');
	});

	it('紧凑分层：同层共面铺满圆盘、气泡不重叠、边更长比径向树短', () => {
		const nodes: GraphNode[] = [{ id: 'root', label: 'root' }];
		const edges: GraphEdge[] = [];
		for (let branch = 0; branch < 8; branch += 1) {
			const branchId = `b${branch}`;
			nodes.push({ id: branchId, label: `分支 ${branch}` });
			edges.push({ source: 'root', target: branchId });
			for (let child = 0; child < 6; child += 1) {
				const childId = `${branchId}_c${child}`;
				nodes.push({ id: childId, label: `子项 ${branch}-${child}` });
				edges.push({ source: branchId, target: childId });
				for (let leaf = 0; leaf < 3; leaf += 1) {
					const leafId = `${childId}_l${leaf}`;
					nodes.push({ id: leafId, label: `叶子 ${leaf}` });
					edges.push({ source: childId, target: leafId });
				}
			}
		}
		const element: GraphElement = {
			id: 'compact', name: '紧凑', kind: 'ascii-tree', language: 'ascii-tree',
			line: 1, source: '', nodes, edges,
		};
		const auto = layoutGraph(element);
		const compact = layoutGraph(element, { algorithm: 'compact' });
		assert.strictEqual(compact.strategy, 'compact');
		assert.strictEqual(compact.nodes.length, 201);

		// 同层节点共享主轴坐标（这里 TB，主轴是 Y）。
		const layers = new Map<string, GraphLayout['nodes']>();
		for (const node of compact.nodes) {
			const key = node.y.toFixed(4);
			layers.set(key, [...(layers.get(key) ?? []), node]);
		}
		assert.strictEqual(layers.size, 4, '根 / 分支 / 子项 / 叶子应当四层共面');

		for (const list of layers.values()) {
			for (let left = 0; left < list.length; left += 1) {
				for (let right = left + 1; right < list.length; right += 1) {
					const a = list[left];
					const b = list[right];
					const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
					assert.ok(distance >= a.radius + b.radius - 1e-6, `同层气泡 ${a.id} / ${b.id} 不应重叠`);
				}
			}
		}

		const edgeLength = (layout: GraphLayout): number => layout.edges.reduce((sum, edge) => {
			const source = layout.nodes.find(node => node.id === edge.source)!;
			const target = layout.nodes.find(node => node.id === edge.target)!;
			return sum + Math.hypot(source.x - target.x, source.y - target.y, source.z - target.z);
		}, 0);
		assert.ok(edgeLength(compact) < edgeLength(auto), '紧凑分层的数据流总长度应短于径向环');

		const deepest = Math.min(...compact.nodes.map(node => node.y));
		const compactRadius = Math.max(...compact.nodes
			.filter(node => Math.abs(node.y - deepest) < 1e-6)
			.map(node => Math.hypot(node.x, node.z)));
		const autoDeepest = Math.min(...auto.nodes.map(node => node.y));
		const autoRadius = Math.max(...auto.nodes
			.filter(node => Math.abs(node.y - autoDeepest) < 1e-6)
			.map(node => Math.hypot(node.x, node.z)));
		assert.ok(compactRadius < autoRadius, '最深一层的平面占用半径必须小于外圈径向树');
		assert.ok(compactRadius < 40, '201 个节点的层不应散到直径上百的圆环上');
	});

	it('Louvain 壳内 FR-3D：社区成团、全局气泡不重叠、结果确定', () => {
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];
		const clique = (prefix: string): void => {
			for (let index = 0; index < 12; index += 1) {
				nodes.push({ id: `${prefix}${index}`, label: `${prefix}${index}` });
			}
			for (let left = 0; left < 12; left += 1) {
				for (let right = left + 1; right < 12; right += 1) {
					edges.push({ source: `${prefix}${left}`, target: `${prefix}${right}` });
				}
			}
		};
		clique('A');
		clique('B');
		edges.push({ source: 'A0', target: 'B0' });
		const element: GraphElement = {
			id: 'louvain', name: '社区', kind: 'flowchart', language: 'mermaid',
			line: 1, source: '', nodes, edges,
		};
		const first = layoutGraph(element, { algorithm: 'louvain' });
		const second = layoutGraph(element, { algorithm: 'louvain' });
		assert.deepStrictEqual(first, second, '同一张图的 Louvain 布局必须完全一致');
		assert.strictEqual(first.strategy, 'louvain');
		assert.strictEqual(first.algorithm, 'louvain');
		assertFinite(first);

		for (let left = 0; left < first.nodes.length; left += 1) {
			for (let right = left + 1; right < first.nodes.length; right += 1) {
				const a = first.nodes[left];
				const b = first.nodes[right];
				const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
				assert.ok(distance >= a.radius + b.radius - 1e-6, `Louvain 气泡 ${a.id} / ${b.id} 不应重叠`);
			}
		}

		const centroid = (prefix: string) => {
			const list = first.nodes.filter(node => node.id.startsWith(prefix));
			return {
				x: list.reduce((sum, node) => sum + node.x, 0) / list.length,
				y: list.reduce((sum, node) => sum + node.y, 0) / list.length,
				z: list.reduce((sum, node) => sum + node.z, 0) / list.length,
			};
		};
		const a = centroid('A');
		const b = centroid('B');
		const between = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const spread = (prefix: string, center: { x: number; y: number; z: number }): number => {
			const list = first.nodes.filter(node => node.id.startsWith(prefix));
			return list.reduce((sum, node) => sum + Math.hypot(node.x - center.x, node.y - center.y, node.z - center.z), 0) / list.length;
		};
		assert.ok(between > spread('A', a), '两个 Louvain 社区的中心距离应大于簇内平均半径');
		assert.ok(between > spread('B', b));
	});

	describe('void 悬空占位', () => {
		const danglingFlow = () => elementFrom(parseMermaid([
			'flowchart LR',
			'void_node["void"] -->|"输入 a"| IN[输入]',
			'OUT[输出] -->|"输出 b"| void_node',
		].join('\n')), 'dangling');

		it('void 占位不画气泡，两个方向的流都变成悬空边且箭头保持原方向', () => {
			const layout = layoutGraph(danglingFlow());
			assert.strictEqual(layout.nodes.length, 2);
			assert.ok(!layout.nodes.some(node => node.id === 'void_node'), 'void 占位不应该出现在节点列表里');
			assert.strictEqual(layout.edges.length, 2);
			assert.strictEqual(layout.danglingEdgeCount, 2);
			assert.deepStrictEqual(elementSizeInfo(danglingFlow()), {
				nodeCount: 2,
				edgeCount: 2,
				danglingEdgeCount: 2,
			}, '下拉框计数必须与绘制时的有效节点数一致');
			assertFinite(layout);

			const inbound = layout.edges.find(edge => edge.source === 'void_node')!;
			const outbound = layout.edges.find(edge => edge.target === 'void_node')!;
			assert.ok(inbound && outbound);
			const inNode = layout.nodes.find(node => node.id === 'IN')!;
			const outNode = layout.nodes.find(node => node.id === 'OUT')!;

			// void → 真实节点：箭头端（points 末端）必须落在真实节点球心。
			assert.deepStrictEqual(inbound.points[1], { x: inNode.x, y: inNode.y, z: inNode.z });
			// 真实节点 → void：起点仍是真实节点球心，箭头落在悬空端。
			assert.deepStrictEqual(outbound.points[0], { x: outNode.x, y: outNode.y, z: outNode.z });

			const tipDistance = (points: typeof inbound.points, node: typeof inNode): number => {
				const tip = points[1].x === node.x && points[1].y === node.y && points[1].z === node.z
					? points[0]
					: points[1];
				return Math.hypot(tip.x - node.x, tip.y - node.y, tip.z - node.z);
			};
			const inboundLength = tipDistance(inbound.points, inNode);
			const outboundLength = tipDistance(outbound.points, outNode);
			assert.ok(inboundLength > inNode.radius, '悬空端必须在气泡外');
			assert.ok(outboundLength > outNode.radius, '悬空端必须在气泡外');
			assert.ok(inboundLength < inNode.radius + 8, `悬空长度不能过长（实际 ${inboundLength.toFixed(2)}）`);
			assert.ok(outboundLength < outNode.radius + 8, `悬空长度不能过长（实际 ${outboundLength.toFixed(2)}）`);
			assert.ok(inbound.arrow === 'arrow' && outbound.arrow === 'arrow', '箭头语义要保留');
		});

		it('同一节点上的多条悬空流按角度散开、长度适中且布局确定', () => {
			const lines = ['flowchart TD'];
			for (let index = 0; index < 8; index += 1) {
				lines.push(`void_node["void"] -->|"流 ${index}"| HUB[中心]`);
			}
			const element = elementFrom(parseMermaid(lines.join('\n')), 'spread');
			const first = layoutGraph(element);
			const second = layoutGraph(element);
			assert.deepStrictEqual(first, second, '同一张图的悬空布局必须完全一致');
			assert.strictEqual(first.nodes.length, 1);
			assert.strictEqual(first.danglingEdgeCount, 8);
			assert.strictEqual(first.edges.length, 8);

			const hub = first.nodes[0];
			const vectors = first.edges.map(edge => {
				// 全部是 void → HUB，起点是悬空端、终点是球心。
				const tip = edge.points[0];
				const base = edge.points[1];
				const length = Math.hypot(tip.x - base.x, tip.y - base.y, tip.z - base.z);
				assert.ok(length > hub.radius, '每条悬空边的悬空端都要在气泡外');
				return {
					x: (tip.x - base.x) / length,
					y: (tip.y - base.y) / length,
					z: (tip.z - base.z) / length,
					length,
				};
			});
			let maxDot = -1;
			for (let left = 0; left < vectors.length; left += 1) {
				for (let right = left + 1; right < vectors.length; right += 1) {
					const a = vectors[left];
					const b = vectors[right];
					maxDot = Math.max(maxDot, a.x * b.x + a.y * b.y + a.z * b.z);
				}
			}
			assert.ok(maxDot < 0.88, `悬空方向必须散开，不能挤成一束（最大夹角余弦 ${maxDot.toFixed(3)}）`);
			const lengths = vectors.map(vector => vector.length);
			assert.ok(Math.max(...lengths) / Math.min(...lengths) < 2.2, '悬空长度不能忽长忽短');
		});

		it('孤立或纯 void 互连的节点保留；ASCII 树里的 void 不做悬空解释', () => {
			const lone: GraphElement = {
				id: 'lone', name: '孤立 void', kind: 'flowchart', language: 'mermaid', line: 1, source: '',
				nodes: [{ id: 'void1', label: 'void' }, { id: 'A', label: 'A' }],
				edges: [],
			};
			const loneLayout = layoutGraph(lone);
			assert.strictEqual(loneLayout.nodes.length, 2, '没有真实邻居的 void 节点不应该被移除');
			assert.strictEqual(loneLayout.danglingEdgeCount, 0);

			const ascii = parseAsciiTree(['void', '└── child'].join('\n'));
			const asciiLayout = layoutGraph(elementFrom(ascii, 'ascii-void'));
			assert.strictEqual(asciiLayout.nodes.length, 2, 'ASCII 树的 void 只是一个普通名称');
			assert.strictEqual(asciiLayout.danglingEdgeCount, 0);
		});

		it('时序图里的 void 参与者同样转为悬空消息', () => {
			const sequence = parseMermaid([
				'sequenceDiagram',
				'participant P as 处理',
				'participant PV as void',
				'PV->>P: 入',
				'P->>PV: 出',
			].join('\n'));
			const layout = layoutGraph(elementFrom(sequence));
			assert.strictEqual(layout.nodes.length, 1);
			assert.strictEqual(layout.nodes[0].label, '处理');
			assert.strictEqual(layout.danglingEdgeCount, 2);
			assert.strictEqual(layout.edges.length, 2);
			assertFinite(layout);
		});

		it('合并图两侧的 void 会合并成一个占位，各自的流仍悬空到本侧节点', () => {
			const left = parseMermaid([
				'flowchart LR',
				'void_node["void"] -->|"L1"| A[甲]',
				'A -->|"L2"| void_node',
			].join('\n'));
			const right = parseMermaid([
				'flowchart LR',
				'void_node["void"] -->|"R1"| B[乙]',
			].join('\n'));
			const merged = mergeElements(elementFrom(left, 'L'), elementFrom(right, 'R'));
			assert.strictEqual(merged.mergedNodeCount, 1, '两侧的 void 节点按名称合并');
			const layout = layoutGraph(merged.element);
			assert.strictEqual(layout.nodes.length, 2);
			assert.ok(!layout.nodes.some(node => node.label.toLowerCase() === 'void'));
			assert.strictEqual(layout.danglingEdgeCount, 3);
			assert.strictEqual(layout.edges.length, 3);
			assertFinite(layout);
		});
	});

	describe('互斥布局', () => {
		const bothSides = () => mergedFrom(
			['flowchart TD', 'L[左根] --> S[融合]', 'L --> LL[左叶]'].join('\n'),
			['flowchart TD', 'R[右根] --> S[融合]', 'R --> RR[右叶]'].join('\n'),
		);
		const oneSided = () => mergedFrom(
			['flowchart LR', 'L[登录页] --> A[鉴权服务]', 'A --> U[用户库]'].join('\n'),
			['flowchart LR', 'L[登录页] --> A[鉴权服务]', 'A --> R[风控服务]', 'R --> U[用户库]'].join('\n'),
		);

		function assertCoresAtPoles(layout: GraphLayout): void {
			assert.ok(layout.mutex, '互斥布局必须给出 mutex 诊断信息');
			const left = nodeById(layout, layout.mutex.leftCoreId);
			const right = nodeById(layout, layout.mutex.rightCoreId);
			assert.ok(left.x < 0, `左侧核心应在 X 负方向（实际 ${left.x}）`);
			assert.ok(right.x > 0, `右侧核心应在 X 正方向（实际 ${right.x}）`);
			const distance = Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z);
			assert.ok(Math.abs(distance - layout.mutex.separation) < 1e-9, 'mutex.separation 必须等于两个核心的实际距离');
			const fusion = layout.nodes.filter(node => node.origin === 'both');
			for (const node of fusion) {
				assert.ok(node.x > left.x + 1e-9 && node.x < right.x - 1e-9,
					`融合节点「${node.label}」必须夹在两个核心之间（x=${node.x.toFixed(2)}）`);
			}
			const leftExclusive = layout.nodes.filter(node => node.origin === 'left');
			const rightExclusive = layout.nodes.filter(node => node.origin === 'right');
			for (const a of leftExclusive) {
				for (const b of rightExclusive) {
					assert.ok(a.x < b.x, `左独占「${a.label}」必须在右独占「${b.label}」左侧`);
				}
			}
		}

		it('互斥紧凑分层：左右核心分居两端，融合节点留中间且结果确定', () => {
			const layout = layoutGraph(bothSides(), { algorithm: 'compact-mutex' });
			assert.strictEqual(layout.strategy, 'compact-mutex');
			assert.strictEqual(layout.algorithm, 'compact-mutex');
			assert.ok(layout.mutex);
			assert.strictEqual(layout.mutex.leftCoreId, 'L');
			assert.strictEqual(layout.mutex.rightCoreId, 'r:R');
			assert.strictEqual(layout.mutex.leftCoreLabel, '左根');
			assert.strictEqual(layout.mutex.rightCoreLabel, '右根');
			assert.strictEqual(layout.mutex.fusionNodeCount, 1);
			assert.strictEqual(layout.mutex.leftHasExclusive, true);
			assert.strictEqual(layout.mutex.rightHasExclusive, true);
			assertCoresAtPoles(layout);
			assert.strictEqual(nodeById(layout, 'S').origin, 'both', '布局结果必须保留 origin');
			assert.deepStrictEqual(layoutGraph(bothSides(), { algorithm: 'compact-mutex' }), layout,
				'同一张合并图的互斥紧凑布局必须完全一致');
			assertFinite(layout);
		});

		it('互斥 3D 力导向：同样把两侧核心拉到两极，融合节点仍在中间', () => {
			const layout = layoutGraph(bothSides(), { algorithm: 'force-mutex' });
			assert.strictEqual(layout.strategy, 'force-mutex');
			assert.ok(layout.mutex);
			assertCoresAtPoles(layout);
			const left = nodeById(layout, layout.mutex.leftCoreId);
			const right = nodeById(layout, layout.mutex.rightCoreId);
			const leftSpread = Math.max(...layout.nodes
				.filter(node => node.origin === 'left')
				.map(node => Math.hypot(node.x - left.x, node.y - left.y, node.z - left.z)));
			const rightSpread = Math.max(...layout.nodes
				.filter(node => node.origin === 'right')
				.map(node => Math.hypot(node.x - right.x, node.y - right.y, node.z - right.z)));
			assert.ok(layout.mutex.separation > leftSpread * 2, '两个核心的距离应远大于左侧簇内半径');
			assert.ok(layout.mutex.separation > rightSpread * 2, '两个核心的距离应远大于右侧簇内半径');
			assertFinite(layout);
		});

		it('一侧没有独占节点时，用融合节点当锚点并把它整体移到一端', () => {
			const layout = layoutGraph(oneSided(), { algorithm: 'compact-mutex' });
			assert.strictEqual(layout.strategy, 'compact-mutex');
			assert.ok(layout.mutex);
			assert.strictEqual(layout.mutex.leftHasExclusive, false);
			assert.strictEqual(layout.mutex.rightHasExclusive, true);
			assert.strictEqual(layout.mutex.leftCoreLabel, '登录页');
			assert.strictEqual(layout.mutex.rightCoreLabel, '风控服务');
			const left = nodeById(layout, layout.mutex.leftCoreId);
			const right = nodeById(layout, layout.mutex.rightCoreId);
			assert.ok(left.x < right.x, '左侧（融合）核心仍应在屏幕左边');
			assert.ok(layout.mutex.separation > 4, `核心距离应明显拉开（实际 ${layout.mutex.separation.toFixed(2)}）`);
			const fusion = layout.nodes.filter(node => node.origin === 'both');
			assert.strictEqual(fusion.length, 3, '三个同名节点都是融合节点');
			for (const node of fusion) {
				assert.ok(node.x < right.x, `融合节点「${node.label}」不应越过右侧互斥根`);
			}
			assertFinite(layout);
		});

		it('单图或两侧完全相同的图退回基础布局，不产生假互斥', () => {
			const single = layoutGraph(asciiElement, { algorithm: 'compact-mutex' });
			assert.strictEqual(single.strategy, 'compact', '没有 origin 元数据时退回紧凑分层');
			assert.strictEqual(single.algorithm, 'compact-mutex', '用户选择仍保留在 algorithm 字段');
			assert.strictEqual(single.mutex, undefined);

			const identical = mergedFrom(
				['flowchart TD', 'A[甲] --> B[乙]'].join('\n'),
				['flowchart TD', 'A[甲] --> B[乙]'].join('\n'),
			);
			assert.ok(identical.nodes.every(node => node.origin === 'both'));
			const layout = layoutGraph(identical, { algorithm: 'force-mutex' });
			assert.strictEqual(layout.strategy, 'force');
			assert.strictEqual(layout.mutex, undefined, '两张完全相同的图没有互斥内容');
		});

		it('时序图 / 象限图仍使用语义布局，互斥算法不改变它们', () => {
			const sequence = parseMermaid('sequenceDiagram\n A->>B: 登录');
			const sequenceLayout = layoutGraph(elementFrom(sequence), { algorithm: 'force-mutex' });
			assert.strictEqual(sequenceLayout.strategy, 'sequence');
			assert.strictEqual(sequenceLayout.algorithm, 'force-mutex');
			assert.strictEqual(sequenceLayout.mutex, undefined);
		});
	});
});
