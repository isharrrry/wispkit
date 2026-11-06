/**
 * Windows 快捷方式（.lnk，Shell Link Binary File Format）的只读解析。
 * 纯函数、不依赖 vscode —— 结构见 MS-SHLLINK 2.1 ~ 2.5，全部按小端读取。
 * 任何越界或结构异常都返回 ok:false，绝不抛异常。
 */

export interface LnkFlags {
	readonly hasLinkTargetIDList: boolean;
	readonly hasLinkInfo: boolean;
	readonly hasName: boolean;
	readonly hasRelativePath: boolean;
	readonly hasWorkingDir: boolean;
	readonly hasArguments: boolean;
	readonly hasIconLocation: boolean;
	readonly isUnicode: boolean;
	readonly runAsUser: boolean;
	readonly forceNoLinkInfo: boolean;
	readonly raw: number;
}

export interface LnkHeader {
	readonly headerSize: number;
	readonly flags: LnkFlags;
	readonly fileAttributes: number;
	readonly creationTime?: string;
	readonly accessTime?: string;
	readonly writeTime?: string;
	readonly fileSize: number;
	readonly iconIndex: number;
	readonly showCommand: number;
	readonly showCommandName: string;
}

export interface LnkDetails {
	readonly header: LnkHeader;
	readonly targetPath?: string;
	readonly volumeSerialNumber?: string;
	readonly volumeLabel?: string;
	readonly networkPath?: string;
	readonly relativePath?: string;
	readonly workingDirectory?: string;
	readonly arguments?: string;
	readonly iconLocation?: string;
	readonly name?: string;
	readonly environmentTarget?: string;
	readonly machineId?: string;
	readonly targetLooksLikeFolder: boolean;
	readonly ignoredBlocks: readonly string[];
}

export interface LnkParseFailure {
	readonly ok: false;
	readonly error: string;
}

export interface LnkParseSuccess {
	readonly ok: true;
	readonly value: LnkDetails;
}

export type LnkParseResult = LnkParseSuccess | LnkParseFailure;

/** HeaderSize 固定 76（0x4C）。 */
const HEADER_SIZE = 0x4c;

/** LinkCLSID：00021401-0000-0000-C000-000000000046 的字节序。 */
const LINK_CLSID: readonly number[] = [
	0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
];

const FLAG_HAS_LINK_TARGET_ID_LIST = 0x1;
const FLAG_HAS_LINK_INFO = 0x2;
const FLAG_HAS_NAME = 0x4;
const FLAG_HAS_RELATIVE_PATH = 0x8;
const FLAG_HAS_WORKING_DIR = 0x10;
const FLAG_HAS_ARGUMENTS = 0x20;
const FLAG_HAS_ICON_LOCATION = 0x40;
const FLAG_IS_UNICODE = 0x80;
const FLAG_FORCE_NO_LINK_INFO = 0x100;
const FLAG_RUN_AS_USER = 0x2000;

const LINK_INFO_FLAG_VOLUME_AND_LOCAL_BASE_PATH = 0x1;
const LINK_INFO_FLAG_COMMON_NETWORK_AND_PATH_SUFFIX = 0x2;

const SIGNATURE_ENVIRONMENT = 0xa0000001;
const SIGNATURE_TRACKER = 0xa0000003;

/** FILETIME 纪元（1601-01-01T00:00:00Z）到 Unix 纪元的毫秒数。 */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

/** 结构性错误：只在内部抛出，由 parseShellLink 统一转成 ok:false。 */
class LinkFormatError extends Error {}

function fail(message: string): never {
	throw new LinkFormatError(message);
}

/**
 * 读取前做边界检查。limit 是本次可读的上界（不含），
 * 通常等于 buffer.length，解析 LinkInfo / VolumeID 时收紧到该块自己的上界。
 */
function need(buffer: Uint8Array, offset: number, size: number, limit: number, what: string): void {
	if (offset < 0 || size < 0 || offset + size > limit) {
		fail(`${what} 越界：偏移 ${offset}、长度 ${size}，上界 ${limit}`);
	}
}

function u16(buffer: Uint8Array, offset: number, limit: number, what: string): number {
	need(buffer, offset, 2, limit, what);
	return buffer[offset] | (buffer[offset + 1] << 8);
}

function u32(buffer: Uint8Array, offset: number, limit: number, what: string): number {
	need(buffer, offset, 4, limit, what);
	return (
		(buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0
	);
}

function i32(buffer: Uint8Array, offset: number, limit: number, what: string): number {
	need(buffer, offset, 4, limit, what);
	return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24);
}

function u64(buffer: Uint8Array, offset: number, limit: number, what: string): bigint {
	need(buffer, offset, 8, limit, what);
	let value = 0n;
	for (let index = 7; index >= 0; index -= 1) {
		value = (value << 8n) | BigInt(buffer[offset + index]);
	}
	return value;
}

/** FILETIME 是 100ns 自 1601 起的计数；0 表示"未设置"，此时不输出该字段。 */
function filetimeToIso(value: bigint): string | undefined {
	if (value === 0n) {
		return undefined;
	}
	const milliseconds = value / 10000n - FILETIME_EPOCH_OFFSET_MS;
	return new Date(Number(milliseconds)).toISOString();
}

/** ANSI 串按 latin1 解码 —— .lnk 里的"ANSI"是当前代码页，用 utf8 会毁掉非 ASCII 字节。 */
function readAnsiZ(buffer: Uint8Array, offset: number, limit: number): string {
	let end = offset;
	while (end < limit && buffer[end] !== 0) {
		end += 1;
	}
	return Buffer.from(buffer.subarray(offset, end)).toString('latin1');
}

function readUtf16Z(buffer: Uint8Array, offset: number, limit: number): string {
	let end = offset;
	while (end + 1 < limit && (buffer[end] !== 0 || buffer[end + 1] !== 0)) {
		end += 2;
	}
	return Buffer.from(buffer.subarray(offset, end)).toString('utf16le');
}

/**
 * LinkInfo 里的路径串有一个已知的歧义：字段本身不标注编码。
 * 约定是"首字节为 `\` 表示 UTF-16LE，否则 ANSI"，这里照此实现；
 * 真正可靠的 Unicode 路径走 *_Unicode 偏移（优先使用）。
 */
function readPathZ(buffer: Uint8Array, offset: number, limit: number): string {
	if (offset <= 0 || offset >= limit) {
		return '';
	}
	return buffer[offset] === 0x5c ? readUtf16Z(buffer, offset, limit) : readAnsiZ(buffer, offset, limit);
}

/** 绝对路径与剩余路径段拼接：只有两边都缺分隔符时才补一个。 */
function joinPath(base: string | undefined, suffix: string | undefined): string | undefined {
	const left = (base ?? '').trim();
	const right = (suffix ?? '').trim();
	if (!left) {
		return right || undefined;
	}
	if (!right) {
		return left;
	}
	return /[\\/]$/.test(left) || /^[\\/]/.test(right) ? left + right : `${left}\\${right}`;
}

/** 末尾是分隔符、或最后一段没有扩展名，都按"指向文件夹"处理。 */
function looksLikeFolder(path: string | undefined): boolean {
	if (!path) {
		return false;
	}
	if (/[\\/]$/.test(path)) {
		return true;
	}
	const segments = path.split(/[\\/]/);
	const last = segments[segments.length - 1] ?? '';
	return !last.includes('.');
}

function showCommandName(value: number): string {
	switch (value) {
		case 1:
			return 'SW_SHOWNORMAL';
		case 3:
			return 'SW_SHOWMAXIMIZED';
		case 7:
			return 'SW_SHOWMINNOACTIVE';
		default:
			return `未定义(0x${value.toString(16).toUpperCase()})`;
	}
}

function decodeFlags(raw: number): LnkFlags {
	return {
		hasLinkTargetIDList: (raw & FLAG_HAS_LINK_TARGET_ID_LIST) !== 0,
		hasLinkInfo: (raw & FLAG_HAS_LINK_INFO) !== 0,
		hasName: (raw & FLAG_HAS_NAME) !== 0,
		hasRelativePath: (raw & FLAG_HAS_RELATIVE_PATH) !== 0,
		hasWorkingDir: (raw & FLAG_HAS_WORKING_DIR) !== 0,
		hasArguments: (raw & FLAG_HAS_ARGUMENTS) !== 0,
		hasIconLocation: (raw & FLAG_HAS_ICON_LOCATION) !== 0,
		isUnicode: (raw & FLAG_IS_UNICODE) !== 0,
		runAsUser: (raw & FLAG_RUN_AS_USER) !== 0,
		forceNoLinkInfo: (raw & FLAG_FORCE_NO_LINK_INFO) !== 0,
		raw,
	};
}

function parseHeader(buffer: Uint8Array): LnkHeader {
	need(buffer, 0, HEADER_SIZE, buffer.length, 'Header');
	const headerSize = u32(buffer, 0, HEADER_SIZE, 'HeaderSize');
	if (headerSize !== HEADER_SIZE) {
		fail(`不是 Shell Link：HeaderSize 为 0x${headerSize.toString(16).toUpperCase()}，应为 0x4C`);
	}
	for (let index = 0; index < LINK_CLSID.length; index += 1) {
		if (buffer[4 + index] !== LINK_CLSID[index]) {
			fail('不是 Shell Link：LinkCLSID 不匹配（期望 00021401-0000-0000-C000-000000000046）');
		}
	}

	const raw = u32(buffer, 20, HEADER_SIZE, 'LinkFlags');
	const showCommand = u32(buffer, 60, HEADER_SIZE, 'ShowCommand');
	return {
		headerSize,
		flags: decodeFlags(raw),
		fileAttributes: u32(buffer, 24, HEADER_SIZE, 'FileAttributes'),
		creationTime: filetimeToIso(u64(buffer, 28, HEADER_SIZE, 'CreationTime')),
		accessTime: filetimeToIso(u64(buffer, 36, HEADER_SIZE, 'AccessTime')),
		writeTime: filetimeToIso(u64(buffer, 44, HEADER_SIZE, 'WriteTime')),
		fileSize: u32(buffer, 52, HEADER_SIZE, 'FileSize'),
		iconIndex: i32(buffer, 56, HEADER_SIZE, 'IconIndex'),
		showCommand,
		showCommandName: showCommandName(showCommand),
	};
}

interface LinkInfoValue {
	readonly targetPath?: string;
	readonly volumeSerialNumber?: string;
	readonly volumeLabel?: string;
	readonly networkPath?: string;
}

interface VolumeIdValue {
	readonly serialNumber?: string;
	readonly label?: string;
}

/** VolumeID：DriveType 之后是序列号，卷标偏移为 0x14 时改用 +0x10 的 Unicode 偏移。 */
function parseVolumeId(buffer: Uint8Array, start: number, limit: number): VolumeIdValue {
	const size = u32(buffer, start, limit, 'VolumeIDSize');
	if (size < 0x10 || start + size > limit) {
		fail(`VolumeIDSize 异常：0x${size.toString(16).toUpperCase()}`);
	}
	const volumeLimit = start + size;
	const serial = u32(buffer, start + 0x08, volumeLimit, 'VolumeSerialNumber');
	const labelOffset = u32(buffer, start + 0x0c, volumeLimit, 'VolumeLabelOffset');

	let label: string | undefined;
	if (labelOffset === 0x14 && size >= 0x14) {
		const unicodeOffset = u32(buffer, start + 0x10, volumeLimit, 'VolumeLabelOffsetUnicode');
		label = unicodeOffset > 0 ? readUtf16Z(buffer, start + unicodeOffset, volumeLimit) : undefined;
	} else if (labelOffset > 0) {
		label = readPathZ(buffer, start + labelOffset, volumeLimit);
	}

	return {
		serialNumber: serial.toString(16).toUpperCase().padStart(8, '0'),
		label: label || undefined,
	};
}

/** CommonNetworkRelativeLink：NetName 优先取 Unicode 版本。 */
function parseCommonNetworkRelativeLink(buffer: Uint8Array, start: number, limit: number): string | undefined {
	const size = u32(buffer, start, limit, 'CommonNetworkRelativeLinkSize');
	if (size < 0x14 || start + size > limit) {
		fail(`CommonNetworkRelativeLinkSize 异常：0x${size.toString(16).toUpperCase()}`);
	}
	const networkLimit = start + size;
	const netNameOffset = u32(buffer, start + 0x08, networkLimit, 'NetNameOffset');
	const unicodeOffset = size >= 0x1c ? u32(buffer, start + 0x14, networkLimit, 'NetNameOffsetUnicode') : 0;

	const netName = unicodeOffset > 0
		? readUtf16Z(buffer, start + unicodeOffset, networkLimit)
		// NetName 的编码由结构本身区分（基础字段是 ANSI，Unicode 版另存），
		// 不能用"首字节是 \ 就按 UTF-16"的启发式 —— UNC 路径本来就以 \\ 开头。
		: netNameOffset > 0 ? readAnsiZ(buffer, start + netNameOffset, networkLimit) : '';
	return netName || undefined;
}

/** LinkInfo：所有偏移都相对本块起点，读写一律压在 LinkInfoSize 之内。 */
function parseLinkInfo(buffer: Uint8Array, start: number): { readonly value: LinkInfoValue; readonly next: number } {
	const size = u32(buffer, start, buffer.length, 'LinkInfoSize');
	if (size < 0x1c) {
		fail(`LinkInfoSize 过小：0x${size.toString(16).toUpperCase()}`);
	}
	const limit = start + size;
	if (limit > buffer.length) {
		fail(`LinkInfoSize 超出文件长度：0x${size.toString(16).toUpperCase()}`);
	}

	const headerSize = u32(buffer, start + 4, limit, 'LinkInfoHeaderSize');
	if (headerSize !== 0x1c && headerSize !== 0x24) {
		fail(`LinkInfoHeaderSize 为 0x${headerSize.toString(16).toUpperCase()}，应为 0x1C 或 0x24`);
	}

	const infoFlags = u32(buffer, start + 8, limit, 'LinkInfoFlags');
	const volumeIdOffset = u32(buffer, start + 0x0c, limit, 'VolumeIDOffset');
	const localBasePathOffset = u32(buffer, start + 0x10, limit, 'LocalBasePathOffset');
	const commonNetworkOffset = u32(buffer, start + 0x14, limit, 'CommonNetworkRelativeLinkOffset');
	const commonSuffixOffset = u32(buffer, start + 0x18, limit, 'CommonPathSuffixOffset');
	const localBasePathUnicodeOffset = headerSize >= 0x24 ? u32(buffer, start + 0x1c, limit, 'LocalBasePathOffsetUnicode') : 0;
	const commonSuffixUnicodeOffset = headerSize >= 0x24 ? u32(buffer, start + 0x20, limit, 'CommonPathSuffixOffsetUnicode') : 0;

	let volumeSerialNumber: string | undefined;
	let volumeLabel: string | undefined;
	if ((infoFlags & LINK_INFO_FLAG_VOLUME_AND_LOCAL_BASE_PATH) !== 0 && volumeIdOffset > 0) {
		const volume = parseVolumeId(buffer, start + volumeIdOffset, limit);
		volumeSerialNumber = volume.serialNumber;
		volumeLabel = volume.label;
	}

	let networkPath: string | undefined;
	if ((infoFlags & LINK_INFO_FLAG_COMMON_NETWORK_AND_PATH_SUFFIX) !== 0 && commonNetworkOffset > 0) {
		networkPath = parseCommonNetworkRelativeLink(buffer, start + commonNetworkOffset, limit);
	}

	// 偏移为 0 表示该字段不存在 —— 不能直接拿 start 去读，否则会读到 LinkInfo 自己的头部
	const basePath = localBasePathUnicodeOffset > 0
		? readUtf16Z(buffer, start + localBasePathUnicodeOffset, limit)
		: localBasePathOffset > 0 ? readPathZ(buffer, start + localBasePathOffset, limit) : '';
	const suffix = commonSuffixUnicodeOffset > 0
		? readUtf16Z(buffer, start + commonSuffixUnicodeOffset, limit)
		: commonSuffixOffset > 0 ? readPathZ(buffer, start + commonSuffixOffset, limit) : '';

	// 只有存在本地基路径时才走本地拼装；否则把后缀接到网络路径后面
	const localPath = basePath ? joinPath(basePath, suffix || undefined) : undefined;
	const networkTarget = networkPath ? joinPath(networkPath, suffix || undefined) : undefined;
	return {
		value: {
			targetPath: localPath ?? networkTarget,
			volumeSerialNumber,
			volumeLabel,
			networkPath,
		},
		next: limit,
	};
}

/** StringData：CountCharacters 是字符数，Unicode 时字节数为它的两倍，且不含结尾 NUL。 */
function readStringData(buffer: Uint8Array, start: number, isUnicode: boolean): { readonly text: string; readonly next: number } {
	const count = u16(buffer, start, buffer.length, 'StringData.CountCharacters');
	const bytes = isUnicode ? count * 2 : count;
	const bodyStart = start + 2;
	need(buffer, bodyStart, bytes, buffer.length, 'StringData 内容');
	const text = Buffer.from(buffer.subarray(bodyStart, bodyStart + bytes))
		.toString(isUnicode ? 'utf16le' : 'latin1')
		.replace(/\0+$/, '');
	return { text, next: bodyStart + bytes };
}

function readEnvironmentBlock(buffer: Uint8Array, start: number, size: number): string | undefined {
	const wideLimit = start + Math.min(size, 260 + 520);
	const wide = size >= 260 + 2 ? readUtf16Z(buffer, start + 260, wideLimit) : '';
	if (wide) {
		return wide;
	}
	const ansi = readAnsiZ(buffer, start, start + Math.min(size, 260));
	return ansi || undefined;
}

/** TrackerDataBlock：Length(4) + Version(4) + MachineID(16) + Droid(32) + DroidBirth(32)。 */
function readTrackerBlock(buffer: Uint8Array, start: number, size: number): string | undefined {
	if (size < 8 + 16) {
		return undefined;
	}
	const machineId = readAnsiZ(buffer, start + 8, start + Math.min(size, 8 + 16));
	return machineId || undefined;
}

interface ExtraDataValue {
	readonly environmentTarget?: string;
	readonly machineId?: string;
	readonly ignored: readonly string[];
}

/** ExtraData：BlockSize(4) + Signature(4) + 数据，BlockSize 小于 8 即终止（终结块只有 4 字节）。 */
function parseExtraData(buffer: Uint8Array, start: number): ExtraDataValue {
	let environmentTarget: string | undefined;
	let machineId: string | undefined;
	const ignored: string[] = [];

	let cursor = start;
	while (cursor + 4 <= buffer.length) {
		const blockSize = u32(buffer, cursor, buffer.length, 'ExtraData.BlockSize');
		if (blockSize < 8) {
			break;
		}
		need(buffer, cursor, blockSize, buffer.length, 'ExtraData 块');
		const signature = u32(buffer, cursor + 4, buffer.length, 'ExtraData.BlockSignature');
		const bodyStart = cursor + 8;
		const bodySize = blockSize - 8;

		if (signature === SIGNATURE_ENVIRONMENT) {
			const value = readEnvironmentBlock(buffer, bodyStart, bodySize);
			if (value) {
				environmentTarget = value;
			}
		} else if (signature === SIGNATURE_TRACKER) {
			const value = readTrackerBlock(buffer, bodyStart, bodySize);
			if (value) {
				machineId = value;
			}
		} else {
			ignored.push(`0x${signature.toString(16).toUpperCase().padStart(8, '0')}`);
		}

		cursor += blockSize;
	}

	return { environmentTarget, machineId, ignored };
}

function parseOrThrow(buffer: Uint8Array): LnkDetails {
	const header = parseHeader(buffer);

	let cursor = HEADER_SIZE;
	if (header.flags.hasLinkTargetIDList) {
		const idListSize = u16(buffer, cursor, buffer.length, 'IDListSize');
		cursor += 2 + idListSize;
		if (cursor > buffer.length) {
			fail(`IDListSize 超出文件长度：0x${idListSize.toString(16).toUpperCase()}`);
		}
	}

	let targetPath: string | undefined;
	let volumeSerialNumber: string | undefined;
	let volumeLabel: string | undefined;
	let networkPath: string | undefined;
	if (header.flags.hasLinkInfo && !header.flags.forceNoLinkInfo) {
		const linkInfo = parseLinkInfo(buffer, cursor);
		targetPath = linkInfo.value.targetPath;
		volumeSerialNumber = linkInfo.value.volumeSerialNumber;
		volumeLabel = linkInfo.value.volumeLabel;
		networkPath = linkInfo.value.networkPath;
		cursor = linkInfo.next;
	}

	// StringData 的顺序由标志位固定：Name -> RelativePath -> WorkingDir -> Arguments -> IconLocation
	let name: string | undefined;
	let relativePath: string | undefined;
	let workingDirectory: string | undefined;
	let argumentsText: string | undefined;
	let iconLocation: string | undefined;

	if (header.flags.hasName) {
		const parsed = readStringData(buffer, cursor, header.flags.isUnicode);
		name = parsed.text || undefined;
		cursor = parsed.next;
	}
	if (header.flags.hasRelativePath) {
		const parsed = readStringData(buffer, cursor, header.flags.isUnicode);
		relativePath = parsed.text || undefined;
		cursor = parsed.next;
	}
	if (header.flags.hasWorkingDir) {
		const parsed = readStringData(buffer, cursor, header.flags.isUnicode);
		workingDirectory = parsed.text || undefined;
		cursor = parsed.next;
	}
	if (header.flags.hasArguments) {
		const parsed = readStringData(buffer, cursor, header.flags.isUnicode);
		argumentsText = parsed.text || undefined;
		cursor = parsed.next;
	}
	if (header.flags.hasIconLocation) {
		const parsed = readStringData(buffer, cursor, header.flags.isUnicode);
		iconLocation = parsed.text || undefined;
		cursor = parsed.next;
	}

	const extra = parseExtraData(buffer, cursor);

	return {
		header,
		targetPath,
		volumeSerialNumber,
		volumeLabel,
		networkPath,
		relativePath,
		workingDirectory,
		arguments: argumentsText,
		iconLocation,
		name,
		environmentTarget: extra.environmentTarget,
		machineId: extra.machineId,
		targetLooksLikeFolder: looksLikeFolder(targetPath),
		ignoredBlocks: extra.ignored,
	};
}

/** 解析 .lnk 字节流；结构不合法时返回 ok:false 并给出中文原因，不抛异常。 */
export function parseShellLink(buffer: Uint8Array): LnkParseResult {
	try {
		return { ok: true, value: parseOrThrow(buffer) };
	} catch (error) {
		const message = error instanceof LinkFormatError
			? error.message
			: `解析失败：${error instanceof Error ? error.message : String(error)}`;
		return { ok: false, error: message };
	}
}
