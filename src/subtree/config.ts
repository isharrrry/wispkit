import * as path from 'node:path';
import type { TreeEntry } from './types';

/** 自定义工具的执行方式。 */
export type ShellMode = 'silent' | 'currentTerminal' | 'newTerminal' | 'external';

export const SHELL_MODES: readonly ShellMode[] = ['silent', 'currentTerminal', 'newTerminal', 'external'];

export const DEFAULT_SHELL_MODE: ShellMode = 'silent';

export interface SubtreeToolConfig {
	readonly label: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly shell: ShellMode;
}

/** 单条工具配置：缺 label/command 或 shell 不在枚举里都判为非法（返回 undefined，由调用方跳过并报告）。 */
export function parseToolConfig(value: unknown): SubtreeToolConfig | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const label = record.label;
	const command = record.command;
	if (typeof label !== 'string' || !label.trim() || typeof command !== 'string' || !command.trim()) {
		return undefined;
	}

	const rawArgs = record.args;
	const args = Array.isArray(rawArgs)
		? rawArgs.filter((item): item is string => typeof item === 'string')
		: [];

	const rawShell = record.shell;
	const shell = typeof rawShell === 'string' && (SHELL_MODES as readonly string[]).includes(rawShell)
		? (rawShell as ShellMode)
		: DEFAULT_SHELL_MODE;

	return { label: label.trim(), command: command.trim(), args, shell };
}

export function parseTools(value: unknown): SubtreeToolConfig[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const tools: SubtreeToolConfig[] = [];
	for (const item of value) {
		const tool = parseToolConfig(item);
		if (tool) {
			tools.push(tool);
		}
	}
	return tools;
}

/**
 * `${name}` 变量替换。**未知变量原样保留** —— 静默替换成空串会让命令悄悄跑错目标，
 * 留着 `${typo}` 用户一眼就能看出是配置写错了。
 */
export function expandVariables(text: string, variables: Readonly<Record<string, string>>): string {
	return text.replace(/\$\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => {
		const value = variables[name];
		return typeof value === 'string' ? value : match;
	});
}

export function toolVariables(entry: TreeEntry, workspaceFolder?: string): Record<string, string> {
	return {
		file: entry.path,
		dir: entry.isDirectory ? entry.path : path.dirname(entry.path),
		name: entry.name,
		workspaceFolder: workspaceFolder ?? '',
	};
}

export interface ToolInvocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly shell: ShellMode;
}

/** 把配置里的 `command`/`args` 展开成最终要执行的东西（纯函数，执行留给宿主）。 */
export function resolveToolInvocation(
	tool: SubtreeToolConfig,
	entry: TreeEntry,
	workspaceFolder?: string,
): ToolInvocation {
	const variables = toolVariables(entry, workspaceFolder);
	return {
		command: expandVariables(tool.command, variables),
		args: tool.args.map(argument => expandVariables(argument, variables)),
		shell: tool.shell,
	};
}

/** 终端里执行的完整命令行（供 currentTerminal / newTerminal 用）。 */
export function formatCommandLine(invocation: ToolInvocation): string {
	return [invocation.command, ...invocation.args]
		.map(part => (/\s/.test(part) ? `"${part}"` : part))
		.join(' ');
}
