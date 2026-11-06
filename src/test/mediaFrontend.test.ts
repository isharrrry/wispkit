import * as assert from 'assert';
import { renderImagePage } from '../image/page';
import { imageContentSecurityPolicy, videoContentSecurityPolicy } from '../media/csp';
import { renderVideoPage } from '../video/page';
import { installDom, loadMediaModule } from './helpers/dom';

const CSP_SOURCE = 'vscode-webview://abc123';
const IMAGE_CONFIG = { wheelZoom: true, wheelStep: 1.1, dragButton: 'right' as const };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function imageHtml(format: string): string {
	return renderImagePage({
		title: `sample.${format}`,
		csp: imageContentSecurityPolicy(CSP_SOURCE, 'N1'),
		nonce: 'N1',
		imageSrc: `vscode-webview://abc123/sample.${format}`,
		runtimeScript: 'vscode-webview://abc123/image.js',
		runtimeStyle: 'vscode-webview://abc123/image.css',
		config: IMAGE_CONFIG,
		format,
	});
}

function videoHtml(format: string): string {
	return renderVideoPage({
		title: `sample.${format}`,
		csp: videoContentSecurityPolicy(CSP_SOURCE, 'N1'),
		nonce: 'N1',
		videoSrc: `vscode-webview://abc123/sample.${format}`,
		runtimeScript: 'vscode-webview://abc123/video.js',
		runtimeStyle: 'vscode-webview://abc123/video.css',
		format,
	});
}

function stubBox(element: any, width: number, height: number): void {
	Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
	Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
	element.getBoundingClientRect = () => ({
		left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
	});
}

function stubImage(image: any, width: number, height: number): void {
	Object.defineProperty(image, 'complete', { value: true, configurable: true });
	Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
	Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
	image.getBoundingClientRect = () => ({
		left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
	});
}

function withVsCodeApi(result: unknown[], run: () => void): void {
	const scope = globalThis as any;
	const previous = scope.acquireVsCodeApi;
	scope.acquireVsCodeApi = () => ({ postMessage: (message: unknown) => result.push(message) });
	try {
		run();
	} finally {
		if (previous === undefined) {
			delete scope.acquireVsCodeApi;
		} else {
			scope.acquireVsCodeApi = previous;
		}
	}
}

describe('media/image.js 前端', () => {
	it('SVG 用布局尺寸缩放，不会把矢量图 transform 栅格化', () => {
		const dom = installDom(imageHtml('svg'));
		const doc = dom.window.document;
		const viewport = doc.getElementById('wispkit-image-viewport')!;
		const image: any = doc.getElementById('wispkit-image')!;
		stubBox(viewport, 800, 600);
		stubImage(image, 400, 200);

		loadMediaModule('media/image.js');
		const selftest = (dom.window as any).__wispkitSelftest;

		assert.strictEqual(selftest.isVector(), true);
		assert.strictEqual(image.style.width, '400px');
		assert.ok(!/scale\(/.test(image.style.transform), 'SVG 不应走 transform: scale()');

		const wheel = new dom.window.WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true });
		viewport.dispatchEvent(wheel);
		assert.ok(parseFloat(image.style.width) > 400, '滚轮放大后应改布局宽度');
	});

	it('HEIC 解码失败时显示兜底面板与说明', () => {
		const dom = installDom(imageHtml('heic'));
		const doc = dom.window.document;
		const image: any = doc.getElementById('wispkit-image')!;
		Object.defineProperty(image, 'complete', { value: false, configurable: true });
		Object.defineProperty(image, 'naturalWidth', { value: 0, configurable: true });

		loadMediaModule('media/image.js');
		const panel = doc.getElementById('wispkit-image-error')!;
		assert.strictEqual(panel.hidden, true);

		image.dispatchEvent(new dom.window.Event('error'));
		assert.strictEqual(panel.hidden, false);
		assert.ok(doc.getElementById('wispkit-image-error-detail')!.textContent!.includes('HEIF/HEIC'));
	});

	it('脚本执行前图片就已失败（error 事件已错过）也要显示兜底', async () => {
		const dom = installDom(imageHtml('heic'));
		const doc = dom.window.document;
		const image: any = doc.getElementById('wispkit-image')!;
		Object.defineProperty(image, 'complete', { value: true, configurable: true });
		Object.defineProperty(image, 'naturalWidth', { value: 0, configurable: true });
		Object.defineProperty(image, 'naturalHeight', { value: 0, configurable: true });

		loadMediaModule('media/image.js');
		await sleep(0);
		const panel = doc.getElementById('wispkit-image-error')!;
		assert.strictEqual(panel.hidden, false);
		assert.ok(doc.getElementById('wispkit-image-error-detail')!.textContent!.includes('HEIF/HEIC'));
	});

	it('「用系统默认应用打开 / 复制路径」向宿主上报消息', () => {
		const dom = installDom(imageHtml('png'));
		const doc = dom.window.document;
		const image: any = doc.getElementById('wispkit-image')!;
		stubImage(image, 10, 10);
		const messages: unknown[] = [];

		withVsCodeApi(messages, () => {
			loadMediaModule('media/image.js');
			(doc.getElementById('wispkit-image-open-external') as HTMLButtonElement).click();
			(doc.getElementById('wispkit-image-copy-path') as HTMLButtonElement).click();
		});

		assert.deepStrictEqual(messages, [
			{ type: 'wispkit.media.openExternal' },
			{ type: 'wispkit.media.copyPath' },
		]);
	});
});

describe('media/video.js 前端', () => {
	it('容器 / 编码不支持时显示兜底说明', () => {
		const dom = installDom(videoHtml('mkv'));
		const doc = dom.window.document;
		const video: any = doc.getElementById('wispkit-video')!;

		loadMediaModule('media/video.js');
		const panel = doc.getElementById('wispkit-video-error')!;
		assert.strictEqual(panel.hidden, true);

		Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true });
		video.dispatchEvent(new dom.window.Event('error'));

		assert.strictEqual(panel.hidden, false);
		assert.ok(doc.getElementById('wispkit-video-error-title')!.textContent!.includes('MKV'));
		assert.ok(doc.getElementById('wispkit-video-error-detail')!.textContent!.includes('容器或编码'));
	});

	it('脚本执行前视频就已失败（error 事件已错过）也要显示兜底', () => {
		const dom = installDom(videoHtml('mkv'));
		const doc = dom.window.document;
		const video: any = doc.getElementById('wispkit-video')!;
		Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true });
		Object.defineProperty(video, 'readyState', { value: 0, configurable: true });

		loadMediaModule('media/video.js');
		const panel = doc.getElementById('wispkit-video-error')!;
		assert.strictEqual(panel.hidden, false);
		assert.ok(doc.getElementById('wispkit-video-error-detail')!.textContent!.includes('容器或编码'));
	});

	it('加载元数据后状态栏给出格式 / 分辨率 / 时长', () => {
		const dom = installDom(videoHtml('mp4'));
		const doc = dom.window.document;
		const video: any = doc.getElementById('wispkit-video')!;
		Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
		Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
		Object.defineProperty(video, 'duration', { value: 65, configurable: true });

		loadMediaModule('media/video.js');
		video.dispatchEvent(new dom.window.Event('loadedmetadata'));

		assert.strictEqual(doc.getElementById('wispkit-video-hint')!.textContent, 'MP4 · 1920×1080 · 1:05');
	});

	it('脚本执行前元数据就已加载（readyState>0）也要补上状态栏', () => {
		const dom = installDom(videoHtml('webm'));
		const doc = dom.window.document;
		const video: any = doc.getElementById('wispkit-video')!;
		Object.defineProperty(video, 'readyState', { value: 1, configurable: true });
		Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
		Object.defineProperty(video, 'videoHeight', { value: 360, configurable: true });
		Object.defineProperty(video, 'duration', { value: 5, configurable: true });

		loadMediaModule('media/video.js');

		assert.strictEqual(doc.getElementById('wispkit-video-hint')!.textContent, 'WEBM · 640×360 · 0:05');
	});

	it('工具栏两个按钮向宿主上报消息', () => {
		const dom = installDom(videoHtml('mp4'));
		const doc = dom.window.document;
		const messages: unknown[] = [];

		withVsCodeApi(messages, () => {
			loadMediaModule('media/video.js');
			(doc.getElementById('wispkit-video-open-external') as HTMLButtonElement).click();
			(doc.getElementById('wispkit-video-copy-path') as HTMLButtonElement).click();
		});

		assert.deepStrictEqual(messages, [
			{ type: 'wispkit.media.openExternal' },
			{ type: 'wispkit.media.copyPath' },
		]);
	});
});
