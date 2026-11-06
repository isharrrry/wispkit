import { spawn } from 'node:child_process';
import * as path from 'node:path';

/**
 * 「用系统的方式打开」的启动计划。
 *
 * Windows 走 `Start-Process`：它是 ShellExecute 的薄封装，因此**关联程序、UAC、
 * 快捷方式解析**都与资源管理器双击一致。
 *
 * 工作目录要分两种情形，混淆会得到「和双击不一样」的结果：
 * - `.exe`：双击时资源管理器给的是**可执行文件所在目录**，这里显式 `-WorkingDirectory` 钉住；
 * - `.lnk`：双击时用的是**快捷方式自己记录的工作目录**，再传一个目录反而会覆盖它 ——
 *   所以计划里干脆不带这个参数。
 */
export interface SystemOpenPlan {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	/** 打日志/提示用：这次到底有没有干预工作目录。 */
	readonly overridesWorkingDirectory: boolean;
}

export interface SystemOpenOptions {
	/** 显式指定的启动工作目录；`undefined` 表示交给系统或快捷方式自己决定。 */
	readonly workingDirectory?: string;
}

/** PowerShell 单引号字符串的转义：把 `'` 写成 `''`。 */
export function psQuote(value: string): string {
	return value.replace(/'/g, "''");
}

export function windowsStartProcessCommand(targetPath: string, workingDirectory: string | undefined): string {
	const base = `Start-Process -FilePath '${psQuote(targetPath)}'`;
	return workingDirectory === undefined
		? base
		: `${base} -WorkingDirectory '${psQuote(workingDirectory)}'`;
}

export function planSystemOpen(
	targetPath: string,
	platform: NodeJS.Platform,
	options: SystemOpenOptions = {},
): SystemOpenPlan {
	const fallbackCwd = path.dirname(targetPath);
	const cwd = options.workingDirectory ?? fallbackCwd;
	const overridesWorkingDirectory = options.workingDirectory !== undefined;
	if (platform === 'win32') {
		return {
			command: 'powershell.exe',
			args: ['-NoProfile', '-NonInteractive', '-Command', windowsStartProcessCommand(targetPath, options.workingDirectory)],
			cwd,
			overridesWorkingDirectory,
		};
	}
	if (platform === 'darwin') {
		return { command: 'open', args: [targetPath], cwd, overridesWorkingDirectory };
	}
	return { command: 'xdg-open', args: [targetPath], cwd, overridesWorkingDirectory };
}

/**
 * 启动并立刻脱手：扩展宿主不等目标进程结束。
 * 只有「根本没启动起来」才算失败——目标程序自己退出不是错误。
 */
export async function runSystemOpen(plan: SystemOpenPlan): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(plan.command, [...plan.args], {
			cwd: plan.cwd,
			detached: true,
			stdio: 'ignore',
			windowsHide: true,
		});
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}
