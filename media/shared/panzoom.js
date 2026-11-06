/**
 * 缩放 / 平移手势核心。图片视图用它；斜杠方向与内置图片预览一致：
 * 缩放以光标为锚点（视图中心不跳），平移用按住指定键拖动。
 */

export function createPanZoom(viewport, target, options = {}) {
	const wheelStep = options.wheelStep ?? 1.1;
	const minScale = options.minScale ?? 0.05;
	const maxScale = options.maxScale ?? 40;
	const dragButton = options.dragButton ?? 'right';
	/**
	 * 'transform'：CSS `scale()` 缩放。位图（图片视图）用它 —— 放大到 3 倍以上还能切
	 * `image-rendering: pixelated` 看清像素格。
	 * 'box'：改 target 的 width / height 缩放。**矢量图必须用这个**：`scale()` 会把元素
	 * 先栅格化成一层位图再拉伸（配合 `will-change: transform` 更明显），于是 mermaid
	 * 的图放得越大越模糊；改布局尺寸才会让浏览器按矢量重新绘制。
	 */
	const scaleMode = options.scaleMode === 'box' ? 'box' : 'transform';
	/** 缩放所依据的原始尺寸。矢量图的 viewBox 与屏幕上的布局尺寸往往差一个数量级，
	 *  所以调用方可以显式给出，不要让这里去量 DOM（量到的可能是被压缩过的尺寸）。 */
	const sizeOf = () => options.size?.() ?? {
		width: target.naturalWidth || target.clientWidth,
		height: target.naturalHeight || target.clientHeight,
	};

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
		if (scaleMode === 'box') {
			const { width, height } = sizeOf();
			if (width > 0 && height > 0) {
				target.style.width = `${width * scale}px`;
				target.style.height = `${height * scale}px`;
			}
			// 平移仍走 transform —— 位移不会触发重绘，也不会把内容栅格化
			target.style.transform = `translate(${translateX}px, ${translateY}px)`;
		} else {
			target.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
			target.style.imageRendering = scale >= 3 ? 'pixelated' : '';
		}
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
		const { width, height } = sizeOf();
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
