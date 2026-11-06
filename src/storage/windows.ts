import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
	buildWindowsStorageTree,
	type StorageDeviceNode,
	type WindowsRawDisk,
	type WindowsRawPartition,
	type WindowsRawVolume,
	type WindowsStorageSnapshot,
} from './model';

/**
 * Windows 存储器探测。
 *
 * 走 PowerShell + CIM，而不是 WMI COM / wmic：
 *   - `Get-CimInstance` 在 Windows 8+ 都存在，wmic 已被微软标记弃用；
 *   - 使用 `-EncodedCommand` 传脚本，避免中文卷标 / 引号在多级转义中损坏；
 *   - 输出 JSON，解析完全放在纯函数里，可离线写单测。
 *
 * CIM 不可用时（极精简系统 / PowerShell 被策略禁用）退化为 `Get-PSDrive`：
 * 拿不到物理磁盘分组，但至少能列出所有可访问的盘符，不会整个区域报错。
 */

const execFileAsync = promisify(execFile);

/** 当前脚本：磁盘 / 分区 / 逻辑卷 + 两张关联表。 */
export const WINDOWS_STORAGE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Num($value) {
  if ($null -eq $value) { return $null }
  try { return [double]$value } catch { return $null }
}
$disks = @(Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    deviceId = [string]$_.DeviceID
    index = [int]$_.Index
    model = [string]$_.Model
    mediaType = [string]$_.MediaType
    interfaceType = [string]$_.InterfaceType
    size = Num $_.Size
  }
})
$partitions = @(Get-CimInstance -ClassName Win32_DiskPartition -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    deviceId = [string]$_.DeviceID
    diskIndex = [int]$_.DiskIndex
    index = [int]$_.Index
    name = [string]$_.Name
    size = Num $_.Size
    type = [string]$_.Type
  }
})
$volumes = @(Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    deviceId = [string]$_.DeviceID
    driveType = [int]$_.DriveType
    label = [string]$_.VolumeName
    size = Num $_.Size
    freeSpace = Num $_.FreeSpace
    providerName = [string]$_.ProviderName
  }
})
$diskPartitions = @(Get-CimInstance -ClassName Win32_DiskDriveToDiskPartition -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{ disk = [string]$_.Antecedent.DeviceID; partition = [string]$_.Dependent.DeviceID }
})
$partitionVolumes = @(Get-CimInstance -ClassName Win32_LogicalDiskToPartition -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{ partition = [string]$_.Antecedent.DeviceID; volume = [string]$_.Dependent.DeviceID }
})
[pscustomobject]@{
  disks = $disks
  partitions = $partitions
  volumes = $volumes
  diskPartitions = $diskPartitions
  partitionVolumes = $partitionVolumes
} | ConvertTo-Json -Depth 8 -Compress
`.trim();

/** 退化脚本：只列盘符（没有物理磁盘 / 分区层级）。 */
export const WINDOWS_PSDRIVE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$volumes = @(Get-PSDrive -PSProvider FileSystem -ErrorAction Stop | ForEach-Object {
  $used = 0; $free = 0
  try { $used = [double]$_.Used } catch { }
  try { $free = [double]$_.Free } catch { }
  $type = 3
  if ($_.DisplayRoot -and $_.DisplayRoot.StartsWith('\\\\')) { $type = 4 }
  $size = $null
  $freeSpace = $null
  if ($used + $free -gt 0) { $size = $used + $free; $freeSpace = $free }
  [pscustomobject]@{
    deviceId = [string]$_.Name + ':'
    driveType = $type
    label = [string]$_.Description
    size = $size
    freeSpace = $freeSpace
    providerName = [string]$_.DisplayRoot
  }
})
[pscustomobject]@{
  disks = @()
  partitions = @()
  volumes = $volumes
  diskPartitions = @()
  partitionVolumes = @()
} | ConvertTo-Json -Depth 8 -Compress
`.trim();

export function encodePowerShellCommand(script: string): string {
	return Buffer.from(script, 'utf16le').toString('base64');
}

export async function runPowerShell(script: string, timeoutMs = 20_000): Promise<string> {
	const { stdout } = await execFileAsync(
		'powershell.exe',
		['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellCommand(script)],
		{
			windowsHide: true,
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024,
			encoding: 'utf8',
		},
	);
	return stdout;
}

// ── 纯解析 ──────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function asArray(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	return value === undefined || value === null ? [] : [value];
}

function text(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number') {
		return String(value);
	}
	return undefined;
}

function number(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * PowerShell JSON → 归一化快照。
 *
 * 对字段缺失 / 单对象被序列化成对象（PowerShell 对单元素数组的习惯）都做容错：
 * 读系统信息不该因为某个磁盘少一个字段就整个区域失败。
 */
export function parseWindowsStorageSnapshot(raw: string): WindowsStorageSnapshot {
	const parsed: unknown = JSON.parse(raw);
	const root = asRecord(parsed) ?? {};
	const disks: WindowsRawDisk[] = asArray(root.disks).flatMap(item => {
		const record = asRecord(item);
		if (!record) {
			return [];
		}
		const deviceId = text(record.deviceId) ?? '';
		const index = number(record.index);
		if (!deviceId || index === undefined) {
			return [];
		}
		return [{
			deviceId,
			index,
			model: text(record.model),
			mediaType: text(record.mediaType),
			interfaceType: text(record.interfaceType),
			size: number(record.size),
		}];
	});
	const partitions: WindowsRawPartition[] = asArray(root.partitions).flatMap(item => {
		const record = asRecord(item);
		if (!record) {
			return [];
		}
		const deviceId = text(record.deviceId) ?? '';
		const diskIndex = number(record.diskIndex);
		const index = number(record.index);
		if (!deviceId || diskIndex === undefined || index === undefined) {
			return [];
		}
		return [{
			deviceId,
			diskIndex,
			index,
			name: text(record.name),
			size: number(record.size),
			type: text(record.type),
		}];
	});
	const volumes: WindowsRawVolume[] = asArray(root.volumes).flatMap(item => {
		const record = asRecord(item);
		if (!record) {
			return [];
		}
		const deviceId = text(record.deviceId) ?? '';
		const driveType = number(record.driveType);
		if (!deviceId || driveType === undefined) {
			return [];
		}
		return [{
			deviceId,
			driveType,
			label: text(record.label),
			size: number(record.size),
			freeSpace: number(record.freeSpace),
			providerName: text(record.providerName),
		}];
	});
	const diskPartitions = asArray(root.diskPartitions).flatMap(item => {
		const record = asRecord(item);
		const disk = text(record?.disk);
		const partition = text(record?.partition);
		return disk && partition ? [{ disk, partition }] : [];
	});
	const partitionVolumes = asArray(root.partitionVolumes).flatMap(item => {
		const record = asRecord(item);
		const partition = text(record?.partition);
		const volume = text(record?.volume);
		return partition && volume ? [{ partition, volume }] : [];
	});
	return { disks, partitions, volumes, diskPartitions, partitionVolumes };
}

function errorText(error: unknown): string {
	if (error instanceof Error) {
		const detail = (error as { stderr?: string }).stderr;
		return detail ? `${error.message}（${String(detail).trim().slice(0, 300)}）` : error.message;
	}
	return String(error);
}

export async function enumerateWindowsStorage(): Promise<StorageDeviceNode[]> {
	try {
		const text = await runPowerShell(WINDOWS_STORAGE_SCRIPT);
		return buildWindowsStorageTree(parseWindowsStorageSnapshot(text));
	} catch (primary) {
		console.warn('[wispkit-storage] CIM 枚举失败，退化为 Get-PSDrive：', primary);
		try {
			const text = await runPowerShell(WINDOWS_PSDRIVE_SCRIPT, 10_000);
			return buildWindowsStorageTree(parseWindowsStorageSnapshot(text));
		} catch (fallback) {
			throw new Error(`无法枚举系统存储器：${errorText(primary)}；备用方式也失败：${errorText(fallback)}`);
		}
	}
}
