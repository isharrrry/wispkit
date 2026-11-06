import * as assert from 'node:assert/strict';
import { parseShellLink } from '../shellLink/lnk';
import type { LnkDetails } from '../shellLink/lnk';

/** LinkCLSID：00021401-0000-0000-C000-000000000046。 */
const CLSID = Buffer.from([
	0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);

const HEADER_SIZE = 0x4c;
const FLAG_HAS_LINK_INFO = 0x2;
const FLAG_HAS_NAME = 0x4;
const FLAG_HAS_RELATIVE_PATH = 0x8;
const FLAG_HAS_WORKING_DIR = 0x10;
const FLAG_HAS_ARGUMENTS = 0x20;
const FLAG_HAS_ICON_LOCATION = 0x40;
const FLAG_IS_UNICODE = 0x80;
const FLAG_HAS_LINK_TARGET_ID_LIST = 0x1;
const FLAG_FORCE_NO_LINK_INFO = 0x100;

/** 终结块：只有 4 字节的 BlockSize，没有签名。 */
const TERMINAL_BLOCK = Buffer.from([0x04, 0x00, 0x00, 0x00]);

/** FILETIME 是 100ns 自 1601-01-01 起的计数。 */
function filetimeBuffer(date: Date): Buffer {
	const value = (BigInt(date.getTime()) + 11644473600000n) * 10000n;
	const out = Buffer.alloc(8);
	out.writeBigUInt64LE(value, 0);
	return out;
}

/** 以 NUL 结尾的串：Unicode 用 UTF-16LE，ANSI 用 latin1。 */
function cstr(text: string, unicode: boolean): Buffer {
	return Buffer.from(`${text}\0`, unicode ? 'utf16le' : 'latin1');
}

interface HeaderOptions {
	readonly flags: number;
	readonly creation?: Date;
	readonly fileSize?: number;
	readonly iconIndex?: number;
	readonly showCommand?: number;
}

function buildHeader(options: HeaderOptions): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt32LE(HEADER_SIZE, 0);
	CLSID.copy(header, 4);
	header.writeUInt32LE(options.flags >>> 0, 20);
	header.writeUInt32LE(0x20, 24);
	if (options.creation) {
		filetimeBuffer(options.creation).copy(header, 28);
	}
	header.writeUInt32LE(options.fileSize ?? 0, 52);
	header.writeInt32LE(options.iconIndex ?? 0, 56);
	header.writeUInt32LE(options.showCommand ?? 1, 60);
	return header;
}

/** VolumeID：头部 0x10 字节，卷标紧跟其后（VolumeLabelOffset = 0x10）。 */
function buildVolumeId(serial: number, label: string): Buffer {
	const labelBytes = cstr(label, false);
	const out = Buffer.alloc(0x10 + labelBytes.length);
	out.writeUInt32LE(out.length, 0);
	out.writeUInt32LE(3, 4);
	out.writeUInt32LE(serial >>> 0, 8);
	out.writeUInt32LE(0x10, 12);
	labelBytes.copy(out, 0x10);
	return out;
}

interface AnsiLinkInfoOptions {
	readonly serial: number;
	readonly label: string;
	readonly basePath: string;
	readonly suffix: string;
}

/** LinkInfoHeaderSize = 0x1C 的形态：只有 ANSI 偏移。 */
function buildAnsiLinkInfo(options: AnsiLinkInfoOptions): Buffer {
	const volume = buildVolumeId(options.serial, options.label);
	const base = cstr(options.basePath, false);
	const suffix = cstr(options.suffix, false);
	const headerSize = 0x1c;
	const volumeIdOffset = headerSize;
	const localBasePathOffset = volumeIdOffset + volume.length;
	const commonPathSuffixOffset = localBasePathOffset + base.length;
	const size = commonPathSuffixOffset + suffix.length;

	const head = Buffer.alloc(headerSize);
	head.writeUInt32LE(size, 0);
	head.writeUInt32LE(headerSize, 4);
	head.writeUInt32LE(1, 8);
	head.writeUInt32LE(volumeIdOffset, 12);
	head.writeUInt32LE(localBasePathOffset, 16);
	head.writeUInt32LE(0, 20);
	head.writeUInt32LE(commonPathSuffixOffset, 24);
	return Buffer.concat([head, volume, base, suffix]);
}

/**
 * LinkInfoHeaderSize = 0x24 的形态：ANSI 偏移指向错误内容，
 * *_Unicode 偏移指向正确内容，用来证明解析器优先取 Unicode。
 */
function buildUnicodeLinkInfo(): Buffer {
	const volume = buildVolumeId(0x1a2b3c4d, 'DATA');
	const ansiBase = cstr('C:\\ansi\\', false);
	const ansiSuffix = cstr('wrong.exe', false);
	const wideBase = cstr('C:\\数据\\', true);
	const wideSuffix = cstr('正确.txt', true);
	const headerSize = 0x24;
	const volumeIdOffset = headerSize;
	const localBasePathOffset = volumeIdOffset + volume.length;
	const commonPathSuffixOffset = localBasePathOffset + ansiBase.length;
	const localBasePathUnicodeOffset = commonPathSuffixOffset + ansiSuffix.length;
	const commonSuffixUnicodeOffset = localBasePathUnicodeOffset + wideBase.length;
	const size = commonSuffixUnicodeOffset + wideSuffix.length;

	const head = Buffer.alloc(headerSize);
	head.writeUInt32LE(size, 0);
	head.writeUInt32LE(headerSize, 4);
	head.writeUInt32LE(1, 8);
	head.writeUInt32LE(volumeIdOffset, 12);
	head.writeUInt32LE(localBasePathOffset, 16);
	head.writeUInt32LE(0, 20);
	head.writeUInt32LE(commonPathSuffixOffset, 24);
	head.writeUInt32LE(localBasePathUnicodeOffset, 28);
	head.writeUInt32LE(commonSuffixUnicodeOffset, 32);
	return Buffer.concat([head, volume, ansiBase, ansiSuffix, wideBase, wideSuffix]);
}

/** StringData：CountCharacters(2) + 数据，字符数不含结尾 NUL。 */
function stringData(text: string, unicode: boolean): Buffer {
	const body = Buffer.from(text, unicode ? 'utf16le' : 'latin1');
	const head = Buffer.alloc(2);
	head.writeUInt16LE(text.length, 0);
	return Buffer.concat([head, body]);
}

function extraBlock(signature: number, body: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32LE(8 + body.length, 0);
	head.writeUInt32LE(signature >>> 0, 4);
	return Buffer.concat([head, body]);
}

/** 0xA0000001：260 字节 ANSI 目标 + 520 字节 UTF-16 目标。 */
function environmentBlock(target: string): Buffer {
	const body = Buffer.alloc(260 + 520);
	const ansi = Buffer.from(target, 'latin1');
	ansi.copy(body, 0, 0, Math.min(ansi.length, 259));
	const wide = Buffer.from(target, 'utf16le');
	wide.copy(body, 260, 0, Math.min(wide.length, 518));
	return extraBlock(0xa0000001, body);
}

/** 0xA0000003：Length(4) + Version(4) + MachineID(16) + Droid(32) + DroidBirth(32)。 */
function trackerBlock(machineId: string): Buffer {
	const body = Buffer.alloc(4 + 4 + 16 + 32 + 32);
	body.writeUInt32LE(body.length, 0);
	body.writeUInt32LE(0, 4);
	Buffer.from(machineId, 'latin1').copy(body, 8, 0, Math.min(machineId.length, 15));
	return extraBlock(0xa0000003, body);
}

/** 任意未知签名的块，用来验证 ignoredBlocks。 */
function unknownBlock(signature: number): Buffer {
	return extraBlock(signature, Buffer.from('ignored'));
}

function assemble(...parts: Buffer[]): Buffer {
	return Buffer.concat(parts);
}

function expectOk(buffer: Buffer): LnkDetails {
	const result = parseShellLink(buffer);
	if (!result.ok) {
		assert.fail(`期望解析成功，实际失败：${result.error}`);
	}
	return result.value;
}

function expectFail(buffer: Buffer): string {
	const result = parseShellLink(buffer);
	if (result.ok) {
		assert.fail('期望解析失败，实际解析成功');
	}
	return result.error;
}

describe('shellLink/lnk', () => {
	describe('头部', () => {
		it('解析最小 lnk（ANSI LinkInfo）并还原目标路径', () => {
			const buffer = assemble(
				buildHeader({ flags: FLAG_HAS_LINK_INFO, creation: new Date('2024-01-02T03:04:05.000Z'), fileSize: 1024, iconIndex: 3 }),
				buildAnsiLinkInfo({ serial: 0x1a2b3c4d, label: 'SYSTEM', basePath: 'C:\\temp\\', suffix: 'a.txt' }),
			);

			const details = expectOk(buffer);
			assert.equal(details.targetPath, 'C:\\temp\\a.txt');
			assert.equal(details.volumeSerialNumber, '1A2B3C4D');
			assert.equal(details.volumeLabel, 'SYSTEM');
			assert.equal(details.header.headerSize, HEADER_SIZE);
			assert.equal(details.header.fileSize, 1024);
			assert.equal(details.header.iconIndex, 3);
			assert.equal(details.header.creationTime, '2024-01-02T03:04:05.000Z');
			assert.equal(details.header.accessTime, undefined);
			assert.equal(details.header.writeTime, undefined);
			assert.equal(details.header.showCommand, 1);
			assert.equal(details.header.showCommandName, 'SW_SHOWNORMAL');
			assert.equal(details.header.flags.hasLinkInfo, true);
			assert.equal(details.header.flags.raw, FLAG_HAS_LINK_INFO);
			assert.deepEqual(details.ignoredBlocks, []);
		});

		it('ShowCommand 映射到名称，未定义值不伪装成已知常量', () => {
			const details = expectOk(buildHeader({ flags: 0, showCommand: 3 }));
			assert.equal(details.header.showCommand, 3);
			assert.equal(details.header.showCommandName, 'SW_SHOWMAXIMIZED');

			const unknown = expectOk(buildHeader({ flags: 0, showCommand: 42 }));
			assert.equal(unknown.header.showCommandName, '未定义(0x2A)');
		});

		it('IDList 按 IDListSize 跳过，后续字段仍能读到', () => {
			const idListBody = Buffer.from([0x14, 0x00, 0x1f, 0x50]);
			const idListHead = Buffer.alloc(2);
			idListHead.writeUInt16LE(idListBody.length, 0);
			const details = expectOk(assemble(
				buildHeader({ flags: FLAG_HAS_LINK_TARGET_ID_LIST | FLAG_HAS_NAME }),
				idListHead,
				idListBody,
				stringData('after-idlist', false),
			));
			assert.equal(details.name, 'after-idlist');
			assert.equal(details.header.flags.hasLinkTargetIDList, true);
		});

		it('ForceNoLinkInfo 时即使有 LinkInfo 也不解析', () => {
			const forced = expectOk(buildHeader({ flags: FLAG_HAS_LINK_INFO | FLAG_FORCE_NO_LINK_INFO }));
			assert.equal(forced.targetPath, undefined);
			assert.equal(forced.header.flags.forceNoLinkInfo, true);
		});
	});

	describe('LinkInfo', () => {
		it('LinkInfoHeaderSize = 0x24 时优先使用 Unicode 路径', () => {
			const details = expectOk(assemble(buildHeader({ flags: FLAG_HAS_LINK_INFO }), buildUnicodeLinkInfo()));
			assert.equal(details.targetPath, 'C:\\数据\\正确.txt');
			assert.equal(details.volumeLabel, 'DATA');
			assert.equal(details.volumeSerialNumber, '1A2B3C4D');
		});

		it('CommonNetworkRelativeLink 提供网络路径', () => {
			const netName = cstr('\\\\server\\share', false);
			const device = cstr('Z:', false);
			// Size >= 0x1C 时必须存在两个 Unicode 偏移字段，这里显式写 0 表示没有 Unicode 版本
			const networkHead = 0x1c;
			const netNameOffset = networkHead;
			const deviceNameOffset = netNameOffset + netName.length;
			const networkSize = deviceNameOffset + device.length;
			const network = Buffer.alloc(networkSize);
			network.writeUInt32LE(networkSize, 0);
			network.writeUInt32LE(0x3, 4);
			network.writeUInt32LE(netNameOffset, 8);
			network.writeUInt32LE(deviceNameOffset, 12);
			network.writeUInt32LE(0, 16);
			network.writeUInt32LE(0, 20);
			network.writeUInt32LE(0, 24);
			netName.copy(network, netNameOffset);
			device.copy(network, deviceNameOffset);

			const suffix = cstr('dir\\file.txt', false);
			const headerSize = 0x1c;
			const networkOffset = headerSize;
			const suffixOffset = networkOffset + network.length;
			const size = suffixOffset + suffix.length;
			const head = Buffer.alloc(headerSize);
			head.writeUInt32LE(size, 0);
			head.writeUInt32LE(headerSize, 4);
			head.writeUInt32LE(0x2, 8);
			head.writeUInt32LE(0, 12);
			head.writeUInt32LE(0, 16);
			head.writeUInt32LE(networkOffset, 20);
			head.writeUInt32LE(suffixOffset, 24);

			const details = expectOk(assemble(buildHeader({ flags: FLAG_HAS_LINK_INFO }), head, network, suffix));
			assert.equal(details.networkPath, '\\\\server\\share');
			assert.equal(details.targetPath, '\\\\server\\share\\dir\\file.txt');
			assert.equal(details.volumeSerialNumber, undefined);
		});
	});

	describe('StringData', () => {
		const ALL_STRINGS = FLAG_HAS_NAME | FLAG_HAS_RELATIVE_PATH | FLAG_HAS_WORKING_DIR | FLAG_HAS_ARGUMENTS | FLAG_HAS_ICON_LOCATION;

		it('Unicode 模式按字符数 × 2 读取五个字段', () => {
			const details = expectOk(assemble(
				buildHeader({ flags: ALL_STRINGS | FLAG_IS_UNICODE }),
				stringData('快捷方式', true),
				stringData('..\\a.txt', true),
				stringData('C:\\work', true),
				stringData('--flag "x y"', true),
				stringData('%SystemRoot%\\a.ico', true),
				TERMINAL_BLOCK,
			));
			assert.equal(details.name, '快捷方式');
			assert.equal(details.relativePath, '..\\a.txt');
			assert.equal(details.workingDirectory, 'C:\\work');
			assert.equal(details.arguments, '--flag "x y"');
			assert.equal(details.iconLocation, '%SystemRoot%\\a.ico');
			assert.equal(details.header.flags.isUnicode, true);
		});

		it('非 Unicode 模式按 latin1 读取五个字段', () => {
			const details = expectOk(assemble(
				buildHeader({ flags: ALL_STRINGS }),
				stringData('plain-name', false),
				stringData('..\\b.txt', false),
				stringData('C:\\work2', false),
				stringData('-q', false),
				stringData('C:\\icons\\b.ico', false),
			));
			assert.equal(details.name, 'plain-name');
			assert.equal(details.relativePath, '..\\b.txt');
			assert.equal(details.workingDirectory, 'C:\\work2');
			assert.equal(details.arguments, '-q');
			assert.equal(details.iconLocation, 'C:\\icons\\b.ico');
			assert.equal(details.header.flags.isUnicode, false);
		});
	});

	describe('ExtraData', () => {
		it('EnvironmentVariableDataBlock 给出环境变量目标（优先 UTF-16）', () => {
			const details = expectOk(assemble(
				buildHeader({ flags: 0 }),
				environmentBlock('%SystemRoot%\\notepad.exe'),
				TERMINAL_BLOCK,
			));
			assert.equal(details.environmentTarget, '%SystemRoot%\\notepad.exe');
			assert.equal(details.machineId, undefined);
			assert.deepEqual(details.ignoredBlocks, []);
		});

		it('TrackerDataBlock 给出 MachineID', () => {
			const details = expectOk(assemble(
				buildHeader({ flags: 0 }),
				trackerBlock('PC-42'),
				TERMINAL_BLOCK,
			));
			assert.equal(details.machineId, 'PC-42');
			assert.equal(details.environmentTarget, undefined);
		});

		it('未知块记入 ignoredBlocks 且不影响其它字段', () => {
			const details = expectOk(assemble(
				buildHeader({ flags: FLAG_HAS_LINK_INFO }),
				buildAnsiLinkInfo({ serial: 0x11223344, label: 'VOL', basePath: 'D:\\data\\', suffix: 'x.bin' }),
				unknownBlock(0xa0000005),
				unknownBlock(0xa0000002),
				TERMINAL_BLOCK,
			));
			assert.equal(details.targetPath, 'D:\\data\\x.bin');
			assert.equal(details.volumeLabel, 'VOL');
			assert.deepEqual(details.ignoredBlocks, ['0xA0000005', '0xA0000002']);
		});
	});

	describe('失败路径', () => {
		it('CLSID 不符时返回 ok:false 且说清原因', () => {
			const header = buildHeader({ flags: 0 });
			header[4] = 0x09;
			const error = expectFail(header);
			assert.match(error, /CLSID/);
		});

		it('HeaderSize 不是 0x4C 时返回 ok:false', () => {
			const header = buildHeader({ flags: 0 });
			header.writeUInt32LE(0x1c, 0);
			assert.match(expectFail(header), /HeaderSize/);
		});

		it('头部被截断到 20 字节时返回 ok:false 且不抛异常', () => {
			const truncated = buildHeader({ flags: FLAG_HAS_LINK_INFO }).subarray(0, 20);
			assert.doesNotThrow(() => parseShellLink(truncated));
			assert.match(expectFail(truncated), /越界|Header/);
		});

		it('StringData 声明长度超出缓冲区时返回 ok:false 且不抛异常', () => {
			const head = Buffer.alloc(2);
			head.writeUInt16LE(500, 0);
			const buffer = assemble(buildHeader({ flags: FLAG_HAS_NAME }), head, Buffer.from('short'));
			assert.doesNotThrow(() => parseShellLink(buffer));
			assert.match(expectFail(buffer), /越界/);
		});

		it('空 buffer 不抛异常', () => {
			assert.doesNotThrow(() => parseShellLink(new Uint8Array(0)));
			assert.equal(parseShellLink(new Uint8Array(0)).ok, false);
		});
	});

	describe('targetLooksLikeFolder', () => {
		function folderFlag(basePath: string, suffix: string): boolean {
			const details = expectOk(assemble(
				buildHeader({ flags: FLAG_HAS_LINK_INFO }),
				buildAnsiLinkInfo({ serial: 0, label: 'L', basePath, suffix }),
			));
			return details.targetLooksLikeFolder;
		}

		it('以分隔符结尾视为文件夹', () => {
			assert.equal(folderFlag('C:\\dir\\', ''), true);
			assert.equal(folderFlag('C:\\', 'dir\\'), true);
		});

		it('最后一段没有扩展名视为文件夹', () => {
			assert.equal(folderFlag('C:\\dir', ''), true);
			assert.equal(folderFlag('C:\\', 'Windows'), true);
		});

		it('有扩展名、也没有结尾分隔符时视为文件', () => {
			assert.equal(folderFlag('C:\\', 'a.txt'), false);
			assert.equal(folderFlag('C:\\dir\\', 'b.tar.gz'), false);
		});
	});
});
