/**
 * 页面内的右键菜单：图片 / mermaid / drawio 图共用一套。
 * 做成自绘浮层而不是请求宿主的原生菜单 —— VS Code 没有"从 webview 弹原生上下文菜单"的 API，
 * 而自绘能精确知道右键点在哪个元素上。
 */

export function createContextMenu(options = {}) {
	const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
	let menu = null;

	const close = () => {
		if (menu) {
			menu.remove();
			menu = null;
			return true;
		}
		return false;
	};

	const place = (x, y) => {
		// jsdom / 未布局时 clientWidth 是 0，退回视口宽度，否则坐标会被夹成 0
		const viewportWidth = doc.documentElement?.clientWidth || doc.defaultView?.innerWidth || 0;
		const viewportHeight = doc.documentElement?.clientHeight || doc.defaultView?.innerHeight || 0;
		const rect = menu.getBoundingClientRect();
		const left = Math.max(0, Math.min(x, viewportWidth - rect.width - 4));
		const top = Math.max(0, Math.min(y, viewportHeight - rect.height - 4));
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
	};

	const open = (items, x, y) => {
		close();
		if (!doc || !items || items.length === 0) {
			return false;
		}

		menu = doc.createElement('div');
		menu.className = 'wispkit-menu';
		menu.setAttribute('role', 'menu');

		for (const item of items) {
			if (item.separator) {
				const separator = doc.createElement('div');
				separator.className = 'wispkit-menu-separator';
				menu.appendChild(separator);
				continue;
			}
			const button = doc.createElement('button');
			button.type = 'button';
			button.className = 'wispkit-menu-item';
			button.setAttribute('role', 'menuitem');
			button.textContent = item.label;
			if (item.disabled === true) {
				button.disabled = true;
				button.classList.add('is-disabled');
			}
			button.addEventListener('click', () => {
				close();
				item.run?.();
			});
			menu.appendChild(button);
		}

		doc.body.appendChild(menu);
		// 先定位再测量：appendChild 之后才有尺寸
		place(x, y);
		return true;
	};

	const onDocumentPointerDown = event => {
		if (menu && !menu.contains(event.target)) {
			close();
		}
	};
	const onDocumentKeyDown = event => {
		if (menu && event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	};

	doc?.addEventListener('pointerdown', onDocumentPointerDown, true);
	doc?.addEventListener('keydown', onDocumentKeyDown, true);
	doc?.addEventListener('scroll', close, true);

	return {
		open,
		close,
		get isOpen() {
			return menu !== null;
		},
		get labels() {
			return menu ? Array.from(menu.querySelectorAll('.wispkit-menu-item')).map(item => item.textContent) : [];
		},
		/** 供自动化验证：按文字点菜单项 */
		click(label) {
			const target = menu
				? Array.from(menu.querySelectorAll('.wispkit-menu-item')).find(item => item.textContent === label)
				: null;
			target?.click();
			return Boolean(target);
		},
		dispose() {
			close();
			doc?.removeEventListener('pointerdown', onDocumentPointerDown, true);
			doc?.removeEventListener('keydown', onDocumentKeyDown, true);
			doc?.removeEventListener('scroll', close, true);
		},
	};
}
