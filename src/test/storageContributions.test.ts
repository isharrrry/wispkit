import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { localizedManifest } from './helpers/manifest';

/**
 * 「存储器」区域的界面契约：
 *   - 视图默认收纳（collapsed），展开才有内容；
 *   - 挂载点条目的右键菜单必须与上方资源树文件夹节点一致（同一批命令 / 分组），
 *     但不出现重命名 / 移动 / 删除这类只对 JSON 节点有意义的操作；
 *   - 单击走资源树同一个 openFolder 命令，避免两套浏览逻辑分叉。
 */

/** 英文主版（package.nls.json）解析后的清单，与 VS Code 在非中文 locale 下的显示一致。 */
function manifest(): any {
	return localizedManifest();
}

const OPEN_COMMANDS = [
	'wispkit.resourceTree.openFolder',
	'wispkit.resourceTree.copyPath',
	'wispkit.resourceTree.openTerminal',
	'wispkit.resourceTree.openInVSCode',
	'wispkit.resourceTree.openInSystemExplorer',
];

function menuEntries(data: any, whenPrefix: string): any[] {
	return (data.contributes.menus?.['view/item/context'] ?? [])
		.filter((entry: any) => typeof entry.when === 'string' && entry.when.startsWith(whenPrefix));
}

describe('package.json 存储器视图', () => {
	const data = manifest();

	it('活动栏在资源树下方贡献「存储器」视图，默认收纳', () => {
		const views = data.contributes.views?.wispkit ?? [];
		const treeIndex = views.findIndex((view: any) => view.id === 'wispkit.resourceTree');
		const storageIndex = views.findIndex((view: any) => view.id === 'wispkit.storage');
		assert.ok(treeIndex >= 0 && storageIndex >= 0, '必须有 wispkit.resourceTree 与 wispkit.storage 两个视图');
		assert.ok(storageIndex > treeIndex, '存储器视图必须排在资源树下方');
		const storage = views[storageIndex];
		assert.strictEqual(storage.name, 'Storage');
		assert.strictEqual(storage.visibility, 'collapsed', '默认必须收纳');
	});

	it('注册激活事件与刷新命令', () => {
		assert.ok((data.activationEvents ?? []).includes('onView:wispkit.storage'));
		assert.ok((data.activationEvents ?? []).includes('onCommand:wispkit.storage.refresh'));
		const command = (data.contributes.commands ?? []).find((item: any) => item.command === 'wispkit.storage.refresh');
		assert.ok(command, '必须有刷新存储器命令');
		assert.strictEqual(command.title, 'Refresh Storage');
		const titleMenu = (data.contributes.menus?.['view/title'] ?? [])
			.find((item: any) => item.command === 'wispkit.storage.refresh');
		assert.ok(titleMenu, '存储器视图标题栏必须有刷新按钮');
		assert.strictEqual(titleMenu.when, 'view == wispkit.storage');
	});

	it('挂载点右键菜单与资源树文件夹一致（命令 + 分组 + 内联按钮）', () => {
		const folderEntries = menuEntries(data, 'view == wispkit.resourceTree && viewItem == wispkitResourceFolder');
		const mountEntries = menuEntries(data, 'view == wispkit.storage && viewItem == wispkitStorageMount');
		assert.ok(folderEntries.length > 0 && mountEntries.length > 0);

		for (const command of OPEN_COMMANDS) {
			for (const group of ['inline@1', 'inline@2', '4_open@1', '4_open@2', '4_open@3', '4_open@5', '4_open@6']) {
				const expected = folderEntries.some(entry => entry.command === command && entry.group === group);
				if (!expected) {
					continue;
				}
				assert.ok(
					mountEntries.some(entry => entry.command === command && entry.group === group),
					`挂载点缺少与文件夹节点相同的菜单项：${command} / ${group}`,
				);
			}
		}
		// 子菜单只贡献一条、when 同时覆盖两个视图：同一个 submenu id 在同一菜单里
		// 重复贡献时 VS Code 只认其中一条（真机验收里挂载点那一份被丢弃过）。
		const submenuEntries = (data.contributes.menus?.['view/item/context'] ?? [])
			.filter((entry: any) => entry.submenu === 'wispkit.resourceTree.systemTerminalMenu');
		assert.strictEqual(submenuEntries.length, 1, '系统终端子菜单只能贡献一条');
		assert.ok(submenuEntries[0].when.includes('wispkit.resourceTree && viewItem == wispkitResourceFolder'));
		assert.ok(submenuEntries[0].when.includes('wispkit.storage && viewItem == wispkitStorageMount'));
	});

	it('挂载点不出现重命名 / 移动 / 删除（系统卷不能改树结构）', () => {
		const mountEntries = menuEntries(data, 'view == wispkit.storage && viewItem == wispkitStorageMount');
		for (const command of ['wispkit.resourceTree.rename', 'wispkit.resourceTree.remove', 'wispkit.resourceTree.moveTo']) {
			assert.ok(!mountEntries.some(entry => entry.command === command), `挂载点不应出现 ${command}`);
		}
		const allCommands = new Set(mountEntries.map(entry => entry.command).filter(Boolean));
		for (const command of OPEN_COMMANDS) {
			assert.ok(allCommands.has(command), `挂载点缺少命令 ${command}`);
		}
	});
});

describe('storageProvider 代码契约', () => {
	function source(): string {
		return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'storageProvider.ts'), 'utf8');
	}

	it('挂载点单击复用资源树 openFolder，contextValue 与菜单条件一致', () => {
		const text = source();
		assert.ok(text.includes("command: 'wispkit.resourceTree.openFolder'"), '单击必须复用资源树浏览命令');
		assert.ok(text.includes('arguments: [element]'), '必须把挂载点节点直接作为命令参数');
		assert.ok(text.includes("item.contextValue = 'wispkitStorageMount'"));
		assert.ok(text.includes("'wispkit.storage.refresh'"), '刷新命令必须注册');
	});

	it('枚举是懒加载：getChildren 根节点才触发，失败降级为信息行', () => {
		const text = source();
		const children = text.slice(text.indexOf('public getChildren'), text.indexOf('// ── 加载 / 刷新'));
		assert.ok(children.includes('this.load(false)'), '根节点展开时才加载');
		assert.ok(!children.includes('await enumerateStorageNodes'), 'getChildren 不应自己直接枚举');
		assert.ok(text.includes('无法读取系统存储器'), '失败必须显示可读信息行');
	});
});
