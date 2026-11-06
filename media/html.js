import { installLinkRouter } from './shared/links.js';

/**
 * HTML 视图的链接路由入口。
 *
 * HTML 页面的内容与脚本都是原样的，所以这里只做一件事：在 document 上装一个
 * 冒泡阶段的点击监听，把链接的原始 href 交给扩展。页面自己的脚本先跑，调用过
 * `preventDefault()` 的链接不会被抢。
 */

let hostApi = null;
try {
	hostApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
} catch {
	hostApi = null;
}

// 没有宿主 API（例如单测 / 直接在浏览器里打开）时不要拦截：否则点了什么都不会发生。
if (hostApi) {
	installLinkRouter({
		onOpenLink: href => hostApi.postMessage({ type: 'wispkit.openLink', href }),
	});
}
