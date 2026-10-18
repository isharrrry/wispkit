import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { detectSyntax, highlightToHtml, MAX_HIGHLIGHT_LENGTH, tokenize, type ReadonlySyntax } from '../readonly/highlight';
import { readonlyBanner, renderGutter, renderReadonlyPage } from '../readonly/page';

function kinds(text: string, syntax: ReadonlySyntax): string[] {
	return tokenize(text, syntax).map(token => token.kind);
}

function tokenTexts(text: string, syntax: ReadonlySyntax): string[] {
	return tokenize(text, syntax).map(token => token.text);
}

describe('readonly/highlight', () => {
	describe('detectSyntax', () => {
		it('按扩展名分到正确的语法族', () => {
			const cases: readonly (readonly [string, ReadonlySyntax])[] = [
				['a.json', 'json'],
				['a.jsonc', 'json'],
				['a.xml', 'xml'],
				['a.csproj', 'xml'],
				['a.yml', 'yaml'],
				['a.yaml', 'yaml'],
				['a.toml', 'ini'],
				['a.properties', 'ini'],
				['a.ts', 'clike'],
				['a.cs', 'clike'],
				['a.cpp', 'clike'],
				['a.css', 'clike'],
				['a.ps1', 'shell'],
				['a.bat', 'shell'],
				['a.sh', 'shell'],
				['a.py', 'python'],
				['a.sql', 'sql'],
				['a.diff', 'diff'],
				['a.patch', 'diff'],
				['a.log', 'text'],
				['a.unknown-ext', 'text'],
			];
			for (const [file, expected] of cases) {
				assert.strictEqual(detectSyntax(file), expected, file);
			}
		});

		it('大小写与完整路径都能处理', () => {
			assert.strictEqual(detectSyntax('C:\\dir\\File.JSON'), 'json');
			assert.strictEqual(detectSyntax('/home/u/SCRIPT.PS1'), 'shell');
		});

		it('没有扩展名的常见文件名', () => {
			assert.strictEqual(detectSyntax('Makefile'), 'shell');
			assert.strictEqual(detectSyntax('.editorconfig'), 'ini');
			assert.strictEqual(detectSyntax('无扩展名'), 'text');
		});
	});

	describe('逐字符还原（行号与正文对齐的前提）', () => {
		const samples: readonly (readonly [string, string])[] = [
			['json', '{\n  "name": "wispkit",\n  "n": 1.5e3,\n  "ok": true\n}\n'],
			['xml', '<?xml version="1.0"?>\n<a b="c"><!-- x --><![CDATA[y]]></a>\n'],
			['yaml', 'key: value\nlist:\n  - 1\n# comment\n'],
			['ini', '[section]\nkey=value ; tail\n'],
			['clike', 'const s = "a\\"b";\n/* block\n   comment */\nint n = 0x1F;\n'],
			['shell', '#!/bin/bash\necho "$HOME" # trailing\n'],
			['python', 'def f():\n    """doc\n    string"""\n    return None\n'],
			['sql', "SELECT * FROM t -- c\nWHERE a = 'x';\n"],
			['diff', 'diff --git a b\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n'],
			['text', '任意文本 <>&\n第二行'],
		];

		for (const [name, sample] of samples) {
			it(`${name}：token 拼接 === 原文`, () => {
				assert.strictEqual(tokenTexts(sample, name as ReadonlySyntax).join(''), sample);
			});
		}

		it('空文本 → 空 token 列表', () => {
			assert.deepStrictEqual(tokenize('', 'clike'), []);
		});

		it('无换行结尾', () => {
			assert.strictEqual(tokenTexts('let a = 1', 'clike').join(''), 'let a = 1');
		});

		it('未闭合的字符串与块注释也能吃掉行尾而不丢字符', () => {
			for (const sample of ['const s = "abc', '/* 没关', 'a < b', 'x = 1 +']) {
				assert.strictEqual(tokenTexts(sample, 'clike').join(''), sample);
			}
		});
	});

	describe('分类正确性', () => {
		it('clike：注释 / 字符串 / 数字 / 关键字', () => {
			assert.deepStrictEqual(kinds('// c', 'clike'), ['comment']);
			assert.deepStrictEqual(kinds('"s"', 'clike'), ['string']);
			assert.deepStrictEqual(kinds('42', 'clike'), ['number']);
			assert.deepStrictEqual(kinds('return', 'clike'), ['keyword']);
			assert.ok(kinds('const x = 1; // t', 'clike').includes('comment'));
			assert.ok(kinds('const x = 1;', 'clike').includes('keyword'));
		});

		it('clike：转义引号不会提前结束字符串', () => {
			const tokens = tokenize('"a\\"b"', 'clike');
			assert.strictEqual(tokens.length, 1);
			assert.strictEqual(tokens[0].kind, 'string');
			assert.strictEqual(tokens[0].text, '"a\\"b"');
		});

		it('python：三引号是一个字符串 token', () => {
			const tokens = tokenize('"""a\nb"""', 'python');
			assert.strictEqual(tokens.length, 1);
			assert.strictEqual(tokens[0].kind, 'string');
			assert.strictEqual(tokens[0].text, '"""a\nb"""');
		});

		it('shell：# 注释与关键字', () => {
			assert.deepStrictEqual(kinds('# note', 'shell'), ['comment']);
			assert.ok(kinds('if true; then', 'shell').includes('keyword'));
		});

		it('json：冒号前的字符串是键名', () => {
			const tokens = tokenize('{"a": 1}', 'json');
			const key = tokens.find(token => token.kind === 'key');
			assert.ok(key, '应该识别出键名');
			assert.strictEqual(key.text, '"a"');
			assert.strictEqual(highlightToHtml('{"a": 1}', 'json').includes('wispkit-hl-key'), true);
		});

		it('yaml：行首 key', () => {
			const tokens = tokenize('name: value', 'yaml');
			assert.strictEqual(tokens[0].kind, 'key');
		});

		it('yaml：值里的 true/false 是关键字而不是键', () => {
			const tokens = tokenize('enabled: true', 'yaml');
			assert.strictEqual(tokens.find(token => token.text === 'true')?.kind, 'keyword');
		});

		it('ini：[section] 与 key=', () => {
			const tokens = tokenize('[server]\nport=8080', 'ini');
			assert.strictEqual(tokens.find(token => token.text === 'port')?.kind, 'key');
			assert.ok(tokens.some(token => token.kind === 'number'));
		});

		it('xml：标签 / 属性 / 字符串 / 注释 / CDATA', () => {
			const tokens = tokenize('<a b="c"><!-- x --><![CDATA[y]]></a>', 'xml');
			const got = tokens.map(token => token.kind);
			assert.ok(got.includes('tag'));
			assert.ok(got.includes('attr'));
			assert.ok(got.includes('string'));
			assert.ok(got.includes('comment'));
		});

		it('sql：-- 注释与关键字', () => {
			assert.deepStrictEqual(kinds('-- c', 'sql'), ['comment']);
			assert.ok(kinds('SELECT 1', 'sql').includes('keyword'));
		});

		it('diff：新增 / 删除 / 文件头分流', () => {
			const tokens = tokenize('+++ b\n--- a\n@@ -1 +1 @@\n-new\n+new\n context', 'diff');
			assert.strictEqual(tokens[0].kind, 'keyword');
			assert.strictEqual(tokens[1].kind, 'keyword');
			assert.strictEqual(tokens[2].kind, 'keyword');
			assert.strictEqual(tokens[3].kind, 'removed');
			assert.strictEqual(tokens[4].kind, 'added');
			assert.strictEqual(tokens[5].kind, 'plain');
		});

		it('text：整体一个 plain token', () => {
			assert.deepStrictEqual(kinds('任意 <>&', 'text'), ['plain']);
		});
	});

	describe('转义安全', () => {
		it('源码里的 < > & 不会变成可执行 HTML', () => {
			const html = highlightToHtml('<script>alert(1)</script> & "x"', 'clike');
			assert.ok(!html.includes('<script>'), '不能出现未转义的 <script>');
			assert.ok(html.includes('&lt;script&gt;'));
			assert.ok(html.includes('&amp;'));
		});

		it('字符串里嵌的标签同样被转义', () => {
			const html = highlightToHtml('const a = "<img src=x onerror=1>";', 'clike');
			assert.ok(!html.includes('<img'), '不能出现未转义的 <img>');
			assert.ok(html.includes('&lt;img'));
		});

		it('注释里的尖括号也被转义', () => {
			const html = highlightToHtml('<!-- <div> -->', 'xml');
			assert.ok(!html.includes('<div>'));
			assert.ok(html.includes('&lt;div&gt;'));
		});

		it('高亮结果的纯文本仍等于原文', () => {
			const source = 'a < b && c > "d" <!-- e -->';
			const html = highlightToHtml(source, 'xml');
			const stripped = html.replace(/<[^>]+>/g, '');
			assert.strictEqual(
				stripped.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
				source,
			);
		});
	});

	describe('大文件退化', () => {
		it('超过阈值 → 单个 plain token', () => {
			const huge = 'a'.repeat(MAX_HIGHLIGHT_LENGTH + 1);
			const tokens = tokenize(huge, 'clike');
			assert.strictEqual(tokens.length, 1);
			assert.strictEqual(tokens[0].kind, 'plain');
		});

		it('阈值以内仍然着色', () => {
			const text = 'const a = 1;\n'.repeat(10);
			assert.ok(tokenize(text, 'clike').some(token => token.kind === 'keyword'));
		});

		it('超长行不会丢字符', () => {
			const line = `const a = "${'x'.repeat(5000)}";`;
			assert.strictEqual(tokenTexts(line, 'clike').join(''), line);
		});
	});
});

describe('readonly/page', () => {
	const options = {
		title: 'sample.ts',
		csp: "default-src 'none';",
		nonce: 'n1',
		text: 'const a = 1;\nconst b = 2;\n',
		totalBytes: 30,
		shownLines: 3,
		truncated: false,
		runtimeScript: 'vscode-webview://x/readonly.js',
		runtimeStyle: 'vscode-webview://x/readonly.css',
	};

	it('行号条数与文本行数一致', () => {
		assert.strictEqual((renderGutter('a\nb\nc').match(/gutter-line/g) ?? []).length, 3);
		// 末尾换行也算一行，与 textarea/pre 的行为一致
		assert.strictEqual((renderGutter('a\n').match(/gutter-line/g) ?? []).length, 2);
		assert.strictEqual((renderGutter('').match(/gutter-line/g) ?? []).length, 1);
	});

	it('页面里同时有行号栏、高亮正文与横幅', () => {
		const html = renderReadonlyPage(options);
		assert.ok(html.includes('class="wispkit-readonly-gutter"'), '行号栏');
		assert.ok(html.includes('id="wispkit-readonly-text"'), '正文');
		assert.ok(html.includes('id="wispkit-readonly-banner"'), '横幅');
		assert.ok(html.includes('id="wispkit-readonly-unlock"'), '解锁按钮');
		assert.ok(html.includes('class="wispkit-hl-keyword"'), '正文应该有高亮 span');
		assert.ok(html.includes('wispkit-readonly-gutter-line'), '行号条目');
	});

	it('正文的纯文本等于原文（不多不少一个字符）', () => {
		const html = renderReadonlyPage(options);
		const match = /<code id="wispkit-readonly-code">([\s\S]*?)<\/code>/.exec(html);
		assert.ok(match, '应该能取到高亮正文');
		const decoded = match[1]
			.replace(/<[^>]+>/g, '')
			.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
		assert.strictEqual(decoded, options.text);
	});

	it('高亮语法由文件名推断', () => {
		const jsonPage = renderReadonlyPage({ ...options, title: 'x.json', text: '{"a": 1}' });
		assert.ok(jsonPage.includes('wispkit-hl-key'), 'json 应识别键名');
		const textPage = renderReadonlyPage({ ...options, title: 'x.log' });
		assert.ok(!textPage.includes('wispkit-hl-keyword'), '纯文本不应着色');
	});

	it('截断提示仍然存在', () => {
		const banner = readonlyBanner({ shownLines: 800, totalBytes: 1_600_000, truncated: true });
		assert.ok(banner.includes('只加载了前 800 行'));
		assert.ok(banner.includes('未加载的部分不会渲染'));
		assert.ok(renderReadonlyPage({ ...options, truncated: true, shownLines: 800, totalBytes: 1_600_000 }).includes('未加载的部分不会渲染'));
	});
});

/** 读 media/readonly.css（编译后测试跑在 out/test 下）。 */
function readReadonlyCss(): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'readonly.css'), 'utf8');
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

describe('readonly/css 对齐契约', () => {
	it('行号栏与正文的 font-family / font-size / line-height 逐项相同', () => {
		const css = readReadonlyCss();
		const gutter = declarations(ruleBody(css, '.wispkit-readonly-gutter'));
		const text = declarations(ruleBody(css, '.wispkit-readonly-text'));
		for (const property of ['font-family', 'font-size', 'line-height']) {
			assert.strictEqual(gutter[property], text[property], `${property} 必须一致，否则行号会串行`);
		}
	});

	it('行号栏与正文的 padding-top 相同（第一条行号才对得上第一行正文）', () => {
		const css = readReadonlyCss();
		const gutterPadding = declarations(ruleBody(css, '.wispkit-readonly-gutter'))['padding'];
		const textPadding = declarations(ruleBody(css, '.wispkit-readonly-text'))['padding'];
		assert.strictEqual(gutterPadding.split(/\s+/)[0], textPadding.split(/\s+/)[0]);
	});

	it('行号不可被选中', () => {
		assert.strictEqual(declarations(ruleBody(readReadonlyCss(), '.wispkit-readonly-gutter'))['user-select'], 'none');
	});

	it('行号栏在横向滚动时留在左边', () => {
		assert.strictEqual(declarations(ruleBody(readReadonlyCss(), '.wispkit-readonly-gutter'))['position'], 'sticky');
	});

	it('所有高亮 class 都在 CSS 里有配色（否则等于没高亮）', () => {
		const css = readReadonlyCss();
		const used = new Set<string>();
		for (const [syntax, sample] of [
			['clike', 'const a = "s" + 1; // c'],
			['json', '{"k": 1}'],
			['xml', '<a b="c"><!-- d --></a>'],
			['diff', '-a\n+b\n@@ x\n--- y'],
		] as readonly (readonly [ReadonlySyntax, string])[]) {
			for (const match of highlightToHtml(sample, syntax).matchAll(/class="(wispkit-hl-[\w-]+)"/g)) {
				used.add(match[1]);
			}
		}
		assert.ok(used.size >= 6, `样本应触发多种 token，实际 ${used.size}`);
		for (const className of used) {
			assert.ok(css.includes(`.${className}`), `CSS 缺少配色规则 ${className}`);
		}
	});
});

/*
 * VS Code 的 webview 外壳会给 `code` 铺一层半透明底
 * （`out/vs/workbench/contrib/webview/browser/pre/index.html:145-151`：
 *  `background-color: var(--vscode-textPreformat-background)`），而它只顺带清了
 * `pre code` 的 padding、没有清 background。我们的 `<code>` 是 inline 且父级
 * `white-space: pre` 跨行，那层底就沿每一行铺开，看起来是「每行一条灰带」。
 * 这两条断言锁住我们那份覆盖规则的存在与取值。
 */
describe('readonly/css 清掉 webview 外壳给 code 铺的行底色', () => {
	it('<code> 的背景被清成透明', () => {
		const rule = declarations(ruleBody(readReadonlyCss(), '.wispkit-readonly-text code'));
		assert.strictEqual(rule['background'], 'transparent', '不清掉就会每行一条半透明灰带');
	});

	it('<code> 的前景显式取编辑器前景（外壳注入的是 textPreformat-foreground）', () => {
		const rule = declarations(ruleBody(readReadonlyCss(), '.wispkit-readonly-text code'));
		assert.strictEqual(rule['color'], 'var(--vscode-editor-foreground, var(--vscode-foreground))');
	});

	it('覆盖规则的前提成立：页面结构确实是 <pre class="wispkit-readonly-text"><code>', () => {
		const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'readonly', 'page.ts'), 'utf8');
		assert.ok(
			page.includes('<pre class="wispkit-readonly-text"'),
			'若结构变了（例如改成逐行 <div>），这条覆盖与上面两条断言都需要重写',
		);
		assert.ok(page.includes('<code id="wispkit-readonly-code">'));
	});

	it('覆盖的优先级够：选择器带 .wispkit-readonly-text 前缀，压得过外壳的裸 code', () => {
		assert.ok(readReadonlyCss().includes('.wispkit-readonly-text code {'));
	});
});
