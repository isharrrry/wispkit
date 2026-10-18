/**
 * 缩放 / 平移手势核心。图片视图用它；斜杠方向与内置图片预览一致：
 * 缩放以光标为锚点（视图中心不跳），平移用按住指定键拖动。
 */

export function createPanZoom(viewport, target, options = {}) {
	const wheelStep = options.wheelStep ?? 1.1;
	const minScale = options.minScale ?? 0.05;
	const maxScale = options.maxScale ?? 40;
	const dragButton = options.dragButton ?? 'right';

	const buttonIndex = dragButton === 'left' ? 0 : dragButton === 'middle' ? 1 : 2;

	let scale = 1;
	let translateX = 0;
	let translateY = 0;
	let fitScale = 1;
	let dragging = false;
	let pointerId = -1;
	let lastX = 0;
	let lastY = 0;

	const apply = () => {
		target.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
		target.style.imageRendering = scale >= 3 ? 'pixelated' : '';
		viewport.classList.toggle('has-transform', scale !== fitScale || translateX !== 0 || translateY !== 0);
	};

	const clampScale = value => Math.min(maxScale, Math.max(minScale, value));

	const zoomAt = (clientX, clientY, factor) => {
		const next = clampScale(scale * factor);
		if (next === scale) {
			return;
		}
		const rect = viewport.getBoundingClientRect();
		const anchorX = clientX - rect.left - rect.width / 2;
		const anchorY = clientY - rect.top - rect.height / 2;
		const ratio = next / scale;
		translateX = anchorX - (anchorX - translateX) * ratio;
		translateY = anchorY - (anchorY - translateY) * ratio;
		scale = next;
		apply();
	};

	const fit = () => {
		const width = target.naturalWidth || target.clientWidth;
		const height = target.naturalHeight || target.clientHeight;
		if (!width || !height || !viewport.clientWidth || !viewport.clientHeight) {
			return;
		}
		fitScale = clampScale(Math.min(viewport.clientWidth / width, viewport.clientHeight / height, 1));
		scale = fitScale;
		translateX = 0;
		translateY = 0;
		apply();
	};

	const onWheel = event => {
		if (!options.wheelZoom()) {
			return;
		}
		event.preventDefault();
		const factor = event.deltaY < 0 ? wheelStep : 1 / wheelStep;
		zoomAt(event.clientX, event.clientY, factor);
	};

	const onPointerDown = event => {
		if (event.button !== buttonIndex) {
			return;
		}
		event.preventDefault();
		dragging = true;
		pointerId = event.pointerId;
		lastX = event.clientX;
		lastY = event.clientY;
		viewport.setPointerCapture?.(event.pointerId);
		viewport.classList.add('wispkit-dragging');
	};

	const onPointerMove = event => {
		if (!dragging || event.pointerId !== pointerId) {
			return;
		}
		translateX += event.clientX - lastX;
		translateY += event.clientY - lastY;
		lastX = event.clientX;
		lastY = event.clientY;
		apply();
	};

	const endDrag = event => {
		if (!dragging || event.pointerId !== pointerId) {
			return;
		}
		dragging = false;
		viewport.releasePointerCapture?.(pointerId);
		viewport.classList.remove('wispkit-dragging');
	};

	const onDoubleClick = () => {
		if (Math.abs(scale - fitScale) < 0.001 && translateX === 0 && translateY === 0) {
			scale = 1;
			apply();
		} else {
			fit();
		}
	};

	const onContextMenu = event => {
		if (buttonIndex === 2) {
			event.preventDefault();
		}
	};

	viewport.addEventListener('wheel', onWheel, { passive: false });
	viewport.addEventListener('pointerdown', onPointerDown);
	viewport.addEventListener('pointermove', onPointerMove);
	viewport.addEventListener('pointerup', endDrag);
	viewport.addEventListener('pointercancel', endDrag);
	viewport.addEventListener('dblclick', onDoubleClick);
	viewport.addEventListener('contextmenu', onContextMenu);

	return {
		fit,
		get scale() {
			return scale;
		},
		dispose() {
			viewport.removeEventListener('wheel', onWheel);
			viewport.removeEventListener('pointerdown', onPointerDown);
			viewport.removeEventListener('pointermove', onPointerMove);
			viewport.removeEventListener('pointerup', endDrag);
			viewport.removeEventListener('pointercancel', endDrag);
			viewport.removeEventListener('dblclick', onDoubleClick);
			viewport.removeEventListener('contextmenu', onContextMenu);
		},
	};
}
