/**
 * Windows PE/COFF（.exe/.dll）头部解析：只读头部、节表与资源目录里的版本信息。
 * 纯函数、不依赖 vscode —— 调用方拿到 Uint8Array 就能展示格式、机器、子系统与节表。
 * 所有越界与结构异常都收敛成 ok:false，绝不向调用方抛异常。
 */

export interface PeSection {
	/** 节名（8 字节，NUL 截断后去掉尾部空白）。 */
	readonly name: string;
	readonly virtualSize: number;
	readonly virtualAddress: number;
	readonly rawSize: number;
	readonly rawPointer: number;
	readonly characteristics: readonly string[];
}

export interface PeVersionInfo {
	readonly fileVersion?: string;
	readonly productVersion?: string;
	readonly companyName?: string;
	readonly fileDescription?: string;
	readonly productName?: string;
	readonly originalFilename?: string;
	readonly legalCopyright?: string;
	readonly internalName?: string;
}

export interface PeDetails {
	readonly format: 'PE32' | 'PE32+';
	readonly machine: string;
	readonly machineRaw: number;
	readonly subsystem: string;
	readonly subsystemRaw: number;
	readonly characteristics: readonly string[];
	readonly dllCharacteristics: readonly string[];
	readonly isDll: boolean;
	readonly entryPointRva: number;
	readonly imageBase: string;
	readonly sizeOfImage: number;
	readonly timestamp: number;
	readonly checksum: number;
	readonly sections: readonly PeSection[];
	readonly isManaged: boolean;
	readonly version?: PeVersionInfo;
	readonly size: number;
	readonly notes: readonly string[];
}

export interface PeParseFailure {
	readonly ok: false;
	readonly error: string;
}

export interface PeParseSuccess {
	readonly ok: true;
	readonly value: PeDetails;
}

export type PeParseResult = PeParseSuccess | PeParseFailure;

/** 结构错误：只在内部流转，出口统一变成 ok:false。 */
class PeError extends Error {}

const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;
const PE_SIGNATURE = 0x00004550;
const DOS_HEADER_OFFSET_OF_PE_HEADER = 0x3c;
const COFF_HEADER_LENGTH = 20;
const OPTIONAL_HEADER_PREFIX_LENGTH = 24;
const SECTION_ENTRY_LENGTH = 40;
const RT_VERSION = 16;
const VS_FIXED_FILE_INFO_SIGNATURE = 0xfeef04bd;
const VS_FIXED_FILE_INFO_LENGTH = 52;
const RESOURCE_DIRECTORY_HEADER_LENGTH = 16;
const RESOURCE_DIRECTORY_ENTRY_LENGTH = 8;
const SUBDIRECTORY_FLAG = 0x80000000;
/** 数据目录里 CLR 运行时头（COR20）的下标。 */
const CLR_DIRECTORY_INDEX = 14;

/** PE32 与 PE32+ 可选头里各字段的偏移，全部相对可选头起点。 */
interface OptionalLayout {
	readonly magic: number;
	readonly entryPoint: number;
	readonly imageBase: number;
	readonly sizeOfImage: number;
	readonly checksum: number;
	readonly subsystem: number;
	readonly dllCharacteristics: number;
	readonly rvaCount: number;
	readonly dataDirectory: number;
	readonly minimumLength: number;
}

const PE32_LAYOUT: OptionalLayout = {
	magic: 0x00,
	entryPoint: 0x10,
	imageBase: 0x1c,
	sizeOfImage: 0x38,
	checksum: 0x40,
	subsystem: 0x44,
	dllCharacteristics: 0x46,
	rvaCount: 0x5c,
	dataDirectory: 0x60,
	minimumLength: 0x60,
};

const PE32_PLUS_LAYOUT: OptionalLayout = {
	magic: 0x00,
	entryPoint: 0x10,
	imageBase: 0x18,
	sizeOfImage: 0x38,
	checksum: 0x40,
	subsystem: 0x44,
	dllCharacteristics: 0x46,
	rvaCount: 0x6c,
	dataDirectory: 0x70,
	minimumLength: 0x70,
};

function need(buffer: Uint8Array, offset: number, length: number): void {
	if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
		throw new PeError(`越界读取：偏移 0x${offset.toString(16)}、长度 ${length}，文件共 ${buffer.length} 字节`);
	}
}

function u16(buffer: Uint8Array, offset: number): number {
	need(buffer, offset, 2);
	return buffer[offset] | (buffer[offset + 1] << 8);
}

function u32(buffer: Uint8Array, offset: number): number {
	need(buffer, offset, 4);
	return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)) + buffer[offset + 3] * 0x1000000;
}

function u64(buffer: Uint8Array, offset: number): bigint {
	need(buffer, offset, 8);
	let value = 0n;
	for (let index = 7; index >= 0; index -= 1) {
		value = (value << 8n) | BigInt(buffer[offset + index]);
	}
	return value;
}

function align4(value: number): number {
	return (value + 3) & ~3;
}

/** UTF-16LE 解码到第一个 NUL 为止；长度按字节给，越界部分自动截断。 */
function decodeUtf16(buffer: Uint8Array, offset: number, bytes: number): string {
	const end = Math.min(offset + bytes, buffer.length);
	let text = '';
	for (let index = offset; index + 1 < end; index += 2) {
		const code = buffer[index] | (buffer[index + 1] << 8);
		if (code === 0) {
			break;
		}
		text += String.fromCharCode(code);
	}
	return text;
}

function readCString(buffer: Uint8Array, offset: number, length: number): string {
	need(buffer, offset, length);
	let text = '';
	for (let index = 0; index < length; index += 1) {
		const code = buffer[offset + index];
		if (code === 0) {
			break;
		}
		text += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '?';
	}
	return text;
}

function machineName(raw: number): string {
	const names: Record<number, string> = {
		0x0000: '未知',
		0x014c: 'x86',
		0x0162: 'MIPS R3000',
		0x0166: 'MIPS R4000',
		0x0168: 'MIPS R10000',
		0x0169: 'MIPS WCE v2',
		0x0184: 'Alpha',
		0x01a2: 'SH3',
		0x01a3: 'SH3 DSP',
		0x01a6: 'SH4',
		0x01c0: 'ARM',
		0x01c2: 'ARM Thumb',
		0x01c4: 'ARMv7 (Thumb-2)',
		0x01d3: 'Alpha64',
		0x01f0: 'PowerPC',
		0x0200: 'IA64',
		0x0266: 'MIPS16',
		0x0284: 'Alpha64',
		0x0366: 'MIPS FPU',
		0x0466: 'MIPS FPU16',
		0x5032: 'RISC-V 32',
		0x5064: 'RISC-V 64',
		0x5128: 'RISC-V 128',
		0x6232: 'LoongArch 32',
		0x6264: 'LoongArch 64',
		0x8664: 'x64',
		0xaa64: 'ARM64',
	};
	return names[raw] ?? `未知 (0x${raw.toString(16)})`;
}

function subsystemName(raw: number): string {
	const names: Record<number, string> = {
		0: '未知',
		1: 'Native',
		2: 'Windows GUI',
		3: 'Windows CUI',
		5: 'OS/2 CUI',
		7: 'POSIX CUI',
		8: 'Native Win9x 驱动',
		9: 'Windows CE GUI',
		10: 'EFI 应用',
		11: 'EFI 引导驱动',
		12: 'EFI 运行时驱动',
		13: 'EFI ROM',
		14: 'Xbox',
		16: 'Windows 引导应用',
	};
	return names[raw] ?? `未知 (${raw})`;
}

function coffCharacteristics(raw: number): string[] {
	const flags: Array<[number, string]> = [
		[0x0001, '重定位已剥离'],
		[0x0002, '可执行映像'],
		[0x0004, '行号已剥离'],
		[0x0008, '本地符号已剥离'],
		[0x0010, '激进工作集修剪'],
		[0x0020, '大地址感知'],
		[0x0080, '小端（已废弃标记）'],
		[0x0100, '32 位机器'],
		[0x0200, '调试信息已剥离'],
		[0x0400, '可从移动介质运行'],
		[0x0800, '可从网络运行'],
		[0x1000, '系统文件'],
		[0x2000, 'DLL'],
		[0x4000, '仅限单处理器'],
		[0x8000, '大端（已废弃标记）'],
	];
	return flags.filter(([bit]) => (raw & bit) !== 0).map(([, label]) => label);
}

function dllCharacteristics(raw: number): string[] {
	const flags: Array<[number, string]> = [
		[0x0020, '高熵 ASLR'],
		[0x0040, 'ASLR'],
		[0x0080, '强制完整性'],
		[0x0100, 'DEP'],
		[0x0200, '无隔离'],
		[0x0400, '无 SEH'],
		[0x0800, '禁止绑定'],
		[0x1000, 'AppContainer'],
		[0x2000, 'WDM 驱动'],
		[0x4000, 'CFG'],
		[0x8000, '终端服务器感知'],
	];
	return flags.filter(([bit]) => (raw & bit) !== 0).map(([, label]) => label);
}

function sectionCharacteristics(raw: number): string[] {
	const flags: Array<[number, string]> = [
		[0x00000020, '代码'],
		[0x00000040, '已初始化数据'],
		[0x00000080, '未初始化数据'],
		[0x00000200, '链接信息'],
		[0x00000800, '链接移除'],
		[0x01000000, '链接其他'],
		[0x02000000, '可丢弃'],
		[0x04000000, '不缓存'],
		[0x08000000, '不分页'],
		[0x10000000, '共享'],
		[0x20000000, '可执行'],
		[0x40000000, '可读'],
		[0x80000000, '可写'],
	];
	return flags.filter(([bit]) => (raw & bit) !== 0).map(([, label]) => label);
}

function readSections(buffer: Uint8Array, offset: number, count: number): PeSection[] {
	if (count > 0) {
		need(buffer, offset, count * SECTION_ENTRY_LENGTH);
	}
	const sections: PeSection[] = [];
	for (let index = 0; index < count; index += 1) {
		const entry = offset + index * SECTION_ENTRY_LENGTH;
		sections.push({
			name: readCString(buffer, entry, 8).trimEnd(),
			virtualSize: u32(buffer, entry + 8),
			virtualAddress: u32(buffer, entry + 12),
			rawSize: u32(buffer, entry + 16),
			rawPointer: u32(buffer, entry + 20),
			characteristics: sectionCharacteristics(u32(buffer, entry + 36)),
		});
	}
	return sections;
}

/** RVA → 文件偏移；不在任何节的可映射范围内就返回 undefined。 */
function rvaToOffset(sections: readonly PeSection[], rva: number): number | undefined {
	for (const section of sections) {
		const span = Math.max(section.virtualSize, section.rawSize);
		if (rva < section.virtualAddress || rva >= section.virtualAddress + span) {
			continue;
		}
		const delta = rva - section.virtualAddress;
		if (delta >= section.rawSize) {
			return undefined;
		}
		return section.rawPointer + delta;
	}
	return undefined;
}

/** 资源目录里的一条目录项；offset 已换算成文件绝对偏移。 */
interface ResourceEntry {
	readonly id: number;
	readonly isDirectory: boolean;
	readonly offset: number;
}

function readResourceEntries(buffer: Uint8Array, base: number, directory: number): ResourceEntry[] {
	const named = u16(buffer, directory + 12);
	const count = named + u16(buffer, directory + 14);
	const entries: ResourceEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		const entry = directory + RESOURCE_DIRECTORY_HEADER_LENGTH + index * RESOURCE_DIRECTORY_ENTRY_LENGTH;
		const name = u32(buffer, entry);
		const data = u32(buffer, entry + 4);
		if ((name & SUBDIRECTORY_FLAG) !== 0) {
			continue;
		}
		entries.push({
			id: name,
			isDirectory: (data & SUBDIRECTORY_FLAG) !== 0,
			offset: base + (data & 0x7fffffff),
		});
	}
	return entries;
}

/** 一个版本信息块（VS_VERSIONINFO 及其子块共用同一布局）。 */
interface VersionBlock {
	readonly offset: number;
	readonly length: number;
	readonly valueLength: number;
	readonly type: number;
	readonly key: string;
	readonly valueOffset: number;
	readonly childrenOffset: number;
}

/** 读块头；块长度不合理或越界返回 undefined，不抛。 */
function readVersionBlock(buffer: Uint8Array, offset: number, limit: number): VersionBlock | undefined {
	if (offset + 6 > limit) {
		return undefined;
	}
	const length = u16(buffer, offset);
	const valueLength = u16(buffer, offset + 2);
	const type = u16(buffer, offset + 4);
	if (length < 6 || offset + length > limit) {
		return undefined;
	}
	let keyEnd = offset + 6;
	while (keyEnd + 1 < offset + length) {
		if (buffer[keyEnd] === 0 && buffer[keyEnd + 1] === 0) {
			break;
		}
		keyEnd += 2;
	}
	const key = decodeUtf16(buffer, offset + 6, keyEnd - (offset + 6));
	const valueOffset = align4(keyEnd + 2);
	const valueBytes = type === 1 ? valueLength * 2 : valueLength;
	const childrenOffset = align4(valueOffset + valueBytes);
	return { offset, length, valueLength, type, key, valueOffset, childrenOffset };
}

/** 遍历块的直接子块；遇到坏块就停，绝不抛。 */
function forEachChild(buffer: Uint8Array, block: VersionBlock, limit: number, visit: (child: VersionBlock) => void): void {
	const end = Math.min(block.offset + block.length, limit);
	let cursor = block.childrenOffset;
	while (cursor + 6 <= end) {
		const child = readVersionBlock(buffer, cursor, end);
		if (child === undefined || child.length === 0) {
			return;
		}
		visit(child);
		cursor = align4(child.offset + child.length);
	}
}

function formatVersion(ms: number, ls: number): string {
	return `${(ms >>> 16) & 0xffff}.${ms & 0xffff}.${(ls >>> 16) & 0xffff}.${ls & 0xffff}`;
}

/** StringFileInfo 里按大小写不敏感识别的键 → PeVersionInfo 字段。 */
const VERSION_STRING_KEYS: Record<string, keyof PeVersionInfo> = {
	fileversion: 'fileVersion',
	productversion: 'productVersion',
	companyname: 'companyName',
	filedescription: 'fileDescription',
	productname: 'productName',
	originalfilename: 'originalFilename',
	legalcopyright: 'legalCopyright',
	internalname: 'internalName',
};

/**
 * 解析 RT_VERSION 资源。任何异常都写进 notes 并返回 undefined ——
 * 版本信息只是附加展示，缺了不影响整体解析成功。
 */
function readVersionInfo(
	buffer: Uint8Array,
	sections: readonly PeSection[],
	resourceRva: number,
	notes: string[],
): PeVersionInfo | undefined {
	try {
		const base = rvaToOffset(sections, resourceRva);
		if (base === undefined) {
			notes.push('版本资源的 RVA 没有落在任何节里');
			return undefined;
		}
		const typeEntry = readResourceEntries(buffer, base, base).find((entry) => entry.id === RT_VERSION);
		if (typeEntry === undefined || !typeEntry.isDirectory) {
			notes.push('资源目录里没有 VT_VERSION');
			return undefined;
		}
		const nameEntry = readResourceEntries(buffer, base, typeEntry.offset)[0];
		if (nameEntry === undefined) {
			notes.push('版本资源目录缺少名称层');
			return undefined;
		}
		let leaf = nameEntry;
		if (leaf.isDirectory) {
			const languageEntry = readResourceEntries(buffer, base, leaf.offset)[0];
			if (languageEntry === undefined) {
				notes.push('版本资源目录缺少语言层');
				return undefined;
			}
			leaf = languageEntry;
		}
		if (leaf.isDirectory) {
			notes.push('版本资源目录层数超出预期');
			return undefined;
		}
		const dataRva = u32(buffer, leaf.offset);
		const dataSize = u32(buffer, leaf.offset + 4);
		const versionOffset = rvaToOffset(sections, dataRva);
		if (versionOffset === undefined) {
			notes.push('版本资源数据的 RVA 没有落在任何节里');
			return undefined;
		}
		const limit = Math.min(versionOffset + dataSize, buffer.length);
		const root = readVersionBlock(buffer, versionOffset, limit);
		if (root === undefined || root.key !== 'VS_VERSION_INFO') {
			notes.push('版本资源块头无效');
			return undefined;
		}

		let fixedFile: string | undefined;
		let fixedProduct: string | undefined;
		if (root.valueLength >= VS_FIXED_FILE_INFO_LENGTH && root.valueOffset + VS_FIXED_FILE_INFO_LENGTH <= limit) {
			if (u32(buffer, root.valueOffset) === VS_FIXED_FILE_INFO_SIGNATURE) {
				fixedFile = formatVersion(u32(buffer, root.valueOffset + 8), u32(buffer, root.valueOffset + 12));
				fixedProduct = formatVersion(u32(buffer, root.valueOffset + 16), u32(buffer, root.valueOffset + 20));
			}
		}

		const strings = new Map<keyof PeVersionInfo, string>();
		forEachChild(buffer, root, limit, (child) => {
			if (child.key !== 'StringFileInfo') {
				return;
			}
			forEachChild(buffer, child, limit, (table) => {
				forEachChild(buffer, table, limit, (item) => {
					const field = VERSION_STRING_KEYS[item.key.toLowerCase()];
					if (field === undefined) {
						return;
					}
					const text = decodeUtf16(buffer, item.valueOffset, item.valueLength * 2).trim();
					if (text.length > 0 && !strings.has(field)) {
						strings.set(field, text);
					}
				});
			});
		});

		const version: PeVersionInfo = {
			fileVersion: strings.get('fileVersion') ?? fixedFile,
			productVersion: strings.get('productVersion') ?? fixedProduct,
			companyName: strings.get('companyName'),
			fileDescription: strings.get('fileDescription'),
			productName: strings.get('productName'),
			originalFilename: strings.get('originalFilename'),
			legalCopyright: strings.get('legalCopyright'),
			internalName: strings.get('internalName'),
		};
		if (Object.values(version).every((value) => value === undefined)) {
			return undefined;
		}
		return version;
	} catch (error) {
		notes.push(`版本资源解析失败：${error instanceof PeError ? error.message : String(error)}`);
		return undefined;
	}
}

function readPe(buffer: Uint8Array): PeDetails {
	if (u16(buffer, 0) !== 0x5a4d) {
		throw new PeError('不是 MZ 可执行文件');
	}
	const peOffset = u32(buffer, DOS_HEADER_OFFSET_OF_PE_HEADER);
	if (peOffset + OPTIONAL_HEADER_PREFIX_LENGTH + COFF_HEADER_LENGTH > buffer.length) {
		throw new PeError(`e_lfanew 指向 0x${peOffset.toString(16)}，超出文件长度`);
	}
	if (u32(buffer, peOffset) !== PE_SIGNATURE) {
		throw new PeError('e_lfanew 处不是 PE\\0\\0 签名');
	}

	const machineRaw = u16(buffer, peOffset + 4);
	const sectionCount = u16(buffer, peOffset + 6);
	const timestamp = u32(buffer, peOffset + 8);
	const sizeOfOptionalHeader = u16(buffer, peOffset + 20);
	const characteristicsRaw = u16(buffer, peOffset + 22);
	const optional = peOffset + 4 + COFF_HEADER_LENGTH;
	const magic = u16(buffer, optional);
	const isPlus = magic === PE32_PLUS_MAGIC;
	if (!isPlus && magic !== PE32_MAGIC) {
		throw new PeError(`未知的可选头 Magic：0x${magic.toString(16)}`);
	}
	const layout = isPlus ? PE32_PLUS_LAYOUT : PE32_LAYOUT;
	if (sizeOfOptionalHeader < layout.minimumLength) {
		throw new PeError(`可选头长度 ${sizeOfOptionalHeader} 不足以容纳 RVA 目录表`);
	}
	if (optional + sizeOfOptionalHeader > buffer.length) {
		throw new PeError('可选头越界');
	}

	const entryPointRva = u32(buffer, optional + layout.entryPoint);
	const imageBase = isPlus
		? `0x${u64(buffer, optional + layout.imageBase).toString(16)}`
		: `0x${u32(buffer, optional + layout.imageBase).toString(16)}`;
	const sizeOfImage = u32(buffer, optional + layout.sizeOfImage);
	const checksum = u32(buffer, optional + layout.checksum);
	const subsystemRaw = u16(buffer, optional + layout.subsystem);
	const dllCharacteristicsRaw = u16(buffer, optional + layout.dllCharacteristics);
	const rvaCount = u32(buffer, optional + layout.rvaCount);

	const directoryEntry = (index: number): { readonly rva: number; readonly size: number } | undefined => {
		if (index >= rvaCount) {
			return undefined;
		}
		const entry = optional + layout.dataDirectory + index * 8;
		if (entry + 8 > optional + sizeOfOptionalHeader) {
			return undefined;
		}
		return { rva: u32(buffer, entry), size: u32(buffer, entry + 4) };
	};

	const sectionTable = optional + sizeOfOptionalHeader;
	const sections = readSections(buffer, sectionTable, sectionCount);

	const notes: string[] = [];
	const resource = directoryEntry(2);
	const version = resource !== undefined && resource.rva !== 0
		? readVersionInfo(buffer, sections, resource.rva, notes)
		: undefined;
	const clr = directoryEntry(CLR_DIRECTORY_INDEX);

	return {
		format: isPlus ? 'PE32+' : 'PE32',
		machine: machineName(machineRaw),
		machineRaw,
		subsystem: subsystemName(subsystemRaw),
		subsystemRaw,
		characteristics: coffCharacteristics(characteristicsRaw),
		dllCharacteristics: dllCharacteristics(dllCharacteristicsRaw),
		isDll: (characteristicsRaw & 0x2000) !== 0,
		entryPointRva,
		imageBase,
		sizeOfImage,
		timestamp,
		checksum,
		sections,
		isManaged: clr !== undefined && clr.rva !== 0,
		version,
		size: buffer.length,
		notes,
	};
}

/**
 * 解析 PE/COFF 头部。成功返回 ok:true，任何结构异常都返回 ok:false —— 不会抛异常。
 */
export function parseExecutable(buffer: Uint8Array): PeParseResult {
	try {
		return { ok: true, value: readPe(buffer) };
	} catch (error) {
		const message = error instanceof PeError ? error.message : `解析失败：${String(error)}`;
		return { ok: false, error: message };
	}
}
