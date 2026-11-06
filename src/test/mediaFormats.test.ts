import * as assert from 'assert';
import {
	fileExtension,
	IMAGE_EXTENSIONS,
	isImagePath,
	isNativelyDecodedImage,
	isVectorImagePath,
	isVideoPath,
	VIDEO_EXTENSIONS,
} from '../media/formats';

describe('media/formats: 扩展名解析', () => {
	it('大小写不敏感，并忽略 query / fragment', () => {
		assert.strictEqual(fileExtension('D:/a/Pic.PNG'), 'png');
		assert.strictEqual(fileExtension('vscode-webview://x/a.webp?t=1'), 'webp');
		assert.strictEqual(fileExtension('file:///d:/a/v.MP4#t=10'), 'mp4');
	});

	it('没有扩展名 / 点开头文件不算扩展名', () => {
		assert.strictEqual(fileExtension('README'), '');
		assert.strictEqual(fileExtension('D:/a/.svg'), '');
		assert.strictEqual(fileExtension('D:/a/'), '');
	});
});

describe('media/formats: 图片格式', () => {
	it('SVG / WebP / AVIF / APNG / JFIF 都归图片视图', () => {
		for (const name of ['a.svg', 'b.SVG', 'c.webp', 'd.avif', 'e.apng', 'f.jfif', 'g.heic', 'h.heif', 'i.tiff', 'j.jxl']) {
			assert.ok(isImagePath(name), `${name} 应当识别为图片`);
		}
	});

	it('SVG 使用矢量缩放，位图不用', () => {
		assert.strictEqual(isVectorImagePath('a.svg'), true);
		assert.strictEqual(isVectorImagePath('a.SVG'), true);
		assert.strictEqual(isVectorImagePath('a.png'), false);
	});

	it('HEIF / TIFF / JXL 没有内核解码器，只做外部打开兜底', () => {
		for (const name of ['a.heic', 'b.heif', 'c.tif', 'd.tiff', 'e.jxl']) {
			assert.strictEqual(isNativelyDecodedImage(name), false, `${name} 不应被当作内核可解码`);
		}
		for (const name of ['a.png', 'b.jpg', 'c.webp', 'd.avif', 'e.svg']) {
			assert.strictEqual(isNativelyDecodedImage(name), true, `${name} 应当由内核直接解码`);
		}
	});

	it('清单包含任务点名的格式', () => {
		for (const extension of ['svg', 'webp', 'heic', 'heif', 'avif']) {
			assert.ok((IMAGE_EXTENSIONS as readonly string[]).includes(extension), `清单缺少 ${extension}`);
		}
	});
});

describe('media/formats: 视频格式', () => {
	it('常见容器都归视频视图', () => {
		for (const name of [
			'a.mp4', 'b.m4v', 'c.mov', 'd.webm', 'e.ogv', 'f.mkv', 'g.avi', 'h.wmv',
			'i.flv', 'j.mpg', 'k.mpeg', 'l.m2ts', 'm.3gp', 'n.3g2', 'o.rm', 'p.rmvb',
		]) {
			assert.ok(isVideoPath(name), `${name} 应当识别为视频`);
		}
	});

	it('不能把 TypeScript 的 .ts / .mts 当成 MPEG-TS 视频', () => {
		assert.strictEqual(isVideoPath('a.ts'), false);
		assert.strictEqual(isVideoPath('a.mts'), false);
		assert.ok(!(VIDEO_EXTENSIONS as readonly string[]).includes('ts'));
		assert.ok(!(VIDEO_EXTENSIONS as readonly string[]).includes('mts'));
	});

	it('普通图片 / 文本不会被识别成视频', () => {
		for (const name of ['a.png', 'b.svg', 'c.md', 'd.json', 'e.txt']) {
			assert.strictEqual(isVideoPath(name), false);
		}
	});
});
