import * as assert from 'node:assert/strict';
import { parseExecutable } from '../executable/pe';

/** 测试里手工拼 PE，不读磁盘上的真程序；所有偏移都按规范写死，方便对照。 */

function align4(value: number): number {
	return (value + 3) & ~3;
}

interface SectionSpec {
	readonly name: string;
	readonly virtualSize: number;
	readonly virtualAddress: number;
	readonly rawSize: number;
	readonly rawPointer: number;
	readonly characteristics?: number;
}

interface PeSpec {
	readonly plus?: boolean;
	readonly machine?: number;
	readonly sections?: readonly SectionSpec[];
	readonly subsystem?: number;
	readonly characteristics?: number;
	readonly dllCharacteristics?: number;
	readonly entryPoint?: number;
	readonly imageBase?: number;
	readonly sizeOfImage?: number;
	readonly checksum?: number;
	readonly timestamp?: number;
	readonly dataDirectories?: Readonly<Record<number, { readonly rva: number; readonly size: number }>>;
}

const PE_OFFSET = 0x40;
const OPTIONAL_OFFSET = PE_OFFSET + 24;

/** 拼一个结构完整的 PE 头部，尾部可按需追加节数据。 */
function buildPe(spec: PeSpec, tail?: Buffer): Buffer {
	const plus = spec.plus === true;
	const optionalLength = plus ? 0xf0 : 0xe0;
	const sections = spec.sections ?? [];
	const sectionTable = OPTIONAL_OFFSET + optionalLength;
	const payloadOffset = sectionTable + sections.length * 40;
	const buffer = Buffer.alloc(payloadOffset + (tail?.length ?? 0));

	buffer.write('MZ', 0, 'ascii');
	buffer.writeUInt32LE(PE_OFFSET, 0x3c);
	buffer.writeUInt32LE(0x00004550, PE_OFFSET);
	buffer.writeUInt16LE(spec.machine ?? (plus ? 0x8664 : 0x014c), PE_OFFSET + 4);
	buffer.writeUInt16LE(sections.length, PE_OFFSET + 6);
	buffer.writeUInt32LE(spec.timestamp ?? 0x5f000000, PE_OFFSET + 8);
	buffer.writeUInt32LE(0, PE_OFFSET + 12);
	buffer.writeUInt32LE(0, PE_OFFSET + 16);
	buffer.writeUInt16LE(optionalLength, PE_OFFSET + 20);
	buffer.writeUInt16LE(spec.characteristics ?? 0x0102, PE_OFFSET + 22);

	buffer.writeUInt16LE(plus ? 0x20b : 0x10b, OPTIONAL_OFFSET);
	buffer.writeUInt32LE(spec.entryPoint ?? 0x1000, OPTIONAL_OFFSET + 0x10);
	if (plus) {
		buffer.writeBigUInt64LE(BigInt(spec.imageBase ?? 0x140000000), OPTIONAL_OFFSET + 0x18);
	} else {
		buffer.writeUInt32LE(spec.imageBase ?? 0x400000, OPTIONAL_OFFSET + 0x1c);
	}
	buffer.writeUInt32LE(spec.sizeOfImage ?? 0x3000, OPTIONAL_OFFSET + 0x38);
	buffer.writeUInt32LE(spec.checksum ?? 0x1234, OPTIONAL_OFFSET + 0x40);
	buffer.writeUInt16LE(spec.subsystem ?? 2, OPTIONAL_OFFSET + 0x44);
	buffer.writeUInt16LE(spec.dllCharacteristics ?? 0, OPTIONAL_OFFSET + 0x46);
	buffer.writeUInt32LE(16, OPTIONAL_OFFSET + (plus ? 0x6c : 0x5c));

	const directoryOffset = OPTIONAL_OFFSET + (plus ? 0x70 : 0x60);
	for (const [index, entry] of Object.entries(spec.dataDirectories ?? {})) {
		const at = directoryOffset + Number(index) * 8;
		buffer.writeUInt32LE(entry.rva, at);
		buffer.writeUInt32LE(entry.size, at + 4);
	}

	sections.forEach((section, index) => {
		const entry = sectionTable + index * 40;
		buffer.write(section.name, entry, 'ascii');
		buffer.writeUInt32LE(section.virtualSize, entry + 8);
		buffer.writeUInt32LE(section.virtualAddress, entry + 12);
		buffer.writeUInt32LE(section.rawSize, entry + 16);
		buffer.writeUInt32LE(section.rawPointer, entry + 20);
		buffer.writeUInt32LE(section.characteristics ?? 0x60000020, entry + 36);
	});

	if (tail !== undefined) {
		tail.copy(buffer, payloadOffset);
	}
	return buffer;
}

function padTo4(buffer: Buffer): Buffer {
	return buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))]);
}

/** VS_FIXEDFILEINFO（52 字节）。 */
function fixedFileInfo(file: readonly [number, number, number, number], product: readonly [number, number, number, number]): Buffer {
	const buffer = Buffer.alloc(52);
	const pack = (high: number, low: number): number => ((high << 16) | low) >>> 0;
	buffer.writeUInt32LE(0xfeef04bd, 0);
	buffer.writeUInt32LE(0x00010000, 4);
	buffer.writeUInt32LE(pack(file[0], file[1]), 8);
	buffer.writeUInt32LE(pack(file[2], file[3]), 12);
	buffer.writeUInt32LE(pack(product[0], product[1]), 16);
	buffer.writeUInt32LE(pack(product[2], product[3]), 20);
	buffer.writeUInt32LE(0x3f, 24);
	buffer.writeUInt32LE(0, 28);
	buffer.writeUInt32LE(0x00040004, 32);
	buffer.writeUInt32LE(1, 36);
	return buffer;
}

/** 一个带文本值的版本块（StringTable 里的具体条目）。 */
function stringBlock(key: string, value: string): Buffer {
	const keyBytes = Buffer.from(`${key}\0`, 'utf16le');
	const valueBytes = Buffer.from(`${value}\0`, 'utf16le');
	const padLength = align4(6 + keyBytes.length) - (6 + keyBytes.length);
	const body = Buffer.concat([Buffer.alloc(6), keyBytes, Buffer.alloc(padLength), valueBytes]);
	body.writeUInt16LE(body.length, 0);
	body.writeUInt16LE(value.length + 1, 2);
	body.writeUInt16LE(1, 4);
	return body;
}

/** 一个只有子块的版本块（StringFileInfo / StringTable）。 */
function containerBlock(key: string, children: readonly Buffer[]): Buffer {
	const keyBytes = Buffer.from(`${key}\0`, 'utf16le');
	const padLength = align4(6 + keyBytes.length) - (6 + keyBytes.length);
	const body = Buffer.concat([Buffer.alloc(6), keyBytes, Buffer.alloc(padLength), ...children.map(padTo4)]);
	body.writeUInt16LE(body.length, 0);
	body.writeUInt16LE(0, 2);
	body.writeUInt16LE(1, 4);
	return body;
}

/** VS_VERSIONINFO 根块：固定信息 + StringFileInfo。 */
function versionInfoRoot(fixed: Buffer, children: readonly Buffer[]): Buffer {
	const keyBytes = Buffer.from('VS_VERSION_INFO\0', 'utf16le');
	const padLength = align4(6 + keyBytes.length) - (6 + keyBytes.length);
	const body = Buffer.concat([
		Buffer.alloc(6),
		keyBytes,
		Buffer.alloc(padLength),
		fixed,
		Buffer.alloc(align4(fixed.length) - fixed.length),
		...children.map(padTo4),
	]);
	body.writeUInt16LE(body.length, 0);
	body.writeUInt16LE(fixed.length, 2);
	body.writeUInt16LE(0, 4);
	return body;
}

/** .rsrc 节内容：三层资源目录 + IMAGE_RESOURCE_DATA_ENTRY + 版本数据。 */
function versionResource(version: Buffer): Buffer {
	const rva = 0x1000;
	const directory = Buffer.alloc(0x58);
	directory.writeUInt16LE(0, 12);
	directory.writeUInt16LE(1, 14);
	directory.writeUInt32LE(16, 16);
	directory.writeUInt32LE(0x80000018, 20);
	directory.writeUInt16LE(0, 0x18 + 12);
	directory.writeUInt16LE(1, 0x18 + 14);
	directory.writeUInt32LE(1, 0x28);
	directory.writeUInt32LE(0x80000030, 0x2c);
	directory.writeUInt16LE(0, 0x30 + 12);
	directory.writeUInt16LE(1, 0x30 + 14);
	directory.writeUInt32LE(0x0409, 0x40);
	directory.writeUInt32LE(0x48, 0x44);
	directory.writeUInt32LE(rva + 0x58, 0x48);
	directory.writeUInt32LE(version.length, 0x4c);
	directory.writeUInt32LE(0, 0x50);
	directory.writeUInt32LE(0, 0x54);
	return Buffer.concat([directory, version]);
}

const TEXT_SECTION: SectionSpec = {
	name: '.text',
	virtualSize: 0x200,
	virtualAddress: 0x1000,
	rawSize: 0x200,
	rawPointer: 0x160,
};

describe('executable/pe', () => {
	it('最小 PE32（x86、GUI、单节）解析出头部与节表', () => {
		const buffer = buildPe({ sections: [TEXT_SECTION] });
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		const pe = result.value;
		assert.strictEqual(pe.format, 'PE32');
		assert.strictEqual(pe.machine, 'x86');
		assert.strictEqual(pe.machineRaw, 0x014c);
		assert.strictEqual(pe.subsystem, 'Windows GUI');
		assert.strictEqual(pe.subsystemRaw, 2);
		assert.strictEqual(pe.entryPointRva, 0x1000);
		assert.strictEqual(pe.imageBase, '0x400000');
		assert.strictEqual(pe.sizeOfImage, 0x3000);
		assert.strictEqual(pe.checksum, 0x1234);
		assert.strictEqual(pe.timestamp, 0x5f000000);
		assert.strictEqual(pe.isDll, false);
		assert.strictEqual(pe.isManaged, false);
		assert.strictEqual(pe.size, buffer.length);
		assert.deepStrictEqual(pe.characteristics, ['可执行映像', '32 位机器']);
		assert.strictEqual(pe.sections.length, 1);
		assert.strictEqual(pe.sections[0].name, '.text');
		assert.strictEqual(pe.sections[0].virtualSize, 0x200);
		assert.strictEqual(pe.sections[0].virtualAddress, 0x1000);
		assert.strictEqual(pe.sections[0].rawSize, 0x200);
		assert.strictEqual(pe.sections[0].rawPointer, 0x160);
		assert.deepStrictEqual(pe.sections[0].characteristics, ['代码', '可执行', '可读']);
		assert.deepStrictEqual(pe.notes, []);
	});

	it('最小 PE32+（x64、控制台、双节）的镜像基址按 64 位输出', () => {
		const buffer = buildPe({
			plus: true,
			subsystem: 3,
			sections: [
				TEXT_SECTION,
				{ name: '.data', virtualSize: 0x100, virtualAddress: 0x2000, rawSize: 0x100, rawPointer: 0x360 },
			],
		});
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		const pe = result.value;
		assert.strictEqual(pe.format, 'PE32+');
		assert.strictEqual(pe.machine, 'x64');
		assert.strictEqual(pe.machineRaw, 0x8664);
		assert.strictEqual(pe.subsystem, 'Windows CUI');
		assert.strictEqual(pe.imageBase, '0x140000000');
		assert.strictEqual(pe.sections.length, 2);
		assert.deepStrictEqual(pe.sections.map((section) => section.name), ['.text', '.data']);
	});

	it('含 DLL 标记的映像被识别为 DLL', () => {
		const buffer = buildPe({ sections: [TEXT_SECTION], characteristics: 0x2102 });
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		assert.strictEqual(result.value.isDll, true);
		assert.ok(result.value.characteristics.includes('DLL'));
	});

	it('DllCharacteristics 的 ASLR、DEP、CFG 位被翻译成名字', () => {
		const buffer = buildPe({ sections: [TEXT_SECTION], dllCharacteristics: 0x40 | 0x100 | 0x4000 });
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		assert.deepStrictEqual(result.value.dllCharacteristics, ['ASLR', 'DEP', 'CFG']);
	});

	it('COR20 数据目录非零时判定为托管程序集', () => {
		const buffer = buildPe({
			sections: [TEXT_SECTION],
			dataDirectories: { 14: { rva: 0x2000, size: 0x48 } },
		});
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		assert.strictEqual(result.value.isManaged, true);
	});

	it('结构损坏时返回 ok:false，且从不抛异常', () => {
		const notMz = Buffer.from('hello world', 'ascii');
		assert.doesNotThrow(() => parseExecutable(notMz));
		const notMzResult = parseExecutable(notMz);
		assert.strictEqual(notMzResult.ok, false);
		if (!notMzResult.ok) {
			assert.match(notMzResult.error, /MZ/);
		}

		const badLfanew = Buffer.alloc(0x40);
		badLfanew.write('MZ', 0, 'ascii');
		badLfanew.writeUInt32LE(0x1000, 0x3c);
		const badLfanewResult = parseExecutable(badLfanew);
		assert.strictEqual(badLfanewResult.ok, false);
		if (!badLfanewResult.ok) {
			assert.match(badLfanewResult.error, /e_lfanew/);
		}

		const badSignature = Buffer.alloc(0x80);
		badSignature.write('MZ', 0, 'ascii');
		badSignature.writeUInt32LE(0x40, 0x3c);
		badSignature.writeUInt32LE(0x12345678, 0x40);
		const badSignatureResult = parseExecutable(badSignature);
		assert.strictEqual(badSignatureResult.ok, false);
		if (!badSignatureResult.ok) {
			assert.match(badSignatureResult.error, /PE/);
		}

		const truncatedSections = buildPe({ sections: [TEXT_SECTION] });
		truncatedSections.writeUInt16LE(0xffff, PE_OFFSET + 6);
		assert.doesNotThrow(() => parseExecutable(truncatedSections));
		assert.strictEqual(parseExecutable(truncatedSections).ok, false);

		const empty = new Uint8Array(0);
		assert.doesNotThrow(() => parseExecutable(empty));
		assert.strictEqual(parseExecutable(empty).ok, false);
	});

	it('版本资源里的固定信息与字符串表被解析出来', () => {
		const version = versionInfoRoot(fixedFileInfo([1, 2, 3, 4], [1, 2, 3, 4]), [
			containerBlock('StringFileInfo', [
				containerBlock('040904B0', [
					stringBlock('CompanyName', 'Acme'),
					stringBlock('FileDescription', '演示程序'),
				]),
			]),
		]);
		const resource = versionResource(version);
		const buffer = buildPe(
			{
				sections: [
					{
						name: '.rsrc',
						virtualSize: 0x400,
						virtualAddress: 0x1000,
						rawSize: 0x400,
						rawPointer: 0x160,
					},
				],
				dataDirectories: { 2: { rva: 0x1000, size: 0x400 } },
			},
			resource,
		);
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		const info = result.value.version;
		assert.notStrictEqual(info, undefined);
		if (info === undefined) {
			return;
		}
		assert.strictEqual(info.fileVersion, '1.2.3.4');
		assert.strictEqual(info.productVersion, '1.2.3.4');
		assert.strictEqual(info.companyName, 'Acme');
		assert.strictEqual(info.fileDescription, '演示程序');
		assert.deepStrictEqual(result.value.notes, []);
	});

	it('版本资源损坏时只记 note，整体仍解析成功', () => {
		const buffer = buildPe(
			{
				sections: [
					{
						name: '.rsrc',
						virtualSize: 0x400,
						virtualAddress: 0x1000,
						rawSize: 0x400,
						rawPointer: 0x160,
					},
				],
				dataDirectories: { 2: { rva: 0x1000, size: 0x400 } },
			},
			Buffer.alloc(0x400),
		);
		const result = parseExecutable(buffer);

		assert.strictEqual(result.ok, true);
		if (!result.ok) {
			return;
		}
		assert.strictEqual(result.value.version, undefined);
		assert.strictEqual(result.value.notes.length, 1);
	});
});
