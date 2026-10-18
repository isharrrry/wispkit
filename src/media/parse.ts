/**
 * 源码侧的媒体定位：把"页面上第 N 个图片/图表"映射回 Markdown 原文里的那一段。
 * 纯函数、不依赖 vscode —— webview 里的图片地址是 vscode-webview:// 形式，反解不出真实路径，
 * 所以路径和源码一律回原文里取。
 */

export type MediaKind = 'image' | 'mermaid' | 'drawio' | 'svg';

export interface MediaSource {
	/** 源码里的原始片段（图片是整条 markdown，图表是整段围栏/注释块）。 */
	readonly text: string;
	/** 代码块内容（不含围栏）；图片为 undefined。 */
	readonly body?: string;
	/** 图片目标路径的原始写法。 */
	readonly target?: string;
}

interface Block extends MediaSource {
	readonly start: number;
	readonly end: number;
	readonly alt?: string;
}

/** 围栏代码块：```lang / ~~~lang，闭合用同数量的同种字符。 */
const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
/** drawio 也支持 HTML 注释形式。 */
const DRAWIO_COMMENT = /^[ \t]*<!--\s*drawio:start\s*-->[\s\S]*?<!--\s*drawio:end\s*-->[ \t]*$/gim;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>\n]*>|[^)\n\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*>/gi;
const HTML_IMAGE_SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HTML_IMAGE_ALT = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export function collectFences(text: string, language: string): Block[] {
	const blocks: Block[] = [];
	FENCE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FENCE.exec(text)) !== null) {
		const info = (match[2].trim().split(/\s+/)[0] ?? '').toLowerCase();
		if (info !== language) {
			continue;
		}
		blocks.push({
			start: match.index,
			end: match.index + match[0].length,
			text: match[0],
			body: match[3].replace(/\n$/, ''),
		});
	}
	return blocks;
}

export function collectDrawioComments(text: string): Block[] {
	const blocks: Block[] = [];
	DRAWIO_COMMENT.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = DRAWIO_COMMENT.exec(text)) !== null) {
		const body = match[0]
			.replace(/^[ \t]*<!--\s*drawio:start\s*-->/i, '')
			.replace(/<!--\s*drawio:end\s*-->[ \t]*$/i, '')
			.replace(/^\n/, '')
			.replace(/\n$/, '');
		blocks.push({ start: match.index, end: match.index + match[0].length, text: match[0], body });
	}
	return blocks;
}

/** 图片按源码出现顺序收集：markdown 语法与内联 `<img>` 混排时顺序仍与渲染结果一致。 */
export function collectImages(text: string): Block[] {
	const blocks: Block[] = [];

	MARKDOWN_IMAGE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MARKDOWN_IMAGE.exec(text)) !== null) {
		blocks.push({
			start: match.index,
			end: match.index + match[0].length,
			text: match[0],
			target: match[2].replace(/^</, '').replace(/>$/, ''),
			alt: match[1],
		});
	}

	HTML_IMAGE.lastIndex = 0;
	while ((match = HTML_IMAGE.exec(text)) !== null) {
		const src = HTML_IMAGE_SRC.exec(match[0]);
		const alt = HTML_IMAGE_ALT.exec(match[0]);
		blocks.push({
			start: match.index,
			end: match.index + match[0].length,
			text: match[0],
			target: src?.[1] ?? src?.[2] ?? src?.[3] ?? '',
			alt: alt?.[1] ?? alt?.[2] ?? alt?.[3],
		});
	}

	return blocks.sort((a, b) => a.start - b.start);
}

function collectByKind(text: string, kind: MediaKind): Block[] {
	switch (kind) {
		case 'image':
			return collectImages(text);
		case 'mermaid':
			return collectFences(text, 'mermaid');
		case 'drawio':
			return [...collectFences(text, 'drawio'), ...collectDrawioComments(text)].sort((a, b) => a.start - b.start);
		default:
			return [];
	}
}

export function findMediaSource(text: string, kind: MediaKind, index: number, alt?: string): MediaSource | undefined {
	const blocks = collectByKind(text, kind);
	if (blocks.length === 0) {
		return undefined;
	}

	// 图片可以用 alt 交叉校验，索引错位时救回来
	if (kind === 'image' && typeof alt === 'string' && alt.trim()) {
		const wanted = alt.trim();
		const byAlt = blocks.find(block => (block.alt ?? '').trim() === wanted);
		if (byAlt) {
			return byAlt;
		}
	}

	return index >= 0 && index < blocks.length ? blocks[index] : undefined;
}

export function decodeDataUri(data: string): Buffer | undefined {
	const match = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(data);
	if (!match) {
		return undefined;
	}
	return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
}

/** 目标写法是否是"从根开始"的路径（与文档相对路径区分开）。 */
export function isAbsoluteTarget(target: string): boolean {
	return /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/') || target.startsWith('\\');
}

export function isRemoteTarget(target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** 把相对路径拆成可以逐段 join 的片段（`.` 段无意义，`..` 要留）。 */
export function targetSegments(target: string): string[] {
	const decoded = decodeURIComponent(target.split('#')[0].split('?')[0]);
	return decoded.replace(/\\/g, '/').split('/').filter(segment => segment.length > 0 && segment !== '.');
}
