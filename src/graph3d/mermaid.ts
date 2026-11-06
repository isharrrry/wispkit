import type {
	ArrowKind,
	GraphEdge,
	GraphGroup,
	GraphNode,
	GraphKind,
	NodeShape,
	ParsedGraph,
} from './types';

/**
 * Mermaid 的「拓扑解析器」。
 *
 * 刻意不引入 mermaid 的渲染器：这里只关心「谁是谁、谁连谁」，把不同图种
 * 归一成 nodes / edges / groups，之后交给自研的 3D 布局。支持：
 *
 *   flowchart / graph、sequenceDiagram、classDiagram、stateDiagram(-v2)、
 *   erDiagram、mindmap、gitGraph、journey、gantt、timeline、pie、quadrantChart
 *
 * 其余图种（requirement / C4 / sankey / block / architecture / packet / xychart）
 * 用一个通用兜底：按阅读顺序把内容行串成链，至少能在 3D 里看到结构，而不是空白。
 */

const MAX_NODES = 600;
const TRUNCATION_NOTE = `节点数超过 ${MAX_NODES}，已截断为前 ${MAX_NODES} 个。`;

/**
 * `%%` 注释采集。
 *
 * Mermaid 的注释可以是整行（`%% 说明`），也可以跟在语句后面（`A --> B %% 说明`）。
 * 解析器按行推进，这里把「上一段连续注释」或「本行行尾注释」挂到本行**新建**
 * 的节点上：整行注释描述紧随其后的条目，行尾注释描述同一行的条目。连续多行
 * 注释会拼成多行文本。注释只挂在新建节点上，后续对已有节点的更新不会重复挂。
 */
interface CommentCapture {
	pending: string[];
	active?: string;
}

let commentCapture: CommentCapture = { pending: [] };

function resetCommentCapture(): void {
	commentCapture = { pending: [] };
}

function cleanComment(text: string): string | undefined {
	const clean = text.replace(/\s+$/u, '').trim();
	return clean.length > 0 ? clean.slice(0, 1200) : undefined;
}

function combineComments(parts: readonly string[]): string | undefined {
	const unique: string[] = [];
	for (const part of parts) {
		const clean = cleanComment(part);
		if (clean && !unique.includes(clean)) {
			unique.push(clean);
		}
	}
	return unique.length > 0 ? unique.join('\n').slice(0, 1200) : undefined;
}

function nodeWithComment(node: GraphNode): GraphNode {
	return commentCapture.active && !node.comment
		? { ...node, comment: commentCapture.active }
		: node;
}

/** 节点 Map：新节点自动带上当前行的注释。 */
class CommentAwareNodeMap extends Map<string, GraphNode> {
	public override set(key: string, value: GraphNode): this {
		return super.set(key, this.has(key) ? value : nodeWithComment(value));
	}
}

interface NodeRef {
	readonly id: string;
	readonly label: string;
	readonly shape?: NodeShape;
	readonly explicitLabel: boolean;
}

interface ParseState {
	readonly nodes: Map<string, GraphNode>;
	readonly edges: GraphEdge[];
	readonly groups: GraphGroup[];
	readonly groupStack: string[];
}

function createState(): ParseState {
	return { nodes: new CommentAwareNodeMap(), edges: [], groups: [], groupStack: [] };
}

function stateToGraph(state: ParseState, kind: GraphKind, extra: Partial<ParsedGraph> = {}): ParsedGraph {
	return {
		kind,
		nodes: [...state.nodes.values()],
		edges: state.edges,
		groups: state.groups.length > 0 ? state.groups : undefined,
		...extra,
	};
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	quot: '"',
	amp: '&',
	lt: '<',
	gt: '>',
	apos: "'",
	nbsp: ' ',
};

/**
 * Mermaid 标签里的实体：既支持 HTML 写法 `&quot;`，也支持 Mermaid 自己的
 * `#quot;` / `#9829;` / `#x2665;`（官方文档里的写法，没有前导 `&`）。
 */
function decodeEntities(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/#(quot|amp|lt|gt|apos|nbsp);/gi, (whole, name: string) =>
			NAMED_ENTITIES[name.toLowerCase()] ?? whole)
		.replace(/#(\d{1,7});/g, (whole, digits: string) => {
			const point = Number(digits);
			return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
		})
		.replace(/#x([0-9a-f]{1,6});/gi, (whole, hex: string) => {
			const point = Number.parseInt(hex, 16);
			return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
		});
}

export function decodeLabel(text: string): string {
	let value = text.trim();
	if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
		value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
	}
	value = decodeEntities(
		value
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, ''),
	).trim();
	// Mermaid 允许 `A["文本"]` 用反引号包裹代码段；保留内部文字即可。
	return value.replace(/^`(.*)`$/s, '$1').trim();
}

/**
 * 去掉行内注释：`%%` 之后到行尾；引号里的 `%%` 不算。
 *
 * 顺便采集注释：整行注释攒到下一行，行尾注释属于本行；节点 Map 在新建节点时
 * 读取 `commentCapture.active`，于是注释能落到对应条目上而不只是被丢弃。
 */
function stripComment(line: string): string {
	let inQuote = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"' && line[index - 1] !== '\\') {
			inQuote = !inQuote;
		}
		if (!inQuote && char === '%' && line[index + 1] === '%') {
			const body = line.slice(0, index);
			const rawComment = line.slice(index + 2).trim();
			if (body.trim().length === 0) {
				// `%%{init: …}%%` 一类的指令不是注释。
				if (!/^%%\s*\{[\s\S]*\}\s*%%.*$/u.test(line) && rawComment.length > 0) {
					commentCapture.pending.push(rawComment);
				}
				commentCapture.active = undefined;
				return body;
			}
			commentCapture.active = combineComments([...commentCapture.pending, rawComment]);
			commentCapture.pending = [];
			return body;
		}
	}
	if (line.trim().length > 0) {
		commentCapture.active = combineComments(commentCapture.pending);
		commentCapture.pending = [];
	}
	return line;
}

function normalizeLines(source: string): string[] {
	return source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
}

interface DiagramHead {
	readonly title?: string;
	readonly body: string[];
}

function splitHead(source: string): DiagramHead {
	const lines = normalizeLines(source);
	let start = 0;
	let title: string | undefined;
	if ((lines[0] ?? '').trim() === '---') {
		const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
		if (end > 0) {
			for (const line of lines.slice(1, end)) {
				const match = /^\s*title\s*:\s*(.+?)\s*$/.exec(line);
				if (match) {
					title = decodeLabel(match[1]);
				}
			}
			start = end + 1;
		}
	}
	const body = lines.slice(start).filter(line => !/^\s*%%\{[\s\S]*\}%%\s*$/.test(line));
	return { title, body };
}

function firstMeaningful(lines: readonly string[]): string {
	for (const raw of lines) {
		const line = stripComment(raw).trim();
		if (line.length > 0) {
			return line;
		}
	}
	return '';
}

function extractTitleDirective(lines: readonly string[]): string | undefined {
	for (const raw of lines) {
		const match = /^\s*title\s+(.+?)\s*$/.exec(stripComment(raw));
		if (match && !/^\s*title\s*:/.test(stripComment(raw))) {
			return decodeLabel(match[1]);
		}
	}
	return undefined;
}

function ensureNode(state: ParseState, ref: NodeRef): GraphNode {
	const existing = state.nodes.get(ref.id);
	const group = state.groupStack.length > 0 ? state.groupStack[state.groupStack.length - 1] : undefined;
	if (existing) {
		// 后出现的显式标签覆盖 `id` 占位标签；形状也以最后一次声明为准。
		if (ref.explicitLabel && (existing.label === existing.id || existing.shape === undefined)) {
			const updated: GraphNode = {
				...existing,
				label: ref.label,
				shape: ref.shape ?? existing.shape,
			};
			state.nodes.set(ref.id, updated);
			return updated;
		}
		return existing;
	}
	const node: GraphNode = {
		id: ref.id,
		label: ref.label.slice(0, 240),
		shape: ref.shape,
		group,
	};
	state.nodes.set(ref.id, node);
	return node;
}

function addEdge(state: ParseState, edge: GraphEdge): void {
	state.edges.push(edge);
}

function currentGroup(state: ParseState): string | undefined {
	return state.groupStack.length > 0 ? state.groupStack[state.groupStack.length - 1] : undefined;
}

function addGroup(state: ParseState, id: string, label: string): void {
	const parent = currentGroup(state);
	if (!state.groups.some(group => group.id === id)) {
		state.groups.push({ id, label: label.slice(0, 240), parent });
	}
	state.groupStack.push(id);
}

/** 顶层语句分割：分号在括号 / 引号内不切（Mermaid 允许一行写多条）。 */
export function splitStatements(line: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let inQuote = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"' && line[index - 1] !== '\\') {
			inQuote = !inQuote;
		}
		if (!inQuote) {
			if (char === '[' || char === '(' || char === '{') {
				depth += 1;
			} else if (char === ']' || char === ')' || char === '}') {
				depth = Math.max(0, depth - 1);
			} else if (char === ';' && depth === 0) {
				if (current.trim()) {
					parts.push(current.trim());
				}
				current = '';
				continue;
			}
		}
		current += char;
	}
	if (current.trim()) {
		parts.push(current.trim());
	}
	return parts;
}

/** `A & B` 在括号外按 `&` 拆分。 */
export function splitAmpersand(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let inQuote = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"' && text[index - 1] !== '\\') {
			inQuote = !inQuote;
		}
		if (!inQuote) {
			if (char === '[' || char === '(' || char === '{') {
				depth += 1;
			} else if (char === ']' || char === ')' || char === '}') {
				depth = Math.max(0, depth - 1);
			} else if (char === '&' && depth === 0) {
				if (current.trim()) {
					parts.push(current.trim());
				}
				current = '';
				continue;
			}
		}
		current += char;
	}
	if (current.trim()) {
		parts.push(current.trim());
	}
	return parts;
}

const NODE_SHAPES: ReadonlyArray<{ open: string; close: string; shape: NodeShape }> = [
	{ open: '(((', close: ')))', shape: 'double-circle' },
	{ open: '((', close: '))', shape: 'circle' },
	{ open: '([', close: '])', shape: 'stadium' },
	{ open: '[[', close: ']]', shape: 'subroutine' },
	{ open: '[(', close: ')]', shape: 'database' },
	{ open: '{{', close: '}}', shape: 'hexagon' },
	{ open: '[/', close: '/]', shape: 'parallelogram' },
	{ open: '[\\', close: '\\]', shape: 'parallelogram' },
	{ open: '[', close: ']', shape: 'box' },
	{ open: '(', close: ')', shape: 'round' },
	{ open: '{', close: '}', shape: 'diamond' },
	{ open: '>', close: ']', shape: 'asymmetric' },
];

/** 解析一个节点引用：`A`、`A[Label]`、`A((Label))`、`A:::class`。 */
export function parseNodeRef(text: string): NodeRef | undefined {
	let value = text.trim().replace(/;+$/, '').trim();
	// Mermaid v10+ 的 `A:::className`、`A:::a,b`
	value = value.replace(/\s*:::[^:]+$/, '').trim();
	if (!value) {
		return undefined;
	}
	// 以 @{ ... } 的新形状语法结尾时，取 label 字段。
	const atShape = /^([A-Za-z_一-鿿][\w一-鿿.-]*)\s*@\{(.*)\}\s*$/s.exec(value);
	if (atShape) {
		const labelMatch = /label\s*:\s*("([^"]*)"|[^,}]+)/.exec(atShape[2]);
		const label = labelMatch ? decodeLabel(labelMatch[2] ?? labelMatch[1]) : atShape[1];
		return { id: atShape[1], label: label || atShape[1], shape: 'box', explicitLabel: true };
	}

	const idMatch = /^([A-Za-z_一-鿿][\w一-鿿.-]*)/.exec(value);
	if (!idMatch) {
		return undefined;
	}
	const id = idMatch[1];
	const rest = value.slice(id.length).trim();
	if (!rest) {
		return { id, label: id, explicitLabel: false };
	}
	for (const candidate of NODE_SHAPES) {
		if (rest.startsWith(candidate.open) && rest.endsWith(candidate.close)) {
			const inner = rest.slice(candidate.open.length, rest.length - candidate.close.length);
			return {
				id,
				label: decodeLabel(inner) || id,
				shape: candidate.shape,
				explicitLabel: true,
			};
		}
	}
	// 不是已知形状：至少保住 id（例如节点后面跟了样式）
	return { id, label: id, explicitLabel: false };
}

function parseSide(text: string): NodeRef[] {
	return splitAmpersand(text)
		.map(part => parseNodeRef(part))
		.filter((ref): ref is NodeRef => ref !== undefined);
}

/**
 * Mermaid 允许把箭头画得更长：`---->`、`====>`、`<---->`、`----o` 等。
 * 这里按「2–8 个横线 / 等号 + 端点」生成组合，匹配时按长度从长到短尝试，
 * 避免 `---->` 被拆成 `---` + `->` 导致整条语句丢节点。
 */
function buildFlowArrows(): string[] {
	const arrows = new Set<string>();
	for (let count = 2; count <= 8; count += 1) {
		const dash = '-'.repeat(count);
		const equal = '='.repeat(count);
		arrows.add(`${dash}>`);
		arrows.add(`${dash}o`);
		arrows.add(`${dash}x`);
		arrows.add(`<${dash}>`);
		arrows.add(`<${dash}`);
		arrows.add(`${equal}>`);
		arrows.add(`<${equal}>`);
		arrows.add(`<${equal}`);
		// 无边界的 `--` / `==` 不是 Mermaid 链接（裸横线至少 3 个），
		// 加进来会把 `my--node` 这类节点 id 误切。
		if (count >= 3) {
			arrows.add(dash);
			arrows.add(equal);
		}
	}
	for (const arrow of [
		'<==>', '<-.->', '<-->', '<-.-', 'x--x', 'o--o', 'o--', 'x--', '-->>',
		'<-..->', '-..->', '-.->', '-.-', '~~~', '--|>', '~~',
	]) {
		arrows.add(arrow);
	}
	return [...arrows];
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 粘性匹配：只在当前字符位置开始尝试，供逐字符扫描使用。 */
const FLOW_ARROW_RE = new RegExp(
	`(${buildFlowArrows().sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escapeRegExp).join('|')})\\s*(?:\\|([^|]*)\\|)?`,
	'y',
);

interface FlowArrowStyle {
	readonly dashed: boolean;
	readonly arrow: ArrowKind;
	/** 箭头 / 端点在左侧时，视觉方向与书写方向相反，建边时要交换首尾。 */
	readonly swap: boolean;
}

function classifyFlowArrow(arrow: string): FlowArrowStyle {
	const dashed = arrow.includes('.');
	const hasLeft = arrow.startsWith('<');
	const hasRight = arrow.endsWith('>') || arrow.endsWith(')') || arrow.endsWith(']') || arrow.endsWith('|>');
	const hasCircle = /[ox]/.test(arrow.replace(/^-+/, '').replace(/-+$/, ''));
	const leftEnd = arrow.startsWith('o') || arrow.startsWith('x');
	const rightEnd = arrow.endsWith('o') || arrow.endsWith('x');
	if (/^(?:-{2,}|={2,}|~{2,})$/.test(arrow)) {
		return { dashed, arrow: 'none', swap: false };
	}
	const kind: ArrowKind = hasLeft && hasRight
		? 'both'
		: hasCircle
			? (rightEnd
				? (arrow.endsWith('x') ? 'cross' : 'circle')
				: (arrow.startsWith('x') ? 'cross' : 'circle'))
			: hasRight || hasLeft || arrow.startsWith('--') || arrow.startsWith('==') || arrow.startsWith('~')
				? 'arrow'
				: 'none';
	return {
		dashed,
		arrow: kind,
		swap: kind !== 'both' && kind !== 'none' && (hasLeft || (leftEnd && !rightEnd)),
	};
}

/**
 * 把带文字的链接统一成 `箭头|文字|` 形式：
 *   - `A -- 文字 --> B` / `A --- 文字 ---> B` / `A == 文字 ===> B`
 *   - `A --- 文字 --- B` / `A === 文字 === B`（无箭头开放链接）
 *   - `A -. 文字 .-> B`
 */
function normalizeLabeledArrows(line: string): string {
	return line
		.replace(/(^|\s)-{2,}\s+([^|\n>]+?)\s+(-{2,}>)/g,
			(_whole, lead: string, label: string, arrow: string) => `${lead}${arrow}|${label.trim()}|`)
		.replace(/(^|\s)={2,}\s+([^|\n>]+?)\s+(={2,}>)/g,
			(_whole, lead: string, label: string, arrow: string) => `${lead}${arrow}|${label.trim()}|`)
		.replace(/(^|\s)-\.\s+([^|\n]+?)\s+\.->/g,
			(_whole, lead: string, label: string) => `${lead}-.->|${label.trim()}|`)
		.replace(/(^|\s)-{3,}\s+([^|\n>]+?)\s+-{3,}(?!>)/g,
			(_whole, lead: string, label: string) => `${lead}---|${label.trim()}|`)
		.replace(/(^|\s)={3,}\s+([^|\n>]+?)\s+={3,}(?!>)/g,
			(_whole, lead: string, label: string) => `${lead}===|${label.trim()}|`);
}

/**
 * 按「括号外、引号外的箭头」切分流程语句。
 *
 * `A["a --> b"] --> B` 里的 `-->` 是标签内容，不能当作边；旧的全局正则会把
 * 它切开，凭空造出 `b"]` 之类的节点。这里逐字符跟踪 `[] () {}` 深度与双引号，
 * 只在顶层尝试粘性匹配箭头。
 */
function splitFlowChain(statement: string): { segments: string[]; arrows: string[]; labels: Array<string | undefined> } {
	const segments: string[] = [];
	const arrows: string[] = [];
	const labels: Array<string | undefined> = [];
	let lastIndex = 0;
	let depth = 0;
	let inQuote = false;
	for (let index = 0; index < statement.length; index += 1) {
		const char = statement[index];
		if (char === '"' && statement[index - 1] !== '\\') {
			inQuote = !inQuote;
			continue;
		}
		if (inQuote) {
			continue;
		}
		if (char === '[' || char === '(' || char === '{') {
			depth += 1;
			continue;
		}
		if (char === ']' || char === ')' || char === '}') {
			depth = Math.max(0, depth - 1);
			continue;
		}
		if (depth > 0) {
			continue;
		}
		FLOW_ARROW_RE.lastIndex = index;
		const match = FLOW_ARROW_RE.exec(statement);
		if (!match) {
			continue;
		}
		segments.push(statement.slice(lastIndex, index).trim());
		arrows.push(match[1]);
		labels.push(match[2] !== undefined ? decodeLabel(match[2]) : undefined);
		lastIndex = FLOW_ARROW_RE.lastIndex;
		index = lastIndex - 1;
	}
	segments.push(statement.slice(lastIndex).trim());
	return { segments, arrows, labels };
}

function parseFlowchain(state: ParseState, statement: string): void {
	const normalized = normalizeLabeledArrows(statement);
	const { segments, arrows, labels } = splitFlowChain(normalized);

	if (segments.length === 1) {
		for (const ref of parseSide(segments[0])) {
			ensureNode(state, ref);
		}
		return;
	}

	for (let index = 0; index < segments.length - 1; index += 1) {
		const left = parseSide(segments[index]);
		const right = parseSide(segments[index + 1]);
		if (left.length === 0 || right.length === 0) {
			continue;
		}
		for (const source of left) {
			ensureNode(state, source);
		}
		for (const target of right) {
			ensureNode(state, target);
		}
		const style = classifyFlowArrow(arrows[index] ?? '-->');
		for (const source of left) {
			for (const target of right) {
				addEdge(state, {
					source: style.swap ? target.id : source.id,
					target: style.swap ? source.id : target.id,
					label: labels[index],
					dashed: style.dashed,
					arrow: style.arrow,
					group: currentGroup(state),
				});
			}
		}
	}
}

function parseFlowchart(lines: readonly string[], headTitle?: string): ParsedGraph {
	const state = createState();
	const first = firstMeaningful(lines);
	const directionMatch = /^(?:flowchart|graph)(?:-elk)?\s+(TB|TD|BT|LR|RL)?/i.exec(first);
	let direction: 'TB' | 'BT' | 'LR' | 'RL' = 'TB';
	if (directionMatch?.[1]) {
		direction = directionMatch[1].toUpperCase() === 'TD' ? 'TB' : directionMatch[1].toUpperCase() as 'TB' | 'BT' | 'LR' | 'RL';
	}

	let groupCounter = 0;
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line) {
			continue;
		}
		if (/^(?:flowchart|graph)(?:-elk)?\b/i.test(line)) {
			continue;
		}
		if (/^(?:classDef|class\s|style\s|linkStyle|click\s|accTitle|accDescr|direction\s)/i.test(line)) {
			continue;
		}
		const subgraph = /^subgraph\s+(.*)$/i.exec(line);
		if (subgraph) {
			groupCounter += 1;
			const body = subgraph[1].trim();
			const bracket = /^([^\s[]+)\s*\[(.*)\]$/.exec(body);
			const id = bracket ? bracket[1] : `subgraph-${groupCounter}`;
			const label = bracket ? decodeLabel(bracket[2]) : decodeLabel(body) || id;
			addGroup(state, id, label);
			continue;
		}
		if (/^end\s*$/i.test(line)) {
			state.groupStack.pop();
			continue;
		}
		for (const statement of splitStatements(line)) {
			parseFlowchain(state, statement);
		}
	}

	return stateToGraph(state, 'flowchart', {
		direction,
		title: headTitle ?? extractTitleDirective(lines),
		note: state.nodes.size === 0 ? '没有解析出流程图节点。' : undefined,
	});
}

function parseSequence(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const order: string[] = [];
	const register = (id: string, label: string): void => {
		if (!state.nodes.has(id)) {
			state.nodes.set(id, { id, label: label.slice(0, 240) });
			order.push(id);
		} else if (label !== id) {
			const existing = state.nodes.get(id)!;
			if (existing.label === id) {
				state.nodes.set(id, { ...existing, label });
			}
		}
	};

	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^sequenceDiagram\b/i.test(line)) {
			continue;
		}
		const participant = /^(?:participant|actor|create\s+participant|create\s+actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/i.exec(line);
		if (participant) {
			register(participant[1], participant[2] ? decodeLabel(participant[2]) : participant[1]);
			continue;
		}
		if (/^(?:autonumber|activate|deactivate|destroy|box|end\b|loop\b|alt\b|opt\b|par\b|critical\b|break\b|rect\b|else\b)/i.test(line)) {
			continue;
		}
		if (/^note\s+/i.test(line)) {
			continue;
		}
		const message = /^([^\s:]+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))([+-]?)\s*([^\s:]+?)\s*:\s*(.*)$/.exec(line);
		if (!message) {
			continue;
		}
		const source = message[1];
		const arrow = message[2];
		const target = message[4];
		const label = decodeLabel(message[5]);
		register(source, source);
		register(target, target);
		addEdge(state, {
			source,
			target,
			label: label || undefined,
			dashed: arrow.startsWith('--'),
			arrow: arrow.includes('x') ? 'cross' : 'arrow',
		});
	}

	// Map 插入顺序与 order 一致；显式按 order 输出，避免 later label update 影响顺序。
	const nodes = order.map(id => state.nodes.get(id)).filter((node): node is GraphNode => node !== undefined);
	return {
		kind: 'sequence',
		nodes,
		edges: state.edges,
		direction: 'LR',
		note: nodes.length === 0 ? '没有解析出参与者与消息。' : undefined,
	};
}

const CLASS_OPS = ['<|..', '<|--', '*--', 'o--', '..|>', '..>', '-->', '--', '..', '*..', 'o..'];

function parseClass(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const labels = new Map<string, string>();
	const detail = new Map<string, string[]>();
	let classBlock: string | null = null;
	let namespaceDepth = 0;

	const ensureClass = (name: string, label?: string): void => {
		const id = name.trim();
		if (!id) {
			return;
		}
		if (!state.nodes.has(id)) {
			state.nodes.set(id, { id, label: (label ?? id).slice(0, 240), shape: 'box', group: currentGroup(state) });
		} else if (label) {
			const existing = state.nodes.get(id)!;
			state.nodes.set(id, { ...existing, label });
		}
		if (label) {
			labels.set(id, label);
		}
	};

	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^classDiagram\b/i.test(line)) {
			continue;
		}
		if (classBlock !== null) {
			if (line === '}') {
				classBlock = null;
				continue;
			}
			const members = detail.get(classBlock) ?? [];
			members.push(line);
			detail.set(classBlock, members.slice(0, 20));
			continue;
		}
		const namespace = /^namespace\s+(\S+)\s*\{$/.exec(line);
		if (namespace) {
			addGroup(state, `ns:${namespace[1]}`, namespace[1]);
			namespaceDepth += 1;
			continue;
		}
		if (namespaceDepth > 0 && line === '}') {
			state.groupStack.pop();
			namespaceDepth -= 1;
			continue;
		}
		const classDef = /^class\s+(\S+?)(?:\[([^\]]*)\])?\s*(\{)?$/.exec(line);
		if (classDef) {
			const name = classDef[1].replace(/:::.*$/, '');
			ensureClass(name, classDef[2] !== undefined ? decodeLabel(classDef[2]) : labels.get(name));
			if (classDef[3]) {
				classBlock = name;
			}
			continue;
		}
		const member = /^(\S+)\s*:\s*(.+)$/.exec(line);
		if (member && !CLASS_OPS.some(op => member[2].includes(op))) {
			ensureClass(member[1]);
			const members = detail.get(member[1]) ?? [];
			members.push(member[2].trim());
			detail.set(member[1], members.slice(0, 20));
			continue;
		}
		const relation = /^(\S+)\s+(?:"[^"]*"\s+)?(<\|\.\.|<\|--|\*--|o--|\.\.\|>|\.\.>|-->|--|\.\.|\*\.\.|o\.\.)\s+(?:"[^"]*"\s+)?(\S+?)(?:\s*:\s*(.*))?$/.exec(line);
		if (relation) {
			let left = relation[1];
			let right = relation[3];
			const op = relation[2];
			const label = relation[4] ? decodeLabel(relation[4]) : undefined;
			if (op.startsWith('<')) {
				// `A <|-- B`：B 继承 A，布局上把箭头朝父类。
				const swap = left;
				left = right;
				right = swap;
			}
			ensureClass(left);
			ensureClass(right);
			addEdge(state, {
				source: left,
				target: right,
				label,
				dashed: op.includes('..'),
				arrow: op === '--' || op === '..' ? 'none' : 'arrow',
				group: currentGroup(state),
			});
			continue;
		}
		if (/^(?:note\s|direction\s|classDef\s|style\s|%%|click\s|link\s)/i.test(line)) {
			continue;
		}
		// 单独的类名（有些图先声明再连线）
		if (/^[A-Za-z_一-鿿][\w一-鿿.~-]*$/.test(line)) {
			ensureClass(line);
		}
	}

	for (const [id, members] of detail) {
		const node = state.nodes.get(id);
		if (node && members.length > 0) {
			state.nodes.set(id, { ...node, detail: members });
		}
	}
	return stateToGraph(state, 'class', {
		direction: 'TB',
		note: state.nodes.size === 0 ? '没有解析出类节点。' : undefined,
	});
}

function parseStateDiagram(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const stateLabels = new Map<string, string>();
	const detail = new Map<string, string[]>();
	let composite: string | null = null;

	const ensureState = (rawId: string, label?: string): string => {
		const id = rawId.trim();
		if (id === '[*]') {
			return '[*]';
		}
		if (!state.nodes.has(id)) {
			state.nodes.set(id, { id, label: (label ?? stateLabels.get(id) ?? id).slice(0, 240), shape: 'round', group: currentGroup(state) });
		} else if (label && label !== id) {
			const existing = state.nodes.get(id)!;
			state.nodes.set(id, { ...existing, label });
		}
		return id;
	};

	let startSeen = false;
	let endSeen = false;

	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^stateDiagram(?:-v2)?\b/i.test(line)) {
			continue;
		}
		if (composite !== null && line === '}') {
			state.groupStack.pop();
			composite = null;
			continue;
		}
		const compositeStart = /^state\s+(\S+)\s*\{$/.exec(line);
		if (compositeStart) {
			ensureState(compositeStart[1], stateLabels.get(compositeStart[1]));
			addGroup(state, `state:${compositeStart[1]}`, stateLabels.get(compositeStart[1]) ?? compositeStart[1]);
			composite = compositeStart[1];
			continue;
		}
		const declaration = /^state\s+"([^"]*)"\s+as\s+(\S+)$/.exec(line);
		if (declaration) {
			stateLabels.set(declaration[2], decodeLabel(declaration[1]));
			ensureState(declaration[2], decodeLabel(declaration[1]));
			continue;
		}
		const simpleState = /^state\s+(\S+)$/.exec(line);
		if (simpleState) {
			ensureState(simpleState[1]);
			continue;
		}
		// 转换必须先于 `A : 描述`，否则 `A --> B : label` 会被切成
		// `A` + `--> B : label` 的“描述”。
		const transition = /^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.*))?$/.exec(line);
		if (transition) {
			const sourceRaw = transition[1].trim();
			const targetRaw = transition[2].trim();
			if (sourceRaw === '[*]') {
				startSeen = true;
			}
			if (targetRaw === '[*]') {
				endSeen = true;
			}
			const source = sourceRaw === '[*]' ? '[*]' : ensureState(sourceRaw);
			const target = targetRaw === '[*]' ? '[*]' : ensureState(targetRaw);
			addEdge(state, {
				source,
				target,
				label: transition[3] ? decodeLabel(transition[3]) : undefined,
				arrow: 'arrow',
				group: currentGroup(state),
			});
			continue;
		}
		const description = /^(\S+)\s*:\s*(.+)$/.exec(line);
		if (description) {
			ensureState(description[1]);
			const items = detail.get(description[1]) ?? [];
			items.push(description[2].trim());
			detail.set(description[1], items.slice(0, 20));
			continue;
		}
		if (/^(?:note\s|direction\s|classDef\s|class\s+)/i.test(line)) {
			continue;
		}
	}

	// 起点 / 终点分开：同一个 [*] 既可能是入边起点也可能是出边终点。
	state.edges.forEach((edge, index) => {
		const source = edge.source === '[*]' ? '[start]' : edge.source;
		const target = edge.target === '[*]' ? '[end]' : edge.target;
		state.edges[index] = { ...edge, source, target };
	});
	if (startSeen) {
		state.nodes.set('[start]', { id: '[start]', label: '●', shape: 'state-start' });
	}
	if (endSeen) {
		state.nodes.set('[end]', { id: '[end]', label: '◉', shape: 'state-end' });
	}

	for (const [id, members] of detail) {
		const node = state.nodes.get(id);
		if (node && members.length > 0) {
			state.nodes.set(id, { ...node, detail: members });
		}
	}
	return stateToGraph(state, 'state', { direction: 'TB', note: state.nodes.size === 0 ? '没有解析出状态节点。' : undefined });
}

function parseEr(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const detail = new Map<string, string[]>();
	let block: string | null = null;

	const ensureEntity = (name: string): void => {
		if (!name) {
			return;
		}
		if (!state.nodes.has(name)) {
			state.nodes.set(name, { id: name, label: name, shape: 'box', group: currentGroup(state) });
		}
	};

	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^erDiagram\b/i.test(line)) {
			continue;
		}
		if (block !== null) {
			if (line === '}') {
				block = null;
				continue;
			}
			const items = detail.get(block) ?? [];
			items.push(line);
			detail.set(block, items.slice(0, 24));
			continue;
		}
		const entityBlock = /^(\S+)\s*\{$/.exec(line);
		if (entityBlock) {
			block = entityBlock[1];
			ensureEntity(block);
			continue;
		}
		const relation = /^(\S+)\s+([|}{o]+)(--|\.\.)([|}{o]+)\s+(\S+)(?:\s*:\s*(.*))?$/.exec(line);
		if (relation) {
			const left = relation[1];
			const right = relation[5];
			ensureEntity(left);
			ensureEntity(right);
			addEdge(state, {
				source: left,
				target: right,
				label: relation[6] ? decodeLabel(relation[6]) : undefined,
				dashed: relation[3] === '..',
				arrow: 'none',
			});
			continue;
		}
		if (/^[A-Z][A-Z0-9_]*$/.test(line)) {
			ensureEntity(line);
		}
	}

	for (const [id, members] of detail) {
		const node = state.nodes.get(id);
		if (node && members.length > 0) {
			state.nodes.set(id, { ...node, detail: members });
		}
	}
	return stateToGraph(state, 'er', { direction: 'TB', note: state.nodes.size === 0 ? '没有解析出实体。' : undefined });
}

function stripMindmapWrapper(raw: string): string {
	let value = raw.trim();
	// 去掉 `::icon(...)` 这类修饰
	value = value.replace(/::icon\([^)]*\)/g, '').trim();

	const wrappers: ReadonlyArray<{ open: string; close: string }> = [
		{ open: '(((', close: ')))' },
		{ open: '((', close: '))' },
		{ open: '[[', close: ']]' },
		{ open: '{{', close: '}}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '))', close: '((' },
		{ open: ')', close: '(' },
	];
	for (const wrapper of wrappers) {
		if (value.startsWith(wrapper.open) && value.endsWith(wrapper.close)) {
			return decodeLabel(value.slice(wrapper.open.length, value.length - wrapper.close.length));
		}
	}
	// `id[文本]` / `id(文本)`：mindmap 也允许带 id 的形状写法。
	const idShape = /^[\w.-]+\s*(\[.*\]|\(.*\)|\{\{.*\}\}|\(\(.*\)\))$/s.exec(value);
	if (idShape) {
		return stripMindmapWrapper(idShape[1]);
	}
	return decodeLabel(value);
}

function parseMindmap(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const stack: Array<{ indent: number; id: string }> = [];
	let truncated = false;
	for (const rawLine of lines) {
		const line = stripComment(rawLine).replace(/\s+$/, '');
		if (!line.trim() || /^mindmap\b/i.test(line.trim())) {
			continue;
		}
		const indent = /^\s*/.exec(line)?.[0].length ?? 0;
		const label = stripMindmapWrapper(line.trim()) || line.trim();
		if (state.nodes.size >= MAX_NODES) {
			truncated = true;
			break;
		}
		const id = `m${state.nodes.size}`;
		while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}
		const parent = stack.length > 0 ? stack[stack.length - 1].id : undefined;
		state.nodes.set(id, { id, label: label.slice(0, 240) });
		if (parent) {
			addEdge(state, { source: parent, target: id });
		}
		stack.push({ indent, id });
	}
	return {
		kind: 'mindmap',
		nodes: [...state.nodes.values()],
		edges: state.edges,
		direction: 'TB',
		note: state.nodes.size === 0
			? '没有解析出思维导图节点。'
			: truncated ? TRUNCATION_NOTE : undefined,
	};
}

function parseGitGraph(lines: readonly string[], headTitle?: string): ParsedGraph {
	const state = createState();
	const branchLast = new Map<string, string>();
	let current = 'main';
	let commitCounter = 0;
	let direction: 'TB' | 'LR' = 'TB';
	const first = firstMeaningful(lines);
	const directionMatch = /gitGraph\s+(TB|BT|LR|RL)\s*:?/i.exec(first);
	if (directionMatch) {
		direction = directionMatch[1].toUpperCase() === 'LR' || directionMatch[1].toUpperCase() === 'RL' ? 'LR' : 'TB';
	}

	const addCommit = (label: string, detail?: string[]): string => {
		commitCounter += 1;
		const id = `c${commitCounter}`;
		state.nodes.set(id, { id, label: label.slice(0, 240), detail: detail && detail.length > 0 ? detail : undefined });
		return id;
	};

	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^gitGraph\b/i.test(line)) {
			continue;
		}
		if (/^commit\b/i.test(line)) {
			const id = /\bid\s*:\s*("([^"]*)"|([\w.-]+))/.exec(line);
			const message = /\b(?:message|msg)\s*:\s*"([^"]*)"/.exec(line);
			const tag = /\btag\s*:\s*"([^"]*)"/.exec(line);
			const commitId = id ? (id[2] ?? id[3]) : undefined;
			const label = message?.[1] ?? commitId ?? `commit ${commitCounter + 1}`;
			const detail: string[] = [];
			if (commitId) {
				detail.push(`id: ${commitId}`);
			}
			if (tag?.[1]) {
				detail.push(`tag: ${tag[1]}`);
			}
			const nodeId = addCommit(label, detail);
			const last = branchLast.get(current);
			if (last) {
				addEdge(state, { source: last, target: nodeId, arrow: 'arrow' });
			}
			branchLast.set(current, nodeId);
			continue;
		}
		const branch = /^branch\s+(\S+)/i.exec(line);
		if (branch) {
			branchLast.set(branch[1], branchLast.get(current) ?? '');
			continue;
		}
		const checkout = /^(?:checkout|switch)\s+(\S+)/i.exec(line);
		if (checkout) {
			current = checkout[1];
			if (!branchLast.has(current)) {
				branchLast.set(current, branchLast.get('main') ?? '');
			}
			continue;
		}
		const merge = /^merge\s+(\S+)/i.exec(line);
		if (merge) {
			const nodeId = addCommit(`merge ${merge[1]}`);
			const left = branchLast.get(current);
			const right = branchLast.get(merge[1]);
			if (left) {
				addEdge(state, { source: left, target: nodeId, arrow: 'arrow' });
			}
			if (right && right !== left) {
				addEdge(state, { source: right, target: nodeId, arrow: 'arrow', dashed: true });
			}
			branchLast.set(current, nodeId);
			continue;
		}
		// cherry-pick / tag / %%{...} 等忽略
	}
	return {
		kind: 'gitgraph',
		nodes: [...state.nodes.values()],
		edges: state.edges,
		direction,
		title: headTitle ?? extractTitleDirective(lines),
		note: state.nodes.size === 0 ? '没有解析出提交节点。' : undefined,
	};
}

function parseJourney(lines: readonly string[]): ParsedGraph {
	const state = createState();
	let group: string | undefined;
	let sectionCounter = 0;
	let previous: string | undefined;
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^journey\b/i.test(line) || /^title\b/i.test(line)) {
			continue;
		}
		const section = /^section\s+(.+)$/i.exec(line);
		if (section) {
			sectionCounter += 1;
			group = `journey-section-${sectionCounter}`;
			state.groups.push({ id: group, label: decodeLabel(section[1]) });
			previous = undefined;
			continue;
		}
		const task = /^(.+?)\s*:\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
		if (task) {
			const id = `j${state.nodes.size}`;
			state.nodes.set(id, {
				id,
				label: decodeLabel(task[1]).slice(0, 240),
				group,
				detail: [`评分 ${task[2].trim()}`, decodeLabel(task[3])],
			});
			if (previous) {
				addEdge(state, { source: previous, target: id, arrow: 'arrow' });
			}
			previous = id;
		}
	}
	return {
		kind: 'journey',
		nodes: [...state.nodes.values()],
		edges: state.edges,
		groups: state.groups.length > 0 ? state.groups : undefined,
		direction: 'LR',
		note: state.nodes.size === 0 ? '没有解析出旅程任务。' : undefined,
	};
}

function parseGantt(lines: readonly string[]): ParsedGraph {
	const state = createState();
	let group: string | undefined;
	let sectionCounter = 0;
	let previous: string | undefined;
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^gantt\b/i.test(line) || /^(?:title|dateFormat|axisFormat|excludes|todayMarker|tickInterval|weekday)\b/i.test(line)) {
			continue;
		}
		const section = /^section\s+(.+)$/i.exec(line);
		if (section) {
			sectionCounter += 1;
			group = `gantt-section-${sectionCounter}`;
			state.groups.push({ id: group, label: decodeLabel(section[1]) });
			previous = undefined;
			continue;
		}
		const task = /^(.+?)\s*:\s*(.+)$/.exec(line);
		if (task) {
			const id = `g${state.nodes.size}`;
			state.nodes.set(id, {
				id,
				label: decodeLabel(task[1]).slice(0, 240),
				group,
				detail: [task[2].trim()],
			});
			if (previous) {
				addEdge(state, { source: previous, target: id, arrow: 'arrow' });
			}
			previous = id;
		}
	}
	return {
		kind: 'gantt',
		nodes: [...state.nodes.values()],
		edges: state.edges,
		groups: state.groups.length > 0 ? state.groups : undefined,
		direction: 'LR',
		note: state.nodes.size === 0 ? '没有解析出甘特任务。' : undefined,
	};
}

function parseTimeline(lines: readonly string[]): ParsedGraph {
	const state = createState();
	let group: string | undefined;
	let sectionCounter = 0;
	let previous: string | undefined;
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^timeline\b/i.test(line) || /^title\b/i.test(line)) {
			continue;
		}
		const section = /^section\s+(.+)$/i.exec(line);
		if (section) {
			sectionCounter += 1;
			group = `timeline-section-${sectionCounter}`;
			state.groups.push({ id: group, label: decodeLabel(section[1]) });
			previous = undefined;
			continue;
		}
		const parts = line.split(':').map(part => part.trim()).filter(part => part.length > 0);
		if (parts.length === 0) {
			continue;
		}
		const period = parts[0];
		const events = parts.length > 1 ? parts.slice(1) : [period];
		for (const event of events) {
			const id = `t${state.nodes.size}`;
			state.nodes.set(id, {
				id,
				label: (parts.length > 1 ? `${period} · ${event}` : event).slice(0, 240),
				group,
			});
			if (previous) {
				addEdge(state, { source: previous, target: id, arrow: 'arrow' });
			}
			previous = id;
		}
	}
	return {
		kind: 'timeline',
		nodes: [...state.nodes.values()],
		edges: state.edges,
		groups: state.groups.length > 0 ? state.groups : undefined,
		direction: 'LR',
		note: state.nodes.size === 0 ? '没有解析出时间线节点。' : undefined,
	};
}

function parsePie(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const firstLine = firstMeaningful(lines);
	const inlineTitle = /^pie\s+(?:showData\s+)?title\s+(.+)$/i.exec(firstLine);
	const title = inlineTitle ? decodeLabel(inlineTitle[1]) : extractTitleDirective(lines);
	const rootId = 'pie-root';
	const rootLabel = title ?? '饼图';
	state.nodes.set(rootId, { id: rootId, label: rootLabel });
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^pie\b/i.test(line) || /^title\b/i.test(line) || /^showData\b/i.test(line)) {
			continue;
		}
		const slice = /^"([^"]*)"\s*:\s*([\d.]+)$/.exec(line) ?? /^(.+?)\s*:\s*([\d.]+)$/.exec(line);
		if (!slice) {
			continue;
		}
		const id = `p${state.nodes.size}`;
		state.nodes.set(id, {
			id,
			label: `${decodeLabel(slice[1])} · ${slice[2]}`.slice(0, 240),
			group: rootId,
		});
		addEdge(state, { source: rootId, target: id, arrow: 'none' });
	}
	return {
		kind: 'pie',
		nodes: [...state.nodes.values()],
		edges: state.edges,
		direction: 'TB',
		title,
		note: state.nodes.size <= 1 ? '没有解析出饼图分片。' : undefined,
	};
}

function parseQuadrant(lines: readonly string[]): ParsedGraph {
	const state = createState();
	const title = extractTitleDirective(lines);
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^quadrantChart\b/i.test(line) || /^title\b/i.test(line)) {
			continue;
		}
		const point = /^(.+?)\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]$/.exec(line);
		if (point) {
			const id = `q${state.nodes.size}`;
			state.nodes.set(id, {
				id,
				label: decodeLabel(point[1]).slice(0, 240),
				detail: [`x ${point[2]} / y ${point[3]}`],
			});
			continue;
		}
		const quadrant = /^quadrant-\d\s+(.+)$/i.exec(line);
		if (quadrant) {
			state.groups.push({ id: `qg${state.groups.length}`, label: decodeLabel(quadrant[1]) });
		}
	}
	return {
		kind: 'quadrant',
		nodes: [...state.nodes.values()],
		edges: [],
		groups: state.groups.length > 0 ? state.groups : undefined,
		title,
		note: state.nodes.size === 0 ? '没有解析出象限点。' : undefined,
	};
}

function parseGeneric(lines: readonly string[], kind: GraphKind): ParsedGraph {
	const state = createState();
	let previous: string | undefined;
	let truncated = false;
	for (const rawLine of lines) {
		const line = stripComment(rawLine).trim();
		if (!line || /^(?:%%|classDef|style|title|accTitle|accDescr|direction)\b/i.test(line)) {
			continue;
		}
		// 未知图种里的复合块：单独的花括号行不是内容。
		if (/^[{}]+$/.test(line)) {
			continue;
		}
		if (/^(?:sequenceDiagram|flowchart|graph|classDiagram|stateDiagram(?:-v2)?|erDiagram|mindmap|gitGraph|journey|gantt|timeline|pie|quadrantChart|requirementDiagram|C4Context|sankey-beta|block-beta|architecture-beta|packet-beta|xychart-beta)\b/i.test(line)) {
			continue;
		}
		if (state.nodes.size >= MAX_NODES) {
			truncated = true;
			break;
		}
		const id = `u${state.nodes.size}`;
		state.nodes.set(id, { id, label: decodeLabel(line).slice(0, 240) });
		if (previous) {
			addEdge(state, { source: previous, target: id, arrow: 'arrow' });
		}
		previous = id;
	}
	const baseNote = state.nodes.size === 0
		? '该图种没有解析出可显示的节点。'
		: `「${kind}」使用通用兜底解析（按行串成链）。`;
	return {
		kind,
		nodes: [...state.nodes.values()],
		edges: state.edges,
		direction: 'LR',
		note: truncated ? `${baseNote} ${TRUNCATION_NOTE}` : baseNote,
	};
}

function detectKind(head: string): GraphKind {
	const lower = head.toLowerCase();
	if (/^(?:flowchart|graph)(?:-elk)?\b/.test(lower)) {
		return 'flowchart';
	}
	if (/^sequencediagram\b/.test(lower)) {
		return 'sequence';
	}
	if (/^classdiagram\b/.test(lower)) {
		return 'class';
	}
	if (/^statediagram(?:-v2)?\b/.test(lower)) {
		return 'state';
	}
	if (/^erdiagram\b/.test(lower)) {
		return 'er';
	}
	if (/^mindmap\b/.test(lower)) {
		return 'mindmap';
	}
	if (/^gitgraph\b/.test(lower)) {
		return 'gitgraph';
	}
	if (/^journey\b/.test(lower)) {
		return 'journey';
	}
	if (/^gantt\b/.test(lower)) {
		return 'gantt';
	}
	if (/^timeline\b/.test(lower)) {
		return 'timeline';
	}
	if (/^pie\b/.test(lower)) {
		return 'pie';
	}
	if (/^quadrantchart\b/.test(lower)) {
		return 'quadrant';
	}
	return 'unknown';
}

/**
 * 所有图种共用的一道兜底：
 *   - 节点数超过 MAX_NODES 时截断（布局是 O(n²) 量级，不能让超大图卡死）；
 *   - 去掉两端节点不存在的悬挂边（解析降级 / 截断都可能产生）。
 */
function finalizeGraph(graph: ParsedGraph): ParsedGraph {
	const truncated = graph.nodes.length > MAX_NODES;
	const nodes = truncated ? graph.nodes.slice(0, MAX_NODES) : graph.nodes;
	const ids = new Set(nodes.map(node => node.id));
	const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
	if (!truncated && edges.length === graph.edges.length) {
		return graph;
	}
	const note = truncated
		? (graph.note ? `${graph.note} ${TRUNCATION_NOTE}` : TRUNCATION_NOTE)
		: graph.note;
	return { ...graph, nodes, edges, note };
}

export function parseMermaid(source: string): ParsedGraph {
	resetCommentCapture();
	const { title, body } = splitHead(source);
	const head = firstMeaningful(body);
	const kind = detectKind(head);
	const localTitle = title ?? extractTitleDirective(body);
	// 上面两次预扫描也会调用 stripComment；正式解析前清空，避免注释重复采集。
	resetCommentCapture();
	let graph: ParsedGraph;
	switch (kind) {
		case 'flowchart':
			graph = parseFlowchart(body, localTitle);
			break;
		case 'sequence':
			graph = parseSequence(body);
			break;
		case 'class':
			graph = parseClass(body);
			break;
		case 'state':
			graph = parseStateDiagram(body);
			break;
		case 'er':
			graph = parseEr(body);
			break;
		case 'mindmap':
			graph = parseMindmap(body);
			break;
		case 'gitgraph':
			graph = parseGitGraph(body, localTitle);
			break;
		case 'journey':
			graph = parseJourney(body);
			break;
		case 'gantt':
			graph = parseGantt(body);
			break;
		case 'timeline':
			graph = parseTimeline(body);
			break;
		case 'pie':
			graph = parsePie(body);
			break;
		case 'quadrant':
			graph = parseQuadrant(body);
			break;
		default:
			graph = parseGeneric(body, kind);
			break;
	}
	return finalizeGraph(graph);
}

/**
 * 只取 Mermaid 的标题（frontmatter / title 指令），给 Markdown 元素命名用。
 * 解析器本身也会带 title，但这里避免为了命名重跑整个解析。
 */
export function mermaidTitle(source: string): string | undefined {
	const { title, body } = splitHead(source);
	return title ?? extractTitleDirective(body);
}

export const MERMAID_DIAGRAM_TYPES = [
	'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
	'erDiagram', 'mindmap', 'gitGraph', 'journey', 'gantt', 'timeline', 'pie', 'quadrantChart',
	'requirementDiagram', 'C4Context', 'sankey-beta', 'block-beta', 'architecture-beta',
	'packet-beta', 'xychart-beta',
] as const;

// 保留给测试与未来扩展：判断一段文本是否像 Mermaid 图（而不只是代码）。
export function looksLikeMermaid(source: string): boolean {
	const head = firstMeaningful(splitHead(source).body);
	return detectKind(head) !== 'unknown';
}
