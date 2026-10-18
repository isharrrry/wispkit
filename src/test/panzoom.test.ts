import * as assert from 'assert';
import { dispatchMouse, dispatchWheel, installDom, loadMediaModule, parseScale, parseTranslate } from './helpers/dom';

const { createPanZoom } = loadMediaModule('media/shared/panzoom.js');

const DOC = `<!DOCTYPE html><html><body>
	<div id="viewport"><img id="image" src="x.png"></div>
</body></html>`;

function setup(options: { wheelZoom?: boolean; dragButton?: string; imageWidth?: number; imageHeight?: number; top?: number } = {}) {
	const dom = installDom(DOC);
	const viewport: any = dom.window.document.getElementById('viewport')!;
	const image: any = dom.window.document.getElementById('image')!;

	const width = options.imageWidth ?? 1600;
	const height = options.imageHeight ?? 1200;
	const top = options.top ?? 0;

	Object.defineProperty(viewport, 'clientWidth', { value: 800 });
	Object.defineProperty(viewport, 'clientHeight', { value: 600 });
	viewport.getBoundingClientRect = () => ({
		left: 0, top, right: 800, bottom: top + 600, width: 800, height: 600, x: 0, y: top, toJSON: () => ({}),
	});
	Object.defineProperty(image, 'naturalWidth', { value: width });
	Object.defineProperty(image, 'naturalHeight', { value: height });

	const panZoom = createPanZoom(viewport, image, {
		wheelStep: 1.1,
		dragButton: options.dragButton ?? 'right',
		wheelZoom: () => options.wheelZoom !== false,
	});
	return { dom, viewport, image, panZoom };
}

describe('media/shared/panzoom', () => {
	it('fit：1600×1200 的图放进 800×600 的视图 → 0.5', () => {
		const { image, panZoom } = setup();
		panZoom.fit();
		assert.strictEqual(parseScale(image), 0.5);
		assert.deepStrictEqual(parseTranslate(image), { x: 0, y: 0 });
	});

	it('小图不放大（fit 上限 1）', () => {
		const { image, panZoom } = setup({ imageWidth: 100, imageHeight: 100 });
		panZoom.fit();
		assert.strictEqual(parseScale(image), 1);
	});

	it('R4：不按任何修饰键，滚轮向上即放大', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchWheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
		assert.ok(Math.abs(parseScale(image) - 0.55) < 1e-9, `期望 0.55，实际 ${parseScale(image)}`);
	});

	it('滚轮向下缩小', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchWheel(viewport, { deltaY: 100, clientX: 400, clientY: 300 });
		assert.ok(parseScale(image) < 0.5);
	});

	it('以光标为锚点：在视图正中心缩放不产生平移', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchWheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
		const { x, y } = parseTranslate(image);
		assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9, `中心缩放不应平移，实际 ${x},${y}`);
	});

	it('以光标为锚点：偏离中心的缩放会带上平移', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchWheel(viewport, { deltaY: -100, clientX: 700, clientY: 300 });
		assert.notDeepStrictEqual(parseTranslate(image), { x: 0, y: 0 });
	});

	it('wheelZoom=false 时滚轮不缩放（退回需按 Ctrl 的行为）', () => {
		const { viewport, image, panZoom } = setup({ wheelZoom: false });
		panZoom.fit();
		dispatchWheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
		assert.strictEqual(parseScale(image), 0.5);
	});

	it('R4：按住右键拖动平移', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchMouse(viewport, 'pointerdown', { button: 2, clientX: 100, clientY: 100, pointerId: 7 });
		dispatchMouse(viewport, 'pointermove', { clientX: 160, clientY: 130, pointerId: 7 });
		assert.deepStrictEqual(parseTranslate(image), { x: 60, y: 30 });
	});

	it('松开后不再跟随移动', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchMouse(viewport, 'pointerdown', { button: 2, clientX: 100, clientY: 100, pointerId: 7 });
		dispatchMouse(viewport, 'pointerup', { clientX: 100, clientY: 100, pointerId: 7 });
		dispatchMouse(viewport, 'pointermove', { clientX: 300, clientY: 300, pointerId: 7 });
		assert.deepStrictEqual(parseTranslate(image), { x: 0, y: 0 });
	});

	it('左键不触发平移（默认 dragButton=right）', () => {
		const { viewport, image, panZoom } = setup();
		panZoom.fit();
		dispatchMouse(viewport, 'pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 7 });
		dispatchMouse(viewport, 'pointermove', { clientX: 200, clientY: 200, pointerId: 7 });
		assert.deepStrictEqual(parseTranslate(image), { x: 0, y: 0 });
	});

	it('dragButton=middle 时中键平移', () => {
		const { viewport, image, panZoom } = setup({ dragButton: 'middle' });
		panZoom.fit();
		dispatchMouse(viewport, 'pointerdown', { button: 1, clientX: 10, clientY: 10, pointerId: 3 });
		dispatchMouse(viewport, 'pointermove', { clientX: 40, clientY: 50, pointerId: 3 });
		assert.deepStrictEqual(parseTranslate(image), { x: 30, y: 40 });
	});

	it('缩放上限 40 倍', () => {
		const { viewport, image, panZoom } = setup({ imageWidth: 10, imageHeight: 10 });
		panZoom.fit();
		for (let i = 0; i < 200; i++) {
			dispatchWheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
		}
		assert.strictEqual(parseScale(image), 40);
	});

	it('放大 3 倍以上切 pixelated', () => {
		const { viewport, image, panZoom } = setup({ imageWidth: 10, imageHeight: 10 });
		panZoom.fit();
		for (let i = 0; i < 40; i++) {
			dispatchWheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
		}
		assert.ok(parseScale(image) >= 3);
		assert.strictEqual(image.style.imageRendering, 'pixelated');
	});
});
