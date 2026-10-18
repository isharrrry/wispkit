import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 三个用户反馈缺陷的防回归断言。
 *
 * 注意：这里刻意用"读样式表/脚本源码"的方式断言契约（与 `xamlPage.test.ts:499-523`
 * 对对齐契约的做法一致），因为 jsdom 不做布局、不绘制层叠，无法验证"谁盖住谁"。
 * 所以这些断言锁的是**修复的结构性条件**，不是像素观感。
 */

function readMedia(file: string): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', 'media', file), 'utf8');
}

function ruleBody(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`);
	assert.ok(start >= 0, `找不到规则 ${selector}`);
	return css.slice(start, css.indexOf('}', start));
}

function declarations(body: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of body.split('\n')) {
		const match = /^\s*([a-z-]+)\s*:\s*([^;]+);/.exec(line);
		if (match) {
			result[match[1]] = match[2].trim();
		}
	}
	return result;
}

describe('xaml 缺陷1：源码区多余的背景色', () => {
	it('源码区背景 == 编辑器背景', () => {
		const pane = declarations(ruleBody(readMedia('xaml.css'), '.wispkit-xaml-code-pane'));
		assert.strictEqual(pane['background'], 'var(--vscode-editor-background)');
	});

	it('整份样式表不再把 textCodeBlock-background 用作背景（注释里提到不算）', () => {
		const declarationsOnly = readMedia('xaml.css')
			.split('\n')
			.filter(line => {
				const trimmed = line.trim();
				return !trimmed.startsWith('/*') && !trimmed.startsWith('*');
			})
			.join('\n');
		assert.ok(
			!declarationsOnly.includes('textCodeBlock-background'),
			'代码区背景不能再取 textCodeBlock-background',
		);
	});
});

describe('xaml 缺陷2：选中后前景=背景、看不见内容', () => {
	const css = () => readMedia('xaml.css');

	it('高亮层叠在 textarea 之上', () => {
		const highlight = declarations(ruleBody(css(), '.wispkit-xaml-highlight'));
		assert.strictEqual(highlight['z-index'], '1', '高亮层必须在上层，否则不透明选区会盖住文字');
	});

	it('textarea 文字透明（真正显示的是高亮层）', () => {
		const editor = declarations(ruleBody(css(), '.wispkit-xaml-editor'));
		assert.strictEqual(editor['color'], 'transparent');
	});

	it('textarea 不能反过来压在高亮层之上', () => {
		const editor = declarations(ruleBody(css(), '.wispkit-xaml-editor'));
		assert.ok(!('z-index' in editor), 'textarea 不应有 z-index');
	});

	it('高亮层背景透明，光标准确可见（否则光标会被自己的层盖住）', () => {
		const highlight = declarations(ruleBody(css(), '.wispkit-xaml-highlight'));
		assert.strictEqual(highlight['background'], 'transparent');
	});
});

describe('xaml 缺陷3：收纳右侧后渲染区仍占位', () => {
	it('CSS 里有"收纳右侧时源码区撑满整行"的规则', () => {
		const rule = declarations(ruleBody(readMedia('xaml.css'), ".wispkit-xaml-layout[data-layout='code'] .wispkit-xaml-code-pane"));
		assert.strictEqual(rule['flex'], '1 1 auto', '必须允许源码区吃掉让出的空间');
		assert.strictEqual(rule['width'], 'auto', '必须覆盖固定像素宽');
	});

	it('脚本在收纳右侧时清掉行内宽度（行内 style 优先级高于样式表，只改 CSS 不够）', () => {
		const js = readMedia('xaml.js');
		assert.ok(
			js.includes("layoutMode === 'code' ? '' :"),
			'applyCodeWidth 必须在 code 模式清空 width，否则 flex:0 0 auto 会把空间空在那儿',
		);
	});

	it('脚本把当前布局写进 data-layout，供上面的 CSS 选择', () => {
		assert.ok(readMedia('xaml.js').includes('layout.dataset.layout = layoutMode'));
	});
});

/*
 * 缺陷4：代码区每行都有一层半透明灰底。
 *
 * 根因不在本扩展的样式表里 —— 是 VS Code 的 webview 外壳给 `code` 铺了一层
 * `--vscode-textPreformat-background`（半透明灰）：
 *   out/vs/workbench/contrib/webview/browser/pre/index.html:145-151
 *     code { color: var(--vscode-textPreformat-foreground);
 *            background-color: var(--vscode-textPreformat-background); padding: 1px 3px; }
 *     pre code { padding: 0; }        ← 只清了 padding，没清 background
 *
 * 高亮层是 `<pre class="wispkit-xaml-highlight"><code>…</code></pre>`，
 * `<code>` 是 inline 且父级 `white-space: pre` 跨多行 → 背景沿**每一行的行盒**铺开。
 * `.wispkit-xaml-highlight` 自己的 `background: transparent` 只作用于 `<pre>`，管不到 `<code>`。
 */
describe('xaml 缺陷4：代码区每行的半透明灰底', () => {
	it('<code> 的背景被清成透明', () => {
		const rule = declarations(ruleBody(readMedia('xaml.css'), '.wispkit-xaml-highlight code'));
		assert.strictEqual(rule['background'], 'transparent', '不清掉就会每行一条半透明灰带');
	});

	it('<code> 的前景显式取编辑器前景，而不是 inherit', () => {
		const rule = declarations(ruleBody(readMedia('xaml.css'), '.wispkit-xaml-highlight code'));
		assert.strictEqual(rule['color'], 'var(--vscode-editor-foreground, var(--vscode-foreground))');
	});

	it('覆盖规则的前提成立：页面模板里高亮层是 <pre><code> 结构', () => {
		const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'xaml', 'page.ts'), 'utf8');
		assert.ok(
			page.includes('<pre class="wispkit-xaml-highlight"'),
			'若高亮层不再是 <pre>，这条覆盖与上面两条断言都需要重写',
		);
		assert.ok(page.includes('<code id="wispkit-xaml-highlight-code">'));
	});

	it('高亮层自身的 transparent 不能替代这个覆盖（那只是 <pre>，不是 <code>）', () => {
		const highlight = declarations(ruleBody(readMedia('xaml.css'), '.wispkit-xaml-highlight'));
		assert.strictEqual(highlight['background'], 'transparent');
		assert.ok(readMedia('xaml.css').includes('.wispkit-xaml-highlight code {'), '必须另有一条针对 <code> 的规则');
	});
});
