import { extractGraphElements } from './markdownElements';
import { extractMermaidFileElements } from './mermaidFile';
import type { GraphElement } from './types';

/**
 * 「3D 可视化浏览」的输入文件类型。
 *
 * Markdown 走围栏 / 裸树扫描，得到多个图元素；独立的 Mermaid 文件整份就是
 * 一张图，得到一个图元素。这一层不 import vscode，宿主与单测共用。
 */

export type GraphSourceKind = 'markdown' | 'mermaid';

export function graphSourceKind(filePath: string): GraphSourceKind | undefined {
	const lower = filePath.toLowerCase().split('?')[0];
	if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
		return 'markdown';
	}
	if (lower.endsWith('.mmd') || lower.endsWith('.mermaid')) {
		return 'mermaid';
	}
	return undefined;
}

export function extractElementsForSource(
	kind: GraphSourceKind,
	text: string,
	fallbackName?: string,
): GraphElement[] {
	return kind === 'mermaid'
		? extractMermaidFileElements(text, { fallbackName })
		: extractGraphElements(text, { fallbackName });
}
