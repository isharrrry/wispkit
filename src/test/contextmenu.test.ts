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

	function pointerDown(doc: Document, target: Element) {
		target.dispatchEvent(new (doc.defaultView as any).MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
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
