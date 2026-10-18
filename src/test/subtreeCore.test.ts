import * as assert from 'assert';
import * as path from 'node:path';
import { DEFAULT_COLUMNS, extensionOf, fileCategory, formatCell, formatMode, formatSize, formatTime, resolveColumns } from '../subtree/columns';
import { expandVariables, formatCommandLine, parseToolConfig, parseTools, resolveToolInvocation, toolVariables } from '../subtree/config';
import {
	BUILTIN_EXPLORER_COMMANDS,
	COMMAND_GROUP_ORDER,
	collectExplorerCommands,
	filterAvailableCommands,
	groupCommands,
	humanizeCommandId,
	isCommandApplicable,
	NATIVE_FILE_COMMANDS,
	resolveCommandLabel,
} from '../subtree/explorerCommands';
import {
	deleteConfirmation,
	describeClipboard,
	pasteTargetNames,
	resolvePasteDirectory,
	uniqueName,
	validateEntryName,
} from '../subtree/fileActions';
import { DEFAULT_SORT, nextSortState, parseSortState, sortEntries } from '../subtree/sort';
import type { TreeEntry } from '../subtree/types';
import { manifestPaths, parseManifest, resolveEntryPath } from '../subtree/wispkitView';

function entry(overrides: Partial<TreeEntry> = {}): TreeEntry {
	return {
		name: 'a.txt',
		path: path.join('C:', 'x', 'a.txt'),
		isDirectory: false,
		size: 1536,
		mtime: new Date(2024, 0, 2, 3, 4, 5).getTime(),
		ctime: 0,
		atime: 0,
		mode: 0o644,
		...overrides,
	};
}

describe('subtree/columns', () => {
	it('按配置顺序给出列，并过滤未知项', () => {
		assert.deepStrictEqual(resolveColumns(['name', 'size', 'bogus']), ['name', 'size']);
		assert.deepStrictEqual(resolveColumns(['mtime', 'name']), ['mtime', 'name']);
	});

	it('重复列只保留一次', () => {
		assert.deepStrictEqual(resolveColumns(['name', 'name', 'size']), ['name', 'size']);
	});

	it('配置缺失或全部非法时回退默认列（而不是渲染空表）', () => {
		assert.deepStrictEqual(resolveColumns(undefined), [...DEFAULT_COLUMNS]);
		assert.deepStrictEqual(resolveColumns('name'), [...DEFAULT_COLUMNS]);
		assert.deepStrictEqual(resolveColumns([]), [...DEFAULT_COLUMNS]);
		assert.deepStrictEqual(resolveColumns([1, null, 'nope']), [...DEFAULT_COLUMNS]);
	});

	it('大小按单位换算，非法值显示 -', () => {
		assert.strictEqual(formatSize(0), '0 B');
		assert.strictEqual(formatSize(512), '512 B');
		assert.strictEqual(formatSize(1536), '1.5 KB');
		assert.strictEqual(formatSize(1024 * 1024 * 3), '3.0 MB');
		assert.strictEqual(formatSize(1024 * 1024 * 1024 * 40), '40 GB');
		assert.strictEqual(formatSize(-1), '-');
		assert.strictEqual(formatSize(Number.NaN), '-');
	});

	it('时间用本地时区、秒级；拿不到时间戳显示 -', () => {
		assert.strictEqual(formatTime(new Date(2024, 0, 2, 3, 4, 5).getTime()), '2024-01-02 03:04:05');
		assert.strictEqual(formatTime(0), '-');
		assert.strictEqual(formatTime(Number.NaN), '-');
	});

	it('权限位转成 rwx 串；未知（0）显示 -', () => {
		assert.strictEqual(formatMode(0o755), 'rwxr-xr-x');
		assert.strictEqual(formatMode(0o644), 'rw-r--r--');
		assert.strictEqual(formatMode(0), '-');
	});

	it('扩展名：点号开头的隐藏文件与结尾点号都算没有扩展名', () => {
		assert.strictEqual(extensionOf('a.tar.gz'), 'gz');
		assert.strictEqual(extensionOf('a.txt'), 'txt');
		assert.strictEqual(extensionOf('.gitignore'), '-');
		assert.strictEqual(extensionOf('noext'), '-');
		assert.strictEqual(extensionOf('trailing.'), '-');
	});

	it('单元格：目录的大小/扩展名是 -，类型按扩展名归类', () => {
		const context = { owner: 'tester' };
		assert.strictEqual(formatCell('name', entry(), context), 'a.txt');
		assert.strictEqual(formatCell('ext', entry(), context), 'txt');
		assert.strictEqual(formatCell('size', entry(), context), '1.5 KB');
		assert.strictEqual(formatCell('type', entry(), context), '文档');
		assert.strictEqual(formatCell('owner', entry(), context), 'tester');

		const folder = entry({ name: 'src', isDirectory: true, size: 0 });
		assert.strictEqual(formatCell('ext', folder, context), '-');
		assert.strictEqual(formatCell('size', folder, context), '-');
		assert.strictEqual(formatCell('type', folder, context), '文件夹');
	});

	it('owner 为空时不崩，显示 -', () => {
		assert.strictEqual(formatCell('owner', entry(), { owner: '' }), '-');
	});
});

describe('subtree/config', () => {
	it('工具配置缺 label/command 判为非法', () => {
		assert.strictEqual(parseToolConfig({ label: 'x' }), undefined);
		assert.strictEqual(parseToolConfig({ command: 'y' }), undefined);
		assert.strictEqual(parseToolConfig({ label: '  ', command: 'y' }), undefined);
		assert.strictEqual(parseToolConfig(null), undefined);
		assert.strictEqual(parseToolConfig([{ label: 'x', command: 'y' }]), undefined);
	});

	it('shell 缺省是 silent，非法值也退回 silent', () => {
		assert.strictEqual(parseToolConfig({ label: 'x', command: 'y' })?.shell, 'silent');
		assert.strictEqual(parseToolConfig({ label: 'x', command: 'y', shell: 'nope' })?.shell, 'silent');
		assert.strictEqual(parseToolConfig({ label: 'x', command: 'y', shell: 'external' })?.shell, 'external');
	});

	it('args 里非字符串项被丢掉', () => {
		const tool = parseToolConfig({ label: 'x', command: 'y', args: ['a', 1, null, 'b'] });
		assert.deepStrictEqual(tool?.args, ['a', 'b']);
	});

	it('parseTools 跳过非法项但保留合法项', () => {
		const tools = parseTools([{ label: 'x', command: 'y' }, { label: 'bad' }, 'nope']);
		assert.strictEqual(tools.length, 1);
		assert.strictEqual(tools[0].label, 'x');
	});

	it('变量替换：已知变量替换，未知变量原样保留（可见地失败）', () => {
		assert.strictEqual(expandVariables('a ${file} b', { file: '/x' }), 'a /x b');
		assert.strictEqual(expandVariables('${typo}', { file: '/x' }), '${typo}');
		assert.strictEqual(expandVariables('${1bad}', {}), '${1bad}');
		assert.strictEqual(expandVariables('没有变量', {}), '没有变量');
	});

	it('工具变量：目录的 dir 是自己，文件的 dir 是父目录', () => {
		const folderVariables = toolVariables(entry({ path: path.join('C:', 'x', 'sub'), isDirectory: true }));
		assert.strictEqual(folderVariables.dir, path.join('C:', 'x', 'sub'));
		assert.strictEqual(folderVariables.name, 'a.txt');

		const fileVariables = toolVariables(entry(), 'C:\\ws');
		assert.strictEqual(fileVariables.dir, path.join('C:', 'x'));
		assert.strictEqual(fileVariables.workspaceFolder, 'C:\\ws');
		assert.strictEqual(fileVariables.file, path.join('C:', 'x', 'a.txt'));
	});

	it('workspaceFolder 缺省为空串而不是 undefined', () => {
		assert.strictEqual(toolVariables(entry()).workspaceFolder, '');
	});

	it('命令与参数一起展开，只给含空格的参数加引号', () => {
		const tool = parseToolConfig({
			label: 'copy',
			command: 'robocopy',
			args: ['${file}', '${dir}\\backup', '含 空格'],
			shell: 'newTerminal',
		});
		assert.ok(tool);
		const invocation = resolveToolInvocation(tool, entry(), 'C:\\ws');
		assert.strictEqual(invocation.command, 'robocopy');
		assert.deepStrictEqual(invocation.args, [path.join('C:', 'x', 'a.txt'), `${path.join('C:', 'x')}\\backup`, '含 空格']);
		assert.strictEqual(invocation.shell, 'newTerminal');
		assert.strictEqual(
			formatCommandLine(invocation),
			`robocopy ${path.join('C:', 'x', 'a.txt')} ${path.join('C:', 'x')}\\backup "含 空格"`,
		);

		// 路径里有空格时必须加引号，否则终端会把一个路径拆成两个参数
		const spaced = resolveToolInvocation(tool, entry({ path: path.join('C:', 'program files', 'a.txt') }));
		assert.ok(
			formatCommandLine(spaced).includes(`"${path.join('C:', 'program files', 'a.txt')}"`),
			formatCommandLine(spaced),
		);
	});
});

describe('subtree/wispkitView', () => {
	it('解析合法配置（title 可选）', () => {
		const result = parseManifest('{"entry":".WispkitView/index.html","openWith":"wispkit.html"}');
		assert.strictEqual(result.error, undefined);
		assert.deepStrictEqual(result.manifest, { title: undefined, entry: '.WispkitView/index.html', openWith: 'wispkit.html' });

		const withTitle = parseManifest('{"title":"演示","entry":"a.html","openWith":"wispkit.html"}');
		assert.strictEqual(withTitle.manifest?.title, '演示');
	});

	it('缺 entry / 缺 openWith / 非法 JSON / 顶层不是对象 都给出可读原因', () => {
		assert.match(parseManifest('{"openWith":"wispkit.html"}').error ?? '', /entry/);
		assert.match(parseManifest('{"entry":"a.html"}').error ?? '', /openWith/);
		assert.match(parseManifest('{').error ?? '', /JSON/);
		assert.match(parseManifest('[]').error ?? '', /顶层/);
		assert.match(parseManifest('{"entry":"  ","openWith":"x"}').error ?? '', /entry/);
	});

	it('查找顺序：先 .WispkitView/Wispkit.json，再根上的 Wispkit.json', () => {
		const candidates = manifestPaths(path.join('C:', 'proj'));
		assert.strictEqual(candidates.length, 2);
		assert.ok(candidates[0].includes('.WispkitView'));
		assert.ok(candidates[0].endsWith('Wispkit.json'));
		assert.strictEqual(candidates[1], path.join('C:', 'proj', 'Wispkit.json'));
	});

	it('entry 解析成绝对路径；跑到文件夹外面判为非法', () => {
		const folder = path.join('C:', 'proj');
		assert.strictEqual(resolveEntryPath(folder, '.WispkitView/index.html'), path.join(folder, '.WispkitView', 'index.html'));
		assert.strictEqual(resolveEntryPath(folder, '../outside.html'), undefined);
		assert.strictEqual(resolveEntryPath(folder, 'a/../../outside.html'), undefined);
		assert.strictEqual(resolveEntryPath(folder, '.'), undefined);
	});
});

describe('subtree/explorerCommands', () => {
	it('内置白名单始终存在且 id 不重复', () => {
		assert.ok(BUILTIN_EXPLORER_COMMANDS.length > 0);
		const ids = BUILTIN_EXPLORER_COMMANDS.map(command => command.id);
		assert.strictEqual(new Set(ids).size, ids.length);
	});

	it('收集扩展贡献的 explorer/context 命令，并去掉标题里的类别前缀', () => {
		const commands = collectExplorerCommands([{
			id: 'demo.ext',
			packageJson: {
				contributes: {
					commands: [{ command: 'demo.doThing', title: 'Demo: 做点事' }],
					menus: { 'explorer/context': [{ command: 'demo.doThing', group: 'navigation' }] },
				},
			},
		}]);
		const found = commands.find(command => command.id === 'demo.doThing');
		assert.ok(found, '应当收集到扩展贡献的命令');
		assert.strictEqual(found.label, '做点事');
		assert.strictEqual(found.source, 'demo.ext');
	});

	it('同一命令只出现一次（扩展贡献与白名单撞车时以白名单为准）', () => {
		const commands = collectExplorerCommands([{
			id: 'demo.ext',
			packageJson: { contributes: { menus: { 'explorer/context': [{ command: 'copyFilePath' }] } } },
		}]);
		const matches = commands.filter(command => command.id === 'copyFilePath');
		assert.strictEqual(matches.length, 1);
		assert.strictEqual(matches[0].source, 'builtin');
	});

	it('没有 menus / 结构异常都不崩，只返回自研命令与内置白名单', () => {
		const expected = [...NATIVE_FILE_COMMANDS, ...BUILTIN_EXPLORER_COMMANDS];
		assert.deepStrictEqual(collectExplorerCommands([]), expected);
		assert.deepStrictEqual(
			collectExplorerCommands([{ id: 'a', packageJson: null }, { id: 'b', packageJson: { contributes: {} } }]),
			expected,
		);
		assert.deepStrictEqual(
			collectExplorerCommands([{ id: 'c', packageJson: { contributes: { menus: { 'explorer/context': 'nope' } } } }]),
			expected,
		);
	});

	it('没有 title 时用派生名兜底，**绝不显示 command id**（也不会出现空白按钮）', () => {
		const commands = collectExplorerCommands([{
			id: 'demo.ext',
			packageJson: { contributes: { menus: { 'explorer/context': [{ command: 'demo.noTitle' }] } } },
		}]);
		const label = commands.find(command => command.id === 'demo.noTitle')?.label;
		assert.strictEqual(label, 'No Title');
		assert.notStrictEqual(label, 'demo.noTitle', '不能用 command id 当标题');
	});
});

describe('subtree/fileCategory', () => {
	it('按扩展名归类；认不出的回落成「xxx 文件」', () => {
		assert.strictEqual(fileCategory(entry({ name: 'a.png' })), '图片');
		assert.strictEqual(fileCategory(entry({ name: 'a.ts' })), '代码');
		assert.strictEqual(fileCategory(entry({ name: 'a.json' })), '配置');
		assert.strictEqual(fileCategory(entry({ name: 'a.md' })), '文档');
		assert.strictEqual(fileCategory(entry({ name: 'a.html' })), '网页');
		assert.strictEqual(fileCategory(entry({ name: 'a.css' })), '网页');
		assert.strictEqual(fileCategory(entry({ name: 'a.zip' })), '压缩包');
		assert.strictEqual(fileCategory(entry({ name: 'a.exe' })), '可执行');
		assert.strictEqual(fileCategory(entry({ name: 'a.xyz' })), 'xyz 文件');
	});

	it('大小写无关；没有扩展名就是「文件」；文件夹优先', () => {
		assert.strictEqual(fileCategory(entry({ name: 'A.PNG' })), '图片');
		assert.strictEqual(fileCategory(entry({ name: 'LICENSE' })), '文件');
		assert.strictEqual(fileCategory(entry({ name: '.gitignore' })), '文件');
		assert.strictEqual(fileCategory(entry({ name: 'src', isDirectory: true })), '文件夹');
	});
});

describe('subtree/sort', () => {
	const entries: TreeEntry[] = [
		entry({ name: 'b.txt', size: 300, mtime: 3000 }),
		entry({ name: 'a.txt', size: 100, mtime: 1000 }),
		entry({ name: 'zdir', isDirectory: true, size: 0, mtime: 2000 }),
		entry({ name: 'c.txt', size: 200, mtime: 2000 }),
	];

	it('文件夹始终在前，方向只作用于组内', () => {
		assert.deepStrictEqual(
			sortEntries(entries, DEFAULT_SORT, 'o').map(item => item.name),
			['zdir', 'a.txt', 'b.txt', 'c.txt'],
		);
		assert.deepStrictEqual(
			sortEntries(entries, { key: 'name', direction: 'desc' }, 'o').map(item => item.name),
			['zdir', 'c.txt', 'b.txt', 'a.txt'],
		);
	});

	it('按大小/时间排序，用的是原始值而不是格式化文本', () => {
		assert.deepStrictEqual(
			sortEntries(entries, { key: 'size', direction: 'asc' }, 'o').map(item => item.name),
			['zdir', 'a.txt', 'c.txt', 'b.txt'],
		);
		assert.deepStrictEqual(
			sortEntries(entries, { key: 'size', direction: 'desc' }, 'o').map(item => item.name),
			['zdir', 'b.txt', 'c.txt', 'a.txt'],
		);
		assert.deepStrictEqual(
			sortEntries(entries, { key: 'mtime', direction: 'asc' }, 'o').map(item => item.name),
			['zdir', 'a.txt', 'c.txt', 'b.txt'],
		);
	});

	it('同值时按名称兜底，顺序稳定且不改动入参', () => {
		const tied = [entry({ name: 'b', size: 1 }), entry({ name: 'a', size: 1 })];
		assert.deepStrictEqual(
			sortEntries(tied, { key: 'size', direction: 'asc' }, 'o').map(item => item.name),
			['a', 'b'],
		);
		assert.deepStrictEqual(tied.map(item => item.name), ['b', 'a'], '不应就地排序');
	});

	it('nextSortState：同列切方向，换列回到升序', () => {
		assert.deepStrictEqual(nextSortState(DEFAULT_SORT, 'name'), { key: 'name', direction: 'desc' });
		assert.deepStrictEqual(nextSortState({ key: 'name', direction: 'desc' }, 'size'), { key: 'size', direction: 'asc' });
	});

	it('parseSortState 拒绝不在配置里的列与非法方向', () => {
		assert.deepStrictEqual(parseSortState('size', 'desc', ['name', 'size']), { key: 'size', direction: 'desc' });
		assert.strictEqual(parseSortState('mtime', 'asc', ['name', 'size']), undefined);
		assert.strictEqual(parseSortState('size', 'sideways', ['name', 'size']), undefined);
		assert.strictEqual(parseSortState(undefined, 'asc', ['name', 'size']), undefined);
	});
});

describe('subtree/explorerCommands 过滤与分组', () => {
	it('内置白名单里不存在的命令被剔除', () => {
		const first = BUILTIN_EXPLORER_COMMANDS[0];
		const filtered = filterAvailableCommands(BUILTIN_EXPLORER_COMMANDS, new Set([first.id]));
		assert.deepStrictEqual(filtered.map(command => command.id), [first.id]);
	});

	it('同 label 的内置命令只留第一条存活的（新旧 id 并存时靠 label 去重兜住）', () => {
		const duplicate = [
			{ id: 'builtin.old', label: '同名词', kind: 'builtin' as const, source: 'builtin', group: 'edit' as const, icon: 'rename', appliesTo: 'any' as const },
			{ id: 'builtin.new', label: '同名词', kind: 'builtin' as const, source: 'builtin', group: 'edit' as const, icon: 'rename', appliesTo: 'any' as const },
		];

		assert.deepStrictEqual(
			filterAvailableCommands(duplicate, new Set(['builtin.old', 'builtin.new'])).map(command => command.id),
			['builtin.old'],
			'两个都存活时只留第一条',
		);
		assert.deepStrictEqual(
			filterAvailableCommands(duplicate, new Set(['builtin.new'])).map(command => command.id),
			['builtin.new'],
			'只有新版存活时留新版',
		);
	});

	it('扩展贡献的命令不受可用性过滤影响（扩展可能尚未激活）', () => {
		const commands = collectExplorerCommands([{
			id: 'demo.ext',
			packageJson: { contributes: { menus: { 'explorer/context': [{ command: 'demo.x' }] } } },
		}]);
		const filtered = filterAvailableCommands(commands, new Set());
		assert.ok(filtered.some(command => command.id === 'demo.x'));
		assert.strictEqual(filtered.filter(command => command.source === 'builtin').length, 0);
	});

	it('白名单每条都有中文标签、图标与合法分组', () => {
		for (const command of BUILTIN_EXPLORER_COMMANDS) {
			assert.ok(command.label.trim().length > 0, `${command.id} 缺标签`);
			assert.ok(!/^[a-z]+\.[a-z]/i.test(command.label), `${command.id} 的标签不该是英文 id`);
			assert.ok(command.icon.length > 0, `${command.id} 缺图标`);
			assert.ok(COMMAND_GROUP_ORDER.includes(command.group), `${command.id} 的分组不在枚举里`);
		}
	});

	it('常用文件操作一个不少；作用于选中项的那些必须由 Wispkit 自己实现', () => {
		// 这些操作要求「对象 = 子树表格里的选中项」。内置的 filesExplorer.rename / explorer.newFile
		// 等只认资源管理器选中项（传进去的 uri 会被忽略），所以必须落在 NATIVE_FILE_COMMANDS。
		const native = NATIVE_FILE_COMMANDS.map(command => command.label);
		for (const expected of ['剪切', '复制', '粘贴', '重命名', '删除', '新建文件', '新建文件夹', '比较所选']) {
			assert.ok(native.includes(expected), `「${expected}」应当是 Wispkit 自研操作`);
		}

		// 内置白名单只保留**接受 uri 参数**的那些
		const builtinIds = BUILTIN_EXPLORER_COMMANDS.map(command => command.id);
		for (const forbidden of [
			'filesExplorer.rename', 'renameFile', 'filesExplorer.delete', 'deleteFile',
			'filesExplorer.cut', 'filesExplorer.copy', 'filesExplorer.paste',
			'explorer.newFile', 'explorer.newFolder', 'compareSelected',
		]) {
			assert.ok(!builtinIds.includes(forbidden), `${forbidden} 只认资源管理器选中项，不该留在白名单里`);
		}
		for (const expected of [
			'在资源管理器中显示', '在系统文件管理器中显示', '复制绝对路径', '复制相对路径',
			'在终端中打开', '在新窗口打开文件夹',
		]) {
			assert.ok(BUILTIN_EXPLORER_COMMANDS.some(command => command.label === expected), `缺少「${expected}」`);
		}
	});

	it('分组：按固定顺序输出，空组不留标题', () => {
		const groups = groupCommands([
			{ id: 'a', label: 'A', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'reveal', appliesTo: 'any' },
			{ id: 'b', label: 'B', kind: 'builtin', source: 'builtin', group: 'clipboard', icon: 'cut', appliesTo: 'any' },
			{ id: 'c', label: 'C', kind: 'builtin', source: 'builtin', group: 'clipboard', icon: 'copy', appliesTo: 'any' },
		]);
		assert.deepStrictEqual(groups.map(group => group.group), ['clipboard', 'navigate']);
		assert.deepStrictEqual(groups[0].commands.map(command => command.id), ['b', 'c']);
		assert.strictEqual(groups[0].label, '剪贴板');
	});

	it('自研文件操作一律 kind=native —— 前端据此走 fileAction 而不是 executeCommand', () => {
		for (const command of NATIVE_FILE_COMMANDS) {
			assert.strictEqual(command.kind, 'native', `${command.id} 应当是 native`);
			assert.ok(command.id.startsWith('wispkit.subtree.'), `${command.id} 应当用 wispkit 前缀`);
		}
		const paste = NATIVE_FILE_COMMANDS.find(command => command.id === 'wispkit.subtree.paste');
		assert.strictEqual(paste?.appliesTo, 'folders', '粘贴的目标落点只能是文件夹');
	});

	it('置灰规则表：按选中项形状判断，而不是一律「有没有选中」', () => {
		const commandOf = (id: string) => {
			const found = NATIVE_FILE_COMMANDS.find(command => command.id === id);
			assert.ok(found, `缺少 ${id}`);
			return found;
		};
		const rename = commandOf('wispkit.subtree.rename');
		const newFile = commandOf('wispkit.subtree.newFile');
		const compare = commandOf('wispkit.subtree.compare');
		const cut = commandOf('wispkit.subtree.cut');

		// 未选中：需要选中项的都禁用；`folders` 类仍可用（作用于根目录）
		assert.strictEqual(isCommandApplicable(rename, { count: 0, directoryCount: 0, unknown: false }), false);
		assert.strictEqual(isCommandApplicable(newFile, { count: 0, directoryCount: 0, unknown: false }), true);
		assert.strictEqual(isCommandApplicable(cut, { count: 0, directoryCount: 0, unknown: false }), false);

		// 选中**文件**：新建文件/新建文件夹必须禁用 —— 用户报的正是这条
		const oneFile = { count: 1, directoryCount: 0, unknown: false };
		assert.strictEqual(isCommandApplicable(newFile, oneFile), false);
		assert.strictEqual(isCommandApplicable(rename, oneFile), true);
		assert.strictEqual(isCommandApplicable(cut, oneFile), true);

		// 选中一个文件夹：新建类可用
		assert.strictEqual(isCommandApplicable(newFile, { count: 1, directoryCount: 1, unknown: false }), true);

		// 重命名只接受恰好一个；比较只接受恰好两个
		assert.strictEqual(isCommandApplicable(rename, { count: 2, directoryCount: 2, unknown: false }), false);
		assert.strictEqual(isCommandApplicable(compare, { count: 2, directoryCount: 1, unknown: false }), true);
		assert.strictEqual(isCommandApplicable(compare, { count: 3, directoryCount: 2, unknown: false }), false);

		// 选中项类型未知（已经从树里消失）→ 一律禁用，避免对幽灵条目操作
		assert.strictEqual(isCommandApplicable(cut, { count: 1, directoryCount: 1, unknown: true }), false);
	});

	it('命令标题：解析 %占位符%、查 nls，**永远不显示原始 command id**', () => {
		// 实测案例：typescript-language-features 的 title 就是 %typescript.findAllFileReferences%
		const localized = resolveCommandLabel(
			'%typescript.findAllFileReferences%',
			'typescript.findAllFileReferences',
			{ 'typescript.findAllFileReferences': 'Find All File References' },
		);
		assert.strictEqual(localized, 'Find All File References');

		// nls 读不到时做派生，而不是回落到 id
		const derived = resolveCommandLabel('%typescript.findAllFileReferences%', 'typescript.findAllFileReferences');
		assert.strictEqual(derived, 'Find All File References');
		assert.ok(!derived.includes('.'), '不该出现 command id 里的点号');

		// 普通标题去掉「分类: 」前缀
		assert.strictEqual(resolveCommandLabel('Wispkit: 做点事', 'demo.doThing'), '做点事');

		// 完全没有 title：
		assert.strictEqual(resolveCommandLabel(undefined, 'demo.doThing'), 'Do Thing');
		assert.strictEqual(resolveCommandLabel({}, 'weird_id-here'), 'Weird Id Here');

		// 派生函数自身的边界
		assert.strictEqual(humanizeCommandId('a.b.camelCaseName'), 'Camel Case Name');
		assert.strictEqual(humanizeCommandId('HTTPServerThing'), 'HTTP Server Thing');
		assert.strictEqual(humanizeCommandId(''), '未命名命令');
	});

	it('扩展贡献的命令：标题是本地化占位符时也不显示 command id', () => {
		const collected = collectExplorerCommands([{
			id: 'vscode.typescript-language-features',
			packageJson: {
				contributes: {
					menus: { 'explorer/context': [{ command: 'typescript.findAllFileReferences' }] },
					commands: [{ command: 'typescript.findAllFileReferences', title: '%typescript.findAllFileReferences%' }],
				},
			},
		}]);
		const found = collected.find(command => command.id === 'typescript.findAllFileReferences');
		assert.ok(found);
		assert.strictEqual(found.label, 'Find All File References');
		assert.strictEqual(found.kind, 'extension');
	});
});

describe('subtree/fileActions', () => {
	it('名字校验：空、路径分隔符、保留名、非法字符都要拦住', () => {
		assert.strictEqual(validateEntryName('a.txt'), undefined);
		assert.match(validateEntryName('') ?? '', /不能为空/);
		assert.match(validateEntryName('  ') ?? '', /不能为空/);
		assert.match(validateEntryName('a/b.txt') ?? '', /路径分隔符/);
		assert.match(validateEntryName('a\\b.txt') ?? '', /路径分隔符/);
		assert.match(validateEntryName('..') ?? '', /不能是/);
		assert.match(validateEntryName('a:b.txt') ?? '', /不能有/);
		assert.match(validateEntryName('a?.txt') ?? '', /不能有/);
		assert.match(validateEntryName('CON') ?? '', /保留名/);
		assert.match(validateEntryName('com1.txt') ?? '', /保留名/);
	});

	it('重名时让位：a.txt → a 副本.txt → a 副本 2.txt', () => {
		assert.strictEqual(uniqueName(new Set(), 'a.txt'), 'a.txt');
		assert.strictEqual(uniqueName(new Set(['a.txt']), 'a.txt'), 'a 副本.txt');
		assert.strictEqual(uniqueName(new Set(['a.txt', 'a 副本.txt']), 'a.txt'), 'a 副本 2.txt');
		// 大小写不敏感（Windows 上 A.txt 与 a.txt 不能共存）
		assert.strictEqual(uniqueName(new Set(['A.TXT']), 'a.txt'), 'a 副本.txt');
		// 隐藏文件没有扩展名可拆
		assert.strictEqual(uniqueName(new Set(['.gitignore']), '.gitignore'), '.gitignore 副本');
	});

	it('粘贴目标名：同一批里先算出来的名字会被后续让位', () => {
		const names = pasteTargetNames(
			['C:\\x\\a.txt', 'C:\\y\\a.txt'],
			new Set(['a.txt']),
			full => path.basename(full),
		);
		assert.deepStrictEqual(names, ['a 副本.txt', 'a 副本 2.txt']);
	});

	it('粘贴落点：选中文件夹→它自己；选中文件→它所在目录；未选中→根目录', () => {
		const isDir = (target: string) => target.endsWith('sub');
		assert.strictEqual(resolvePasteDirectory(['C:\\demo\\sub'], isDir, path.dirname, 'C:\\demo'), 'C:\\demo\\sub');
		assert.strictEqual(resolvePasteDirectory(['C:\\demo\\a.txt'], isDir, path.dirname, 'C:\\demo'), 'C:\\demo');
		assert.strictEqual(resolvePasteDirectory([], isDir, path.dirname, 'C:\\demo'), 'C:\\demo');
	});

	it('剪贴板与删除确认的文案', () => {
		assert.strictEqual(describeClipboard(undefined), undefined);
		assert.strictEqual(describeClipboard({ op: 'copy', paths: [] }), undefined);
		assert.strictEqual(describeClipboard({ op: 'copy', paths: ['a'] }), '剪贴板：已复制 1 项');
		assert.strictEqual(describeClipboard({ op: 'cut', paths: ['a', 'b'] }), '剪贴板：已剪切 2 项');

		assert.match(deleteConfirmation(1, 'a.txt'), /a\.txt/);
		assert.match(deleteConfirmation(3, 'a.txt'), /3 项/);
	});
});
