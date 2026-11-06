import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MARKDOWN_ICON_NAMES, markdownIconSprite, renderMarkdownPage } from '../markdown/page';
import { DEFAULT_MARKDOWN_THEME_MODE, normalizeMarkdownThemeMode } from '../markdown/theme';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';

const pageZoomPure = loadMediaModule('media/shared/pagezoom.js');
const findPure = loadMediaModule('media/shared/find.js');

const CSP_SOURCE = 'vscode-webview://abc123';

/** 带 `data-line` 的块 —— 内置引擎就是这么标块的（markdownEngine.ts:25-26）。 */
const BODY_HTML = [
	'<h1 data-line="0" class="code-line" id="a">A</h1>',
	'<p data-line="2" class="code-line">第二段</p>',
	'<ul data-line="4" class="code-line"><li data-line="4">项</li></ul>',
].join('\n');
const SOURCE = ['# A', '', '第二段', '', '- 项'].join('\n');

function basePage(overrides: Partial<Parameters<typeof renderMarkdownPage>[0]> = {}) {
	return renderMarkdownPage({
		title: 'doc.md',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE123'),
		nonce: 'NONCE123',
		baseHref: 'vscode-webview://abc123/file.md',
		contributionStyles: ['vscode-webview://abc123/katex.min.css'],
		contributionScripts: [{ src: 'vscode-webview://abc123/mermaid.js', type: 'module' }],
		runtimeScript: 'vscode-webview://abc123/markdown.js',
		runtimeStyle: 'vscode-webview://abc123/markdown.css',
		bodyHtml: '<h1 id="a">A</h1>',
		config: { tocEnabled: true, tocDepth: 3 },
		typography: {},
		...overrides,
	});
}

describe('markdown/page', () => {
	it('贡献脚本带 nonce + type=module + async，顺序在运行时代码之前', () => {
		const html = basePage();
		assert.ok(html.includes(`<script async type="module" src="vscode-webview://abc123/mermaid.js" nonce="NONCE123" charset="UTF-8"></script>`));
		assert.ok(html.indexOf('mermaid.js') < html.indexOf('markdown.js'), '贡献脚本必须先于 Wispkit 运行时执行');
	});

	it('字符串形式的贡献脚本不带 type 属性', () => {
		const html = basePage({ contributionScripts: [{ src: 'vscode-webview://abc123/plain.js' }] });
		assert.ok(html.includes(`<script async src="vscode-webview://abc123/plain.js" nonce="NONCE123" charset="UTF-8"></script>`));
	});

	it('样式 link 不带 nonce（与内置 documentRenderer.ts:237 一致）', () => {
		const html = basePage();
		assert.ok(html.includes(`<link rel="stylesheet" type="text/css" href="vscode-webview://abc123/katex.min.css">`));
		assert.ok(!/link[^>]*nonce=/.test(html));
	});

	it('CSP meta 里的 nonce 与脚本 nonce 一致', () => {
		const html = basePage();
		assert.ok(html.includes(`script-src 'nonce-NONCE123'`));
	});

	it('base href 存在且可被前端用于解析相对资源', () => {
		const html = basePage();
		assert.ok(html.includes(`<base href="vscode-webview://abc123/file.md">`));
	});

	it('没有 baseHref 时不产生空 base 标签', () => {
		const html = basePage({ baseHref: undefined });
		assert.ok(!html.includes('<base'));
	});

	it('配置以可解析的 JSON 内嵌', () => {
		const html = basePage();
		const match = /<meta id="wispkit-config" data-wispkit="([^"]*)">/.exec(html);
		assert.ok(match, 'config meta 必须存在');
		const decoded = match![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
		const config = JSON.parse(decoded);
		assert.strictEqual(config.tocDepth, 3);
		assert.strictEqual(config.tocEnabled, true);
	});

	it('不得使用 data-settings 属性：内置 media/index.js 会按它取数据，撞名会让内置脚本抛错', () => {
		const html = basePage();
		assert.ok(!html.includes('data-settings'), '页面里不能出现 data-settings（实测会让内置预览脚本报 Could not load data for data-settings）');
	});

	it('标题里的特殊字符被转义', () => {
		const html = basePage({ title: 'a<b>&"c".md' });
		assert.ok(html.includes('<title>a&lt;b&gt;&amp;&quot;c&quot;.md</title>'));
	});

	it('正文原样嵌入（不做二次转义）', () => {
		const html = basePage({ bodyHtml: '<h1 id="a">A</h1>' });
		assert.ok(html.includes('<h1 id="a">A</h1>'));
	});

	it('工具栏提供目录收纳、左右切换、层级展开折叠与编辑切换', () => {
		const html = basePage();
		for (const id of ['wispkit-sidebar-toggle', 'wispkit-toc-side', 'wispkit-expand-all', 'wispkit-collapse-all', 'wispkit-editor-toggle']) {
			assert.ok(html.includes(`id="${id}"`), `缺少工具栏按钮 ${id}`);
		}
	});

	it('目录栏默认在右侧：布局容器带 wispkit-toc-right，按钮提示可移到左侧', () => {
		const html = basePage();
		assert.ok(html.includes('class="wispkit-layout wispkit-toc-right"'), '默认必须带 wispkit-toc-right（拖拽方向也靠它判定）');
		assert.ok(html.includes('id="wispkit-toc-side"'));
		assert.ok(html.includes('目录靠左</span>'), '默认在右侧时按钮应当提示可以移到左侧');
	});

	it('目录与正文之间有可拖拽的分隔条', () => {
		const html = basePage();
		assert.ok(html.includes('id="wispkit-splitter"'));
		assert.ok(html.includes('role="separator"'));
	});

	it('内置放大预览容器默认隐藏且可无障碍识别', () => {
		const html = basePage();
		assert.ok(/id="wispkit-lightbox"[^>]*hidden/.test(html));
		assert.ok(html.includes('role="dialog"'));
		assert.ok(html.includes('id="wispkit-lightbox-stage"'));
	});

	it('工具栏按钮都带内联 SVG 图标，且图标标签与文字分离', () => {
		const html = basePage();
		for (const name of MARKDOWN_ICON_NAMES) {
			assert.ok(html.includes(`id="wispkit-icon-${name}"`), `sprite 里缺少图标 ${name}`);
		}
		for (const id of ['wispkit-sidebar-toggle', 'wispkit-toc-side', 'wispkit-expand-all', 'wispkit-collapse-all', 'wispkit-save', 'wispkit-editor-toggle']) {
			const button = new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`).exec(html);
			assert.ok(button, `找不到按钮 ${id}`);
			assert.ok(button![0].includes('class="wispkit-btn-icon"'), `按钮 ${id} 缺少图标`);
			assert.ok(button![0].includes(`<use href="#wispkit-icon-`), `按钮 ${id} 的图标必须是 sprite 引用`);
			assert.ok(button![0].includes('class="wispkit-btn-label"'), `按钮 ${id} 的文字必须单独成节点，否则脚本改文案会连图标一起抹掉`);
		}
	});

	it('工具栏图标自带 width/height 兜底：外部样式表到达前不会按 SVG 默认 300×150 撑开', () => {
		const html = basePage();
		const icons = [...html.matchAll(/<svg class="wispkit-btn-icon"[^>]*>/g)].map(match => match[0]);
		assert.ok(icons.length >= 8, `应当有多个工具栏图标，实际 ${icons.length}`);
		for (const icon of icons) {
			assert.ok(/width="(14|10)"/.test(icon), `图标缺少 width 属性：${icon}`);
			assert.ok(/height="(14|10)"/.test(icon), `图标缺少 height 属性：${icon}`);
		}
		const thumb = /<span class="wispkit-switch-thumb">\s*<svg[^>]*>/.exec(html);
		assert.ok(thumb && /width="10"/.test(thumb[0]) && /height="10"/.test(thumb[0]),
			'滑块里的图标必须按 10px 兜底（CSS 加载前也不能变大）');
	});

	it('首屏关键样式内联在外部样式表之前，只负责把图标/工具栏形状定住', () => {
		const html = basePage();
		const critical = html.indexOf('<style>.wispkit-icon-sprite{position:absolute');
		assert.ok(critical >= 0, 'head 里必须有内联关键样式');
		const firstLink = html.indexOf('<link rel="stylesheet"');
		assert.ok(firstLink >= 0);
		assert.ok(critical < firstLink, '内联关键样式必须排在外部样式表之前，外部表才能按同特异性覆盖它');
		const block = /<style>([\s\S]*?)<\/style>/.exec(html);
		assert.ok(block);
		assert.ok(block![1].includes('.wispkit-btn-icon{display:block;flex:none;width:14px;height:14px}'));
		assert.ok(block![1].includes('.wispkit-switch-thumb .wispkit-btn-icon{width:10px;height:10px}'));
		assert.ok(block![1].includes('.wispkit-btn[hidden],.wispkit-dirty[hidden]{display:none}'),
			'关键样式里的 display 会盖掉 UA 的 [hidden]，必须显式补回，否则保存按钮会闪一下');
	});

	it('图标 sprite 用 currentColor，颜色自动跟随主题', () => {
		const sprite = markdownIconSprite();
		assert.ok(sprite.includes('stroke="currentColor"'), '必须用 currentColor，否则浅/深主题下颜色不对');
		assert.ok(sprite.includes('fill="none"'));
		assert.ok(sprite.includes('width="0"') && sprite.includes('height="0"'), 'sprite 自身不应占位');
	});

	it('主题三态：三个图标按钮从左到右为浅色 / 跟随主题 / 深色，默认选中第二个', () => {
		const html = basePage();
		assert.ok(html.includes('id="wispkit-theme"'), '工具栏必须有主题切换控件');
		const modes = [...html.matchAll(/data-theme-mode="([^"]+)"/g)].map(match => match[1]);
		assert.deepStrictEqual(modes, ['light', 'auto', 'dark'], '位置即语义：左侧浅色、中间跟随主题、右侧深色');
		const pressed = [...html.matchAll(/data-theme-mode="([^"]+)" aria-pressed="([^"]+)"/g)]
			.filter(match => match[2] === 'true')
			.map(match => match[1]);
		assert.deepStrictEqual(pressed, ['auto'], '默认必须是第二个图标（跟随主题），而不是浅色或深色');
		for (const icon of ['sun', 'monitor', 'moon']) {
			assert.ok(html.includes(`id="wispkit-icon-${icon}"`), `sprite 里缺少主题图标 ${icon}`);
			assert.ok(html.includes(`href="#wispkit-icon-${icon}"`), `主题按钮缺少 ${icon} 图标引用`);
		}
	});

	it('主题模式写进 <html>：首屏就是目标明暗，不会先闪一下当前主题再跳', () => {
		const auto = basePage();
		assert.ok(auto.includes('<html lang="en" class="wispkit-theme-auto" data-wispkit-theme="auto"'), '默认跟随主题');
		const light = basePage({ themeMode: 'light' });
		assert.ok(light.includes('class="wispkit-theme-light" data-wispkit-theme="light"'));
		assert.ok(light.includes('data-theme-mode="light" aria-pressed="true"'), '初始强制浅色时选中态要跟着走');
		assert.ok(!light.includes('data-theme-mode="auto" aria-pressed="true"'));
		const dark = basePage({ themeMode: 'dark' });
		assert.ok(dark.includes('class="wispkit-theme-dark" data-wispkit-theme="dark"'));
	});

	it('Mermaid 主题下拉框：六个常见主题、默认跟随主题，初值可被服务端指定', () => {
		const html = basePage();
		assert.ok(html.includes('id="wispkit-mermaid-theme"'), '工具栏必须有 Mermaid 主题下拉框');
		const values = [...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
		assert.deepStrictEqual(values, ['vscode', 'default', 'forest', 'dark', 'neutral', 'base']);
		assert.ok(
			html.includes('data-wispkit-mermaid-theme="vscode"'),
			'首屏就要把 Mermaid 主题写给前端，避免先按默认主题画一次再跳',
		);
		assert.ok(/<option value="vscode" selected>/.test(html), '默认选中「跟随主题」');
		assert.ok(html.includes('Mermaid'), '下拉框要有可见标签，否则不知道是调什么的');

		const forest = basePage({ mermaidTheme: 'forest' });
		assert.ok(forest.includes('data-wispkit-mermaid-theme="forest"'));
		assert.ok(/<option value="forest" selected>/.test(forest));
		assert.ok(!/<option value="vscode" selected>/.test(forest), '只能有一个选中项');
	});

	it('强制主题的调色板用 !important 覆盖宿主行内变量（否则切换完全无效）', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'markdown.css'), 'utf8');
		for (const selector of ['html.wispkit-theme-light', 'html.wispkit-theme-dark']) {
			assert.ok(css.includes(selector), `CSS 缺少 ${selector}`);
		}
		assert.ok(/html\.wispkit-theme-light\s*\{[^}]*color-scheme:\s*light/.test(css), '浅色要声明 color-scheme，原生滚动条/表单控件才跟着变');
		assert.ok(/html\.wispkit-theme-dark\s*\{[^}]*color-scheme:\s*dark/.test(css));
		assert.ok(css.includes('--vscode-editor-background: #ffffff !important'), '浅色背景变量');
		assert.ok(css.includes('--vscode-editor-background: #1e1e1e !important'), '深色背景变量');
		assert.ok(
			css.includes(".wispkit-theme-option[aria-pressed='true']"),
			'三态选中态只看 aria-pressed（脚本只改属性，不碰 class）',
		);
	});

	it('段落编辑模式所需元素齐备，保存按钮默认隐藏', () => {
		const html = basePage();
		for (const id of ['wispkit-main', 'wispkit-content', 'wispkit-save', 'wispkit-dirty', 'wispkit-editor-toggle']) {
			assert.ok(html.includes(`id="${id}"`), `缺少元素 ${id}`);
		}
		assert.ok(/id="wispkit-save"[^>]*hidden/.test(html), '保存按钮默认隐藏，进编辑模式才出现');
	});

	it('分栏编辑已被移除（回归红线：用户不认可左右分栏）', () => {
		const html = basePage();
		for (const id of ['wispkit-editor', 'wispkit-editor-splitter']) {
			assert.ok(!html.includes(`id="${id}"`), `${id} 不应该再存在 —— 段落就地编辑取代了分栏`);
		}
		assert.ok(!html.includes('wispkit-editor-splitter'), '分栏分隔条也不能残留');
	});

	it('排版变量按内置语义注入：fontSize 带 px，lineHeight 原样（数字=字号倍数）', () => {
		const html = basePage({ typography: { fontFamily: 'Consolas, monospace', fontSize: 14, lineHeight: '1.6' } });
		assert.ok(html.includes('--markdown-font-size:14px'));
		assert.ok(html.includes('--markdown-line-height:1.6'));
		assert.ok(html.includes('--markdown-font-family:Consolas, monospace'));
		assert.ok(
			!html.includes('--markdown-line-height:1.6px'),
			'lineHeight 是字号倍数（内置 documentRenderer.ts:213 不加单位）；拼上 px 会变成 1.6 像素行高，整页文字连同目录一起重叠',
		);
	});

	it('排版字段缺省时整条不注入，交给 markdown.css 的 var(..., 22px) 兜底', () => {
		const html = basePage({ typography: {} });
		assert.ok(!html.includes('--markdown-line-height'));
		assert.ok(!html.includes('--markdown-font-size'));
		assert.ok(!html.includes('style=""'), '没有可注入的变量时不应产生空的 style 属性');
	});
});

/* ---------------------------------------------------------------- 段落映射纯函数 */

const paragraph = loadMediaModule('media/shared/paragraph.js');
const {
	countLines,
	fenceSpanInRange,
	findBlockSpan,
	mapBlocksToSpans,
	paragraphSpans,
	replaceParagraph,
	replaceParagraphVerbatim,
	sliceParagraph,
	sliceParagraphVerbatim,
} = paragraph;

/** 造一个只有 `getAttribute` / `parentElement` 的假元素，用来测纯逻辑（不需要真 DOM）。 */
function fakeBlock(line: number | null, parent: any = null): any {
	return {
		parentElement: parent,
		getAttribute: (name: string) => (name === 'data-line' && line !== null ? String(line) : null),
		hasAttribute: (name: string) => name === 'data-line' && line !== null,
	};
}

describe('media/shared/paragraph.js 段落↔源码行映射', () => {
	it('首段从第 0 行开始，末段延伸到文件末尾', () => {
		assert.deepStrictEqual(paragraphSpans([0, 2, 4], 5), [
			{ startLine: 0, endLine: 2 },
			{ startLine: 2, endLine: 4 },
			{ startLine: 4, endLine: 5 },
		]);
	});

	it('段落之间的空行归前一段（结束行取下一个块的起始行）', () => {
		// 源码 "# A\n\n正文\n\n\n尾" —— 第 1 段吃掉它后面的空行，第 2 段吃两行空行
		assert.deepStrictEqual(paragraphSpans([0, 2], 6), [
			{ startLine: 0, endLine: 2 },
			{ startLine: 2, endLine: 6 },
		]);
	});

	it('单段文件覆盖整篇', () => {
		assert.deepStrictEqual(paragraphSpans([0], 3), [{ startLine: 0, endLine: 3 }]);
	});

	it('没有块时返回空数组', () => {
		assert.deepStrictEqual(paragraphSpans([], 10), []);
		assert.deepStrictEqual(paragraphSpans(undefined, 10), []);
	});

	it('data-line 缺失（null / NaN）时该项为 null，但不影响其它项的区间', () => {
		const spans = paragraphSpans([0, null, 3], 5);
		assert.strictEqual(spans.length, 3, '必须与入参等长，否则 DOM 与区间会错位');
		assert.deepStrictEqual(spans[0], { startLine: 0, endLine: 3 });
		assert.strictEqual(spans[1], null);
		assert.deepStrictEqual(spans[2], { startLine: 3, endLine: 5 });
	});

	it('重复的起始行共享同一区间（嵌套块不会把一段切碎）', () => {
		const spans = paragraphSpans([0, 0, 3], 6);
		assert.deepStrictEqual(spans[0], spans[1]);
		assert.deepStrictEqual(spans[2], { startLine: 3, endLine: 6 });
	});

	it('倒退的起始行不会产生负长度区间', () => {
		for (const span of paragraphSpans([5, 2, 9], 10)) {
			assert.ok(span!.endLine >= span!.startLine, `区间不能倒挂：${JSON.stringify(span)}`);
		}
	});

	it('越界的起始行被夹进 [0, totalLines]', () => {
		assert.deepStrictEqual(paragraphSpans([-3, 99], 5), [
			{ startLine: 0, endLine: 5 },
			{ startLine: 5, endLine: 5 },
		]);
	});

	it('totalLines 为 0 时区间收敛到 0 长度', () => {
		assert.deepStrictEqual(paragraphSpans([0, 0], 0), [
			{ startLine: 0, endLine: 0 },
			{ startLine: 0, endLine: 0 },
		]);
	});

	it('countLines 与 split 语义一致（空串算 1 行）', () => {
		assert.strictEqual(countLines(''), 1);
		assert.strictEqual(countLines('a'), 1);
		assert.strictEqual(countLines('a\n'), 2);
		assert.strictEqual(countLines('a\nb'), 2);
	});
});

describe('media/shared/paragraph.js 取原文与写回', () => {
	it('sliceParagraph 取出该段原文，并剥掉段尾的分隔空行', () => {
		assert.strictEqual(sliceParagraph(SOURCE, { startLine: 0, endLine: 2 }), '# A');
		assert.strictEqual(sliceParagraph(SOURCE, { startLine: 2, endLine: 4 }), '第二段');
		assert.strictEqual(sliceParagraph(SOURCE, { startLine: 4, endLine: 5 }), '- 项');
	});

	it('改一段不会吃掉段间空行（否则整篇段落会挤在一起）', () => {
		const next = replaceParagraph(SOURCE, { startLine: 0, endLine: 2 }, '# A 改');
		assert.strictEqual(next, ['# A 改', '', '第二段', '', '- 项'].join('\n'));
	});

	it('原样写回是恒等操作（切片—替换往返不改源码）', () => {
		const spans = paragraphSpans([0, 2, 4], countLines(SOURCE));
		for (const span of spans) {
			const round = replaceParagraph(SOURCE, span!, sliceParagraph(SOURCE, span!));
			assert.strictEqual(round, SOURCE, `区间 ${JSON.stringify(span)} 往返后源码变了`);
		}
	});

	it('只改目标段，其余段落逐字不变', () => {
		const next = replaceParagraph(SOURCE, { startLine: 2, endLine: 4 }, '第三段');
		assert.strictEqual(next, ['# A', '', '第三段', '', '- 项'].join('\n'));
		assert.ok(next.startsWith('# A\n'), '首段不受影响');
		assert.ok(next.endsWith('- 项'), '末段不受影响');
	});

	it('替换成多行文本时行数随之增长，且不吞掉相邻段', () => {
		const next = replaceParagraph(SOURCE, { startLine: 2, endLine: 4 }, '第一行\n第二行');
		assert.strictEqual(next, ['# A', '', '第一行', '第二行', '', '- 项'].join('\n'));
	});

	it('替换成空文本等于删掉这一段', () => {
		const span = { startLine: 0, endLine: 2 };
		assert.strictEqual(replaceParagraph(SOURCE, span, ''), ['', '第二段', '', '- 项'].join('\n'));
	});

	it('区间非法时安全退化（不改源码 / 返回空串）', () => {
		assert.strictEqual(replaceParagraph(SOURCE, null, 'x'), SOURCE);
		assert.strictEqual(sliceParagraph(SOURCE, null), '');
		assert.strictEqual(replaceParagraph(SOURCE, { startLine: 2, endLine: 2 }, ''), SOURCE, '零长度区间替换空串应当无变化');
	});
});

describe('media/shared/paragraph.js 块元素筛选', () => {
	it('只取最外层块：嵌套块（列表项）被过滤掉', () => {
		const outer = fakeBlock(4);
		const inner = fakeBlock(4, outer);
		const items = mapBlocksToSpans([outer, inner], 6);
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].element, outer);
		assert.deepStrictEqual(items[0].span, { startLine: 4, endLine: 6 });
	});

	it('没有 data-line 的元素被跳过，且不影响其它块', () => {
		const withLine = fakeBlock(1);
		const without = fakeBlock(null);
		const items = mapBlocksToSpans([without, withLine], 4);
		assert.strictEqual(items.length, 1);
		assert.deepStrictEqual(items[0].span, { startLine: 1, endLine: 4 });
	});

	it('findBlockSpan 能从段落内部节点往上找到所属块', () => {
		const block = fakeBlock(2);
		const text = { parentElement: block, getAttribute: () => null };
		const items = mapBlocksToSpans([block], 5);
		assert.strictEqual(findBlockSpan(items, text)?.element, block);
		assert.strictEqual(findBlockSpan(items, { parentElement: null }), null);
	});

	/**
	 * 末段边界的**精确值**断言。区间是左闭右开 `[start, end)`，所以「末段覆盖到第 N 行」
	 * 要求 `endLine === N`（不是 `N - 1`）—— 差一行的症状是编辑最后一段时丢掉最后一行。
	 */
	it('末段的结束行等于源码总行数，最后一行必须落在区间内', () => {
		const source = 'para one\n\npara two\n\npara three';
		const total = countLines(source);
		assert.strictEqual(total, 5);

		const items = mapBlocksToSpans([fakeBlock(0), fakeBlock(2), fakeBlock(4)], total);
		const last = items[items.length - 1];
		assert.deepStrictEqual(last.span, { startLine: 4, endLine: 5 });
		assert.strictEqual(sliceParagraph(source, last.span), 'para three', '末段取原文时不能少最后一行');
	});

	/**
	 * 内置**预览页**的 `renderBody` 会在正文末尾追加 `<div class="code-line" data-line="lineCount">`；
	 * 我们走 `markdown.api.render`（`() => engine.render(text).html`）拿不到它。
	 * 这条同时钉住两件事：① 即便哨兵出现，末段边界依然是 `lineCount`（结果与没有哨兵时一致）；
	 * ② 哨兵覆盖 `[lineCount, lineCount)` 零行，不该进映射表（否则点它会开出空编辑框）。
	 */
	it('末尾哨兵块（起始行 = 总行数）不改变末段边界，也不进映射表', () => {
		const source = 'a\n\nb';
		const total = countLines(source);
		assert.strictEqual(total, 3);

		const items = mapBlocksToSpans([fakeBlock(0), fakeBlock(2), fakeBlock(total)], total);
		assert.strictEqual(items.length, 2, '哨兵覆盖 0 行，不该进映射表');
		assert.deepStrictEqual(items[1].span, { startLine: 2, endLine: 3 });
		assert.strictEqual(sliceParagraph(source, items[1].span), 'b');
	});
});

/* ---------------------------------------------------------------- 前端：段落就地编辑 */

interface SetupPageOptions {
	/** 服务端写进 `<html data-wispkit-theme>` 的初始模式。 */
	themeMode?: 'light' | 'auto' | 'dark';
	/** 模拟 webview 宿主已经写在 body 上的明暗类别。 */
	hostThemeKind?: string;
	/** 模拟 Chromium 105+ 的 CSS Custom Highlight API（jsdom 没有）。 */
	highlightApi?: boolean;
}

/** 用真实生成的页面装进 jsdom，再执行真实的前端模块（storage 走宿主 state 这条回退通路）。 */
function setupMarkdownView(
	initialState: Record<string, string> = {},
	bodyHtml: string = BODY_HTML,
	page: SetupPageOptions = {},
) {
	const dom = installDom(basePage({ bodyHtml, themeMode: page.themeMode }));
	if (page.hostThemeKind) {
		dom.window.document.body.classList.add(page.hostThemeKind);
		dom.window.document.body.dataset.vscodeThemeKind = page.hostThemeKind;
	}
	let highlightRegistry: Map<string, any> | null = null;
	if (page.highlightApi) {
		// 真实 Chromium 里 CSS.highlights 是 HighlightRegistry（有 set/get/delete），
		// Highlight 构造器接收若干 Range。这里的替身只保留测试需要的表面。
		highlightRegistry = new Map<string, any>();
		(dom.window.CSS as any).highlights = {
			set: (name: string, value: any) => highlightRegistry!.set(name, value),
			get: (name: string) => highlightRegistry!.get(name),
			delete: (name: string) => highlightRegistry!.delete(name),
		};
		(dom.window as any).Highlight = class {
			constructor(...ranges: any[]) {
				(this as any).ranges = ranges;
			}
		};
	}
	const state = { ...initialState };
	const messages: any[] = [];
	(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
		postMessage: (message: any) => { messages.push(message); },
		getState: () => state,
		setState: (next: Record<string, string>) => {
			Object.assign(state, next);
		},
	});
	loadMediaModule('media/markdown.js');

	return {
		dom,
		doc: dom.window.document,
		state,
		messages,
		api: (dom.window as unknown as { __wispkitSelftest: any }).__wispkitSelftest,
		content: dom.window.document.getElementById('wispkit-content')!,
		/** 正文层：缩放与虚拟化都挂在它上面；第三方脚本替换块也发生在这棵树里。 */
		layer: dom.window.document.getElementById('wispkit-zoom-layer')!,
		highlightRegistry,
		/** 模拟宿主推回消息（只读源码 / 重渲染结果）。 */
		send: (message: any) => {
			dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
		},
		cleanup: () => {
			delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
		},
	};
}

describe('media/markdown.js 段落就地编辑', () => {
	it('进入编辑模式会向宿主索取整篇源码', () => {
		const page = setupMarkdownView();
		try {
			page.api.setEditMode(true);
			assert.ok(page.api.editModeActive());
			assert.ok(page.messages.some(m => m.type === 'wispkit.requestSource'), '必须请求源码，否则拼不出写回文本');
			assert.ok(page.content.classList.contains('wispkit-editing'), '正文要进入编辑态（悬停提示靠它）');
		} finally {
			page.cleanup();
		}
	});

	it('按 data-line 把正文切成与源码对应的段', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			assert.strictEqual(page.api.blockCount(), 3, '三个块（列表项算外层 ul 那一段）');
			assert.deepStrictEqual(page.api.blockSpans(), [
				{ startLine: 0, endLine: 2 },
				{ startLine: 2, endLine: 4 },
				{ startLine: 4, endLine: 5 },
			]);
		} finally {
			page.cleanup();
		}
	});

	it('点某一段：那一段原地变成编辑框，内容是它自己的原文，其余段不动', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);

			const span = page.api.openParagraphAt(1);
			assert.deepStrictEqual(span, { startLine: 2, endLine: 4 }, '点的应当是第 2 段');
			// 编辑框展示区间的**完整原文，含尾随分隔空行** —— 空行看得见才删得掉。
			assert.strictEqual(page.api.paragraphValue(), '第二段\n', '编辑框里必须是这一段在源码里的原文（含尾随空行）');
			assert.strictEqual(page.api.paragraphInputVisible(), true);
			assert.ok(page.doc.querySelector('.wispkit-paragraph-input'), '编辑框要真的挂进文档');

			// 其余段落仍然是渲染后的元素
			assert.ok(page.doc.querySelector('h1[data-line="0"]'), '首段必须保持渲染态');
			assert.ok(page.doc.querySelector('ul[data-line="4"]'), '末段必须保持渲染态');
			assert.strictEqual(page.doc.querySelectorAll('.wispkit-paragraph-input').length, 1, '同一时刻只应有一段在编辑');
		} finally {
			page.cleanup();
		}
	});

	it('提交后只改这一段，并整篇发给宿主保存', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			// 真实编辑是"在原文上改字"，所以写回时尾随的分隔空行仍在：
			// verbatim 语义不再替用户补空行，空行留不留全看编辑框里有没有。
			page.api.typeInParagraph('第三段\n');

			const changed = page.api.commitParagraph();
			assert.strictEqual(changed, true);
			assert.strictEqual(page.api.sourceText(), ['# A', '', '第三段', '', '- 项'].join('\n'));
			assert.strictEqual(page.api.isDirty(), true, '改过就要显示未保存');

			const save = page.messages.filter(m => m.type === 'wispkit.save').pop();
			assert.ok(save, '提交必须触发保存');
			assert.strictEqual(save.text, ['# A', '', '第三段', '', '- 项'].join('\n'), '保存的是整篇源码');
			assert.strictEqual(page.api.paragraphInputVisible(), false, '提交后编辑框要收起来');
		} finally {
			page.cleanup();
		}
	});

	it('内容没变时提交不写盘', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			page.api.typeInParagraph('第二段\n');

			assert.strictEqual(page.api.commitParagraph(), false);
			assert.ok(!page.messages.some(m => m.type === 'wispkit.save'), '无改动不该发保存消息');
			assert.strictEqual(page.api.isDirty(), false);
		} finally {
			page.cleanup();
		}
	});

	it('编辑框里回车写进的是空行（Markdown 里空行才分段），Shift+回车保留软换行', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			const textarea = page.doc.querySelector('.wispkit-paragraph-input') as HTMLTextAreaElement;
			assert.ok(textarea, '编辑框要真的挂进文档');

			const before = textarea.value;
			textarea.selectionStart = before.length;
			textarea.selectionEnd = before.length;

			const enter = new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
			textarea.dispatchEvent(enter);
			assert.strictEqual(
				enter.defaultPrevented,
				true,
				'回车必须被接管 —— 否则只写进一个换行，而 CommonMark 里那是**软换行**，渲染时并回同一段，'
				+ '用户看到的就是「换了行却没渲染效果」',
			);
			assert.strictEqual(textarea.value, `${before}\n\n`, '回车应当补成空行：源码里多一个空行才分得出新段落');

			const afterEnter = textarea.value;
			const shift = new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
			textarea.dispatchEvent(shift);
			assert.strictEqual(shift.defaultPrevented, false, 'Shift+回车要放行，交给浏览器插入单个换行（Markdown 软换行）');
			assert.strictEqual(textarea.value, afterEnter, 'Shift+回车不由我们改文本');
		} finally {
			page.cleanup();
		}
	});

	it('回车分段后提交，写回的源码里是空行分隔（而不是单换行）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			const textarea = page.doc.querySelector('.wispkit-paragraph-input') as HTMLTextAreaElement;
			textarea.value = '第二段第一行\n\n第二段第二行\n';

			assert.strictEqual(page.api.commitParagraph(), true);
			const saved = page.messages.filter(m => m.type === 'wispkit.save').pop();
			assert.ok(saved, '有改动就必须发保存消息');
			assert.deepStrictEqual(
				saved.text.split('\n').slice(0, 5),
				['# A', '', '第二段第一行', '', '第二段第二行'],
				'两行之间必须是**独立空行**，渲染出来才是两个 <p>（单个换行只会并回同一段）',
			);
		} finally {
			page.cleanup();
		}
	});

	it('取消（Esc）丢弃改动，源码不变', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			page.api.typeInParagraph('写坏了');

			assert.strictEqual(page.api.cancelParagraph(), true);
			assert.strictEqual(page.api.sourceText(), SOURCE, '取消后源码必须原封不动');
			assert.ok(!page.messages.some(m => m.type === 'wispkit.save'));
			assert.ok(page.doc.querySelector('p[data-line="2"]'), '取消后原段落要回到文档里');
		} finally {
			page.cleanup();
		}
	});

	it('点另一段时先提交上一段', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			page.api.typeInParagraph('第二段改过\n');
			page.api.openParagraphAt(2);

			assert.strictEqual(page.api.sourceText(), ['# A', '', '第二段改过', '', '- 项'].join('\n'));
			assert.deepStrictEqual(page.api.openSpan(), { startLine: 4, endLine: 5 }, '现在编辑的应当是末段');
			assert.strictEqual(page.api.paragraphValue(), '- 项');
		} finally {
			page.cleanup();
		}
	});

	it('退出编辑模式会先提交当前段', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(0);
			page.api.typeInParagraph('# A 改\n');
			page.api.setEditMode(false);

			assert.strictEqual(page.api.editModeActive(), false);
			assert.strictEqual(page.api.sourceText(), ['# A 改', '', '第二段', '', '- 项'].join('\n'));
		} finally {
			page.cleanup();
		}
	});

	it('重渲染回推时保留滚动位置（改一段不该被弹回文首）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.content.scrollTop = 480;

			page.send({ type: 'wispkit.update', bodyHtml: BODY_HTML, source: '# A\n\n第二段\n\n- 项' });

			assert.strictEqual(page.content.scrollTop, 480, '整篇重建后滚动位置必须还原');
		} finally {
			page.cleanup();
		}
	});

	it('没有正在编辑的段时接受宿主推回的源码（外部改动能被看到）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setEditMode(true);
			page.send({ type: 'wispkit.update', bodyHtml: BODY_HTML, source: '外部改过\n' });
			assert.strictEqual(page.api.sourceText(), '外部改过\n');
		} finally {
			page.cleanup();
		}
	});

	it('Esc 取消当前段的修改（键盘路径）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			page.api.typeInParagraph('写坏了');
			const textarea = page.doc.querySelector('.wispkit-paragraph-input')!;
			textarea.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

			assert.strictEqual(page.api.sourceText(), SOURCE);
			assert.strictEqual(page.api.paragraphInputVisible(), false);
			assert.ok(page.doc.querySelector('p[data-line="2"]'), '取消后原段落要回到文档里');
		} finally {
			page.cleanup();
		}
	});

	it('Ctrl+Enter 提交当前段（键盘路径）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			page.api.typeInParagraph('第三段\n');
			const textarea = page.doc.querySelector('.wispkit-paragraph-input')!;
			textarea.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));

			assert.strictEqual(page.api.sourceText(), ['# A', '', '第三段', '', '- 项'].join('\n'));
			assert.ok(page.messages.some(m => m.type === 'wispkit.save'), 'Ctrl+Enter 必须触发保存');
			assert.strictEqual(page.api.paragraphInputVisible(), false);
		} finally {
			page.cleanup();
		}
	});

	it('保存失败时显示原因并保持未保存状态', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			page.api.typeInParagraph('第三段');
			page.api.commitParagraph();

			const requestId = page.messages.filter(m => m.type === 'wispkit.save').pop().requestId;
			page.send({ type: 'wispkit.saveResult', requestId, ok: false, error: '磁盘只读' });

			assert.strictEqual(page.api.isDirty(), true, '保存失败必须保持脏');
			assert.ok(page.api.dirtyText().includes('磁盘只读'), `未保存标记要带原因，实际为 "${page.api.dirtyText()}"`);
		} finally {
			page.cleanup();
		}
	});
});

describe('media/markdown.js 目录栏位置', () => {
	it('默认在右侧', () => {
		const page = setupMarkdownView();
		try {
			assert.strictEqual(page.api.tocSide(), 'right');
			assert.ok(page.doc.getElementById('wispkit-layout')!.classList.contains('wispkit-toc-right'));
		} finally {
			page.cleanup();
		}
	});

	it('点按钮切到左侧：类名与按钮文案一起变', () => {
		const page = setupMarkdownView();
		try {
			const layout = page.doc.getElementById('wispkit-layout')!;
			const button = page.doc.getElementById('wispkit-toc-side')!;

			button.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));

			assert.strictEqual(page.api.tocSide(), 'left');
			assert.ok(layout.classList.contains('wispkit-toc-left'));
			assert.ok(
				!layout.classList.contains('wispkit-toc-right'),
				'切到左侧后不能还留着右侧类名 —— 拖拽方向看的就是它',
			);
			assert.strictEqual(button.textContent, '目录靠右');
		} finally {
			page.cleanup();
		}
	});

	it('位置跨会话记住', () => {
		const first = setupMarkdownView();
		try {
			first.api.toggleTocSide();
			assert.strictEqual(first.state['wispkit.toc.side'], 'left');
		} finally {
			first.cleanup();
		}

		const second = setupMarkdownView({ 'wispkit.toc.side': 'left' });
		try {
			assert.strictEqual(second.api.tocSide(), 'left');
			assert.ok(second.doc.getElementById('wispkit-layout')!.classList.contains('wispkit-toc-left'));
		} finally {
			second.cleanup();
		}
	});
});

describe('markdown/theme 主题模式', () => {
	it('只认 light / auto / dark，其余（含大小写变体）一律回落到跟随主题', () => {
		assert.strictEqual(DEFAULT_MARKDOWN_THEME_MODE, 'auto');
		for (const mode of ['light', 'auto', 'dark'] as const) {
			assert.strictEqual(normalizeMarkdownThemeMode(mode), mode);
		}
		for (const bad of [undefined, null, '', 'Light', 'system', 'vscode-dark', 0, 1, {}, []]) {
			assert.strictEqual(normalizeMarkdownThemeMode(bad), 'auto', `非法值 ${JSON.stringify(bad)} 必须回落默认`);
		}
	});
});

describe('media/markdown.js 主题三态', () => {
	it('默认选中第二个（跟随主题），不改动宿主写的 body 明暗类别', () => {
		const page = setupMarkdownView({}, BODY_HTML, { hostThemeKind: 'vscode-dark' });
		try {
			assert.strictEqual(page.api.themeMode(), 'auto');
			assert.strictEqual(page.api.themeChecked(), 'auto');
			assert.strictEqual(page.api.themeOptionCount(), 3);
			const root = page.doc.documentElement;
			assert.ok(root.classList.contains('wispkit-theme-auto'));
			assert.ok(!root.classList.contains('wispkit-theme-light'));
			assert.ok(!root.classList.contains('wispkit-theme-dark'));
			assert.ok(page.doc.body.classList.contains('vscode-dark'), '跟随主题时 body 类别归宿主所有');
			assert.strictEqual(page.messages.filter(m => m.type === 'wispkit.setTheme').length, 0, '首屏不该主动上报');
		} finally {
			page.cleanup();
		}
	});

	it('点左侧图标 = 强制浅色：html 类、按钮选中态、body 明暗类别一起变，并上报宿主', () => {
		const page = setupMarkdownView({}, BODY_HTML, { hostThemeKind: 'vscode-dark' });
		try {
			page.doc.querySelector('[data-theme-mode="light"]')!
				.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));

			assert.strictEqual(page.api.themeMode(), 'light');
			assert.strictEqual(page.api.themeChecked(), 'light');
			assert.ok(page.doc.documentElement.classList.contains('wispkit-theme-light'));
			assert.ok(!page.doc.documentElement.classList.contains('wispkit-theme-auto'));
			assert.ok(page.doc.body.classList.contains('vscode-light'), '内置 markdown.css 与 mermaid 都按 body 类别取色');
			assert.ok(!page.doc.body.classList.contains('vscode-dark'), '不能同时留着深色类别');
			assert.deepStrictEqual(
				page.messages.filter(m => m.type === 'wispkit.setTheme').pop(),
				{ type: 'wispkit.setTheme', mode: 'light' },
				'必须上报宿主，才能落盘并同步到其它 Markdown 标签页',
			);
		} finally {
			page.cleanup();
		}
	});

	it('点右侧图标 = 强制深色', () => {
		const page = setupMarkdownView({}, BODY_HTML, { hostThemeKind: 'vscode-light' });
		try {
			page.doc.querySelector('[data-theme-mode="dark"]')!
				.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));

			assert.strictEqual(page.api.themeMode(), 'dark');
			assert.strictEqual(page.api.themeChecked(), 'dark');
			assert.ok(page.doc.documentElement.classList.contains('wispkit-theme-dark'));
			assert.ok(page.doc.body.classList.contains('vscode-dark'));
			assert.ok(!page.doc.body.classList.contains('vscode-light'));
		} finally {
			page.cleanup();
		}
	});

	it('切回中间 = 跟随主题：撤掉强制调色板，并把 body 类别还原成宿主当前主题', () => {
		const page = setupMarkdownView({}, BODY_HTML, { hostThemeKind: 'vscode-dark' });
		try {
			page.api.setThemeMode('light');
			assert.ok(page.doc.body.classList.contains('vscode-light'));

			page.api.setThemeMode('auto');
			assert.strictEqual(page.api.themeMode(), 'auto');
			assert.strictEqual(page.api.themeChecked(), 'auto');
			assert.ok(page.doc.documentElement.classList.contains('wispkit-theme-auto'));
			assert.ok(!page.doc.documentElement.classList.contains('wispkit-theme-light'));
			assert.ok(page.doc.body.classList.contains('vscode-dark'), '还原成宿主真实的深色类别');
			assert.ok(!page.doc.body.classList.contains('vscode-light'));
		} finally {
			page.cleanup();
		}
	});

	it('服务端初始为深色时首屏就是深色，并把 body 类别压成深色', () => {
		const page = setupMarkdownView({}, BODY_HTML, { themeMode: 'dark', hostThemeKind: 'vscode-light' });
		try {
			assert.strictEqual(page.api.themeMode(), 'dark');
			assert.strictEqual(page.api.themeChecked(), 'dark');
			assert.ok(page.doc.documentElement.classList.contains('wispkit-theme-dark'));
			assert.ok(page.doc.body.classList.contains('vscode-dark'));
			assert.ok(!page.doc.body.classList.contains('vscode-light'));
		} finally {
			page.cleanup();
		}
	});

	it('宿主广播 wispkit.theme 时其它视图跟着切换，且不回发消息', () => {
		const page = setupMarkdownView();
		try {
			page.send({ type: 'wispkit.theme', mode: 'dark' });

			assert.strictEqual(page.api.themeMode(), 'dark');
			assert.strictEqual(page.api.themeChecked(), 'dark');
			assert.strictEqual(
				page.messages.filter(m => m.type === 'wispkit.setTheme').length,
				0,
				'广播不能再回发，否则多个视图来回打转',
			);
		} finally {
			page.cleanup();
		}
	});

	it('非法模式（含宿主广播）被忽略，保持当前状态', () => {
		const page = setupMarkdownView();
		try {
			page.api.setThemeMode('light');
			page.send({ type: 'wispkit.theme', mode: 'system' });

			assert.strictEqual(page.api.themeMode(), 'light', '非法值不能悄悄切回跟随主题');
			assert.strictEqual(page.api.themeChecked(), 'light');
		} finally {
			page.cleanup();
		}
	});
});

/* ---------------------------------------------------------------- 前端：Mermaid 主题 */

const MERMAID_SOURCE = 'graph TD;\n  A-->B';
const MERMAID_CONFIG_SPAN = '<span id="markdown-mermaid" aria-hidden="true" '
	+ 'data-config="{&quot;lightModeTheme&quot;:&quot;vscode&quot;,&quot;darkModeTheme&quot;:&quot;vscode&quot;,&quot;maxTextSize&quot;:50000}"></span>';

/** 模拟内置 mermaid 扩展渲染后的 DOM：两层 wrapper + 容器里只剩 SVG，源码只在 data 属性里。 */
const RENDERED_MERMAID_BODY = `${MERMAID_CONFIG_SPAN}
<div class="mermaid-wrapper"><div class="mermaid-content">
	<div class="mermaid-wrapper"><div class="mermaid-content">
		<div class="mermaid" id="mermaid-abc" data-vscode-context='{"webviewSection":"mermaid","mermaidSource":"graph TD;\\n  A-->B"}'>
			<svg><text>B</text></svg>
		</div>
	</div></div>
	<div class="mermaid-zoom-controls"></div>
</div></div>
<p data-line="2" class="code-line">正文</p>`;

/** 只记录预览脚本收到的东西，不真的重画（真实脚本在这里会读 textContent 当源码）。 */
function recordMermaidRenders(page: ReturnType<typeof setupMarkdownView>) {
	const events: { sources: string[]; wrappers: number }[] = [];
	page.dom.window.addEventListener('vscode.markdown.updateContent', () => {
		events.push({
			sources: [...page.layer.querySelectorAll('.mermaid')].map(element => element.textContent ?? ''),
			wrappers: page.layer.querySelectorAll('.mermaid-wrapper').length,
		});
	});
	return events;
}

describe('media/markdown.js Mermaid 图表主题', () => {
	it('切换明暗主题时先把已渲染的图还原成源码，否则内置脚本删掉 SVG 后会读到空字符串（空白）', () => {
		const page = setupMarkdownView({}, RENDERED_MERMAID_BODY);
		try {
			const events = recordMermaidRenders(page);
			const before = page.api.mermaidConfigThemes();
			assert.deepStrictEqual(before, { light: 'vscode', dark: 'vscode' });

			page.api.setThemeMode('light');

			assert.strictEqual(events.length, 1, '切换主题要让预览脚本重画一次');
			assert.deepStrictEqual(
				events[0].sources,
				[MERMAID_SOURCE],
				'重画时容器里必须是源码 —— 空白问题的根因就是这里读到了空字符串',
			);
			assert.strictEqual(events[0].wrappers, 0, 'wrapper（含缩放控件）要一并换掉，反复切主题不能层层嵌套');

			const restored = page.layer.querySelectorAll('.mermaid');
			assert.strictEqual(restored.length, 1);
			assert.strictEqual(restored[0].textContent, MERMAID_SOURCE);
			assert.strictEqual(restored[0].id, '', '旧的内容哈希 id 不能留到下一轮（下一次渲染会重新生成）');
			assert.strictEqual(page.layer.querySelectorAll('.mermaid svg').length, 0);
		} finally {
			page.cleanup();
		}
	});

	it('内置脚本解析途中（容器已被清空、源码只在 data 属性里）切主题也能还原', () => {
		const body = `${MERMAID_CONFIG_SPAN}<div class="mermaid" data-vscode-context='{"mermaidSource":"graph LR; X-->Y"}'></div>`;
		const page = setupMarkdownView({}, body);
		try {
			const events = recordMermaidRenders(page);
			page.api.setThemeMode('dark');
			assert.deepStrictEqual(events[0]?.sources, ['graph LR; X-->Y'], '不能因为容器暂时为空就跳过还原');
			assert.strictEqual(page.layer.querySelector('.mermaid')!.textContent, 'graph LR; X-->Y');
		} finally {
			page.cleanup();
		}
	});

	it('下拉框切换 Mermaid 主题：选中项、配置 span、持久化消息一起更新，并触发重画', () => {
		const page = setupMarkdownView({}, RENDERED_MERMAID_BODY);
		try {
			const events = recordMermaidRenders(page);
			assert.strictEqual(page.api.mermaidTheme(), 'vscode', '默认跟随主题');
			assert.strictEqual(page.api.mermaidThemeCount(), 6);

			page.api.setMermaidTheme('forest');

			assert.strictEqual(page.api.mermaidTheme(), 'forest');
			assert.strictEqual(page.api.mermaidThemeValue(), 'forest');
			assert.strictEqual(page.doc.documentElement.dataset.wispkitMermaidTheme, 'forest');
			assert.deepStrictEqual(page.api.mermaidConfigThemes(), { light: 'forest', dark: 'forest' });
			assert.deepStrictEqual(
				page.messages.filter(message => message.type === 'wispkit.setMermaidTheme').pop(),
				{ type: 'wispkit.setMermaidTheme', theme: 'forest' },
				'必须上报宿主，才能落盘并同步到其它 Markdown 标签页',
			);
			assert.strictEqual(events.length, 1, '换主题要重画');
			assert.deepStrictEqual(events[0].sources, [MERMAID_SOURCE], '换主题同样不能把图弄空白');
			const config = JSON.parse(page.doc.getElementById('markdown-mermaid')!.dataset.config!);
			assert.strictEqual(config.maxTextSize, 50000, '其它 Mermaid 配置不能被吞掉');
		} finally {
			page.cleanup();
		}
	});

	it('同值不重画；宿主广播只同步状态、不回发消息', () => {
		const page = setupMarkdownView({}, RENDERED_MERMAID_BODY);
		try {
			const events = recordMermaidRenders(page);
			page.api.setMermaidTheme('dark');
			const messagesAfterClick = page.messages.filter(message => message.type === 'wispkit.setMermaidTheme').length;
			const rendersAfterClick = events.length;

			page.send({ type: 'wispkit.mermaidTheme', theme: 'dark' });
			assert.strictEqual(events.length, rendersAfterClick, '相同主题不重画');
			assert.strictEqual(
				page.messages.filter(message => message.type === 'wispkit.setMermaidTheme').length,
				messagesAfterClick,
				'宿主广播不能再回发，否则多视图来回打转',
			);

			page.send({ type: 'wispkit.mermaidTheme', theme: 'neutral' });
			assert.strictEqual(page.api.mermaidTheme(), 'neutral');
			assert.strictEqual(page.api.mermaidThemeValue(), 'neutral');

			page.send({ type: 'wispkit.mermaidTheme', theme: 'solarized' });
			assert.strictEqual(page.api.mermaidTheme(), 'neutral', '非法主题必须被忽略，不能悄悄回落到默认');
		} finally {
			page.cleanup();
		}
	});

	it('未渲染的 .mermaid 容器（纯源码 / 没装内置扩展）保持原样，不误伤', () => {
		const body = `${MERMAID_CONFIG_SPAN}<div class="mermaid" id="plain">graph LR; X--&gt;Y</div>`;
		const page = setupMarkdownView({}, body);
		try {
			page.api.setMermaidTheme('base');
			const plain = page.doc.getElementById('plain')!;
			assert.strictEqual(plain.textContent, 'graph LR; X-->Y');
			assert.strictEqual(plain.id, 'plain', '没有渲染过的容器连 id 都不该动');
		} finally {
			page.cleanup();
		}
	});
});

/* ------------------------------------------------- 空行 / mermaid / 编辑开关 / 空白 */

describe('media/shared/paragraph.js 空行与围栏定位', () => {
	it('verbatim 切片保留尾随分隔空行（空行要能被看见，才谈得上被删掉）', () => {
		const src = ['# A', '', '正文', '', '', '尾'].join('\n');
		assert.strictEqual(sliceParagraph(src, { startLine: 0, endLine: 2 }), '# A', '旧切片剥掉尾随空行');
		assert.strictEqual(sliceParagraphVerbatim(src, { startLine: 0, endLine: 2 }), '# A\n', 'verbatim 必须留着它');
		assert.strictEqual(sliceParagraphVerbatim(src, { startLine: 2, endLine: 6 }), '正文\n\n\n尾');
	});

	it('verbatim 写回不再补空行：用户删掉的空行真的消失', () => {
		const src = ['# A', '', '正文', '', '- 项'].join('\n');
		const span = { startLine: 2, endLine: 4 };
		assert.strictEqual(
			replaceParagraphVerbatim(src, span, '正文'),
			['# A', '', '正文', '- 项'].join('\n'),
			'verbatim：删了就是删了',
		);
		assert.strictEqual(
			replaceParagraph(src, span, '正文'),
			['# A', '', '正文', '', '- 项'].join('\n'),
			'旧归一化版本会把空行补回来 —— 这正是"空行删不掉"的原因，它保留给别的调用方',
		);
	});

	it('verbatim 写回：原样提交是恒等操作（不改就会走"无需保存"分支）', () => {
		const src = ['# A', '', '正文', '', '', '尾'].join('\n');
		for (const span of [{ startLine: 0, endLine: 2 }, { startLine: 2, endLine: 6 }]) {
			assert.strictEqual(replaceParagraphVerbatim(src, span, sliceParagraphVerbatim(src, span)), src);
		}
	});

	it('verbatim 写回：只改目标段，其余段落逐字不变', () => {
		const src = ['# A', '', '正文', '', '- 项'].join('\n');
		assert.deepStrictEqual(
			replaceParagraphVerbatim(src, { startLine: 2, endLine: 4 }, '改过\n').split('\n'),
			['# A', '', '改过', '', '- 项'],
		);
	});

	it('verbatim 写回：清空编辑框等于删掉这一段（含它的分隔空行）', () => {
		const src = ['# A', '', '正文', '', '- 项'].join('\n');
		assert.deepStrictEqual(
			replaceParagraphVerbatim(src, { startLine: 2, endLine: 4 }, '').split('\n'),
			['# A', '', '', '- 项'],
		);
	});

	it('verbatim 切片/写回：区间非法时安全退化', () => {
		assert.strictEqual(sliceParagraphVerbatim('a\nb', null as any), '');
		assert.strictEqual(sliceParagraphVerbatim(null as any, { startLine: 0, endLine: 1 }), '');
		assert.strictEqual(replaceParagraphVerbatim('a\nb', null as any, 'x'), 'a\nb');
		assert.strictEqual(replaceParagraphVerbatim(null as any, { startLine: 0, endLine: 1 }, 'x'), '');
	});

	it('围栏定位：区间里恰好一段 ``` 时返回它的完整行区间', () => {
		const src = ['# A', '', '```mermaid', 'graph TD', '  A-->B', '```', '', '尾'].join('\n');
		assert.deepStrictEqual(fenceSpanInRange(src, 2, 6), { startLine: 2, endLine: 6 });
	});

	it('围栏定位：区间里有多段围栏时放弃 —— 宁可不动，也不猜错段落把别处代码改坏', () => {
		assert.strictEqual(fenceSpanInRange(['```a', 'x', '```', '```b', 'y', '```'].join('\n'), 0, 6), null);
	});

	it('围栏定位：支持 ~~~，未闭合时取区间末行', () => {
		assert.deepStrictEqual(fenceSpanInRange(['~~~js', 'x', '~~~'].join('\n'), 0, 3), { startLine: 0, endLine: 3 });
		assert.deepStrictEqual(fenceSpanInRange(['```js', 'x'].join('\n'), 0, 2), { startLine: 0, endLine: 2 });
	});

	it('围栏定位：开启行带语言标记，不会被误当闭合行', () => {
		assert.deepStrictEqual(fenceSpanInRange(['```js', 'x', '```'].join('\n'), 0, 3), { startLine: 0, endLine: 3 });
	});

	it('渲染块的起始行判定：围栏开启行与块级公式行算，行内公式所在行与普通行不算', () => {
		const src = ['# A', '', '```mermaid', 'graph TD', '```', '', '$$', 'x=1', '$$', '', '这里有行内公式 $x$', '普通段落'].join('\n');
		assert.strictEqual(paragraph.isRenderedBlockStartLine(src, 2), true, '```mermaid 是会被替换成容器的块的开启行');
		assert.strictEqual(paragraph.isRenderedBlockStartLine(src, 6), true, '块级公式 $$ 也算（katex 会替换它）');
		assert.strictEqual(paragraph.isRenderedBlockStartLine(src, 10), false, '行内公式所在行的行首不是 $$，不该配对');
		assert.strictEqual(paragraph.isRenderedBlockStartLine(src, 11), false, '普通段落不是');
		assert.strictEqual(paragraph.isRenderedBlockStartLine(src, 999), false, '越界返回 false');
		assert.strictEqual(paragraph.isRenderedBlockStartLine(undefined, 2), false, '源码不是字符串时安全退化');
	});

	it('待配对队列的挑选：跳过不是块起始的行，取第一个合法的下标（配不上返回 -1）', () => {
		const src = ['# A', '', '```mermaid', '```', '', '```mermaid', '```'].join('\n');
		assert.strictEqual(paragraph.pickPendingSourceLine(src, [0, 2, 5]), 1, '第 0 行是标题、跳过；第 2 行才是围栏开启行');
		assert.strictEqual(paragraph.pickPendingSourceLine(src, [0, 1]), -1, '队列里没有合法项时返回 -1（宁可不动也不猜）');
		assert.strictEqual(paragraph.pickPendingSourceLine(src, []), -1, '空队列返回 -1');
		assert.strictEqual(paragraph.pickPendingSourceLine(src, null), -1, '非数组安全退化');
	});

	it('围栏定位：没有围栏或区间非法时返回 null', () => {
		assert.strictEqual(fenceSpanInRange('普通文本\n没有围栏', 0, 2), null);
		assert.strictEqual(fenceSpanInRange(null as any, 0, 2), null);
		assert.strictEqual(fenceSpanInRange('a\nb', 2, 1), null);
	});
});

describe('media/markdown.js 空行 / mermaid / 编辑开关', () => {
	it('删掉段尾的空行会真的落盘（"空白的行也能编辑和去除"）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			// 原文该段是 "第二段\n"（含一个分隔空行），用户在编辑框里把它删成一行
			page.api.typeInParagraph('第二段');
			assert.strictEqual(page.api.commitParagraph(), true);
			assert.strictEqual(
				page.api.sourceText(),
				['# A', '', '第二段', '- 项'].join('\n'),
				'删掉的空行不该被补回来',
			);
		} finally {
			page.cleanup();
		}
	});

	it('点 mermaid 块进入它所属段落的编辑（祖先链找不到 data-line 时改用邻居夹区间）', () => {
		const source = ['# A', '', '```mermaid', 'graph TD', '  A-->B', '```', '尾'].join('\n');
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<div class="mermaid"><svg viewBox="0 0 10 10"><text>x</text></svg></div>',
			'<p data-line="6" class="code-line">尾</p>',
		].join('\n'));
		try {
			page.api.setSource(source);
			page.api.setEditMode(true);
			assert.strictEqual(page.api.blockCount(), 3, '取映射表时先把渲染容器缺的 data-line 补齐');

			// 走真实点击路径：mermaid 不在映射表里，没有索引可用，只能靠点击定位。
			// 点的是**容器**（图的外框）而不是内部 svg —— svg 本体在编辑模式下是「放大看图」，
			// 见后面那条测试；容器才是段落编辑的入口。
			const container = page.doc.querySelector('.mermaid')!;
			container.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

			assert.deepStrictEqual(
				page.api.openSpan(),
				{ startLine: 2, endLine: 6 },
				'应当落回那段 ```mermaid 围栏（它的 data-line 被前端脚本替换掉了，只能靠前后邻居夹出区间）',
			);
			assert.strictEqual(page.api.paragraphValue(), '```mermaid\ngraph TD\n  A-->B\n```', '编辑框里是围栏原文');

			// 改完写回，只有这一段变
			page.api.typeInParagraph('```mermaid\ngraph LR\n  A-->B\n```');
			assert.strictEqual(page.api.commitParagraph(), true);
			assert.strictEqual(
				page.api.sourceText(),
				['# A', '', '```mermaid', 'graph LR', '  A-->B', '```', '尾'].join('\n'),
			);
		} finally {
			page.cleanup();
		}
	});

	it('编辑模式下点 mermaid 打开放大预览（改源码时要核对图），不再抢去开编辑框', () => {
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<div class="mermaid"><svg viewBox="0 0 10 10"><text>x</text></svg></div>',
			'<p data-line="6" class="code-line">尾</p>',
		].join('\n'));
		try {
			page.api.setSource(['# A', '', '```mermaid', 'graph TD', '```', '', '尾'].join('\n'));
			page.api.setEditMode(true);
			const svg = page.doc.querySelector('.mermaid svg')!;
			svg.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

			assert.strictEqual(page.api.lightboxOpen(), true, '编辑模式下点 mermaid 应当放大，方便边改边核对');
			assert.strictEqual(page.api.paragraphInputVisible(), false, '不该把图换成源码编辑框');
		} finally {
			page.cleanup();
		}
	});

	it('编辑模式下点 svg 内部元素（如节点文字）同样放大', () => {
		const page = setupMarkdownView({}, [
			'<div class="mermaid"><svg viewBox="0 0 10 10"><text data-line="none">x</text></svg></div>',
		].join('\n'));
		try {
			page.api.setSource(['```mermaid', 'graph TD', '```'].join('\n'));
			page.api.setEditMode(true);
			const text = page.doc.querySelector('.mermaid svg text')!;
			text.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

			assert.strictEqual(page.api.lightboxOpen(), true);
		} finally {
			page.cleanup();
		}
	});

	it('编辑模式下点正文仍然进入段落编辑（放大的只有图）', () => {
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<p data-line="2" class="code-line">正文</p>',
		].join('\n'));
		try {
			page.api.setSource(['# A', '', '正文'].join('\n'));
			page.api.setEditMode(true);
			const p = page.doc.querySelector('p[data-line="2"]')!;
			p.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

			assert.ok(page.api.paragraphInputVisible(), '点正文还是就地编辑');
			assert.strictEqual(page.api.lightboxOpen(), false);
		} finally {
			page.cleanup();
		}
	});

	it('浏览模式点相对链接：原始 href 发给宿主，不交给 webview 外壳', () => {
		const page = setupMarkdownView({}, '<p data-line="0" class="code-line"><a id="rel" href="targets/x.md">x</a></p>');
		try {
			const event = new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
			page.doc.querySelector('#rel')!.dispatchEvent(event);

			assert.strictEqual(event.defaultPrevented, true, '必须阻止默认行为，否则外壳会按 https 打开');
			assert.ok(
				page.messages.some(message => message.type === 'wispkit.openLink' && message.href === 'targets/x.md'),
				'原始 href 必须原样送到宿主（由宿主相对文档位置解析）',
			);
		} finally {
			page.cleanup();
		}
	});

	it('编辑模式点链接不抢：仍然进入段落就地编辑', () => {
		const page = setupMarkdownView({}, '<p data-line="0" class="code-line"><a id="rel" href="targets/x.md">x</a></p>');
		try {
			page.api.setSource('链接段');
			page.api.setEditMode(true);
			page.doc.querySelector('#rel')!.dispatchEvent(
				new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
			);

			assert.strictEqual(page.api.paragraphInputVisible(), true, '编辑模式下点哪里都是改那一段');
			assert.ok(!page.messages.some(message => message.type === 'wispkit.openLink'), '编辑模式不该打开链接');
		} finally {
			page.cleanup();
		}
	});

	it('非编辑模式下点 mermaid 不进编辑（浏览模式语义不变）', () => {
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<div class="mermaid"><svg viewBox="0 0 10 10"><text>x</text></svg></div>',
		].join('\n'));
		try {
			page.api.setSource(['# A', '', '```mermaid', 'graph TD', '```'].join('\n'));
			const svg = page.doc.querySelector('.mermaid svg')!;
			svg.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

			assert.strictEqual(page.api.paragraphInputVisible(), false, '浏览模式不该出现编辑框');
			assert.strictEqual(page.api.isDirty(), false, '也不该产生任何改动');
		} finally {
			page.cleanup();
		}
	});

	/* ---------------------------------------------- 渲染容器丢 data-line 之后的源映射接力 */

	/** MutationObserver 的回调在 microtask 里跑；等一个宏任务保证它已经执行完。 */
	const relaySettled = () => new Promise(resolve => setTimeout(resolve, 0));

	/** 两个 mermaid 块**紧挨着**的源码 —— 「前后邻居夹区间」那条兜底在它上面必然放弃。 */
	const TWO_MERMAID_SOURCE = [
		'# A', '', '```mermaid', 'graph TD', '  A-->B', '```', '',
		'```mermaid', 'graph TD', '  C-->D', '```', '', '尾',
	].join('\n');

	/** 替换前的正文：块级元素都还带着内置引擎写的 `data-line`。 */
	const TWO_MERMAID_BODY = [
		'<h1 data-line="0" class="code-line">A</h1>',
		'<pre data-line="2" class="code-line mermaid">graph TD</pre>',
		'<pre data-line="7" class="code-line mermaid">graph TD</pre>',
		'<p data-line="12" class="code-line">尾</p>',
	].join('\n');

	/** 模拟第三方预览脚本：把原始 `<pre data-line class="code-line">` 整个换成自己的容器。 */
	function renderedContainer(page: ReturnType<typeof setupMarkdownView>) {
		const container = page.doc.createElement('div');
		container.className = 'mermaid';
		container.innerHTML = '<svg viewBox="0 0 10 10"><text>x</text></svg>';
		return container;
	}

	function replaceRenderedBlocks(page: ReturnType<typeof setupMarkdownView>) {
		for (const pre of Array.from(page.doc.querySelectorAll('pre[data-line]'))) {
			pre.replaceWith(renderedContainer(page));
		}
	}

	function clickRenderedBlock(page: ReturnType<typeof setupMarkdownView>, index: number) {
		// 点**容器**（图的外框，源映射接力落在它身上）；svg 本体在编辑模式下是放大看图。
		const container = page.doc.querySelectorAll('.mermaid')[index];
		container?.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	}

	/**
	 * 用户报的正是这一条：「mermaid 在编辑模式点击后没反应应该进入编辑才对」。
	 *
	 * 构造**两个 mermaid 块紧挨着**：此时「用前后邻居夹出源码区间、再在区间里找围栏」那条兜底
	 * 会夹到**两段**围栏，按它「宁可不动也不猜错段落」的约定只能放弃 —— 于是两个都点不开。
	 * 修法是在替换发生时把源映射搬到新容器上，让 `locate` 的第一级（沿祖先链找 `data-line`）
	 * 直接命中，根本不走兜底。
	 */
	it('两个 mermaid 块紧挨着时，两个都能点开并落到各自的源码围栏', async () => {
		const page = setupMarkdownView({}, TWO_MERMAID_BODY);
		try {
			page.api.setSource(TWO_MERMAID_SOURCE);
			page.api.setEditMode(true);
			assert.strictEqual(page.api.blockCount(), 4, '替换前四个块都带着源映射');

			replaceRenderedBlocks(page);
			await relaySettled();

			assert.strictEqual(page.api.blockCount(), 4, '接住源映射后两个容器仍在映射表里');
			assert.deepStrictEqual(page.api.blockSpans(), [
				{ startLine: 0, endLine: 2 },
				{ startLine: 2, endLine: 7 },
				{ startLine: 7, endLine: 12 },
				{ startLine: 12, endLine: 13 },
			], '每个容器拿回的是**自己**那一段的行区间');

			clickRenderedBlock(page, 1);
			assert.deepStrictEqual(
				page.api.openSpan(),
				{ startLine: 7, endLine: 12 },
				'靠后那个 mermaid 必须落到第二段围栏（改前这里是 null：兜底夹到两段围栏只能放弃）',
			);
			// verbatim 切片：区间 `[7, 12)` 含行 11 的那个分隔空行，所以编辑框末尾有一个换行
			// —— 这正是「空行要能被看见、才谈得上被删掉」的设计。
			assert.strictEqual(page.api.paragraphValue(), '```mermaid\ngraph TD\n  C-->D\n```\n', '编辑框里是它自己的围栏原文');
		} finally {
			page.cleanup();
		}
	});

	it('新插入的不是容器本身而是它的祖先时也能接力（容器可能被包一层）', async () => {
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<pre data-line="2" class="code-line mermaid">graph TD</pre>',
			'<p data-line="6" class="code-line">尾</p>',
		].join('\n'));
		try {
			page.api.setSource(['# A', '', '```mermaid', 'graph TD', '```', '', '尾'].join('\n'));
			page.api.setEditMode(true);

			const pre = page.doc.querySelector('pre[data-line]')!;
			const wrapper = page.doc.createElement('div');
			wrapper.innerHTML = '<div class="mermaid"><svg viewBox="0 0 10 10"><text>x</text></svg></div>';
			pre.replaceWith(wrapper);
			await relaySettled();

			assert.strictEqual(
				page.doc.querySelector('.mermaid')!.getAttribute('data-line'),
				'2',
				'容器藏在新增节点的子树里，也要被接住',
			);
		} finally {
			page.cleanup();
		}
	});

	it('第三方脚本「先移除、后插入」分两批发生时也能配对（队列按先后顺序一一对应）', async () => {
		const page = setupMarkdownView({}, TWO_MERMAID_BODY);
		try {
			page.api.setSource(TWO_MERMAID_SOURCE);
			page.api.setEditMode(true);

			const pres = Array.from(page.doc.querySelectorAll('pre[data-line]'));
			const anchors = pres.map(pre => pre.nextSibling);
			pres.forEach(pre => pre.remove());
			await relaySettled();

			pres.forEach((_, index) => {
				page.layer.insertBefore(renderedContainer(page), anchors[index]);
			});
			await relaySettled();

			assert.deepStrictEqual(
				Array.from(page.doc.querySelectorAll('.mermaid')).map(node => node.getAttribute('data-line')),
				['2', '7'],
				'先移除的两条源映射按顺序配给了后插入的两个容器',
			);
		} finally {
			page.cleanup();
		}
	});

	it('首屏就向宿主索取源码（接力校验要用它），不必等到进编辑模式', () => {
		const page = setupMarkdownView();
		try {
			assert.ok(
				page.messages.some(m => m.type === 'wispkit.requestSource'),
				'打开文档就要源码：否则首屏替换掉的 mermaid 块接不住 data-line',
			);
		} finally {
			page.cleanup();
		}
	});

	it('首屏替换的块在源码到达后补上 data-line，前一段不会把整段围栏吞进自己的区间', async () => {
		const source = ['# A', '', '```mermaid', 'graph TD', '```', '', '尾'].join('\n');
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<pre data-line="2" class="code-line mermaid">graph TD</pre>',
			'<p data-line="7" class="code-line">尾</p>',
		].join('\n'));
		try {
			// 首屏：此时 source 还没有（旧实现的 bug 就出在这里）
			replaceRenderedBlocks(page);
			await relaySettled();
			assert.strictEqual(
				page.doc.querySelector('.mermaid')!.getAttribute('data-line'),
				null,
				'源码没到时接力只能放弃 —— 这是前置条件，不是期望结果',
			);

			// 源码到手 → 用邻居夹区间补漏
			page.send({ type: 'wispkit.source', text: source });
			assert.strictEqual(
				page.doc.querySelector('.mermaid')!.getAttribute('data-line'),
				'2',
				'源码到达后必须把行号补到容器上',
			);

			// 关键后果：标题段的区间停在围栏开启行，不会吞掉整张图
			page.api.setEditMode(true);
			page.doc.querySelector('h1')!.dispatchEvent(
				new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
			);
			assert.deepStrictEqual(
				page.api.openSpan(),
				{ startLine: 0, endLine: 2 },
				'点标题只该编辑标题这一段（改前会开出 88 行、装下整张图的编辑框）',
			);
			assert.strictEqual(page.api.paragraphValue(), '# A\n');
		} finally {
			page.cleanup();
		}
	});

	it('宿主重渲染回推之后的替换同样被接住，且重建本身不会被误当成替换', async () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(TWO_MERMAID_SOURCE);
			page.api.setEditMode(true);

			page.send({ type: 'wispkit.update', bodyHtml: TWO_MERMAID_BODY });
			assert.strictEqual(page.api.blockCount(), 4, '重建不应丢掉任何块');
			assert.strictEqual(
				page.api.relayPendingCount?.(),
				0,
				'重建产生的移除事件不是「第三方替换」，不该进待配对队列',
			);

			replaceRenderedBlocks(page);
			await relaySettled();
			assert.strictEqual(page.api.blockCount(), 4, '重建后的替换照样接力');
			assert.deepStrictEqual(
				Array.from(page.doc.querySelectorAll('.mermaid')).map(node => node.getAttribute('data-line')),
				['2', '7'],
			);
		} finally {
			page.cleanup();
		}
	});

	it('行内 katex（span）不参与接力：源映射只交给块级渲染容器，也不给它编造行号', async () => {
		const page = setupMarkdownView({}, [
			'<h1 data-line="0" class="code-line">A</h1>',
			'<p data-line="2" class="code-line">式 <span class="katex">x</span></p>',
			'<pre data-line="3" class="code-line mermaid">graph TD</pre>',
			'<p data-line="6" class="code-line">尾</p>',
		].join('\n'));
		try {
			page.api.setSource(['# A', '', '式 $x$', '```mermaid', 'graph TD', '```', '', '尾'].join('\n'));
			page.api.setEditMode(true);

			// 先只插一个行内 katex 节点：它不是块，也没有源映射，不该被安上行号
			const inline = page.doc.createElement('span');
			inline.className = 'katex';
			page.layer.appendChild(inline);
			await relaySettled();
			assert.strictEqual(inline.getAttribute('data-line'), null, '行内公式不是块，不参与配对');

			// 再插入一个孤立的块级容器：此刻队列里没有待配对的源映射（没有任何块被移除）
			const orphan = renderedContainer(page);
			page.layer.appendChild(orphan);
			await relaySettled();
			assert.strictEqual(
				orphan.getAttribute('data-line'),
				null,
				'没有块被移除就不该凭空给它一个行号 —— 宁可退回邻居兜底，也不猜错段落',
			);
		} finally {
			page.cleanup();
		}
	});

	it('编辑开关是滑动开关：aria-checked 与滑块图标一起变，且文字节点不会抹掉轨道/滑块', () => {
		const page = setupMarkdownView();
		try {
			const toggle = page.doc.getElementById('wispkit-editor-toggle')!;
			assert.strictEqual(toggle.getAttribute('role'), 'switch');
			assert.strictEqual(toggle.getAttribute('aria-checked'), 'false');
			assert.ok(toggle.querySelector('.wispkit-switch-track'), '必须有轨道');
			assert.ok(toggle.querySelector('.wispkit-switch-thumb'), '必须有滑块');
			assert.strictEqual(
				toggle.querySelector('use')!.getAttribute('href'),
				'#wispkit-icon-lock',
				'关闭态 = 锁定图标',
			);

			page.api.setEditMode(true);
			assert.strictEqual(toggle.getAttribute('aria-checked'), 'true', '开态只能靠这一个属性表达');
			assert.strictEqual(toggle.querySelector('use')!.getAttribute('href'), '#wispkit-icon-edit', '开启态 = 编辑图标');
			assert.strictEqual(toggle.querySelector('.wispkit-btn-label')!.textContent, '编辑中');
			assert.ok(toggle.querySelector('.wispkit-switch-track'), '改 label 不能把轨道抹掉');
			assert.ok(toggle.querySelector('.wispkit-switch-thumb'), '改 label 不能把滑块抹掉');

			page.api.setEditMode(false);
			assert.strictEqual(toggle.getAttribute('aria-checked'), 'false');
			assert.strictEqual(toggle.querySelector('use')!.getAttribute('href'), '#wispkit-icon-lock');
			assert.strictEqual(toggle.querySelector('.wispkit-btn-label')!.textContent, '编辑');
		} finally {
			page.cleanup();
		}
	});

	it('工具栏顺序：编辑开关最左，保存/未保存紧随，目录那一组在其后', () => {
		const html = basePage();
		const toolbar = html.slice(html.indexOf('wispkit-toolbar'), html.indexOf('wispkit-layout'));
		let last = -1;
		for (const id of [
			'wispkit-editor-toggle', 'wispkit-dirty', 'wispkit-save',
			'wispkit-sidebar-toggle', 'wispkit-toc-side', 'wispkit-expand-all', 'wispkit-collapse-all',
		]) {
			const index = toolbar.indexOf(`id="${id}"`);
			assert.ok(index > last, `${id} 的位置不对：应当排在上一项之后`);
			last = index;
		}
	});

	it('编辑框高度按内容一次算准（不是先小后跳），且样式表封了上限', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			page.api.openParagraphAt(1);
			const textarea = page.doc.querySelector('.wispkit-paragraph-input') as any;
			assert.ok(textarea.style.height, '打开时就应当设过高度（插入文档后再量）');
			assert.ok(/^\d+px$/.test(textarea.style.height), `高度必须是像素值，实际是 ${textarea.style.height}`);
		} finally {
			page.cleanup();
		}
	});

	it('按钮栏上方空白：padding-top 被压掉，且 sprite 不再生成行盒（两条都真的生效，不只是规则存在）', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'markdown.css'), 'utf8');

		// 规则层面：显式覆盖内置 markdown.css:14-16 的 body{padding-top:1em}
		assert.ok(
			/body\s*\{[^}]*padding-top:\s*0/.test(css),
			'必须显式覆盖内置的 body{padding-top:1em}',
		);

		// 生效层面：把内置表放在前面、我们的表放在后面（与 renderMarkdownPage 拼 <link> 的顺序一致），
		// 让 jsdom 真的做一次层叠计算 —— 只断言"规则文本存在"抓不到被压掉的情况。
		const dom = installDom('<!DOCTYPE html><html><head></head><body></body></html>');
		for (const text of ['body { padding-top: 1em; }', css]) {
			const style = dom.window.document.createElement('style');
			style.textContent = text;
			dom.window.document.head.appendChild(style);
		}
		const body = dom.window.document.body;
		assert.match(
			dom.window.getComputedStyle(body).paddingTop,
			/^0(px)?$/,
			'同特异性下后加载的我们的表必须胜出，body 的 padding-top 要真的是 0',
		);

		// 真正把工具栏顶下去的是 sprite 那个**行盒**：`<svg width="0" height="0">` 是 inline 元素，
		// 即使尺寸为 0 也会在 body 顶部占一个 line-height 高的匿名行盒。
		const sprite = dom.window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		sprite.setAttribute('class', 'wispkit-icon-sprite');
		sprite.setAttribute('width', '0');
		sprite.setAttribute('height', '0');
		body.appendChild(sprite);
		assert.strictEqual(
			dom.window.getComputedStyle(sprite).position,
			'absolute',
			'sprite 必须脱离行内流，否则它在 body 顶部生成一个匿名行盒（这就是那条空白的来源）',
		);
	});
});

describe('md 工具栏：滑块图标居中与保存按钮点击', () => {
	const cssText = fs.readFileSync(path.join(__dirname, '../../media/markdown.css'), 'utf8');

	/** 取某个选择器规则体里的声明原文（只取第一段匹配的 {...}）。 */
	function ruleBody(selector: string): string {
		const start = cssText.indexOf(`${selector} {`);
		assert.ok(start >= 0, `样式表里找不到规则 ${selector}`);
		const open = cssText.indexOf('{', start);
		const close = cssText.indexOf('}', open);
		return cssText.slice(open + 1, close);
	}

	function pxValue(body: string, property: string): number | undefined {
		const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*(-?[\\d.]+)px`).exec(body);
		return match ? Number(match[1]) : undefined;
	}

	/**
	 * 滑块在轨道里**垂直居中** —— 用户的原话是「滑块中的图标偏上导致看起来怪怪的」。
	 *
	 * 这里不检查"某条 CSS 声明是否存在"，而是**算出滑块上下各留多少**再比较：
	 * 只要上下余量不等，无论用什么写法都判红。这样"把 top 写成 0 而轨道比滑块高"
	 * 这类真实的偏移一定逃不掉。
	 */
	it('滑块在轨道内垂直居中：上下余量必须相等（图标偏上的根因）', () => {
		const track = ruleBody('.wispkit-switch-track');
		const thumb = ruleBody('.wispkit-switch-thumb');

		const trackHeight = pxValue(track, 'height');
		const thumbHeight = pxValue(thumb, 'height');
		assert.ok(trackHeight, '轨道必须有明确高度，否则居中无从谈起');
		assert.ok(thumbHeight, '滑块必须有明确高度');

		// 轨道边框：`position: absolute` 的滑块以轨道的 padding box 为基准，
		// 所以上边框要单独算进"上方余量"里，否则会漏掉正好 1px 的偏移。
		const borderMatch = /border:\s*([\d.]+)px/.exec(track);
		const border = borderMatch ? Number(borderMatch[1]) : 0;

		// 两种都能真正居中的写法：百分比 + translateY(-50%)，或显式算出偏移量。
		const centeredByTransform = /top:\s*50%/.test(thumb) && /translateY\(\s*-50%\s*\)/.test(thumb);
		const topOffset = pxValue(thumb, 'top') ?? 0;

		const above = centeredByTransform ? (trackHeight - thumbHeight) / 2 + border : border + topOffset;
		const below = centeredByTransform
			? (trackHeight - thumbHeight) / 2 + border
			: border + (trackHeight - topOffset - thumbHeight);

		assert.strictEqual(
			above,
			below,
			`滑块上下余量不等（上 ${above}px / 下 ${below}px）—— 这就是"图标偏上"的来源；`
			+ `轨道内容高 ${trackHeight}px、滑块 ${thumbHeight}px、边框 ${border}px、top=${centeredByTransform ? '50%' : `${topOffset}px`}`,
		);
		assert.ok(above > 0 || trackHeight === thumbHeight, '滑块不该紧贴边框，居中时上下都应有余量');
	});

	/**
	 * 保存按钮的点击路径。**此前整个测试文件只测过 Ctrl+Enter**（`assert.ok(..., 'Ctrl+Enter 必须触发保存')`），
	 * 没有任何一条点过 `#wispkit-save` —— 用户报的"点保存没反应"正好落在盲区里。
	 * 这条断言端到端跑：进编辑模式 → 改一段 → **点按钮** → 必须发出携带改动文本的 `wispkit.save`。
	 */
	it('点「保存」按钮真的把改动发出去（按钮路径此前从未被覆盖）', () => {
		const page = setupMarkdownView();
		try {
			page.api.setSource(SOURCE);
			page.api.setEditMode(true);
			assert.ok(page.api.openParagraphAt(1), '必须先打开第 1 段');
			page.api.typeInParagraph('改过的第二段');

			const saveButton = page.doc.getElementById('wispkit-save')!;
			assert.strictEqual(saveButton.hidden, false, '编辑模式下保存按钮必须可见，否则用户根本点不到');

			saveButton.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));

			const saved = page.messages.filter(m => m.type === 'wispkit.save').pop();
			assert.ok(saved, '点保存按钮必须发出 wispkit.save');
			assert.ok(String(saved.text).includes('改过的第二段'), '发出去的文本必须包含用户的改动');
		} finally {
			page.cleanup();
		}
	});

	it('非编辑模式下保存按钮不可见（否则点了会被 mode 判断静默吞掉）', () => {
		const page = setupMarkdownView();
		try {
			assert.strictEqual(page.doc.getElementById('wispkit-save')!.hidden, true);
			page.api.setEditMode(true);
			assert.strictEqual(page.doc.getElementById('wispkit-save')!.hidden, false);
			page.api.setEditMode(false);
			assert.strictEqual(page.doc.getElementById('wispkit-save')!.hidden, true, '退出编辑模式后按钮要重新隐藏');
		} finally {
			page.cleanup();
		}
	});
});

describe('util/csp', () => {
	it('script-src 只认 nonce 与 cspSource 规则，不含 unsafe-inline（与内置 Strict 级一致）', () => {
		const csp = strictContentSecurityPolicy(CSP_SOURCE, 'N1');
		assert.ok(csp.startsWith(`default-src 'none';`));
		assert.ok(csp.includes(`script-src 'nonce-N1';`));
		assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
	});

	it('cspSource 只取第一段规则', () => {
		const csp = strictContentSecurityPolicy('vscode-webview://abc; something-else', 'N1');
		assert.ok(csp.includes('vscode-webview://abc'));
		assert.ok(!csp.includes('something-else'));
	});
});

/* ---------------------------------------------------------------- 缩放与查找：页面骨架 */

describe('markdown/page 缩放与查找控件', () => {
	it('工具栏有缩小 / 百分比重置 / 放大三个多级缩放控件', () => {
		const html = basePage();
		for (const id of ['wispkit-zoom-out', 'wispkit-zoom-reset', 'wispkit-zoom-in']) {
			assert.ok(html.includes(`id="${id}"`), `缺少缩放控件 ${id}`);
		}
		assert.ok(/id="wispkit-zoom-reset"[^>]*>100%<\/button>/.test(html), '默认档位显示 100%');
		assert.ok(html.includes('id="wispkit-icon-zoom-in"'), '放大图标必须在 sprite 里');
		assert.ok(html.includes('id="wispkit-icon-zoom-out"'), '缩小图标必须在 sprite 里');
	});

	it('查找栏默认隐藏，包含输入框 / 计数 / 大小写 / 上一个 / 下一个 / 关闭', () => {
		const html = basePage();
		assert.ok(/id="wispkit-find"[^>]*hidden/.test(html), '查找栏初始必须隐藏');
		for (const id of [
			'wispkit-find-input', 'wispkit-find-count', 'wispkit-find-case',
			'wispkit-find-prev', 'wispkit-find-next', 'wispkit-find-close', 'wispkit-find-toggle',
		]) {
			assert.ok(html.includes(`id="${id}"`), `缺少查找控件 ${id}`);
		}
		assert.ok(html.includes('aria-live="polite"'), '命中计数要能被读屏软件播报');
	});

	it('正文包在独立的缩放层里（缩放不能作用在滚动容器上）', () => {
		const html = basePage({ bodyHtml: '<p id="body">x</p>' });
		assert.ok(html.includes('id="wispkit-zoom-layer"'), '必须有缩放层');
		assert.ok(/<div class="wispkit-zoom-layer" id="wispkit-zoom-layer"><p id="body">x<\/p><\/div>/.test(html),
			'正文必须在缩放层内部，缩放只作用于正文');
	});

	it('CSS 定义了大文档虚拟化与关键字高亮', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'markdown.css'), 'utf8');
		assert.ok(css.includes('.wispkit-zoom-layer.wispkit-virtualized > *'), '缺少虚拟化选择器');
		assert.ok(/content-visibility:\s*auto/.test(css), '虚拟化必须用 content-visibility:auto');
		assert.ok(/contain-intrinsic-size:\s*auto/.test(css), '虚拟化必须给估算高度，否则滚动条会乱跳');
		assert.ok(css.includes('::highlight(wispkit-find-match)'), 'CSS 必须给全量高亮配色');
		assert.ok(css.includes('::highlight(wispkit-find-current)'), 'CSS 必须给当前命中单独配色');
		assert.ok(css.includes('.wispkit-find-hit'), '老引擎退回 <mark> 时也要有样式');
	});
});

/* ---------------------------------------------------------------- 缩放：纯函数与前端 */

describe('media/shared/pagezoom', () => {
	const { normalizeZoom, zoomPercent, DEFAULT_ZOOM_LEVELS } = pageZoomPure;

	it('倍率与百分比两种写法都认，并吸附到最近档位', () => {
		assert.strictEqual(normalizeZoom(1.5), 1.5);
		assert.strictEqual(normalizeZoom('1.25'), 1.25);
		assert.strictEqual(normalizeZoom('150%'), 1.5);
		assert.strictEqual(normalizeZoom(150), 1.5);
		assert.strictEqual(normalizeZoom(0.73), 0.7);
		assert.strictEqual(normalizeZoom(0.74), 0.7, '等距时取较小档，避免无厘头跳动');
	});

	it('非法值回落到 100%，超界吸附到最近端', () => {
		for (const bad of [undefined, null, '', 'abc', 0, -1, Number.NaN]) {
			assert.strictEqual(normalizeZoom(bad), 1, `非法值 ${String(bad)} 必须回落 100%`);
		}
		assert.strictEqual(normalizeZoom(500), 3);
		assert.strictEqual(normalizeZoom(0.01), 0.5);
	});

	it('档位表从 50% 到 300%，且包含 100%', () => {
		assert.strictEqual(DEFAULT_ZOOM_LEVELS[0], 0.5);
		assert.strictEqual(DEFAULT_ZOOM_LEVELS[DEFAULT_ZOOM_LEVELS.length - 1], 3);
		assert.ok(DEFAULT_ZOOM_LEVELS.includes(1));
		assert.strictEqual(zoomPercent(1.25), 125);
	});

	it('图块测量按缩放倍率补偿（mermaid 写回的 CSS px 不能被 zoom 二次放大）', () => {
		const dom = installDom('<html><body><div id="layer"><div class="mermaid"></div><p id="text"></p></div></body></html>');
		const doc = dom.window.document;
		const layer = doc.getElementById('layer')!;
		const mermaid = doc.querySelector('.mermaid')!;
		const text = doc.getElementById('text')!;
		const rect = {
			x: 0, y: 50, left: 0, top: 50, width: 200, height: 100, right: 200, bottom: 150,
			toJSON: () => ({}),
		};
		Object.defineProperty(dom.window.Element.prototype, 'getBoundingClientRect', {
			configurable: true,
			value: () => rect,
		});

		const zoom = pageZoomPure.createPageZoom({ target: layer, initial: 2 });
		const diagramRect = mermaid.getBoundingClientRect() as any;
		assert.strictEqual(diagramRect.width, 100, '图块宽度要除以 2');
		assert.strictEqual(diagramRect.height, 50, '图块高度要除以 2');
		assert.strictEqual(diagramRect.top, 50, 'left/top 保持屏幕坐标：mermaid 滚轮锚点要用它减 clientX/clientY');
		assert.strictEqual((text.getBoundingClientRect() as any).width, 200, '普通正文不受影响');

		zoom.reset();
		assert.strictEqual((mermaid.getBoundingClientRect() as any).width, 200, '100% 时不做任何改写');
	});
});

describe('media/markdown.js 正文多级缩放', () => {
	const click = (page: any, id: string) => page.doc.getElementById(id)
		.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true }));

	it('默认 100%，不写内联 zoom（不留下 zoom:1 的额外排版路径）', () => {
		const page = setupMarkdownView();
		try {
			assert.strictEqual(page.api.zoomPercent(), 100);
			assert.strictEqual(page.doc.getElementById('wispkit-zoom-reset')!.textContent, '100%');
			assert.strictEqual(page.layer.style.zoom, '');
		} finally {
			page.cleanup();
		}
	});

	it('点 + 逐级放大、点 − 逐级缩小、点百分比重置，并落盘', () => {
		const page = setupMarkdownView();
		try {
			click(page, 'wispkit-zoom-in');
			assert.strictEqual(page.api.zoomPercent(), 110);
			assert.strictEqual(page.layer.style.zoom, '1.1');
			assert.strictEqual(page.state['wispkit.zoom'], '1.1');

			click(page, 'wispkit-zoom-in');
			assert.strictEqual(page.api.zoomPercent(), 125, '第二级是 125%，多级档位不是每次 +10%');

			click(page, 'wispkit-zoom-out');
			assert.strictEqual(page.api.zoomPercent(), 110);

			click(page, 'wispkit-zoom-reset');
			assert.strictEqual(page.api.zoomPercent(), 100);
			assert.strictEqual(page.layer.style.zoom, '', '100% 时移除内联 zoom');
		} finally {
			page.cleanup();
		}
	});

	it('到上下限后按钮禁用，再点也不越界', () => {
		const page = setupMarkdownView();
		try {
			for (let i = 0; i < 30; i += 1) {
				page.api.zoomIn();
			}
			assert.strictEqual(page.api.zoomPercent(), 300);
			assert.strictEqual((page.doc.getElementById('wispkit-zoom-in') as HTMLButtonElement).disabled, true);
			page.api.zoomIn();
			assert.strictEqual(page.api.zoomPercent(), 300, '上限之外保持 300%');

			for (let i = 0; i < 30; i += 1) {
				page.api.zoomOut();
			}
			assert.strictEqual(page.api.zoomPercent(), 50);
			assert.strictEqual((page.doc.getElementById('wispkit-zoom-out') as HTMLButtonElement).disabled, true);
		} finally {
			page.cleanup();
		}
	});

	it('跨会话记住缩放档位（同一文档再打开仍是上次的比例）', () => {
		const first = setupMarkdownView();
		try {
			first.api.setZoom('150');
			assert.strictEqual(first.state['wispkit.zoom'], '1.5');
		} finally {
			first.cleanup();
		}

		const second = setupMarkdownView({ 'wispkit.zoom': '1.5' });
		try {
			assert.strictEqual(second.api.zoomPercent(), 150);
			assert.strictEqual(second.layer.style.zoom, '1.5');
			assert.strictEqual(second.doc.getElementById('wispkit-zoom-reset')!.textContent, '150%');
		} finally {
			second.cleanup();
		}
	});

	it('非法持久化值不把正文缩成 0 或 NaN', () => {
		for (const stored of ['abc', '0', '-2', 'NaN']) {
			const page = setupMarkdownView({ 'wispkit.zoom': stored });
			try {
				assert.strictEqual(page.api.zoomPercent(), 100, `存储值 ${stored} 必须回落 100%`);
				assert.strictEqual(page.layer.style.zoom, '');
			} finally {
				page.cleanup();
			}
		}
	});

	it('Ctrl+= / Ctrl+- / Ctrl+0 与按钮等价', () => {
		const page = setupMarkdownView();
		try {
			const key = (value: string) => {
				const event = new page.dom.window.KeyboardEvent('keydown', {
					key: value, ctrlKey: true, bubbles: true, cancelable: true,
				});
				page.doc.dispatchEvent(event);
				return event;
			};
			assert.strictEqual(key('=').defaultPrevented, true);
			assert.strictEqual(page.api.zoomPercent(), 110);
			key('-');
			assert.strictEqual(page.api.zoomPercent(), 100);
			key('=');
			key('=');
			assert.strictEqual(page.api.zoomPercent(), 125);
			key('0');
			assert.strictEqual(page.api.zoomPercent(), 100);
		} finally {
			page.cleanup();
		}
	});

	it('Ctrl+滚轮按档位缩放并阻止浏览器默认缩放', () => {
		const page = setupMarkdownView();
		try {
			const event = new page.dom.window.WheelEvent('wheel', {
				deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true,
			});
			page.content.dispatchEvent(event);
			assert.strictEqual(event.defaultPrevented, true);
			assert.strictEqual(page.api.zoomPercent(), 110);

			const down = new page.dom.window.WheelEvent('wheel', {
				deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true,
			});
			page.content.dispatchEvent(down);
			assert.strictEqual(page.api.zoomPercent(), 100);
		} finally {
			page.cleanup();
		}
	});
});

/* ---------------------------------------------------------------- 查找：纯函数与前端 */

describe('media/shared/find 纯函数', () => {
	const { findTextMatches, collectTextSegments } = findPure;

	it('默认不区分大小写，命中互不重叠', () => {
		const found = findTextMatches('Alpha alpha ALPHA', 'alpha');
		assert.deepStrictEqual(found.matches, [
			{ start: 0, end: 5 },
			{ start: 6, end: 11 },
			{ start: 12, end: 17 },
		]);
		assert.strictEqual(found.truncated, false);
	});

	it('区分大小写时只命中大小写完全一致的文本', () => {
		const found = findTextMatches('Alpha alpha ALPHA', 'alpha', { caseSensitive: true });
		assert.deepStrictEqual(found.matches, [{ start: 6, end: 11 }]);
	});

	it('特殊字符按字面量搜索，不当正则元字符', () => {
		const found = findTextMatches('a.b axb a.b', 'a.b');
		assert.deepStrictEqual(found.matches, [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
	});

	it('超过上限时截断并标记 truncated', () => {
		const found = findTextMatches('aaaaa', 'a', { limit: 3 });
		assert.strictEqual(found.matches.length, 3);
		assert.strictEqual(found.truncated, true);
	});

	it('空查询 / 空文本不产生命中', () => {
		assert.deepStrictEqual(findTextMatches('abc', ''), { matches: [], truncated: false });
		assert.deepStrictEqual(findTextMatches('', 'a'), { matches: [], truncated: false });
	});

	it('同一块内被行内标签拆开的文本可以连续命中，跨块不行', () => {
		const dom = installDom('<html><body><div id="root">'
			+ '<p>Hello <strong>World</strong></p><p>second</p>'
			+ '<script>hiddenword</script><svg><text>svgword</text></svg>'
			+ '</div></body></html>');
		const root = dom.window.document.getElementById('root')!;
		const { text } = collectTextSegments(root);
		assert.strictEqual(text, 'Hello World\nsecond', '块之间用换行分隔；script 与 svg 不参与搜索');
		assert.strictEqual(findTextMatches(text, 'Hello World').matches.length, 1);
		assert.strictEqual(findTextMatches(text, 'Worldsecond').matches.length, 0, '跨块不能命中');
		assert.strictEqual(findTextMatches(text, 'hiddenword').matches.length, 0, 'script 内容不能命中');
		assert.strictEqual(findTextMatches(text, 'svgword').matches.length, 0, 'mermaid 等 SVG 文本不参与搜索');
	});
});

const FIND_BODY = [
	'<h1 id="find-h">标题 Alpha</h1>',
	'<p id="find-p1">hello <strong>world</strong> 和 ALPHA</p>',
	'<p id="find-p2">第二步 alpha</p>',
	'<table><tbody><tr><td>alpha cell</td></tr></tbody></table>',
].join('\n');

function keydown(page: any, target: any, key: string, init: Record<string, unknown> = {}) {
	const event = new page.dom.window.KeyboardEvent('keydown', {
		key, bubbles: true, cancelable: true, ...init,
	});
	target.dispatchEvent(event);
	return event;
}

describe('media/markdown.js 正文查找', () => {
	it('Ctrl+F 呼出查找栏并把焦点放进输入框', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			const event = keydown(page, page.doc, 'f', { ctrlKey: true });
			assert.strictEqual(event.defaultPrevented, true);
			assert.strictEqual(page.api.findOpen(), true);
			assert.strictEqual(page.doc.getElementById('wispkit-find')!.hidden, false);
			assert.ok(page.content.classList.contains('wispkit-find-open'), '查找期间要关掉大文档虚拟化，Range 才有布局');
			assert.strictEqual(page.doc.getElementById('wispkit-find-toggle')!.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(page.doc.activeElement?.id, 'wispkit-find-input');
		} finally {
			page.cleanup();
		}
	});

	it('输入关键字后高亮全部命中并显示 1/N 计数', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('alpha');
			assert.strictEqual(page.api.findMatchCount(), 4, 'Alpha / ALPHA / alpha / alpha 共 4 处');
			assert.strictEqual(page.api.findActiveIndex(), 0);
			assert.strictEqual(page.doc.getElementById('wispkit-find-count')!.textContent, '1/4');
			// jsdom 没有 Highlight API，自动走 <mark> 退回路径；四处都在单个文本节点内
			assert.strictEqual(page.api.findUsesHighlightApi(), false);
			assert.strictEqual(page.api.findMarkedCount(), 4);
			assert.strictEqual(page.doc.querySelectorAll('mark.wispkit-find-hit').length, 4);
			assert.ok(page.doc.querySelector('mark.wispkit-find-hit.wispkit-find-current'), '当前命中要单独标出');
		} finally {
			page.cleanup();
		}
	});

	it('下一个 / 上一个循环跳转，计数跟着变', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('alpha');
			assert.strictEqual(page.api.findActiveIndex(), 0);
			page.api.findNext();
			assert.strictEqual(page.api.findActiveIndex(), 1);
			assert.strictEqual(page.doc.getElementById('wispkit-find-count')!.textContent, '2/4');
			page.api.findPrev();
			assert.strictEqual(page.api.findActiveIndex(), 0);
			page.api.findPrev();
			assert.strictEqual(page.api.findActiveIndex(), 3, '第一个再往前要回到最后一个');
			assert.strictEqual(page.doc.getElementById('wispkit-find-count')!.textContent, '4/4');
		} finally {
			page.cleanup();
		}
	});

	it('跳转按命中的 Range 位置滚动正文', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			const rect = (top: number) => ({
				top, left: 0, right: 10, bottom: top + 10, width: 10, height: 10, x: 0, y: top,
				toJSON: () => ({}),
			});
			Object.defineProperty(page.content, 'clientHeight', { value: 400, configurable: true });
			Object.defineProperty(page.content, 'getBoundingClientRect', {
				value: () => rect(100), configurable: true,
			});
			(page.dom.window.Range.prototype as any).getClientRects = () => [rect(500)];

			page.api.setFindQuery('alpha');
			assert.strictEqual(page.content.scrollTop, 300, '命中在视口下方 400px：滚动到距顶部 25% 处');
		} finally {
			page.cleanup();
		}
	});

	it('大小写开关切换后重新搜索', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('alpha');
			assert.strictEqual(page.api.findMatchCount(), 4);
			page.api.setFindCaseSensitive(true);
			assert.strictEqual(page.api.findCaseSensitive(), true);
			assert.strictEqual(page.api.findMatchCount(), 2, '区分大小写后只剩两处小写 alpha');
			assert.strictEqual(page.doc.getElementById('wispkit-find-case')!.getAttribute('aria-pressed'), 'true');
		} finally {
			page.cleanup();
		}
	});

	it('Esc 关闭并清掉高亮，正文恢复原样', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('alpha');
			const input = page.doc.getElementById('wispkit-find-input')!;
			keydown(page, input, 'Escape');
			assert.strictEqual(page.api.findOpen(), false);
			assert.strictEqual(page.doc.getElementById('wispkit-find')!.hidden, true);
			assert.strictEqual(page.api.findMarkedCount(), 0);
			assert.strictEqual(page.doc.querySelectorAll('mark.wispkit-find-hit').length, 0);
			assert.ok(!page.content.classList.contains('wispkit-find-open'));
			assert.strictEqual(page.content.textContent!.includes('Alpha'), true, '清除高亮不能吞掉正文');
		} finally {
			page.cleanup();
		}
	});

	it('Ctrl+F 时用正文里选中的文本预填查询', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			const heading = page.doc.getElementById('find-h')!;
			const selection = page.dom.window.getSelection()!;
			selection.selectAllChildren(heading);
			keydown(page, page.doc, 'f', { ctrlKey: true });

			assert.strictEqual((page.doc.getElementById('wispkit-find-input') as HTMLInputElement).value, '标题 Alpha');
			assert.strictEqual(page.api.findMatchCount(), 1);
		} finally {
			page.cleanup();
		}
	});

	it('跨行内标签的短语能命中（但退回路径不拆开标签包 <mark>）', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('hello world');
			assert.strictEqual(page.api.findMatchCount(), 1, 'Hello <strong>World</strong> 应当能整体命中');
			assert.strictEqual(page.api.findMarkedCount(), 0, '跨文本节点的匹配在退回路径里不包 mark，避免拆坏结构');
			assert.strictEqual(page.doc.getElementById('wispkit-find-count')!.textContent, '1/1');
		} finally {
			page.cleanup();
		}
	});

	it('没有命中时显示 0/0 并标红', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('不存在的词');
			assert.strictEqual(page.api.findMatchCount(), 0);
			assert.strictEqual(page.doc.getElementById('wispkit-find-count')!.textContent, '0/0');
			assert.ok(page.doc.getElementById('wispkit-find-count')!.classList.contains('wispkit-find-empty'));
		} finally {
			page.cleanup();
		}
	});

	it('正文更新后按原查询在新 DOM 上重跑（旧高亮不残留）', () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.setFindQuery('alpha');
			assert.strictEqual(page.api.findMatchCount(), 4);

			page.send({ type: 'wispkit.update', bodyHtml: '<p data-line="0" class="code-line">beta only</p>', source: 'beta only' });
			assert.strictEqual(page.layer.querySelectorAll('mark.wispkit-find-hit').length, 0, '旧 mark 随旧正文一起没了');
			assert.strictEqual(page.api.findMatchCount(), 0);
			assert.strictEqual(page.doc.getElementById('wispkit-find-count')!.textContent, '0/0');

			page.api.setFindQuery('beta');
			assert.strictEqual(page.api.findMatchCount(), 1);
			assert.strictEqual(page.api.findMarkedCount(), 1);
		} finally {
			page.cleanup();
		}
	});

	it('输入框输入走防抖搜索', async () => {
		const page = setupMarkdownView({}, FIND_BODY);
		try {
			page.api.openFind('');
			const input = page.doc.getElementById('wispkit-find-input') as HTMLInputElement;
			input.value = 'alpha';
			input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
			assert.strictEqual(page.api.findMatchCount(), 0, '防抖窗口内还没搜');
			await new Promise(resolve => setTimeout(resolve, 150));
			assert.strictEqual(page.api.findMatchCount(), 4);
		} finally {
			page.cleanup();
		}
	});

	it('有 Highlight API 时只登记 Range、不改 DOM', () => {
		const page = setupMarkdownView({}, FIND_BODY, { highlightApi: true });
		try {
			page.api.setFindQuery('alpha');
			assert.strictEqual(page.api.findUsesHighlightApi(), true);
			assert.strictEqual(page.api.findMarkedCount(), 0);
			assert.strictEqual(page.doc.querySelectorAll('mark.wispkit-find-hit').length, 0, '不能向正文插入 mark');
			assert.ok(page.highlightRegistry, '测试替身必须就位');
			assert.strictEqual(page.highlightRegistry!.get('wispkit-find-match').ranges.length, 4);
			assert.ok(page.highlightRegistry!.has('wispkit-find-current'));

			page.api.findNext();
			assert.ok(page.highlightRegistry!.has('wispkit-find-current'));

			page.api.closeFind();
			assert.strictEqual(page.highlightRegistry!.has('wispkit-find-match'), false);
			assert.strictEqual(page.highlightRegistry!.has('wispkit-find-current'), false);
		} finally {
			page.cleanup();
		}
	});
});

/* ---------------------------------------------------------------- 大文档虚拟化 */

describe('media/markdown.js 大文档虚拟化', () => {
	it('普通文档不开启虚拟化（避免估算高度让滚动条乱跳）', () => {
		const page = setupMarkdownView();
		try {
			assert.strictEqual(page.api.virtualized(), false);
		} finally {
			page.cleanup();
		}
	});

	it('表格 / 图 / 代码块很多的大文档自动开启 content-visibility 虚拟化', () => {
		const body = Array.from({ length: 45 }, (_, i) => (
			`<table data-line="${i * 3}" class="code-line"><tbody><tr><td>row ${i}</td></tr></tbody></table>`
		)).join('');
		const page = setupMarkdownView({}, body);
		try {
			assert.strictEqual(page.api.virtualized(), true);
			assert.ok(page.layer.classList.contains('wispkit-virtualized'));
		} finally {
			page.cleanup();
		}
	});

	it('查找期间临时关闭虚拟化，关闭查找后恢复', () => {
		const body = Array.from({ length: 45 }, (_, i) => (
			`<table data-line="${i * 3}" class="code-line"><tbody><tr><td>row ${i}</td></tr></tbody></table>`
		)).join('');
		const page = setupMarkdownView({}, body);
		try {
			assert.strictEqual(page.api.virtualized(), true);
			page.api.openFind('row');
			assert.ok(page.content.classList.contains('wispkit-find-open'));
			page.api.closeFind();
			assert.ok(!page.content.classList.contains('wispkit-find-open'));
			assert.strictEqual(page.api.virtualized(), true, '虚拟化类仍在，只是查找期间被 CSS 覆盖');
		} finally {
			page.cleanup();
		}
	});

	it('图块不参与虚拟化：mermaid 需要真实布局才能量出 SVG 尺寸', () => {
		const tables = Array.from({ length: 40 }, (_, i) => (
			`<table data-line="${i * 3}" class="code-line"><tbody><tr><td>row ${i}</td></tr></tbody></table>`
		)).join('');
		const mermaid = '<div class="mermaid" data-line="999"><svg viewBox="0 0 10 10"><text>x</text></svg></div>';
		const page = setupMarkdownView({}, tables + mermaid);
		try {
			assert.strictEqual(page.api.virtualized(), true);
			assert.ok(page.layer.querySelector('.mermaid')!.classList.contains('wispkit-virtualize-keep'),
				'图块必须打上不虚拟化标记');
			assert.ok(!page.layer.querySelector('table')!.classList.contains('wispkit-virtualize-keep'),
				'普通表格照常参与虚拟化');
			const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'markdown.css'), 'utf8');
			assert.ok(css.includes('> .wispkit-virtualize-keep'), 'CSS 必须让图块标记覆盖 content-visibility:auto');
		} finally {
			page.cleanup();
		}
	});
});
