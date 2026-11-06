import * as assert from 'assert';
import {
	encodePowerShell,
	planSystemTerminal,
	powerShellLiteral,
	shellSingleQuote,
	systemTerminalOptions,
	WINDOWS_CWD_ENV,
} from '../resourceTree/systemTerminal';

/** 路径刻意包含空格、中文、单引号、美元符与百分号，覆盖最难的引号场景。 */
const FOLDER = "D:\\Work Space\\项目's $docs%";

function decode(script: string): string {
	return Buffer.from(script, 'base64').toString('utf16le');
}

function encodedArgument(args: readonly string[], index: number): string {
	assert.strictEqual(args[index - 1], '-EncodedCommand');
	return decode(args[index]);
}

describe('系统终端选项（菜单内容）', () => {
	it('Windows：cmd / PowerShell / cmd 管理员 / PowerShell 管理员', () => {
		const options = systemTerminalOptions('win32');
		assert.deepStrictEqual(options.map(option => option.kind), [
			'windows-cmd',
			'windows-powershell',
			'windows-cmd-admin',
			'windows-powershell-admin',
		]);
		assert.ok(options[0].label.includes('cmd'));
		assert.ok(options[1].label.includes('PowerShell'));
		assert.ok(options[2].label.includes('管理员'), '管理员选项必须能从标题辨认');
		assert.ok(options[3].label.includes('管理员'));
		for (const option of options) {
			assert.ok(option.description.length > 0, `${option.kind} 缺少说明`);
		}
	});

	it('macOS 只有 Terminal.app，其它平台回退到自动选择的系统终端', () => {
		assert.deepStrictEqual(systemTerminalOptions('darwin').map(option => option.kind), ['macos-terminal']);
		assert.deepStrictEqual(systemTerminalOptions('linux').map(option => option.kind), ['linux-terminal']);
		assert.deepStrictEqual(systemTerminalOptions('freebsd').map(option => option.kind), ['linux-terminal']);
	});
});

describe('系统终端启动计划：Windows 非提权', () => {
	it('cmd 通过环境变量传 cwd，命令行里不出现真实路径', () => {
		const [plan] = planSystemTerminal('windows-cmd', FOLDER, 'win32');
		assert.ok(plan);
		assert.strictEqual(plan.command, 'cmd.exe');
		assert.strictEqual(plan.windowsVerbatimArguments, true, '必须原样传参，避免 Node 二次转义引号');
		assert.deepStrictEqual(plan.args, ['/c', 'start', '""', 'cmd.exe', '/k', `cd /d "%${WINDOWS_CWD_ENV}%"`]);
		assert.strictEqual(plan.env?.[WINDOWS_CWD_ENV], FOLDER, 'cwd 必须经环境变量传入');
		assert.ok(!plan.args.join(' ').includes(FOLDER), '真实路径不能进入 cmd 命令行（含空格 / & 会破坏解析）');
	});

	it('PowerShell 用 -EncodedCommand 传 Set-Location，路径只存在于脚本里', () => {
		const [plan] = planSystemTerminal('windows-powershell', FOLDER, 'win32');
		assert.ok(plan);
		assert.strictEqual(plan.command, 'cmd.exe');
		assert.strictEqual(plan.windowsVerbatimArguments, true);
		assert.strictEqual(plan.args[3], 'powershell.exe');
		assert.strictEqual(plan.args[4], '-NoProfile');
		assert.strictEqual(plan.args[5], '-NoExit');
		const script = encodedArgument(plan.args, 7);
		assert.strictEqual(script, `Set-Location -LiteralPath ${powerShellLiteral(FOLDER)}`);
		assert.ok(script.includes("''s"), '路径里的单引号必须在 PowerShell 单引号字符串里双写');
		assert.ok(!plan.args.join(' ').includes(FOLDER), '真实路径不应出现在命令行参数中');
	});

	it('错误的平台组合返回空计划（菜单 when 之外的第二道保险）', () => {
		assert.deepStrictEqual(planSystemTerminal('windows-cmd', FOLDER, 'darwin'), []);
		assert.deepStrictEqual(planSystemTerminal('windows-powershell', FOLDER, 'linux'), []);
		assert.deepStrictEqual(planSystemTerminal('windows-cmd-admin', FOLDER, 'linux'), []);
		assert.deepStrictEqual(planSystemTerminal('windows-powershell-admin', FOLDER, 'darwin'), []);
	});
});

describe('系统终端启动计划：Windows 提权', () => {
	it('cmd 管理员：Start-Process -Verb RunAs，路径放 PowerShell 单引号字符串', () => {
		const [plan] = planSystemTerminal('windows-cmd-admin', FOLDER, 'win32');
		assert.ok(plan);
		assert.strictEqual(plan.command, 'powershell.exe');
		assert.strictEqual(plan.elevated, true);
		assert.strictEqual(plan.windowsHide, true);
		const script = encodedArgument(plan.args, 2);
		assert.ok(script.includes("Start-Process -FilePath 'cmd.exe'"), '必须用 Start-Process 提权启动 cmd');
		assert.ok(script.includes('-Verb RunAs'));
		assert.ok(
			script.includes(`/k cd /d "${FOLDER.replace(/'/g, "''")}"`),
			'提权后要 cd 到目标目录',
		);
		assert.ok(script.includes("''s"), '路径单引号必须双写');
	});

	it('PowerShell 管理员：内层用 EncodedCommand 避免嵌套引号', () => {
		const [plan] = planSystemTerminal('windows-powershell-admin', FOLDER, 'win32');
		assert.ok(plan);
		assert.strictEqual(plan.elevated, true);
		const outer = encodedArgument(plan.args, 2);
		assert.ok(outer.includes("Start-Process -FilePath 'powershell.exe'"));
		assert.ok(outer.includes('-Verb RunAs'));
		const match = /-NoExit -EncodedCommand ([A-Za-z0-9+/=]+)/.exec(outer);
		assert.ok(match, '外层脚本里应包含内层 EncodedCommand');
		const inner = decode(match[1]);
		assert.strictEqual(inner, `Set-Location -LiteralPath ${powerShellLiteral(FOLDER)}`);
	});
});

describe('系统终端启动计划：macOS 与 Linux', () => {
	it('macOS 用 open -a Terminal <目录>，目录作为独立 argv', () => {
		const plans = planSystemTerminal('macos-terminal', FOLDER, 'darwin');
		assert.deepStrictEqual(plans, [{ command: 'open', args: ['-a', 'Terminal', FOLDER] }]);
		assert.deepStrictEqual(planSystemTerminal('macos-terminal', FOLDER, 'win32'), []);
	});

	it('Linux 按 gnome-terminal → konsole → xfce4-terminal → xterm 回退', () => {
		const plans = planSystemTerminal('linux-terminal', FOLDER, 'linux');
		assert.deepStrictEqual(plans.map(plan => plan.command), [
			'gnome-terminal',
			'konsole',
			'xfce4-terminal',
			'xterm',
		]);
		assert.deepStrictEqual(plans[0].args, ['--working-directory', FOLDER]);
		assert.deepStrictEqual(plans[1].args, ['--workdir', FOLDER]);
		assert.deepStrictEqual(plans[2].args, ['--working-directory', FOLDER]);
		const xtermCommand = plans[3].args[3];
		assert.strictEqual(xtermCommand, `cd -- ${shellSingleQuote(FOLDER)}; exec bash`);
		assert.deepStrictEqual(planSystemTerminal('linux-terminal', FOLDER, 'win32'), []);
	});
});

describe('系统终端转义辅助函数', () => {
	it('PowerShell 单引号：内部单引号双写，$ / % 保持原样', () => {
		assert.strictEqual(powerShellLiteral('C:\\plain'), "'C:\\plain'");
		assert.strictEqual(powerShellLiteral("C:\\it's $x%"), "'C:\\it''s $x%'");
	});

	it("POSIX 单引号：内部单引号写成 '\\''", () => {
		assert.strictEqual(shellSingleQuote('/tmp/plain'), "'/tmp/plain'");
		assert.strictEqual(shellSingleQuote("/tmp/it's"), "'/tmp/it'\\''s'");
		assert.strictEqual(shellSingleQuote('/tmp/a b'), "'/tmp/a b'");
	});

	it('-EncodedCommand 使用 UTF-16LE Base64，可还原中文与引号', () => {
		const script = "Set-Location -LiteralPath 'D:\\项目'";
		assert.strictEqual(decode(encodePowerShell(script)), script);
		assert.ok(!encodePowerShell(script).includes('项目'), '编码结果不应是明文');
	});
});
