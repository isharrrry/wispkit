import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphElement, GraphNode, GraphNodeImage } from './types';

/**
 * 3D 气泡里的图片：节点名称写成 Markdown 链接 `[文字](图片路径)`，且路径指向
 * 磁盘上真实存在、可解析的图片时，宿主把图片读成 data URL 挂到节点上；
 * 前端用 Sprite 把图片画在气泡球心，而不是显示文字。
 *
 * 这一层不 import vscode：文件系统通过 `NodeImageIO` 注入，宿主与 mocha 共用。
 */

/** 单张图片最多读取的字节数；超过就退回文字，避免把整个 webview 撑爆。 */
export const MAX_NODE_IMAGE_BYTES = 16 * 1024 * 1024;

/** 扩展名 → 期望的 MIME。只接受 Wispkit 图片视图支持的同款格式。 */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	jpe: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	avif: 'image/avif',
};

export interface ImageLink {
	/** 方括号里的可见文字（alt）。 */
	readonly alt: string;
	/** 圆括号里的目标，保持原始写法（未解码 / 未反转义）。 */
	readonly target: string;
}

export interface NodeImageIO {
	/** Markdown 文件所在目录；相对路径基于它解析。 */
	readonly baseDir: string;
	/** 文件大小；不存在 / 不是普通文件时返回 undefined。 */
	stat(fsPath: string): Promise<{ readonly size: number } | undefined>;
	/** 读取整个文件；失败时返回 undefined。 */
	read(fsPath: string): Promise<Uint8Array | undefined>;
	/** 覆盖默认上限，主要给测试用。 */
	readonly maxBytes?: number;
}

/**
 * 解析「整条标签就是一个 Markdown 链接」的节点名称。
 *
 * 按 CommonMark 的目的地规则处理：
 *   - 目标里的圆括号必须配对（例如 `Atlantis(1).png`）；
 *   - 支持 `<带 空格 的路径>` 与链接标题 `[x](a.png "标题")`；
 *   - 方括号内允许嵌套方括号与反斜杠转义。
 * 标签前后可以有空白，但链接之外不能再有文字 —— 否则会丢掉用户写的内容。
 */
export function parseImageLink(label: string): ImageLink | undefined {
	let text = String(label ?? '').trim();
	if (!text) {
		return undefined;
	}
	// 同时接受 Markdown 图片语法 `![alt](src)`。
	if (text.startsWith('!')) {
		text = text.slice(1).trimStart();
	}
	if (!text.startsWith('[')) {
		return undefined;
	}

	// 找配对的 `]`（alt 里允许 `[` / `]` 嵌套与 `\]` 转义）。
	let depth = 0;
	let altEnd = -1;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '\\') {
			index += 1;
			continue;
		}
		if (char === '[') {
			depth += 1;
			continue;
		}
		if (char === ']') {
			depth -= 1;
			if (depth === 0) {
				altEnd = index;
				break;
			}
		}
	}
	if (altEnd <= 0 || text[altEnd + 1] !== '(') {
		return undefined;
	}
	const alt = unescapeText(text.slice(1, altEnd));

	let index = altEnd + 2;
	while (index < text.length && isWhitespace(text[index])) {
		index += 1;
	}

	let target: string;
	if (text[index] === '<') {
		const close = text.indexOf('>', index + 1);
		if (close < 0) {
			return undefined;
		}
		target = text.slice(index + 1, close);
		index = close + 1;
	} else {
		const start = index;
		let parens = 0;
		for (; index < text.length; index += 1) {
			const char = text[index];
			if (char === '\\' && index + 1 < text.length) {
				index += 1;
				continue;
			}
			if (char === '(') {
				parens += 1;
				continue;
			}
			if (char === ')') {
				if (parens === 0) {
					break;
				}
				parens -= 1;
				continue;
			}
			// 目的地里不允许未转义 / 未用尖括号包起来的空白。
			if (parens === 0 && isWhitespace(char)) {
				break;
			}
		}
		target = text.slice(start, index);
	}

	while (index < text.length && isWhitespace(text[index])) {
		index += 1;
	}

	if (text[index] === ')') {
		index += 1;
	} else if (text[index] === '"' || text[index] === '\'' || text[index] === '(') {
		// 链接标题：`"…"` / `'…'` / `(…)`。
		const opener = text[index];
		const closer = opener === '(' ? ')' : opener;
		index += 1;
		let closed = false;
		while (index < text.length) {
			const char = text[index];
			if (char === '\\') {
				index += 2;
				continue;
			}
			if (char === closer) {
				closed = true;
				index += 1;
				break;
			}
			index += 1;
		}
		if (!closed) {
			return undefined;
		}
		while (index < text.length && isWhitespace(text[index])) {
			index += 1;
		}
		if (text[index] !== ')') {
			return undefined;
		}
		index += 1;
	} else {
		return undefined;
	}

	// 链接结束后不允许再有内容（空白除外）。
	if (text.slice(index).trim().length > 0) {
		return undefined;
	}
	return target.length > 0 ? { alt, target } : undefined;
}

/** 扩展名对应的图片 MIME；不是受支持的图片扩展名时返回 undefined。 */
export function imageMimeFromPath(filePath: string): string | undefined {
	const clean = filePath.split(/[?#]/, 1)[0] ?? filePath;
	const extension = path.extname(clean).replace(/^\./, '').toLowerCase();
	return EXTENSION_MIME[extension];
}

/**
 * 把链接目标解析成绝对文件路径。
 * 支持 Windows 盘符 / UNC、`file:` URI、相对路径、`%20` 编码与 `<…>`。
 */
export function resolveImageTarget(target: string, baseDir: string): string | undefined {
	let value = String(target ?? '').trim();
	if (value.startsWith('<') && value.endsWith('>')) {
		value = value.slice(1, -1).trim();
	}
	// 只反转义会干扰目的地语法的括号；Windows 路径里的单反斜杠（含 UNC）
	// 必须原样保留，因此不处理 `\\`。
	value = value.replace(/\\([()])/g, '$1');
	if (value.includes('%')) {
		try {
			value = decodeURIComponent(value);
		} catch {
			// 不是合法的百分号编码就按原样使用。
		}
	}
	if (!value) {
		return undefined;
	}
	if (/^file:/i.test(value)) {
		try {
			return fileURLToPath(value);
		} catch {
			return undefined;
		}
	}
	if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
		return path.win32.normalize(value);
	}
	return path.resolve(baseDir, value);
}

/** 根据文件头判断真实图片类型；内容不是可识别图片时返回 undefined。 */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
	const matches = (signature: readonly number[], offset = 0): boolean => {
		if (bytes.length < offset + signature.length) {
			return false;
		}
		return signature.every((byte, index) => bytes[offset + index] === byte);
	};
	const ascii = (offset: number, length: number): string => {
		if (bytes.length < offset + length) {
			return '';
		}
		let text = '';
		for (let index = 0; index < length; index += 1) {
			text += String.fromCharCode(bytes[offset + index]);
		}
		return text;
	};

	if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return 'image/png';
	}
	if (matches([0xff, 0xd8, 0xff])) {
		return 'image/jpeg';
	}
	const gif = ascii(0, 6);
	if (gif === 'GIF87a' || gif === 'GIF89a') {
		return 'image/gif';
	}
	if (matches([0x42, 0x4d])) {
		return 'image/bmp';
	}
	if (matches([0x00, 0x00, 0x01, 0x00])) {
		return 'image/x-icon';
	}
	if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
		return 'image/webp';
	}
	if (ascii(4, 4) === 'ftyp') {
		const brand = ascii(8, 4);
		if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
			return 'image/avif';
		}
	}
	return undefined;
}

interface ResolvedImage {
	readonly src: string;
	readonly mime: string;
	readonly path: string;
}

function isWhitespace(char: string | undefined): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function unescapeText(value: string): string {
	return value.replace(/\\([\[\]\\])/g, '$1');
}

function fallbackAlt(fsPath: string): string {
	const base = path.basename(fsPath);
	return (base.replace(/\.[^.]+$/, '') || '图片').slice(0, 240);
}

/** 读取 + 校验 + 生成 data URL；任何一个环节失败都返回 undefined（退回文字）。 */
async function resolveImage(
	fsPath: string,
	io: NodeImageIO,
	cache: Map<string, Promise<ResolvedImage | undefined>>,
): Promise<ResolvedImage | undefined> {
	const cached = cache.get(fsPath);
	if (cached) {
		return cached;
	}
	const task = (async (): Promise<ResolvedImage | undefined> => {
		const expectedMime = imageMimeFromPath(fsPath);
		if (!expectedMime) {
			return undefined;
		}
		const maxBytes = io.maxBytes ?? MAX_NODE_IMAGE_BYTES;
		let stat: { readonly size: number } | undefined;
		try {
			stat = await io.stat(fsPath);
		} catch {
			return undefined;
		}
		if (!stat || stat.size <= 0 || stat.size > maxBytes) {
			return undefined;
		}
		let bytes: Uint8Array | undefined;
		try {
			bytes = await io.read(fsPath);
		} catch {
			return undefined;
		}
		if (!bytes || bytes.length === 0 || bytes.length > maxBytes) {
			return undefined;
		}
		// 「图片可解析」的最低门槛：文件头必须是真实的图片格式，而不是
		// 改了扩展名的文本 / 空壳文件。真正的解码由前端 Image 再确认一次。
		const sniffed = sniffImageMime(bytes);
		if (!sniffed) {
			return undefined;
		}
		return {
			src: `data:${sniffed};base64,${Buffer.from(bytes).toString('base64')}`,
			mime: sniffed,
			path: fsPath,
		};
	})();
	cache.set(fsPath, task);
	return task;
}

/**
 * 给所有「标签是 Markdown 链接且指向有效图片」的节点挂上 `image`。
 *
 * 命中时把节点标签替换成链接文字（alt）——这样气泡半径、tooltip、同名合并
 * 都按用户看到的名称处理，而不是按一整条文件路径。未命中（不存在 / 不是图片 /
 * 文件头不可识别 / 超过大小上限）时节点保持原样，前端继续显示原文。
 */
export async function attachNodeImages(
	elements: readonly GraphElement[],
	io: NodeImageIO,
): Promise<GraphElement[]> {
	const cache = new Map<string, Promise<ResolvedImage | undefined>>();
	const result: GraphElement[] = [];
	for (const element of elements) {
		const firstIndex = element.nodes.findIndex(node => node.label.trim().length > 0);
		const rawFirstName = firstIndex >= 0 ? element.nodes[firstIndex].label.trim() : undefined;
		let changed = false;
		const nodes: GraphNode[] = [];
		for (const node of element.nodes) {
			const link = parseImageLink(node.label);
			const fsPath = link ? resolveImageTarget(link.target, io.baseDir) : undefined;
			const resolved = link && fsPath ? await resolveImage(fsPath, io, cache) : undefined;
			if (!link || !fsPath || !resolved) {
				nodes.push(node);
				continue;
			}
			const alt = link.alt.trim() || fallbackAlt(fsPath);
			const image: GraphNodeImage = {
				src: resolved.src,
				alt,
				path: resolved.path,
				mime: resolved.mime,
			};
			nodes.push({ ...node, label: alt, image });
			changed = true;
		}
		if (!changed) {
			result.push(element);
			continue;
		}
		let name = element.name;
		const newFirstName = firstIndex >= 0 ? nodes[firstIndex]?.label.trim() : undefined;
		if (rawFirstName && newFirstName && rawFirstName !== newFirstName && name.startsWith(rawFirstName)) {
			name = `${newFirstName}${name.slice(rawFirstName.length)}`;
		}
		result.push({ ...element, nodes, name });
	}
	return result;
}
