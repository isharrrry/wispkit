import * as assert from 'assert';
import { fileUriFromPath, rewriteVscodeFileLink, rewriteVscodeFileLinksInHtml } from '../util/linkRewrite';

function decodeArgs(command: string): unknown[] {
	const encoded = command.slice('command:vscode.open?'.length);
	return JSON.parse(decodeURIComponent(encoded)) as unknown[];
}

describe('util/linkRewrite', () => {
	describe('fileUriFromPath', () => {
		it('Windows 盘符路径', () => {
			assert.strictEqual(fileUriFromPath('d:\\a\\b.md'), 'file:///d:/a/b.md');
		});

		it('POSIX 路径', () => {
			assert.strictEqual(fileUriFromPath('/home/links/a.md'), 'file:///home/links/a.md');
		});

		it('编码空格与中文，但保留 : 与 /', () => {
			assert.strictEqual(fileUriFromPath('d:\\a b\\中文.md'), 'file:///d:/a%20b/%E4%B8%AD%E6%96%87.md');
		});

		it('编码 # 与 ?（避免被当成 fragment/query）', () => {
			assert.strictEqual(fileUriFromPath('d:\\a#b.md'), 'file:///d:/a%23b.md');
		});
	});

	describe('rewriteVscodeFileLink', () => {
		it('带行号 → command:vscode.open 且 selection 行号是 0 基', () => {
			const command = rewriteVscodeFileLink('vscode://file/d:/a/b.md:207');
			assert.ok(command, '应当改写出 command 链接');
			assert.ok(command!.startsWith('command:vscode.open?'));

			const args = decodeArgs(command!);
			assert.strictEqual(args.length, 2);
			assert.strictEqual(args[0], 'file:///d:/a/b.md');
			assert.deepStrictEqual(args[1], {
				selection: {
					start: { line: 206, character: 0 },
					end: { line: 206, character: 0 },
				},
			});
		});

		it('不带行号 → 只传资源', () => {
			const command = rewriteVscodeFileLink('vscode://file/d:/a/b.md');
			assert.ok(command);
			const args = decodeArgs(command!);
			assert.strictEqual(args.length, 1);
			assert.strictEqual(args[0], 'file:///d:/a/b.md');
		});

		it('行号 1 也是合法输入', () => {
			const args = decodeArgs(rewriteVscodeFileLink('vscode://file/d:/a/b.md:1')!);
			assert.strictEqual((args[1] as any).selection.start.line, 0);
		});

		it('非 vscode://file 形式 → undefined（调用方保持原样）', () => {
			assert.strictEqual(rewriteVscodeFileLink('https://example.com'), undefined);
			assert.strictEqual(rewriteVscodeFileLink('vscode://command/foo'), undefined);
			assert.strictEqual(rewriteVscodeFileLink('./relative.md'), undefined);
		});
	});

	describe('rewriteVscodeFileLinksInHtml', () => {
		it('只改 href 属性，正文里的同样字符串不动', () => {
			const html = '<a href="vscode://file/d:/a/b.md:5">打开</a><code>vscode://file/d:/a/b.md:5</code>';
			const result = rewriteVscodeFileLinksInHtml(html);
			assert.ok(result.includes('href="command:vscode.open?'));
			assert.ok(result.includes('<code>vscode://file/d:/a/b.md:5</code>'), '正文里的字符串不应被改写');
		});

		it('单引号 href 也能改', () => {
			const result = rewriteVscodeFileLinksInHtml("<a href='vscode://file/d:/a/b.md:5'>x</a>");
			assert.ok(result.includes("href='command:vscode.open?"));
		});

		it('非 file 的 vscode:// 链接保持不变', () => {
			const html = '<a href="vscode://command/workbench.action.reloadWindow">reload</a>';
			assert.strictEqual(rewriteVscodeFileLinksInHtml(html), html);
		});

		it('多个链接全部改写', () => {
			const html = '<a href="vscode://file/d:/a.md:1">1</a><a href="vscode://file/d:/b.md:2">2</a>';
			const result = rewriteVscodeFileLinksInHtml(html);
			assert.strictEqual(result.match(/command:vscode\.open\?/g)?.length, 2);
		});
	});
});
