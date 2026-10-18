import { createPanZoom } from './shared/panzoom.js';

function readConfig() {
	const meta = document.getElementById('wispkit-config');
	if (!meta) {
		return {};
	}
	try {
		return JSON.parse(meta.dataset.settings || '{}');
	} catch {
		return {};
	}
}

const config = readConfig();
const viewport = document.getElementById('wispkit-image-viewport');
const image = document.getElementById('wispkit-image');
const hint = document.getElementById('wispkit-image-hint');

const panZoom = createPanZoom(viewport, image, {
	wheelStep: config.wheelStep ?? 1.1,
	dragButton: config.dragButton ?? 'right',
	// R4：默认滚轮即缩放，不需要按 Ctrl（配置可关）
	wheelZoom: () => config.wheelZoom !== false,
});

const buttonName = { left: '左键', middle: '中键', right: '右键' }[config.dragButton ?? 'right'];

function updateHint() {
	hint.textContent = `${Math.round(panZoom.scale * 100)}% · 滚轮缩放 · ${buttonName}拖动平移 · 双击复位`;
}

function onLoad() {
	panZoom.fit();
	updateHint();
	viewport.classList.remove('loading');
}

if (image.complete && image.naturalWidth > 0) {
	onLoad();
} else {
	image.addEventListener('load', onLoad, { once: true });
	image.addEventListener('error', () => {
		viewport.classList.remove('loading');
		hint.textContent = '图片加载失败';
	}, { once: true });
}

viewport.addEventListener('wheel', () => {
	updateHint();
}, { passive: true });

window.addEventListener('resize', () => {
	panZoom.fit();
	updateHint();
});

Object.defineProperty(window, '__wispkitSelftest', {
	value: {
		scale: () => panZoom.scale,
		fit: () => panZoom.fit(),
		hasImage: () => Boolean(image.naturalWidth),
	},
});
