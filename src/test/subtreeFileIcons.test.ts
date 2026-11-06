import * as assert from 'assert';
import {
	buildFileIconScript,
	clearFileIconCache,
	extractFileIcons,
	iconCacheKey,
	isIconBearingFile,
	parseFileIconOutput,
	supportsFileIcons,
} from '../subtree/fileIcons';

describe('subtree/fileIcons', () => {
	it('只对 .lnk 与 .exe 取图标，大小写不敏感', () => {
		assert.strictEqual(isIconBearingFile('C:\\a\\b.exe'), true);
		assert.strictEqual(isIconBearingFile('C:\\a\\b.LNK'), true);
		assert.strictEqual(isIconBearingFile('C:\\a\\b.dll'), false);
		assert.strictEqual(isIconBearingFile('C:\\a\\b.txt'), false);
	});

	it('只有 Windows 支持这套 shell 关联', () => {
		assert.strictEqual(supportsFileIcons('win32'), true);
		assert.strictEqual(supportsFileIcons('linux'), false);
		assert.strictEqual(supportsFileIcons('darwin'), false);
	});

	it('缓存键含 mtime 与大小，且路径大小写归一', () => {
		const a = iconCacheKey({ path: 'C:\\A\\b.exe', mtime: 1, size: 2 });
		const b = iconCacheKey({ path: 'c:\\a\\b.exe', mtime: 1, size: 2 });
		assert.strictEqual(a, b);
		assert.notStrictEqual(a, iconCacheKey({ path: 'C:\\A\\b.exe', mtime: 2, size: 2 }));
		assert.notStrictEqual(a, iconCacheKey({ path: 'C:\\A\\b.exe', mtime: 1, size: 3 }));
	});

	describe('脚本生成', () => {
		it('路径进入单引号数组，内部单引号双写', () => {
			const script = buildFileIconScript(["C:\\it's\\a.exe", 'C:\\b.lnk']);
			assert.ok(script.includes("'C:\\it''s\\a.exe'"));
			assert.ok(script.includes("'C:\\b.lnk'"));
		});

		it('用资源管理器同一套 ExtractAssociatedIcon，且以 JSON 输出', () => {
			const script = buildFileIconScript(['C:\\a.exe']);
			assert.ok(script.includes('[System.Drawing.Icon]::ExtractAssociatedIcon($p)'));
			assert.ok(script.includes('ConvertTo-Json'));
			assert.ok(script.includes('System.Drawing.Imaging.ImageFormat]::Png'));
		});

		it('失败被吞掉，不让整批中断', () => {
			const script = buildFileIconScript(['C:\\a.exe']);
			assert.ok(script.includes('catch { }'));
		});
	});

	describe('输出解析', () => {
		it('数组输出逐项转成 data URI', () => {
			const map = parseFileIconOutput(JSON.stringify([
				{ p: 'C:\\a.exe', d: 'AAA' },
				{ p: 'C:\\b.lnk', d: 'BBB' },
			]));
			assert.strictEqual(map.get('C:\\a.exe'), 'data:image/png;base64,AAA');
			assert.strictEqual(map.get('C:\\b.lnk'), 'data:image/png;base64,BBB');
		});

		it('单项时 PowerShell 输出的是对象而不是数组', () => {
			const map = parseFileIconOutput(JSON.stringify([{ p: 'C:\\a.exe', d: 'AAA' }]));
			assert.strictEqual(map.size, 1);
			assert.strictEqual(map.get('C:\\a.exe'), 'data:image/png;base64,AAA');
			const single = parseFileIconOutput(JSON.stringify({ p: 'C:\\b.exe', d: 'BBB' }));
			assert.strictEqual(single.get('C:\\b.exe'), 'data:image/png;base64,BBB');
		});

		it('空输出与坏 JSON 都返回空表，不抛', () => {
			assert.strictEqual(parseFileIconOutput('').size, 0);
			assert.strictEqual(parseFileIconOutput('   ').size, 0);
			assert.strictEqual(parseFileIconOutput('not json').size, 0);
		});

		it('缺字段或空数据的条目被丢弃，不合成假图标', () => {
			const map = parseFileIconOutput(JSON.stringify([
				{ p: 'C:\\a.exe' },
				{ d: 'BBB' },
				{ p: 'C:\\b.exe', d: '' },
				{ p: 'C:\\c.exe', d: 'CCC' },
			]));
			assert.strictEqual(map.size, 1);
			assert.ok(map.has('C:\\c.exe'));
		});
	});

	describe('extractFileIcons', () => {
		it('非 Windows 直接返回空，不当失败', async () => {
			clearFileIconCache();
			const map = await extractFileIcons([{ path: 'C:\\a.exe', mtime: 1, size: 2 }], 'linux');
			assert.strictEqual(map.size, 0);
		});

		it('非图标类文件不进请求', async () => {
			clearFileIconCache();
			const map = await extractFileIcons([{ path: 'C:\\a.txt', mtime: 1, size: 2 }], 'linux');
			assert.strictEqual(map.size, 0);
		});

		it('空列表不触发任何调用', async () => {
			const map = await extractFileIcons([], 'win32');
			assert.strictEqual(map.size, 0);
		});
	});
});
