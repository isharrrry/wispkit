import * as assert from 'assert';
import { installDom, loadMediaModule, stubScrollIntoView } from './helpers/dom';

const { createTableOfContents } = loadMediaModule('media/shared/toc.js');

const DOC = `<!DOCTYPE html><html><body>
	<nav id="wispkit-toc"></nav>
	<main id="wispkit-content">
		<h1 id="a">Alpha</h1>
		<p>text</p>
		<h2 id="a1">Alpha One</h2>
		<h3 id="a11">Alpha One One</h3>
		<h4 id="a111">Too deep</h4>
		<h2 id="a2">Alpha Two</h2>
		<h1 id="b">Beta</h1>
	</main>
</body></html>`;

interface SetupOptions {
	withSplitter?: boolean;
	storage?: Map<string, string>;
}

function setup(depth = 3, enabled = true, options: SetupOptions = {}) {
	const dom = installDom(DOC);
	const scroll = stubScrollIntoView(dom);
	const content = dom.window.document.getElementById('wispkit-content')!;
	const nav = dom.window.document.getElementById('wispkit-toc')!;

	let splitter: HTMLElement | undefined;
	if (options.withSplitter) {
		splitter = dom.window.document.createElement('div');
		splitter.id = 'wispkit-splitter';
		// 与页面结构一致：nav 紧跟分隔条
		nav.after(splitter);
	}

	const store = options.storage ?? new Map<string, string>();
	const storage = {
		get: (key: string) => store.get(key) ?? null,
		set: (key: string, value: string) => {
			store.set(key, value);
		},
	};

	const toc = createTableOfContents({ content, nav, splitter, depth, enabled, storage });
	toc.rebuild();
	return { dom, content, nav, splitter, toc, scroll, store };
}

function pointerEvent(dom: any, type: string, init: Record<string, unknown> = {}) {
	return new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

describe('media/shared/toc', () => {
	it('按 depth 过滤标题（h4 不进目录）', () => {
		const { nav } = setup(3);
		const texts = Array.from(nav.querySelectorAll('a')).map(a => a.textContent);
		assert.deepStrictEqual(texts, ['Alpha', 'Alpha One', 'Alpha One One', 'Alpha Two', 'Beta']);
	});

	it('depth=1 只收 h1', () => {
		const { nav } = setup(1);
		assert.deepStrictEqual(Array.from(nav.querySelectorAll('a')).map(a => a.textContent), ['Alpha', 'Beta']);
	});

	it('按层级嵌套：h2 落在所属 h1 的列表里，h3 再深一层', () => {
		const { nav } = setup(3);
		const alphaItem = nav.querySelector('li')!;
		assert.strictEqual(alphaItem.querySelector('a')!.textContent, 'Alpha');

		const directList = Array.from(alphaItem.children).find(child => child.tagName === 'UL');
		assert.ok(directList, 'Alpha 下应当有一个子列表');
		const directEntries = Array.from(directList!.children).map(item => item.querySelector('a')!.textContent);
		assert.deepStrictEqual(directEntries, ['Alpha One', 'Alpha Two']);

		const alphaOneItem = directList!.children[0];
		const deepList = Array.from(alphaOneItem.children).find(child => child.tagName === 'UL');
		assert.ok(deepList, 'Alpha One 下应当有一个子列表');
		assert.deepStrictEqual(
			Array.from(deepList!.children).map(item => item.querySelector('a')!.textContent),
			['Alpha One One'],
		);
	});

	it('没有 id 的标题会被补上 id 并可定位', () => {
		const dom = installDom(`<!DOCTYPE html><html><body>
			<nav id="wispkit-toc"></nav><main id="wispkit-content"><h1>No Id</h1></main></body></html>`);
		const content = dom.window.document.getElementById('wispkit-content')!;
		const nav = dom.window.document.getElementById('wispkit-toc')!;
		createTableOfContents({ content, nav, depth: 3, enabled: true }).rebuild();

		const heading = content.querySelector('h1')!;
		assert.ok(heading.id, '标题应当被赋予 id');
		assert.strictEqual(nav.querySelector('a')!.getAttribute('href'), `#${heading.id}`);
	});

	it('点击条目滚动到对应标题并高亮', () => {
		const { nav, scroll } = setup(3);
		const links = Array.from(nav.querySelectorAll('a'));
		const beta = links.find(a => a.textContent === 'Beta')!;
		beta.dispatchEvent(new (globalThis as any).window.MouseEvent('click', { bubbles: true, cancelable: true }));

		assert.deepStrictEqual(scroll.scrolled, ['b', 'Beta']);
		assert.ok(beta.classList.contains('wispkit-toc-active'));
	});

	it('enabled=false 时隐藏且不建条目', () => {
		const { nav, toc } = setup(3, false);
		assert.strictEqual(nav.hidden, true);
		assert.strictEqual(nav.querySelectorAll('a').length, 0);
		assert.strictEqual(toc.headingCount, 0);
	});

	it('setConfig 改深度后重建，条目数跟着变', () => {
		const { nav, toc } = setup(3);
		assert.strictEqual(toc.headingCount, 5);
		toc.setConfig({ tocDepth: 2, tocEnabled: true });
		assert.strictEqual(toc.headingCount, 4);
		assert.deepStrictEqual(Array.from(nav.querySelectorAll('a')).map(a => a.textContent),
			['Alpha', 'Alpha One', 'Alpha Two', 'Beta']);
	});

	it('空文档不产生条目也不抛错', () => {
		const dom = installDom(`<!DOCTYPE html><html><body>
			<nav id="wispkit-toc"></nav><main id="wispkit-content"></main></body></html>`);
		const nav = dom.window.document.getElementById('wispkit-toc')!;
		const toc = createTableOfContents({
			content: dom.window.document.getElementById('wispkit-content')!,
			nav,
			depth: 3,
			enabled: true,
		});
		toc.rebuild();
		assert.strictEqual(toc.headingCount, 0);
		assert.strictEqual(nav.querySelectorAll('a').length, 0);
	});

	it('重建时不残留上一次的条目', () => {
		const { content, nav, toc } = setup(3);
		content.innerHTML = '<h1 id="only">Only</h1>';
		toc.rebuild();
		assert.deepStrictEqual(Array.from(nav.querySelectorAll('a')).map(a => a.textContent), ['Only']);
	});

	it('有子层级的条目才有折叠按钮', () => {
		const { nav } = setup(3);
		const links = Array.from(nav.querySelectorAll('a'));
		const alphaItem = links.find(a => a.textContent === 'Alpha')!.closest('li')!;
		const betaItem = links.find(a => a.textContent === 'Beta')!.closest('li')!;
		assert.ok(alphaItem.querySelector('.wispkit-toc-twisty'), 'Alpha 有子层级，应有折叠按钮');
		assert.strictEqual(betaItem.querySelector('.wispkit-toc-twisty'), null, 'Beta 无子层级，不应有折叠按钮');
	});

	it('点折叠按钮收起该层级，再点展开', () => {
		const { dom, nav } = setup(3);
		const alphaItem = nav.querySelector('li')!;
		const twisty = alphaItem.querySelector('.wispkit-toc-twisty')!;

		twisty.dispatchEvent(pointerEvent(dom, 'click'));
		assert.ok(alphaItem.classList.contains('wispkit-toc-collapsed'));

		twisty.dispatchEvent(pointerEvent(dom, 'click'));
		assert.ok(!alphaItem.classList.contains('wispkit-toc-collapsed'));
	});

	it('collapseAll 收起所有层级，expandAll 全部展开', () => {
		const { nav, toc } = setup(3);
		const branches = Array.from(nav.querySelectorAll('li.wispkit-toc-branch'));
		assert.ok(branches.length >= 2, '示例文档应当有多个层级节点');

		toc.collapseAll();
		assert.ok(branches.every(item => item.classList.contains('wispkit-toc-collapsed')));

		toc.expandAll();
		assert.ok(branches.every(item => !item.classList.contains('wispkit-toc-collapsed')));
	});

	it('折叠状态下点击深层条目，会先展开祖先再定位', () => {
		const { nav, toc, scroll } = setup(3);
		const alphaItem = nav.querySelector('li')!;
		toc.collapseAll();
		assert.ok(alphaItem.classList.contains('wispkit-toc-collapsed'));

		assert.strictEqual(toc.reveal('a11'), true);
		assert.ok(!alphaItem.classList.contains('wispkit-toc-collapsed'), '祖先层级应当被展开');
		assert.ok(scroll.scrolled.includes('a11'));
	});

	it('reveal 对目录之外的 id 返回 false', () => {
		const { toc } = setup(3);
		assert.strictEqual(toc.reveal('not-a-heading'), false);
	});

	/**
	 * jsdom 不做布局，所以这里手动把正文容器伪装成「有内容溢出、可滚」。
	 * 这三个用例锁的都是同一个判断：**只滚 `auto`/`scroll` 的容器**。
	 * `overflow: hidden` 的祖先虽然也能被 `scrollIntoView` 程序化滚动，但它不是用户
	 * 预期中的滚动区 —— 滚它会连整个文档一起顶上去，工具栏就被顶出视野。
	 */
	function fakeScroller(content: HTMLElement, overflowY: string, scrollHeight: number, clientHeight: number) {
		content.style.overflowY = overflowY;
		Object.defineProperty(content, 'scrollHeight', { value: scrollHeight, configurable: true });
		Object.defineProperty(content, 'clientHeight', { value: clientHeight, configurable: true });
	}

	function trackScrollIntoView(dom: any): string[] {
		const calls: string[] = [];
		(dom.window.HTMLElement.prototype as any).scrollIntoView = function (this: any) {
			calls.push(this.id || this.tagName);
		};
		return calls;
	}

	function stubRect(element: any, top: number) {
		Object.defineProperty(element, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
		});
	}

	it('正文容器可滚时只改它的 scrollTop，不再把标题交给 scrollIntoView（那会连 overflow:hidden 的文档一起滚）', () => {
		const { dom, content, toc } = setup(3);
		fakeScroller(content, 'auto', 2000, 600);
		stubRect(content, 100);
		stubRect(dom.window.document.getElementById('a11'), 460);
		const calls = trackScrollIntoView(dom);

		assert.strictEqual(toc.reveal('a11'), true);
		assert.ok(!calls.includes('a11'), '标题本身不该再被 scrollIntoView 滚（那会一路滚到文档，把工具栏顶走）');
		assert.strictEqual(content.scrollTop, 360, '滚动量应当是标题相对正文容器的偏移');
	});

	it('overflow:hidden 的祖先不算可滚容器（这正是工具栏被顶出视野的成因）', () => {
		const { dom, content, toc } = setup(3);
		fakeScroller(content, 'hidden', 2000, 600);
		const calls = trackScrollIntoView(dom);

		assert.strictEqual(toc.reveal('a11'), true);
		assert.ok(calls.includes('a11'), '找不到可滚区时退到 scrollIntoView（此时由 CSS 的 overflow:clip 兜住文档）');
		assert.strictEqual(content.scrollTop, 0, 'hidden 的容器不该被我们改 scrollTop');
	});

	it('内容没有溢出时不算可滚容器', () => {
		const { dom, content, toc } = setup(3);
		fakeScroller(content, 'auto', 600, 600);
		const calls = trackScrollIntoView(dom);

		toc.reveal('a11');
		assert.ok(calls.includes('a11'));
		assert.strictEqual(content.scrollTop, 0);
	});

	it('目录栏可一键收纳并可恢复', () => {
		const { nav, splitter, toc } = setup(3, true, { withSplitter: true });
		assert.strictEqual(toc.sidebarVisible, true);
		assert.strictEqual(nav.hidden, false);

		toc.toggleSidebar();
		assert.strictEqual(toc.sidebarVisible, false);
		assert.strictEqual(nav.hidden, true);
		assert.strictEqual(splitter!.hidden, true);

		toc.toggleSidebar();
		assert.strictEqual(nav.hidden, false);
		assert.strictEqual(splitter!.hidden, false);
	});

	it('收纳状态与宽度会落盘并在下次恢复', () => {
		const store = new Map<string, string>();
		const first = setup(3, true, { withSplitter: true, storage: store });
		first.toc.toggleSidebar();
		first.splitter!.dispatchEvent(pointerEvent(first.dom, 'pointerdown', { clientX: 300, button: 0 }));
		first.splitter!.dispatchEvent(pointerEvent(first.dom, 'pointermove', { clientX: 333 }));
		first.splitter!.dispatchEvent(pointerEvent(first.dom, 'pointerup', {}));

		assert.strictEqual(store.get('wispkit.toc.sidebar'), '0');
		assert.strictEqual(store.get('wispkit.toc.width'), '333');

		const second = setup(3, true, { withSplitter: true, storage: store });
		assert.strictEqual(second.toc.sidebarVisible, false);
		assert.strictEqual(second.nav.hidden, true);
		assert.strictEqual(second.toc.navWidth, 333);
	});

	it('拖动分隔条改变目录宽度', () => {
		const { dom, nav, splitter, toc } = setup(3, true, { withSplitter: true });
		assert.strictEqual(toc.navWidth, 240);

		splitter!.dispatchEvent(pointerEvent(dom, 'pointerdown', { clientX: 240, button: 0 }));
		splitter!.dispatchEvent(pointerEvent(dom, 'pointermove', { clientX: 380 }));
		assert.strictEqual(nav.style.width, '380px');

		// 未按下时移动不应改变宽度
		splitter!.dispatchEvent(pointerEvent(dom, 'pointerup', {}));
		splitter!.dispatchEvent(pointerEvent(dom, 'pointermove', { clientX: 500 }));
		assert.strictEqual(toc.navWidth, 380);
	});

	it('目录栏在右侧时拖拽方向相反（宽度 = 右边缘 − 指针）', () => {
		const { dom, nav, splitter, toc } = setup(3, true, { withSplitter: true });
		const layout = nav.parentElement!;
		layout.classList.add('wispkit-toc-right');
		layout.getBoundingClientRect = () => ({
			left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0,
			toJSON: () => ({}),
		}) as DOMRect;

		splitter!.dispatchEvent(pointerEvent(dom, 'pointerdown', { clientX: 760, button: 0 }));
		// 指针往左移（clientX 变小）时，右侧的目录栏应当变宽
		splitter!.dispatchEvent(pointerEvent(dom, 'pointermove', { clientX: 620 }));
		assert.strictEqual(toc.navWidth, 380, '右侧时指针左移应当变宽；照搬左侧算式会得到 620');
	});

	it('目录栏在左侧时沿用原算式（宽度 = 指针 − 左边缘）', () => {
		const { dom, nav, splitter, toc } = setup(3, true, { withSplitter: true });
		nav.parentElement!.getBoundingClientRect = () => ({
			left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0,
			toJSON: () => ({}),
		}) as DOMRect;

		splitter!.dispatchEvent(pointerEvent(dom, 'pointerdown', { clientX: 240, button: 0 }));
		splitter!.dispatchEvent(pointerEvent(dom, 'pointermove', { clientX: 380 }));
		assert.strictEqual(toc.navWidth, 380);
	});

	it('宽度有下限，不会被拖到看不见', () => {
		const { dom, splitter, toc } = setup(3, true, { withSplitter: true });
		splitter!.dispatchEvent(pointerEvent(dom, 'pointerdown', { clientX: 240, button: 0 }));
		splitter!.dispatchEvent(pointerEvent(dom, 'pointermove', { clientX: -50 }));
		assert.strictEqual(toc.navWidth, 120);
	});

	it('双击分隔条复位默认宽度', () => {
		const { dom, nav, splitter } = setup(3, true, { withSplitter: true });
		splitter!.dispatchEvent(pointerEvent(dom, 'pointerdown', { clientX: 240, button: 0 }));
		splitter!.dispatchEvent(pointerEvent(dom, 'pointermove', { clientX: 420 }));
		splitter!.dispatchEvent(pointerEvent(dom, 'pointerup', {}));
		assert.strictEqual(nav.style.width, '420px');

		splitter!.dispatchEvent(pointerEvent(dom, 'dblclick'));
		assert.strictEqual(nav.style.width, '240px');
	});
});
