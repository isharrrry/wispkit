/**
 * 放大预览（模态框）：把图片 / mermaid / drawio 图放大到基本占满主窗口，
 * 支持滚轮缩放（光标为锚点）与按住右键平移 —— 复用图片视图的同一套手势核心。
 */

import { createPanZoom } from './panzoom.js';

export function createLightbox(options) {
	const root = options.root;
	const viewport = options.viewport;
	const stage = options.stage;
	const titleElement = options.titleElement ?? null;
	const zoomElement = options.zoomElement ?? null;
	const isWheelZoomEnabled = () => options.wheelZoom?.() !== false;

	let panzoom = null;
	let observer = null;
	let open = false;

	const updateZoomLabel = () => {
		if (!zoomElement || !panzoom) {
			return;
		}
		zoomElement.textContent = `${Math.round(panzoom.scale * 100)}%`;
	};

	const observeStage = () => {
		observer?.disconnect();
		observer = null;
		if (typeof MutationObserver !== 'function') {
			return;
		}
		observer = new MutationObserver(updateZoomLabel);
		observer.observe(stage, { attributes: true, attributeFilter: ['style'] });
	};

	const close = () => {
		if (!open) {
			return false;
		}
		open = false;
		observer?.disconnect();
		observer = null;
		panzoom?.dispose();
		panzoom = null;
		stage.removeAttribute('style');
		stage.replaceChildren();
		root.hidden = true;
		document.body.classList.remove('wispkit-lightbox-open');
		return true;
	};

	const measure = element => {
		const viewBox = element.viewBox?.baseVal;
		if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
			return { width: viewBox.width, height: viewBox.height };
		}
		const naturalWidth = element.naturalWidth;
		const naturalHeight = element.naturalHeight;
		if (naturalWidth > 0 && naturalHeight > 0) {
			return { width: naturalWidth, height: naturalHeight };
		}
		const rect = element.getBoundingClientRect?.();
		if (rect && rect.width > 0 && rect.height > 0) {
			return { width: rect.width, height: rect.height };
		}
		const attrWidth = Number.parseFloat(element.getAttribute?.('width') ?? '');
		const attrHeight = Number.parseFloat(element.getAttribute?.('height') ?? '');
		if (Number.isFinite(attrWidth) && Number.isFinite(attrHeight) && attrWidth > 0 && attrHeight > 0) {
			return { width: attrWidth, height: attrHeight };
		}
		return { width: 0, height: 0 };
	};

	const describe = (kind, element) => {
		if (kind === 'image') {
			const alt = element.getAttribute?.('alt');
			if (alt && alt.trim()) {
				return alt.trim();
			}
			const src = element.getAttribute?.('src') ?? '';
			const name = src.split('/').pop()?.split('?')[0];
			return name && !name.startsWith('data:') ? decodeURIComponent(name) : '图片';
		}
		return element.getAttribute?.('aria-label') || '图表';
	};

	/**
	 * mermaid / drawio 把配色写成 `<style>#mermaid-abc .node rect{fill:...}</style>`
	 * 这种 **id 作用域**规则。克隆时若直接抹掉 id，规则全部失配，图形会回落成
	 * 纯黑填充（实测：正文里节点是 rgb(243,243,243)，放大后变 rgb(0,0,0)）。
	 * 所以给克隆换一个新 id，并把内联样式里的作用域同步改掉。
	 */
	const rescopeClone = (clone, sourceId) => {
		if (!sourceId) {
			return;
		}
		const cloneId = `${sourceId}-wispkit-lightbox`;
		clone.setAttribute('id', cloneId);
		clone.querySelectorAll('style').forEach(style => {
			const css = style.textContent;
			if (typeof css === 'string' && css.includes(`#${sourceId}`)) {
				style.textContent = css.split(`#${sourceId}`).join(`#${cloneId}`);
			}
		});
	};

	const buildContent = (kind, element) => {
		const clone = element.cloneNode(true);
		if (kind === 'image') {
			clone.removeAttribute('id');
			clone.classList.add('wispkit-lightbox-image');
			clone.removeAttribute('width');
			clone.removeAttribute('height');
			return clone;
		}
		rescopeClone(clone, element.getAttribute('id'));
		clone.classList.add('wispkit-lightbox-svg');
		// mermaid 用行内 max-width 限制宽度；放大时由容器决定尺寸
		clone.removeAttribute('style');
		clone.setAttribute('width', '100%');
		clone.setAttribute('height', '100%');
		return clone;
	};

	const openElement = (kind, element) => {
		if (!element) {
			return false;
		}
		const size = measure(element);
		if (!size.width || !size.height) {
			return false;
		}

		close();
		stage.style.width = `${size.width}px`;
		stage.style.height = `${size.height}px`;
		stage.replaceChildren(buildContent(kind, element));
		if (titleElement) {
			titleElement.textContent = describe(kind, element);
		}

		root.hidden = false;
		document.body.classList.add('wispkit-lightbox-open');
		open = true;

		panzoom = createPanZoom(viewport, stage, {
			wheelStep: options.wheelStep ?? 1.1,
			dragButton: options.dragButton ?? 'right',
			wheelZoom: isWheelZoomEnabled,
		});
		panzoom.fit();
		observeStage();
		updateZoomLabel();
		return true;
	};

	const onKeyDown = event => {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	};
	const onViewportClick = event => {
		if (open && event.target === viewport) {
			close();
		}
	};

	document.addEventListener('keydown', onKeyDown);
	viewport.addEventListener('click', onViewportClick);
	options.closeButton?.addEventListener('click', close);
	options.resetButton?.addEventListener('click', () => {
		panzoom?.fit();
	});

	return {
		openImage: element => openElement('image', element),
		openSvg: element => openElement('svg', element),
		close,
		get isOpen() {
			return open;
		},
		get scale() {
			return panzoom?.scale ?? 1;
		},
		dispose() {
			close();
			document.removeEventListener('keydown', onKeyDown);
			viewport.removeEventListener('click', onViewportClick);
		},
	};
}
