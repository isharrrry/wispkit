import * as assert from 'assert';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
	attachNodeImages,
	MAX_NODE_IMAGE_BYTES,
	imageMimeFromPath,
	parseImageLink,
	resolveImageTarget,
	sniffImageMime,
	type NodeImageIO,
} from '../graph3d/nodeImages';
import type { GraphElement } from '../graph3d/types';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Uint8Array.from([...Buffer.from('GIF89a'), 0x01, 0x00]);
const BMP = Uint8Array.from([0x42, 0x4d, 0x00, 0x00]);
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const WEBP = Uint8Array.from([...Buffer.from('RIFF'), 0x10, 0, 0, 0, ...Buffer.from('WEBP')]);
const AVIF = Uint8Array.from([0, 0, 0, 0x1c, ...Buffer.from('ftypavif'), 0, 0, 0, 0]);

function sampleElement(label: string, name = '示例 · ASCII 树'): GraphElement {
	return {
		id: 'g1',
		name,
		kind: 'ascii-tree',
		language: 'text',
		line: 1,
		source: label,
		nodes: [
			{ id: 'a0', label },
			{ id: 'a1', label: '普通节点' },
		],
		edges: [{ source: 'a0', target: 'a1' }],
	};
}

function fakeIO(files: Record<string, Uint8Array>, baseDir = 'D:\\docs', maxBytes?: number): NodeImageIO & { reads: string[] } {
	const reads: string[] = [];
	const normalized = new Map(Object.entries(files).map(([key, value]) => [path.normalize(key), value]));
	return {
		baseDir,
		reads,
		async stat(fsPath: string) {
			const bytes = normalized.get(path.normalize(fsPath));
			return bytes ? { size: bytes.length } : undefined;
		},
		async read(fsPath: string) {
			reads.push(fsPath);
			return normalized.get(path.normalize(fsPath));
		},
		maxBytes,
	};
}

describe('graph3d/nodeImages：Markdown 链接解析', () => {
	it('识别任务示例：方括号 + 圆括号里的 Windows 绝对路径（文件名带括号）', () => {
		const target = 'F:\\AllData\\WX\\xwechat_files\\wxid_i9gr93tns4x821_f2d0\\msg\\file\\2026-10\\Atlantis(1).png';
		const link = parseImageLink(`[XXX节点](${target})`);
		assert.deepStrictEqual(link, { alt: 'XXX节点', target });
	});

	it('支持尖括号路径、链接标题与 Markdown 图片语法', () => {
		assert.deepStrictEqual(parseImageLink('[图](<C:\\带 空格\\a.png>)'), {
			alt: '图',
			target: 'C:\\带 空格\\a.png',
		});
		assert.deepStrictEqual(parseImageLink('[图](img/a.png "标题")'), { alt: '图', target: 'img/a.png' });
		assert.deepStrictEqual(parseImageLink("[图](img/a.png '标题')"), { alt: '图', target: 'img/a.png' });
		assert.deepStrictEqual(parseImageLink('![图](img/a.png)'), { alt: '图', target: 'img/a.png' });
		assert.deepStrictEqual(parseImageLink('[](img/a.png)'), { alt: '', target: 'img/a.png' });
	});

	it('alt 里允许嵌套方括号与转义', () => {
		assert.deepStrictEqual(parseImageLink('[a[b]c](img/a.png)'), { alt: 'a[b]c', target: 'img/a.png' });
		assert.deepStrictEqual(parseImageLink('[a\\]b](img/a.png)'), { alt: 'a]b', target: 'img/a.png' });
	});

	it('圆括号必须配对，转义的括号不参与配对', () => {
		assert.deepStrictEqual(parseImageLink('[图](Atlantis(1).png)'), { alt: '图', target: 'Atlantis(1).png' });
		assert.deepStrictEqual(parseImageLink('[图](a\\(1\\).png)'), { alt: '图', target: 'a\\(1\\).png' });
		assert.strictEqual(parseImageLink('[图](a(1.png)'), undefined);
	});

	it('只接受「整条标签就是链接」：普通文字、链接前后带文字都返回 undefined', () => {
		assert.strictEqual(parseImageLink('开始'), undefined);
		assert.strictEqual(parseImageLink('[图](a.png) 说明'), undefined);
		assert.strictEqual(parseImageLink('前缀 [图](a.png)'), undefined);
		assert.strictEqual(parseImageLink('[图] (a.png)'), undefined);
		assert.strictEqual(parseImageLink('[图]()'), undefined);
		assert.strictEqual(parseImageLink(''), undefined);
	});

	it('允许首尾空白', () => {
		assert.deepStrictEqual(parseImageLink('  [图](a.png)\n'), { alt: '图', target: 'a.png' });
	});
});

describe('graph3d/nodeImages：路径与格式识别', () => {
	it('扩展名识别（大小写不敏感、剥掉查询串）', () => {
		assert.strictEqual(imageMimeFromPath('a.PNG'), 'image/png');
		assert.strictEqual(imageMimeFromPath('a.jpeg'), 'image/jpeg');
		assert.strictEqual(imageMimeFromPath('a.jpe'), 'image/jpeg');
		assert.strictEqual(imageMimeFromPath('a.ico'), 'image/x-icon');
		assert.strictEqual(imageMimeFromPath('a.avif'), 'image/avif');
		assert.strictEqual(imageMimeFromPath('a.png?v=1'), 'image/png');
		assert.strictEqual(imageMimeFromPath('a.svg'), undefined);
		assert.strictEqual(imageMimeFromPath('a.txt'), undefined);
		assert.strictEqual(imageMimeFromPath('a'), undefined);
	});

	it('相对路径基于 Markdown 目录解析', () => {
		const base = path.resolve('D:/docs');
		assert.strictEqual(resolveImageTarget('img/a.png', base), path.resolve(base, 'img/a.png'));
		assert.strictEqual(resolveImageTarget('./img/a.png', base), path.resolve(base, 'img/a.png'));
	});

	it('Windows 盘符 / UNC / 百分号编码 / 转义括号 / file URI', () => {
		assert.strictEqual(resolveImageTarget('F:/WX/a.png', 'D:\\docs'), path.win32.normalize('F:/WX/a.png'));
		assert.strictEqual(resolveImageTarget('\\\\server\\share\\a.png', 'D:\\docs'), path.win32.normalize('\\\\server\\share\\a.png'));
		assert.strictEqual(resolveImageTarget('img/a%20b.png', 'D:\\docs'), path.resolve('D:\\docs', 'img/a b.png'));
		assert.strictEqual(resolveImageTarget('C:\\x\\a\\(1\\).png', 'D:\\docs'), path.win32.normalize('C:\\x\\a(1).png'));
		const fileUri = pathToFileURL('D:/docs/a.png').toString();
		assert.strictEqual(resolveImageTarget(fileUri, 'D:\\docs'), fileURLToPath(fileUri));
		assert.strictEqual(resolveImageTarget('<C:\\a b\\x.png>', 'D:\\docs'), path.win32.normalize('C:\\a b\\x.png'));
		assert.strictEqual(resolveImageTarget('   ', 'D:\\docs'), undefined);
	});

	it('按文件头识别真实格式，非图片内容返回 undefined', () => {
		assert.strictEqual(sniffImageMime(PNG), 'image/png');
		assert.strictEqual(sniffImageMime(JPEG), 'image/jpeg');
		assert.strictEqual(sniffImageMime(GIF), 'image/gif');
		assert.strictEqual(sniffImageMime(BMP), 'image/bmp');
		assert.strictEqual(sniffImageMime(ICO), 'image/x-icon');
		assert.strictEqual(sniffImageMime(WEBP), 'image/webp');
		assert.strictEqual(sniffImageMime(AVIF), 'image/avif');
		assert.strictEqual(sniffImageMime(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), undefined);
		assert.strictEqual(sniffImageMime(new Uint8Array()), undefined);
	});
});

describe('graph3d/nodeImages：挂到节点上', () => {
	it('有效图片：标签换成 alt、挂 data URL、元素名同步替换', async () => {
		const io = fakeIO({ 'D:\\docs\\img\\a.png': PNG });
		const elements = await attachNodeImages([sampleElement('[图标](img/a.png)', '[图标](img/a.png) · ASCII 树')], io);
		const node = elements[0].nodes[0];
		assert.strictEqual(node.label, '图标');
		assert.strictEqual(node.image?.alt, '图标');
		assert.strictEqual(node.image?.mime, 'image/png');
		assert.strictEqual(node.image?.path, path.normalize('D:\\docs\\img\\a.png'));
		assert.ok(node.image?.src.startsWith('data:image/png;base64,'));
		assert.deepStrictEqual(
			new Uint8Array(Buffer.from(node.image!.src.split(',')[1], 'base64')),
			PNG,
		);
		assert.strictEqual(elements[0].name, '图标 · ASCII 树');
		// 第二个普通节点保持原样。
		assert.strictEqual(elements[0].nodes[1].label, '普通节点');
		assert.strictEqual(elements[0].nodes[1].image, undefined);
	});

	it('文件不存在 / 不是图片扩展名 / 文件头不可识别 / 超过大小上限时保持原样', async () => {
		const cases: Array<[string, Record<string, Uint8Array>, number | undefined]> = [
			['[图](img/missing.png)', {}, undefined],
			['[图](img/a.txt)', { 'D:\\docs\\img\\a.txt': PNG }, undefined],
			['[图](img/fake.png)', { 'D:\\docs\\img\\fake.png': new Uint8Array([1, 2, 3, 4]) }, undefined],
			['[图](img/big.png)', { 'D:\\docs\\img\\big.png': PNG }, 4],
		];
		for (const [label, files, maxBytes] of cases) {
			const io = fakeIO(files, 'D:\\docs', maxBytes);
			const elements = await attachNodeImages([sampleElement(label)], io);
			assert.strictEqual(elements[0].nodes[0].label, label, label);
			assert.strictEqual(elements[0].nodes[0].image, undefined, label);
			assert.strictEqual(elements[0].name, '示例 · ASCII 树', label);
		}
	});

	it('非图片扩展名不做 IO', async () => {
		const io = fakeIO({ 'D:\\docs\\img\\a.txt': PNG });
		await attachNodeImages([sampleElement('[图](img/a.txt)')], io);
		assert.deepStrictEqual(io.reads, []);
	});

	it('同一路径被多个节点引用时只读一次', async () => {
		const io = fakeIO({ 'D:\\docs\\img\\a.png': PNG });
		const element: GraphElement = {
			...sampleElement('[图](img/a.png)'),
			nodes: [
				{ id: 'a0', label: '[图](img/a.png)' },
				{ id: 'a1', label: '[另一张](img/a.png)' },
			],
			edges: [],
		};
		const elements = await attachNodeImages([element], io);
		assert.strictEqual(elements[0].nodes[0].image?.src, elements[0].nodes[1].image?.src);
		assert.deepStrictEqual(io.reads, [path.normalize('D:\\docs\\img\\a.png')]);
	});

	it('alt 为空时用文件名兜底', async () => {
		const io = fakeIO({ 'D:\\docs\\img\\a.png': PNG });
		const elements = await attachNodeImages([sampleElement('[](img/a.png)')], io);
		assert.strictEqual(elements[0].nodes[0].label, 'a');
	});

	it('上限常量大于 0', () => {
		assert.ok(MAX_NODE_IMAGE_BYTES > 0);
	});
});
