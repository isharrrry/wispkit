import * as fs from 'fs';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../media/formats';

/**
 * 已由 Wispkit 其他视图承载的类型：只读模式**不再拦截**它们 ——
 * 那些本来就是浏览视图（不写文件），而截断 Markdown 会让渲染结果不完整。
 * 扩展名清单与 `media/formats.ts` 共用，避免图片 / 视频新增格式后只读模式又把它们抢走。
 */
export const HANDLED_ELSEWHERE = new RegExp(
	`\\.(?:md|markdown|html|htm|xaml|${[...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join('|')})$`,
	'i',
);

export interface ReadonlyPreview {
	readonly text: string;
	/** 文件总字节数（来自 stat，不需要读全文）。 */
	readonly totalBytes: number;
	/** 实际读进内存的字节数。 */
	readonly shownBytes: number;
	readonly shownLines: number;
	readonly truncated: boolean;
}

/** 带 BOM 的 UTF-8 / UTF-16 都要能正常显示，否则中文文件会整片乱码。 */
export function decodeBuffer(buffer: Buffer): string {
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return buffer.subarray(3).toString('utf8');
	}
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.subarray(2).toString('utf16le');
	}
	if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
		const swapped = Buffer.from(buffer.subarray(2));
		swapped.swap16();
		return swapped.toString('utf16le');
	}
	return buffer.toString('utf8');
}

export function truncateLines(text: string, maxLines: number): { text: string; lines: number; truncated: boolean } {
	const lines = text.split('\n');
	if (lines.length <= maxLines) {
		return { text, lines: lines.length, truncated: false };
	}
	return { text: lines.slice(0, maxLines).join('\n'), lines: maxLines, truncated: true };
}

/**
 * 只读前缀读取：**先按字节截断，再按行截断** —— 大文件永远不会整份进内存。
 * 这正是"只读模式省渲染开销"的落点：不调用 openTextDocument，只读文件头。
 */
export async function readTextPrefix(fsPath: string, maxBytes: number, maxLines: number): Promise<ReadonlyPreview> {
	const handle = await fs.promises.open(fsPath, 'r');
	try {
		const stats = await handle.stat();
		const length = Math.max(0, Math.min(stats.size, maxBytes));
		const buffer = Buffer.alloc(length);
		const { bytesRead } = length > 0 ? await handle.read(buffer, 0, length, 0) : { bytesRead: 0 };

		const decoded = decodeBuffer(buffer.subarray(0, bytesRead));
		const clipped = truncateLines(decoded, maxLines);

		return {
			text: clipped.text,
			totalBytes: stats.size,
			shownBytes: bytesRead,
			shownLines: clipped.lines,
			truncated: stats.size > bytesRead || clipped.truncated,
		};
	} finally {
		await handle.close();
	}
}
