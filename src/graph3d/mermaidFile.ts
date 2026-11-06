import { parseMermaid } from './mermaid';
import { kindLabel, type GraphElement, type ParsedGraph } from './types';

/**
 * 独立的 Mermaid 文件（`.mmd` / `.mermaid`）只有一张图，没有 Markdown 围栏
 * 与标题层级可用，所以这里直接把整份源码交给拓扑解析器。
 *
 * 命名规则与 Markdown 里的图元素保持一致：Mermaid frontmatter 的 title >
 * 文件名 > 图种。末尾追加图种，方便在下拉框里一眼分辨。
 */

export interface MermaidFileOptions {
	/** 文件没有 title 时的兜底名（通常是去掉扩展名的文件名）。 */
	readonly fallbackName?: string;
}

function elementName(parsed: ParsedGraph, fallbackName: string | undefined): string {
	const kind = kindLabel(parsed.kind);
	const base = parsed.title?.trim() || fallbackName?.trim() || kind;
	if (base === kind || base.endsWith(` · ${kind}`)) {
		return base;
	}
	return `${base} · ${kind}`;
}

export function extractMermaidFileElements(source: string, options: MermaidFileOptions = {}): GraphElement[] {
	const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	if (!normalized.trim()) {
		return [];
	}
	const parsed = parseMermaid(normalized);
	// 空文件、只有注释 / init 指令的文件没有可浏览的图元素。
	if (parsed.nodes.length === 0) {
		return [];
	}
	return [{
		id: 'g1',
		name: elementName(parsed, options.fallbackName),
		kind: parsed.kind,
		language: 'mermaid',
		line: 1,
		source: normalized,
		direction: parsed.direction,
		nodes: parsed.nodes,
		edges: parsed.edges,
		groups: parsed.groups,
		title: parsed.title,
		note: parsed.note,
	}];
}
