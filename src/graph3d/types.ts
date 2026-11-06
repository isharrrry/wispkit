/**
 * 3D 图可视化的纯数据模型。
 *
 * 这一层刻意不依赖 vscode、three 或 DOM：Markdown 解析、Mermaid 子集解析、
 * 合并与布局都能在 mocha 里直接跑。宿主把这里的结果序列化给 webview，
 * webview 再交给 three.js 画出来。
 */

export type GraphKind =
	| 'ascii-tree'
	| 'flowchart'
	| 'sequence'
	| 'class'
	| 'state'
	| 'er'
	| 'mindmap'
	| 'gitgraph'
	| 'journey'
	| 'gantt'
	| 'timeline'
	| 'pie'
	| 'quadrant'
	| 'merged'
	| 'unknown';

export type NodeShape =
	| 'box'
	| 'round'
	| 'stadium'
	| 'diamond'
	| 'circle'
	| 'double-circle'
	| 'hexagon'
	| 'database'
	| 'subroutine'
	| 'parallelogram'
	| 'asymmetric'
	| 'state-start'
	| 'state-end';

export type ArrowKind = 'arrow' | 'none' | 'both' | 'circle' | 'cross';

/**
 * 节点气泡里要显示的图片。
 *
 * 只有「节点名称是 Markdown 链接、目标是存在的可解析图片」时才会出现；
 * 出现后 `label` 已被替换成链接文字（alt），前端不再绘制文字，而是把
 * `src` 画成穿过球心的 Sprite。
 */
export interface GraphNodeImage {
	/** `data:<mime>;base64,…`，webview 可直接赋给 `Image.src`。 */
	readonly src: string;
	/** 链接文字（alt）；为空时用文件名。 */
	readonly alt: string;
	/** 解析后的绝对文件路径，仅用于诊断 / 自检。 */
	readonly path: string;
	/** 按文件头识别出的真实 MIME。 */
	readonly mime: string;
}

/**
 * 合并图里节点来自哪一侧。
 *
 * - `left`：只存在于左侧图；
 * - `right`：只存在于右侧图；
 * - `both`：两侧同名节点合并后的「融合节点」。
 *
 * 只有 `mergeElements()` 产出的合并图才会写这个字段；单图布局没有来源概念。
 * 「互斥」布局用它找出两侧的核心节点与融合节点。
 */
export type NodeOrigin = 'left' | 'right' | 'both';

export interface GraphNode {
	readonly id: string;
	readonly label: string;
	/** 合并图里的来源归属；单图没有这个字段。 */
	readonly origin?: NodeOrigin;
	/** 有值时气泡里显示图片而不是文字（标签已归一成 alt）。 */
	readonly image?: GraphNodeImage;
	readonly shape?: NodeShape;
	/** 所属分组（Mermaid subgraph / namespace / 状态复合体 / gantt section 等）。 */
	readonly group?: string;
	/** 类成员、ER 字段等次要文本；3D 里作为气泡里的第二块小字。 */
	readonly detail?: readonly string[];
	/**
	 * 条目注释（ASCII 树行尾 `# …` / 下一行的注释，Mermaid 的 `%% …`）。
	 * 多行注释用 `\n` 连接；3D 里鼠标悬停节点气泡时以 tooltip 显示。
	 */
	readonly comment?: string;
}

export interface GraphEdge {
	readonly source: string;
	readonly target: string;
	readonly label?: string;
	readonly dashed?: boolean;
	readonly arrow?: ArrowKind;
	readonly group?: string;
}

export interface GraphGroup {
	readonly id: string;
	readonly label: string;
	/** 父分组 id；没有就是顶层。 */
	readonly parent?: string;
}

export interface GraphElement {
	readonly id: string;
	/** 下拉框里显示的名字：优先标题，其次最近的 Markdown 标题。 */
	readonly name: string;
	readonly kind: GraphKind;
	/** 原始语言标记（mermaid / ascii-tree / text…）。 */
	readonly language: string;
	/** 代码块起始行（1-based），用于溯源。 */
	readonly line: number;
	readonly source: string;
	readonly direction?: 'TB' | 'BT' | 'LR' | 'RL';
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly groups?: readonly GraphGroup[];
	/** 图自身的标题（Mermaid frontmatter 的 title）。 */
	readonly title?: string;
	/** 解析失败或降级时的说明；不影响显示已有节点。 */
	readonly note?: string;
}

export interface ParsedGraph {
	readonly kind: GraphKind;
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly groups?: readonly GraphGroup[];
	readonly direction?: 'TB' | 'BT' | 'LR' | 'RL';
	readonly title?: string;
	readonly note?: string;
}

export interface MergeResult {
	readonly element: GraphElement;
	/** 跨两个图按名称合并掉的节点数。 */
	readonly mergedNodeCount: number;
	/** 左侧/右侧各自原本的节点数。 */
	readonly leftNodeCount: number;
	readonly rightNodeCount: number;
}

export const KIND_LABELS: Readonly<Record<GraphKind, string>> = {
	'ascii-tree': 'ASCII 树',
	flowchart: '流程图',
	sequence: '时序图',
	class: '类图',
	state: '状态图',
	er: 'ER 图',
	mindmap: '思维导图',
	gitgraph: 'Git 图',
	journey: '用户旅程',
	gantt: '甘特图',
	timeline: '时间线',
	pie: '饼图',
	quadrant: '象限图',
	merged: '合并图',
	unknown: '通用图',
};

/** 中文按 2 个显示宽度算，用于估算节点气泡半径与文字宽度。 */
export function displayWidth(text: string): number {
	let width = 0;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		width += code >= 0x2e80 ? 2 : 1;
	}
	return width;
}

export function kindLabel(kind: GraphKind): string {
	return KIND_LABELS[kind] ?? '图';
}
