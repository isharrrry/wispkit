import * as assert from 'assert';
import { collectMarkdownContributions, hasMarkdownPreviewResources, readPreviewScript } from '../markdown/contributions';

describe('markdown/contributions', () => {
	describe('readPreviewScript', () => {
		it('接受字符串形式，type 为 undefined', () => {
			assert.deepStrictEqual(readPreviewScript('./a.js'), { path: './a.js', type: undefined });
		});

		it('接受 {path,type} 形式，且 type 只认 module', () => {
			assert.deepStrictEqual(readPreviewScript({ path: './a.js', type: 'module' }), { path: './a.js', type: 'module' });
			assert.strictEqual(readPreviewScript({ path: './a.js', type: 'script' })?.type, undefined);
		});

		it('拒绝没有 path 的条目', () => {
			assert.strictEqual(readPreviewScript({ type: 'module' }), undefined);
			assert.strictEqual(readPreviewScript(null), undefined);
			assert.strictEqual(readPreviewScript(42), undefined);
		});
	});

	describe('collectMarkdownContributions', () => {
		it('读扁平点号键 markdown.previewScripts', () => {
			const result = collectMarkdownContributions([
				{
					extensionUri: 'file:///ext/a/',
					packageJson: { contributes: { 'markdown.previewScripts': ['./out/a.js', { path: './out/b.js', type: 'module' }] } },
				},
			]);
			assert.strictEqual(result.scripts.length, 2);
			assert.deepStrictEqual(result.scripts[0], { extensionUri: 'file:///ext/a/', path: './out/a.js', type: undefined, extensionId: undefined });
			assert.strictEqual(result.scripts[1].type, 'module');
		});

		it('不读嵌套形式（真实契约是扁平键，嵌套写法必须读不到）', () => {
			const result = collectMarkdownContributions([
				{
					extensionUri: 'file:///ext/a/',
					packageJson: { contributes: { markdown: { previewScripts: ['./out/a.js'], previewStyles: ['./out/a.css'] } } },
				},
			]);
			assert.strictEqual(result.scripts.length, 0);
			assert.strictEqual(result.styles.length, 0);
		});

		it('保留贡献方 extensionUri，使相对路径可被解析', () => {
			const result = collectMarkdownContributions([
				{ extensionUri: 'file:///ext/one/', packageJson: { contributes: { 'markdown.previewScripts': ['./same.js'] } } },
				{ extensionUri: 'file:///ext/two/', packageJson: { contributes: { 'markdown.previewScripts': ['./same.js'] } } },
			]);
			assert.deepStrictEqual(result.scripts.map(script => script.extensionUri), ['file:///ext/one/', 'file:///ext/two/']);
		});

		it('previewStyles 只接受字符串条目', () => {
			const result = collectMarkdownContributions([
				{
					extensionUri: 'file:///ext/a/',
					packageJson: { contributes: { 'markdown.previewStyles': ['./a.css', { path: './b.css' }, 7] } },
				},
			]);
			assert.deepStrictEqual(result.styles, [{ extensionUri: 'file:///ext/a/', path: './a.css' }]);
		});

		it('真实内置扩展清单（1.137.0：mermaid-markdown-features + markdown-math）', () => {
			const result = collectMarkdownContributions([
				{
					id: 'vscode.mermaid-markdown-features',
					extensionUri: 'file:///app/extensions/mermaid-markdown-features/',
					packageJson: {
						contributes: {
							'markdown.previewScripts': [{ path: './markdown-preview-out/index.js', type: 'module' }],
							'markdown.markdownItPlugins': true,
						},
					},
				},
				{
					extensionUri: 'file:///app/extensions/markdown-math/',
					packageJson: {
						contributes: {
							'markdown.markdownItPlugins': true,
							'markdown.previewStyles': ['./notebook-out/katex.min.css', './preview-styles/index.css'],
						},
					},
				},
				{
					extensionUri: 'file:///app/extensions/git/',
					packageJson: { contributes: { commands: [] } },
				},
				{ extensionUri: 'file:///app/extensions/no-package/', packageJson: undefined },
			]);

			assert.deepStrictEqual(result.scripts, [{
				extensionUri: 'file:///app/extensions/mermaid-markdown-features/',
				path: './markdown-preview-out/index.js',
				type: 'module',
				extensionId: 'vscode.mermaid-markdown-features',
			}]);
			assert.deepStrictEqual(result.styles.map(style => style.path), ['./notebook-out/katex.min.css', './preview-styles/index.css']);
		});

		it('带上贡献方 id，便于按来源过滤（内置预览入口脚本）', () => {
			const result = collectMarkdownContributions([
				{
					id: 'vscode.markdown-language-features',
					extensionUri: 'file:///app/extensions/markdown-language-features/',
					packageJson: { contributes: { 'markdown.previewScripts': ['./media/index.js'] } },
				},
				{
					id: 'vscode.mermaid-markdown-features',
					extensionUri: 'file:///app/extensions/mermaid-markdown-features/',
					packageJson: { contributes: { 'markdown.previewScripts': ['./markdown-preview-out/index.js'] } },
				},
			]);
			assert.deepStrictEqual(result.scripts.map(script => script.extensionId), [
				'vscode.markdown-language-features',
				'vscode.mermaid-markdown-features',
			]);
		});
	});

	describe('hasMarkdownPreviewResources', () => {
		it('有脚本或样式 → true', () => {
			assert.strictEqual(hasMarkdownPreviewResources({ contributes: { 'markdown.previewScripts': ['./a.js'] } }), true);
			assert.strictEqual(hasMarkdownPreviewResources({ contributes: { 'markdown.previewStyles': ['./a.css'] } }), true);
		});

		it('只有 markdownItPlugins → false（它不产生资源根）', () => {
			assert.strictEqual(hasMarkdownPreviewResources({ contributes: { 'markdown.markdownItPlugins': true } }), false);
		});

		it('空数组 → false', () => {
			assert.strictEqual(hasMarkdownPreviewResources({ contributes: { 'markdown.previewScripts': [] } }), false);
		});
	});
});
