import * as assert from 'assert';
import { installDom, loadMediaModule } from './helpers/dom';

type RouterModule = {
	installLinkRouter: (options: Record<string, unknown>) => () => void;
	findAnchor: (node: unknown) => unknown;
	isRoutableHref: (href: unknown) => boolean;
};

function setup(html: string, options: { canHandle?: (href: string) => boolean } = {}) {
	const dom = installDom(`<!DOCTYPE html><html><body>${html}</body></html>`);
	const links = loadMediaModule('media/shared/links.js') as RouterModule;
	const opened: Array<{ href: string; anchor: unknown }> = [];
	const uninstall = links.installLinkRouter({
		document: dom.window.document,
		canHandle: options.canHandle,
		onOpenLink: (href: string, anchor: unknown) => opened.push({ href, anchor }),
	});
	let windowClicks = 0;
	dom.window.addEventListener('click', () => { windowClicks += 1; });
	return {
		dom,
		links,
		opened,
		uninstall,
		windowClicks: () => windowClicks,
		click(selector: string) {
			const element = dom.window.document.querySelector(selector);
			assert.ok(element, `找不到 ${selector}`);
			const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
			element!.dispatchEvent(event);
			return event;
		},
	};
}

describe('media/shared/links.js 链接路由', () => {
	it('相对链接：回传原始 href，阻止默认行为并截断向 window 的冒泡', () => {
		const page = setup('<a id="rel" href="targets/target-simple.md">目标</a>');
		const event = page.click('#rel');

		assert.deepStrictEqual(page.opened.map(item => item.href), ['targets/target-simple.md']);
		assert.strictEqual(event.defaultPrevented, true);
		assert.strictEqual(page.windowClicks(), 0, '必须 stopPropagation：否则 webview 外壳会再按 https 打开一次');
	});

	it('点击链接里的图片，按链接处理（不是图片放大）', () => {
		const page = setup('<a id="rel" href="../a.md"><img id="pic" src="x.png"></a>');
		page.click('#pic');
		assert.deepStrictEqual(page.opened.map(item => item.href), ['../a.md']);
	});

	it('http(s)/mailto/非 file 的 vscode: 交给 webview 外壳，不抢', () => {
		const page = setup([
			'<a id="http" href="https://example.com/a">e</a>',
			'<a id="mail" href="mailto:a@b.c">m</a>',
			'<a id="setting" href="vscode://settings/wispkit.toc.depth">s</a>',
		].join(''));
		for (const selector of ['#http', '#mail', '#setting']) {
			const event = page.click(selector);
			assert.strictEqual(event.defaultPrevented, false, `${selector} 不该被拦`);
		}
		assert.strictEqual(page.opened.length, 0);
	});

	it('vscode://file/ 仍由扩展接管（当前窗口 + 行号）', () => {
		const page = setup('<a id="vf" href="vscode://file/d:/a/b.md:7">f</a>');
		const event = page.click('#vf');
		assert.strictEqual(event.defaultPrevented, true);
		assert.deepStrictEqual(page.opened.map(item => item.href), ['vscode://file/d:/a/b.md:7']);
	});

	it('页内锚点不拦（交给浏览器 / 目录定位）', () => {
		const page = setup('<a id="hash" href="#section">锚点</a>');
		const event = page.click('#hash');
		assert.strictEqual(page.opened.length, 0);
		assert.strictEqual(event.defaultPrevented, false);
	});

	it('command: 链接不拦（宿主按 enableCommandUris 执行）', () => {
		const page = setup('<a id="cmd" href="command:vscode.open?%5B%5D">命令</a>');
		const event = page.click('#cmd');
		assert.strictEqual(page.opened.length, 0);
		assert.strictEqual(event.defaultPrevented, false);
	});

	it('javascript: / data: 一律不接手', () => {
		const page = setup('<a id="js" href="javascript:void(0)">x</a><a id="data" href="data:text/html,x">d</a>');
		page.click('#js');
		page.click('#data');
		assert.strictEqual(page.opened.length, 0);
	});

	it('页面脚本已经 preventDefault 的点击不抢', () => {
		const page = setup('<a id="spa" href="/route">SPA</a>');
		const anchor = page.dom.window.document.querySelector('#spa')!;
		anchor.addEventListener('click', event => event.preventDefault());
		const event = page.click('#spa');
		assert.strictEqual(page.opened.length, 0);
		assert.strictEqual(event.defaultPrevented, true);
		assert.strictEqual(page.windowClicks(), 1, '没有拦截就不该 stopPropagation');
	});

	it('canHandle 返回 false 时不拦（Markdown 编辑模式）', () => {
		const page = setup('<a id="rel" href="a.md">a</a>', { canHandle: () => false });
		const event = page.click('#rel');
		assert.strictEqual(page.opened.length, 0);
		assert.strictEqual(event.defaultPrevented, false);
	});

	it('非链接点击不处理', () => {
		const page = setup('<p id="p">文本</p>');
		page.click('#p');
		assert.strictEqual(page.opened.length, 0);
	});

	it('卸载后不再拦截', () => {
		const page = setup('<a id="rel" href="a.md">a</a>');
		page.uninstall();
		page.click('#rel');
		assert.strictEqual(page.opened.length, 0);
	});

	it('isRoutableHref 的判定', () => {
		const links = loadMediaModule('media/shared/links.js') as RouterModule;
		assert.strictEqual(links.isRoutableHref('a.md'), true);
		assert.strictEqual(links.isRoutableHref('D:/a/b.md'), true, 'Windows 盘符不是 scheme');
		assert.strictEqual(links.isRoutableHref('vscode://file/d:/a.md'), true);
		assert.strictEqual(links.isRoutableHref('file:///d:/a.md'), true);
		assert.strictEqual(links.isRoutableHref('https://example.com'), false, '外链交给外壳');
		assert.strictEqual(links.isRoutableHref('mailto:a@b.c'), false);
		assert.strictEqual(links.isRoutableHref('vscode://settings/wispkit.toc.depth'), false, '非 file 的 vscode 交给协议处理器');
		assert.strictEqual(links.isRoutableHref('#a'), false);
		assert.strictEqual(links.isRoutableHref('command:vscode.open?%5B%5D'), false);
		assert.strictEqual(links.isRoutableHref('javascript:alert(1)'), false);
		assert.strictEqual(links.isRoutableHref(''), false);
	});
});

describe('media/html.js 入口', () => {
	it('把链接点击转成 wispkit.openLink 消息', () => {
		const dom = installDom('<!DOCTYPE html><html><body><a id="rel" href="targets/x.md">x</a></body></html>');
		const messages: any[] = [];
		(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
			postMessage: (message: any) => messages.push(message),
		});
		try {
			loadMediaModule('media/html.js');
			const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
			dom.window.document.querySelector('#rel')!.dispatchEvent(event);

			assert.strictEqual(event.defaultPrevented, true);
			assert.deepStrictEqual(messages, [{ type: 'wispkit.openLink', href: 'targets/x.md' }]);
		} finally {
			delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
		}
	});
});
