import * as assert from 'assert';
import { computeDefaultRoots, resolveCompareInput } from '../compare/defaults';

const WIN_HOME = 'C:\\Users\\tester';
const WIN_APPDATA = 'C:\\Users\\tester\\AppData\\Roaming';
const WIN_RECENT = `${WIN_APPDATA}\\Microsoft\\Windows\\Recent`;

function existing(...paths: string[]): (candidate: string) => boolean {
	const set = new Set(paths.map(value => value.toLowerCase()));
	return candidate => set.has(candidate.toLowerCase());
}

describe('compare/defaults 默认位置', () => {
	it('Windows：左桌面、右 %APPDATA%\\Microsoft\\Windows\\Recent', () => {
		const roots = computeDefaultRoots({
			platform: 'win32',
			env: { APPDATA: WIN_APPDATA },
			home: WIN_HOME,
			isDirectory: existing(`${WIN_HOME}\\Desktop`, WIN_RECENT),
		});
		assert.strictEqual(roots.left.path, `${WIN_HOME}\\Desktop`);
		assert.strictEqual(roots.left.label, '桌面');
		assert.strictEqual(roots.left.note, undefined);
		assert.strictEqual(roots.right.path, WIN_RECENT);
		assert.strictEqual(roots.right.label, '最近使用');
		assert.strictEqual(roots.right.note, undefined);
	});

	it('Windows：OneDrive 重定向的桌面优先于普通 Desktop', () => {
		const oneDrive = 'C:\\Users\\tester\\OneDrive';
		const roots = computeDefaultRoots({
			platform: 'win32',
			env: { APPDATA: WIN_APPDATA, OneDrive: oneDrive },
			home: WIN_HOME,
			isDirectory: existing(`${oneDrive}\\Desktop`, WIN_RECENT),
		});
		assert.strictEqual(roots.left.path, `${oneDrive}\\Desktop`);
	});

	it('Windows：Recent 不存在时回退主目录并给出说明，不抛异常', () => {
		const roots = computeDefaultRoots({
			platform: 'win32',
			env: { APPDATA: WIN_APPDATA },
			home: WIN_HOME,
			isDirectory: existing(`${WIN_HOME}\\Desktop`),
		});
		assert.strictEqual(roots.right.path, WIN_HOME);
		assert.strictEqual(roots.right.kind, 'home');
		assert.ok(roots.right.note?.includes('最近使用'));
	});

	it('Windows：桌面也不存在时左侧回退主目录', () => {
		const roots = computeDefaultRoots({
			platform: 'win32',
			env: { APPDATA: WIN_APPDATA },
			home: WIN_HOME,
			isDirectory: () => false,
		});
		assert.strictEqual(roots.left.path, WIN_HOME);
		assert.ok(roots.left.note?.includes('桌面'));
		assert.strictEqual(roots.right.path, WIN_HOME);
	});

	it('Linux / macOS：没有 Recent，右侧用主目录且不异常', () => {
		for (const platform of ['linux', 'darwin']) {
			const roots = computeDefaultRoots({
				platform,
				env: {},
				home: '/home/tester',
				isDirectory: candidate => candidate === '/home/tester/Desktop',
			});
			assert.strictEqual(roots.left.path, '/home/tester/Desktop', `${platform} 左侧应为桌面`);
			assert.strictEqual(roots.right.path, '/home/tester', `${platform} 右侧应回退主目录`);
			assert.strictEqual(roots.right.kind, 'home');
			assert.ok(roots.right.note?.includes('最近使用'));
		}
	});

	it('环境变量缺失 / homedir 为空也不抛异常', () => {
		assert.doesNotThrow(() => computeDefaultRoots({
			platform: 'linux',
			env: {},
			home: '',
			isDirectory: () => false,
		}));
		const roots = computeDefaultRoots({
			platform: 'win32',
			env: {},
			home: '',
			isDirectory: () => false,
		});
		assert.ok(roots.left.path.length > 0);
	});
});

describe('compare/defaults 路径输入', () => {
	const base = 'C:\\Users\\tester\\Desktop';
	const options = {
		base,
		home: WIN_HOME,
		env: { APPDATA: WIN_APPDATA },
		platform: 'win32',
	};

	it('~ 展开为主目录', () => {
		assert.deepStrictEqual(resolveCompareInput({ ...options, input: '~' }), { path: WIN_HOME });
		assert.deepStrictEqual(resolveCompareInput({ ...options, input: '~/docs' }), { path: `${WIN_HOME}\\docs` });
		assert.deepStrictEqual(resolveCompareInput({ ...options, input: '~\\docs' }), { path: `${WIN_HOME}\\docs` });
	});

	it('%VAR% 展开，且 Windows 环境变量名大小写不敏感', () => {
		const result = resolveCompareInput({
			...options,
			input: '%appdata%\\Microsoft\\Windows\\Recent',
		});
		assert.deepStrictEqual(result, { path: WIN_RECENT });
	});

	it('未定义的环境变量返回可读错误而不是乱解析', () => {
		const result = resolveCompareInput({ ...options, input: '%NOPE_NOT_SET%\\x' });
		assert.ok('error' in result && result.error.includes('NOPE_NOT_SET'));
	});

	it('相对路径基于当前一侧的根目录', () => {
		assert.deepStrictEqual(
			resolveCompareInput({ ...options, input: '..\\Documents' }),
			{ path: 'C:\\Users\\tester\\Documents' },
		);
	});

	it('去掉成对引号与首尾空白', () => {
		assert.deepStrictEqual(
			resolveCompareInput({ ...options, input: '  "C:\\数据\\最近使用"  ' }),
			{ path: 'C:\\数据\\最近使用' },
		);
	});

	it('支持 file:// URI', () => {
		assert.deepStrictEqual(
			resolveCompareInput({ ...options, input: 'file:///C:/Users/tester/Desktop' }),
			{ path: 'C:\\Users\\tester\\Desktop' },
		);
	});

	it('空输入与 ~用户名 返回错误，不抛异常', () => {
		const empty = resolveCompareInput({ ...options, input: '   ' });
		assert.ok('error' in empty);
		const user = resolveCompareInput({ ...options, input: '~admin/x' });
		assert.ok('error' in user);
	});
});
