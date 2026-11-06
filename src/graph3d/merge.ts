import type {
	GraphEdge,
	GraphElement,
	GraphGroup,
	GraphNode,
	MergeResult,
} from './types';

/**
 * 左右两个图元素合并成一张 3D 图。
 *
 * 规则：**只跨图合并同名节点**（同一张图内部的同名节点不合并，避免把重复
 * 出现的普通节点误当成同一个实体）。名称比较做 trim + 空白压缩 + 大小写不敏感，
 * 这是用户肉眼判断「同名」时最自然的规则；中文不受大小写影响。
 *
 * 合并后的边保留两侧全部连接，因此两个图会通过共享节点连成一个整体；
 * 如果没有任何同名节点，两张图仍然画在同一个 3D 场景里，但各自独立。
 *
 * 每个节点同时带上 `origin`：`left` / `right` / `both`（同名融合）。
 * 「互斥」布局靠它找出左右两侧的核心节点与夹在中间的融合节点。
 */

function normalizeName(label: string): string {
	return label
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/^["'`]+|["'`]+$/g, '')
		.toLowerCase();
}

function uniqueId(candidate: string, used: Set<string>): string {
	if (!used.has(candidate)) {
		used.add(candidate);
		return candidate;
	}
	for (let index = 2; index < 10000; index += 1) {
		const next = `${candidate}~${index}`;
		if (!used.has(next)) {
			used.add(next);
			return next;
		}
	}
	return candidate;
}

function mergeComment(left: string | undefined, right: string | undefined): string | undefined {
	const parts = [...(left?.split('\n') ?? []), ...(right?.split('\n') ?? [])]
		.map(item => item.trim())
		.filter(item => item.length > 0);
	const unique: string[] = [];
	for (const part of parts) {
		if (!unique.includes(part)) {
			unique.push(part);
		}
	}
	return unique.length > 0 ? unique.join('\n').slice(0, 1200) : undefined;
}

function mergeDetail(left: readonly string[] | undefined, right: readonly string[] | undefined): readonly string[] | undefined {
	if (!left || left.length === 0) {
		return right && right.length > 0 ? right : undefined;
	}
	if (!right || right.length === 0) {
		return left;
	}
	const seen = new Set(left);
	const merged = [...left];
	for (const item of right) {
		if (!seen.has(item)) {
			seen.add(item);
			merged.push(item);
		}
	}
	return merged.slice(0, 24);
}

export function mergeElements(left: GraphElement, right: GraphElement): MergeResult {
	// 先给右侧分组做 id 重映射，避免与左侧同名分组撞车。
	const usedGroupIds = new Set((left.groups ?? []).map(group => group.id));
	const groupMap = new Map<string, string>();
	const groups: GraphGroup[] = (left.groups ?? []).map(group => ({ ...group }));
	for (const group of right.groups ?? []) {
		groupMap.set(group.id, uniqueId(`r:${group.id}`, usedGroupIds));
	}
	for (const group of right.groups ?? []) {
		groups.push({
			...group,
			id: groupMap.get(group.id)!,
			parent: group.parent ? groupMap.get(group.parent) : undefined,
		});
	}

	const usedNodeIds = new Set(left.nodes.map(node => node.id));
	const rightToMerged = new Map<string, string>();
	// 记下来源，供「互斥」布局识别左右两侧的核心节点与融合节点。
	// 左侧节点统一标成 left：即使它原本来自另一个合并图，在当前这次合并里
	// 它仍然属于左侧；同名匹配上的节点改成 both。
	const nodes: GraphNode[] = left.nodes.map(node => ({ ...node, origin: 'left' as const }));
	const nodeIndex = new Map<string, number>();
	nodes.forEach((node, index) => nodeIndex.set(node.id, index));

	const leftByName = new Map<string, string>();
	for (const node of left.nodes) {
		const key = normalizeName(node.label);
		if (!leftByName.has(key)) {
			leftByName.set(key, node.id);
		}
	}

	let mergedNodeCount = 0;
	for (const node of right.nodes) {
		const key = normalizeName(node.label);
		const matchedId = leftByName.get(key);
		if (matchedId !== undefined) {
			rightToMerged.set(node.id, matchedId);
			mergedNodeCount += 1;
			const index = nodeIndex.get(matchedId);
			if (index !== undefined) {
				const existing = nodes[index];
				nodes[index] = {
					...existing,
					origin: 'both',
					// 名称相同但只有一侧是图片链接时，保留有图片的那一侧。
					image: existing.image ?? node.image,
					detail: mergeDetail(existing.detail, node.detail),
					comment: mergeComment(existing.comment, node.comment),
				};
			}
			continue;
		}
		const id = uniqueId(`r:${node.id}`, usedNodeIds);
		rightToMerged.set(node.id, id);
		nodes.push({
			...node,
			id,
			origin: 'right',
			group: node.group ? (groupMap.get(node.group) ?? `r:${node.group}`) : undefined,
		});
	}

	const edges: GraphEdge[] = [];
	const edgeKeys = new Set<string>();
	const pushEdge = (edge: GraphEdge): void => {
		const key = `${edge.source}\u0000${edge.target}\u0000${edge.label ?? ''}\u0000${edge.dashed ? 'd' : 's'}`;
		if (edgeKeys.has(key)) {
			return;
		}
		edgeKeys.add(key);
		edges.push(edge);
	};
	for (const edge of left.edges) {
		pushEdge(edge);
	}
	for (const edge of right.edges) {
		const source = rightToMerged.get(edge.source);
		const target = rightToMerged.get(edge.target);
		if (source === undefined || target === undefined) {
			continue;
		}
		pushEdge({
			...edge,
			source,
			target,
			group: edge.group ? (groupMap.get(edge.group) ?? `r:${edge.group}`) : undefined,
		});
	}

	const element: GraphElement = {
		id: `merged:${left.id}:${right.id}`,
		name: `${left.name} + ${right.name}`,
		kind: 'merged',
		language: 'merged',
		line: left.line,
		source: `${left.source}\n\n${right.source}`,
		direction: left.direction ?? right.direction,
		nodes,
		edges,
		groups: groups.length > 0 ? groups : undefined,
		title: `${left.title ?? left.name} + ${right.title ?? right.name}`,
		note: mergedNodeCount > 0
			? `已合并 ${mergedNodeCount} 个同名节点，两侧图通过它们连通。`
			: '两侧没有同名节点；已放在同一个 3D 场景里，但保持独立。',
	};

	return {
		element,
		mergedNodeCount,
		leftNodeCount: left.nodes.length,
		rightNodeCount: right.nodes.length,
	};
}
