import * as assert from 'assert';
import { normalizeFsPath, resolveLinkTarget, toFsPath } from '../util/linkTarget';

const WINDOWS_DOC = '/d:/AllData/demo/R5-jump/03-markdown-links.md';
const POSIX_DOC = '/home/user/docs/03-markdown-links.md';

function file(href: string, documentPath = WINDOWS_DOC, root?: string) {
	const target = resolveLinkTarget(href, documentPath, root);
	assert.strictEqual(target.kind, 'file', `${href} 应解析成本地文件，实际 ${target.kind}`);
	return { path: target.path, line: target.line };
}

describe('util/linkTarget 路径归一化', () => {
	it('统一反斜杠、折叠 . 与 ..、盘符小写', () => {
		assert.strictEqual(normalizeFsPath('D:\\a\\b\\..\\c'), 'd:/a/c');
		assert.strictEqual(normalizeFsPath('/d:/a//./b/../c'), 'd:/a/c');
		assert.strictEqual(normalizeFsPath('/home/a/../b'), '/home/b');
	});

	it('保留 UNC 前缀与 POSIX 根', () => {
		assert.strictEqual(normalizeFsPath('\\\\server\\share\\dir\\x.md'), '//server/share/dir/x.md');
		assert.strictEqual(normalizeFsPath('/home/x'), '/home/x');
	});

	it('URI path 的 /d: 前缀可剥掉', () => {
		assert.strictEqual(toFsPath('/d:/a/b.md'), 'd:/a/b.md');
		assert.strictEqual(toFsPath('/home/a.md'), '/home/a.md', 'POSIX 路径不能被误剥');
	});
});

describe('util/linkTarget 相对链接', () => {
	it('相对当前文档目录解析', () => {
		assert.deepStrictEqual(file('targets/target-simple.md'), {
			path: 'd:/AllData/demo/R5-jump/targets/target-simple.md',
			line: undefined,
		});
	});

	it('../ 可以穿出当前目录', () => {
		assert.strictEqual(file('../assets/images/checker.png').path, 'd:/AllData/demo/assets/images/checker.png');
	});

	it('中文与空格（未编码）照常工作', () => {
		assert.strictEqual(file('targets/目标 中文空格.md').path, 'd:/AllData/demo/R5-jump/targets/目标 中文空格.md');
	});

	it('百分号编码先解码再拼路径', () => {
		assert.strictEqual(
			file('targets/%E7%9B%AE%E6%A0%87%20%E4%B8%AD%E6%96%87%E7%A9%BA%E6%A0%BC.md:9').path,
			'd:/AllData/demo/R5-jump/targets/目标 中文空格.md',
		);
	});

	it('反斜杠写法与正斜杠等价', () => {
		assert.strictEqual(file('targets\\deep\\nested\\target-deep.md').path, 'd:/AllData/demo/R5-jump/targets/deep/nested/target-deep.md');
	});

	it('query 不进文件名，fragment 里的 #L 行号生效', () => {
		assert.deepStrictEqual(file('other.md?raw=1#L5'), {
			path: 'd:/AllData/demo/R5-jump/other.md',
			line: 5,
		});
	});

	it('普通 fragment（标题锚点）不影响文件解析', () => {
		assert.deepStrictEqual(file('other.md#某个标题'), {
			path: 'd:/AllData/demo/R5-jump/other.md',
			line: undefined,
		});
	});

	it('Windows 绝对路径与 POSIX 文档上的绝对路径', () => {
		assert.strictEqual(file('D:\\work\\a.md').path, 'd:/work/a.md');
		assert.strictEqual(file('/etc/hosts', POSIX_DOC).path, '/etc/hosts');
	});

	it('UNC 路径', () => {
		assert.strictEqual(file('\\\\server\\share\\a.md').path, '//server/share/a.md');
	});

	it('没有文档路径（untitled:）时相对链接直接忽略，不编造磁盘根路径', () => {
		assert.strictEqual(resolveLinkTarget('a.md', '').kind, 'ignore');
	});
});

describe('util/linkTarget / 开头的工作区根相对链接', () => {
	it('有工作区根时按根拼接（与内置预览一致）', () => {
		assert.strictEqual(file('/docs/readme.md', WINDOWS_DOC, '/d:/ws').path, 'd:/ws/docs/readme.md');
	});

	it('Windows 文档没有工作区根时放弃（盘符不确定）', () => {
		const target = resolveLinkTarget('/docs/readme.md', WINDOWS_DOC);
		assert.strictEqual(target.kind, 'ignore');
	});

	it('POSIX 文档没有工作区根时按绝对路径打开', () => {
		assert.strictEqual(file('/opt/app/readme.md', POSIX_DOC).path, '/opt/app/readme.md');
	});
});

describe('util/linkTarget vscode://file 链接', () => {
	it('带行号：行号 1 基', () => {
		assert.deepStrictEqual(file('vscode://file/D:/AllData/demo/target.md:7'), {
			path: 'd:/AllData/demo/target.md',
			line: 7,
		});
	});

	it('不带行号', () => {
		assert.deepStrictEqual(file('vscode://file/D:/AllData/demo/target.md'), {
			path: 'd:/AllData/demo/target.md',
			line: undefined,
		});
	});

	it('文件名里的数字不会被当成行号（solid-320x240.gif）', () => {
		assert.deepStrictEqual(file('vscode://file/D:/a/solid-320x240.gif'), {
			path: 'd:/a/solid-320x240.gif',
			line: undefined,
		});
	});

	it('百分号编码 + 行号', () => {
		assert.deepStrictEqual(file('vscode://file/D:/a/%E7%9B%AE%E6%A0%87%20%E4%B8%AD%E6%96%87.md:9'), {
			path: 'd:/a/目标 中文.md',
			line: 9,
		});
	});

	it('markdown-it 把冒号编码成 %3A 时仍能拆出行号（真实渲染的 href 就是这种）', () => {
		assert.deepStrictEqual(file('vscode://file/d%3A/AllData/x.md%3A7'), {
			path: 'd:/AllData/x.md',
			line: 7,
		});
	});

	it('#L10 也识别为行号，普通 fragment 忽略', () => {
		assert.strictEqual(file('vscode://file/D:/a/b.md#L10').line, 10);
		assert.strictEqual(file('vscode://file/D:/a/b.md#section').line, undefined);
	});

	it('行号 0 视为没有行号（与旧改写逻辑一致）', () => {
		assert.strictEqual(file('vscode://file/D:/a/b.md:0').line, undefined);
	});

	it('反斜杠写法的 vscode 链接', () => {
		assert.strictEqual(file('vscode://file/D:\\a\\b.md:3').path, 'd:/a/b.md');
	});

	it('相对写法的 vscode 链接按当前文档目录解析', () => {
		assert.strictEqual(file('vscode://file/targets/x.md').path, 'd:/AllData/demo/R5-jump/targets/x.md');
	});

	it('vscode-insider / vscode-insiders 同样识别', () => {
		assert.strictEqual(file('vscode-insider://file/D:/a/b.md').path, 'd:/a/b.md');
		assert.strictEqual(file('vscode-insiders://file/D:/a/b.md').path, 'd:/a/b.md');
	});
});

describe('util/linkTarget file:// 链接', () => {
	it('file:///d:/… 去掉协议与多余前导斜杠', () => {
		assert.deepStrictEqual(file('file:///D:/a/b%20c.md'), { path: 'd:/a/b c.md', line: undefined });
	});

	it('file://server/share 保留 UNC 主机', () => {
		assert.strictEqual(file('file://server/share/a.md').path, '//server/share/a.md');
	});

	it('file:///home/… 在 POSIX 文档上保持绝对路径', () => {
		assert.strictEqual(file('file:///home/user/a.md', POSIX_DOC).path, '/home/user/a.md');
	});
});

describe('util/linkTarget 外部与忽略项', () => {
	it('http / https / mailto / tel 交给系统', () => {
		for (const href of ['https://example.com/a?b=1#c', 'http://example.com', 'mailto:a@b.c', 'tel:+123']) {
			const target = resolveLinkTarget(href, WINDOWS_DOC);
			assert.strictEqual(target.kind, 'external', href);
			assert.strictEqual(target.href, href);
		}
	});

	it('协议相对 //host/x 补成 https', () => {
		const target = resolveLinkTarget('//example.com/x', WINDOWS_DOC);
		assert.strictEqual(target.kind, 'external');
		assert.strictEqual(target.href, 'https://example.com/x');
	});

	it('vscode://settings 之类交回系统协议处理器', () => {
		const target = resolveLinkTarget('vscode://settings/wispkit.toc.depth', WINDOWS_DOC);
		assert.strictEqual(target.kind, 'external');
	});

	it('页内锚点 / 纯 query / command / 危险 scheme 一律忽略', () => {
		for (const href of ['#top', '?x=1', 'command:vscode.open?%5B%5D', 'javascript:alert(1)', 'data:text/html,x', 'blob:abc', '']) {
			assert.strictEqual(resolveLinkTarget(href, WINDOWS_DOC).kind, 'ignore', href);
		}
	});
});
