import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MARKDOWN_ICON_NAMES, markdownIconSprite, renderMarkdownPage } from '../markdown/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';

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

	it('图标 sprite 用 currentColor，颜色自动跟随主题', () => {
		const sprite = markdownIconSprite();
		assert.ok(sprite.includes('stroke="currentColor"'), '必须用 currentColor，否则浅/深主题下颜色不对');
		assert.ok(sprite.includes('fill="none"'));
		assert.ok(sprite.includes('width="0"') && sprite.includes('height="0"'), 'sprite 自身不应占位');
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

/** 用真实生成的页面装进 jsdom，再执行真实的前端模块（storage 走宿主 state 这条回退通路）。 */
function setupMarkdownView(initialState: Record<string, string> = {}, bodyHtml: string = BODY_HTML) {
	const dom = installDom(basePage({ bodyHtml }));
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
			assert.strictEqual(page.api.blockCount(), 2, 'mermaid 那块没有 data-line，不在映射表里');

			// 走真实点击路径：mermaid 不在映射表里，没有索引可用，只能靠点击定位
			const svg = page.doc.querySelector('.mermaid svg')!;
			svg.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

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

	it('编辑模式下点 mermaid 优先编辑，不放走浏览行为', () => {
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

			assert.strictEqual(page.api.lightboxOpen(), false, '编辑模式下不该弹出放大预览');
			assert.ok(page.api.paragraphInputVisible(), '而应当进入该段的编辑');
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
		const svg = page.doc.querySelectorAll('.mermaid svg')[index];
		svg?.dispatchEvent(new page.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
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
				page.content.insertBefore(renderedContainer(page), anchors[index]);
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
			page.content.appendChild(inline);
			await relaySettled();
			assert.strictEqual(inline.getAttribute('data-line'), null, '行内公式不是块，不参与配对');

			// 再插入一个孤立的块级容器：此刻队列里没有待配对的源映射（没有任何块被移除）
			const orphan = renderedContainer(page);
			page.content.appendChild(orphan);
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
