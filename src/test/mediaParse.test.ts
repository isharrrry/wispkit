import * as assert from 'assert';
import { decodeDataUri, findMediaSource, isAbsoluteTarget, isRemoteTarget, targetSegments } from '../media/parse';

describe('media/parse', () => {
	describe('图片', () => {
		const MD = [
			'# title',
			'![first](./a.png)',
			'text',
			'<img src="./b.png" alt="second">',
			'![third](https://x/c.png "标题")',
		].join('\n');

		it('按索引取出原始 markdown 片段与路径', () => {
			assert.strictEqual(findMediaSource(MD, 'image', 0)?.text, '![first](./a.png)');
			assert.strictEqual(findMediaSource(MD, 'image', 0)?.target, './a.png');
		});

		it('内联 <img> 与 markdown 图片按出现顺序统一编号', () => {
			assert.strictEqual(findMediaSource(MD, 'image', 1)?.target, './b.png');
			assert.strictEqual(findMediaSource(MD, 'image', 2)?.target, 'https://x/c.png');
		});

		it('title 不会被当成路径的一部分', () => {
			assert.strictEqual(findMediaSource(MD, 'image', 2)?.text, '![third](https://x/c.png "标题")');
		});

		it('尖括号包裹的路径去掉尖括号', () => {
			assert.strictEqual(findMediaSource('![a](<./x y.png>)', 'image', 0)?.target, './x y.png');
		});

		it('索引错位时用 alt 救回', () => {
			assert.strictEqual(findMediaSource(MD, 'image', 99, 'second')?.target, './b.png');
		});

		it('越界且没有 alt 时返回 undefined', () => {
			assert.strictEqual(findMediaSource(MD, 'image', 99), undefined);
		});

		it('没有图片时返回 undefined', () => {
			assert.strictEqual(findMediaSource('纯文字', 'image', 0), undefined);
		});
	});

	describe('mermaid', () => {
		const MD = [
			'前言',
			'',
			'```mermaid',
			'graph TD;',
			'  A-->B;',
			'```',
			'',
			'```js',
			'const a = 1;',
			'```',
			'',
			'```mermaid',
			'pie',
			'```',
		].join('\n');

		it('只数 mermaid 围栏，body 不含围栏', () => {
			assert.strictEqual(findMediaSource(MD, 'mermaid', 0)?.body, 'graph TD;\n  A-->B;');
			assert.strictEqual(findMediaSource(MD, 'mermaid', 1)?.body, 'pie');
		});

		it('原始片段含围栏本身', () => {
			assert.strictEqual(findMediaSource(MD, 'mermaid', 1)?.text, '```mermaid\npie\n```');
		});

		it('别的语言不算 mermaid', () => {
			assert.strictEqual(findMediaSource(MD, 'mermaid', 2), undefined);
		});

		it('波浪围栏同样识别', () => {
			assert.strictEqual(findMediaSource('~~~mermaid\nflowchart LR\n~~~', 'mermaid', 0)?.body, 'flowchart LR');
		});

		it('正文里出现 mermaid 字样不算代码块', () => {
			assert.strictEqual(findMediaSource('这里说到 mermaid 这个词', 'mermaid', 0), undefined);
		});
	});

	describe('drawio', () => {
		const MD = [
			'```drawio',
			'<mxfile id="1"/>',
			'```',
			'',
			'<!-- drawio:start -->',
			'<mxfile id="2"/>',
			'<!-- drawio:end -->',
		].join('\n');

		it('代码块与注释块按出现顺序统一编号', () => {
			assert.strictEqual(findMediaSource(MD, 'drawio', 0)?.body, '<mxfile id="1"/>');
			assert.strictEqual(findMediaSource(MD, 'drawio', 1)?.body, '<mxfile id="2"/>');
		});

		it('注释块的原始片段保留首尾标记（回写时按它定位）', () => {
			const text = findMediaSource(MD, 'drawio', 1)?.text ?? '';
			assert.ok(text.startsWith('<!-- drawio:start -->'), text);
			assert.ok(text.endsWith('<!-- drawio:end -->'), text);
		});
	});

	describe('decodeDataUri', () => {
		it('base64 数据', () => {
			assert.strictEqual(decodeDataUri('data:image/png;base64,aGk=')?.toString('utf8'), 'hi');
		});

		it('非 base64 走 URL 解码', () => {
			assert.strictEqual(decodeDataUri('data:image/svg+xml,%3Csvg%2F%3E')?.toString('utf8'), '<svg/>');
		});

		it('非法输入返回 undefined', () => {
			assert.strictEqual(decodeDataUri('https://x/a.png'), undefined);
		});
	});

	describe('路径判定', () => {
		it('识别绝对路径', () => {
			assert.strictEqual(isAbsoluteTarget('D:\\a\\b.png'), true);
			assert.strictEqual(isAbsoluteTarget('/home/a.png'), true);
			assert.strictEqual(isAbsoluteTarget('./a.png'), false);
		});

		it('识别带协议的地址', () => {
			assert.strictEqual(isRemoteTarget('data:image/png;base64,AA'), true);
			assert.strictEqual(isRemoteTarget('https://x/a.png'), true);
			assert.strictEqual(isRemoteTarget('./a.png'), false);
		});

		it('拆段时丢掉当前目录段、保留父目录段、解出转义', () => {
			assert.deepStrictEqual(targetSegments('./a/b.png'), ['a', 'b.png']);
			assert.deepStrictEqual(targetSegments('../x.png'), ['..', 'x.png']);
			assert.deepStrictEqual(targetSegments('a%20b/c.png'), ['a b', 'c.png']);
			assert.deepStrictEqual(targetSegments('a/b.png?v=2'), ['a', 'b.png']);
		});
	});
});
