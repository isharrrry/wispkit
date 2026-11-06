/**
 * 「系统终端打开」的启动计划。
 *
 * 这一层只做**纯计算**：给定终端类型、文件夹路径和平台，算出要执行的命令、
 * 参数与环境变量，不实际 spawn，也不依赖 vscode。这样 Windows / macOS / Linux
 * 三套完全不同的启动方式都能在普通 mocha 里断言，不会只有 Windows 被真机覆盖。
 *
 * 关键约束：文件夹路径可能含空格、`&`、`'`、`%`、中文，绝不能直接拼进一条
 * 双引号命令行里各平台碰运气。因此：
 * - Windows 非提权 cmd：路径只通过环境变量传入，命令行里只出现 `%VAR%`；
 * - Windows PowerShell：用 `-EncodedCommand`（UTF-16LE Base64）传脚本；
 * - Windows 提权：外层 PowerShell 同样用 `-EncodedCommand`，路径放进
 *   PowerShell 单引号字符串（`'` 双写转义），避免 UAC 启动器的引号地狱；
 * - Linux：路径作为独立 argv 传给终端；xterm 走 POSIX 单引号转义；
 * - macOS：`open -a Terminal <dir>` 直接以目录为参数。
 */

export type SystemTerminalKind =
	| 'windows-cmd'
	| 'windows-powershell'
	| 'windows-cmd-admin'
	| 'windows-powershell-admin'
	| 'macos-terminal'
	| 'linux-terminal';

export interface SystemTerminalOption {
	readonly kind: SystemTerminalKind;
	readonly label: string;
	readonly description: string;
}

export interface SystemTerminalLaunch {
	readonly command: string;
	readonly args: readonly string[];
	/** 追加到子进程环境变量里（与 process.env 合并）。 */
	readonly env?: Readonly<Record<string, string>>;
	/** Windows：args 已自行带好引号，禁止 Node 再做一次转义。 */
	readonly windowsVerbatimArguments?: boolean;
	/** 提权启动器需要等退出码，用来识别「用户取消了 UAC」。 */
	readonly elevated?: boolean;
	readonly windowsHide?: boolean;
}

/** 非提权 cmd 用环境变量传 cwd，避免路径进入命令行。 */
export const WINDOWS_CWD_ENV = 'WISPKIT_TERMINAL_CWD';

/**
 * 某个平台可用的系统终端选项。顺序即菜单顺序：非提权在前，管理员选项在后。
 * 平台判断用 Node 的 `process.platform`，macOS 为 `darwin`，其余非 Windows
 * 平台按 Linux 处理（桌面终端列表在那些系统上同样适用）。
 */
export function systemTerminalOptions(platform: NodeJS.Platform): SystemTerminalOption[] {
	if (platform === 'win32') {
		return [
			{
				kind: 'windows-cmd',
				label: '命令提示符 (cmd)',
				description: '在当前文件夹打开系统 cmd 窗口',
			},
			{
				kind: 'windows-powershell',
				label: 'PowerShell',
				description: '在当前文件夹打开 Windows PowerShell 窗口',
			},
			{
				kind: 'windows-cmd-admin',
				label: '命令提示符 (管理员)',
				description: '以管理员身份打开 cmd，会弹出 UAC 提权确认',
			},
			{
				kind: 'windows-powershell-admin',
				label: 'PowerShell (管理员)',
				description: '以管理员身份打开 PowerShell，会弹出 UAC 提权确认',
			},
		];
	}
	if (platform === 'darwin') {
		return [{
			kind: 'macos-terminal',
			label: 'Terminal.app',
			description: '在当前文件夹打开 macOS 终端',
		}];
	}
	return [{
		kind: 'linux-terminal',
		label: '系统终端',
		description: '自动尝试 gnome-terminal / konsole / xfce4-terminal / xterm',
	}];
}

/**
 * 生成启动候选（按顺序尝试）。Linux 会给多个终端候选，第一个不存在时
 * 启动器继续试下一个；其它平台只有一个候选。
 *
 * 平台与终端类型不匹配时返回空数组——菜单已经用 `isWindows` / `isMac` /
 * `isLinux` 过滤，这里是命令层和单测的第二道保险。
 */
export function planSystemTerminal(
	kind: SystemTerminalKind,
	folderPath: string,
	platform: NodeJS.Platform,
): SystemTerminalLaunch[] {
	switch (kind) {
		case 'windows-cmd':
			if (platform !== 'win32') {
				return [];
			}
			return [{
				command: 'cmd.exe',
				// `start ""` 让新命令拥有独立控制台；/k 执行 cd 后保持窗口。
				args: ['/c', 'start', '""', 'cmd.exe', '/k', `cd /d "%${WINDOWS_CWD_ENV}%"`],
				env: { [WINDOWS_CWD_ENV]: folderPath },
				windowsVerbatimArguments: true,
				windowsHide: true,
			}];
		case 'windows-powershell':
			if (platform !== 'win32') {
				return [];
			}
			return [{
				command: 'cmd.exe',
				args: [
					'/c', 'start', '""', 'powershell.exe',
					'-NoProfile', '-NoExit',
					'-EncodedCommand', encodePowerShell(`Set-Location -LiteralPath ${powerShellLiteral(folderPath)}`),
				],
				windowsVerbatimArguments: true,
				windowsHide: true,
			}];
		case 'windows-cmd-admin':
			if (platform !== 'win32') {
				return [];
			}
			return [elevatedLaunch(
				`Start-Process -FilePath 'cmd.exe' -ArgumentList ${powerShellLiteral(`/k cd /d "${folderPath}"`)} -Verb RunAs`,
			)];
		case 'windows-powershell-admin': {
			if (platform !== 'win32') {
				return [];
			}
			const inner = encodePowerShell(`Set-Location -LiteralPath ${powerShellLiteral(folderPath)}`);
			return [elevatedLaunch(
				`Start-Process -FilePath 'powershell.exe' -ArgumentList ${powerShellLiteral(`-NoExit -EncodedCommand ${inner}`)} -Verb RunAs`,
			)];
		}
		case 'macos-terminal':
			if (platform !== 'darwin') {
				return [];
			}
			return [{ command: 'open', args: ['-a', 'Terminal', folderPath] }];
		case 'linux-terminal':
			if (platform === 'win32' || platform === 'darwin') {
				return [];
			}
			return linuxLaunches(folderPath);
	}
}

/** 提权启动器：隐藏的 PowerShell，等它退出后按退出码判断 UAC 结果。 */
function elevatedLaunch(script: string): SystemTerminalLaunch {
	return {
		command: 'powershell.exe',
		args: ['-NoProfile', '-EncodedCommand', encodePowerShell(script)],
		elevated: true,
		windowsHide: true,
	};
}

function linuxLaunches(folderPath: string): SystemTerminalLaunch[] {
	const shellCommand = `cd -- ${shellSingleQuote(folderPath)}; exec bash`;
	return [
		// 常见桌面终端都支持「工作目录」参数，路径作为独立 argv，无需转义。
		{ command: 'gnome-terminal', args: ['--working-directory', folderPath] },
		{ command: 'konsole', args: ['--workdir', folderPath] },
		{ command: 'xfce4-terminal', args: ['--working-directory', folderPath] },
		// xterm 没有工作目录参数，只能交给 shell 自己 cd。
		{ command: 'xterm', args: ['-e', 'bash', '-lc', shellCommand] },
	];
}

/** PowerShell 单引号字符串：内部的 `'` 用两个单引号表示，其余字符原样。 */
export function powerShellLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** PowerShell `-EncodedCommand` 要求 UTF-16LE 的 Base64。 */
export function encodePowerShell(script: string): string {
	return Buffer.from(script, 'utf16le').toString('base64');
}

/** POSIX shell 单引号转义：`'` → `'\''`。 */
export function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}
