import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `.mmd` 浏览页前端无法在 mocha 里跑（需要 VS Code 的 Mermaid 预览脚本），
 * 这里只锁定几条容易被改回去的契约：
 *   - 工具栏三个按钮各自上报什么消息；
 *   - 文档更新时改写 `.mermaid` 的 textContent 并派发内置脚本监听的事件；
 *   - esbuild 确实把 media/mermaid.js 打进 media/dist。
 */
function read(relative: string): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
}

describe('media/mermaid.js 前端契约', () => {
	const source = read(path.join('media', 'mermaid.js'));

	it('刷新 / 源码 / 3D 三个入口分别上报宿主消息', () => {
		assert.ok(source.includes("post('wispkit.mmd.refresh')"));
		assert.ok(source.includes("post('wispkit.mmd.openSource')"));
		assert.ok(source.includes("post('wispkit.mmd.open3d')"));
	});

	it('收到更新后改写 .mermaid 内容并触发内置预览脚本重渲染', () => {
		assert.ok(source.includes("message.type !== 'wispkit.mmd.update'"));
		assert.ok(/ui\.diagram\.textContent = message\.source/.test(source));
		assert.ok(source.includes("new CustomEvent('vscode.markdown.updateContent')"));
		assert.ok(source.includes("window.dispatchEvent("));
	});

	it('源码模式下更新的 <pre> 文本，不误派发图表重渲染事件', () => {
		assert.ok(/else if \(ui\.sourceView\)[\s\S]{0,80}ui\.sourceView\.textContent = message\.source/.test(source));
	});

	it('esbuild 打包 mermaid 前端入口', () => {
		const build = read('esbuild.mjs');
		assert.ok(build.includes("entry: 'media/mermaid.js', out: 'media/dist/mermaid.js'"));
	});

	it('不覆盖内置 Mermaid 的居中 transform：wrapper 不能再做一次 flex 居中', () => {
		const css = read(path.join('media', 'mermaid.css'));
		const rule = /\.wispkit-mmd-stage\s+\.mermaid-wrapper\s*\{([^}]*)\}/.exec(css);
		assert.ok(rule, '样式表里找不到 .wispkit-mmd-stage .mermaid-wrapper 规则');
		assert.ok(!/display\s*:\s*flex/.test(rule![1]),
			'wrapper 上加 flex 会把内置脚本算好的 (容器宽-SVG宽)/2 平移再叠加一次，图会靠右');
		assert.ok(!/justify-content\s*:/.test(rule![1]),
			'居中只能交给内置脚本，wrapper 不能再写 justify-content');
	});
});
