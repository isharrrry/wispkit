import { spawn } from 'node:child_process';
import {
	planSystemTerminal,
	type SystemTerminalKind,
	type SystemTerminalLaunch,
} from './systemTerminal';

/**
 * 按计划启动系统终端。
 *
 * 与 `systemTerminal.ts` 分开：这一层真正碰 `child_process`，但错误都被收敛成
 * `{ ok, message }`，命令层只负责弹提示。Linux 会按候选顺序回退：只有
 * `ENOENT`（终端没装）才继续试下一个；其它错误立即上报，避免假装成功。
 *
 * Windows 提权选项会等启动器退出：用户在 UAC 弹窗点「否」时 PowerShell
 * 以非 0 退出，此时返回可读错误，而不是静默什么也没发生。
 */
export type SystemTerminalOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly message: string };

interface RunResult {
	readonly kind: 'started' | 'missing' | 'failed';
	readonly message?: string;
}

export async function launchSystemTerminal(
	kind: SystemTerminalKind,
	folderPath: string,
	platform: NodeJS.Platform = process.platform,
): Promise<SystemTerminalOutcome> {
	const plans = planSystemTerminal(kind, folderPath, platform);
	if (plans.length === 0) {
		return { ok: false, message: '当前平台不支持这种系统终端。' };
	}
	const missing: string[] = [];
	for (const plan of plans) {
		const result = await runPlan(plan);
		if (result.kind === 'started') {
			return { ok: true };
		}
		if (result.kind === 'failed') {
			return { ok: false, message: result.message ?? '启动器执行失败。' };
		}
		missing.push(plan.command);
	}
	return {
		ok: false,
		message: `没有找到可用的系统终端（尝试过：${missing.join('、')}）。请安装其中任意一个后重试。`,
	};
}

function runPlan(plan: SystemTerminalLaunch): Promise<RunResult> {
	return new Promise<RunResult>(resolve => {
		let settled = false;
		const finish = (result: RunResult): void => {
			if (!settled) {
				settled = true;
				resolve(result);
			}
		};
		let stderr = '';
		let spawned = false;
		let child;
		try {
			child = spawn(plan.command, [...plan.args], {
				env: plan.env ? { ...process.env, ...plan.env } : process.env,
				// 非提权终端要脱离扩展宿主存活；提权启动器需要等退出码，不 detach。
				detached: plan.elevated !== true,
				stdio: plan.elevated === true ? ['ignore', 'ignore', 'pipe'] : 'ignore',
				windowsHide: plan.windowsHide === true,
				windowsVerbatimArguments: plan.windowsVerbatimArguments === true,
			});
		} catch (error) {
			finish({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
			return;
		}
		child.once('error', error => {
			const code = (error as NodeJS.ErrnoException).code;
			finish(code === 'ENOENT'
				? { kind: 'missing' }
				: { kind: 'failed', message: error.message });
		});
		child.once('spawn', () => {
			spawned = true;
			if (plan.elevated !== true) {
				// 终端窗口已由子进程接管；不要让它随扩展宿主一起被等待。
				child.unref();
				finish({ kind: 'started' });
			}
		});
		if (plan.elevated === true) {
			child.stderr?.on('data', chunk => {
				if (stderr.length < 4096) {
					stderr += String(chunk);
				}
			});
			child.once('exit', code => {
				if (!spawned) {
					return;
				}
				if (code === 0) {
					finish({ kind: 'started' });
					return;
				}
				const detail = stderr.trim();
				finish({
					kind: 'failed',
					message: detail || `提权启动器退出码 ${code ?? '未知'}（可能取消了 UAC 提权）。`,
				});
			});
		}
	});
}
