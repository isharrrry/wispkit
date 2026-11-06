import { parseMermaid } from '../graph3d/mermaid';
import { kindLabel, type GraphKind } from '../graph3d/types';

/**
 * `.mmd` 预览页顶部要显示的状态：图种 + 节点 / 边数量。
 *
 * 与 3D 面板共用同一个拓扑解析器，所以预览页的计数和 3D 下拉里看到的
 * 「N 节点 / M 边」一致；解析失败时 `canOpen3d` 为 false。
 */
export interface MermaidFileStatus {
	readonly kind: GraphKind;
	readonly kindName: string;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly note?: string;
	readonly canOpen3d: boolean;
}

export function mermaidFileStatus(source: string): MermaidFileStatus {
	const parsed = parseMermaid(source);
	return {
		kind: parsed.kind,
		kindName: kindLabel(parsed.kind),
		nodeCount: parsed.nodes.length,
		edgeCount: parsed.edges.length,
		note: parsed.note,
		canOpen3d: parsed.nodes.length > 0,
	};
}

export function statusLabel(status: MermaidFileStatus): string {
	return `${status.kindName} · ${status.nodeCount} 节点 · ${status.edgeCount} 边`;
}
