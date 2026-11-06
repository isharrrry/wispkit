import * as assert from 'assert';
import { buildHtmlFromSource, injectIntoHead, permissiveContentSecurityPolicy } from '../html/page';

const CSP_SOURCE = 'vscode-webview://abc123';

describe('html/page', () => {
	describe('injectIntoHead', () => {
		it('插到已有 <head> 之后', () => {
			const result = injectIntoHead('<html><head><title>t</title></head><body></body></html>', 'MARK');
			assert.ok(result.indexOf('MARK') > result.indexOf('<head>'));
			assert.ok(result.indexOf('MARK') < result.indexOf('<title>'));
		});

		it('大小写与属性不敏感', () => {
			const result = injectIntoHead('<HTML><HEAD lang="zh">x</HEAD></HTML>', 'MARK');
			assert.ok(result.includes('<HEAD lang="zh">\nMARK'));
		});

		it('有 <html> 无 <head> → 补一个 head', () => {
			const result = injectIntoHead('<html><body>x</body></html>', 'MARK');
			assert.ok(result.includes('<head>\nMARK\n</head>'));
		});

		it('裸片段 → 前置 head', () => {
			const result = injectIntoHead('<p>x</p>', 'MARK');
			assert.ok(result.startsWith('<head>\nMARK\n</head>'));
		});

		it('空 head 内容时原样返回', () => {
			assert.strictEqual(injectIntoHead('<p>x</p>', ''), '<p>x</p>');
		});
	});

	describe('permissiveContentSecurityPolicy', () => {
		it('不含 nonce —— 否则 unsafe-inline 会被 CSP3 忽略，页面自带脚本就跑不了', () => {
			const csp = permissiveContentSecurityPolicy(CSP_SOURCE);
			assert.ok(csp.includes(`script-src 'self' ${CSP_SOURCE} 'unsafe-inline'`));
			assert.ok(!csp.includes('nonce-'));
		});

		it('放行 http(s) 资源与 iframe', () => {
			const csp = permissiveContentSecurityPolicy(CSP_SOURCE);
			assert.ok(csp.includes('https: http:'));
			assert.ok(csp.includes('frame-src'));
		});
	});

	describe('buildHtmlFromSource', () => {
		it('注入 CSP 与 base，并改写 vscode://file 链接', () => {
			const source = '<html><head></head><body><a href="vscode://file/d:/a/b.md:207">go</a></body></html>';
			const result = buildHtmlFromSource(source, {
				baseHref: 'vscode-webview://abc123/doc.html',
				cspSource: CSP_SOURCE,
			});

			assert.ok(result.includes('Content-Security-Policy'));
			assert.ok(result.includes('<base href="vscode-webview://abc123/doc.html">'));
			assert.ok(result.includes('href="command:vscode.open?'));
			assert.ok(!result.includes('href="vscode://file/'));
		});

		it('没有 baseHref 时不注入 base', () => {
			const result = buildHtmlFromSource('<p>x</p>', { cspSource: CSP_SOURCE });
			assert.ok(!result.includes('<base'));
			assert.ok(result.includes('Content-Security-Policy'));
		});

		it('注入链接路由脚本（defer，且在 page 自己的脚本之前）', () => {
			const source = '<html><head><script src="app.js"></script></head><body></body></html>';
			const result = buildHtmlFromSource(source, {
				cspSource: CSP_SOURCE,
				scriptSrc: 'vscode-webview://abc123/html.js',
			});

			assert.ok(result.includes('<script defer src="vscode-webview://abc123/html.js"></script>'));
			assert.ok(result.indexOf('html.js') < result.indexOf('app.js'), '路由脚本必须先于页面脚本就位');
		});

		it('没有 scriptSrc 时不注入脚本', () => {
			const result = buildHtmlFromSource('<p>x</p>', { cspSource: CSP_SOURCE });
			assert.ok(!result.includes('<script'));
		});
	});
});
