/**
 * 页面内的链接路由：把 `<a>` 的**原始 href** 送回扩展，由扩展决定在 VS Code 内打开
 * 还是交给系统。
 *
 * 为什么不能交给 webview 外壳：
 * - 页面需要 `<base href="<webview 资源 URL>">` 才能加载相对图片 / 样式；
 * - 于是相对链接被浏览器解析成 `https://file+.vscode-resource…`（真实 VS Code）
 *   或宿主自己的资源 URL（Bench），外壳把它当外部链接丢给系统浏览器 ——
 *   这就是"Markdown 里点链接跳系统浏览器"；
 * - 不实现链接点击的宿主（Bench）则连反应都没有。
 *
 * 用 DOM 冒泡阶段的 document 监听：页面自己的 click 处理先跑（`preventDefault()`
 * 之后我们就不抢），然后才轮到 webview 外壳挂在 window 上的监听；在这里
 * `stopPropagation()` 可确保外壳不会再按 https 打开一次。
 */

const UNSAFE_SCHEMES = /^(javascript|data|blob|about|vbscript)$/i;

/**
 * 这些 scheme 本来就由 webview 外壳处理（`http(s)` 交给系统浏览器、
 * `vscode://settings` 等交给 VS Code 的协议处理器），不要抢。
 * 例外：`vscode://file/...` 由扩展接管，才能在**当前窗口**打开并定位行号。
 */
const HOST_SCHEMES = /^(https?|mailto|tel)$/i;
const VSCODE_SCHEME = /^vscode(?:-insiders?)?$/i;
const VSCODE_FILE_LINK = /^vscode(?:-insiders?)?:\/\/file\//i;

/** 从事件目标向上找最近的 `<a>`（兼容 SVG 里的 `parentNode` 链）。 */
export function findAnchor(node) {
	let current = node;
	while (current) {
		if (current.nodeType === 1 && current.tagName && current.tagName.toLowerCase() === 'a') {
			return current;
		}
		current = current.parentNode;
	}
	return null;
}

/**
 * 这个 href 该不该由扩展接管。
 * - `#anchor`：页内滚动，交给浏览器 / 外壳；
 * - `command:`：宿主按 `enableCommandUris` 执行（drawio 等第三方预览脚本在用）；
 * - `http(s)` / `mailto` / `tel` / 非 file 的 `vscode:`：外壳本来就会处理，不抢；
 * - `javascript:` / `data:` / `blob:`：绝不接手；
 * - 其余（相对路径、Windows 盘符、`file:`、`vscode://file`）送回扩展解析。
 *
 * 只接管"外壳一定处理不了"的那几类，是这次修复的边界：外链行为保持与内置预览一致。
 */
export function isRoutableHref(href) {
	const value = typeof href === 'string' ? href.trim() : '';
	if (!value) {
		return false;
	}
	if (value.startsWith('#')) {
		return false;
	}
	const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
	if (scheme) {
		const name = scheme[1].toLowerCase();
		if (name === 'command' || UNSAFE_SCHEMES.test(name)) {
			return false;
		}
		if (HOST_SCHEMES.test(name)) {
			return false;
		}
		if (VSCODE_SCHEME.test(name) && !VSCODE_FILE_LINK.test(value)) {
			return false;
		}
	}
	return true;
}

export function installLinkRouter(options = {}) {
	const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
	if (!doc) {
		return () => {};
	}
	const send = typeof options.onOpenLink === 'function' ? options.onOpenLink : () => {};
	const canHandle = typeof options.canHandle === 'function' ? options.canHandle : () => true;

	const onClick = event => {
		if (!event || event.defaultPrevented) {
			return;
		}
		// 中键 / 右键由宿主处理（中键在 VS Code webview 里本来就被禁用）。
		if (typeof event.button === 'number' && event.button !== 0) {
			return;
		}
		const anchor = findAnchor(event.target);
		if (!anchor || typeof anchor.getAttribute !== 'function') {
			return;
		}
		const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '';
		if (!isRoutableHref(href)) {
			return;
		}
		if (!canHandle(href, anchor)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		send(href, anchor);
	};

	doc.addEventListener('click', onClick, false);
	return () => doc.removeEventListener('click', onClick, false);
}
