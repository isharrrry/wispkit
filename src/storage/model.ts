import type { ResourceFolderNode } from '../resourceTree/model';

/**
 * 「存储器」区域的纯数据层。
 *
 * 这里刻意不 import vscode / child_process：Windows / Linux / macOS 的原始探测
 * 结果都先归一成普通对象，再在这里组装成树节点，方便在 mocha 里直接断言。
 *
 * 树分两层（最多三层）：
 *   - 设备：物理磁盘 / U 盘 / 网络位置 / 其他卷；
 *   - 分区或挂载点：磁盘下的分区（有盘符时本身就是可浏览的挂载点），
 *     网络位置下的 `Z:\` / `/mnt/share` 等。
 *
 * 挂载点节点在结构上就是 `ResourceFolderNode`（type = 'folder'），这样资源树
 * 已有的「浏览文件夹 / 复制路径 / 终端 / 在 VS Code 中打开…」命令无需改签名就能
 * 直接复用，右键菜单效果与上方树节点完全一致。
 */

export type StorageDeviceKind = 'disk' | 'removable' | 'network' | 'optical' | 'other';

/** 挂载点节点：同时满足资源树 folder 节点的形状，供命令层复用。 */
export interface StorageMountNode extends ResourceFolderNode {
	readonly storageMount: true;
	/** TreeItem description 用的容量说明。 */
	readonly sizeText: string;
	/** 悬停提示（路径、容量、驱动器类型）。 */
	readonly tooltipText: string;
}

/** 无法浏览的信息行（未挂载分区、空光驱、枚举失败等）。 */
export interface StorageInfoNode {
	readonly type: 'storageInfo';
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly tooltip: string;
	readonly children: readonly [];
}

export interface StorageDeviceNode {
	readonly type: 'storageDevice';
	readonly id: string;
	readonly name: string;
	readonly kind: StorageDeviceKind;
	readonly description: string;
	readonly tooltip: string;
	readonly children: readonly StorageChildNode[];
}

export type StorageChildNode = StorageMountNode | StorageInfoNode;
export type StorageNode = StorageDeviceNode | StorageChildNode;

export function isStorageDevice(node: StorageNode): node is StorageDeviceNode {
	return node.type === 'storageDevice';
}

export function isStorageMount(node: StorageNode): node is StorageMountNode {
	return node.type === 'folder' && node.storageMount === true;
}

export function isStorageInfo(node: StorageNode): node is StorageInfoNode {
	return node.type === 'storageInfo';
}

// ── Windows 原始探测结果 ────────────────────────────────────────────────

export interface WindowsRawDisk {
	readonly deviceId: string;
	readonly index: number;
	readonly model?: string;
	readonly mediaType?: string;
	readonly interfaceType?: string;
	readonly size?: number;
}

export interface WindowsRawPartition {
	readonly deviceId: string;
	readonly diskIndex: number;
	readonly index: number;
	readonly name?: string;
	readonly size?: number;
	readonly type?: string;
}

export interface WindowsRawVolume {
	readonly deviceId: string;
	readonly driveType: number;
	readonly label?: string;
	readonly size?: number;
	readonly freeSpace?: number;
	readonly providerName?: string;
}

export interface WindowsStorageSnapshot {
	readonly disks: readonly WindowsRawDisk[];
	readonly partitions: readonly WindowsRawPartition[];
	readonly volumes: readonly WindowsRawVolume[];
	readonly diskPartitions: ReadonlyArray<{ readonly disk: string; readonly partition: string }>;
	readonly partitionVolumes: ReadonlyArray<{ readonly partition: string; readonly volume: string }>;
}

// ── 跨平台挂载表 ────────────────────────────────────────────────────────

export interface RawMountEntry {
	/** 设备名：`/dev/sda1`、`/dev/disk3s1`、`//server/share`。 */
	readonly device: string;
	/** 挂载路径：`/`、`/home`、`/Volumes/Data`。 */
	readonly path: string;
	/** 文件系统类型：ext4、ntfs、nfs4、cifs、apfs、smbfs… */
	readonly fsType: string;
}

/** 卷类型（与 Win32_LogicalDisk.DriveType 对齐）。 */
export const DRIVE_TYPE_REMOVABLE = 2;
export const DRIVE_TYPE_FIXED = 3;
export const DRIVE_TYPE_NETWORK = 4;
export const DRIVE_TYPE_CDROM = 5;
export const DRIVE_TYPE_RAM = 6;

export function driveTypeLabel(type: number): string {
	switch (type) {
		case DRIVE_TYPE_REMOVABLE:
			return '可移动磁盘';
		case DRIVE_TYPE_FIXED:
			return '本地磁盘';
		case DRIVE_TYPE_NETWORK:
			return '网络驱动器';
		case DRIVE_TYPE_CDROM:
			return '光盘';
		case DRIVE_TYPE_RAM:
			return 'RAM 磁盘';
		default:
			return '卷';
	}
}

/**
 * 容量格式化：二进制单位，最多一位小数（大于 100 时取整）。
 * 传入 undefined / NaN 返回空串，调用方据此显示「容量未知」。
 */
export function formatBytes(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) {
		return '';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let amount = value;
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	const digits = unit === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
	return `${amount.toFixed(digits)} ${units[unit]}`;
}

function trimmed(value: string | undefined): string {
	return (value ?? '').trim();
}

function windowsMountPath(deviceId: string): string {
	const letter = deviceId.endsWith(':') ? deviceId : `${deviceId}:`;
	return `${letter}\\`;
}

function makeMountNode(
	volume: WindowsRawVolume,
	context: { partitionLabel?: string; fsType?: string; network?: boolean },
): StorageMountNode {
	const path = windowsMountPath(volume.deviceId);
	const label = trimmed(volume.label);
	const letter = volume.deviceId.endsWith(':') ? volume.deviceId : `${volume.deviceId}:`;
	// 盘符放在最前面，和资源管理器一致：`C: Windows` / `C: 本地磁盘`。
	const name = `${letter} ${label || driveTypeLabel(volume.driveType)}`;
	const total = formatBytes(volume.size);
	const free = formatBytes(volume.freeSpace);
	const sizeText = total
		? `${total}${free ? `，可用 ${free}` : ''}`
		: '容量未知（可能未就绪）';
	const lines = [
		name,
		`挂载点：${path}`,
		`类型：${driveTypeLabel(volume.driveType)}`,
	];
	if (label) {
		lines.push(`卷标：${label}`);
	}
	if (volume.providerName) {
		lines.push(`网络路径：${volume.providerName}`);
	}
	if (context.partitionLabel) {
		lines.push(`分区：${context.partitionLabel}`);
	}
	if (context.fsType) {
		lines.push(`文件系统：${context.fsType}`);
	}
	lines.push(`容量：${total || '未知'}${free ? `（可用 ${free}）` : ''}`);
	if (context.network) {
		lines.push('网络位置：展开后单击即可浏览；右键菜单与上方资源树文件夹节点一致');
	} else {
		lines.push('单击在 Wispkit 子树浏览器中打开；右键菜单与上方资源树文件夹节点一致');
	}
	return {
		type: 'folder',
		storageMount: true,
		id: `storage:mount:${path}`,
		name,
		path,
		children: [],
		sizeText,
		tooltipText: lines.join('\n'),
	};
}

export function makeInfoNode(id: string, name: string, description: string, tooltip: string): StorageInfoNode {
	return { type: 'storageInfo', id, name, description, tooltip, children: [] };
}

function diskNodeChildren(
	disk: WindowsRawDisk,
	partitions: readonly WindowsRawPartition[],
	volumeOfPartition: (partitionId: string) => WindowsRawVolume | undefined,
): StorageChildNode[] {
	const children: StorageChildNode[] = [];
	for (const partition of [...partitions].sort((left, right) => left.index - right.index)) {
		const volume = volumeOfPartition(partition.deviceId);
		if (volume) {
			children.push(makeMountNode(volume, { partitionLabel: partition.name }));
			continue;
		}
		const size = formatBytes(partition.size);
		children.push(makeInfoNode(
			`storage:partition:${partition.deviceId}`,
			`分区 ${partition.index}（未挂载）`,
			[size, partition.type].filter(Boolean).join(' · '),
			[
				partition.name ?? `分区 ${partition.index}`,
				`类型：${partition.type ?? '未知'}`,
				`容量：${size || '未知'}`,
				'该分区没有盘符或挂载点；可在系统磁盘管理中分配后刷新。',
			].join('\n'),
		));
	}
	if (children.length === 0) {
		children.push(makeInfoNode(
			`storage:disk:${disk.index}:empty`,
			'没有可浏览的分区',
			'未检测到已挂载分区',
			'该磁盘没有分区或分区均未挂载。',
		));
	}
	return children;
}

/**
 * Win32 原始数据 → 存储器树。
 *
 * 关联表（Win32_DiskDriveToDiskPartition / Win32_LogicalDiskToPartition）可能
 * 缺项：此时用 `diskIndex` 兜底把分区归到磁盘；仍归不上的卷放进「其他卷」，
 * 保证不会因为个别设备没有关联信息就整体消失。
 */
export function buildWindowsStorageTree(snapshot: WindowsStorageSnapshot): StorageDeviceNode[] {
	const volumeByLetter = new Map<string, WindowsRawVolume>();
	for (const volume of snapshot.volumes) {
		volumeByLetter.set(volume.deviceId.toUpperCase(), volume);
	}
	const volumeOfPartition = new Map<string, string>();
	for (const link of snapshot.partitionVolumes) {
		volumeOfPartition.set(link.partition, link.volume.toUpperCase());
	}
	const partitionsOfDisk = new Map<string, string[]>();
	for (const link of snapshot.diskPartitions) {
		const list = partitionsOfDisk.get(link.disk) ?? [];
		list.push(link.partition);
		partitionsOfDisk.set(link.disk, list);
	}

	const usedVolumes = new Set<string>();
	const devices: StorageDeviceNode[] = [];
	const sortedDisks = [...snapshot.disks].sort((left, right) => left.index - right.index);
	for (const disk of sortedDisks) {
		let partitions = (partitionsOfDisk.get(disk.deviceId) ?? [])
			.map(id => snapshot.partitions.find(partition => partition.deviceId === id))
			.filter((value): value is WindowsRawPartition => value !== undefined);
		if (partitions.length === 0) {
			partitions = snapshot.partitions.filter(partition => partition.diskIndex === disk.index);
		}
		const children = diskNodeChildren(disk, partitions, partitionId => {
			const volumeId = volumeOfPartition.get(partitionId);
			if (!volumeId) {
				return undefined;
			}
			const volume = volumeByLetter.get(volumeId);
			if (volume) {
				usedVolumes.add(volume.deviceId.toUpperCase());
			}
			return volume;
		});
		const model = trimmed(disk.model) || `磁盘 ${disk.index}`;
		const removable = /removable/i.test(disk.mediaType ?? '')
			|| /usb/i.test(disk.interfaceType ?? '')
			|| /removable/i.test(disk.model ?? '');
		const size = formatBytes(disk.size);
		const kind: StorageDeviceKind = removable ? 'removable' : 'disk';
		devices.push({
			type: 'storageDevice',
			id: `storage:disk:${disk.index}`,
			name: `${model}（磁盘 ${disk.index}）`,
			kind,
			description: [size, removable ? '可移动' : '', `${children.filter(isStorageMount).length} 个挂载点`]
				.filter(Boolean)
				.join(' · '),
			tooltip: [
				`磁盘 ${disk.index}：${model}`,
				disk.mediaType ? `介质：${disk.mediaType}` : '',
				disk.interfaceType ? `接口：${disk.interfaceType}` : '',
				`容量：${size || '未知'}`,
			].filter(Boolean).join('\n'),
			children,
		});
	}

	const remaining = snapshot.volumes.filter(volume => !usedVolumes.has(volume.deviceId.toUpperCase()));
	const network = remaining.filter(volume => volume.driveType === DRIVE_TYPE_NETWORK);
	if (network.length > 0) {
		devices.push({
			type: 'storageDevice',
			id: 'storage:network',
			name: '网络位置',
			kind: 'network',
			description: `${network.length} 个网络驱动器`,
			tooltip: '系统里已映射的网络驱动器；展开后是各自的挂载点。',
			children: network.map(volume => makeMountNode(volume, { network: true })),
		});
	}
	const others = remaining.filter(volume => volume.driveType !== DRIVE_TYPE_NETWORK);
	if (others.length > 0) {
		const hasOptical = others.some(volume => volume.driveType === DRIVE_TYPE_CDROM);
		devices.push({
			type: 'storageDevice',
			id: 'storage:other',
			name: hasOptical ? '光盘 / 其他卷' : '其他卷',
			kind: hasOptical ? 'optical' : 'other',
			description: `${others.length} 个卷`,
			tooltip: '没有关联到物理磁盘的卷（光盘、虚拟盘、Subst 等）。',
			children: others.map(volume => makeMountNode(volume, {})),
		});
	}
	return devices;
}

// ── Linux / macOS 挂载表 ─────────────────────────────────────────────────

const NETWORK_FS = /^(nfs4?|cifs|smbfs|sshfs|fuse\.sshfs|davfs|davfs2|webdav|afpfs|9p)$/i;
const PSEUDO_FS = /^(proc|sysfs|devtmpfs|devfs|devpts|tmpfs|ramfs|cgroup2?|pstore|securityfs|debugfs|tracefs|configfs|fusectl|mqueue|hugetlbfs|binfmt_misc|autofs|overlay|efivarfs|bpf|squashfs|nsfs|rpc_pipefs|selinuxfs|fuse\.gvfsd-fuse|fuse\.lxcfs|fuse\.portal|map auto_home)$/i;
const PSEUDO_PATH = /^\/(proc|sys|snap)(\/|$)/;
const SYSTEM_PATHS = new Set(['/dev']);

/** `/dev/sda1` → `/dev/sda`；`/dev/nvme0n1p2` → `/dev/nvme0n1`；其他设备原样。 */
export function baseBlockDevice(device: string): string {
	const mac = /^(\/dev\/disk\d+)(?:s\d+)+$/.exec(device);
	if (mac) {
		return mac[1];
	}
	const match = /^(\/dev\/(?:sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+))p?\d+$/.exec(device);
	return match ? match[1] : device;
}

function mountNameFor(mountPath: string, fsType: string): string {
	if (mountPath === '/') {
		return `/（${fsType}）`;
	}
	return `${mountPath}（${fsType}）`;
}

/**
 * Linux / macOS 的挂载表 → 存储器树。
 *
 * - 真实块设备按「整盘」归组，分区作为挂载点；
 * - 网络文件系统统一放进「网络位置」；
 * - 伪文件系统（proc/tmpfs/overlay…）不展示，避免列表被几十条系统挂载淹没。
 */
export function buildPosixStorageTree(
	mounts: readonly RawMountEntry[],
	options: { readonly removable?: ReadonlySet<string> } = {},
): StorageDeviceNode[] {
	const removable = options.removable ?? new Set<string>();
	const groups = new Map<string, {
		base: string;
		first: RawMountEntry;
		children: StorageMountNode[];
	}>();
	const networkChildren: StorageMountNode[] = [];

	for (const mount of mounts) {
		const fsType = mount.fsType.trim();
		const path = mount.path.trim();
		if (!path) {
			continue;
		}
		if (NETWORK_FS.test(fsType)) {
			networkChildren.push(makePosixMountNode(mount, true, false));
			continue;
		}
		if (PSEUDO_FS.test(fsType) || PSEUDO_PATH.test(path) || SYSTEM_PATHS.has(path)) {
			continue;
		}
		if (!mount.device.startsWith('/dev/')) {
			// 没有真实设备的挂载（overlay、rootfs、map auto_home…）跳过。
			continue;
		}
		const base = baseBlockDevice(mount.device);
		const node = makePosixMountNode(mount, false, removable.has(base));
		const group = groups.get(base);
		if (group) {
			group.children.push(node);
		} else {
			groups.set(base, { base, first: mount, children: [node] });
		}
	}

	const result: StorageDeviceNode[] = [];
	for (const group of groups.values()) {
		const name = posixDiskName(group.base);
		result.push({
			type: 'storageDevice',
			id: `storage:block:${group.base}`,
			name: `${name.startsWith('磁盘 ') ? name : `磁盘 ${name}`}${removable.has(group.base) ? '（可移动）' : ''}`,
			kind: removable.has(group.base) ? 'removable' : 'disk',
			description: mountNameFor(group.first.path, group.first.fsType),
			tooltip: [
				`设备：${group.base}`,
				removable.has(group.base) ? '介质：可移动' : '',
			].filter(Boolean).join('\n'),
			children: group.children,
		});
	}
	if (networkChildren.length > 0) {
		result.push({
			type: 'storageDevice',
			id: 'storage:network',
			name: '网络位置',
			kind: 'network',
			description: `${networkChildren.length} 个网络挂载`,
			tooltip: 'nfs / cifs / sshfs 等网络挂载点。',
			children: networkChildren,
		});
	}
	return result;
}

function makePosixMountNode(mount: RawMountEntry, network: boolean, removable: boolean): StorageMountNode {
	const device = mount.device.trim();
	const name = network && device.startsWith('//')
		? `${mount.path}（${device}）`
		: mountNameFor(mount.path, mount.fsType);
	const lines = [
		name,
		`挂载点：${mount.path}`,
		`设备：${device || '未知'}`,
		`文件系统：${mount.fsType || '未知'}`,
	];
	if (removable) {
		lines.push('介质：可移动');
	}
	lines.push('单击在 Wispkit 子树浏览器中打开；右键菜单与上方资源树文件夹节点一致');
	return {
		type: 'folder',
		storageMount: true,
		id: `storage:mount:${mount.path}`,
		name,
		path: mount.path,
		children: [],
		sizeText: mount.fsType,
		tooltipText: lines.join('\n'),
	};
}

/**
 * 解析 `/proc/mounts`（空格转义为 `\040` 等八进制）。
 * 测试时直接喂字符串，不需要真的在 Linux 上跑。
 */
export function parseProcMounts(text: string): RawMountEntry[] {
	const entries: RawMountEntry[] = [];
	for (const line of text.split(/\r?\n/)) {
		const columns = line.trim().split(/\s+/);
		if (columns.length < 3 || columns[0].startsWith('#')) {
			continue;
		}
		entries.push({
			device: unescapeMountField(columns[0]),
			path: unescapeMountField(columns[1]),
			fsType: unescapeMountField(columns[2]),
		});
	}
	return entries;
}

/**
 * 解析 macOS `mount` 输出：
 *   `/dev/disk3s1 on / (apfs, local, read-only, journaled)`
 *   `//user@host/share on /Volumes/share (smbfs, nodev, mounted by user)`
 */
export function parseMacMountOutput(text: string): RawMountEntry[] {
	const entries: RawMountEntry[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = /^(.+?) on (.+?) \(([^)]*)\)\s*$/.exec(line.trim());
		if (!match) {
			continue;
		}
		const options = match[3].split(',').map(item => item.trim()).filter(Boolean);
		entries.push({
			device: match[1].trim(),
			path: match[2].trim(),
			fsType: options[0] ?? 'unknown',
		});
	}
	return entries;
}

/** macOS / Linux 设备名 → 展示用的整盘名（不含“磁盘”前缀时由调用方补）。 */
export function posixDiskName(device: string): string {
	const mac = /^\/dev\/disk(\d+)/.exec(device);
	if (mac) {
		return `磁盘 ${mac[1]}`;
	}
	return baseBlockDevice(device).replace(/^\/dev\//, '') || device;
}

function unescapeMountField(value: string): string {
	return value.replace(/\\([0-7]{3})/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)));
}
