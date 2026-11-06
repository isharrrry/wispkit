import { execFile } from 'node:child_process';

/**
 * 从 `.exe` / `.lnk` **文件本身**取图标。
 *
 * 不走图标主题：主题只能按扩展名给出一个通用图标，而这两类文件的意义恰恰在
 * 「哪一个程序」。这里用 `System.Drawing.Icon.ExtractAssociatedIcon` —— 它就是
 * 资源管理器画图标时用的同一套 shell 关联，因此 `.lnk` 会解析成目标程序的图标。
 *
 * 纯逻辑（脚本生成、输出解析）与执行分开，前者可单测。
 */

/** 一层目录里最多提取多少个：一次 PowerShell 调用，太多会拖慢展开。 */
export const MAX_ICONS_PER_LEVEL = 64;

export interface IconCandidate {
	readonly path: string;
	readonly mtime: number;
	readonly size: number;
}

export function isIconBearingFile(filePath: string): boolean {
	return /\.(lnk|exe)$/i.test(filePath);
}

/** 只有 Windows 有这套关联；其它平台直接当作「没有图标」，不当失败。 */
export function supportsFileIcons(platform: NodeJS.Platform): boolean {
	return platform === 'win32';
}

export function iconCacheKey(candidate: IconCandidate): string {
	return `${candidate.path.toLowerCase()}|${candidate.mtime}|${candidate.size}`;
}

/** PowerShell 单引号字面量。 */
function quote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function buildFileIconScript(paths: readonly string[]): string {
	const list = paths.map(quote).join(', ');
	return [
		"$ErrorActionPreference = 'SilentlyContinue'",
		'Add-Type -AssemblyName System.Drawing',
		'$result = @()',
		`foreach ($p in @(${list})) {`,
		'  try {',
		'    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)',
		'    if ($icon -ne $null) {',
		'      $bmp = $icon.ToBitmap()',
		'      $stream = New-Object System.IO.MemoryStream',
		'      $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)',
		'      $result += [pscustomobject]@{ p = $p; d = [Convert]::ToBase64String($stream.ToArray()) }',
		'      $stream.Dispose()',
		'      $bmp.Dispose()',
		'      $icon.Dispose()',
		'    }',
		'  } catch { }',
		'}',
		'ConvertTo-Json -InputObject @($result) -Depth 3 -Compress',
	].join('\n');
}

/**
 * 解析脚本输出。PowerShell 在只有一项时会输出**对象而不是数组**，两种都要接。
 * 拿不到 png 的条目直接丢弃，绝不合成假图标。
 */
export function parseFileIconOutput(stdout: string): Map<string, string> {
	const out = new Map<string, string>();
	const trimmed = stdout.trim();
	if (!trimmed) {
		return out;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return out;
	}
	const items = Array.isArray(parsed) ? parsed : [parsed];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const record = item as Record<string, unknown>;
		const filePath = record.p;
		const data = record.d;
		if (typeof filePath !== 'string' || typeof data !== 'string' || !data) {
			continue;
		}
		out.set(filePath, `data:image/png;base64,${data}`);
	}
	return out;
}

/** 进程级缓存：键含 mtime 与大小，文件一改就自然失效。 */
const cache = new Map<string, string>();

export function clearFileIconCache(): void {
	cache.clear();
}

function runIconScript(script: string): Promise<string> {
	return new Promise<string>(resolve => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-Command', script],
			{ timeout: 15000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout) => {
				resolve(error ? '' : String(stdout ?? ''));
			},
		);
	});
}

/**
 * 批量取图标。返回 `路径 → data:image/png;base64,...`；取不到的不出现在结果里，
 * 调用方据此回退到图标主题。
 */
export async function extractFileIcons(
	candidates: readonly IconCandidate[],
	platform: NodeJS.Platform = process.platform,
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	const pending: IconCandidate[] = [];

	for (const candidate of candidates.slice(0, MAX_ICONS_PER_LEVEL)) {
		if (!isIconBearingFile(candidate.path)) {
			continue;
		}
		const key = iconCacheKey(candidate);
		const hit = cache.get(key);
		if (hit) {
			result.set(candidate.path, hit);
			continue;
		}
		pending.push(candidate);
	}

	if (!supportsFileIcons(platform) || pending.length === 0) {
		return result;
	}

	const stdout = await runIconScript(buildFileIconScript(pending.map(item => item.path)));
	const extracted = parseFileIconOutput(stdout);
	for (const candidate of pending) {
		const uri = extracted.get(candidate.path);
		if (!uri) {
			continue;
		}
		cache.set(iconCacheKey(candidate), uri);
		result.set(candidate.path, uri);
	}
	return result;
}
