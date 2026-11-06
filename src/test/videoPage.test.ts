import * as assert from 'assert';
import { videoContentSecurityPolicy } from '../media/csp';
import { renderVideoPage } from '../video/page';

const CSP_SOURCE = 'vscode-webview://abc123';

function render(overrides: Partial<Parameters<typeof renderVideoPage>[0]> = {}): string {
	return renderVideoPage({
		title: 'a.mp4',
		csp: videoContentSecurityPolicy(CSP_SOURCE, 'N1'),
		nonce: 'N1',
		videoSrc: 'vscode-webview://abc123/a.mp4',
		runtimeScript: 'vscode-webview://abc123/video.js',
		runtimeStyle: 'vscode-webview://abc123/video.css',
		format: 'mp4',
		...overrides,
	});
}

describe('video/page', () => {
	it('页面用一个原生 <video>，带 controls 与元数据预加载', () => {
		const html = render();
		assert.ok(html.includes('<video id="wispkit-video"'));
		assert.ok(html.includes('src="vscode-webview://abc123/a.mp4"'));
		assert.ok(html.includes(' controls'));
		assert.ok(html.includes('preload="metadata"'));
		assert.ok(html.includes('playsinline'));
		assert.ok(html.includes('data-format="mp4"'));
	});

	it('工具栏提供系统播放器打开与复制路径', () => {
		const html = render();
		assert.ok(html.includes('id="wispkit-video-open-external"'));
		assert.ok(html.includes('id="wispkit-video-copy-path"'));
		assert.ok(html.includes('系统播放器打开'));
	});

	it('播放失败兜底面板默认隐藏', () => {
		const html = render();
		assert.ok(html.includes('id="wispkit-video-error" hidden'));
		assert.ok(html.includes('id="wispkit-video-error-detail"'));
	});

	it('标题与 src 都按属性转义', () => {
		const html = render({ title: '<b>"x"</b>', videoSrc: 'a" onerror="x' });
		assert.ok(!html.includes('<b>"x"</b>'));
		assert.ok(html.includes('&lt;b&gt;'));
		assert.ok(html.includes('a&quot; onerror=&quot;x'));
	});

	it('CSP 放行 media-src 与 nonce 脚本', () => {
		const csp = videoContentSecurityPolicy(CSP_SOURCE, 'N1');
		assert.ok(csp.includes(`media-src ${CSP_SOURCE}`));
		assert.ok(csp.includes(`script-src 'nonce-N1'`));
		assert.ok(!csp.includes('unsafe-inline'));
	});
});
