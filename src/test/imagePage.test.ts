import * as assert from 'assert';
import { renderImagePage } from '../image/page';
import { imageContentSecurityPolicy } from '../media/csp';

const CSP_SOURCE = 'vscode-webview://abc123';

function render(overrides: Partial<Parameters<typeof renderImagePage>[0]> = {}): string {
	return renderImagePage({
		title: 'a.png',
		csp: imageContentSecurityPolicy(CSP_SOURCE, 'N1'),
		nonce: 'N1',
		imageSrc: 'vscode-webview://abc123/a.png',
		runtimeScript: 'vscode-webview://abc123/image.js',
		runtimeStyle: 'vscode-webview://abc123/image.css',
		config: { wheelZoom: true, wheelStep: 1.1, dragButton: 'right' },
		format: 'png',
		...overrides,
	});
}

describe('image/page', () => {
	it('页面带 img、格式标记与缩放配置', () => {
		const html = render({ format: 'svg' });
		assert.ok(html.includes('<img id="wispkit-image"'));
		assert.ok(html.includes('src="vscode-webview://abc123/a.png"'));
		assert.ok(html.includes('data-format="svg"'));
		assert.ok(html.includes('&quot;wheelZoom&quot;:true'));
	});

	it('解码失败兜底面板默认隐藏，并提供外部打开 / 复制路径', () => {
		const html = render();
		assert.ok(html.includes('id="wispkit-image-error" hidden'));
		assert.ok(html.includes('id="wispkit-image-open-external"'));
		assert.ok(html.includes('id="wispkit-image-copy-path"'));
	});

	it('标题与 src 都按属性转义', () => {
		const html = render({ title: '<b>"x"</b>', imageSrc: 'a" onerror="x' });
		assert.ok(!html.includes('<b>"x"</b>'));
		assert.ok(html.includes('&lt;b&gt;'));
		assert.ok(html.includes('a&quot; onerror=&quot;x'));
	});

	it('CSP 放行 data: 图片，脚本只认 nonce', () => {
		const csp = imageContentSecurityPolicy(CSP_SOURCE, 'N1');
		assert.ok(csp.includes(`img-src data: ${CSP_SOURCE}`));
		assert.ok(csp.includes(`script-src 'nonce-N1'`));
		assert.ok(!csp.includes('unsafe-inline'));
	});
});
