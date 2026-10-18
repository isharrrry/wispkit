/**
 * 调用外部 .NET 渲染器，把 `.xaml` 渲染成 PNG。
 *
 * 渲染器是**独立进程**（不在扩展里跑 CLR），契约冻结为：
 *   <renderer> render <in.xaml> <out.png> [--assembly <dll>]... [--width N] [--height N] [--class <T>] [--json]
 * stdout 的**最后一行**是单行 JSON 结果。可执行文件路径由调用方传入，这里不写死。
 *
 * 这一层只做"启动 + 解析"，不假设渲染器内部怎么实现 —— 这样渲染器换语言/换实现都不影响扩展。
 * 关键约定：**任何失败都返回 `{ok:false}`，绝不抛异常** —— 上层要把它渲染成错误面板。
 */

import { execFile } from 'child_process';

/** 要起 CLR、加载程序集、构建并渲染 WPF 视觉树，给足时间。 */
const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export interface XamlRenderResult {
	readonly ok: boolean;
	readonly pngPath?: string;
	readonly width?: number;
	readonly height?: number;
	readonly root?: string;
	readonly mode?: string;
	readonly error?: string;
	readonly errorType?: string;
}

export interface XamlRendererOptions {
	readonly executable: string;
	readonly extraAssemblies?: readonly string[];
}

/**
 * 取 **stdout 最后一行可解析的结果 JSON**。
 *
 * 渲染器可能先打印构建日志、NuGet 警告或 `dotnet` 的横幅，所以不能只看最后一行是不是 JSON，
 * 也不能只看第一行 —— 从末尾往前找第一个**带 `ok` 字段**的对象；无关的 JSON（如版本信息）
 * 会被跳过，避免误把日志当结果。
 */
export function parseRendererOutput(stdout: string): XamlRenderResult {
	const lines = stdout.split(/\r?\n/);

	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index].trim();
		if (!line.startsWith('{')) {
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		const result = normalizeResult(parsed);
		if (result) {
			return result;
		}
	}

	return { ok: false, error: '渲染器没有输出可解析的结果 JSON（stdout 里找不到带 ok 字段的对象）' };
}

function normalizeResult(value: unknown): XamlRenderResult | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.ok !== 'boolean') {
		// 不是结果 JSON（例如渲染器打印的版本信息），继续往前找
		return undefined;
	}

	if (record.ok !== true) {
		const error = typeof record.error === 'string' && record.error.trim()
			? record.error.trim()
			: '渲染失败，但渲染器没有给出原因';
		return {
			ok: false,
			error,
			errorType: typeof record.errorType === 'string' && record.errorType ? record.errorType : undefined,
		};
	}

	if (typeof record.png !== 'string' || !record.png) {
		return { ok: false, error: '渲染器报告成功，但没有给出 PNG 路径' };
	}

	return {
		ok: true,
		pngPath: record.png,
		width: typeof record.width === 'number' ? record.width : undefined,
		height: typeof record.height === 'number' ? record.height : undefined,
		root: typeof record.root === 'string' ? record.root : undefined,
		mode: typeof record.mode === 'string' ? record.mode : undefined,
	};
}

export async function renderXaml(
	options: XamlRendererOptions,
	xamlPath: string,
	pngPath: string,
): Promise<XamlRenderResult> {
	const args = ['render', xamlPath, pngPath, '--json'];
	for (const assembly of options.extraAssemblies ?? []) {
		args.push('--assembly', assembly);
	}

	return new Promise<XamlRenderResult>(resolve => {
		execFile(
			options.executable,
			args,
			{ timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true },
			(error, stdout, stderr) => {
				const parsed = parseRendererOutput(stdout ?? '');

				// 进程正常退出：渲染器自己给的结果就是最终结论（成功或它自报的失败）
				if (!error) {
					resolve(parsed);
					return;
				}

				const reasons = [
					describeProcessFailure(error, options.executable),
					firstNonEmptyLine(stderr),
					parsed.error,
				].filter((part): part is string => Boolean(part));

				resolve({
					ok: false,
					error: reasons.join(' | '),
					errorType: parsed.errorType,
				});
			},
		);
	});
}

function describeProcessFailure(error: Error & { code?: unknown; killed?: boolean; signal?: string }, executable: string): string {
	if (error.killed || error.signal) {
		return `渲染超时（超过 ${TIMEOUT_MS / 1000} 秒）或进程被终止（signal=${error.signal ?? '未知'}）`;
	}
	if (error.code === 'ENOENT') {
		return `找不到渲染器可执行文件：${executable}`;
	}
	if (typeof error.code === 'number') {
		return `渲染器退出码 ${error.code}`;
	}
	return `启动渲染器失败：${error.message}`;
}

function firstNonEmptyLine(text: string | undefined): string | undefined {
	if (!text) {
		return undefined;
	}
	return text.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0);
}
