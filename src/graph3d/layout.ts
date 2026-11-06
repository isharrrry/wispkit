import {
	displayWidth,
	type GraphEdge,
	type GraphElement,
	type GraphNode,
	type GraphNodeImage,
	type NodeOrigin,
} from './types';

/**
 * 3D 布局：不沿用 Mermaid 的 2D 布局，而是按拓扑自己决定怎么在空间里「长」出来。
 *
 *   - 树 / 思维导图 / ASCII 树 → 径向分层树：根在中心，越深越往外、越往下；
 *     每一层的环半径按该层节点数与最大半径自适应，节点多时环自动撑大。
 *   - DAG / 流程图 / 状态图 / 类图 / Git 图 → 分层圆环：层沿主轴（TB/LR…）排开，
 *     同层节点按父节点重心排序后均匀铺在垂直平面上的圆环里。
 *   - 有环的流程图：先做强连通分量缩点，环内节点同层铺在圆环上，上下游仍分层。
 *   - 类图 / ER 等关系型有环图 → 确定性 3D 力导向。
 *   - 时序图 → 参与者沿 X 轴排开，消息按时间顺序向 -Y 方向弯出弧线。
 *   - 象限图 → 按 [x, y] 直接落在平面上。
 *   - 紧凑分层（工具栏可选）→ 每层铺满圆盘 + 层内「边最短 / 球不重叠」松弛。
 *   - Louvain 壳内 FR-3D（工具栏可选）→ Louvain 社区树 → 按节点数分配球壳体积
 *     → 递归摆子壳 → 最内层社区壳内跑 3D FR。
 *   - 互斥紧凑分层 / 互斥 3D 力导向（工具栏可选）→ 先按对应基础算法排好
 *     （合并图来自 `mergeElements`，节点带 origin），再把左右两侧的核心节点
 *     沿同一条轴推到布局两端，融合节点留在中间，用于一眼看出两张图共享了
 *     什么、各自独有什么。
 *   - 名称恰好是 `void` 的节点（Mermaid 导出里表示「对侧未创建 / 无对端」的
 *     占位）不画气泡；与它相连的流变成从真实节点伸向空处的「悬空边」：
 *     方向绕开已有连线和附近气泡、长度取在常规边距附近，多条悬空边按角度
 *     散开，避免挤在同一个位置。
 *
 * 所有随机性都来自节点 id 的哈希，因此同一张图每次布局完全一致（便于测试）。
 */

export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/**
 * 工具栏里可选的布局算法。
 *
 * - `auto`：按图拓扑自动选（原有行为）；
 * - `compact`：紧凑分层——同一层的节点铺满一个平面圆盘而不是排在外圈，
 *   层内做「边长度最短 + 圆球不重叠」的约束松弛，解决层越深、外圈越散、
 *   中间一大片空白的问题；
 * - `louvain`：Louvain 分层 → 盒配额（按节点数分配壳体积）→ 壳内 FR-3D；
 * - `radial` / `layered` / `force`：显式指定原有的径向树 / 分层环 / 力导向；
 * - `compact-mutex` / `force-mutex`：在紧凑分层 / 3D 力导向的基础上，对合并图
 *   做「互斥」分离——左右两侧各自的核心节点沿同一条轴被推到布局两端，
 *   两侧同名合并出来的融合节点留在中间。没有 origin 元数据（单图）时
 *   自动退回对应的基础算法。
 *
 * 时序图与象限图始终使用其语义布局，显式算法对它们不生效。
 */
export type LayoutAlgorithm =
	| 'auto'
	| 'compact'
	| 'compact-mutex'
	| 'louvain'
	| 'radial'
	| 'layered'
	| 'force'
	| 'force-mutex';

export interface LayoutOptions {
	/** 用户可拖的间隔倍率，0.25–3；1 为默认。 */
	readonly spacing?: number;
	/** 布局算法；不传或非法值按 `auto`。 */
	readonly algorithm?: LayoutAlgorithm;
}

export interface LaidOutNode {
	readonly id: string;
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly radius: number;
	readonly shape?: string;
	readonly group?: string;
	readonly detail?: readonly string[];
	/** 条目注释；3D 里悬停气泡时用 tooltip 显示。 */
	readonly comment?: string;
	/** 气泡里要显示的图片；有值时前端不画文字。 */
	readonly image?: GraphNodeImage;
	/** 合并图里的来源；单图没有这个字段。 */
	readonly origin?: NodeOrigin;
}

/** 「互斥」布局实际生效后的诊断信息，前端状态行与自检钩子会用到。 */
export interface MutexLayoutInfo {
	/** 左侧锚点核心节点。 */
	readonly leftCoreId: string;
	readonly leftCoreLabel: string;
	/** 右侧锚点核心节点。 */
	readonly rightCoreId: string;
	readonly rightCoreLabel: string;
	/** 两个核心在最终布局里的距离（沿分离轴正好是两极间距）。 */
	readonly separation: number;
	/** 两侧同名合并出来的融合节点数。 */
	readonly fusionNodeCount: number;
	/** 左侧有没有独占节点；没有时左侧锚点落在融合节点上。 */
	readonly leftHasExclusive: boolean;
	readonly rightHasExclusive: boolean;
}

export interface LaidOutEdge {
	/** 原始边下标；用于稳定排序与调试。 */
	readonly index: number;
	readonly source: string;
	readonly target: string;
	readonly label?: string;
	readonly dashed?: boolean;
	readonly arrow?: string;
	/** 2 个点 = 直线；3 个点 = 二次贝塞尔；更多 = Catmull-Rom。 */
	readonly points: readonly Vec3[];
	/**
	 * 悬空边：另一端是 `void` 占位节点，没有真实气泡。
	 * 前端据此把数据流名称放到远离真实节点的一侧，避免文字压住气泡。
	 */
	readonly dangling?: boolean;
}

export interface LayoutBounds {
	readonly minX: number;
	readonly minY: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly maxZ: number;
	readonly center: Vec3;
	readonly radius: number;
}

export type LayoutStrategy =
	| 'empty'
	| 'single'
	| 'tree'
	| 'layered'
	| 'force'
	| 'sequence'
	| 'quadrant'
	| 'compact'
	| 'louvain'
	| 'compact-mutex'
	| 'force-mutex';

export interface GraphLayout {
	readonly strategy: LayoutStrategy;
	/** 请求的算法（时序图 / 象限图会覆盖 strategy，但这里保留用户选择）。 */
	readonly algorithm: LayoutAlgorithm;
	readonly nodes: readonly LaidOutNode[];
	readonly edges: readonly LaidOutEdge[];
	readonly bounds: LayoutBounds;
	readonly spacing: number;
	/** 只有「互斥」布局真正生效时才有；退回基础算法时为空。 */
	readonly mutex?: MutexLayoutInfo;
	/**
	 * 悬空边（一侧是 `void` 占位节点）的数量。悬空边已经算进 `edges`，
	 * 前端状态行用它提示「其中多少条没有对端」。
	 */
	readonly danglingEdgeCount: number;
}

interface Metrics {
	readonly maxRadius: number;
	readonly avgRadius: number;
	/** 已乘过 spacing 的基础间距。 */
	readonly baseGap: number;
}

const TWO_PI = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_SPACING = 1;
const MIN_SPACING = 0.25;
const MAX_SPACING = 3;
const LAYOUT_ALGORITHMS: readonly LayoutAlgorithm[] = [
	'auto',
	'compact',
	'compact-mutex',
	'louvain',
	'radial',
	'layered',
	'force',
	'force-mutex',
];

function normalizeAlgorithm(value: unknown): LayoutAlgorithm {
	return typeof value === 'string' && (LAYOUT_ALGORITHMS as readonly string[]).includes(value)
		? value as LayoutAlgorithm
		: 'auto';
}

export function nodeRadius(label: string, detail?: readonly string[]): number {
	const width = displayWidth(label);
	const detailLines = Math.min(detail?.length ?? 0, 3);
	return 0.62 + Math.min(width, 48) * 0.028 + detailLines * 0.08;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function hashText(text: string): number {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/** 0..1 的确定性伪随机。 */
function seededUnit(id: string, salt: string): number {
	return (hashText(`${id}:${salt}`) % 100000) / 100000;
}

function sortedUniqueNodes(nodes: readonly GraphNode[]): GraphNode[] {
	const seen = new Set<string>();
	const result: GraphNode[] = [];
	for (const node of nodes) {
		if (!node.id || seen.has(node.id)) {
			continue;
		}
		seen.add(node.id);
		result.push(node);
	}
	return result;
}

function validEdges(edges: readonly GraphEdge[], nodeIds: Set<string>): GraphEdge[] {
	return edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function computeMetrics(nodes: readonly GraphNode[], spacing: number): Metrics {
	const radii = nodes.map(node => nodeRadius(node.label, node.detail));
	return {
		maxRadius: radii.length > 0 ? Math.max(...radii) : 1,
		avgRadius: radii.length > 0 ? radii.reduce((sum, value) => sum + value, 0) / radii.length : 1,
		baseGap: Math.max(1.05, (radii.length > 0 ? Math.max(...radii) : 1) * 2.15 + 1.35) * spacing,
	};
}

// ── 弱连通分量 ────────────────────────────────────────────────────────────

interface Component {
	readonly nodeIds: string[];
	readonly edges: readonly GraphEdge[];
}

function weakComponents(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Component[] {
	const adjacency = new Map<string, Set<string>>();
	for (const node of nodes) {
		adjacency.set(node.id, new Set());
	}
	for (const edge of edges) {
		adjacency.get(edge.source)?.add(edge.target);
		adjacency.get(edge.target)?.add(edge.source);
	}
	const seen = new Set<string>();
	const components: Component[] = [];
	for (const node of nodes) {
		if (seen.has(node.id)) {
			continue;
		}
		const stack = [node.id];
		seen.add(node.id);
		const ids: string[] = [];
		while (stack.length > 0) {
			const id = stack.pop()!;
			ids.push(id);
			for (const next of adjacency.get(id) ?? []) {
				if (!seen.has(next)) {
					seen.add(next);
					stack.push(next);
				}
			}
		}
		const idSet = new Set(ids);
		components.push({
			nodeIds: ids,
			edges: edges.filter(edge => idSet.has(edge.source) && idSet.has(edge.target)),
		});
	}
	return components;
}

/** 无向森林判定：无环且边数 = 节点数 - 分量数。 */
function isForest(nodes: readonly GraphNode[], edges: readonly GraphEdge[], components: readonly Component[]): boolean {
	if (nodes.length === 0) {
		return false;
	}
	const parent = new Map<string, string>();
	const find = (id: string): string => {
		let current = id;
		while (parent.get(current) !== current) {
			current = parent.get(current) ?? current;
		}
		return current;
	};
	for (const node of nodes) {
		parent.set(node.id, node.id);
	}
	const uniquePairs = new Set<string>();
	for (const edge of edges) {
		if (edge.source === edge.target) {
			return false;
		}
		const key = edge.source < edge.target ? `${edge.source}\u0000${edge.target}` : `${edge.target}\u0000${edge.source}`;
		// 同一对节点出现第二条边（无论同向还是反向）就不是严格意义的树了；
		// 交给力导向，避免把 A⇄B 画成父子。
		if (uniquePairs.has(key)) {
			return false;
		}
		uniquePairs.add(key);
		const left = find(edge.source);
		const right = find(edge.target);
		if (left === right) {
			return false;
		}
		parent.set(left, right);
	}
	return uniquePairs.size === nodes.length - components.length;
}

function isDag(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): boolean {
	const indegree = new Map<string, number>();
	for (const node of nodes) {
		indegree.set(node.id, 0);
	}
	for (const edge of edges) {
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
	}
	const queue = [...indegree.entries()].filter(([, value]) => value === 0).map(([id]) => id);
	let visited = 0;
	while (queue.length > 0) {
		const id = queue.shift()!;
		visited += 1;
		for (const edge of edges) {
			if (edge.source !== id) {
				continue;
			}
			const next = (indegree.get(edge.target) ?? 0) - 1;
			indegree.set(edge.target, next);
			if (next === 0) {
				queue.push(edge.target);
			}
		}
	}
	return visited === nodes.length;
}

// ── 树布局 ────────────────────────────────────────────────────────────────

interface TreeComponentResult {
	readonly positions: Map<string, Vec3>;
	readonly depths: Map<string, number>;
}

function treeComponent(nodes: readonly GraphNode[], edges: readonly GraphEdge[], metrics: Metrics): TreeComponentResult {
	const order = new Map<string, number>();
	nodes.forEach((node, index) => order.set(node.id, index));
	const adjacency = new Map<string, string[]>();
	const indegree = new Map<string, number>();
	for (const node of nodes) {
		adjacency.set(node.id, []);
		indegree.set(node.id, 0);
	}
	for (const edge of edges) {
		adjacency.get(edge.source)?.push(edge.target);
		adjacency.get(edge.target)?.push(edge.source);
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
	}

	const roots = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0);
	const root = roots.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0] ?? nodes[0];
	const parent = new Map<string, string | undefined>();
	const children = new Map<string, string[]>();
	const depths = new Map<string, number>();
	const visited = new Set<string>();
	const queue: string[] = [root.id];
	visited.add(root.id);
	parent.set(root.id, undefined);
	depths.set(root.id, 0);
	while (queue.length > 0) {
		const id = queue.shift()!;
		for (const next of adjacency.get(id) ?? []) {
			if (visited.has(next)) {
				continue;
			}
			visited.add(next);
			parent.set(next, id);
			depths.set(next, (depths.get(id) ?? 0) + 1);
			const list = children.get(id) ?? [];
			list.push(next);
			children.set(id, list);
			queue.push(next);
		}
	}
	// 兜底：有向图里根可能不是无向连通块的入口（例如边方向反了），
	// 把没访问到的节点按原顺序挂到根上，避免整块消失。
	for (const node of nodes) {
		if (visited.has(node.id)) {
			continue;
		}
		visited.add(node.id);
		parent.set(node.id, root.id);
		depths.set(node.id, 1);
		const list = children.get(root.id) ?? [];
		list.push(node.id);
		children.set(root.id, list);
	}

	const weightCache = new Map<string, number>();
	const weight = (id: string): number => {
		const cached = weightCache.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const kids = children.get(id) ?? [];
		const value = kids.length === 0 ? 1 : kids.reduce((sum, child) => sum + weight(child), 0);
		weightCache.set(id, value);
		return value;
	};

	const angle = new Map<string, number>();
	const assign = (id: string, start: number, end: number): void => {
		angle.set(id, (start + end) / 2);
		const kids = children.get(id) ?? [];
		const total = kids.reduce((sum, child) => sum + weight(child), 0);
		let cursor = start;
		for (const kid of kids) {
			const span = total > 0 ? (end - start) * (weight(kid) / total) : 0;
			assign(kid, cursor, cursor + span);
			cursor += span;
		}
	};
	assign(root.id, -Math.PI / 2, -Math.PI / 2 + TWO_PI);

	const countAtDepth = new Map<number, number>();
	const maxRadiusAtDepth = new Map<number, number>();
	const radiusById = new Map<string, number>();
	for (const node of nodes) {
		const depth = depths.get(node.id) ?? 0;
		countAtDepth.set(depth, (countAtDepth.get(depth) ?? 0) + 1);
		const radius = nodeRadius(node.label, node.detail);
		radiusById.set(node.id, radius);
		maxRadiusAtDepth.set(depth, Math.max(maxRadiusAtDepth.get(depth) ?? 0, radius));
	}
	const maxDepth = Math.max(0, ...countAtDepth.keys());
	const radialStep = metrics.baseGap * 0.78;
	// 同一条链上的父子节点角度相同，只能靠 Y 拉开；间距必须大于两个球的直径，
	// 否则链会叠在一起。
	const verticalGap = Math.max(metrics.baseGap * 0.86, metrics.maxRadius * 2 + metrics.baseGap * 0.35);
	const ringRadius: number[] = [0];
	for (let depth = 1; depth <= maxDepth; depth += 1) {
		const count = countAtDepth.get(depth) ?? 0;
		const maxRadius = maxRadiusAtDepth.get(depth) ?? metrics.maxRadius;
		const circumference = count > 0
			? (count * (2 * maxRadius + metrics.baseGap * 0.55)) / TWO_PI
			: 0;
		const previous = ringRadius[depth - 1] ?? 0;
		const previousMax = maxRadiusAtDepth.get(depth - 1) ?? 0;
		const minimal = previous + Math.max(radialStep * 0.55, previousMax + maxRadius + metrics.baseGap * 0.35);
		ringRadius[depth] = Math.max(depth * radialStep, circumference, minimal);
	}

	const positions = new Map<string, Vec3>();
	for (const node of nodes) {
		const depth = depths.get(node.id) ?? 0;
		if (depth === 0) {
			positions.set(node.id, { x: 0, y: 0, z: 0 });
			continue;
		}
		const radius = ringRadius[depth] ?? radialStep;
		const theta = angle.get(node.id) ?? 0;
		positions.set(node.id, {
			x: radius * Math.cos(theta),
			y: -depth * verticalGap,
			z: radius * Math.sin(theta),
		});
	}
	return { positions, depths };
}

// ── 分层布局 ──────────────────────────────────────────────────────────────

type Direction = 'TB' | 'BT' | 'LR' | 'RL';

/**
 * 强连通分量 + 缩点分层。
 *
 * 流程图里的回边（`B -> D -> E -> B`）不应该让整张图退化成力导向：
 * 把环缩成一个分量、把分量当作一层，环内节点铺在同一层的圆环上，
 * 环外的上下游仍然保持清晰的层级。这就是「按拓扑自适应」的核心。
 */
function stronglyConnectedLayers(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, number> {
	const adjacency = new Map<string, string[]>();
	for (const node of nodes) {
		adjacency.set(node.id, []);
	}
	for (const edge of edges) {
		if (edge.source !== edge.target) {
			adjacency.get(edge.source)?.push(edge.target);
		}
	}
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];
	let counter = 0;
	const connect = (id: string): void => {
		index.set(id, counter);
		low.set(id, counter);
		counter += 1;
		stack.push(id);
		onStack.add(id);
		for (const next of adjacency.get(id) ?? []) {
			if (!index.has(next)) {
				connect(next);
				low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
			} else if (onStack.has(next)) {
				low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0));
			}
		}
		if ((low.get(id) ?? 0) === (index.get(id) ?? 0)) {
			const component: string[] = [];
			for (;;) {
				const current = stack.pop();
				if (current === undefined) {
					break;
				}
				onStack.delete(current);
				component.push(current);
				if (current === id) {
					break;
				}
			}
			components.push(component);
		}
	};
	for (const node of nodes) {
		if (!index.has(node.id)) {
			connect(node.id);
		}
	}

	const componentOf = new Map<string, number>();
	components.forEach((component, componentIndex) => {
		for (const id of component) {
			componentOf.set(id, componentIndex);
		}
	});
	const layerOfComponent = new Array<number>(components.length).fill(0);
	const incoming = new Array<number>(components.length).fill(0);
	const componentEdges = new Set<string>();
	const outgoing = components.map(() => new Set<number>());
	for (const edge of edges) {
		const source = componentOf.get(edge.source);
		const target = componentOf.get(edge.target);
		if (source === undefined || target === undefined || source === target) {
			continue;
		}
		const key = `${source}->${target}`;
		if (componentEdges.has(key)) {
			continue;
		}
		componentEdges.add(key);
		outgoing[source].add(target);
		incoming[target] += 1;
	}
	const queue = components.map((_, componentIndex) => componentIndex).filter(componentIndex => incoming[componentIndex] === 0);
	while (queue.length > 0) {
		const componentIndex = queue.shift()!;
		for (const target of outgoing[componentIndex]) {
			layerOfComponent[target] = Math.max(layerOfComponent[target], layerOfComponent[componentIndex] + 1);
			incoming[target] -= 1;
			if (incoming[target] === 0) {
				queue.push(target);
			}
		}
	}
	const result = new Map<string, number>();
	for (const node of nodes) {
		result.set(node.id, layerOfComponent[componentOf.get(node.id) ?? 0] ?? 0);
	}
	return result;
}

/**
 * 把节点按层号分组，并做「父重心 → 子重心」的交替排序来降低连线交叉。
 * 分层环布局与紧凑分层布局共用。
 */
function groupLayers(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	layer: ReadonlyMap<string, number>,
): Map<number, string[]> {
	const order = new Map<string, number>();
	nodes.forEach((node, index) => order.set(node.id, index));

	const groups = new Map<number, string[]>();
	for (const node of nodes) {
		const value = layer.get(node.id) ?? 0;
		const list = groups.get(value) ?? [];
		list.push(node.id);
		groups.set(value, list);
	}
	for (const list of groups.values()) {
		list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
	}

	const indexInLayer = new Map<string, number>();
	const refreshIndex = (): void => {
		for (const list of groups.values()) {
			list.forEach((id, index) => indexInLayer.set(id, index));
		}
	};
	refreshIndex();
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		const parents = incoming.get(edge.target) ?? [];
		parents.push(edge.source);
		incoming.set(edge.target, parents);
		const children = outgoing.get(edge.source) ?? [];
		children.push(edge.target);
		outgoing.set(edge.source, children);
	}
	for (let pass = 0; pass < 3; pass += 1) {
		const keys = [...groups.keys()].sort((a, b) => a - b);
		for (const key of keys) {
			const list = groups.get(key)!;
			list.sort((a, b) => {
				const score = (id: string): number => {
					const parents = incoming.get(id) ?? [];
					const values = parents.map(parent => indexInLayer.get(parent)).filter((value): value is number => value !== undefined);
					return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : (order.get(id) ?? 0);
				};
				return score(a) - score(b);
			});
			refreshIndex();
		}
		const descending = [...keys].reverse();
		for (const key of descending) {
			const list = groups.get(key)!;
			list.sort((a, b) => {
				const score = (id: string): number => {
					const children = outgoing.get(id) ?? [];
					const values = children.map(child => indexInLayer.get(child)).filter((value): value is number => value !== undefined);
					return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : (order.get(id) ?? 0);
				};
				return score(a) - score(b);
			});
			refreshIndex();
		}
	}
	return groups;
}

function layeredComponent(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	metrics: Metrics,
	direction: Direction,
): Map<string, Vec3> {
	const layer = stronglyConnectedLayers(nodes, edges);
	const groups = groupLayers(nodes, edges, layer);

	const layerGap = metrics.baseGap * 1.22;
	const positions = new Map<string, Vec3>();
	const layerKeys = [...groups.keys()].sort((a, b) => a - b);
	for (const key of layerKeys) {
		const list = groups.get(key)!;
		const radii = list.map(id => {
			const node = nodes.find(item => item.id === id)!;
			return nodeRadius(node.label, node.detail);
		});
		const maxRadius = radii.length > 0 ? Math.max(...radii) : metrics.maxRadius;
		// 圆环在 3D 里会被透视压扁，弦长刚好等于直径时屏幕上仍会重叠；
		// 多留 35% 余量，旋转时也不会互相穿插。
		const ringRadius = list.length > 1
			? (list.length * (2 * maxRadius + metrics.baseGap * 0.5) / TWO_PI) * 1.7
			: 0;
		const offset = key * 0.71;
		list.forEach((id, index) => {
			const angle = offset + (TWO_PI * index) / Math.max(1, list.length);
			const planeX = ringRadius * Math.cos(angle);
			const planeZ = ringRadius * Math.sin(angle);
			if (direction === 'LR' || direction === 'RL') {
				const x = (direction === 'LR' ? 1 : -1) * key * layerGap;
				positions.set(id, { x, y: planeX, z: planeZ });
			} else {
				const y = (direction === 'TB' ? -1 : 1) * key * layerGap;
				positions.set(id, { x: planeX, y, z: planeZ });
			}
		});
	}
	return positions;
}

// ── 紧凑分层布局 ──────────────────────────────────────────────────────────

interface PlanePoint {
	u: number;
	v: number;
}

function planeAxis(direction: Direction): 'x' | 'y' {
	return direction === 'LR' || direction === 'RL' ? 'x' : 'y';
}

function planeToVec3(axisPosition: number, point: PlanePoint, axis: 'x' | 'y'): Vec3 {
	return axis === 'x'
		? { x: axisPosition, y: point.u, z: point.v }
		: { x: point.u, y: axisPosition, z: point.v };
}

function axisPositionOf(layerIndex: number, layerGap: number, direction: Direction): number {
	if (direction === 'TB') {
		return -layerIndex * layerGap;
	}
	if (direction === 'BT') {
		return layerIndex * layerGap;
	}
	return direction === 'LR' ? layerIndex * layerGap : -layerIndex * layerGap;
}

/**
 * 紧凑分层：每一层是一张平面，节点不再只排在外圈，而是在整张圆盘里铺开。
 *
 * 做法：
 *   1. 层号仍按 SCC 缩点的最长路径分层，保持层级语义；
 *   2. 每层先按父节点方位角排序，再按「角度定方向、半径按名次填满圆盘」铺满；
 *   3. 层内做约束松弛：圆球不重叠是硬约束，连到已放好层的边尽量短是软约束，
 *      同时加极弱的向心引力保持紧凑——这就是「平面面积小 + 数据流长度短」；
 *   4. 最后再做纯排斥收尾，保证层内气泡不穿模。
 */
function compactComponent(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	metrics: Metrics,
	direction: Direction,
): Map<string, Vec3> {
	const layer = stronglyConnectedLayers(nodes, edges);
	const groups = groupLayers(nodes, edges, layer);
	const radiusById = new Map<string, number>();
	for (const node of nodes) {
		radiusById.set(node.id, nodeRadius(node.label, node.detail));
	}
	const axis = planeAxis(direction);
	const layerGap = Math.max(metrics.baseGap * 1.05, metrics.maxRadius * 2 + metrics.baseGap * 0.5);
	const ringGap = metrics.baseGap * 0.42;

	const neighbors = new Map<string, Array<{ id: string; layer: number }>>();
	const edgesByLayer = new Map<number, GraphEdge[]>();
	for (const node of nodes) {
		neighbors.set(node.id, []);
	}
	for (const edge of edges) {
		if (edge.source === edge.target) {
			continue;
		}
		const sourceLayer = layer.get(edge.source) ?? 0;
		const targetLayer = layer.get(edge.target) ?? 0;
		neighbors.get(edge.source)?.push({ id: edge.target, layer: targetLayer });
		neighbors.get(edge.target)?.push({ id: edge.source, layer: sourceLayer });
		const sourceList = edgesByLayer.get(sourceLayer) ?? [];
		sourceList.push(edge);
		edgesByLayer.set(sourceLayer, sourceList);
		if (targetLayer !== sourceLayer) {
			const targetList = edgesByLayer.get(targetLayer) ?? [];
			targetList.push(edge);
			edgesByLayer.set(targetLayer, targetList);
		}
	}

	const plane = new Map<string, PlanePoint>();
	const positions = new Map<string, Vec3>();
	const layerKeys = [...groups.keys()].sort((a, b) => a - b);

	for (const layerKey of layerKeys) {
		const ids = groups.get(layerKey)!;
		if (ids.length === 0) {
			continue;
		}
		const count = ids.length;
		let area = 0;
		for (const id of ids) {
			const radius = (radiusById.get(id) ?? 1) + ringGap * 0.5;
			area += radius * radius;
		}
		const largest = Math.max(...ids.map(id => radiusById.get(id) ?? 1));
		const diskRadius = Math.max(largest + ringGap, Math.sqrt(area / 0.62));

		// 初始铺满：方位角来自父节点重心，半径按名次从内到外填充圆盘。
		const entries = ids.map((id, index) => {
			let sumU = 0;
			let sumV = 0;
			let weight = 0;
			for (const neighbor of neighbors.get(id) ?? []) {
				const other = plane.get(neighbor.id);
				if (other && neighbor.layer < layerKey) {
					sumU += other.u;
					sumV += other.v;
					weight += 1;
				}
			}
			const fallback = (TWO_PI * index) / count;
			const angle = weight > 0
				? Math.atan2(sumV / weight, sumU / weight) + (seededUnit(id, 'compact-angle') - 0.5) * 0.18
				: fallback + (seededUnit(id, 'compact-angle') - 0.5) * 0.12;
			return { id, angle, index, radius: radiusById.get(id) ?? 1 };
		});
		entries.sort((a, b) => a.angle - b.angle || a.index - b.index);
		entries.forEach((entry, rank) => {
			const fill = count === 1 ? 0 : Math.sqrt((rank + 0.5) / count);
			const radial = Math.max(0, Math.min(diskRadius - entry.radius, diskRadius * fill));
			plane.set(entry.id, { u: Math.cos(entry.angle) * radial, v: Math.sin(entry.angle) * radial });
		});

		// 层内约束松弛。
		const idsInLayer = new Set(ids);
		const iterations = count > 400 ? 32 : count > 160 ? 48 : count > 60 ? 70 : 96;
		for (let iteration = 0; iteration < iterations; iteration += 1) {
			const displacement = new Map<string, PlanePoint>();
			for (const id of ids) {
				displacement.set(id, { u: 0, v: 0 });
			}

			for (let left = 0; left < count; left += 1) {
				for (let right = left + 1; right < count; right += 1) {
					const leftId = ids[left];
					const rightId = ids[right];
					const a = plane.get(leftId)!;
					const b = plane.get(rightId)!;
					let du = a.u - b.u;
					let dv = a.v - b.v;
					let distance = Math.sqrt(du * du + dv * dv);
					const minimum = (radiusById.get(leftId) ?? 1) + (radiusById.get(rightId) ?? 1) + ringGap;
					if (distance >= minimum) {
						continue;
					}
					if (distance < 0.001) {
						du = seededUnit(leftId + rightId, 'compact-du') - 0.5;
						dv = seededUnit(leftId + rightId, 'compact-dv') - 0.5;
						distance = Math.sqrt(du * du + dv * dv) || 1;
					}
					const push = (minimum - distance) / distance * 0.5;
					const leftDisp = displacement.get(leftId)!;
					const rightDisp = displacement.get(rightId)!;
					leftDisp.u += du * push;
					leftDisp.v += dv * push;
					rightDisp.u -= du * push;
					rightDisp.v -= dv * push;
				}
			}

			for (const edge of edgesByLayer.get(layerKey) ?? []) {
				const sourceIn = idsInLayer.has(edge.source);
				const targetIn = idsInLayer.has(edge.target);
				if (!sourceIn && !targetIn) {
					continue;
				}
				const source = plane.get(edge.source);
				const target = plane.get(edge.target);
				if (sourceIn && targetIn && source && target) {
					const du = target.u - source.u;
					const dv = target.v - source.v;
					const distance = Math.sqrt(du * du + dv * dv) || 0.001;
					const rest = (radiusById.get(edge.source) ?? 1) + (radiusById.get(edge.target) ?? 1) + ringGap;
					const force = ((distance - rest) / distance) * 0.22;
					const sourceDisp = displacement.get(edge.source)!;
					const targetDisp = displacement.get(edge.target)!;
					sourceDisp.u += du * force;
					sourceDisp.v += dv * force;
					targetDisp.u -= du * force;
					targetDisp.v -= dv * force;
				} else if (sourceIn && source && target) {
					const point = displacement.get(edge.source)!;
					point.u += (target.u - source.u) * 0.11;
					point.v += (target.v - source.v) * 0.11;
				} else if (targetIn && source && target) {
					const point = displacement.get(edge.target)!;
					point.u += (source.u - target.u) * 0.11;
					point.v += (source.v - target.v) * 0.11;
				}
			}

			const damping = 0.9 - 0.35 * (iteration / Math.max(1, iterations));
			for (const id of ids) {
				const point = plane.get(id)!;
				const force = displacement.get(id)!;
				point.u += force.u * damping - point.u * 0.0035;
				point.v += force.v * damping - point.v * 0.0035;
				const radius = radiusById.get(id) ?? 1;
				const limit = diskRadius * 1.18 + radius;
				const distance = Math.sqrt(point.u * point.u + point.v * point.v);
				if (distance > limit) {
					point.u = (point.u / distance) * limit;
					point.v = (point.v / distance) * limit;
				}
			}
		}

		// 收尾：纯排斥，确保层内圆球不重叠；一整轮都没有重叠就提前结束。
		for (let pass = 0; pass < 36; pass += 1) {
			let clean = true;
			for (let left = 0; left < count; left += 1) {
				for (let right = left + 1; right < count; right += 1) {
					const leftId = ids[left];
					const rightId = ids[right];
					const a = plane.get(leftId)!;
					const b = plane.get(rightId)!;
					let du = a.u - b.u;
					let dv = a.v - b.v;
					let distance = Math.sqrt(du * du + dv * dv);
					const minimum = (radiusById.get(leftId) ?? 1) + (radiusById.get(rightId) ?? 1) + ringGap;
					if (distance >= minimum) {
						continue;
					}
					clean = false;
					if (distance < 0.001) {
						du = seededUnit(leftId + rightId, 'compact-final-du') - 0.5;
						dv = seededUnit(leftId + rightId, 'compact-final-dv') - 0.5;
						distance = Math.sqrt(du * du + dv * dv) || 1;
					}
					const push = (minimum - distance) / distance * 0.5;
					a.u += du * push;
					a.v += dv * push;
					b.u -= du * push;
					b.v -= dv * push;
				}
			}
			if (clean) {
				break;
			}
		}

		const axisPosition = axisPositionOf(layerKey, layerGap, direction);
		for (const id of ids) {
			const point = plane.get(id)!;
			positions.set(id, planeToVec3(axisPosition, point, axis));
		}
	}
	return positions;
}

// ── 力导向布局 ────────────────────────────────────────────────────────────

function forceComponent(nodes: readonly GraphNode[], edges: readonly GraphEdge[], metrics: Metrics): Map<string, Vec3> {
	const count = nodes.length;
	const points = new Map<string, { x: number; y: number; z: number }>();
	const spread = Math.max(metrics.baseGap * 1.3, Math.sqrt(count) * metrics.baseGap * 0.72);
	const golden = Math.PI * (3 - Math.sqrt(5));
	nodes.forEach((node, index) => {
		const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = golden * index + seededUnit(node.id, 'theta') * 0.35;
		points.set(node.id, {
			x: Math.cos(theta) * ring * spread + (seededUnit(node.id, 'x') - 0.5) * metrics.baseGap * 0.35,
			y: y * spread + (seededUnit(node.id, 'y') - 0.5) * metrics.baseGap * 0.35,
			z: Math.sin(theta) * ring * spread + (seededUnit(node.id, 'z') - 0.5) * metrics.baseGap * 0.35,
		});
	});

	const pairs: Array<[string, string]> = [];
	for (let left = 0; left < nodes.length; left += 1) {
		for (let right = left + 1; right < nodes.length; right += 1) {
			pairs.push([nodes[left].id, nodes[right].id]);
		}
	}
	const radiusById = new Map<string, number>();
	for (const node of nodes) {
		radiusById.set(node.id, nodeRadius(node.label, node.detail));
	}
	const k = metrics.baseGap * 1.18;
	const iterations = count > 320 ? 55 : count > 180 ? 90 : count > 90 ? 130 : 170;
	let temperature = k * 1.15;
	const displacement = new Map<string, { x: number; y: number; z: number }>();
	for (const node of nodes) {
		displacement.set(node.id, { x: 0, y: 0, z: 0 });
	}
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		for (const value of displacement.values()) {
			value.x = 0;
			value.y = 0;
			value.z = 0;
		}
		for (const [leftId, rightId] of pairs) {
			const left = points.get(leftId)!;
			const right = points.get(rightId)!;
			let dx = left.x - right.x;
			let dy = left.y - right.y;
			let dz = left.z - right.z;
			let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (distance < 0.001) {
				dx = seededUnit(leftId + rightId, 'dx') - 0.5;
				dy = seededUnit(leftId + rightId, 'dy') - 0.5;
				dz = seededUnit(leftId + rightId, 'dz') - 0.5;
				distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			}
			const force = (k * k) / distance;
			const fx = (dx / distance) * force;
			const fy = (dy / distance) * force;
			const fz = (dz / distance) * force;
			const leftDisp = displacement.get(leftId)!;
			const rightDisp = displacement.get(rightId)!;
			leftDisp.x += fx; leftDisp.y += fy; leftDisp.z += fz;
			rightDisp.x -= fx; rightDisp.y -= fy; rightDisp.z -= fz;
		}
		for (const edge of edges) {
			if (edge.source === edge.target) {
				continue;
			}
			const source = points.get(edge.source)!;
			const target = points.get(edge.target)!;
			const dx = source.x - target.x;
			const dy = source.y - target.y;
			const dz = source.z - target.z;
			const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
			const force = (distance * distance) / k;
			const fx = (dx / distance) * force;
			const fy = (dy / distance) * force;
			const fz = (dz / distance) * force;
			const sourceDisp = displacement.get(edge.source)!;
			const targetDisp = displacement.get(edge.target)!;
			sourceDisp.x -= fx; sourceDisp.y -= fy; sourceDisp.z -= fz;
			targetDisp.x += fx; targetDisp.y += fy; targetDisp.z += fz;
		}
		for (const node of nodes) {
			const point = points.get(node.id)!;
			const disp = displacement.get(node.id)!;
			// 向心引力，避免孤立节点被推到无穷远
			disp.x -= point.x * 0.012;
			disp.y -= point.y * 0.012;
			disp.z -= point.z * 0.012;
			const length = Math.sqrt(disp.x * disp.x + disp.y * disp.y + disp.z * disp.z);
			if (length > 0.0001) {
				const scale = Math.min(length, temperature) / length;
				point.x += disp.x * scale;
				point.y += disp.y * scale;
				point.z += disp.z * scale;
			}
		}
		temperature = k * 1.15 * (1 - (iteration + 1) / iterations);
	}

	// 消除重叠：半径不同，圆球不能穿模。
	for (let pass = 0; pass < 36; pass += 1) {
		for (const [leftId, rightId] of pairs) {
			const left = points.get(leftId)!;
			const right = points.get(rightId)!;
			const minimum = (radiusById.get(leftId) ?? 1) + (radiusById.get(rightId) ?? 1) + metrics.baseGap * 0.08;
			let dx = left.x - right.x;
			let dy = left.y - right.y;
			let dz = left.z - right.z;
			let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (distance < 0.001) {
				dx = seededUnit(leftId + rightId, 'px') - 0.5;
				dy = seededUnit(leftId + rightId, 'py') - 0.5;
				dz = seededUnit(leftId + rightId, 'pz') - 0.5;
				distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			}
			if (distance < minimum) {
				const push = (minimum - distance) / distance * 0.5;
				left.x += dx * push;
				left.y += dy * push;
				left.z += dz * push;
				right.x -= dx * push;
				right.y -= dy * push;
				right.z -= dz * push;
			}
		}
	}

	// 居中
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (const point of points.values()) {
		cx += point.x;
		cy += point.y;
		cz += point.z;
	}
	cx /= count;
	cy /= count;
	cz /= count;
	const result = new Map<string, Vec3>();
	for (const [id, point] of points) {
		result.set(id, { x: point.x - cx, y: point.y - cy, z: point.z - cz });
	}
	return result;
}

// ── Louvain 分层 → 盒配额 → 壳内 FR-3D ───────────────────────────────────

interface LouvainLevel {
	/** 本层每个 key 所属的社区号；0 层 key 是节点 id，更高层 key 是 `L{上一层}:{社区号}`。 */
	readonly assignment: ReadonlyMap<string, number>;
	readonly communityCount: number;
	readonly keys: readonly string[];
}

interface WeightedGraph {
	readonly keys: readonly string[];
	readonly adjacency: ReadonlyMap<string, ReadonlyMap<string, number>>;
	readonly selfLoop: ReadonlyMap<string, number>;
	readonly degree: ReadonlyMap<string, number>;
	readonly totalDegree: number;
}

function weightedGraph(
	keys: readonly string[],
	adjacency: Map<string, Map<string, number>>,
	selfLoop: Map<string, number>,
): WeightedGraph {
	const degree = new Map<string, number>();
	let totalDegree = 0;
	for (const key of keys) {
		let value = (selfLoop.get(key) ?? 0) * 2;
		for (const weight of adjacency.get(key)?.values() ?? []) {
			value += weight;
		}
		degree.set(key, value);
		totalDegree += value;
	}
	return { keys, adjacency, selfLoop, degree, totalDegree };
}

function buildWeightedGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): WeightedGraph {
	const keys = nodes.map(node => node.id);
	const idSet = new Set(keys);
	const adjacency = new Map<string, Map<string, number>>();
	const selfLoop = new Map<string, number>();
	for (const key of keys) {
		adjacency.set(key, new Map());
		selfLoop.set(key, 0);
	}
	for (const edge of edges) {
		if (!idSet.has(edge.source) || !idSet.has(edge.target)) {
			continue;
		}
		if (edge.source === edge.target) {
			selfLoop.set(edge.source, (selfLoop.get(edge.source) ?? 0) + 1);
			continue;
		}
		adjacency.get(edge.source)!.set(edge.target, (adjacency.get(edge.source)!.get(edge.target) ?? 0) + 1);
		adjacency.get(edge.target)!.set(edge.source, (adjacency.get(edge.target)!.get(edge.source) ?? 0) + 1);
	}
	return weightedGraph(keys, adjacency, selfLoop);
}

/**
 * Louvain 第一阶段：局部移动最大化模块度。
 *
 * 移动节点 i 到社区 C 的模块度增益正比于 `k_i,in(C) - tot(C)·k_i / (2m)`。
 * 节点按输入顺序扫描、平分时选社区号小的，保证同一张图每次结果一致。
 */
function louvainLocalMoving(graph: WeightedGraph): Map<string, number> {
	const community = new Map<string, number>();
	graph.keys.forEach((key, index) => community.set(key, index));
	const totals = graph.keys.map(key => graph.degree.get(key) ?? 0);
	const twoM = graph.totalDegree;
	for (let pass = 0; pass < 16; pass += 1) {
		let moved = false;
		for (const key of graph.keys) {
			const current = community.get(key)!;
			const degree = graph.degree.get(key) ?? 0;
			totals[current] -= degree;
			const neighborWeights = new Map<number, number>();
			for (const [neighbor, weight] of graph.adjacency.get(key) ?? []) {
				if (neighbor === key) {
					continue;
				}
				const candidate = community.get(neighbor);
				if (candidate === undefined) {
					continue;
				}
				neighborWeights.set(candidate, (neighborWeights.get(candidate) ?? 0) + weight);
			}
			let best = current;
			let bestScore = (neighborWeights.get(current) ?? 0)
				- (twoM > 0 ? (totals[current] * degree) / twoM : 0);
			for (const [candidate, weight] of neighborWeights) {
				if (candidate === current) {
					continue;
				}
				const score = weight - (twoM > 0 ? (totals[candidate] * degree) / twoM : 0);
				if (score > bestScore + 1e-12
					|| (Math.abs(score - bestScore) <= 1e-12 && candidate < best)) {
					best = candidate;
					bestScore = score;
				}
			}
			community.set(key, best);
			totals[best] += degree;
			if (best !== current) {
				moved = true;
			}
		}
		if (!moved) {
			break;
		}
	}
	// 按首次出现顺序重编号，得到稳定的 0..n-1 社区号。
	const remap = new Map<number, number>();
	const normalized = new Map<string, number>();
	for (const key of graph.keys) {
		const raw = community.get(key)!;
		let next = remap.get(raw);
		if (next === undefined) {
			next = remap.size;
			remap.set(raw, next);
		}
		normalized.set(key, next);
	}
	return normalized;
}

/** Louvain 第二阶段：把社区聚合成超节点，社区内部边变成自环。 */
function aggregateWeightedGraph(
	graph: WeightedGraph,
	assignment: ReadonlyMap<string, number>,
	prefix: string,
): WeightedGraph {
	const pairWeights = new Map<string, number>();
	const selfLoop = new Map<number, number>();
	for (const [key, adjacency] of graph.adjacency) {
		const source = assignment.get(key);
		if (source === undefined) {
			continue;
		}
		selfLoop.set(source, (selfLoop.get(source) ?? 0) + (graph.selfLoop.get(key) ?? 0));
		for (const [neighbor, weight] of adjacency) {
			const target = assignment.get(neighbor);
			if (target === undefined) {
				continue;
			}
			if (source === target) {
				// 无向邻接表里每条边被记两次，聚合到自环时只算一半。
				selfLoop.set(source, (selfLoop.get(source) ?? 0) + weight / 2);
			} else {
				const low = Math.min(source, target);
				const high = Math.max(source, target);
				const pairKey = `${low}|${high}`;
				pairWeights.set(pairKey, (pairWeights.get(pairKey) ?? 0) + weight / 2);
			}
		}
	}
	let count = 0;
	for (const value of assignment.values()) {
		count = Math.max(count, value + 1);
	}
	const keys = Array.from({ length: count }, (_, index) => `${prefix}${index}`);
	const adjacency = new Map<string, Map<string, number>>();
	for (const key of keys) {
		adjacency.set(key, new Map());
	}
	for (const [pairKey, weight] of pairWeights) {
		const [lowText, highText] = pairKey.split('|');
		const low = Number(lowText);
		const high = Number(highText);
		adjacency.get(keys[low])!.set(keys[high], (adjacency.get(keys[low])!.get(keys[high]) ?? 0) + weight);
		adjacency.get(keys[high])!.set(keys[low], (adjacency.get(keys[high])!.get(keys[low]) ?? 0) + weight);
	}
	const loops = new Map<string, number>();
	for (const key of keys) {
		loops.set(key, 0);
	}
	for (const [communityIndex, value] of selfLoop) {
		loops.set(keys[communityIndex], value);
	}
	return weightedGraph(keys, adjacency, loops);
}

function louvainLevels(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): LouvainLevel[] {
	let graph = buildWeightedGraph(nodes, edges);
	const levels: LouvainLevel[] = [];
	for (let level = 0; level < 4; level += 1) {
		if (graph.keys.length <= 1) {
			break;
		}
		const assignment = louvainLocalMoving(graph);
		const communityCount = new Set(assignment.values()).size;
		// 没有合并就别再加一层，否则只是给每个节点套一个单例社区。
		if (communityCount >= graph.keys.length) {
			break;
		}
		levels.push({ assignment, communityCount, keys: graph.keys });
		if (communityCount <= 1) {
			break;
		}
		graph = aggregateWeightedGraph(graph, assignment, `L${level}:`);
	}
	return levels;
}

interface CommunityNode {
	readonly key: string;
	readonly nodeIds: readonly string[];
	readonly children: CommunityNode[];
	radius: number;
	center: Vec3;
}

function communityNode(key: string, children: CommunityNode[]): CommunityNode {
	return {
		key,
		nodeIds: children.flatMap(child => child.nodeIds),
		children,
		radius: 0,
		center: { x: 0, y: 0, z: 0 },
	};
}

function leafCommunity(id: string): CommunityNode {
	return { key: `node:${id}`, nodeIds: [id], children: [], radius: 0, center: { x: 0, y: 0, z: 0 } };
}

function buildCommunityTree(nodes: readonly GraphNode[], levels: readonly LouvainLevel[]): CommunityNode {
	const levelMaps: Array<Map<number, CommunityNode>> = [];
	const zeroGroups = new Map<number, string[]>();
	if (levels.length > 0) {
		for (const [key, community] of levels[0].assignment) {
			const list = zeroGroups.get(community) ?? [];
			list.push(key);
			zeroGroups.set(community, list);
		}
	} else {
		nodes.forEach((node, index) => zeroGroups.set(index, [node.id]));
	}
	const zeroMap = new Map<number, CommunityNode>();
	for (const [community, ids] of zeroGroups) {
		zeroMap.set(community, communityNode(`L0:${community}`, ids.map(leafCommunity)));
	}
	levelMaps.push(zeroMap);

	for (let level = 1; level < levels.length; level += 1) {
		const groups = new Map<number, string[]>();
		for (const [key, community] of levels[level].assignment) {
			const list = groups.get(community) ?? [];
			list.push(key);
			groups.set(community, list);
		}
		const map = new Map<number, CommunityNode>();
		for (const [community, keys] of groups) {
			const children: CommunityNode[] = [];
			for (const key of keys) {
				// 更高层的 key 形如 `L{上一层}:{社区号}`。
				const match = /^L(\d+):(\d+)$/.exec(key);
				if (!match) {
					continue;
				}
				const previous = levelMaps[Number(match[1])]?.get(Number(match[2]));
				if (previous) {
					children.push(previous);
				}
			}
			map.set(community, communityNode(`L${level}:${community}`, children));
		}
		levelMaps.push(map);
	}

	const top = levels.length > 0
		? [...levelMaps[levelMaps.length - 1].values()]
		: [...levelMaps[0].values()];
	return communityNode('Lroot', top);
}

/**
 * 盒配额：按「节点胞元体积之和」给每个社区分配球形壳的体积，
 * 再把壳半径换算成 `cbrt` 尺度；父壳至少能按 1.24 的装填余量容下所有子壳。
 */
function assignCommunityRadii(root: CommunityNode, nodeById: ReadonlyMap<string, GraphNode>, metrics: Metrics): void {
	const gap = metrics.baseGap;
	const visit = (community: CommunityNode): number => {
		if (community.children.length === 0) {
			const node = nodeById.get(community.nodeIds[0]);
			const radius = node ? nodeRadius(node.label, node.detail) : 1;
			community.radius = Math.max(radius * 1.22, gap * 0.08);
			return community.radius;
		}
		let cellVolume = 0;
		for (const id of community.nodeIds) {
			const node = nodeById.get(id);
			const radius = node ? nodeRadius(node.label, node.detail) : 1;
			const cell = radius * 2 + gap * 0.5;
			cellVolume += cell * cell * cell;
		}
		let childVolume = 0;
		for (const child of community.children) {
			const childRadius = visit(child);
			childVolume += childRadius * childRadius * childRadius;
		}
		const quota = 0.62 * Math.cbrt(cellVolume);
		const packed = Math.cbrt(childVolume) * (community.children.length > 1 ? 1.24 : 1.03);
		community.radius = Math.max(quota, packed);
		return community.radius;
	};
	visit(root);
}

function communityLinkWeights(community: CommunityNode, edges: readonly GraphEdge[]): Map<string, number> {
	const childOf = new Map<string, CommunityNode>();
	for (const child of community.children) {
		for (const id of child.nodeIds) {
			childOf.set(id, child);
		}
	}
	const weights = new Map<string, number>();
	for (const edge of edges) {
		const source = childOf.get(edge.source);
		const target = childOf.get(edge.target);
		if (!source || !target || source === target) {
			continue;
		}
		const key = source.key < target.key
			? `${source.key}|${target.key}`
			: `${target.key}|${source.key}`;
		weights.set(key, (weights.get(key) ?? 0) + 1);
	}
	return weights;
}

/** 在父壳内摆放子壳：先按体积从大到小用黄金螺旋铺开，再做「不重叠 + 跨社区边短」的松弛。 */
function placeCommunityChildren(community: CommunityNode, edges: readonly GraphEdge[], metrics: Metrics): void {
	const children = community.children;
	if (children.length === 0) {
		return;
	}
	if (children.length === 1) {
		children[0].center = { ...community.center };
		return;
	}
	const gap = metrics.baseGap * 0.2;
	const order = [...children].sort((a, b) => b.radius - a.radius || a.key.localeCompare(b.key));
	const count = order.length;
	order.forEach((child, index) => {
		const available = Math.max(0.01, community.radius - child.radius - gap);
		const y = 1 - 2 * (index + 0.5) / count;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = GOLDEN_ANGLE * index;
		const radial = available * Math.cbrt((index + 0.5) / count);
		child.center = {
			x: community.center.x + Math.cos(theta) * ring * radial,
			y: community.center.y + y * radial,
			z: community.center.z + Math.sin(theta) * ring * radial,
		};
	});
	const links = communityLinkWeights(community, edges);

	const clampChild = (child: CommunityNode): void => {
		const maxDistance = Math.max(0, community.radius - child.radius);
		const dx = child.center.x - community.center.x;
		const dy = child.center.y - community.center.y;
		const dz = child.center.z - community.center.z;
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (distance > maxDistance && distance > 0.0001) {
			const scale = maxDistance / distance;
			child.center = {
				x: community.center.x + dx * scale,
				y: community.center.y + dy * scale,
				z: community.center.z + dz * scale,
			};
		}
	};

	for (let pass = 0; pass < 90; pass += 1) {
		for (let left = 0; left < count; left += 1) {
			for (let right = left + 1; right < count; right += 1) {
				const a = order[left];
				const b = order[right];
				const minimum = a.radius + b.radius + gap;
				let dx = a.center.x - b.center.x;
				let dy = a.center.y - b.center.y;
				let dz = a.center.z - b.center.z;
				let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				const weight = links.get(a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`) ?? 0;
				if (distance < minimum) {
					if (distance < 0.0001) {
						dx = seededUnit(a.key + b.key, 'louvain-dx') - 0.5;
						dy = seededUnit(a.key + b.key, 'louvain-dy') - 0.5;
						dz = seededUnit(a.key + b.key, 'louvain-dz') - 0.5;
						distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
					}
					const push = (minimum - distance) / distance * 0.5;
					a.center = {
						x: a.center.x + dx * push,
						y: a.center.y + dy * push,
						z: a.center.z + dz * push,
					};
					b.center = {
						x: b.center.x - dx * push,
						y: b.center.y - dy * push,
						z: b.center.z - dz * push,
					};
				} else if (weight > 0 && distance > minimum) {
					// 有跨社区连线的两个壳轻微相吸，缩短全局数据流长度。
					const force = Math.min(0.32, ((distance - minimum) / distance) * 0.012 * Math.min(6, weight));
					a.center = {
						x: a.center.x - dx * force,
						y: a.center.y - dy * force,
						z: a.center.z - dz * force,
					};
					b.center = {
						x: b.center.x + dx * force,
						y: b.center.y + dy * force,
						z: b.center.z + dz * force,
					};
				}
			}
		}
		for (const child of order) {
			clampChild(child);
		}
	}
	// 收尾排斥，确保子壳不重叠。
	for (let pass = 0; pass < 30; pass += 1) {
		for (let left = 0; left < count; left += 1) {
			for (let right = left + 1; right < count; right += 1) {
				const a = order[left];
				const b = order[right];
				const minimum = a.radius + b.radius + gap;
				let dx = a.center.x - b.center.x;
				let dy = a.center.y - b.center.y;
				let dz = a.center.z - b.center.z;
				let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (distance >= minimum) {
					continue;
				}
				if (distance < 0.0001) {
					dx = seededUnit(a.key + b.key, 'louvain-final-dx') - 0.5;
					dy = seededUnit(a.key + b.key, 'louvain-final-dy') - 0.5;
					dz = seededUnit(a.key + b.key, 'louvain-final-dz') - 0.5;
					distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
				}
				const push = (minimum - distance) / distance * 0.5;
				a.center = { x: a.center.x + dx * push, y: a.center.y + dy * push, z: a.center.z + dz * push };
				b.center = { x: b.center.x - dx * push, y: b.center.y - dy * push, z: b.center.z - dz * push };
			}
		}
		for (const child of order) {
			clampChild(child);
		}
	}
}

function clampInsideShell(
	point: { x: number; y: number; z: number },
	center: Vec3,
	radius: number,
	nodeRadiusValue: number,
): void {
	const maxDistance = Math.max(0, radius - nodeRadiusValue);
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	const dz = point.z - center.z;
	const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
	if (distance > maxDistance && distance > 0.0001) {
		const scale = maxDistance / distance;
		point.x = center.x + dx * scale;
		point.y = center.y + dy * scale;
		point.z = center.z + dz * scale;
	}
}

/** 壳内 FR-3D：斥力走 3D 全对，引力只走壳内边，最后把点夹回球壳。 */
function fr3dInShell(
	ids: readonly string[],
	center: Vec3,
	radius: number,
	edges: readonly GraphEdge[],
	radiusById: ReadonlyMap<string, number>,
	metrics: Metrics,
	positions: Map<string, Vec3>,
): void {
	const count = ids.length;
	if (count === 0) {
		return;
	}
	if (count === 1) {
		positions.set(ids[0], { ...center });
		return;
	}
	const idSet = new Set(ids);
	const largest = Math.max(...ids.map(id => radiusById.get(id) ?? 1));
	const spread = Math.max(0.01, radius - largest);
	const points = new Map<string, { x: number; y: number; z: number }>();
	ids.forEach((id, index) => {
		const y = 1 - 2 * (index + 0.5) / count;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = GOLDEN_ANGLE * index;
		const radial = spread * Math.cbrt((index + 0.5) / count);
		points.set(id, {
			x: center.x + Math.cos(theta) * ring * radial,
			y: center.y + y * radial,
			z: center.z + Math.sin(theta) * ring * radial,
		});
	});

	const pairs: Array<[string, string]> = [];
	for (let left = 0; left < count; left += 1) {
		for (let right = left + 1; right < count; right += 1) {
			pairs.push([ids[left], ids[right]]);
		}
	}
	const k = metrics.baseGap * 0.95;
	const iterations = count > 240 ? 40 : count > 90 ? 60 : 90;
	let temperature = k * 1.1;
	const displacement = new Map<string, { x: number; y: number; z: number }>();
	for (const id of ids) {
		displacement.set(id, { x: 0, y: 0, z: 0 });
	}
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		for (const value of displacement.values()) {
			value.x = 0;
			value.y = 0;
			value.z = 0;
		}
		for (const [leftId, rightId] of pairs) {
			const left = points.get(leftId)!;
			const right = points.get(rightId)!;
			let dx = left.x - right.x;
			let dy = left.y - right.y;
			let dz = left.z - right.z;
			let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (distance < 0.0001) {
				dx = seededUnit(leftId + rightId, 'louvain-fr-dx') - 0.5;
				dy = seededUnit(leftId + rightId, 'louvain-fr-dy') - 0.5;
				dz = seededUnit(leftId + rightId, 'louvain-fr-dz') - 0.5;
				distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			}
			const force = (k * k) / distance;
			const leftDisp = displacement.get(leftId)!;
			const rightDisp = displacement.get(rightId)!;
			leftDisp.x += (dx / distance) * force;
			leftDisp.y += (dy / distance) * force;
			leftDisp.z += (dz / distance) * force;
			rightDisp.x -= (dx / distance) * force;
			rightDisp.y -= (dy / distance) * force;
			rightDisp.z -= (dz / distance) * force;
		}
		for (const edge of edges) {
			if (edge.source === edge.target || !idSet.has(edge.source) || !idSet.has(edge.target)) {
				continue;
			}
			const source = points.get(edge.source)!;
			const target = points.get(edge.target)!;
			const dx = source.x - target.x;
			const dy = source.y - target.y;
			const dz = source.z - target.z;
			const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
			const force = (distance * distance) / k;
			const sourceDisp = displacement.get(edge.source)!;
			const targetDisp = displacement.get(edge.target)!;
			sourceDisp.x -= (dx / distance) * force;
			sourceDisp.y -= (dy / distance) * force;
			sourceDisp.z -= (dz / distance) * force;
			targetDisp.x += (dx / distance) * force;
			targetDisp.y += (dy / distance) * force;
			targetDisp.z += (dz / distance) * force;
		}
		for (const id of ids) {
			const point = points.get(id)!;
			const disp = displacement.get(id)!;
			// 向心引力让节点留在壳内，避免被斥力推到壳壁外。
			disp.x -= (point.x - center.x) * 0.02;
			disp.y -= (point.y - center.y) * 0.02;
			disp.z -= (point.z - center.z) * 0.02;
			const length = Math.sqrt(disp.x * disp.x + disp.y * disp.y + disp.z * disp.z);
			if (length > 0.0001) {
				const scale = Math.min(length, temperature) / length;
				point.x += disp.x * scale;
				point.y += disp.y * scale;
				point.z += disp.z * scale;
			}
			clampInsideShell(point, center, radius, radiusById.get(id) ?? 1);
		}
		temperature = k * 1.1 * (1 - (iteration + 1) / iterations);
	}

	// 收尾排斥，保证壳内气泡不重叠。
	for (let pass = 0; pass < 28; pass += 1) {
		for (const [leftId, rightId] of pairs) {
			const left = points.get(leftId)!;
			const right = points.get(rightId)!;
			const minimum = (radiusById.get(leftId) ?? 1) + (radiusById.get(rightId) ?? 1) + metrics.baseGap * 0.2;
			let dx = left.x - right.x;
			let dy = left.y - right.y;
			let dz = left.z - right.z;
			let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (distance >= minimum) {
				continue;
			}
			if (distance < 0.0001) {
				dx = seededUnit(leftId + rightId, 'louvain-final-fr-dx') - 0.5;
				dy = seededUnit(leftId + rightId, 'louvain-final-fr-dy') - 0.5;
				dz = seededUnit(leftId + rightId, 'louvain-final-fr-dz') - 0.5;
				distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			}
			const push = (minimum - distance) / distance * 0.5;
			left.x += dx * push;
			left.y += dy * push;
			left.z += dz * push;
			right.x -= dx * push;
			right.y -= dy * push;
			right.z -= dz * push;
		}
		for (const id of ids) {
			clampInsideShell(points.get(id)!, center, radius, radiusById.get(id) ?? 1);
		}
	}

	for (const id of ids) {
		const point = points.get(id)!;
		positions.set(id, { x: point.x, y: point.y, z: point.z });
	}
}

function layoutCommunityShells(
	community: CommunityNode,
	level: number,
	edges: readonly GraphEdge[],
	radiusById: ReadonlyMap<string, number>,
	metrics: Metrics,
	positions: Map<string, Vec3>,
): void {
	if (community.nodeIds.length === 0) {
		return;
	}
	if (level <= 0 || community.children.length === 0) {
		fr3dInShell(community.nodeIds, community.center, community.radius, edges, radiusById, metrics, positions);
		return;
	}
	placeCommunityChildren(community, edges, metrics);
	for (const child of community.children) {
		layoutCommunityShells(child, level - 1, edges, radiusById, metrics, positions);
	}
}

/**
 * 壳内 FR 之后做一次全局气泡排斥，兜住「子壳体积配额在子社区很少时偏小」
 * 造成的跨壳穿模。只推开真正重叠的气泡，不改变整体社区结构。
 */
function separateAllBubbles(
	nodes: readonly GraphNode[],
	radiusById: ReadonlyMap<string, number>,
	positions: Map<string, Vec3>,
	gap: number,
): void {
	const ids = nodes.map(node => node.id).filter(id => positions.has(id));
	const points = new Map<string, { x: number; y: number; z: number }>();
	for (const id of ids) {
		const point = positions.get(id)!;
		points.set(id, { x: point.x, y: point.y, z: point.z });
	}
	for (let pass = 0; pass < 56; pass += 1) {
		let clean = true;
		for (let left = 0; left < ids.length; left += 1) {
			for (let right = left + 1; right < ids.length; right += 1) {
				const leftId = ids[left];
				const rightId = ids[right];
				const a = points.get(leftId)!;
				const b = points.get(rightId)!;
				const minimum = (radiusById.get(leftId) ?? 1) + (radiusById.get(rightId) ?? 1) + gap;
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let dz = a.z - b.z;
				let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (distance >= minimum) {
					continue;
				}
				clean = false;
				if (distance < 0.0001) {
					dx = seededUnit(leftId + rightId, 'louvain-separate-x') - 0.5;
					dy = seededUnit(leftId + rightId, 'louvain-separate-y') - 0.5;
					dz = seededUnit(leftId + rightId, 'louvain-separate-z') - 0.5;
					distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
				}
				const push = (minimum - distance) / distance * 0.5;
				a.x += dx * push;
				a.y += dy * push;
				a.z += dz * push;
				b.x -= dx * push;
				b.y -= dy * push;
				b.z -= dz * push;
			}
		}
		if (clean) {
			break;
		}
	}
	for (const id of ids) {
		const point = points.get(id)!;
		positions.set(id, { x: point.x, y: point.y, z: point.z });
	}
}

/**
 * 「Louvain 分层 → 盒配额 → 壳内 FR-3D」：
 *   - Louvain 逐层聚合出社区树（最多 4 层）；
 *   - 每个社区按后代节点数分配球形壳体积（盒配额），父壳装下子壳；
 *   - 从根壳向里递归摆子壳，到最内层社区后在壳内跑 FR-3D。
 *
 * 全过程无随机数：初始点用黄金螺旋、平局按节点顺序/社区号，保证可测试。
 */
function louvainComponent(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	metrics: Metrics,
): Map<string, Vec3> {
	const levels = louvainLevels(nodes, edges);
	const root = buildCommunityTree(nodes, levels);
	const nodeById = new Map(nodes.map(node => [node.id, node]));
	const radiusById = new Map<string, number>();
	for (const node of nodes) {
		radiusById.set(node.id, nodeRadius(node.label, node.detail));
	}
	assignCommunityRadii(root, nodeById, metrics);
	const positions = new Map<string, Vec3>();
	layoutCommunityShells(root, levels.length, edges, radiusById, metrics, positions);
	separateAllBubbles(nodes, radiusById, positions, metrics.baseGap * 0.16);
	return positions;
}

// ── 特殊布局 ──────────────────────────────────────────────────────────────

function sequenceLayout(nodes: readonly GraphNode[], metrics: Metrics): Map<string, Vec3> {
	const positions = new Map<string, Vec3>();
	const widths = nodes.map(node => nodeRadius(node.label, node.detail) * 2 + metrics.baseGap * 0.72);
	const total = widths.reduce((sum, value) => sum + value, 0);
	let cursor = -total / 2;
	nodes.forEach((node, index) => {
		const width = widths[index];
		positions.set(node.id, { x: cursor + width / 2, y: 0, z: 0 });
		cursor += width;
	});
	return positions;
}

function quadrantLayout(nodes: readonly GraphNode[], metrics: Metrics): Map<string, Vec3> {
	const positions = new Map<string, Vec3>();
	const scale = metrics.baseGap * Math.max(2.4, Math.sqrt(nodes.length) * 1.05);
	for (const node of nodes) {
		const match = node.detail?.map(item => /x\s*([\d.]+)\s*\/\s*y\s*([\d.]+)/i.exec(item)).find(value => value !== null);
		const x = match ? clamp(Number(match[1]), 0, 1) : seededUnit(node.id, 'qx');
		const y = match ? clamp(Number(match[2]), 0, 1) : seededUnit(node.id, 'qy');
		positions.set(node.id, {
			x: (x - 0.5) * scale,
			y: (y - 0.5) * scale,
			z: (seededUnit(node.id, 'qz') - 0.5) * metrics.baseGap * 0.6,
		});
	}
	return positions;
}

function selfLoopPoints(point: Vec3, radius: number): Vec3[] {
	return [
		{ x: point.x, y: point.y, z: point.z },
		{ x: point.x + radius * 1.3, y: point.y + radius * 0.25, z: point.z },
		{ x: point.x + radius * 0.2, y: point.y + radius * 1.9, z: point.z + radius * 0.7 },
		{ x: point.x - radius * 1.1, y: point.y + radius * 0.4, z: point.z + radius * 0.2 },
		{ x: point.x, y: point.y, z: point.z },
	];
}

function buildEdges(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	positions: ReadonlyMap<string, Vec3>,
	radiusById: ReadonlyMap<string, number>,
): LaidOutEdge[] {
	return edges.map((edge, index) => {
		const source = positions.get(edge.source) ?? { x: 0, y: 0, z: 0 };
		const target = positions.get(edge.target) ?? { x: 0, y: 0, z: 0 };
		const points = edge.source === edge.target
			? selfLoopPoints(source, radiusById.get(edge.source) ?? 1)
			: [source, target];
		return {
			index,
			source: edge.source,
			target: edge.target,
			label: edge.label,
			dashed: edge.dashed,
			arrow: edge.arrow,
			points,
		};
	});
}

// ── 悬空占位节点（void） ──────────────────────────────────────────────────

/**
 * 一条边的某一端是 `void` 占位节点时，布局阶段把它降级成「悬空边」：
 * 真实节点那一端不动，另一端挂在它周围一段固定尺度的空白处。
 */
interface DanglingEdgeSpec {
	readonly edge: GraphEdge;
	/** 非 `void` 的一端（真实节点 id）。 */
	readonly realId: string;
	/** true 表示边的 source 是真实节点（流从真实节点流出）。 */
	readonly realIsSource: boolean;
}

interface DirectionObstacle {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly weight: number;
}

/**
 * Mermaid 导出（如 Drawcode 的模块交联图）把「对侧未创建 / 没有对端」的流
 * 记成标签为 `void` 的占位节点。名称比较只做 trim + 小写，`voided`、`Void`
 * 之外的普通名称不受影响。
 */
function isVoidPlaceholder(node: GraphNode): boolean {
	return node.label.trim().toLowerCase() === 'void';
}

interface VoidAnalysis {
	/** 去掉被悬空处理掉的 void 占位之后的节点。 */
	readonly nodes: readonly GraphNode[];
	/** 两端都是真实节点的普通边。 */
	readonly edges: readonly GraphEdge[];
	readonly dangling: readonly DanglingEdgeSpec[];
}

/**
 * 找出 `void` 占位节点，以及哪些边要降级成悬空边。
 *
 * 只有「一端是 void 占位、另一端是真实节点」的边才算悬空；孤立 void、
 * 纯 void 互连的节点保留原样，避免把用户真的画进去的 `void` 节点吃掉。
 * ASCII 树里的 `void` 可能只是普通的文件名 / 目录名，不做悬空解释。
 */
function analyzeVoidEdges(element: GraphElement): VoidAnalysis {
	const allNodes = sortedUniqueNodes(element.nodes);
	const allNodeIds = new Set(allNodes.map(node => node.id));
	const voidCandidates = element.kind === 'ascii-tree'
		? new Set<string>()
		: new Set(allNodes.filter(node => isVoidPlaceholder(node)).map(node => node.id));
	const dangling: DanglingEdgeSpec[] = [];
	const danglingVoidIds = new Set<string>();
	for (const edge of element.edges) {
		const sourceVoid = voidCandidates.has(edge.source);
		const targetVoid = voidCandidates.has(edge.target);
		if (sourceVoid === targetVoid) {
			continue;
		}
		const realId = sourceVoid ? edge.target : edge.source;
		if (!allNodeIds.has(realId)) {
			continue;
		}
		dangling.push({ edge, realId, realIsSource: !sourceVoid });
		danglingVoidIds.add(sourceVoid ? edge.source : edge.target);
	}
	const nodes = allNodes.filter(node => !danglingVoidIds.has(node.id));
	const nodeIds = new Set(nodes.map(node => node.id));
	return { nodes, edges: validEdges(element.edges, nodeIds), dangling };
}

/** 下拉框 / 状态行用的「有效节点数 / 边数」——void 占位不算节点，悬空边照常算边。 */
export interface ElementSizeInfo {
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly danglingEdgeCount: number;
}

export function elementSizeInfo(element: GraphElement): ElementSizeInfo {
	const analysis = analyzeVoidEdges(element);
	return {
		nodeCount: analysis.nodes.length,
		edgeCount: analysis.edges.length + analysis.dangling.length,
		danglingEdgeCount: analysis.dangling.length,
	};
}

/** 均分球面方向：确定性黄金角螺旋，避免任何随机数。 */
function fibonacciSphereDirections(count: number): Vec3[] {
	const directions: Vec3[] = [];
	for (let index = 0; index < count; index += 1) {
		const y = 1 - (index + 0.5) * 2 / count;
		const radius = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = index * GOLDEN_ANGLE;
		directions.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
	}
	return directions;
}

function directionBetween(from: Vec3, to: Vec3): Vec3 | undefined {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dz = to.z - from.z;
	const length = Math.hypot(dx, dy, dz);
	if (length < 1e-6) {
		return undefined;
	}
	return { x: dx / length, y: dy / length, z: dz / length };
}

/**
 * 把悬空边追加到布局结果。
 *
 * 每条悬空边在真实节点周围挑一个方向：
 *   - 避开已有的真实连线（同向会看成另一条连接）；
 *   - 避开附近其它节点的气泡（戳进别家气泡会像连错边）；
 *   - 同一节点上的多条悬空边互相按角度散开；
 *   - 以「远离全图重心」作为同分时的偏好，让悬空端落在图外侧的空处。
 *
 * 悬空端到球心的距离 = 气泡半径 × 0.9 + 基础间距 × 0.82 × (0.82~1.16)，
 * 即露出气泡后的可见长度约为 **0.67~0.95 个基础间距**：既不会短到看不出是
 * 悬空，也不会长到穿进旁边的图。方向与长度都只依赖输入与 id 哈希，同一张图
 * 重复布局结果完全一致。
 */
function appendDanglingEdges(
	laidNodes: readonly LaidOutNode[],
	edges: readonly LaidOutEdge[],
	specs: readonly DanglingEdgeSpec[],
	metrics: Metrics,
): LaidOutEdge[] {
	if (specs.length === 0 || laidNodes.length === 0) {
		return edges.slice();
	}
	const nodeById = new Map(laidNodes.map(node => [node.id, node]));
	const groups = new Map<string, DanglingEdgeSpec[]>();
	for (const spec of specs) {
		if (!nodeById.has(spec.realId)) {
			continue;
		}
		const list = groups.get(spec.realId);
		if (list) {
			list.push(spec);
		} else {
			groups.set(spec.realId, [spec]);
		}
	}
	if (groups.size === 0) {
		return edges.slice();
	}

	let centerX = 0;
	let centerY = 0;
	let centerZ = 0;
	for (const node of laidNodes) {
		centerX += node.x;
		centerY += node.y;
		centerZ += node.z;
	}
	const graphCenter: Vec3 = {
		x: centerX / laidNodes.length,
		y: centerY / laidNodes.length,
		z: centerZ / laidNodes.length,
	};

	const maxGroupSize = Math.max(...[...groups.values()].map(list => list.length));
	// 方向池随同一节点的悬空边数量增加，保证多流时仍有足够角度可挑。
	const directions = fibonacciSphereDirections(Math.max(36, Math.min(240, maxGroupSize * 16)));
	const result = edges.slice();
	let nextIndex = edges.length;

	for (const [realId, list] of groups) {
		const node = nodeById.get(realId)!;
		const base: Vec3 = { x: zeroSafe(node.x), y: zeroSafe(node.y), z: zeroSafe(node.z) };
		const obstacles: DirectionObstacle[] = [];
		const incident = new Set<string>();
		for (const edge of edges) {
			const otherId = edge.source === realId ? edge.target : edge.target === realId ? edge.source : undefined;
			if (!otherId || incident.has(otherId)) {
				continue;
			}
			const other = nodeById.get(otherId);
			if (!other) {
				continue;
			}
			const direction = directionBetween(base, other);
			if (direction) {
				incident.add(otherId);
				obstacles.push({ ...direction, weight: 2.4 });
			}
		}
		// 附近节点的方向也算「拥挤」：别让悬空端戳进别人的气泡，也别看起来
		// 像连到了那个节点。
		const nearbyDistance = metrics.baseGap * 4;
		for (const other of laidNodes) {
			if (other.id === realId || incident.has(other.id)) {
				continue;
			}
			const distance = Math.hypot(other.x - base.x, other.y - base.y, other.z - base.z);
			if (distance > nearbyDistance || distance < 1e-6) {
				continue;
			}
			const direction = directionBetween(base, other);
			if (direction) {
				const proximity = clamp(1 - distance / nearbyDistance, 0.15, 1);
				obstacles.push({ ...direction, weight: 1.2 * proximity });
			}
		}

		const outward = directionBetween(graphCenter, base);
		const baseScores = directions.map(direction => {
			let penalty = 0;
			for (const obstacle of obstacles) {
				const dot = direction.x * obstacle.x + direction.y * obstacle.y + direction.z * obstacle.z;
				if (dot > 0) {
					penalty += obstacle.weight * Math.pow(dot, 6);
				}
			}
			if (outward) {
				// 轻微偏向外侧；有障碍时这个偏好会让位于避让。
				penalty -= 0.7 * (direction.x * outward.x + direction.y * outward.y + direction.z * outward.z);
			}
			return penalty;
		});

		const chosen: Vec3[] = [];
		for (let ordinal = 0; ordinal < list.length; ordinal += 1) {
			const spec = list[ordinal];
			let bestIndex = 0;
			let bestScore = Number.POSITIVE_INFINITY;
			for (let index = 0; index < directions.length; index += 1) {
				const direction = directions[index];
				let penalty = baseScores[index];
				for (const previous of chosen) {
					const dot = direction.x * previous.x + direction.y * previous.y + direction.z * previous.z;
					if (dot > 0) {
						penalty += 5 * Math.pow(dot, 6);
					}
				}
				if (penalty < bestScore - 1e-9) {
					bestScore = penalty;
					bestIndex = index;
				}
			}
			const direction = directions[bestIndex];
			chosen.push(direction);

			const jitter = 0.82 + seededUnit(
				`${realId}|${spec.edge.source}|${spec.edge.target}|${spec.edge.label ?? ''}|${ordinal}`,
				'dangling-length',
			) * 0.34;
			const visibleLength = Math.max(1.2, metrics.baseGap * 0.82) * jitter;
			const length = node.radius * 0.9 + visibleLength;
			const tip: Vec3 = {
				x: zeroSafe(base.x + direction.x * length),
				y: zeroSafe(base.y + direction.y * length),
				z: zeroSafe(base.z + direction.z * length),
			};
			result.push({
				index: nextIndex,
				source: spec.edge.source,
				target: spec.edge.target,
				label: spec.edge.label,
				dashed: spec.edge.dashed,
				arrow: spec.edge.arrow,
				// 点的顺序跟 source → target 一致，箭头才会保留原来的方向：
				// void → 真实节点时箭头落在真实节点上，真实节点 → void 时箭头
				// 落在悬空端。
				points: spec.realIsSource ? [base, tip] : [tip, base],
				dangling: true,
			});
			nextIndex += 1;
		}
	}
	return result;
}

/** 统一的返回出口：补上悬空边并重算包围球。 */
function finalizeLayout(
	strategy: LayoutStrategy,
	algorithm: LayoutAlgorithm,
	spacing: number,
	nodes: readonly LaidOutNode[],
	edges: readonly LaidOutEdge[],
	dangling: readonly DanglingEdgeSpec[],
	metrics: Metrics,
	mutex?: MutexLayoutInfo,
): GraphLayout {
	const finalEdges = appendDanglingEdges(nodes, edges, dangling, metrics);
	return {
		strategy,
		algorithm,
		nodes,
		edges: finalEdges,
		bounds: boundsOf(nodes, finalEdges),
		spacing,
		mutex,
		danglingEdgeCount: finalEdges.length - edges.length,
	};
}

// ── 组合与包围球 ──────────────────────────────────────────────────────────

function boundsOf(nodes: readonly LaidOutNode[], edges: readonly LaidOutEdge[]): LayoutBounds {
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (const node of nodes) {
		minX = Math.min(minX, node.x - node.radius);
		minY = Math.min(minY, node.y - node.radius);
		minZ = Math.min(minZ, node.z - node.radius);
		maxX = Math.max(maxX, node.x + node.radius);
		maxY = Math.max(maxY, node.y + node.radius);
		maxZ = Math.max(maxZ, node.z + node.radius);
	}
	for (const edge of edges) {
		for (const point of edge.points) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			minZ = Math.min(minZ, point.z);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
			maxZ = Math.max(maxZ, point.z);
		}
	}
	if (!Number.isFinite(minX)) {
		minX = minY = minZ = -1;
		maxX = maxY = maxZ = 1;
	}
	const center = {
		x: (minX + maxX) / 2,
		y: (minY + maxY) / 2,
		z: (minZ + maxZ) / 2,
	};
	let radius = 0;
	for (const node of nodes) {
		radius = Math.max(radius, Math.hypot(node.x - center.x, node.y - center.y, node.z - center.z) + node.radius);
	}
	for (const edge of edges) {
		for (const point of edge.points) {
			radius = Math.max(radius, Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z));
		}
	}
	return { minX, minY, minZ, maxX, maxY, maxZ, center, radius: Math.max(radius, 1) };
}

interface ComponentLayout {
	readonly nodes: readonly LaidOutNode[];
	readonly edges: readonly LaidOutEdge[];
	readonly bounds: LayoutBounds;
}

/** 多个互不相连的分量横向排开，避免它们挤在同一个圆环上。 */
function packComponents(layouts: readonly ComponentLayout[], gap: number): ComponentLayout {
	if (layouts.length <= 1) {
		return layouts[0] ?? { nodes: [], edges: [], bounds: boundsOf([], []) };
	}
	let cursor = 0;
	const nodes: LaidOutNode[] = [];
	const edges: LaidOutEdge[] = [];
	for (const layout of layouts) {
		const shift = cursor - layout.bounds.minX;
		for (const node of layout.nodes) {
			nodes.push({ ...node, x: node.x + shift });
		}
		for (const edge of layout.edges) {
			edges.push({
				...edge,
				points: edge.points.map(point => ({ x: point.x + shift, y: point.y, z: point.z })),
			});
		}
		cursor = layout.bounds.maxX + shift + gap;
	}
	const bounds = boundsOf(nodes, edges);
	const centerShift = bounds.center.x;
	return {
		nodes: nodes.map(node => ({ ...node, x: node.x - centerShift })),
		edges: edges.map(edge => ({
			...edge,
			points: edge.points.map(point => ({ x: point.x - centerShift, y: point.y, z: point.z })),
		})),
		bounds: boundsOf(nodes.map(node => ({ ...node, x: node.x - centerShift })), edges.map(edge => ({
			...edge,
			points: edge.points.map(point => ({ x: point.x - centerShift, y: point.y, z: point.z })),
		}))),
	};
}

// ── 互斥布局（合并图专用） ────────────────────────────────────────────────

interface MutexSide {
	/** 本侧全部节点（独占 + 融合）。 */
	readonly all: readonly GraphNode[];
	/** 只属于本侧的节点。 */
	readonly exclusive: readonly GraphNode[];
	/** 本侧子图的无向邻接与有向入度（用于找「核心」）。 */
	readonly adjacency: ReadonlyMap<string, readonly string[]>;
	readonly indegree: ReadonlyMap<string, number>;
}

function buildMutexSide(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	side: 'left' | 'right',
): MutexSide {
	const isMember = (node: GraphNode): boolean =>
		node.origin === side || node.origin === 'both';
	const all = nodes.filter(isMember);
	const memberIds = new Set(all.map(node => node.id));
	const adjacency = new Map<string, string[]>();
	const indegree = new Map<string, number>();
	for (const node of all) {
		adjacency.set(node.id, []);
		indegree.set(node.id, 0);
	}
	for (const edge of edges) {
		if (!memberIds.has(edge.source) || !memberIds.has(edge.target) || edge.source === edge.target) {
			continue;
		}
		adjacency.get(edge.source)?.push(edge.target);
		adjacency.get(edge.target)?.push(edge.source);
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
	}
	return {
		all,
		exclusive: all.filter(node => node.origin === side),
		adjacency,
		indegree,
	};
}

function reachableCount(start: string, adjacency: ReadonlyMap<string, readonly string[]>): number {
	const seen = new Set<string>([start]);
	const stack = [start];
	while (stack.length > 0) {
		const id = stack.pop()!;
		for (const next of adjacency.get(id) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				stack.push(next);
			}
		}
	}
	return seen.size;
}

/**
 * 选一侧的「核心」：优先从本侧独占节点里选，没有独占节点时退回融合节点。
 * 评分 = 入度为 0（根）巨大加分 + 可达节点数 + 度数；同分按节点原顺序，
 * 保证同一张图每次结果一致。
 */
function pickMutexCore(
	side: MutexSide,
	order: ReadonlyMap<string, number>,
): GraphNode | undefined {
	const pool = side.exclusive.length > 0 ? side.exclusive : side.all;
	let best: GraphNode | undefined;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const node of pool) {
		const rootBonus = (side.indegree.get(node.id) ?? 0) === 0 ? 1_000_000 : 0;
		const reach = reachableCount(node.id, side.adjacency);
		const degree = side.adjacency.get(node.id)?.length ?? 0;
		const score = rootBonus + reach * 1000 + degree * 10;
		if (score > bestScore
			|| (score === bestScore && best !== undefined
				&& (order.get(node.id) ?? 0) < (order.get(best.id) ?? 0))) {
			best = node;
			bestScore = score;
		}
	}
	return best;
}

/** 一组节点沿 axis 朝「另一侧」方向的最大伸出量；没有该方向的点时为 0。 */
function inwardExtent(
	group: readonly GraphNode[],
	core: Vec3,
	axis: Vec3,
	sign: 1 | -1,
	positions: ReadonlyMap<string, Vec3>,
): number {
	let extent = 0;
	for (const node of group) {
		const point = positions.get(node.id);
		if (!point) {
			continue;
		}
		const projection = (point.x - core.x) * axis.x
			+ (point.y - core.y) * axis.y
			+ (point.z - core.z) * axis.z;
		extent = Math.max(extent, projection * sign);
	}
	return extent;
}

interface MutexApplication {
	readonly positions: Map<string, Vec3>;
	readonly info: MutexLayoutInfo;
}

/**
 * 合并图的「互斥」分离：
 *
 *   1. 左右两侧各选一个核心节点（优先本侧独占节点，其次融合节点）；
 *   2. 分离轴固定为世界 X（默认视角下的屏幕左右方向）；
 *   3. 两侧都有独占节点时，把两组独占节点沿 X 推到两极：左核心落在
 *      中心 - pole、右核心落在中心 + pole，pole 取包围半径 + 两侧朝内的
 *      最大伸出量 + 余量，因此两侧的球不会跨过中间打架；
 *   4. 两侧都有独占节点时，融合节点原地不动，正好夹在两个核心之间；
 *      某一侧没有独占节点时（一侧是另一侧的超集），融合节点组原地不动，
 *      只把另一侧的独占组推到融合组外侧——这一侧的核心本身就是融合节点，
 *      再搬动整张公共图只会把场景拉长、气泡缩成一团。
 *
 * 结果：两个核心分别落在布局的左右两端，两侧都有独占节点时融合节点严格
 * 夹在中间，一眼能看出「共享了什么、各自独有什么」。没有 origin 元数据
 * （单图或旧数据）时返回 undefined，由调用方退回基础布局。
 */
function applyMutexSeparation(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	positions: ReadonlyMap<string, Vec3>,
	bounds: LayoutBounds,
	metrics: Metrics,
): MutexApplication | undefined {
	if (nodes.length < 2 || !nodes.some(node => node.origin !== undefined)) {
		return undefined;
	}
	const leftSide = buildMutexSide(nodes, edges, 'left');
	const rightSide = buildMutexSide(nodes, edges, 'right');
	// 两张图完全相同（没有独占节点）时没有「互斥」可言，退回基础布局。
	if (leftSide.exclusive.length === 0 && rightSide.exclusive.length === 0) {
		return undefined;
	}
	const order = new Map(nodes.map((node, index) => [node.id, index]));
	const coreLeft = pickMutexCore(leftSide, order);
	const coreRight = pickMutexCore(rightSide, order);
	if (!coreLeft || !coreRight || coreLeft.id === coreRight.id) {
		return undefined;
	}
	const startLeft = positions.get(coreLeft.id);
	const startRight = positions.get(coreRight.id);
	if (!startLeft || !startRight) {
		return undefined;
	}

	// 一侧没有独占节点时，整个融合节点组就是这一侧的锚点组。
	const leftGroup = leftSide.exclusive.length > 0 ? leftSide.exclusive : leftSide.all;
	const rightGroup = rightSide.exclusive.length > 0 ? rightSide.exclusive : rightSide.all;
	const leftIds = new Set(leftGroup.map(node => node.id));
	const rightIds = new Set(rightGroup.map(node => node.id));

	// 分离轴固定为世界 X：默认相机大致从 +Z 看过来，X 就是屏幕左右方向，
	// 因此「左侧图」的核心总在屏幕左边、「右侧图」的核心总在右边，不会
	// 因为基础布局恰好把两侧摆反了而让人误读。
	const axis = { x: 1, y: 0, z: 0 };

	const gap = metrics.baseGap;
	let shiftLeft = 0;
	let shiftRight = 0;
	const leftHasExclusive = leftSide.exclusive.length > 0;
	const rightHasExclusive = rightSide.exclusive.length > 0;
	if (leftHasExclusive && rightHasExclusive) {
		// 两侧都有独占节点：两侧独占组推到包围球外的两极，融合节点留在中间。
		const extentLeft = inwardExtent(leftGroup, startLeft, axis, 1, positions);
		const extentRight = inwardExtent(rightGroup, startRight, axis, -1, positions);
		const pole = bounds.radius + Math.max(extentLeft, extentRight) + gap * 1.5;
		const centerX = bounds.center.x;
		shiftLeft = centerX - pole - startLeft.x;
		shiftRight = centerX + pole - startRight.x;
	} else if (rightHasExclusive) {
		// 左侧是右侧的子集：融合节点组原地不动，只把右侧独占组推到融合组右边。
		// 若把整张公共图也搬到极点，场景会被拉长好几倍，气泡在屏幕上缩成一团。
		const sharedXs = nodes
			.filter(node => node.origin === 'both')
			.map(node => positions.get(node.id)?.x)
			.filter((value): value is number => value !== undefined);
		const maxSharedX = sharedXs.length > 0 ? Math.max(...sharedXs) : startLeft.x;
		const inwardRight = inwardExtent(rightGroup, startRight, axis, -1, positions);
		const target = Math.max(maxSharedX + gap * 2 + inwardRight, startLeft.x + gap * 4);
		shiftRight = target - startRight.x;
	} else {
		// 右侧是左侧的子集：对称处理，只把左侧独占组推到融合组左边。
		const sharedXs = nodes
			.filter(node => node.origin === 'both')
			.map(node => positions.get(node.id)?.x)
			.filter((value): value is number => value !== undefined);
		const minSharedX = sharedXs.length > 0 ? Math.min(...sharedXs) : startRight.x;
		const inwardLeft = inwardExtent(leftGroup, startLeft, axis, 1, positions);
		const target = Math.min(minSharedX - gap * 2 - inwardLeft, startRight.x - gap * 4);
		shiftLeft = target - startLeft.x;
	}

	const shiftedPreview = new Map<string, Vec3>();
	for (const node of nodes) {
		const point = positions.get(node.id);
		if (!point) {
			continue;
		}
		let shift = 0;
		if (leftIds.has(node.id)) {
			shift = shiftLeft;
		} else if (rightIds.has(node.id)) {
			shift = shiftRight;
		}
		shiftedPreview.set(node.id, {
			x: point.x + axis.x * shift,
			y: point.y + axis.y * shift,
			z: point.z + axis.z * shift,
		});
	}
	// 把两个核心的中点平移到 X=0：左右核心关于屏幕中心对称，
	// 屏幕左右与「左图 / 右图」一致。整张图做刚体平移，不改变相对关系。
	const previewLeft = shiftedPreview.get(coreLeft.id) ?? startLeft;
	const previewRight = shiftedPreview.get(coreRight.id) ?? startRight;
	const midX = (previewLeft.x + previewRight.x) / 2;
	const shifted = new Map<string, Vec3>();
	for (const [id, point] of shiftedPreview) {
		shifted.set(id, { x: point.x - midX, y: point.y, z: point.z });
	}

	const finalLeft = shifted.get(coreLeft.id)
		?? { x: previewLeft.x - midX, y: previewLeft.y, z: previewLeft.z };
	const finalRight = shifted.get(coreRight.id)
		?? { x: previewRight.x - midX, y: previewRight.y, z: previewRight.z };
	const separation = Math.hypot(
		finalRight.x - finalLeft.x,
		finalRight.y - finalLeft.y,
		finalRight.z - finalLeft.z,
	);
	return {
		positions: shifted,
		info: {
			leftCoreId: coreLeft.id,
			leftCoreLabel: coreLeft.label,
			rightCoreId: coreRight.id,
			rightCoreLabel: coreRight.label,
			separation,
			fusionNodeCount: nodes.filter(node => node.origin === 'both').length,
			leftHasExclusive,
			rightHasExclusive,
		},
	};
}

/** 把「节点 id → 坐标」重新组装成布局结果（节点字段集中在一处，避免漏字段）。 */
function layoutFromPositions(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	positions: ReadonlyMap<string, Vec3>,
): ComponentLayout {
	const radiusById = new Map<string, number>();
	const laidOut: LaidOutNode[] = nodes.map(node => {
		const point = positions.get(node.id) ?? { x: 0, y: 0, z: 0 };
		const radius = nodeRadius(node.label, node.detail);
		radiusById.set(node.id, radius);
		return {
			id: node.id,
			label: node.label,
			x: point.x,
			y: point.y,
			z: point.z,
			radius,
			shape: node.shape,
			group: node.group,
			detail: node.detail,
			comment: node.comment,
			image: node.image,
			origin: node.origin,
		};
	});
	const laidEdges = buildEdges(nodes, edges, positions, radiusById);
	return { nodes: laidOut, edges: laidEdges, bounds: boundsOf(laidOut, laidEdges) };
}

function layoutComponent(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	metrics: Metrics,
	direction: Direction,
	strategy: 'tree' | 'layered' | 'force' | 'quadrant' | 'compact' | 'louvain',
): ComponentLayout {
	let positions: Map<string, Vec3>;
	if (strategy === 'quadrant') {
		positions = quadrantLayout(nodes, metrics);
	} else if (strategy === 'tree') {
		positions = treeComponent(nodes, edges, metrics).positions;
	} else if (strategy === 'layered') {
		positions = layeredComponent(nodes, edges, metrics, direction);
	} else if (strategy === 'compact') {
		positions = compactComponent(nodes, edges, metrics, direction);
	} else if (strategy === 'louvain') {
		positions = louvainComponent(nodes, edges, metrics);
	} else {
		positions = forceComponent(nodes, edges, metrics);
	}
	return layoutFromPositions(nodes, edges, positions);
}

function defaultDirection(kind: GraphElement['kind'], direction: GraphElement['direction']): Direction {
	if (direction) {
		return direction;
	}
	if (kind === 'journey' || kind === 'gantt' || kind === 'timeline') {
		return 'LR';
	}
	return 'TB';
}

export function layoutGraph(element: GraphElement, options: LayoutOptions = {}): GraphLayout {
	const spacing = clamp(
		typeof options.spacing === 'number' && Number.isFinite(options.spacing) ? options.spacing : DEFAULT_SPACING,
		MIN_SPACING,
		MAX_SPACING,
	);
	const algorithm = normalizeAlgorithm(options.algorithm);
	const analysis = analyzeVoidEdges(element);
	const nodes = analysis.nodes;
	const edges = analysis.edges;
	const dangling = analysis.dangling;
	const metrics = computeMetrics(nodes, spacing);
	const direction = defaultDirection(element.kind, element.direction);

	if (nodes.length === 0) {
		return {
			strategy: 'empty',
			algorithm,
			nodes: [],
			edges: [],
			bounds: boundsOf([], []),
			spacing,
			danglingEdgeCount: 0,
		};
	}
	if (element.kind === 'sequence') {
		const positions = sequenceLayout(nodes, metrics);
		const radiusById = new Map<string, number>();
		const laidOut = nodes.map(node => {
			const point = positions.get(node.id)!;
			const radius = nodeRadius(node.label, node.detail);
			radiusById.set(node.id, radius);
			return { id: node.id, label: node.label, x: point.x, y: point.y, z: point.z, radius, shape: node.shape, group: node.group, detail: node.detail, comment: node.comment, image: node.image, origin: node.origin };
		});
		const laidEdges: LaidOutEdge[] = edges.map((edge, index) => {
			const source = positions.get(edge.source) ?? { x: 0, y: 0, z: 0 };
			const target = positions.get(edge.target) ?? { x: 0, y: 0, z: 0 };
			const midX = (source.x + target.x) / 2;
			const controlY = -(index + 1) * metrics.baseGap * 0.55;
			const controlZ = ((index % 3) - 1) * metrics.baseGap * 0.45;
			const points: Vec3[] = edge.source === edge.target
				? [
					source,
					{ x: source.x + metrics.baseGap * 0.9, y: controlY, z: controlZ },
					{ x: source.x - metrics.baseGap * 0.9, y: controlY, z: controlZ },
					target,
				]
				: [source, { x: midX, y: controlY, z: controlZ }, target];
			return { index, source: edge.source, target: edge.target, label: edge.label, dashed: edge.dashed, arrow: edge.arrow, points };
		});
		return finalizeLayout('sequence', algorithm, spacing, laidOut, laidEdges, dangling, metrics);
	}
	if (nodes.length === 1) {
		const node = nodes[0];
		const radius = nodeRadius(node.label, node.detail);
		const laidOut: LaidOutNode[] = [{ id: node.id, label: node.label, x: 0, y: 0, z: 0, radius, shape: node.shape, group: node.group, detail: node.detail, comment: node.comment, image: node.image, origin: node.origin }];
		const laidEdges: LaidOutEdge[] = edges.map((edge, index) => ({
			index, source: edge.source, target: edge.target, label: edge.label, dashed: edge.dashed, arrow: edge.arrow,
			points: edge.source === edge.target
				? selfLoopPoints({ x: 0, y: 0, z: 0 }, radius)
				: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
		}));
		return finalizeLayout('single', algorithm, spacing, laidOut, laidEdges, dangling, metrics);
	}

	// 象限图的节点之间通常没有边；如果按「弱连通分量」拆开，每个点都会变成一个
	// 独立分量再被 packComponents 沿 X 轴顺次排开，[x, y] 的语义就丢了
	// （点序颠倒时左右也会颠倒）。因此整张象限图必须一次性布局。
	if (element.kind === 'quadrant') {
		const layout = layoutComponent(nodes, edges, metrics, direction, 'quadrant');
		return finalizeLayout('quadrant', algorithm, spacing, layout.nodes, layout.edges, dangling, metrics);
	}

	const components = weakComponents(nodes, edges);
	const componentStrategy = (componentNodes: readonly GraphNode[], componentEdges: readonly GraphEdge[]): 'tree' | 'layered' | 'force' | 'compact' | 'louvain' => {
		// 工具栏显式选择的算法优先；时序图 / 象限图已在上面单独处理。
		// 互斥算法先按对应的基础算法布局，随后在整张图上做两极分离。
		if (algorithm === 'compact' || algorithm === 'compact-mutex') {
			return 'compact';
		}
		if (algorithm === 'louvain') {
			return 'louvain';
		}
		if (algorithm === 'radial') {
			return 'tree';
		}
		if (algorithm === 'layered') {
			return 'layered';
		}
		if (algorithm === 'force' || algorithm === 'force-mutex') {
			return 'force';
		}
		const treeKind = element.kind === 'ascii-tree' || element.kind === 'mindmap' || element.kind === 'pie'
			|| element.kind === 'flowchart' || element.kind === 'merged';
		if (treeKind && isForest(componentNodes, componentEdges, [{ nodeIds: componentNodes.map(node => node.id), edges: componentEdges }])) {
			return 'tree';
		}
		// 有向流程类图：即使有回边也用 SCC 缩点分层，环内节点铺在同一层。
		if (element.kind === 'flowchart' || element.kind === 'state' || element.kind === 'gitgraph'
			|| element.kind === 'merged' || element.kind === 'journey' || element.kind === 'gantt'
			|| element.kind === 'timeline' || element.kind === 'unknown') {
			return 'layered';
		}
		// 类图 / ER 的连线语义更接近无向关系，有环时用力导向更自然。
		if (element.kind === 'class' || element.kind === 'er') {
			return isDag(componentNodes, componentEdges) ? 'layered' : 'force';
		}
		return 'force';
	};

	const layouts = components.map(component => {
		const componentNodes = component.nodeIds
			.map(id => nodes.find(node => node.id === id))
			.filter((node): node is GraphNode => node !== undefined);
		const strategy = componentStrategy(componentNodes, component.edges);
		return { strategy, layout: layoutComponent(componentNodes, component.edges, metrics, direction, strategy) };
	});
	let strategy: LayoutStrategy = layouts[0]?.strategy ?? 'force';
	let packed = packComponents(layouts.map(item => item.layout), metrics.baseGap * 1.35);
	let mutex: MutexLayoutInfo | undefined;
	if (algorithm === 'compact-mutex' || algorithm === 'force-mutex') {
		const basePositions = new Map(packed.nodes.map(node => [node.id, { x: node.x, y: node.y, z: node.z }]));
		const applied = applyMutexSeparation(nodes, edges, basePositions, packed.bounds, metrics);
		if (applied) {
			packed = layoutFromPositions(nodes, edges, applied.positions);
			strategy = algorithm;
			mutex = applied.info;
		}
	}
	const order = new Map(nodes.map((node, index) => [node.id, index]));
	const orderedNodes = [...packed.nodes]
		.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
		.map(node => ({ ...node, x: zeroSafe(node.x), y: zeroSafe(node.y), z: zeroSafe(node.z) }));
	const orderedEdges = [...packed.edges]
		.sort((a, b) => a.index - b.index)
		.map(edge => ({
			...edge,
			points: edge.points.map(point => ({ x: zeroSafe(point.x), y: zeroSafe(point.y), z: zeroSafe(point.z) })),
		}));
	return finalizeLayout(
		strategy,
		algorithm,
		spacing,
		orderedNodes,
		orderedEdges,
		dangling,
		metrics,
		mutex,
	);
}

/** 把 -0 归一成 0，避免序列化 / 断言里出现两个“相等但不相同”的零。 */
function zeroSafe(value: number): number {
	return value === 0 ? 0 : value;
}
