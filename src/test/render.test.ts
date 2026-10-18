import * as assert from 'assert';
import { RENDER_COMMAND, renderMarkdownHtml } from '../markdown/render';

describe('markdown/render', () => {
	it('默认把 markdown 源码当字符串传给内置引擎', async () => {
		const calls: unknown[][] = [];
		const result = await renderMarkdownHtml('# hi', async (command, ...args) => {
			calls.push([command, ...args]);
			return '<h1>hi</h1>';
		});

		assert.strictEqual(result.html, '<h1>hi</h1>');
		assert.deepStrictEqual(calls, [[RENDER_COMMAND, '# hi']]);
	});

	it('给了文档对象就原样传对象 —— 内置引擎靠它填 env.currentDocument', async () => {
		const calls: unknown[][] = [];
		const uri = { toString: () => 'file:///d%3A/a/b.md' };
		const input = { uri, getText: () => '# hi' };

		await renderMarkdownHtml('# hi', async (command, ...args) => {
			calls.push([command, ...args]);
			return '';
		}, input);

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0][0], RENDER_COMMAND);
		// 退化成字符串就会让 currentDocument 丢失，drawio 的编辑按钮随之消失
		assert.strictEqual(calls[0][1], input, '必须原样把文档对象传下去');
		assert.strictEqual((calls[0][1] as { uri: unknown }).uri, uri);
	});

	it('内置引擎返回非字符串时报错，而不是静默产出空页面', async () => {
		const result = await renderMarkdownHtml('# hi', async () => 42);
		assert.strictEqual(result.html, '');
		assert.ok(result.error?.includes('非字符串'));
	});

	it('内置引擎抛错时把消息带出来', async () => {
		const result = await renderMarkdownHtml('# hi', async () => {
			throw new Error('engine boom');
		});
		assert.strictEqual(result.error, 'engine boom');
	});
});
