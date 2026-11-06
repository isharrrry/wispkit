/**
 * 页面内的右键菜单：图片 / 图表 / 子树浏览 / 对比浏览共用。
 * 做成自绘浮层而不是请求宿主的原生菜单 —— VS Code 没有"从 webview 弹原生上下文菜单"的 API，
 * 而自绘能精确知道右键点在哪个元素上。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeIcon(doc, name) {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'wispkit-menu-icon-svg');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const use = doc.createElementNS(SVG_NS, 'use');
	use.setAttribute('href', `#wispkit-icon-${name}`);
	svg.appendChild(use);
	return svg;
}

export function createContextMenu(options = {}) {
	const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
	let menu = null;
	let submenu = null;

	const closeSubmenu = () => {
		if (submenu) {
			submenu.remove();
			submenu = null;
		}
	};

	const close = () => {
		closeSubmenu();
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

	/**
	 * 把一组菜单项渲染成浮层元素。主菜单与二级菜单共用同一套渲染，
	 * 差别只在定位位置（`openSubmenu` 会额外加 `.wispkit-submenu`）。
	 */
	const renderItems = items => {
		const el = doc.createElement('div');
		el.className = 'wispkit-menu';
		el.setAttribute('role', 'menu');

		for (const item of items) {
			if (item.separator) {
				const separator = doc.createElement('div');
				separator.className = 'wispkit-menu-separator';
				el.appendChild(separator);
				continue;
			}
			const children = Array.isArray(item.children) && item.children.length > 0 ? item.children : null;
			const button = doc.createElement('button');
			button.type = 'button';
			button.className = 'wispkit-menu-item';
			button.setAttribute('role', 'menuitem');
			if (item.title) {
				button.title = String(item.title);
			}
			if (item.icon) {
				button.appendChild(makeIcon(doc, item.icon));
			}
			const label = doc.createElement('span');
			label.className = 'wispkit-menu-label';
			label.textContent = item.label;
			button.appendChild(label);
			if (item.badge) {
				const badge = doc.createElement('span');
				badge.className = 'wispkit-menu-badge';
				badge.textContent = String(item.badge);
				button.appendChild(badge);
			}
			if (children) {
				button.classList.add('has-submenu');
				button.setAttribute('aria-haspopup', 'menu');
				const arrow = doc.createElement('span');
				arrow.className = 'wispkit-menu-arrow';
				arrow.setAttribute('aria-hidden', 'true');
				arrow.textContent = '▸';
				button.appendChild(arrow);
			}
			if (item.disabled === true) {
				button.disabled = true;
				button.classList.add('is-disabled');
			}
			button.addEventListener('click', event => {
				if (children) {
					// 有子项的条目不执行自身动作，只展开二级菜单
					event.stopPropagation();
					if (button.disabled !== true) {
						openSubmenu(button, children);
					}
					return;
				}
				close();
				item.run?.();
			});
			if (children && item.disabled !== true) {
				button.addEventListener('pointerenter', () => openSubmenu(button, children));
				button.addEventListener('pointerleave', closeSubmenu);
			}
			el.appendChild(button);
		}

		return el;
	};

	/**
	 * 二级菜单：定位在主菜单右边缘，右边放不下就翻到左侧。
	 * 坐标与主菜单同样按视口算（主菜单也是拿指针的 clientX / clientY 当 left / top）。
	 */
	const openSubmenu = (button, items) => {
		closeSubmenu();
		if (!doc || !items || items.length === 0) {
			return;
		}
		submenu = renderItems(items);
		submenu.classList.add('wispkit-submenu');
		doc.body.appendChild(submenu);

		const anchor = (menu ?? button).getBoundingClientRect();
		const rect = button.getBoundingClientRect();
		const viewportWidth = doc.documentElement?.clientWidth || doc.defaultView?.innerWidth || 0;
		const viewportHeight = doc.documentElement?.clientHeight || doc.defaultView?.innerHeight || 0;
		const width = submenu.offsetWidth;
		const height = submenu.offsetHeight;

		let left = (anchor.width > 0 ? anchor.right : rect.right) - 4;
		if (width > 0 && viewportWidth > 0 && left + width > viewportWidth) {
			left = Math.max(0, (anchor.width > 0 ? anchor.left : rect.left) - width + 4);
		}
		const top = Math.max(0, Math.min(rect.top, viewportHeight - height - 4));
		submenu.style.left = `${left}px`;
		submenu.style.top = `${top}px`;
	};

	const open = (items, x, y) => {
		close();
		if (!doc || !items || items.length === 0) {
			return false;
		}

		menu = renderItems(items);
		doc.body.appendChild(menu);
		// 先定位再测量：appendChild 之后才有尺寸
		place(x, y);
		return true;
	};

	/**
	 * 事件是否落在菜单上。
	 *
	 * 原生滚动条不是 DOM 节点，个别浏览器/拖动场景里按下滚动条时 `event.target`
	 * 会变成 document 或 body；这时用菜单矩形兜底，避免点滚动条被当成"点了外面"。
	 * jsdom 没有布局（矩形恒为 0），只在有真实尺寸时启用坐标判断。
	 */
	const isInsideMenu = event => {
		if (!menu) {
			return false;
		}
		if (menu.contains(event.target) || submenu?.contains(event.target)) {
			return true;
		}
		const rect = menu.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return false;
		}
		const { clientX, clientY } = event;
		return typeof clientX === 'number' && typeof clientY === 'number'
			&& clientX >= rect.left && clientX <= rect.right
			&& clientY >= rect.top && clientY <= rect.bottom;
	};

	const onDocumentPointerDown = event => {
		if (menu && !isInsideMenu(event)) {
			close();
		}
	};

	/**
	 * 只关闭"菜单外面的滚动"。`scroll` 不冒泡，但 document 上的捕获监听器
	 * 仍会收到菜单内部的滚动事件 —— 之前一律 close()，导致滚轮滚菜单、
	 * 点/拖菜单自己的滚动条都会把菜单关掉。
	 */
	const onDocumentScroll = event => {
		if (!menu) {
			return;
		}
		const target = event.target;
		if (target && typeof target.nodeType === 'number' && menu.contains(target)) {
			return;
		}
		close();
	};
	const onDocumentKeyDown = event => {
		if (menu && event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	};

	doc?.addEventListener('pointerdown', onDocumentPointerDown, true);
	doc?.addEventListener('keydown', onDocumentKeyDown, true);
	doc?.addEventListener('scroll', onDocumentScroll, true);

	return {
		open,
		close,
		get isOpen() {
			return menu !== null;
		},
		get labels() {
			return menu
				? Array.from(menu.querySelectorAll('.wispkit-menu-item'))
					.map(item => item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent)
				: [];
		},
		/** 菜单项图标（sprite 引用）；没有图标的项为空字符串。 */
		get icons() {
			return menu
				? Array.from(menu.querySelectorAll('.wispkit-menu-item'))
					.map(item => item.querySelector('use')?.getAttribute('href') ?? '')
				: [];
		},
		get disabledLabels() {
			return menu
				? Array.from(menu.querySelectorAll('.wispkit-menu-item:disabled'))
					.map(item => item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent)
				: [];
		},
		/** 供自动化验证：按文字点菜单项 */
		click(label) {
			const target = menu
				? Array.from(menu.querySelectorAll('.wispkit-menu-item'))
					.find(item => (item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent) === label)
				: null;
			target?.click();
			return Boolean(target);
		},
		/** 二级菜单里当前显示的条目文字；没展开时为空数组。 */
		get submenuLabels() {
			return submenu
				? Array.from(submenu.querySelectorAll('.wispkit-menu-item'))
					.map(item => item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent)
				: [];
		},
		/** 供自动化验证：展开某个带子项的菜单条并返回子项文字。 */
		openSubmenu(label) {
			const target = menu
				? Array.from(menu.querySelectorAll('.wispkit-menu-item'))
					.find(item => (item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent) === label)
				: null;
			target?.click();
			return target ? Array.from(submenu?.querySelectorAll('.wispkit-menu-item') ?? [])
				.map(item => item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent) : [];
		},
		/** 供自动化验证：点二级菜单里的条目 */
		clickInSubmenu(label) {
			const target = submenu
				? Array.from(submenu.querySelectorAll('.wispkit-menu-item'))
					.find(item => (item.querySelector('.wispkit-menu-label')?.textContent ?? item.textContent) === label)
				: null;
			target?.click();
			return Boolean(target);
		},
		dispose() {
			close();
			doc?.removeEventListener('pointerdown', onDocumentPointerDown, true);
			doc?.removeEventListener('keydown', onDocumentKeyDown, true);
			doc?.removeEventListener('scroll', onDocumentScroll, true);
		},
	};
}
