import * as assert from 'assert';
import {
	baseBlockDevice,
	buildPosixStorageTree,
	buildWindowsStorageTree,
	formatBytes,
	isStorageInfo,
	isStorageMount,
	parseMacMountOutput,
	parseProcMounts,
	type StorageMountNode,
	type WindowsStorageSnapshot,
} from '../storage/model';
import { parseWindowsStorageSnapshot } from '../storage/windows';

/**
 * 存储器树是「系统真实设备 → 用户看到的条目」的唯一映射层。
 * 这里用固定样本锁定：设备分组、挂载点形状（必须能直接喂给资源树命令）、
 * 未挂载分区 / 网络位置 / 无盘符卷的兜底。
 */

function sampleSnapshot(): WindowsStorageSnapshot {
	return {
		disks: [
			{ deviceId: '\\\\.\\PHYSICALDRIVE0', index: 0, model: 'KINGSTON SNVS1000GB', mediaType: 'Fixed hard disk media', interfaceType: 'SCSI', size: 1000202273280 },
			{ deviceId: '\\\\.\\PHYSICALDRIVE1', index: 1, model: 'USB Mass Storage Device', mediaType: 'Removable Media', interfaceType: 'USB', size: 31000000000 },
		],
		partitions: [
			{ deviceId: 'Disk #0, Partition #0', diskIndex: 0, index: 0, name: '磁盘 #0，分区 #0', size: 994801553408, type: 'GPT: Basic Data' },
			{ deviceId: 'Disk #0, Partition #1', diskIndex: 0, index: 1, name: '磁盘 #0，分区 #1', size: 33554432, type: 'GPT: Basic Data' },
			{ deviceId: 'Disk #1, Partition #0', diskIndex: 1, index: 0, name: '磁盘 #1，分区 #0', size: 31000000000, type: 'GPT: Basic Data' },
		],
		volumes: [
			{ deviceId: 'C:', driveType: 3, label: 'Win11ProW X64', size: 209712033792, freeSpace: 103316185088 },
			{ deviceId: 'D:', driveType: 3, label: 'LinksVentoy', size: 994801549312, freeSpace: 130328756224 },
			{ deviceId: 'E:', driveType: 3, label: 'U盘', size: 31000000000, freeSpace: 20000000000 },
			{ deviceId: 'Z:', driveType: 4, label: '共享盘', size: 500000000000, freeSpace: 100000000000, providerName: '\\\\server\\share' },
			{ deviceId: 'F:', driveType: 5, label: '' },
		],
		diskPartitions: [
			{ disk: '\\\\.\\PHYSICALDRIVE0', partition: 'Disk #0, Partition #0' },
			{ disk: '\\\\.\\PHYSICALDRIVE0', partition: 'Disk #0, Partition #1' },
			{ disk: '\\\\.\\PHYSICALDRIVE1', partition: 'Disk #1, Partition #0' },
		],
		partitionVolumes: [
			{ partition: 'Disk #0, Partition #0', volume: 'D:' },
			{ partition: 'Disk #1, Partition #0', volume: 'E:' },
		],
	};
}

describe('storage/model formatBytes', () => {
	it('按 1024 进制格式化，未知容量返回空串', () => {
		assert.strictEqual(formatBytes(undefined), '');
		assert.strictEqual(formatBytes(Number.NaN), '');
		assert.strictEqual(formatBytes(512), '512 B');
		assert.strictEqual(formatBytes(1024), '1.00 KB');
		assert.strictEqual(formatBytes(994801549312), '926 GB');
		assert.strictEqual(formatBytes(103316185088), '96.2 GB');
	});
});

describe('storage/model Windows 树', () => {
	it('物理磁盘 → 分区（有盘符即挂载点），U 盘标为可移动', () => {
		const devices = buildWindowsStorageTree(sampleSnapshot());
		const disk0 = devices.find(device => device.id === 'storage:disk:0');
		const disk1 = devices.find(device => device.id === 'storage:disk:1');
		assert.ok(disk0 && disk1);
		assert.strictEqual(disk0.kind, 'disk');
		assert.strictEqual(disk1.kind, 'removable');
		assert.ok(disk1.name.includes('USB Mass Storage Device'));

		const mountD = disk0.children.find(node => isStorageMount(node) && node.path.startsWith('D:'));
		assert.ok(mountD, 'D 盘必须出现在磁盘 0 下');
		assert.strictEqual((mountD as StorageMountNode).type, 'folder');
		assert.strictEqual((mountD as StorageMountNode).storageMount, true);
		assert.strictEqual((mountD as StorageMountNode).path, 'D:\\');
		assert.deepStrictEqual((mountD as StorageMountNode).children, []);
		assert.ok((mountD as StorageMountNode).name.includes('LinksVentoy'));
		assert.ok((mountD as StorageMountNode).sizeText.includes('可用'));

		const mountE = disk1.children.find(node => isStorageMount(node));
		assert.ok(mountE, 'U 盘分区必须有挂载点');
		assert.strictEqual((mountE as StorageMountNode).path, 'E:\\');
	});

	it('无盘符分区显示为信息行，不伪装成可浏览目录', () => {
		const devices = buildWindowsStorageTree(sampleSnapshot());
		const disk0 = devices.find(device => device.id === 'storage:disk:0');
		assert.ok(disk0);
		const info = disk0.children.find(node => isStorageInfo(node));
		assert.ok(info, 'Partition #1 没有卷，应显示未挂载信息行');
		assert.ok((info as { name: string }).name.includes('未挂载'));
	});

	it('未关联到磁盘的网络卷归入「网络位置」，光盘 / 其他卷归入「其他卷」', () => {
		const devices = buildWindowsStorageTree(sampleSnapshot());
		const network = devices.find(device => device.id === 'storage:network');
		const other = devices.find(device => device.id === 'storage:other');
		assert.ok(network && other);
		assert.strictEqual(network.kind, 'network');
		assert.ok(network.children.every(isStorageMount));
		assert.strictEqual((network.children[0] as StorageMountNode).path, 'Z:\\');
		assert.ok((network.children[0] as StorageMountNode).tooltipText.includes('\\\\server\\share'));
		assert.ok(other.name.includes('光盘'));
		assert.ok(other.children.every(isStorageMount));
	});

	it('关联表缺失时用 diskIndex 兜底，不会丢失分区', () => {
		const snapshot = sampleSnapshot();
		const devices = buildWindowsStorageTree({
			...snapshot,
			diskPartitions: [],
			partitionVolumes: [],
		});
		const disk0 = devices.find(device => device.id === 'storage:disk:0');
		assert.ok(disk0);
		assert.strictEqual(disk0.children.length, 2, '磁盘 0 的两个分区都应通过 diskIndex 归组');
		assert.ok(disk0.children.every(isStorageInfo), '没有盘符关联时都是信息行');
	});

	it('没有任何设备时返回空数组，交给 provider 显示空状态', () => {
		assert.deepStrictEqual(buildWindowsStorageTree({
			disks: [], partitions: [], volumes: [], diskPartitions: [], partitionVolumes: [],
		}), []);
	});
});

describe('storage/windows 解析', () => {
	it('解析 PowerShell JSON，单对象和数组都接受', () => {
		const snapshot = parseWindowsStorageSnapshot(JSON.stringify({
			disks: { deviceId: '\\\\.\\PHYSICALDRIVE0', index: '0', model: 'X', size: '1024' },
			partitions: [],
			volumes: [{ deviceId: 'C:', driveType: '3', size: null, freeSpace: 512 }],
			diskPartitions: { disk: 'd', partition: 'p' },
			partitionVolumes: [],
		}));
		assert.strictEqual(snapshot.disks.length, 1);
		assert.strictEqual(snapshot.disks[0].index, 0);
		assert.strictEqual(snapshot.disks[0].size, 1024);
		assert.strictEqual(snapshot.volumes[0].driveType, 3);
		assert.strictEqual(snapshot.volumes[0].size, undefined);
		assert.deepStrictEqual(snapshot.diskPartitions, [{ disk: 'd', partition: 'p' }]);
	});

	it('缺字段 / 非对象条目被跳过而不是抛错', () => {
		const snapshot = parseWindowsStorageSnapshot(JSON.stringify({
			disks: [{ model: '没有 DeviceID' }, { deviceId: 'x', index: 1 }],
			volumes: [null, 'bad', { deviceId: 'C:', driveType: 3 }],
		}));
		assert.strictEqual(snapshot.disks.length, 1);
		assert.strictEqual(snapshot.volumes.length, 1);
	});
});

describe('storage/model POSIX 树', () => {
	it('parseProcMounts 处理八进制转义与注释/短行', () => {
		const entries = parseProcMounts([
			'/dev/sda1 / ext4 rw,relatime 0 0',
			'/dev/sdb1 /media/My\\040Disk vfat rw 0 0',
			'# comment line',
			'tmpfs /run tmpfs rw 0 0',
		].join('\n'));
		assert.strictEqual(entries.length, 3);
		assert.strictEqual(entries[1].path, '/media/My Disk');
	});

	it('真实块设备按整盘归组，U 盘可移动标记生效，伪文件系统被过滤', () => {
		const devices = buildPosixStorageTree(parseProcMounts([
			'/dev/sda1 / ext4 rw 0 0',
			'/dev/sda2 /home ext4 rw 0 0',
			'/dev/sdb1 /media/USB vfat rw 0 0',
			'tmpfs /run tmpfs rw 0 0',
			'proc /proc proc rw 0 0',
			'/dev/sr0 /media/cdrom iso9660 ro 0 0',
		].join('\n')), { removable: new Set(['/dev/sdb']) });
		const sda = devices.find(device => device.id === 'storage:block:/dev/sda');
		const sdb = devices.find(device => device.id === 'storage:block:/dev/sdb');
		assert.ok(sda && sdb);
		assert.strictEqual(sda.children.length, 2);
		assert.strictEqual(sdb.kind, 'removable');
		assert.strictEqual(sdb.children.length, 1);
		assert.strictEqual((sdb.children[0] as StorageMountNode).path, '/media/USB');
		assert.ok(baseBlockDevice('/dev/nvme0n1p2') === '/dev/nvme0n1');
	});

	it('网络文件系统归入「网络位置」，普通挂载不出现在那里', () => {
		const devices = buildPosixStorageTree(parseProcMounts([
			'/dev/sda1 / ext4 rw 0 0',
			'server:/export /mnt/nfs nfs4 rw 0 0',
			'//server/share /mnt/smb cifs rw 0 0',
		].join('\n')));
		const network = devices.find(device => device.id === 'storage:network');
		assert.ok(network);
		assert.strictEqual(network.kind, 'network');
		assert.strictEqual(network.children.length, 2);
		assert.ok(network.children.every(node => isStorageMount(node)));
	});

	it('parseMacMountOutput 解析 apfs 与 smbfs', () => {
		const entries = parseMacMountOutput([
			'/dev/disk3s1s1 on / (apfs, local, read-only, journaled)',
			'//user@host/share on /Volumes/share (smbfs, nodev, mounted by user)',
			'devfs on /dev (devfs, local, nobrowse)',
		].join('\n'));
		assert.strictEqual(entries.length, 3);
		assert.deepStrictEqual(entries[0], { device: '/dev/disk3s1s1', path: '/', fsType: 'apfs' });
		assert.strictEqual(entries[1].fsType, 'smbfs');
		const devices = buildPosixStorageTree(entries);
		assert.ok(devices.some(device => device.id === 'storage:block:/dev/disk3'));
		assert.ok(devices.some(device => device.kind === 'network'));
	});
});
