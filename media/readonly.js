// acquireVsCodeApi 只能取一次；取不到（例如单测里直接 import）就退化成纯前端模式
let hostApi = null;
try {
	hostApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
} catch {
	hostApi = null;
}

const unlock = document.getElementById('wispkit-readonly-unlock');
const banner = document.getElementById('wispkit-readonly-banner');
const text = document.getElementById('wispkit-readonly-text');

unlock?.addEventListener('click', () => {
	hostApi?.postMessage({ type: 'wispkit.unlock' });
});

Object.defineProperty(window, '__wispkitSelftest', {
	value: {
		hasUnlock: () => Boolean(unlock),
		banner: () => banner?.textContent ?? '',
		lineCount: () => (text?.textContent ?? '').split('\n').length,
		charCount: () => (text?.textContent ?? '').length,
		clickUnlock: () => unlock?.click(),
	},
});
