import { isAsciiTreeCommentLine, isAsciiTreeConnectorLine, looksLikeAsciiTree, parseAsciiTree } from './ascii';
import { parseMermaid } from './mermaid';
import { kindLabel, type GraphElement, type ParsedGraph } from './types';

/**
 * 从 Markdown 原文里捞出所有「图元素」：
 *   - 围栏代码块里的 Mermaid（无论哪种图种）
 *   - 围栏代码块里的 ASCII / 制表符树
 *   - 正文里没有围栏的 ASCII 树（保守识别：至少两行连接线，且不能是列表 /
 *     表格 / 引用 / 标题等 Markdown 结构）
 *
 * 命名规则：Mermaid frontmatter 的 title > 最近的 Markdown 标题 > 图里的第一个节点
 * > 文件名。同名元素自动追加 `(2)`、`(3)`，下拉框里永远能区分。
 */

const MAX_ELEMENTS = 200;

/** 正文裸树的语言标记，下游只把它当普通文本。 */
const BARE_TREE_LANGUAGE = 'text';

export interface ExtractOptions {
	/** 文档没有标题、图里也没有可用文字时的兜底名（通常是文件名）。 */
	readonly fallbackName?: string;
}

interface HeadingState {
	/** 下标 = 标题级别 - 1。 */
	readonly byLevel: string[];
}

interface FenceBlock {
	/** 开围栏的 0-based 行号。 */
	readonly openIndex: number;
	readonly language: string;
	readonly source: string;
}

interface BareBlock {
	/** 树第一行的 0-based 行号。 */
	readonly startIndex: number;
	readonly source: string;
}

type Candidate =
	| { readonly kind: 'fence'; readonly index: number; readonly language: string; readonly source: string }
	| { readonly kind: 'bare'; readonly index: number; readonly source: string };

function headingText(state: HeadingState): string | undefined {
	for (let level = state.byLevel.length - 1; level >= 0; level -= 1) {
		const value = state.byLevel[level];
		if (value) {
			return value;
		}
	}
	return undefined;
}

function cleanHeading(text: string): string {
	return text
		.replace(/\s+#+\s*$/, '')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

function uniqueName(base: string, used: Set<string>): string {
	const clean = base.trim() || '图元素';
	if (!used.has(clean)) {
		used.add(clean);
		return clean;
	}
	for (let index = 2; index < 1000; index += 1) {
		const candidate = `${clean} (${index})`;
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
	}
	return clean;
}

function displayName(parsed: ParsedGraph, heading: string | undefined, fallback: string | undefined, isAscii: boolean): string {
	const kind = isAscii ? 'ASCII 树' : parsed.kind === 'unknown' ? 'Mermaid 图' : kindLabel(parsed.kind);
	const firstLabel = parsed.nodes.find(node => node.label.trim().length > 0)?.label.trim();
	const base = (parsed.title && parsed.title.trim())
		|| heading
		|| firstLabel
		|| fallback
		|| kind;
	if (base === kind || base.endsWith(`· ${kind}`)) {
		return base;
	}
	return `${base} · ${kind}`;
}

/** 从围栏 info 字符串里取语言：支持 `mermaid`、`{.mermaid}`、`mermaid {.x}` 等。 */
function fenceLanguage(info: string): string {
	return (info.split(/\s+/)[0] ?? '')
		.replace(/^\{?\.?/, '')
		.replace(/[},].*$/, '')
		.toLowerCase();
}

function parseAsciiElement(
	source: string,
	language: string,
	line: number,
	heading: string | undefined,
	fallbackName: string | undefined,
): { element: Omit<GraphElement, 'id' | 'name'>; baseName: string } | undefined {
	if (!source.trim()) {
		return undefined;
	}
	const parsed = parseAsciiTree(source);
	if (parsed.nodes.length === 0) {
		return undefined;
	}
	return {
		element: {
			kind: 'ascii-tree',
			language: language || BARE_TREE_LANGUAGE,
			line,
			source,
			nodes: parsed.nodes,
			edges: parsed.edges,
			note: parsed.note,
		},
		baseName: displayName(parsed, heading, fallbackName, true),
	};
}

function parseElement(
	source: string,
	language: string,
	line: number,
	heading: string | undefined,
	fallbackName: string | undefined,
): { element: Omit<GraphElement, 'id' | 'name'>; baseName: string } | undefined {
	const trimmed = source.trim();
	if (language === 'mermaid') {
		const parsed = parseMermaid(source);
		return {
			element: {
				kind: parsed.kind,
				language: 'mermaid',
				line,
				source,
				direction: parsed.direction,
				nodes: parsed.nodes,
				edges: parsed.edges,
				groups: parsed.groups,
				title: parsed.title,
				note: parsed.note,
			},
			baseName: displayName(parsed, heading, fallbackName, false),
		};
	}

	if (!trimmed) {
		return undefined;
	}
	const asciiLanguages = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'ascii', 'tree', 'log', 'none']);
	if (asciiLanguages.has(language) && looksLikeAsciiTree(source)) {
		return parseAsciiElement(source, language, line, heading, fallbackName);
	}
	return undefined;
}

/** 扫出所有围栏块及其覆盖的行（未闭合围栏一直覆盖到文末，与既有行为一致）。 */
function scanFences(lines: readonly string[]): { blocks: FenceBlock[]; inFence: boolean[] } {
	const inFence = new Array<boolean>(lines.length).fill(false);
	const blocks: FenceBlock[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (inFence[index]) {
			continue;
		}
		const open = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(lines[index]);
		if (!open) {
			continue;
		}
		const fence = open[1];
		const language = fenceLanguage(open[2].trim());
		inFence[index] = true;
		const body: string[] = [];
		const closeRe = new RegExp(`^\\s*\\${fence[0]}{${fence.length},}\\s*$`);
		let closeIndex = -1;
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			if (closeRe.test(lines[cursor])) {
				closeIndex = cursor;
				break;
			}
			inFence[cursor] = true;
			body.push(lines[cursor]);
		}
		if (closeIndex >= 0) {
			inFence[closeIndex] = true;
		}
		blocks.push({ openIndex: index, language, source: body.join('\n') });
		index = closeIndex >= 0 ? closeIndex : lines.length;
	}
	return { blocks, inFence };
}

/** 逐行记录「这一行生效的最近 Markdown 标题」，围栏里的标题不算。 */
function headingByLine(lines: readonly string[], inFence: readonly boolean[]): Array<string | undefined> {
	const state: HeadingState = { byLevel: [] };
	const names = new Array<string | undefined>(lines.length);
	for (let index = 0; index < lines.length; index += 1) {
		if (!inFence[index]) {
			const match = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
			if (match) {
				const level = match[1].length;
				state.byLevel.length = Math.max(state.byLevel.length, level);
				state.byLevel[level - 1] = cleanHeading(match[2]);
				for (let deeper = level; deeper < state.byLevel.length; deeper += 1) {
					state.byLevel[deeper] = '';
				}
			}
		}
		names[index] = headingText(state);
	}
	return names;
}

/** 普通 Markdown 结构行不参与正文裸树：列表、引用、标题、表格、HTML、分隔线等。 */
function isMarkdownStructureLine(line: string): boolean {
	return /^\s*#{1,6}\s+/.test(line)          // ATX 标题
		|| /^\s*>/.test(line)                    // 引用
		|| /^\s*(?:[-*+]|\d{1,9}[.)])\s+/.test(line) // 列表
		|| /^\s*</.test(line)                    // HTML
		|| /^\s*\|/.test(line)                   // 表格
		|| /^\s*(?:=+|-+)\s*$/.test(line)        // setext 下划线 / 分隔线
		|| /^\s*\[[^\]]+\]:\s*/.test(line);      // 链接引用定义
}

function isBareTextLine(line: string): boolean {
	return line.trim().length > 0 && !isMarkdownStructureLine(line);
}

function nextIsConnector(lines: readonly string[], index: number, inFence: readonly boolean[]): boolean {
	return index < lines.length && !inFence[index] && isAsciiTreeConnectorLine(lines[index]);
}

/**
 * 正文裸树扫描。
 *
 * 起始条件刻意保守：要么该行本身是连接线，要么它是「根」，且下一行必须是连接线。
 * 这样普通段落、Markdown 列表、表格不会被当成树。块内允许：
 *   - 连接线；
 *   - 缩进的续行；
 *   - 顶格的第二棵树根（森林），但下一行必须又是连接线，避免把树后面的正文
 *     （例如「以上是目录。」）吞进节点。
 * 空行即结束。
 */
function collectBareBlocks(lines: readonly string[], inFence: readonly boolean[]): BareBlock[] {
	const blocks: BareBlock[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (inFence[index] || !lines[index].trim()) {
			continue;
		}
		const startsWithConnector = isAsciiTreeConnectorLine(lines[index]);
		if (!startsWithConnector) {
			if (!isBareTextLine(lines[index]) || !nextIsConnector(lines, index + 1, inFence)) {
				continue;
			}
		}

		const body: string[] = [lines[index]];
		let connectorCount = startsWithConnector ? 1 : 0;
		let cursor = index + 1;
		while (cursor < lines.length && !inFence[cursor] && lines[cursor].trim()) {
			const current = lines[cursor];
			if (isAsciiTreeConnectorLine(current)) {
				body.push(current);
				connectorCount += 1;
				cursor += 1;
				continue;
			}
			// 缩进的注释行属于树（`│   # …` / `    # …`）；顶格 `#` 仍按 Markdown
			// 标题处理，避免把树后面的标题吞进来。
			if (isAsciiTreeCommentLine(current)) {
				body.push(current);
				cursor += 1;
				continue;
			}
			if (!isBareTextLine(current)) {
				break;
			}
			const indented = /^[ \t]/.test(current);
			if (indented || nextIsConnector(lines, cursor + 1, inFence)) {
				body.push(current);
				cursor += 1;
				continue;
			}
			break;
		}

		if (connectorCount >= 2) {
			const source = body.join('\n');
			if (looksLikeAsciiTree(source)) {
				blocks.push({ startIndex: index, source });
			}
		}
		index = cursor - 1;
	}
	return blocks;
}

export function extractGraphElements(markdown: string, options: ExtractOptions = {}): GraphElement[] {
	const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const { blocks: fences, inFence } = scanFences(lines);
	const headings = headingByLine(lines, inFence);
	const bareBlocks = collectBareBlocks(lines, inFence);

	const candidates: Candidate[] = [
		...fences.map(block => ({
			kind: 'fence' as const,
			index: block.openIndex,
			language: block.language,
			source: block.source,
		})),
		...bareBlocks.map(block => ({
			kind: 'bare' as const,
			index: block.startIndex,
			source: block.source,
		})),
	].sort((left, right) => left.index - right.index);

	const usedNames = new Set<string>();
	const elements: GraphElement[] = [];
	for (const candidate of candidates) {
		if (elements.length >= MAX_ELEMENTS) {
			break;
		}
		const line = candidate.index + 1;
		const parsed = candidate.kind === 'bare'
			? parseAsciiElement(candidate.source, BARE_TREE_LANGUAGE, line, headings[candidate.index], options.fallbackName)
			: parseElement(candidate.source, candidate.language, line, headings[candidate.index], options.fallbackName);
		if (!parsed) {
			continue;
		}
		const name = uniqueName(parsed.baseName, usedNames);
		elements.push({ ...parsed.element, id: `g${elements.length + 1}`, name });
	}

	return elements;
}
