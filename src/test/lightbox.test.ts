import * as assert from 'assert';
import { installDom, loadMediaModule } from './helpers/dom';

const { createLightbox } = loadMediaModule('media/shared/lightbox.js');

const DOC = `<!DOCTYPE html><html><body>
	<div id="wispkit-lightbox" hidden>
		<div class="wispkit-lightbox-bar">
			<span id="wispkit-lightbox-title"></span>
			<span id="wispkit-lightbox-zoom"></span>
			<button id="wispkit-lightbox-reset"></button>
			<button id="wispkit-lightbox-close"></button>
		</div>
		<div id="wispkit-lightbox-body"><div id="wispkit-lightbox-stage"></div></div>
	</div>
</body></html>`;

function setup() {
	const dom = installDom(DOC);
	const doc = dom.window.document;
	const lightbox = createLightbox({
		root: doc.getElementById('wispkit-lightbox'),
		viewport: doc.getElementById('wispkit-lightbox-body'),
		stage: doc.getElementById('wispkit-lightbox-stage'),
		titleElement: doc.getElementById('wispkit-lightbox-title'),
		zoomElement: doc.getElementById('wispkit-lightbox-zoom'),
		closeButton: doc.getElementById('wispkit-lightbox-close'),
		resetButton: doc.getElementById('wispkit-lightbox-reset'),
	});
	return {
		dom,
		doc,
		lightbox,
		root: doc.getElementById('wispkit-lightbox')!,
		viewport: doc.getElementById('wispkit-lightbox-body')!,
		stage: doc.getElementById('wispkit-lightbox-stage')!,
		title: doc.getElementById('wispkit-lightbox-title')!,
		zoom: doc.getElementById('wispkit-lightbox-zoom')!,
	};
}

function makeImage(doc: Document, width = 1600, height = 1200, alt?: string) {
	const img = doc.createElement('img');
	if (alt) {
		img.setAttribute('alt', alt);
	}
	Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
	Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
	return img;
}

function makeSvg(doc: Document, width = 200, height = 100) {
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', String(width));
	svg.setAttribute('height', String(height));
	svg.setAttribute('style', 'max-width:300px');
	return svg;
}

describe('media/shared/lightbox', () => {
	it('打开图片：占满容器并以原始像素尺寸建舞台', () => {
		const { doc, lightbox, root, stage, title } = setup();
		assert.strictEqual(lightbox.openImage(makeImage(doc, 1600, 1200, '示意图')), true);

		assert.strictEqual(root.hidden, false);
		assert.strictEqual(lightbox.isOpen, true);
		assert.strictEqual(stage.style.width, '1600px');
		assert.strictEqual(stage.style.height, '1200px');
		assert.strictEqual(stage.querySelectorAll('img').length, 1);
		assert.strictEqual(title.textContent, '示意图');
	});

	it('没有 alt 时用文件名当标题', () => {
		const { doc, lightbox, title } = setup();
		const img = makeImage(doc, 10, 10);
		img.setAttribute('src', 'vscode-webview://x/assets/pic.png?t=1');
		lightbox.openImage(img);
		assert.strictEqual(title.textContent, 'pic.png');
	});

	it('打开 svg：按 width/height 属性定尺寸，并清掉限制放大的行内样式', () => {
		const { doc, lightbox, stage } = setup();
		assert.strictEqual(lightbox.openSvg(makeSvg(doc, 200, 100)), true);

		assert.strictEqual(stage.style.width, '200px');
		const clone = stage.querySelector('svg')!;
		assert.strictEqual(clone.getAttribute('style'), null, 'mermaid 的 max-width 行内样式必须清掉');
		assert.strictEqual(clone.getAttribute('width'), '100%');
		assert.strictEqual(clone.getAttribute('height'), '100%');
	});

	it('拿不到尺寸就不打开（避免出现空白模态框）', () => {
		const { doc, lightbox, root } = setup();
		assert.strictEqual(lightbox.openImage(doc.createElement('img')), false);
		assert.strictEqual(root.hidden, true);
		assert.strictEqual(lightbox.isOpen, false);
	});

	it('再次打开会替换上一次的内容', () => {
		const { doc, lightbox, stage } = setup();
		lightbox.openImage(makeImage(doc, 100, 100));
		lightbox.openImage(makeImage(doc, 300, 200));
		assert.strictEqual(stage.querySelectorAll('img').length, 1);
		assert.strictEqual(stage.style.width, '300px');
	});

	it('Esc 关闭并清空舞台', () => {
		const { doc, dom, lightbox, root, stage } = setup();
		lightbox.openImage(makeImage(doc, 100, 100));
		doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));

		assert.strictEqual(root.hidden, true);
		assert.strictEqual(lightbox.isOpen, false);
		assert.strictEqual(stage.children.length, 0);
		assert.strictEqual(stage.getAttribute('style'), null);
	});

	it('点关闭按钮关闭', () => {
		const { doc, dom, lightbox, root } = setup();
		lightbox.openImage(makeImage(doc, 100, 100));
		dom.window.document.getElementById('wispkit-lightbox-close')!
			.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		assert.strictEqual(root.hidden, true);
	});

	it('点击空白背景关闭，点击图本身不关闭', () => {
		const { doc, dom, lightbox, root, viewport, stage } = setup();
		lightbox.openImage(makeImage(doc, 100, 100));

		stage.querySelector('img')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		assert.strictEqual(root.hidden, false, '点图不应关闭');

		viewport.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		assert.strictEqual(root.hidden, true, '点背景应关闭');
	});

	it('滚轮不按修饰键即可缩放', () => {
		const { doc, dom, lightbox, viewport } = setup();
		lightbox.openImage(makeImage(doc, 1000, 1000));
		assert.strictEqual(lightbox.scale, 1);

		viewport.dispatchEvent(new dom.window.WheelEvent('wheel', {
			deltaY: -100,
			clientX: 100,
			clientY: 100,
			bubbles: true,
			cancelable: true,
		}));
		assert.ok(lightbox.scale > 1, `滚轮向上应当放大，实际 ${lightbox.scale}`);
	});

	it('按住右键拖动平移', () => {
		const { doc, dom, lightbox, viewport, stage } = setup();
		lightbox.openImage(makeImage(doc, 1000, 1000));

		viewport.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
			button: 2, clientX: 100, clientY: 100, bubbles: true, cancelable: true,
		}));
		viewport.dispatchEvent(new dom.window.MouseEvent('pointermove', {
			button: 2, clientX: 160, clientY: 130, bubbles: true, cancelable: true,
		}));

		assert.ok(/translate\(60px,\s*30px\)/.test(stage.style.transform), `实际 ${stage.style.transform}`);
	});

	it('缩放百分比会跟着更新', async () => {
		const { doc, dom, lightbox, viewport, zoom } = setup();
		lightbox.openImage(makeImage(doc, 1000, 1000));

		viewport.dispatchEvent(new dom.window.WheelEvent('wheel', {
			deltaY: -100, clientX: 50, clientY: 50, bubbles: true, cancelable: true,
		}));
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.ok(/%$/.test(zoom.textContent ?? ''), `实际 "${zoom.textContent}"`);
	});

	it('关闭后再触发键盘事件不会出错', () => {
		const { doc, dom, lightbox } = setup();
		lightbox.close();
		assert.doesNotThrow(() => {
			doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
		});
	});
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 仿 mermaid：配色写在 `<style>#<id> .node rect{...}</style>` 这种 id 作用域规则里。 */
function makeScopedSvg(doc: Document, id?: string) {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	if (id) {
		svg.setAttribute('id', id);
	}
	svg.setAttribute('width', '200');
	svg.setAttribute('height', '100');
	svg.setAttribute('viewBox', '0 0 200 100');

	const style = doc.createElementNS(SVG_NS, 'style');
	style.textContent = `#${id ?? 'unscoped'} .node rect { fill: #f3f3f3; }`;
	svg.appendChild(style);

	const group = doc.createElementNS(SVG_NS, 'g');
	group.setAttribute('class', 'node');
	group.appendChild(doc.createElementNS(SVG_NS, 'rect'));
	svg.appendChild(group);

	return svg;
}

describe('lightbox: #id 作用域的图形样式', () => {
	it('克隆时换新 id 并同步改写内联 <style>，否则规则失配、图形掉色变黑', () => {
		const { doc, lightbox, stage } = setup();
		const svg = makeScopedSvg(doc, 'mermaid-abc');
		assert.ok(lightbox.openSvg(svg));

		const cloned = stage.querySelector('svg')!;
		assert.strictEqual(cloned.getAttribute('id'), 'mermaid-abc-wispkit-lightbox');

		const css = cloned.querySelector('style')!.textContent ?? '';
		assert.ok(css.includes('#mermaid-abc-wispkit-lightbox .node rect'), `实际 ${css}`);
		assert.ok(!css.includes('#mermaid-abc '), '旧作用域必须被替换掉，否则 mermaid 节点会回落成纯黑填充');

		assert.strictEqual(svg.getAttribute('id'), 'mermaid-abc', '原始 svg 不能被改动');
	});

	it('没有 id 的 svg 也能放大，不会被强行加上 id', () => {
		const { doc, lightbox, stage } = setup();
		assert.ok(lightbox.openSvg(makeScopedSvg(doc)));
		assert.strictEqual(stage.querySelector('svg')!.getAttribute('id'), null);
	});
});

/** 复现用户报的那张图：viewBox 3342×1350，比容器大得多。 */
function makeWideSvg(doc: Document, id = 'mermaid-wide') {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('id', id);
	svg.setAttribute('width', '100%');
	svg.setAttribute('style', 'max-width: 3342.09px;');
	svg.setAttribute('viewBox', '2 2 3342.09 1350.5');
	return svg;
}

describe('lightbox：矢量图按布局尺寸缩放（放大要清晰，不能被压扁）', () => {
	it('svg 走 box 缩放：宽高按比例算出，stage 上没有 scale()', () => {
		const { doc, lightbox, viewport, stage } = setup();
		Object.defineProperty(viewport, 'clientWidth', { value: 400 });
		Object.defineProperty(viewport, 'clientHeight', { value: 400 });

		assert.ok(lightbox.openSvg(makeWideSvg(doc)));

		// 3342×1350 放进 400×400：fit = min(400/3342, 400/1350, 1) = 0.11969…
		const expected = 400 / 3342.09;
		assert.ok(Math.abs(parseFloat(stage.style.width) - 3342.09 * expected) < 0.5, `实际 width=${stage.style.width}`);
		assert.ok(Math.abs(parseFloat(stage.style.height) - 1350.5 * expected) < 0.5, `实际 height=${stage.style.height}`);
		assert.ok(!/scale\(/.test(stage.style.transform ?? ''), `矢量不该用 scale()，实际 "${stage.style.transform}"`);

		// 原始宽高比必须保住（被 flex 压扁过一次，就是"模糊 + 串色"的根因）
		const ratioIn = 3342.09 / 1350.5;
		const ratioOut = parseFloat(stage.style.width) / parseFloat(stage.style.height);
		assert.ok(Math.abs(ratioIn - ratioOut) < 0.01, `宽高比必须一致，原 ${ratioIn} 实际 ${ratioOut}`);
	});

	it('图片仍走 transform 缩放（位图，放很大时可切 pixelated）', () => {
		const { doc, lightbox, viewport, stage } = setup();
		Object.defineProperty(viewport, 'clientWidth', { value: 800 });
		Object.defineProperty(viewport, 'clientHeight', { value: 600 });

		assert.ok(lightbox.openImage(makeImage(doc, 1600, 1200)));
		assert.ok(/scale\(0\.5\)/.test(stage.style.transform), `实际 "${stage.style.transform}"`);
	});
});
