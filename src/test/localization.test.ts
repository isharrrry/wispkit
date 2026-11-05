import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { localizedManifest, projectRoot, readJson } from './helpers/manifest';

/** 中日韩统一表意文字（含扩展 A 与兼容表意文字）。 */
function hasCjk(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0)!;
		if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) {
			return true;
		}
	}
	return false;
}

function collectPlaceholders(value: any, found: Set<string>): Set<string> {
	if (typeof value === 'string') {
		for (const match of value.matchAll(/%([^%]+)%/g)) {
			found.add(match[1]);
		}
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectPlaceholders(item, found);
		}
	} else if (value && typeof value === 'object') {
		for (const item of Object.values(value)) {
			collectPlaceholders(item, found);
		}
	}
	return found;
}

const english = readJson('package.nls.json') as Record<string, string>;
const chinese = readJson('package.nls.zh-cn.json') as Record<string, string>;

describe('扩展清单国际化（package.nls）', () => {
	it('英文主版与中文版的键集合完全一致', () => {
		assert.deepStrictEqual(Object.keys(english).sort(), Object.keys(chinese).sort());
	});

	it('package.json 的每个 %key% 占位符在两种语言里都存在', () => {
		const keys = collectPlaceholders(readJson('package.json'), new Set<string>());
		assert.ok(keys.size > 0, 'package.json 应使用 %key% 占位符');
		for (const key of keys) {
			assert.ok(key in english, `package.nls.json 缺少 %${key}%`);
			assert.ok(key in chinese, `package.nls.zh-cn.json 缺少 %${key}%`);
		}
	});

	it('英文主版不含中文，非中文 locale 下不会显示中文界面', () => {
		const offenders = Object.entries(english)
			.filter(([, value]) => hasCjk(value))
			.map(([key]) => key);
		assert.deepStrictEqual(offenders, [], `package.nls.json 仍有中文：${offenders.join(', ')}`);
	});

	it('package.json 本身不再硬编码中文', () => {
		const raw = fs.readFileSync(path.join(projectRoot(), 'package.json'), 'utf8');
		assert.ok(!hasCjk(raw), 'package.json 的可见文案应全部通过 %key% 引用 nls 文件');
	});

	it('英文 locale 下命令面板与视图标题均为英文', () => {
		const manifest = localizedManifest();
		for (const command of manifest.contributes.commands as any[]) {
			assert.ok(!hasCjk(command.title), `命令 ${command.command} 的标题仍是中文：${command.title}`);
			if (command.category) {
				assert.ok(!hasCjk(command.category), `命令 ${command.command} 的分类仍是中文：${command.category}`);
			}
		}
		for (const view of manifest.contributes.views.wispkit as any[]) {
			assert.ok(!hasCjk(view.name), `视图 ${view.id} 的名称仍是中文：${view.name}`);
		}
	});

	it('中文 locale 下视图、命令与配置描述恢复为中文', () => {
		const manifest = localizedManifest('zh-cn');
		const resourceTree = (manifest.contributes.views.wispkit as any[])
			.find(view => view.id === 'wispkit.resourceTree');
		assert.strictEqual(resourceTree.name, '自定义资源管理');
		const openWith = (manifest.contributes.commands as any[])
			.find(command => command.command === 'wispkit.openWith');
		assert.strictEqual(openWith.title, '用 Wispkit 打开');
		assert.strictEqual(
			manifest.contributes.configuration.properties['wispkit.readonly.previewLines'].description,
			'只读模式下最多显示的行数。',
		);
	});
});

describe('Marketplace 元数据', () => {
	const manifest = readJson('package.json');

	it('icon 指向一个 128x128 的 PNG', () => {
		assert.strictEqual(manifest.icon, 'media/icon.png');
		const bytes = fs.readFileSync(path.join(projectRoot(), manifest.icon));
		assert.deepStrictEqual(
			[...bytes.subarray(0, 8)],
			[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
			'icon 必须是 PNG',
		);
		assert.strictEqual(bytes.readUInt32BE(16), 128, 'icon 宽度必须是 128');
		assert.strictEqual(bytes.readUInt32BE(20), 128, 'icon 高度必须是 128');
	});

	it('categories 不再只有 Other', () => {
		assert.ok(Array.isArray(manifest.categories));
		assert.ok(manifest.categories.length > 1, 'categories 至少要有两个分类');
		assert.ok(manifest.categories.includes('Visualization'), '可视化能力应归入 Visualization');
	});

	it('声明 extensionKind：native 渲染器与本地文件操作必须在工作区侧运行', () => {
		assert.deepStrictEqual(manifest.extensionKind, ['workspace']);
	});
});
