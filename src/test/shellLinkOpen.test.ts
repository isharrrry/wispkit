import * as assert from 'assert';
import { planSystemOpen, psQuote, windowsStartProcessCommand } from '../shellLink/open';

describe('shellLink/open', () => {
	it('PowerShell 单引号里的单引号双写转义', () => {
		assert.strictEqual(psQuote("C:\\it's\\a.txt"), "C:\\it''s\\a.txt");
	});

	it('给了工作目录才拼 -WorkingDirectory', () => {
		assert.strictEqual(
			windowsStartProcessCommand('C:\\a\\b.exe', 'C:\\a'),
			"Start-Process -FilePath 'C:\\a\\b.exe' -WorkingDirectory 'C:\\a'",
		);
		assert.strictEqual(
			windowsStartProcessCommand('C:\\a\\b.lnk', undefined),
			"Start-Process -FilePath 'C:\\a\\b.lnk'",
		);
	});

	describe('Windows', () => {
		it('.exe 显式钉住工作目录为文件所在目录', () => {
			const plan = planSystemOpen('C:\\tools\\app.exe', 'win32', { workingDirectory: 'C:\\tools' });
			assert.strictEqual(plan.command, 'powershell.exe');
			assert.deepStrictEqual(plan.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
			assert.match(plan.args[3], /-WorkingDirectory 'C:\\tools'$/);
			assert.strictEqual(plan.overridesWorkingDirectory, true);
			assert.strictEqual(plan.cwd, 'C:\\tools');
		});

		it('.lnk 不覆盖工作目录，交给快捷方式自己记录的值', () => {
			const plan = planSystemOpen('D:\\links\\note.lnk', 'win32');
			assert.doesNotMatch(plan.args[3], /WorkingDirectory/);
			assert.strictEqual(plan.overridesWorkingDirectory, false);
		});
	});

	describe('其它平台', () => {
		it('macOS 用 open', () => {
			const plan = planSystemOpen('/tmp/a.txt', 'darwin');
			assert.strictEqual(plan.command, 'open');
			assert.deepStrictEqual(plan.args, ['/tmp/a.txt']);
			assert.strictEqual(plan.cwd, '/tmp');
		});

		it('Linux 用 xdg-open', () => {
			const plan = planSystemOpen('/tmp/a.txt', 'linux');
			assert.strictEqual(plan.command, 'xdg-open');
		});

		it('工作目录参数仍然体现在 cwd 上', () => {
			const plan = planSystemOpen('/tmp/dir/a.txt', 'linux', { workingDirectory: '/tmp/dir' });
			assert.strictEqual(plan.cwd, '/tmp/dir');
			assert.strictEqual(plan.overridesWorkingDirectory, true);
		});
	});
});
