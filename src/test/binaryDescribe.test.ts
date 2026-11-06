import * as assert from 'assert';
import { describeExecutable, describeShellLink } from '../binaryView/describe';
import type { LnkDetails } from '../shellLink/lnk';
import type { PeDetails } from '../executable/pe';

function baseLink(overrides: Partial<LnkDetails> = {}): LnkDetails {
	return {
		header: {
			headerSize: 76,
			flags: {
				hasLinkTargetIDList: false,
				hasLinkInfo: true,
				hasName: false,
				hasRelativePath: false,
				hasWorkingDir: true,
				hasArguments: false,
				hasIconLocation: false,
				isUnicode: true,
				runAsUser: false,
				forceNoLinkInfo: false,
				raw: 0x12,
			},
			fileAttributes: 0x20,
			fileSize: 0,
			iconIndex: 0,
			showCommand: 1,
			showCommandName: 'normal',
		},
		targetPath: 'D:\\work\\docs',
		workingDirectory: 'D:\\work',
		targetLooksLikeFolder: true,
		ignoredBlocks: [],
		...overrides,
	};
}

function basePe(overrides: Partial<PeDetails> = {}): PeDetails {
	return {
		format: 'PE32+',
		machine: 'x64',
		machineRaw: 0x8664,
		subsystem: 'GUI',
		subsystemRaw: 2,
		characteristics: ['可执行映像'],
		dllCharacteristics: ['ASLR'],
		isDll: false,
		entryPointRva: 0x1000,
		imageBase: '0x140000000',
		sizeOfImage: 0x20000,
		timestamp: 1700000000,
		checksum: 0,
		sections: [],
		isManaged: false,
		size: 1024,
		notes: [],
		...overrides,
	};
}

describe('binaryView/describe', () => {
	describe('快捷方式', () => {
		it('目标存在时给出「存在（文件夹）」', () => {
			const described = describeShellLink(
				baseLink(),
				{ exists: true, isDirectory: true },
				{ allowEdit: false, platform: 'win32' },
			);
			const rows = described.sections[0].rows;
			assert.strictEqual(rows.find(row => row.label === '目标状态')?.value, '存在（文件夹）');
			assert.strictEqual(rows.find(row => row.label === '目标类别')?.value, '文件夹');
		});

		it('目标不存在时如实写不存在', () => {
			const described = describeShellLink(
				baseLink(),
				{ exists: false, isDirectory: false },
				{ allowEdit: false, platform: 'win32' },
			);
			assert.strictEqual(described.sections[0].rows.find(row => row.label === '目标状态')?.value, '不存在');
		});

		it('没有探测结果时不假装知道', () => {
			const described = describeShellLink(baseLink(), undefined, { allowEdit: false, platform: 'win32' });
			assert.strictEqual(described.sections[0].rows.find(row => row.label === '目标状态')?.value, '未探测');
		});

		it('allowEdit 且 Windows 才给编辑表单', () => {
			assert.ok(describeShellLink(baseLink(), undefined, { allowEdit: true, platform: 'win32' }).form);
			assert.strictEqual(
				describeShellLink(baseLink(), undefined, { allowEdit: false, platform: 'win32' }).form,
				undefined,
			);
			assert.strictEqual(
				describeShellLink(baseLink(), undefined, { allowEdit: true, platform: 'linux' }).form,
				undefined,
			);
		});

		it('只有环境变量目标时提示只能交给系统', () => {
			const described = describeShellLink(
				baseLink({ targetPath: undefined, environmentTarget: '%SystemRoot%\\notepad.exe', targetLooksLikeFolder: false }),
				undefined,
				{ allowEdit: false, platform: 'win32' },
			);
			assert.ok(described.notices.some(note => note.includes('环境变量')));
		});

		it('完全没目标时给出更明确的提示', () => {
			const described = describeShellLink(
				baseLink({ targetPath: undefined, environmentTarget: undefined }),
				undefined,
				{ allowEdit: false, platform: 'win32' },
			);
			assert.ok(described.notices.some(note => note.includes('没有可读的目标路径')));
		});

		it('被跳过的数据块写进提示', () => {
			const described = describeShellLink(
				baseLink({ ignoredBlocks: ['0xA0000006', '0xA0000007'] }),
				undefined,
				{ allowEdit: false, platform: 'win32' },
			);
			assert.ok(described.notices.some(note => note.includes('2 个未使用的数据块')));
		});
	});

	describe('可执行文件', () => {
		it('基本信息与节表都成行', () => {
			const described = describeExecutable(basePe({
				sections: [
					{ name: '.text', virtualSize: 0x1000, virtualAddress: 0x1000, rawSize: 0x200, rawPointer: 0x200, characteristics: ['可执行', '可读'] },
				],
			}));
			assert.ok(described.sections.some(section => section.title === '节表'));
			const sectionRows = described.sections.find(section => section.title === '节表')?.rows ?? [];
			assert.strictEqual(sectionRows[0].label, '.text');
			assert.match(sectionRows[0].value, /RVA 0x1000/);
			assert.strictEqual(sectionRows[0].hint, '可执行、可读');
		});

		it('没有节时给出空态行，而不是空表', () => {
			const described = describeExecutable(basePe());
			const sectionRows = described.sections.find(section => section.title === '节表')?.rows ?? [];
			assert.strictEqual(sectionRows.length, 1);
			assert.strictEqual(sectionRows[0].label, '（无）');
		});

		it('有版本资源时多一节', () => {
			const described = describeExecutable(basePe({ version: { fileVersion: '1.2.3.4', companyName: 'ACME' } }));
			const rows = described.sections.find(section => section.title === '版本资源')?.rows ?? [];
			assert.strictEqual(rows.find(row => row.label === '文件版本')?.value, '1.2.3.4');
			assert.strictEqual(rows.find(row => row.label === '公司')?.value, 'ACME');
		});

		it('缺字段用破折号占位，不写 undefined', () => {
			const described = describeExecutable(basePe({ version: { fileVersion: '1.0' } }));
			const rows = described.sections.find(section => section.title === '版本资源')?.rows ?? [];
			assert.strictEqual(rows.find(row => row.label === '公司')?.value, '—');
			assert.ok(!rows.some(row => row.value.includes('undefined')));
		});

		it('notes 原样带到提示里', () => {
			const described = describeExecutable(basePe({ notes: ['版本资源解析失败'] }));
			assert.deepStrictEqual(described.notices, ['版本资源解析失败']);
		});
	});
});
