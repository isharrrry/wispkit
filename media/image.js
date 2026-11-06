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
const format = (document.body?.dataset?.format || '').toLowerCase();
const isVector = format === 'svg';

const viewport = document.getElementById('wispkit-image-viewport');
const image = document.getElementById('wispkit-image');
const hint = document.getElementById('wispkit-image-hint');
const errorPanel = document.getElementById('wispkit-image-error');
const errorTitle = document.getElementById('wispkit-image-error-title');
const errorDetail = document.getElementById('wispkit-image-error-detail');

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const post = type => vscode?.postMessage({ type });

/** 无解码器格式的说明。代码里没有大依赖，所以只能把用户交给系统应用。 */
const DECODE_HINTS = {
	heic: '当前 VS Code 的 Chromium 内核不带 HEIF/HEIC 解码器。引入 libheif 解码器需要数 MB 的额外依赖，本扩展刻意没有打包。',
	heif: '当前 VS Code 的 Chromium 内核不带 HEIF/HEIC 解码器。引入 libheif 解码器需要数 MB 的额外依赖，本扩展刻意没有打包。',
	tif: 'Chromium 内核不能直接解码 TIFF。可以先用系统默认应用打开，或转成 PNG / JPEG 后再浏览。',
	tiff: 'Chromium 内核不能直接解码 TIFF。可以先用系统默认应用打开，或转成 PNG / JPEG 后再浏览。',
	jxl: 'Chromium 已移除 JPEG XL 解码支持。可以先用系统默认应用打开，或转成 PNG / JPEG 后再浏览。',
};

// SVG 用 box 缩放：改布局尺寸让浏览器按矢量重画；位图仍用 transform，放大后能切 pixelated。
let vectorWidth = 0;
let vectorHeight = 0;

function vectorSize() {
	if (vectorWidth > 0 && vectorHeight > 0) {
		return { width: vectorWidth, height: vectorHeight };
	}
	return {
		width: image.naturalWidth || image.clientWidth || 300,
		height: image.naturalHeight || image.clientHeight || 150,
	};
}

const panZoom = createPanZoom(viewport, image, {
	wheelStep: config.wheelStep ?? 1.1,
	dragButton: config.dragButton ?? 'right',
	// R4：默认滚轮即缩放，不需要按 Ctrl（配置可关）
	wheelZoom: () => config.wheelZoom !== false,
	scaleMode: isVector ? 'box' : 'transform',
	size: isVector ? vectorSize : undefined,
});

const buttonName = { left: '左键', middle: '中键', right: '右键' }[config.dragButton ?? 'right'];

function updateHint() {
	const kind = isVector ? '矢量图 · ' : '';
	hint.textContent = `${kind}${Math.round(panZoom.scale * 100)}% · 滚轮缩放 · ${buttonName}拖动平移 · 双击复位`;
}

function showError() {
	viewport.classList.remove('loading');
	hint.textContent = '图片加载失败';
	if (errorTitle) {
		errorTitle.textContent = format ? `${format.toUpperCase()} 图片无法显示` : '图片无法显示';
	}
	if (errorDetail) {
		errorDetail.textContent = DECODE_HINTS[format]
			?? '图片解码失败：文件可能已损坏，或当前内核不支持该格式。可以交给系统默认应用打开。';
	}
	if (errorPanel) {
		errorPanel.hidden = false;
	}
}

function onLoad() {
	if (isVector) {
		const rect = image.getBoundingClientRect();
		vectorWidth = Math.round(rect.width) || image.naturalWidth || 300;
		vectorHeight = Math.round(rect.height) || image.naturalHeight || 150;
	}
	panZoom.fit();
	updateHint();
	viewport.classList.remove('loading');
}

/**
 * 图片可能在脚本执行前就已经加载 / 失败（本地小图、缓存命中、HEIC 这种内核直接拒绝的格式）。
 * `error` 事件只发一次，晚绑监听就再也收不到 —— 所以先看 complete，再决定绑不绑事件。
 * `decode()` 能区分「没有固有尺寸但照样能画」的 SVG 与真正失败的文件。
 */
function settleInitialState() {
	if (!image.complete) {
		return false;
	}
	if (typeof image.decode === 'function') {
		image.decode().then(onLoad).catch(showError);
		return true;
	}
	if (image.naturalWidth > 0) {
		onLoad();
	} else {
		showError();
	}
	return true;
}

if (!settleInitialState()) {
	image.addEventListener('load', onLoad, { once: true });
	image.addEventListener('error', showError, { once: true });
}

viewport.addEventListener('wheel', () => {
	updateHint();
}, { passive: true });

window.addEventListener('resize', () => {
	panZoom.fit();
	updateHint();
});

document.getElementById('wispkit-image-open-external')?.addEventListener('click', () => {
	post('wispkit.media.openExternal');
});

document.getElementById('wispkit-image-copy-path')?.addEventListener('click', () => {
	post('wispkit.media.copyPath');
});

Object.defineProperty(window, '__wispkitSelftest', {
	value: {
		scale: () => panZoom.scale,
		fit: () => panZoom.fit(),
		hasImage: () => Boolean(image.naturalWidth),
		format: () => format,
		isVector: () => isVector,
		errorVisible: () => Boolean(errorPanel && !errorPanel.hidden),
		showError,
	},
});
