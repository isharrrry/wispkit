import type { StorageDeviceNode } from './model';
import { enumerateDarwinStorage, enumerateLinuxStorage } from './posix';
import { enumerateWindowsStorage } from './windows';

/**
 * 当前平台的系统存储器枚举入口。
 *
 * provider 只依赖这个函数，平台差异全部收敛在 storage/ 目录里；
 * 单元测试则直接测各平台的纯解析函数，不依赖真实设备。
 */
export async function enumerateStorageNodes(): Promise<StorageDeviceNode[]> {
	if (process.platform === 'win32') {
		return enumerateWindowsStorage();
	}
	if (process.platform === 'darwin') {
		return enumerateDarwinStorage();
	}
	return enumerateLinuxStorage();
}
