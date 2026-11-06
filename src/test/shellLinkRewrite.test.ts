import * as assert from 'assert';
import {
	buildShortcutRewriteScript,
	diffShortcutEdits,
	hasShortcutEdits,
	psLiteral,
} from '../shellLink/rewrite';

describe('shellLink/rewrite', () => {
	it('PowerShell 字面量用单引号，内部单引号双写', () => {
		assert.strictEqual(psLiteral('C:\\a'), "'C:\\a'");
		assert.strictEqual(psLiteral("C:\\it's"), "'C:\\it''s'");
	});

	it('只写回提供的字段', () => {
		const script = buildShortcutRewriteScript('C:\\a\\b.lnk', { targetPath: 'C:\\c\\d.exe' });
		assert.match(script, /CreateShortcut\('C:\\a\\b\.lnk'\)/);
		assert.match(script, /\$shortcut\.TargetPath = 'C:\\c\\d\.exe'/);
		assert.doesNotMatch(script, /Arguments/);
		assert.doesNotMatch(script, /WorkingDirectory/);
		assert.match(script, /\$shortcut\.Save\(\)/);
	});

	it('四个字段都给了就都写', () => {
		const script = buildShortcutRewriteScript('C:\\a.lnk', {
			targetPath: 'C:\\t.exe',
			arguments: '--flag',
			workingDirectory: 'C:\\t',
			description: '备注',
		});
		for (const needle of ['TargetPath', 'Arguments', 'WorkingDirectory', 'Description']) {
			assert.ok(script.includes(needle), `脚本里应当出现 ${needle}`);
		}
	});

	it('先设 ErrorActionPreference，避免静默失败', () => {
		const script = buildShortcutRewriteScript('C:\\a.lnk', { targetPath: 'C:\\t.exe' });
		assert.ok(script.startsWith("$ErrorActionPreference = 'Stop'"));
		assert.ok(script.indexOf('$ErrorActionPreference') < script.indexOf('Save()'));
	});

	it('空对象不算有改动', () => {
		assert.strictEqual(hasShortcutEdits({}), false);
		assert.strictEqual(hasShortcutEdits({ arguments: '' }), true);
	});

	describe('diffShortcutEdits', () => {
		const current = {
			targetPath: 'C:\\a.exe',
			arguments: '--old',
			workingDirectory: 'C:\\work',
			description: '旧备注',
		};

		it('没有变化时返回空对象', () => {
			assert.deepStrictEqual(diffShortcutEdits({ ...current }, current), {});
		});

		it('只返回变了的字段', () => {
			assert.deepStrictEqual(
				diffShortcutEdits({ ...current, arguments: '--new' }, current),
				{ arguments: '--new' },
			);
		});

		it('原来没有值、表单留空时不算改动', () => {
			assert.deepStrictEqual(
				diffShortcutEdits({ targetPath: '', arguments: '', workingDirectory: '', description: '' }, {}),
				{},
			);
		});

		it('把已有值清空算改动（写回空串）', () => {
			assert.deepStrictEqual(
				diffShortcutEdits({ ...current, description: '' }, current),
				{ description: '' },
			);
		});
	});
});
