import type { GraphEdge, GraphNode, ParsedGraph } from './types';

/**
 * ASCII / 制表符树的解析。
 *
 * 支持两类画法：
 *   - Unicode：`├── src`、`└── main.ts`、`│   ├── util.ts`
 *   - ASCII：`|-- src`、`+-- main.ts`、`` `-- util.ts ``
 *
 * 只做「树」这一种拓扑：缩进 / 连接线决定父子关系。正文里的普通列表（`- 项目`）
 * 不会被误判，因为连接线必须出现两行以上。
 */

const MAX_NODES = 600;

/** 连接线：`├──` 一类（一个分叉符 + 若干横线），或 `+--` / `|--` / `` `-- `` / `\--`。 */
const CONNECTOR_PATTERN =
	/^([ \t─-╿|+`\\/]*?)(?:([├└┌┐┘┤┬┴┼╞╠╣╦╩╬╔╗╚╝╭╮╯╰])[─-╿]{1,8}|([|+`\\/])-{2,8})[ \t]*(.*)$/u;

/** 只由横线 / 竖线 / 加号等「画框字符」组成的标签，是表格或 ASCII 边框，不是树节点。 */
const FRAME_LABEL = /^[-+=|─-╿\s]+$/u;

interface ConnectorLine {
	readonly indent: number;
	readonly label: string;
	readonly lineIndex: number;
}

interface BareLine {
	readonly text: string;
	/** 去掉树形前缀（`│` / `|` / 空格）后，正文在原始行里的列号。 */
	readonly column: number;
	readonly indented: boolean;
	readonly lineIndex: number;
}

/** 行首的树形前缀：空白与竖线，用来识别「没有连接线的续行 / 注释行」。 */
const TREE_PREFIX = /^[ \t]*(?:[│┃║|][ \t]*)*/u;

/** 行首注释标记（整行都是注释）。`//server/share` 这类路径不算。 */
function commentOnlyText(text: string): string | undefined {
	const match = /^(?:[#＃]|\/\/)[ \t　]*(.*)$/u.exec(text);
	if (!match) {
		return undefined;
	}
	if (text.startsWith('//') && !/^\/\/[ \t　]/u.test(text)) {
		return undefined;
	}
	return match[1].trim();
}

/** 行尾注释标记：必须有前导空白（`C#` 不算），且不在反引号内。 */
const INLINE_COMMENT = /(^|[ \t　])([#＃]|\/\/)[ \t]*/gu;

interface SplitLabel {
	readonly label: string;
	readonly comment?: string;
	/** 注释标记相对正文起点的列偏移。 */
	readonly commentOffset?: number;
}

function splitLabelComment(text: string): SplitLabel {
	INLINE_COMMENT.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = INLINE_COMMENT.exec(text)) !== null) {
		const markerIndex = match.index + match[1].length;
		if (match[2] === '//' && markerIndex === 0 && !/^\/\/[ \t　]/u.test(text)) {
			// `//server/share` 形式的 UNC 路径，不是注释。
			INLINE_COMMENT.lastIndex = markerIndex + 2;
			continue;
		}
		const backticks = (text.slice(0, markerIndex).match(/`/g) ?? []).length;
		if (backticks % 2 === 1) {
			INLINE_COMMENT.lastIndex = markerIndex + match[2].length;
			continue;
		}
		const label = text.slice(0, markerIndex).trimEnd();
		const comment = text.slice(markerIndex + match[2].length).trim();
		return { label, comment, commentOffset: label.length === 0 ? 0 : markerIndex };
	}
	return { label: text };
}

function bareContent(line: string): { text: string; column: number } {
	const prefix = TREE_PREFIX.exec(line)?.[0] ?? '';
	return { text: line.slice(prefix.length).trim(), column: prefix.length };
}

function normalizeLines(text: string): string[] {
	return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
}

function leadingSpaces(line: string): number {
	return /^ */.exec(line)?.[0].length ?? 0;
}

/** 去掉所有行共有的缩进，让根节点从 0 列开始。 */
function dedent(lines: readonly string[]): string[] {
	const widths = lines.filter(line => line.trim().length > 0).map(leadingSpaces);
	const common = widths.length > 0 ? Math.min(...widths) : 0;
	return common > 0 ? lines.map(line => line.slice(Math.min(common, leadingSpaces(line)))) : [...lines];
}

function connectorInfo(line: string): { indent: number; label: string } | undefined {
	const match = CONNECTOR_PATTERN.exec(line);
	if (!match) {
		return undefined;
	}
	const rawLabel = match[4] ?? '';
	const label = rawLabel.trim();
	if (label.length === 0 || FRAME_LABEL.test(label)) {
		return undefined;
	}
	// 方框 / 表格的横边框：`┌── 标题 ──┐`、`├── 分区 ──┤` 等。树连接线的标签
	// 不会以画框字符收尾，也不会整行被一对角括号包住。
	if (/^[ \t]*[┌╔][─-╿]/.test(line) && /[┐╗]\s*$/u.test(line)) {
		return undefined;
	}
	if (/^[ \t]*[└╚][─-╿]/.test(line) && /[┘╝]\s*$/u.test(line)) {
		return undefined;
	}
	// 行尾是「横线 + 边框角 / 竖线」：`├── 分区 ───┤`、`+---- 标题 ----+`。
	if (/[-─-╿]{2,}\s*[+|┐┘┤╗╝╣]\s*$/u.test(line)) {
		return undefined;
	}
	// 标签在原始行里的起点 = 前缀 + 连接线 + 分隔空格。用 rawLabel（含行尾空格）
	// 计算，行尾空格才不会把缩进算大；tabs 已在上游换成空格，按字符数即可。
	return { indent: match[0].length - rawLabel.length, label };
}

/** 这一行是不是带标签的树连接线（供 Markdown 正文裸树的边界判定复用）。 */
export function isAsciiTreeConnectorLine(line: string): boolean {
	return connectorInfo(line) !== undefined;
}

/** 这一行是不是树里的注释行（缩进的 `# …` / `// …`，可带树形前缀）。 */
export function isAsciiTreeCommentLine(line: string): boolean {
	const content = bareContent(line);
	return content.column > 0
		&& content.text.length > 0
		&& commentOnlyText(content.text) !== undefined;
}

function classify(lines: readonly string[]): { connectors: ConnectorLine[]; bare: BareLine[] } {
	const connectors: ConnectorLine[] = [];
	const bare: BareLine[] = [];
	lines.forEach((line, lineIndex) => {
		if (line.trim().length === 0) {
			return;
		}
		const info = connectorInfo(line);
		if (info) {
			connectors.push({ indent: info.indent, label: info.label, lineIndex });
			return;
		}
		// 纯竖线 / 横线组成的行也忽略
		if (/^[\s─-╿|+`\\/-]+$/u.test(line)) {
			return;
		}
		const content = bareContent(line);
		if (content.text.length === 0) {
			return;
		}
		bare.push({ text: content.text, column: content.column, indented: content.column > 0, lineIndex });
	});
	return { connectors, bare };
}

/**
 * 两行以上带标签的连接线才认定为树。纯边框（表格 / ASCII 方框）的连接线在
 * `classify` 里已经被 `FRAME_LABEL` 过滤掉，所以 `+-- a` / `` `-- b `` 这种
 * 没有竖线、只有两个分叉的 ASCII 树也能被识别。
 */
export function looksLikeAsciiTree(text: string): boolean {
	const lines = dedent(normalizeLines(text));
	return classify(lines).connectors.length >= 2;
}

export function parseAsciiTree(text: string): ParsedGraph {
	const rawLines = normalizeLines(text);
	const lines = dedent(rawLines);
	const { connectors, bare } = classify(lines);
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const stack: Array<string | undefined> = [];

	const connectorIndents = connectors.map(item => item.indent).filter(indent => indent > 0);
	const unit = connectorIndents.length > 0 ? Math.max(1, Math.min(...connectorIndents)) : 4;

	// 注释按节点 id 累积，最后一次性写回；多行注释用 \n 连接。
	const commentLines = new Map<string, string[]>();
	const appendComment = (nodeId: string | undefined, text: string): void => {
		const clean = text.trim();
		if (!nodeId || clean.length === 0) {
			return;
		}
		const existing = commentLines.get(nodeId) ?? [];
		if (existing.length >= 12) {
			return;
		}
		existing.push(clean.slice(0, 600));
		commentLines.set(nodeId, existing);
	};
	// 最近一条注释所在的节点与列号；用于识别没重复写 `#` 的折行注释。
	let activeComment: { nodeId: string; column: number } | undefined;
	const attachComment = (nodeId: string | null | undefined, comment: string | undefined, column: number): void => {
		if (!nodeId || comment === undefined) {
			activeComment = undefined;
			return;
		}
		appendComment(nodeId, comment);
		activeComment = { nodeId, column };
	};

	const addNode = (label: string, depth: number): string | undefined => {
		if (nodes.length >= MAX_NODES) {
			return undefined;
		}
		const id = `a${nodes.length}`;
		nodes.push({ id, label: label.slice(0, 240) });
		stack.length = Math.max(stack.length, depth + 1);
		stack[depth] = id;
		for (let i = depth + 1; i < stack.length; i += 1) {
			stack[i] = undefined;
		}
		if (depth > 0) {
			let parent: string | undefined;
			for (let i = depth - 1; i >= 0; i -= 1) {
				if (stack[i]) {
					parent = stack[i];
					break;
				}
			}
			if (parent) {
				edges.push({ source: parent, target: id });
			}
		}
		return id;
	};

	// 根节点可能出现在连接线之前；也有可能根本没有根（片段从 ├── 开始）。
	// 先把「无连接线的顶层行」当作根，再按行序处理连接线。
	type Item = { kind: 'bare'; item: BareLine } | { kind: 'connector'; item: ConnectorLine };
	const items: Item[] = [
		...bare.map(item => ({ kind: 'bare' as const, item })),
		...connectors.map(item => ({ kind: 'connector' as const, item })),
	].sort((a, b) => a.item.lineIndex - b.item.lineIndex);

	let lastNodeId: string | undefined;
	for (const entry of items) {
		if (entry.kind === 'bare') {
			const { text, column, indented } = entry.item;

			// 整行注释：挂到最近一个节点；`│   # …` 这种带树形前缀的也算。
			const standalone = commentOnlyText(text);
			if (standalone !== undefined) {
				if (lastNodeId && standalone.length > 0) {
					attachComment(lastNodeId, standalone, column);
				}
				continue;
			}

			// 没重复写注释标记的折行注释：只有当缩进列 >= 注释起始列时才认成注释，
			// 否则仍按「标签折行」处理（不少树会把长标签折到下一行）。
			if (activeComment && indented && column >= activeComment.column) {
				appendComment(activeComment.nodeId, text);
				continue;
			}

			const split = splitLabelComment(text);
			if (indented && lastNodeId) {
				// 缩进但没有连接线：标签续行；行尾若带注释，注释挂到同一节点。
				const index = nodes.findIndex(item => item.id === lastNodeId);
				if (index >= 0 && split.label) {
					const node = nodes[index];
					nodes[index] = { ...node, label: `${node.label} ${split.label}`.trim().slice(0, 240) };
				}
				attachComment(
					lastNodeId,
					split.comment,
					column + (split.commentOffset ?? 0),
				);
				continue;
			}
			if (!indented && split.label) {
				lastNodeId = addNode(split.label, 0);
				attachComment(
					lastNodeId,
					split.comment,
					column + (split.commentOffset ?? 0),
				);
			}
			continue;
		}

		const { indent, label } = entry.item;
		const split = splitLabelComment(label);
		// `├── # 注释`：连接线本身没有标签，只把注释挂到上一个节点。
		if (split.label.length === 0) {
			if (lastNodeId) {
				attachComment(lastNodeId, split.comment, indent);
			}
			continue;
		}
		let depth = Math.max(1, Math.round(indent / unit));
		if (depth > 30) {
			depth = 30;
		}
		// 没有根时，第一个 ├── 直接当根，避免整个片段挂空。
		if (depth === 1 && stack[0] === undefined) {
			lastNodeId = addNode(split.label, 0);
			attachComment(lastNodeId, split.comment, indent + (split.commentOffset ?? 0));
			continue;
		}
		const currentDepth = Math.min(depth, stack.length);
		lastNodeId = addNode(split.label, currentDepth);
		attachComment(lastNodeId, split.comment, indent + (split.commentOffset ?? 0));
	}

	const commentedNodes = nodes.map(node => {
		const parts = commentLines.get(node.id);
		return parts && parts.length > 0
			? { ...node, comment: parts.join('\n').slice(0, 1200) }
			: node;
	});

	return {
		kind: 'ascii-tree',
		nodes: commentedNodes,
		edges,
		note: nodes.length === 0 ? '代码块里没有解析出树节点。' : undefined,
	};
}
