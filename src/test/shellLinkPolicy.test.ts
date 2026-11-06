import * as assert from 'assert';
import {
	isExecutablePath,
	isShellLinkPath,
	planExecutableOpen,
	planShellLinkOpen,
} from '../shellLink/policy';

describe('shellLink/policy', () => {
	describe('扩展名判断', () => {
		it('.lnk 不区分大小写', () => {
			assert.strictEqual(isShellLinkPath('C:\\a\\b.lnk'), true);
			assert.strictEqual(isShellLinkPath('C:\\a\\b.LNK'), true);
			assert.strictEqual(isShellLinkPath('C:\\a\\b.exe'), false);
		});

		it('.exe 不区分大小写', () => {
			assert.strictEqual(isExecutablePath('C:\\a\\b.exe'), true);
			assert.strictEqual(isExecutablePath('C:\\a\\b.EXE'), true);
			assert.strictEqual(isExecutablePath('C:\\a\\b.lnk'), false);
		});
	});

	describe('planShellLinkOpen', () => {
		const folder = { targetPath: 'D:\\work\\docs', targetIsFolder: true };
		const file = { targetPath: 'D:\\work\\a.txt', targetIsFolder: false };

		it('system 一律交给系统，与目标是否存在无关', () => {
			assert.deepStrictEqual(planShellLinkOpen('system', 'subtree', folder), { kind: 'system' });
			assert.deepStrictEqual(planShellLinkOpen('system', 'subtree', { targetPath: undefined, targetIsFolder: false }), { kind: 'system' });
		});

		it('ask 交给调用方询问', () => {
			assert.deepStrictEqual(planShellLinkOpen('ask', 'subtree', folder), { kind: 'ask' });
		});

		it('internal + 文件夹目标 + folderTarget=subtree → 进子树', () => {
			assert.deepStrictEqual(planShellLinkOpen('internal', 'subtree', folder), {
				kind: 'subtree',
				path: 'D:\\work\\docs',
			});
		});

		it('internal + 文件夹目标 + folderTarget=system → 交给系统', () => {
			assert.deepStrictEqual(planShellLinkOpen('internal', 'system', folder), { kind: 'system' });
		});

		it('internal + 文件目标 → 用编辑器打开目标', () => {
			assert.deepStrictEqual(planShellLinkOpen('internal', 'subtree', file), {
				kind: 'file',
				path: 'D:\\work\\a.txt',
			});
		});

		it('internal 但没有目标路径 → unresolved，不假装成功', () => {
			assert.deepStrictEqual(planShellLinkOpen('internal', 'subtree', { targetPath: undefined, targetIsFolder: false }), { kind: 'unresolved' });
		});

		it('目标路径只有空白也算没有', () => {
			assert.deepStrictEqual(planShellLinkOpen('internal', 'subtree', { targetPath: '   ', targetIsFolder: false }), { kind: 'unresolved' });
		});

		it('目标路径两侧空白会被去掉', () => {
			const plan = planShellLinkOpen('internal', 'subtree', { targetPath: '  D:\\x  ', targetIsFolder: false });
			assert.deepStrictEqual(plan, { kind: 'file', path: 'D:\\x' });
		});
	});

	describe('planExecutableOpen', () => {
		it('默认交给系统', () => {
			assert.deepStrictEqual(planExecutableOpen('system'), { kind: 'system' });
		});

		it('viewer 进 PE 属性页', () => {
			assert.deepStrictEqual(planExecutableOpen('viewer'), { kind: 'viewer' });
		});

		it('ask 交给调用方询问', () => {
			assert.deepStrictEqual(planExecutableOpen('ask'), { kind: 'ask' });
		});
	});
});
