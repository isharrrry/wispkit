import * as assert from 'assert';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../media/formats';
import { localizedManifest } from './helpers/manifest';

/** 英文主版（package.nls.json）解析后的清单，与 VS Code 在非中文 locale 下的显示一致。 */
function manifest(): any {
	return localizedManifest();
}

function customEditor(viewType: string): any {
	const found = (manifest().contributes?.customEditors ?? []).find((editor: any) => editor.viewType === viewType);
	assert.ok(found, `package.json 里必须有 customEditor ${viewType}`);
	return found;
}

/**
 * 打开方式优先级是用户能感知的契约，不能悄悄改回去：
 * - `.md` / 图片 / `.html` / `.xaml` 必须 `priority: default`（双击即进 Wispkit）；
 * - 只读文本只能是 `option`（由 `workbench.editorAssociations` 驱动，不能抢所有文件）。
 */
describe('package.json 自定义编辑器优先级', () => {
	it('Markdown / Mermaid / 图片 / 视频 / HTML / XAML 都是 default（双击即进）', () => {
		for (const viewType of ['wispkit.markdown', 'wispkit.mermaid', 'wispkit.image', 'wispkit.video', 'wispkit.html', 'wispkit.xaml']) {
			assert.strictEqual(customEditor(viewType).priority, 'default', `${viewType} 必须默认接管`);
		}
	});

	it('只读文本是 option（不能抢所有文件的打开方式）', () => {
		assert.strictEqual(customEditor('wispkit.text').priority, 'option');
	});

	it('HTML 视图覆盖 .html 与 .htm', () => {
		const patterns = customEditor('wispkit.html').selector.map((selector: any) => selector.filenamePattern);
		assert.deepStrictEqual(patterns, ['*.html', '*.htm']);
	});

	it('Mermaid 视图覆盖 .mmd 与 .mermaid，并注册激活事件', () => {
		const patterns = customEditor('wispkit.mermaid').selector.map((selector: any) => selector.filenamePattern);
		assert.deepStrictEqual(patterns, ['*.mmd', '*.mermaid']);
		assert.ok((manifest().activationEvents ?? []).includes('onCustomEditor:wispkit.mermaid'));
	});

	it('图片视图的扩展名清单与 media/formats.ts 完全一致（含 svg / webp / heic / heif）', () => {
		const pattern = customEditor('wispkit.image').selector[0].filenamePattern;
		const extensions = /^\*\.\{(.+)\}$/.exec(pattern)?.[1].split(',') ?? [];
		assert.deepStrictEqual(extensions.slice().sort(), [...IMAGE_EXTENSIONS].sort());
		for (const extension of ['svg', 'webp', 'heic', 'heif']) {
			assert.ok(extensions.includes(extension), `图片选择器缺少 .${extension}`);
		}
	});

	it('视频视图覆盖常见容器，且绝不包含 TypeScript 的 .ts', () => {
		const editor = customEditor('wispkit.video');
		const pattern = editor.selector[0].filenamePattern;
		const extensions = /^\*\.\{(.+)\}$/.exec(pattern)?.[1].split(',') ?? [];
		assert.deepStrictEqual(extensions.slice().sort(), [...VIDEO_EXTENSIONS].sort());
		for (const extension of ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'rmvb']) {
			assert.ok(extensions.includes(extension), `视频选择器缺少 .${extension}`);
		}
		assert.ok(!extensions.includes('ts'), '.ts 是 TypeScript 源码，不能注册成视频');
		assert.ok((manifest().activationEvents ?? []).includes('onCustomEditor:wispkit.video'));
	});
});

describe('package.json 3D 浏览与自定义资源管理', () => {
	const data = manifest();

	it('Markdown / Mermaid 文件右键菜单包含 3D 可视化浏览', () => {
		const command = (data.contributes.commands ?? []).find((item: any) => item.command === 'wispkit.graph3d.open');
		assert.ok(command, '必须贡献 wispkit.graph3d.open');
		assert.strictEqual(command.title, '3D Visualization');
		const menu = (data.contributes.menus?.['explorer/context'] ?? [])
			.find((item: any) => item.command === 'wispkit.graph3d.open');
		assert.ok(menu, '资源管理器右键菜单必须出现 3D 浏览');
		for (const extension of ['.md', '.markdown', '.mmd', '.mermaid']) {
			assert.ok(menu.when.includes(`resourceExtname == ${extension}`), `3D 浏览应覆盖 ${extension}`);
		}
		assert.ok((data.activationEvents ?? []).includes('onCommand:wispkit.graph3d.open'));
	});

	it('命令面板始终列出 3D 可视化浏览（非 Markdown 的明确提示由命令处理器负责）', () => {
		const palette = (data.contributes.menus?.commandPalette ?? [])
			.find((item: any) => item.command === 'wispkit.graph3d.open');
		assert.ok(palette, '命令面板需要一条 commandPalette 贡献');
		assert.strictEqual(palette.when, 'true', '不能再用 when 把命令面板条目在非 Markdown 时隐藏');
	});

	it('活动栏有「自定义资源管理」视图与欢迎页', () => {
		const container = (data.contributes.viewsContainers?.activitybar ?? []).find((item: any) => item.id === 'wispkit');
		assert.ok(container, '必须贡献 Wispkit 活动栏容器');
		assert.ok(container.icon.endsWith('.svg'));
		const view = (data.contributes.views?.wispkit ?? []).find((item: any) => item.id === 'wispkit.resourceTree');
		assert.ok(view, '必须贡献资源树视图');
		assert.strictEqual(view.name, 'Custom Resource Tree');
		const welcome = (data.contributes.viewsWelcome ?? []).find((item: any) => item.view === 'wispkit.resourceTree');
		assert.ok(welcome?.contents.includes('wispkit.resourceTree.addFolder'));
		assert.ok((data.activationEvents ?? []).includes('onView:wispkit.resourceTree'));
	});

	it('资源树的增删改 / 移动 / 导入导出 / 刷新命令齐全，且没有重复 id', () => {
		const ids = (data.contributes.commands ?? []).map((item: any) => item.command);
		assert.strictEqual(new Set(ids).size, ids.length, '命令 id 不能重复');
		for (const id of [
			'wispkit.resourceTree.addGroup',
			'wispkit.resourceTree.addFolder',
			'wispkit.resourceTree.addFolderFromExplorer',
			'wispkit.resourceTree.rename',
			'wispkit.resourceTree.remove',
			'wispkit.resourceTree.moveTo',
			'wispkit.resourceTree.moveUp',
			'wispkit.resourceTree.moveDown',
			'wispkit.resourceTree.openFolder',
			'wispkit.resourceTree.openTerminal',
			'wispkit.resourceTree.copyPath',
			'wispkit.resourceTree.openInVSCode',
			'wispkit.resourceTree.openInSystemExplorer',
			'wispkit.resourceTree.systemTerminal.cmd',
			'wispkit.resourceTree.systemTerminal.powerShell',
			'wispkit.resourceTree.systemTerminal.cmdAdmin',
			'wispkit.resourceTree.systemTerminal.powerShellAdmin',
			'wispkit.resourceTree.systemTerminal.terminalApp',
			'wispkit.resourceTree.systemTerminal.linux',
			'wispkit.resourceTree.refresh',
			'wispkit.resourceTree.import',
			'wispkit.resourceTree.export',
			'wispkit.resourceTree.openStorage',
		]) {
			assert.ok(ids.includes(id), `缺少命令 ${id}`);
		}
		const viewTitle = data.contributes.menus?.['view/title'] ?? [];
		assert.ok(viewTitle.some((item: any) => item.command === 'wispkit.resourceTree.refresh' && item.when === 'view == wispkit.resourceTree'));
		const itemMenu = data.contributes.menus?.['view/item/context'] ?? [];
		assert.ok(itemMenu.some((item: any) => item.command === 'wispkit.resourceTree.remove'));
	});

	it('资源树 JSON 路径可通过设置覆盖', () => {
		const property = data.contributes.configuration?.properties?.['wispkit.resourceTree.file'];
		assert.ok(property, '必须有 wispkit.resourceTree.file 设置');
		assert.strictEqual(property.default, '.WispkitView/resource-tree.json');
	});

	it('视图标题包含全部六个入口：新建组 / 添加文件夹 / 刷新 / 导入 / 导出 / 打开 JSON', () => {
		const viewTitle = data.contributes.menus?.['view/title'] ?? [];
		for (const command of [
			'wispkit.resourceTree.addGroup',
			'wispkit.resourceTree.addFolder',
			'wispkit.resourceTree.refresh',
			'wispkit.resourceTree.import',
			'wispkit.resourceTree.export',
			'wispkit.resourceTree.openStorage',
		]) {
			assert.ok(
				viewTitle.some((item: any) => item.command === command && item.when === 'view == wispkit.resourceTree'),
				`视图标题缺少 ${command}`,
			);
		}
	});

	it('组与文件夹都能新建子组 / 子文件夹，并支持重命名 / 移动 / 上下移 / 删除', () => {
		const itemMenu = data.contributes.menus?.['view/item/context'] ?? [];
		const containerWhen = 'view == wispkit.resourceTree && viewItem =~ /^wispkitResource(Group|Folder)$/';
		for (const command of [
			'wispkit.resourceTree.addGroup',
			'wispkit.resourceTree.addFolder',
			'wispkit.resourceTree.rename',
			'wispkit.resourceTree.moveTo',
			'wispkit.resourceTree.moveUp',
			'wispkit.resourceTree.moveDown',
			'wispkit.resourceTree.remove',
		]) {
			assert.ok(
				itemMenu.some((item: any) => item.command === command && item.when === containerWhen),
				`条目右键菜单缺少 ${command}`,
			);
		}
		const inlineBrowse = itemMenu.find((item: any) => item.command === 'wispkit.resourceTree.openFolder');
		assert.ok(inlineBrowse, '文件夹需要内联「浏览文件夹」');
		assert.ok(inlineBrowse.when.includes('viewItem == wispkitResourceFolder'));
		assert.ok(inlineBrowse.group.includes('inline'), '浏览文件夹应作为内联图标出现');
	});

	it('每个文件夹条目最右侧有「在终端中打开」内联按钮', () => {
		const command = (data.contributes.commands ?? [])
			.find((item: any) => item.command === 'wispkit.resourceTree.openTerminal');
		assert.ok(command, '必须贡献 wispkit.resourceTree.openTerminal');
		assert.strictEqual(command.title, 'Open in Integrated Terminal');
		assert.strictEqual(command.icon, '$(terminal)');

		const itemMenu = data.contributes.menus?.['view/item/context'] ?? [];
		const entry = itemMenu.find((item: any) => item.command === 'wispkit.resourceTree.openTerminal');
		assert.ok(entry, '文件夹条目缺少内联「在终端中打开」');
		assert.strictEqual(
			entry.when,
			'view == wispkit.resourceTree && viewItem == wispkitResourceFolder',
			'终端按钮只应出现在文件夹节点上（虚拟组不对应磁盘目录）',
		);
		assert.ok(String(entry.group).startsWith('inline'), '终端按钮应内联显示在行尾');

		const browse = itemMenu.find((item: any) => item.command === 'wispkit.resourceTree.openFolder');
		const order = (group: string) => Number(group.split('@')[1] ?? 0);
		assert.ok(
			order(entry.group) > order(browse.group),
			'终端按钮的排序必须大于「浏览文件夹」，才能显示在最右侧',
		);
	});

	it('资源管理器右键文件夹可「添加到自定义资源管理」', () => {
		const explorerMenu = data.contributes.menus?.['explorer/context'] ?? [];
		const entry = explorerMenu.find((item: any) => item.command === 'wispkit.resourceTree.addFolderFromExplorer');
		assert.ok(entry, '资源管理器右键菜单缺少添加文件夹入口');
		assert.strictEqual(entry.when, 'explorerResourceIsFolder');
		assert.ok((data.activationEvents ?? []).includes('onCommand:wispkit.resourceTree.addFolderFromExplorer'));
	});

	it('空树欢迎页说明存储文件位置', () => {
		const welcome = (data.contributes.viewsWelcome ?? []).find((item: any) => item.view === 'wispkit.resourceTree');
		assert.ok(welcome?.contents.includes('.WispkitView/resource-tree.json'));
		assert.ok(welcome?.contents.includes('wispkit.resourceTree.addGroup'));
		assert.ok(welcome?.contents.includes('wispkit.resourceTree.addFolder'));
	});
});

describe('package.json 文件夹右键菜单', () => {
	const data = manifest();
	const folderWhen = 'view == wispkit.resourceTree && viewItem == wispkitResourceFolder';
	const itemMenu: any[] = data.contributes.menus?.['view/item/context'] ?? [];

	it('文件夹右键菜单包含复制路径 / 内置终端 / 系统终端 / VS Code / 系统资源管理器', () => {
		for (const command of [
			'wispkit.resourceTree.openFolder',
			'wispkit.resourceTree.copyPath',
			'wispkit.resourceTree.openTerminal',
			'wispkit.resourceTree.openInVSCode',
			'wispkit.resourceTree.openInSystemExplorer',
		]) {
			const entries = itemMenu.filter((item: any) => item.command === command && item.when === folderWhen);
			assert.ok(entries.length > 0, `文件夹右键菜单缺少 ${command}`);
			assert.ok(
				entries.some((item: any) => !String(item.group).startsWith('inline')),
				`${command} 必须在右键菜单分组里（不能只有内联按钮）`,
			);
		}
		// 同一个 submenu id 在同一个菜单里只能贡献一条（重复贡献时 VS Code 只认
		// 其中一条），所以 when 里同时写上存储器挂载点条件。
		const submenuEntries = itemMenu.filter((item: any) => item.submenu === 'wispkit.resourceTree.systemTerminalMenu');
		assert.strictEqual(submenuEntries.length, 1, '系统终端子菜单只能贡献一条');
		const submenu = submenuEntries[0];
		assert.ok(submenu.when.startsWith(folderWhen), '系统终端子菜单必须覆盖文件夹节点');
		assert.ok(
			submenu.when.includes('view == wispkit.storage && viewItem == wispkitStorageMount'),
			'存储器挂载点必须复用同一个系统终端子菜单',
		);
		assert.strictEqual(submenu.group, '4_open@4');
	});

	it('系统终端子菜单按平台过滤，Windows 提供 cmd / PowerShell 及管理员选项', () => {
		const submenus: any[] = data.contributes.submenus ?? [];
		const definition = submenus.find((item: any) => item.id === 'wispkit.resourceTree.systemTerminalMenu');
		assert.ok(definition, '必须贡献 submenu wispkit.resourceTree.systemTerminalMenu');
		assert.strictEqual(definition.label, 'Open in System Terminal');

		const entries: any[] = data.contributes.menus?.['wispkit.resourceTree.systemTerminalMenu'] ?? [];
		const byCommand = (id: string) => entries.find((item: any) => item.command === id);
		for (const id of [
			'wispkit.resourceTree.systemTerminal.cmd',
			'wispkit.resourceTree.systemTerminal.powerShell',
			'wispkit.resourceTree.systemTerminal.cmdAdmin',
			'wispkit.resourceTree.systemTerminal.powerShellAdmin',
		]) {
			const entry = byCommand(id);
			assert.ok(entry, `Windows 系统终端缺少 ${id}`);
			assert.strictEqual(entry.when, 'isWindows', `${id} 只能在 Windows 出现`);
		}
		assert.strictEqual(byCommand('wispkit.resourceTree.systemTerminal.terminalApp')?.when, 'isMac');
		assert.strictEqual(byCommand('wispkit.resourceTree.systemTerminal.linux')?.when, 'isLinux');

		// 命令面板同样不能把其它平台的终端选项列出来。
		const palette: any[] = data.contributes.menus?.commandPalette ?? [];
		const paletteWhen = (id: string) => palette.find((item: any) => item.command === id)?.when;
		for (const id of [
			'wispkit.resourceTree.systemTerminal.cmd',
			'wispkit.resourceTree.systemTerminal.powerShell',
			'wispkit.resourceTree.systemTerminal.cmdAdmin',
			'wispkit.resourceTree.systemTerminal.powerShellAdmin',
		]) {
			assert.strictEqual(paletteWhen(id), 'isWindows', `${id} 在命令面板里也只能 Windows 可见`);
		}
		assert.strictEqual(paletteWhen('wispkit.resourceTree.systemTerminal.terminalApp'), 'isMac');
		assert.strictEqual(paletteWhen('wispkit.resourceTree.systemTerminal.linux'), 'isLinux');
	});

	it('复制路径 / 在 VS Code 中打开 / 系统资源管理器的标题与图标可读', () => {
		const commands: any[] = data.contributes.commands ?? [];
		const byId = (id: string) => commands.find((item: any) => item.command === id);
		assert.strictEqual(byId('wispkit.resourceTree.copyPath')?.title, 'Copy Path');
		assert.strictEqual(byId('wispkit.resourceTree.openInVSCode')?.title, 'Open in VS Code');
		assert.strictEqual(byId('wispkit.resourceTree.openInSystemExplorer')?.title, 'Open in System File Explorer');
		assert.strictEqual(byId('wispkit.resourceTree.systemTerminal.cmdAdmin')?.icon, '$(shield)');
	});
});

/**
 * 用户报过「导航里缺少 #### 这种四级标题」。Markdown 规范只有六级标题，
 * 目录必须默认全部解析展示；`toc.depth` 只能作为收窄手段，不能把默认值留在 3。
 */
describe('package.json Markdown 目录层级', () => {
	const data = manifest();

	it('toc.depth 默认 6：Markdown 规范支持几级就展示几级', () => {
		const property = data.contributes.configuration?.properties?.['wispkit.toc.depth'];
		assert.ok(property, '必须有 wispkit.toc.depth 设置');
		assert.strictEqual(property.default, 6);
		assert.strictEqual(property.minimum, 1);
		assert.strictEqual(property.maximum, 6);
	});
});
