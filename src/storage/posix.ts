import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';
import {
	buildPosixStorageTree,
	parseMacMountOutput,
	parseProcMounts,
	type StorageDeviceNode,
} from './model';

const execFileAsync = promisify(execFile);

/**
 * Linux：读 `/proc/mounts` 拿挂载表，读 `/sys/block/*\/removable` 判断 U 盘。
 *
 * macOS：`mount` 输出里已经带文件系统类型和挂载路径，直接解析。
 * 两种方式都只做只读查询；失败时抛错，由 provider 显示一条可诊断的信息行。
 */

async function linuxRemovableSet(): Promise<Set<string>> {
	const result = new Set<string>();
	try {
		const names = await fs.readdir('/sys/block');
		await Promise.all(names.map(async name => {
			try {
				const value = (await fs.readFile(`/sys/block/${name}/removable`, 'utf8')).trim();
				if (value === '1') {
					result.add(`/dev/${name}`);
				}
			} catch {
				// 某些块设备没有 removable 属性，忽略。
			}
		}));
	} catch {
		// 容器 / WSL 里可能没有 /sys/block；没有可移动标记不影响主列表。
	}
	return result;
}

export async function enumerateLinuxStorage(): Promise<StorageDeviceNode[]> {
	const text = await fs.readFile('/proc/mounts', 'utf8');
	const removable = await linuxRemovableSet();
	return buildPosixStorageTree(parseProcMounts(text), { removable });
}

export async function enumerateDarwinStorage(): Promise<StorageDeviceNode[]> {
	const { stdout } = await execFileAsync('mount', [], {
		timeout: 10_000,
		maxBuffer: 2 * 1024 * 1024,
		encoding: 'utf8',
	});
	return buildPosixStorageTree(parseMacMountOutput(stdout));
}
