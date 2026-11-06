import * as assert from 'assert';
import { installDom, loadMediaModule } from './helpers/dom';

const { createContextMenu } = loadMediaModule('media/shared/contextmenu.js');

const DOC = `<!DOCTYPE html><html><body><div id="content"><p>hi</p></div></body></html>`;

describe('media/shared/contextmenu', () => {
	function setup() {
		const dom = installDom(DOC);
		const doc = dom.window.document;
		return { dom, doc, menu: createContextMenu({ document: doc }) };
	}

	function pointerDown(doc: Document, target: Element, init: Record<string, unknown> = {}) {
		target.dispatchEvent(new (doc.defaultView as any).MouseEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
	}

	/** jsdom 不做布局，getBoundingClientRect 恒为 0；这里给菜单一个假矩形验证坐标兜底。 */
	function stubMenuRect(doc: Document, rect: { left: number; top: number; right: number; bottom: number }) {
		const element = doc.querySelector('.wispkit-menu') as HTMLElement;
		element.getBoundingClientRect = () => ({
			...rect, width: rect.right - rect.left, height: rect.bottom - rect.top,
			x: rect.left, y: rect.top, toJSON: () => rect,
		}) as DOMRect;
		return element;
	}

	function pressKey(doc: Document, key: string) {
		doc.dispatchEvent(new (doc.defaultView as any).KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	}

	it('在给定坐标弹出菜单，并记录菜单项文字', () => {
		const { doc, menu } = setup();
		assert.strictEqual(menu.open([{ label: '另存为…', run: () => undefined }], 10, 20), true);
		assert.strictEqual(menu.isOpen, true);

		const element = doc.querySelector('.wispkit-menu') as HTMLElement;
		assert.ok(element, '应当生成 .wispkit-menu');
		assert.strictEqual(element.style.left, '10px');
		assert.strictEqual(element.style.top, '20px');
		assert.deepStrictEqual(menu.labels, ['另存为…']);
	});

	it('点击菜单项执行回调并关闭菜单', () => {
		const { doc, menu } = setup();
		let clicked = 0;
		menu.open([{ label: '复制路径', run: () => { clicked++; } }], 0, 0);

		assert.strictEqual(menu.click('复制路径'), true);
		assert.strictEqual(clicked, 1);
		assert.strictEqual(menu.isOpen, false);
		assert.strictEqual(doc.querySelector('.wispkit-menu'), null);
	});

	it('点击不存在的项不执行任何回调', () => {
		const { menu } = setup();
		let clicked = 0;
		menu.open([{ label: 'A', run: () => { clicked++; } }], 0, 0);
		assert.strictEqual(menu.click('B'), false);
		assert.strictEqual(clicked, 0);
		assert.strictEqual(menu.isOpen, true);
	});

	it('Escape 关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		pressKey(doc, 'Escape');
		assert.strictEqual(menu.isOpen, false);
	});

	it('在菜单外按下指针会关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		pointerDown(doc, doc.getElementById('content')!);
		assert.strictEqual(menu.isOpen, false);
	});

	it('在菜单内按下指针不会关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		pointerDown(doc, doc.querySelector('.wispkit-menu-item')!);
		assert.strictEqual(menu.isOpen, true);
	});

	it('菜单内部滚动（滚轮 / 拖滚动条）不会关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		const element = doc.querySelector('.wispkit-menu') as HTMLElement;
		// scroll 不冒泡，document 上的捕获监听器仍会收到 —— 但目标在菜单内，必须保持打开
		element.dispatchEvent(new (doc.defaultView as any).Event('scroll'));
		assert.strictEqual(menu.isOpen, true);
		assert.ok(doc.querySelector('.wispkit-menu'));
	});

	it('菜单外的滚动仍然关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		doc.getElementById('content')!.dispatchEvent(new (doc.defaultView as any).Event('scroll'));
		assert.strictEqual(menu.isOpen, false);
	});

	it('document 滚动关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		doc.dispatchEvent(new (doc.defaultView as any).Event('scroll'));
		assert.strictEqual(menu.isOpen, false);
	});

	it('滚动条按下事件的 target 不在菜单内时，坐标在菜单矩形内也不关闭', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		stubMenuRect(doc, { left: 100, top: 100, right: 300, bottom: 300 });
		// 原生滚动条不是 DOM 节点，按下时 target 可能落到 body / document
		pointerDown(doc, doc.body, { clientX: 150, clientY: 150 });
		assert.strictEqual(menu.isOpen, true);
	});

	it('菜单矩形外的按下仍然关闭菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		stubMenuRect(doc, { left: 100, top: 100, right: 300, bottom: 300 });
		pointerDown(doc, doc.body, { clientX: 500, clientY: 500 });
		assert.strictEqual(menu.isOpen, false);
	});

	it('坐标超出视口时被夹回可视区', () => {
		const { dom, doc, menu } = setup();
		const maxX = (doc.documentElement.clientWidth || dom.window.innerWidth) - 4;
		menu.open([{ label: 'A', run: () => undefined }], 99999, 99999);
		const element = doc.querySelector('.wispkit-menu') as HTMLElement;
		assert.strictEqual(element.style.left, `${maxX}px`);
	});

	it('空列表不弹菜单', () => {
		const { doc, menu } = setup();
		assert.strictEqual(menu.open([], 0, 0), false);
		assert.strictEqual(menu.isOpen, false);
		assert.strictEqual(doc.querySelector('.wispkit-menu'), null);
	});

	it('菜单项可带图标（sprite 引用），labels 仍只取文字', () => {
		const { doc, menu } = setup();
		menu.open([{ label: '重命名', icon: 'rename', run: () => undefined }], 0, 0);
		assert.deepStrictEqual(menu.labels, ['重命名']);
		assert.deepStrictEqual(menu.icons, ['#wispkit-icon-rename']);
		const use = doc.querySelector('.wispkit-menu-item use') as Element;
		assert.ok(use, '应当生成 <use> 引用 sprite');
		assert.strictEqual(use.getAttribute('href'), '#wispkit-icon-rename');
	});

	it('分隔线只渲染成分隔元素，不计入菜单项', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }, { separator: true }, { label: 'B', run: () => undefined }], 0, 0);
		assert.deepStrictEqual(menu.labels, ['A', 'B']);
		assert.strictEqual(doc.querySelectorAll('.wispkit-menu-separator').length, 1);
	});

	it('重复 open 只保留一个菜单', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		menu.open([{ label: 'B', run: () => undefined }], 0, 0);
		assert.strictEqual(doc.querySelectorAll('.wispkit-menu').length, 1);
		assert.deepStrictEqual(menu.labels, ['B']);
	});

	it('禁用项不可点击', () => {
		const { doc, menu } = setup();
		let clicked = 0;
		menu.open([{ label: 'A', run: () => { clicked++; }, disabled: true }], 0, 0);
		const button = doc.querySelector('.wispkit-menu-item') as HTMLButtonElement;
		assert.strictEqual(button.disabled, true);
		button.click();
		assert.strictEqual(clicked, 0);
	});

	it('dispose 后不再响应 Escape', () => {
		const { doc, menu } = setup();
		menu.open([{ label: 'A', run: () => undefined }], 0, 0);
		menu.dispose();
		assert.strictEqual(menu.isOpen, false);
		pressKey(doc, 'Escape');
		assert.strictEqual(menu.isOpen, false);
	});
});
