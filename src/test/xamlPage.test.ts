import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { renderXamlPage, type XamlPageOptions } from '../xaml/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { dispatchWheel, installDom, loadMediaModule } from './helpers/dom';

const CSP_SOURCE = 'vscode-webview://abc123';

function basePage(overrides: Partial<XamlPageOptions> = {}): string {
	return renderXamlPage({
		title: 'MainWindow.xaml',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: `${CSP_SOURCE}/xaml.js`,
		runtimeStyle: `${CSP_SOURCE}/xaml.css`,
		code: '<Window>\n  <Grid />\n</Window>',
		language: 'xaml',
		imageSrc: `${CSP_SOURCE}/out.png`,
		result: { ok: true, pngPath: 'C:\\out\\out.png', width: 1280, height: 800, root: 'MainWindow', mode: 'rootObjectInstance' },
		config: { wheelStep: 1.1, dragButton: 'right', codeVisible: true, codeWidth: 460 },
		...overrides,
	});
}

/** 用真实生成出来的页面装进 jsdom，再执行真实的前端模块。 */
function setupPage(overrides: Partial<XamlPageOptions> = {}) {
	const dom = installDom(basePage(overrides));
	loadMediaModule('media/xaml.js');
	return {
		dom,
		doc: dom.window.document,
		api: (dom.window as unknown as { __wispkitSelftest: any }).__wispkitSelftest,
	};
}

describe('xaml/page', () => {
	it('工具栏提供保存、重新渲染、放大查看、适应窗口与三态布局按钮', () => {
		const html = basePage();
		for (const id of [
			'wispkit-xaml-save', 'wispkit-xaml-rerender', 'wispkit-xaml-lightbox-button', 'wispkit-xaml-fit',
			'wispkit-xaml-layout-all', 'wispkit-xaml-layout-code', 'wispkit-xaml-layout-preview',
		]) {
			assert.ok(html.includes(`id="${id}"`), `缺少工具栏按钮 ${id}`);
		}
	});

	it('布局按钮三态互斥：初始只有当前态是激活的', () => {
		const html = basePage();
		const pressed = [...html.matchAll(/id="wispkit-xaml-layout-(\w+)"[^>]*aria-pressed="(true|false)"/g)]
			.map(match => [match[1], match[2]] as const);
		assert.deepStrictEqual(pressed, [['all', 'true'], ['code', 'false'], ['preview', 'false']]);
	});

	it('工具栏按钮都带图标，且每个 <use> 都能在页面内的 sprite 里找到 symbol', () => {
		const html = basePage();
		assert.ok(html.includes('class="wispkit-xaml-sprite"'), '缺少内联 sprite');

		const used = [...html.matchAll(/<use href="#wispkit-icon-([\w-]+)"><\/use>/g)].map(match => match[1]);
		assert.ok(used.length >= 9, `图标引用太少：${used.length}`);

		const defined = new Set([...html.matchAll(/<symbol id="wispkit-icon-([\w-]+)"/g)].map(match => match[1]));
		const missing = used.filter(name => !defined.has(name));
		assert.deepStrictEqual(missing, [], `这些图标没有定义：${missing.join(', ')}`);

		// 工具栏 7 个按钮（含三态布局）每个都要「图标 + 文字节点」；图标单独成节点，
		// 脚本改写文字时不会连图标一起抹掉。
		for (const id of [
			'wispkit-xaml-save', 'wispkit-xaml-rerender', 'wispkit-xaml-lightbox-button', 'wispkit-xaml-fit',
			'wispkit-xaml-layout-all', 'wispkit-xaml-layout-code', 'wispkit-xaml-layout-preview',
		]) {
			const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`))?.[1] ?? '';
			assert.ok(button.includes('<use href="#wispkit-icon-'), `${id} 没有图标`);
			assert.ok(button.includes('class="wispkit-xaml-btn-label"'), `${id} 没有文字节点`);
		}
	});

	it('图标线条用 currentColor，所以激活态与悬停不必单独配色', () => {
		const html = basePage();
		const symbols = [...html.matchAll(/<symbol /g)].length;
		const currentColor = [...html.matchAll(/stroke="currentColor"/g)].length;
		assert.ok(symbols >= 9);
		assert.strictEqual(currentColor, symbols, '每个 symbol 都要用 currentColor 描边');
	});

	it('源码区带高亮层，标签/属性/属性值分别着色且已转义', () => {
		const html = basePage({ code: '<Grid a="b" />' });
		assert.ok(html.includes('id="wispkit-xaml-highlight"'), '缺少高亮层');
		assert.ok(html.includes('id="wispkit-xaml-highlight-code"'));
		assert.ok(html.includes('<span class="wispkit-hl-tag">&lt;Grid</span>'), '标签应当被高亮且尖括号被转义');
		assert.ok(html.includes('<span class="wispkit-hl-attr">a</span>'));
		assert.ok(html.includes('<span class="wispkit-hl-string">&quot;b&quot;</span>'));
	});

	it('language=csharp 时改用 C# 高亮规则', () => {
		const html = basePage({ language: 'csharp', code: 'public class App { }' });
		assert.ok(html.includes('class="wispkit-hl-keyword"'), 'C# 关键字应当被高亮');
		assert.ok(!html.includes('class="wispkit-hl-tag"'), 'C# 里不该出现 XML 标签高亮');
	});

	it('渲染对象不是本文件时，状态栏标注出来', () => {
		const html = basePage({ renderTargetName: 'MainWindow.xaml' });
		assert.ok(html.includes('渲染对象 MainWindow.xaml'));
	});

	it('errorHint 可覆盖默认的「常见原因」提示', () => {
		const html = basePage({
			imageSrc: undefined,
			result: { ok: false, errorType: '找不到同名 XAML', error: 'C:\\a\\MainWindow.xaml 不存在。' },
			errorHint: '请先创建同名 .xaml',
		});
		assert.ok(html.includes('请先创建同名 .xaml'));
		assert.ok(!html.includes('clr-namespace'), '覆盖后不该再出现默认提示');
	});

	it('页面里没有重复 id（曾因 lightbox 容器与按钮撞名，getElementById 取到了按钮）', () => {
		const html = basePage();
		const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
		const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
		assert.deepStrictEqual(duplicated, [], `重复 id：${duplicated.join(', ')}`);
	});

	it('CSP 与 nonce 正确落到 meta 与脚本上', () => {
		const html = basePage();
		assert.ok(html.includes(`script-src 'nonce-NONCE1'`));
		assert.ok(html.includes(`src="vscode-webview://abc123/xaml.js" nonce="NONCE1"`));
	});

	it('配置 meta 用 data-wispkit —— 绝不能用 data-settings（内置预览脚本会抢）', () => {
		const html = basePage();
		assert.ok(html.includes('id="wispkit-xaml-config"'));
		assert.ok(!html.includes('data-settings'), '页面里不能出现 data-settings');
		assert.ok(/data-wispkit="[^"]*wheelStep/.test(html));
	});

	it('源码区是可编辑 textarea + 独立行号栏', () => {
		const html = basePage({ code: 'a\nb\nc' });
		assert.ok(/<textarea[^>]*id="wispkit-xaml-editor"[^>]*wrap="off"/.test(html), '编辑器必须是 wrap="off" 的 textarea，否则长行折行会让行号串位');
		assert.ok(/id="wispkit-xaml-gutter"[^>]*aria-hidden="true"/.test(html), '行号栏必须 aria-hidden');
		assert.strictEqual((html.match(/class="wispkit-xaml-gutter-line"/g) ?? []).length, 3, '行号数量应等于源码行数');
		assert.ok(html.includes('>a\nb\nc</textarea>'), '编辑器里应当是原始源码');
	});

	it('渲染成功：显示图片、错误面板 hidden', () => {
		const html = basePage();
		assert.ok(html.includes(`id="wispkit-xaml-image" src="vscode-webview://abc123/out.png"`));
		assert.ok(/id="wispkit-xaml-error"[^>]*hidden/.test(html));
		assert.ok(!/id="wispkit-xaml-viewport"[^>]*hidden/.test(html));
	});

	it('渲染失败：显示错误面板并带出 errorType 与 error', () => {
		const html = basePage({
			imageSrc: undefined,
			result: {
				ok: false,
				error: "Specified class name 'NewsBoard.Wpf.MainWindow' doesn't match actual root instance type",
				errorType: 'XamlParseException',
			},
		});

		assert.ok(!/id="wispkit-xaml-error"[^>]*hidden/.test(html), '错误面板必须可见');
		assert.ok(html.includes('XamlParseException'));
		assert.ok(html.includes('doesn&#39;t match actual root instance type'));
		assert.ok(/id="wispkit-xaml-viewport"[^>]*hidden/.test(html), '没有图时视图区要隐藏');
		assert.ok(html.includes('x:Class'), '要给出常见原因提示');
	});

	it('放大预览容器与工具栏状态都在', () => {
		const html = basePage();
		assert.ok(html.includes('id="wispkit-xaml-lightbox"'));
		assert.ok(html.includes('id="wispkit-xaml-lightbox-stage"'));
		assert.ok(html.includes('id="wispkit-xaml-splitter"'));
		assert.ok(html.includes('role="separator"'));
		assert.ok(html.includes('渲染成功'));
		assert.ok(html.includes('root=MainWindow'));
	});

	it('codeVisible=false 时初始为「收纳左侧」：代码栏与分隔条隐藏、渲染区可见', () => {
		const html = basePage({ config: { wheelStep: 1.1, dragButton: 'right', codeVisible: false, codeWidth: 460 } });
		assert.ok(/id="wispkit-xaml-code-pane"[^>]*hidden/.test(html));
		assert.ok(/id="wispkit-xaml-splitter"[^>]*hidden/.test(html));
		assert.ok(!/id="wispkit-xaml-preview-pane"[^>]*hidden/.test(html));
		assert.ok(/id="wispkit-xaml-layout-preview"[^>]*aria-pressed="true"/.test(html), '初始态应当是「收纳左侧」激活');
	});

	it('标题与源码里的特殊字符被转义', () => {
		const html = basePage({ title: 'a<b>&"c".xaml', code: '<TextBlock Text="a & b <c>" />' });
		assert.ok(html.includes('<title>a&lt;b&gt;&amp;&quot;c&quot;.xaml</title>'));
		assert.ok(html.includes('&lt;TextBlock Text=&quot;a &amp; b &lt;c&gt;&quot; /&gt;'));
	});
});

/**
 * 带宿主桩的页面：xaml.js 取 acquireVsCodeApi 用的是裸标识符，
 * 所以注入点必须在 globalThis 上（installDom 设的是 window/document）。
 */
function setupWithHost(overrides: Partial<XamlPageOptions> = {}) {
	const dom = installDom(basePage(overrides));
	const messages: any[] = [];
	(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
		postMessage: (message: unknown) => messages.push(message),
	});
	loadMediaModule('media/xaml.js');

	return {
		dom,
		doc: dom.window.document,
		messages,
		api: (dom.window as unknown as { __wispkitSelftest: any }).__wispkitSelftest,
		click: (id: string) => dom.window.document.getElementById(id)!
			.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
		send: (data: unknown) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })),
		cleanup: () => {
			delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
		},
	};
}

describe('media/xaml.js', () => {
	it('行号数与源码行数一致', () => {
		const { api } = setupPage({ code: 'a\nb\nc\nd' });
		assert.strictEqual(api.codeLineCount(), 4);
	});

	it('切换代码栏可见性', () => {
		const { doc, api } = setupPage();
		const pane = doc.getElementById('wispkit-xaml-code-pane')!;

		assert.strictEqual(pane.hidden, false);
		assert.strictEqual(api.toggleCode(), false);
		assert.strictEqual(pane.hidden, true);
		assert.strictEqual(api.toggleCode(), true);
		assert.strictEqual(pane.hidden, false);
	});

	it('收到 update 消息后重建代码、换图并更新状态', () => {
		const { dom, doc, api } = setupPage();

		dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
			data: {
				type: 'wispkit.xaml.update',
				code: 'x\ny',
				imageSrc: `${CSP_SOURCE}/new.png`,
				result: { ok: true, root: 'App', width: 100, height: 50, mode: 'rootObjectInstance' },
			},
		}));

		assert.strictEqual(api.codeLineCount(), 2);
		assert.strictEqual(doc.getElementById('wispkit-xaml-image')!.getAttribute('src'), `${CSP_SOURCE}/new.png`);
		assert.strictEqual(doc.getElementById('wispkit-xaml-viewport')!.hidden, false);
		assert.ok(doc.getElementById('wispkit-xaml-status')!.textContent!.includes('root=App'));
	});

	it('收到 error 消息后切到错误面板', () => {
		const { dom, doc } = setupPage();

		dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
			data: { type: 'wispkit.xaml.error', result: { ok: false, error: 'boom', errorType: 'XamlParseException' } },
		}));

		assert.strictEqual(doc.getElementById('wispkit-xaml-error')!.hidden, false);
		assert.strictEqual(doc.getElementById('wispkit-xaml-viewport')!.hidden, true);
		assert.strictEqual(doc.getElementById('wispkit-xaml-error-type')!.textContent, 'XamlParseException');
		assert.strictEqual(doc.getElementById('wispkit-xaml-error-message')!.textContent, 'boom');
	});

	it('滚轮即缩放（不需要修饰键）', () => {
		const { doc, api } = setupPage();
		assert.strictEqual(api.zoom(), 1);

		dispatchWheel(doc.getElementById('wispkit-xaml-viewport'), { deltaY: -100, clientX: 60, clientY: 60 });
		assert.ok(api.zoom() > 1, `滚轮向上应当放大，实际 ${api.zoom()}`);
	});

	it('pan() 走真实手势路径并真的产生平移', () => {
		const { doc, api } = setupPage();
		assert.strictEqual(api.pan(30, -10), true);

		const transform = doc.getElementById('wispkit-xaml-image')!.style.transform;
		assert.ok(/translate\(30px,\s*-10px\)/.test(transform), `实际 ${transform}`);
	});

	it('openLightbox() 打开全屏预览', () => {
		const { doc, api } = setupPage();
		const image = doc.getElementById('wispkit-xaml-image')!;
		Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
		Object.defineProperty(image, 'naturalHeight', { value: 600, configurable: true });

		assert.strictEqual(api.openLightbox(), true);
		assert.strictEqual(doc.getElementById('wispkit-xaml-lightbox')!.hidden, false);
		assert.strictEqual(doc.getElementById('wispkit-xaml-lightbox-stage')!.children.length, 1);
	});

	it('图片没加载出来时 openLightbox() 不打开空框', () => {
		const { doc, api } = setupPage();
		// jsdom 不会真的加载图片：尺寸全为 0
		assert.strictEqual(api.imageLoaded(), false);
		assert.strictEqual(api.openLightbox(), false);
		assert.strictEqual(doc.getElementById('wispkit-xaml-lightbox')!.hidden, true);
	});

	it('拖拽分隔条调整源码栏宽度，双击复位', () => {
		const { dom, doc, api } = setupPage();
		assert.strictEqual(api.splitterWidth(), 460);

		const layout = doc.getElementById('wispkit-xaml-layout')!;
		layout.getBoundingClientRect = () => ({
			left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0,
			toJSON: () => ({}),
		}) as DOMRect;

		const splitter = doc.getElementById('wispkit-xaml-splitter')!;
		splitter.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 460 }));
		splitter.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 520 }));

		assert.strictEqual(api.splitterWidth(), 520);
		assert.strictEqual(doc.getElementById('wispkit-xaml-code-pane')!.style.width, '520px');

		splitter.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
		assert.strictEqual(api.splitterWidth(), 460);
	});

	it('点「重新渲染」把编辑区当前文本发给宿主', () => {
		const page = setupWithHost({ code: 'original' });
		try {
			page.api.setEditorText('<TextBlock Text="改了" />');
			page.click('wispkit-xaml-rerender');

			assert.strictEqual(page.messages.length, 1);
			assert.strictEqual(page.messages[0].type, 'wispkit.renderXaml');
			assert.strictEqual(page.messages[0].text, '<TextBlock Text="改了" />', '必须用编辑区文本，而不是磁盘内容');
			assert.ok(String(page.messages[0].requestId).startsWith('render-'));
		} finally {
			page.cleanup();
		}
	});

	it('点「保存」把编辑区当前文本发给宿主', () => {
		const page = setupWithHost();
		try {
			page.api.setEditorText('saved');
			page.click('wispkit-xaml-save');

			assert.strictEqual(page.messages[0].type, 'wispkit.saveText');
			assert.strictEqual(page.messages[0].text, 'saved');
			assert.ok(String(page.messages[0].requestId).startsWith('save-'));
		} finally {
			page.cleanup();
		}
	});

	it('保存结果与渲染结果都反映到状态栏', () => {
		const page = setupWithHost();
		const status = () => page.doc.getElementById('wispkit-xaml-status')!.textContent!;
		try {
			page.send({ type: 'wispkit.saveResult', requestId: 'save-1', ok: true });
			assert.strictEqual(status(), '已保存');

			page.send({ type: 'wispkit.saveResult', requestId: 'save-2', ok: false, error: '文件是只读的' });
			assert.ok(status().includes('只读'), `实际状态：${status()}`);

			page.send({
				type: 'wispkit.xamlRendered',
				requestId: 'render-1',
				ok: true,
				imageSrc: `${CSP_SOURCE}/rendered.png`,
				root: 'Grid',
				width: 320,
				height: 200,
				mode: 'parse',
			});
			assert.strictEqual(page.doc.getElementById('wispkit-xaml-image')!.getAttribute('src'), `${CSP_SOURCE}/rendered.png`);
			assert.strictEqual(page.doc.getElementById('wispkit-xaml-viewport')!.hidden, false);
			assert.ok(status().includes('root=Grid'), `实际状态：${status()}`);

			page.send({ type: 'wispkit.xamlRendered', requestId: 'render-2', ok: false, error: 'boom', errorType: 'XamlParseException' });
			assert.strictEqual(page.doc.getElementById('wispkit-xaml-error')!.hidden, false);
			assert.strictEqual(page.doc.getElementById('wispkit-xaml-error-type')!.textContent, 'XamlParseException');
			assert.ok(status().includes('XamlParseException'));
		} finally {
			page.cleanup();
		}
	});

	it('行号随编辑内容变化', () => {
		const page = setupWithHost({ code: 'a\nb' });
		try {
			assert.strictEqual(page.api.gutterLineCount(), 2);

			page.api.setEditorText('a\nb\nc\nd');
			assert.strictEqual(page.api.gutterLineCount(), 4);
			assert.strictEqual(page.api.codeLineCount(), 4);

			page.api.typeText('\ne');
			assert.strictEqual(page.api.gutterLineCount(), 5, '输入新行后行号应跟上');
		} finally {
			page.cleanup();
		}
	});

	it('编辑标脏、保存成功后清脏（保存失败保持脏）', () => {
		const page = setupWithHost({ code: 'a' });
		const dirtyElement = () => page.doc.getElementById('wispkit-xaml-dirty')!;
		try {
			assert.strictEqual(page.api.isDirty(), false, '初始不应是脏的');
			assert.strictEqual(dirtyElement().hidden, true);

			page.api.typeText('b');
			assert.strictEqual(page.api.isDirty(), true, '输入后应标脏');
			assert.strictEqual(dirtyElement().hidden, false, '标脏后标记必须可见');

			page.api.save();
			page.send({ type: 'wispkit.saveResult', requestId: 'save-1', ok: false, error: '文件是只读的' });
			assert.strictEqual(page.api.isDirty(), true, '保存失败必须保持脏');

			page.api.save();
			page.send({ type: 'wispkit.saveResult', requestId: 'save-2', ok: true });
			assert.strictEqual(page.api.isDirty(), false, '保存成功后应清脏');
			assert.strictEqual(dirtyElement().hidden, true);
		} finally {
			page.cleanup();
		}
	});

	it('编辑器滚动时行号栏同步 scrollTop', () => {
		const page = setupWithHost({ code: 'a\nb' });
		try {
			page.api.scrollEditorTo(42);
			assert.strictEqual(page.api.gutterScrollTop(), 42);
		} finally {
			page.cleanup();
		}
	});

	it('编辑器滚动时高亮层同步 scrollTop', () => {
		const page = setupWithHost({ code: 'a\nb' });
		try {
			page.api.scrollEditorTo(37);
			assert.strictEqual(page.api.highlightScrollTop(), 37);
		} finally {
			page.cleanup();
		}
	});

	it('高亮层文字与编辑器逐字相同（多一个少一个字符光标就会错位）', () => {
		const code = '<Grid a="b">\n  文本 &amp; 实体\n</Grid>';
		const { api } = setupPage({ code });

		// 高亮层末尾补了一个换行，用来补回 <pre> 丢掉的最后一个空行
		assert.strictEqual(String(api.highlightText()).replace(/\n$/, ''), code);
		assert.strictEqual(api.editorText(), code);
		assert.ok(String(api.highlightHtml()).includes('wispkit-hl-tag'));
	});

	it('编辑后高亮跟着更新', () => {
		const page = setupWithHost({ code: 'a' });
		try {
			page.api.setEditorText('<TextBlock Text="改了" />');
			assert.ok(String(page.api.highlightText()).includes('<TextBlock Text="改了" />'));
			assert.ok(String(page.api.highlightHtml()).includes('wispkit-hl-tag'));
		} finally {
			page.cleanup();
		}
	});

	it('language=csharp 时高亮走 C# 规则', () => {
		const { api } = setupPage({ language: 'csharp', code: 'public void M() { }' });
		assert.ok(String(api.highlightHtml()).includes('wispkit-hl-keyword'));
	});

	it('三态布局互斥：都显示 / 收纳右侧 / 收纳左侧', () => {
		const { doc, api } = setupPage();
		const codePane = doc.getElementById('wispkit-xaml-code-pane')!;
		const previewPane = doc.getElementById('wispkit-xaml-preview-pane')!;
		const splitter = doc.getElementById('wispkit-xaml-splitter')!;

		assert.strictEqual(api.layoutMode(), 'both');
		assert.strictEqual(codePane.hidden, false);
		assert.strictEqual(previewPane.hidden, false);
		assert.strictEqual(splitter.hidden, false);

		api.setLayoutMode('code');
		assert.strictEqual(codePane.hidden, false);
		assert.strictEqual(previewPane.hidden, true, '收纳右侧时渲染区必须隐藏');
		assert.strictEqual(splitter.hidden, true, '只有一侧时分隔条没有意义');
		assert.ok(doc.getElementById('wispkit-xaml-layout-code')!.classList.contains('wispkit-xaml-btn-active'));
		assert.strictEqual(doc.getElementById('wispkit-xaml-layout-all')!.getAttribute('aria-pressed'), 'false');
		assert.strictEqual(doc.getElementById('wispkit-xaml-layout-code')!.getAttribute('aria-pressed'), 'true');

		api.setLayoutMode('preview');
		assert.strictEqual(codePane.hidden, true, '收纳左侧时源码区必须隐藏');
		assert.strictEqual(previewPane.hidden, false);
		assert.ok(doc.getElementById('wispkit-xaml-layout-preview')!.classList.contains('wispkit-xaml-btn-active'));

		api.setLayoutMode('both');
		assert.strictEqual(codePane.hidden, false);
		assert.strictEqual(previewPane.hidden, false);
		assert.strictEqual(splitter.hidden, false);
		assert.ok(doc.getElementById('wispkit-xaml-layout-all')!.classList.contains('wispkit-xaml-btn-active'));
	});

	it('点布局按钮切换三态', () => {
		const page = setupWithHost();
		try {
			page.click('wispkit-xaml-layout-code');
			assert.strictEqual(page.api.layoutMode(), 'code');
			page.click('wispkit-xaml-layout-preview');
			assert.strictEqual(page.api.layoutMode(), 'preview');
			page.click('wispkit-xaml-layout-all');
			assert.strictEqual(page.api.layoutMode(), 'both');
		} finally {
			page.cleanup();
		}
	});

	it('用户正在输入时不被外部更新覆盖', () => {
		const page = setupWithHost();
		try {
			page.api.setEditorText('用户改过的内容');
			(page.doc.getElementById('wispkit-xaml-editor') as HTMLTextAreaElement).focus();

			page.send({ type: 'wispkit.xaml.update', code: '磁盘上的内容', result: { ok: true } });
			assert.strictEqual(page.api.editorText(), '用户改过的内容');
		} finally {
			page.cleanup();
		}
	});

	it('行号栏与编辑器共用同一套字体度量与上内边距（对齐前提）', () => {
		// 对齐完全靠 CSS，所以直接查样式表：两边取字号/行高/字体的方式必须相同
		const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'xaml.css'), 'utf8');
		const rule = (selector: string) => {
			const start = css.indexOf(`${selector} {`);
			assert.ok(start >= 0, `样式表里找不到 ${selector}`);
			return css.slice(start, css.indexOf('}', start));
		};

		const gutter = rule('.wispkit-xaml-gutter');
		const editor = rule('.wispkit-xaml-editor');
		const highlight = rule('.wispkit-xaml-highlight');
		for (const declaration of [
			'font-family: var(--vscode-editor-font-family, monospace)',
			'font-size: var(--wispkit-xaml-code-font-size)',
			'line-height: var(--wispkit-xaml-line-height)',
		]) {
			for (const [name, text] of [['行号栏', gutter], ['编辑器', editor], ['高亮层', highlight]] as const) {
				assert.ok(text.includes(declaration), `${name}缺少 ${declaration}`);
			}
		}

		// 高亮层与编辑器是叠放的：这两项不一致会直接换行错位
		for (const declaration of ['white-space: pre', 'tab-size: 4']) {
			assert.ok(editor.includes(declaration), `编辑器缺少 ${declaration}`);
			assert.ok(highlight.includes(declaration), `高亮层缺少 ${declaration}`);
		}

		const paddingTop = (text: string) => /padding:\s*([\d.]+)px/.exec(text)?.[1];
		const top = paddingTop(gutter);
		assert.ok(top, '行号栏应当有 padding');
		assert.strictEqual(paddingTop(editor), top, '上下内边距必须一致，否则第一行行号就对不上');
		assert.strictEqual(paddingTop(highlight), top, '高亮层内边距必须与编辑器一致，否则文字与光标错位');
	});
});
