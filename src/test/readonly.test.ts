import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decodeBuffer, HANDLED_ELSEWHERE, readTextPrefix, truncateLines } from '../readonly/file';
import { formatBytes, readonlyBanner, renderReadonlyPage } from '../readonly/page';

function withTempFile(content: Buffer | string, name = 'sample.txt'): { file: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispkit-readonly-'));
	const file = path.join(dir, name);
	fs.writeFileSync(file, content as never);
	return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('readonly/file: 解码', () => {
	it('UTF-8 BOM', () => {
		const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf8')]);
		assert.strictEqual(decodeBuffer(buffer), '中文');
	});

	it('UTF-16LE BOM', () => {
		const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')]);
		assert.strictEqual(decodeBuffer(buffer), '中文');
	});

	it('UTF-16BE BOM', () => {
		const littleEndian = Buffer.from('中文', 'utf16le');
		const bigEndian = Buffer.from(littleEndian);
		bigEndian.swap16();
		const buffer = Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]);
		assert.strictEqual(decodeBuffer(buffer), '中文');
	});

	it('无 BOM 按 UTF-8', () => {
		assert.strictEqual(decodeBuffer(Buffer.from('plain 中文', 'utf8')), 'plain 中文');
	});
});

describe('readonly/file: 截断', () => {
	it('未超上限时不截断', () => {
		const result = truncateLines('a\nb\nc', 5);
		assert.strictEqual(result.truncated, false);
		assert.strictEqual(result.lines, 3);
	});

	it('超过行上限时只留前 N 行', () => {
		const result = truncateLines('a\nb\nc\nd', 2);
		assert.strictEqual(result.text, 'a\nb');
		assert.strictEqual(result.lines, 2);
		assert.strictEqual(result.truncated, true);
	});

	it('按字节截断：大于上限的文件只把上限那么多读进内存', async () => {
		const { file, cleanup } = withTempFile('0123456789\n'.repeat(5000), 'big.log');
		try {
			const preview = await readTextPrefix(file, 1024, 100000);
			assert.ok(preview.totalBytes > 1024, `素材应大于 1KB，实际 ${preview.totalBytes}`);
			assert.strictEqual(preview.shownBytes, 1024);
			assert.strictEqual(preview.truncated, true, '按字节截断也必须标记为截断');
		} finally {
			cleanup();
		}
	});

	it('按行截断：shownLines 不超过上限', async () => {
		const { file, cleanup } = withTempFile(Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'), 'lines.txt');
		try {
			const preview = await readTextPrefix(file, 10 * 1024 * 1024, 50);
			assert.strictEqual(preview.shownLines, 50);
			assert.strictEqual(preview.truncated, true);
			assert.ok(!preview.text.includes('line 100'), '第 50 行之后的内容不该被加载');
		} finally {
			cleanup();
		}
	});

	it('小文件完整读出且不标记截断', async () => {
		const { file, cleanup } = withTempFile('hello\nworld', 'small.txt');
		try {
			const preview = await readTextPrefix(file, 65536, 800);
			assert.strictEqual(preview.text, 'hello\nworld');
			assert.strictEqual(preview.truncated, false);
		} finally {
			cleanup();
		}
	});

	it('空文件不抛异常', async () => {
		const { file, cleanup } = withTempFile('', 'empty.txt');
		try {
			const preview = await readTextPrefix(file, 65536, 800);
			assert.strictEqual(preview.text, '');
			assert.strictEqual(preview.shownBytes, 0);
		} finally {
			cleanup();
		}
	});
});

describe('readonly/page', () => {
	it('formatBytes', () => {
		assert.strictEqual(formatBytes(512), '512 B');
		assert.strictEqual(formatBytes(2048), '2.0 KB');
		assert.strictEqual(formatBytes(-1), '未知大小');
		assert.strictEqual(formatBytes(Number.NaN), '未知大小');
	});

	it('截断时横幅明确说明未加载的部分不会渲染', () => {
		const banner = readonlyBanner({ shownLines: 100, totalBytes: 5 * 1024 * 1024, truncated: true });
		assert.ok(banner.includes('100 行'), banner);
		assert.ok(banner.includes('未加载的部分不会渲染'), banner);
	});

	it('页面带解锁按钮，且正文被当作纯文本转义', () => {
		const html = renderReadonlyPage({
			title: 'a.txt',
			csp: "default-src 'none'",
			nonce: 'N1',
			text: '<script>alert(1)</script>',
			totalBytes: 25,
			shownLines: 1,
			truncated: false,
			runtimeScript: 'vscode-webview://x/readonly.js',
			runtimeStyle: 'vscode-webview://x/readonly.css',
		});
		assert.ok(html.includes('id="wispkit-readonly-unlock"'));
		assert.ok(html.includes('&lt;script&gt;'), '文件内容必须转义，不能当 HTML 执行');
		assert.ok(!html.includes('<script>alert'));
	});
});

describe('readonly/intercept: 拦截范围', () => {
	it('已被其他 Wispkit 视图承载的类型不再拦截（含 SVG / HEIF / 视频）', () => {
		for (const file of [
			'a.md', 'b.MARKDOWN', 'c.html', 'd.htm', 'e.xaml',
			'f.PNG', 'g.jpeg', 'h.webp', 'i.svg', 'j.SVG', 'k.heic', 'l.heif', 'm.tiff',
			'n.mp4', 'o.MKV', 'p.webm', 'q.rmvb',
		]) {
			assert.ok(HANDLED_ELSEWHERE.test(file), `${file} 应被排除`);
		}
	});

	it('普通文本文件（包括 TypeScript 的 .ts）会被拦截', () => {
		for (const file of ['a.ts', 'a.mts', 'b.json', 'c.txt', 'd.log', 'e.py']) {
			assert.ok(!HANDLED_ELSEWHERE.test(file), `${file} 不应被排除`);
		}
	});
});
