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

const BOX_DOC = `<!DOCTYPE html><html><body>
	<div id="viewport"><div id="stage"></div></div>
</body></html>`;

/** 矢量图（mermaid / drawio 的 svg）走 box 模式：缩放改布局尺寸，不写 `scale()`。 */
function setupBox(options: { boxWidth?: number; boxHeight?: number } = {}) {
	const dom = installDom(BOX_DOC);
	const viewport: any = dom.window.document.getElementById('viewport')!;
	const stage: any = dom.window.document.getElementById('stage')!;

	Object.defineProperty(viewport, 'clientWidth', { value: 800 });
	Object.defineProperty(viewport, 'clientHeight', { value: 600 });
	viewport.getBoundingClientRect = () => ({
		left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
	});

	const size = { width: options.boxWidth ?? 2000, height: options.boxHeight ?? 1000 };
	const panZoom = createPanZoom(viewport, stage, {
		scaleMode: 'box',
		size: () => size,
		wheelZoom: () => true,
	});
	return { dom, viewport, stage, panZoom };
}

describe('media/shared/panzoom：矢量图的 box 缩放模式', () => {
	it('fit 后按比例改写宽高，且不出现 scale()（矢量重绘而非栅格拉伸）', () => {
		const { stage, panZoom } = setupBox();
		panZoom.fit();

		// 2000×1000 放进 800×600 → 0.4
		assert.strictEqual(stage.style.width, '800px');
		assert.strictEqual(stage.style.height, '400px');
		assert.ok(!/scale\(/.test(stage.style.transform), `box 模式不该写 scale()，实际 "${stage.style.transform}"`);
	});

	it('滚轮放大改的是布局宽高，transform 只负责平移', () => {
		const { viewport, stage, panZoom } = setupBox();
		panZoom.fit();
		dispatchWheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });

		assert.ok(Math.abs(panZoom.scale - 0.44) < 1e-9, `期望 0.44，实际 ${panZoom.scale}`);
		assert.ok(Math.abs(parseFloat(stage.style.width) - 880) < 1e-6, `实际 width=${stage.style.width}`);
		assert.ok(Math.abs(parseFloat(stage.style.height) - 440) < 1e-6, `实际 height=${stage.style.height}`);
		assert.ok(!/scale\(/.test(stage.style.transform), `实际 "${stage.style.transform}"`);
	});

	it('平移仍然只写 translate()', () => {
		const { viewport, stage, panZoom } = setupBox();
		panZoom.fit();
		dispatchMouse(viewport, 'pointerdown', { button: 2, clientX: 100, clientY: 100, pointerId: 4 });
		dispatchMouse(viewport, 'pointermove', { clientX: 140, clientY: 120, pointerId: 4 });

		assert.deepStrictEqual(parseTranslate(stage), { x: 40, y: 20 });
	});

	it('小图不放大（fit 上限 1，宽高回到原始尺寸）', () => {
		const { stage, panZoom } = setupBox({ boxWidth: 200, boxHeight: 100 });
		panZoom.fit();

		assert.strictEqual(stage.style.width, '200px');
		assert.strictEqual(stage.style.height, '100px');
	});
});
