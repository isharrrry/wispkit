/**
 * 子树浏览器的**拖入资源解析**：把 webview 里 `DataTransfer` 收集到的原始内容
 * 归类成「文件」与「待另存的资源」，并给出可选的存储类型、默认文件名建议。
 *
 * 纯逻辑，不 import vscode —— 单元测试直接覆盖，宿主只负责弹窗与落盘。
 */

/** webview 传来的一个文件（OS 拖入的 File 对象读出的字节；可能没有源路径）。 */
export interface DroppedFile {
	readonly kind: 'file';
	readonly name: string;
	readonly mime: string;
	readonly size: number;
	readonly lastModified: number;
	/** 读不出来（超大 / 权限）时为空，同时带 error 说明。 */
	readonly bytes?: Uint8Array;
	readonly error?: string;
	/** 宿主能确定的源路径（从 text/uri-list / text/plain 反查）；OS 直接拖入时没有。 */
	readonly sourcePath?: string;
}

/** webview 传来的字符串条目（文本、HTML、URL、data URL…）。 */
export interface DroppedString {
	readonly kind: 'string';
	readonly mime: string;
	readonly text: string;
}

export type DroppedItem = DroppedFile | DroppedString;

/** 一种可选的存储类型：`extension` 含点；`id` 用于前端/测试稳定断言。 */
export interface StorageType {
	readonly id: string;
	readonly label: string;
	readonly extension: string;
	readonly description?: string;
}

/** 默认文件名里最多取多少个字符（按码点截断，避免切坏 emoji / 代理对）。 */
export const MAX_SUGGESTED_STEM = 24;

/**
 * 拖入时是否由修饰键直接指定「移动」。
 *
 * **只有拖拽源自 Wispkit 子树且按住 Ctrl/Cmd 才算**（前端已在 dragstart/drop
 * 两处取过键态）。系统文件拖入不采用：Windows 资源管理器里 Ctrl 是「复制」，
 * 按「移动」解释会把源文件删掉。两个条件都必须是显式 true，缺一不可。
 */
export function isMoveDropRequested(message: {
	readonly internalDrag?: unknown;
	readonly moveRequested?: unknown;
	/** 原始键态：保留在消息里便于诊断，但**不作为**移动依据。 */
	readonly ctrlKey?: unknown;
}): boolean {
	return message.internalDrag === true && message.moveRequested === true;
}

/** 一个资源允许保存的最大文本长度（防止把整页 HTML 当文件名解析）。 */
const MAX_SUGGESTION_SCAN = 4000;

const TEXT_TYPES: Record<string, readonly StorageType[]> = {
	'text/uri-list': [
		{ id: 'url', label: 'Internet 快捷方式 (.url)', extension: '.url', description: '指向拖入的网址' },
		{ id: 'md-link', label: 'Markdown 链接 (.md)', extension: '.md', description: '写成 [标题](网址)' },
		{ id: 'url-text', label: '纯文本 (.txt)', extension: '.txt', description: '直接保存网址' },
	],
	'text/html': [
		{ id: 'html', label: 'HTML (.html)', extension: '.html' },
		{ id: 'html-text', label: '纯文本 (.txt)', extension: '.txt', description: '去掉 HTML 标签' },
	],
	'text/markdown': [
		{ id: 'md', label: 'Markdown (.md)', extension: '.md' },
		{ id: 'md-text', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/plain': [
		{ id: 'txt', label: '纯文本 (.txt)', extension: '.txt' },
		{ id: 'txt-md', label: 'Markdown (.md)', extension: '.md' },
	],
	'text/csv': [
		{ id: 'csv', label: 'CSV (.csv)', extension: '.csv' },
		{ id: 'csv-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'application/json': [
		{ id: 'json', label: 'JSON (.json)', extension: '.json' },
		{ id: 'json-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'application/xml': [
		{ id: 'xml', label: 'XML (.xml)', extension: '.xml' },
		{ id: 'xml-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/xml': [
		{ id: 'xml', label: 'XML (.xml)', extension: '.xml' },
		{ id: 'xml-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'application/yaml': [
		{ id: 'yaml', label: 'YAML (.yaml)', extension: '.yaml' },
		{ id: 'yaml-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/yaml': [
		{ id: 'yaml', label: 'YAML (.yaml)', extension: '.yaml' },
		{ id: 'yaml-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'application/javascript': [
		{ id: 'js', label: 'JavaScript (.js)', extension: '.js' },
		{ id: 'js-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/javascript': [
		{ id: 'js', label: 'JavaScript (.js)', extension: '.js' },
		{ id: 'js-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/css': [
		{ id: 'css', label: 'CSS (.css)', extension: '.css' },
		{ id: 'css-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-python': [
		{ id: 'py', label: 'Python (.py)', extension: '.py' },
		{ id: 'py-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-csharp': [
		{ id: 'cs', label: 'C# (.cs)', extension: '.cs' },
		{ id: 'cs-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-java': [
		{ id: 'java', label: 'Java (.java)', extension: '.java' },
		{ id: 'java-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-c': [
		{ id: 'c', label: 'C (.c)', extension: '.c' },
		{ id: 'c-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-c++': [
		{ id: 'cpp', label: 'C++ (.cpp)', extension: '.cpp' },
		{ id: 'cpp-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-shellscript': [
		{ id: 'sh', label: 'Shell 脚本 (.sh)', extension: '.sh' },
		{ id: 'sh-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/vnd.mermaid': [
		{ id: 'mmd', label: 'Mermaid (.mmd)', extension: '.mmd' },
		{ id: 'mmd-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
	'text/x-mermaid': [
		{ id: 'mmd', label: 'Mermaid (.mmd)', extension: '.mmd' },
		{ id: 'mmd-txt', label: '纯文本 (.txt)', extension: '.txt' },
	],
};

const BINARY_TYPES: Record<string, readonly StorageType[]> = {
	'image/png': [{ id: 'png', label: 'PNG 图片 (.png)', extension: '.png' }],
	'image/jpeg': [{ id: 'jpg', label: 'JPEG 图片 (.jpg)', extension: '.jpg' }],
	'image/gif': [{ id: 'gif', label: 'GIF 图片 (.gif)', extension: '.gif' }],
	'image/webp': [{ id: 'webp', label: 'WebP 图片 (.webp)', extension: '.webp' }],
	'image/bmp': [{ id: 'bmp', label: 'BMP 图片 (.bmp)', extension: '.bmp' }],
	'image/avif': [{ id: 'avif', label: 'AVIF 图片 (.avif)', extension: '.avif' }],
	'image/svg+xml': [{ id: 'svg', label: 'SVG 图片 (.svg)', extension: '.svg' }],
	'application/pdf': [{ id: 'pdf', label: 'PDF (.pdf)', extension: '.pdf' }],
	'application/zip': [{ id: 'zip', label: 'ZIP 压缩包 (.zip)', extension: '.zip' }],
	'application/octet-stream': [{ id: 'bin', label: '二进制 (.bin)', extension: '.bin' }],
};

/** 去掉参数（`text/plain;charset=utf-8` → `text/plain`）并转小写。 */
export function normalizeMime(mime: string): string {
	const base = String(mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
	return base || 'text/plain';
}

/**
 * 一个资源能“简单覆盖”哪些存储类型。
 *
 * 顺序即推荐顺序：第一个是默认类型。文件原扩展名（如果有）排在最前 ——
 * 用户拖一个 `报告.md` 进来，默认就应该是 `.md`，而不是按 MIME 猜。
 */
export function storageTypesFor(mime: string, fileName?: string): StorageType[] {
	const normalized = normalizeMime(mime);
	const table = TEXT_TYPES[normalized] ?? BINARY_TYPES[normalized];
	const out: StorageType[] = [];

	const originalExtension = extensionOfFileName(fileName);
	if (originalExtension) {
		out.push({
			id: `original${originalExtension.toLowerCase()}`,
			label: `沿用拖入扩展名 (${originalExtension.toLowerCase()})`,
			extension: originalExtension.toLowerCase(),
			description: '保持与原文件一致',
		});
	}

	if (table) {
		for (const type of table) {
			if (!out.some(item => item.extension === type.extension)) {
				out.push(type);
			}
		}
	}

	if (out.length === 0) {
		// 认不出的资源：文本一律给 .txt/.md，二进制一律给 .bin
		if (isTextMime(normalized)) {
			out.push(
				{ id: 'txt', label: '纯文本 (.txt)', extension: '.txt' },
				{ id: 'txt-md', label: 'Markdown (.md)', extension: '.md' },
			);
		} else {
			out.push({ id: 'bin', label: '二进制 (.bin)', extension: '.bin' });
		}
	}
	return out;
}

/** 文本类 MIME（包括 `+xml`、`+json` 这类结构化文本）。 */
export function isTextMime(mime: string): boolean {
	const normalized = normalizeMime(mime);
	return normalized.startsWith('text/')
		|| normalized === 'application/json'
		|| normalized === 'application/xml'
		|| normalized === 'application/javascript'
		|| normalized === 'application/yaml'
		|| normalized.endsWith('+json')
		|| normalized.endsWith('+xml')
		|| normalized.endsWith('+yaml');
}

/** 文件名里的扩展名（含点、小写）；没有则返回 undefined。 */
export function extensionOfFileName(name: string | undefined): string | undefined {
	const base = String(name ?? '');
	const dot = base.lastIndexOf('.');
	if (dot <= 0 || dot === base.length - 1) {
		return undefined;
	}
	const ext = base.slice(dot);
	return /^\.[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/.test(ext) ? ext : undefined;
}

/** 去掉文件名里的扩展名。 */
export function stemOfFileName(name: string | undefined): string {
	const base = String(name ?? '').replace(/[\\/]+$/, '');
	const ext = extensionOfFileName(base);
	const stem = ext ? base.slice(0, -ext.length) : base;
	return stem;
}

/**
 * 把内容里“第一段有意义的文字”洗成文件名：
 * 去 HTML/实体、去 Markdown 标记、压空白、去非法字符、限长。
 *
 * 抽不出（空、纯符号、纯数字以外的空白）就返回 undefined —— **不强行给默认名**。
 */
export function sanitizeSuggestedStem(raw: string | undefined): string | undefined {
	let text = String(raw ?? '');
	if (!text) {
		return undefined;
	}
	text = text.slice(0, MAX_SUGGESTION_SCAN);

	text = text
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/^[\s>*#\-+~`|]+/u, '')
		.replace(/[*_~`#]+/g, '');

	if (!text.trim()) {
		return undefined;
	}

	// 只取第一行/第一句的前若干字；标点（中英文）都视为断点。
	// 注意**先按行拆再压空白**：先压空白会把所有行粘成一行，第二行也会混进文件名。
	const firstLine = text
		.split(/\r?\n/)
		.map(line => line.replace(/[ \t]+/g, ' ').trim())
		.find(line => line.length > 0) ?? '';
	const sentence = firstLine.split(/[。！？!?；;]/)[0] ?? firstLine;
	const stem = Array.from(sentence.trim()).slice(0, MAX_SUGGESTED_STEM).join('').trim();

	if (!stem) {
		return undefined;
	}
	if (!/[\p{L}\p{N}]/u.test(stem)) {
		return undefined;
	}
	return stem;
}

/** 文件名里不能出现的字符一律换成空格（保留中文、空格、括号等）。 */
export function sanitizeFileNamePart(raw: string): string {
	return String(raw ?? '')
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
}

/** 解析 `text/uri-list`：忽略空行与 `#` 注释。 */
export function parseUriList(text: string): string[] {
	return String(text ?? '')
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#'));
}

/** 看起来像绝对路径（Windows 盘符 / UNC / POSIX 根）。 */
export function looksLikeAbsolutePath(text: string): boolean {
	const value = String(text ?? '').trim();
	return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || /^\//.test(value);
}

/**
 * `text/plain` 是否是一组路径：每行都像绝对路径，且至少一行。
 * 用于识别“从资源管理器/PowerShell 拖进来的路径文本”。
 */
export function parsePlainPathList(text: string): string[] {
	const lines = String(text ?? '')
		.split(/\r?\n/)
		.map(line => line.trim().replace(/^"(.*)"$/, '$1'))
		.filter(Boolean);
	return lines.length > 0 && lines.every(looksLikeAbsolutePath) ? lines : [];
}

/** 单个 http(s)/ftp 链接。 */
export function looksLikeUrl(text: string): boolean {
	return /^(https?|ftp):\/\/[^\s]+$/i.test(String(text ?? '').trim());
}

/**
 * 从一段文本里抽默认文件名（不含扩展名）：
 * URL 取最后一段路径或主机名；HTML 优先 `<title>`；其余取第一段有意义文字。
 */
export function suggestStemForText(mime: string, text: string): string | undefined {
	const normalized = normalizeMime(mime);
	const raw = String(text ?? '');

	if (normalized === 'text/uri-list' || (normalized === 'text/plain' && looksLikeUrl(raw))) {
		const first = parseUriList(raw)[0] ?? raw.trim();
		return stemFromUrl(first) ?? sanitizeSuggestedStem(first);
	}

	if (normalized === 'text/html' || normalized === 'application/xhtml+xml') {
		const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1];
		return sanitizeSuggestedStem(title) ?? sanitizeSuggestedStem(raw);
	}

	return sanitizeSuggestedStem(raw);
}

/** URL → 有意义的名字：路径最后一段（去查询、解码）优先，其次主机名。 */
export function stemFromUrl(url: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(String(url ?? '').trim());
	} catch {
		return undefined;
	}
	const segments = parsed.pathname.split('/').filter(Boolean);
	const last = segments[segments.length - 1];
	if (last) {
		let decoded = last;
		try {
			decoded = decodeURIComponent(last);
		} catch {
			// 非法转义就保留原样
		}
		const withoutExtension = decoded.replace(/\.[A-Za-z0-9]{1,8}$/, '');
		const stem = sanitizeFileNamePart(withoutExtension);
		if (stem && /[\p{L}\p{N}]/u.test(stem)) {
			return Array.from(stem).slice(0, MAX_SUGGESTED_STEM).join('');
		}
	}
	const host = parsed.hostname.replace(/^www\./i, '');
	return host ? sanitizeFileNamePart(host) : undefined;
}

/** 给一个资源生成默认文件名（含扩展名）；抽不出时返回空字符串。 */
export function suggestedFileName(mime: string, text: string, extension: string): string {
	const stem = suggestStemForText(mime, text);
	return stem ? `${stem}${extension}` : '';
}

/**
 * 把拖入的字符串条目归并成**一个**资源（一次拖拽通常只该弹一次“另存为”）。
 *
 * 优先顺序：uri-list（链接）→ HTML → 图片 data URL → Markdown → 纯文本。
 * `text/uri-list` 若全是 `file:` 会被调用方先当路径处理，这里不负责。
 */
export function pickPrimaryString(strings: readonly DroppedString[]): DroppedString | undefined {
	const byMime = new Map<string, DroppedString>();
	for (const item of strings) {
		const mime = normalizeMime(item.mime);
		if (!byMime.has(mime) && item.text.length > 0) {
			byMime.set(mime, item);
		}
	}
	const order = [
		'text/uri-list',
		'text/html',
		'image/svg+xml',
		'image/png',
		'image/jpeg',
		'image/gif',
		'image/webp',
		'text/markdown',
		'application/json',
		'text/csv',
		'text/plain',
	];
	for (const mime of order) {
		const found = byMime.get(mime);
		if (found) {
			return found;
		}
	}
	for (const item of strings) {
		if (normalizeMime(item.mime).startsWith('image/')) {
			return item;
		}
	}
	return byMime.values().next().value;
}

/** data: URL（base64 或百分号编码）解码成字节；不是 data URL 返回 undefined。 */
export function decodeDataUrl(text: string): { mime: string; bytes: Uint8Array } | undefined {
	const match = /^data:([^;,]*)((?:;[^,]*)*),([\s\S]*)$/i.exec(String(text ?? '').trim());
	if (!match) {
		return undefined;
	}
	const mime = normalizeMime(match[1] || 'text/plain');
	const meta = match[2] ?? '';
	const payload = match[3] ?? '';
	try {
		if (/;base64/i.test(meta)) {
			return { mime, bytes: Uint8Array.from(Buffer.from(payload, 'base64')) };
		}
		return { mime, bytes: Uint8Array.from(Buffer.from(decodeURIComponent(payload), 'utf8')) };
	} catch {
		return undefined;
	}
}

/**
 * 按目标类型生成要写入的内容。
 *
 * - 文件字节：原样写（换扩展名也不做转码，用户选什么就存什么）。
 * - 文本：`.url` 写成 Windows Internet 快捷方式；`.md` 遇到 URL 写成链接；`.txt` 存纯文本。
 */
export function renderContentForType(
	type: StorageType,
	resource: { mime: string; text?: string; bytes?: Uint8Array },
): { text?: string; bytes?: Uint8Array } {
	if (resource.bytes) {
		return { bytes: resource.bytes };
	}
	const text = resource.text ?? '';
	const normalized = normalizeMime(resource.mime);
	const url = normalized === 'text/uri-list' ? (parseUriList(text)[0] ?? '') : (looksLikeUrl(text) ? text.trim() : '');

	if (type.extension === '.url') {
		return { text: `[InternetShortcut]\r\nURL=${url || text.trim()}\r\n` };
	}
	if (type.extension === '.md' && url) {
		const title = stemFromUrl(url) || url;
		return { text: `[${title}](${url})\r\n` };
	}
	if (type.extension === '.txt' && normalized === 'text/html') {
		return { text: htmlToPlainText(text) };
	}
	if (type.extension === '.html' && normalized === 'text/uri-list' && url) {
		return { text: `<a href="${escapeHtmlAttribute(url)}">${escapeHtmlText(url)}</a>\r\n` };
	}
	return { text };
}

/** 极简 HTML → 纯文本（给“另存为 .txt”用）。 */
export function htmlToPlainText(html: string): string {
	return String(html ?? '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function escapeHtmlText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(text: string): string {
	return escapeHtmlText(text).replace(/"/g, '&quot;');
}

/** 提示文案里用的短名：超过 40 个字符就截断。 */
export function shortName(name: string, limit = 40): string {
	const chars = Array.from(String(name ?? ''));
	return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : chars.join('');
}
