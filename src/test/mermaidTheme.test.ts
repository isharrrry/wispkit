import * as assert from 'assert';
import {
	DEFAULT_MARKDOWN_MERMAID_THEME,
	MARKDOWN_MERMAID_THEMES,
	applyMermaidThemeToBodyHtml,
	isMarkdownMermaidTheme,
	normalizeMarkdownMermaidTheme,
} from '../markdown/mermaidTheme';

/** 内置 mermaid-markdown-features 的 markdown-it 插件前置的配置 span（html 属性转义后）。 */
function configSpan(config: Record<string, unknown>): string {
	const json = JSON.stringify(config)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return `<span id="markdown-mermaid" aria-hidden="true" data-config="${json}"></span>`;
}

describe('markdown/mermaidTheme 纯函数', () => {
	it('只认内置 Mermaid 扩展的六个主题名，其余回落到 vscode', () => {
		assert.strictEqual(DEFAULT_MARKDOWN_MERMAID_THEME, 'vscode');
		assert.deepStrictEqual(
			[...MARKDOWN_MERMAID_THEMES],
			['vscode', 'default', 'forest', 'dark', 'neutral', 'base'],
		);
		for (const theme of MARKDOWN_MERMAID_THEMES) {
			assert.strictEqual(isMarkdownMermaidTheme(theme), true);
			assert.strictEqual(normalizeMarkdownMermaidTheme(theme), theme);
		}
		for (const bad of [undefined, null, '', 'Forest', 'system', 'vs-dark', 0, 1, {}, []]) {
			assert.strictEqual(isMarkdownMermaidTheme(bad), false);
			assert.strictEqual(normalizeMarkdownMermaidTheme(bad), 'vscode', `非法值 ${JSON.stringify(bad)} 必须回落`);
		}
	});

	it('同时改写 lightModeTheme / darkModeTheme，其余配置原样保留', () => {
		const html = `<p>前文</p>${configSpan({
			darkModeTheme: 'vscode',
			lightModeTheme: 'vscode',
			maxTextSize: 50000,
			clickDrag: 'alt',
			showControls: 'onHoverOrFocus',
			resizable: true,
			maxHeight: '',
		})}<div class="mermaid">graph TD; A--&gt;B</div>`;
		const patched = applyMermaidThemeToBodyHtml(html, 'forest');

		const match = /data-config="([^"]*)"/.exec(patched);
		assert.ok(match, '配置 span 必须还在');
		const decoded = match![1]
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
		const config = JSON.parse(decoded);
		assert.strictEqual(config.lightModeTheme, 'forest');
		assert.strictEqual(config.darkModeTheme, 'forest');
		assert.strictEqual(config.maxTextSize, 50000, '用户设置的 maxTextSize 不能被吞掉');
		assert.strictEqual(config.clickDrag, 'alt');
		assert.strictEqual(config.showControls, 'onHoverOrFocus');
		assert.strictEqual(config.resizable, true);
		assert.ok(patched.includes('<div class="mermaid">graph TD; A--&gt;B</div>'), '正文不能被误改');
	});

	it('非法主题按 vscode 写入（与内置扩展默认一致）', () => {
		const html = configSpan({ lightModeTheme: 'forest', darkModeTheme: 'forest' });
		const patched = applyMermaidThemeToBodyHtml(html, 'solarized');
		assert.ok(patched.includes('&quot;lightModeTheme&quot;:&quot;vscode&quot;'));
		assert.ok(patched.includes('&quot;darkModeTheme&quot;:&quot;vscode&quot;'));
	});

	it('没有配置 span（未安装内置 Mermaid 扩展）时原样返回', () => {
		const html = '<h1>A</h1><div class="mermaid">graph TD; A--&gt;B</div>';
		assert.strictEqual(applyMermaidThemeToBodyHtml(html, 'dark'), html);
	});

	it('data-config 坏了不猜内容，原样返回', () => {
		const html = '<span id="markdown-mermaid" data-config="{broken"></span>';
		assert.strictEqual(applyMermaidThemeToBodyHtml(html, 'dark'), html);
	});

	it('data-config 不是对象（数组 / 字面量）时原样返回', () => {
		const arrayHtml = '<span id="markdown-mermaid" data-config="[1,2]"></span>';
		assert.strictEqual(applyMermaidThemeToBodyHtml(arrayHtml, 'dark'), arrayHtml);
	});

	it('属性顺序变化、span 带其它属性时仍能识别', () => {
		const html = '<span aria-hidden="true" data-config="{&quot;lightModeTheme&quot;:&quot;vscode&quot;}" id="markdown-mermaid" class="x"></span>';
		const patched = applyMermaidThemeToBodyHtml(html, 'neutral');
		assert.ok(patched.includes('&quot;lightModeTheme&quot;:&quot;neutral&quot;'));
		assert.ok(patched.includes('class="x"'), 'span 的其它属性要保持');
	});
});
