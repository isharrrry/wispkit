/**
 * 「复用资源管理器右键菜单项」的可行范围，按**执行方式**分三类：
 *
 * - `native`：**Wispkit 自己实现**的文件操作（剪切/复制/粘贴/重命名/删除/新建/比较）。
 *   之所以不能复用内置命令：`filesExplorer.rename`、`explorer.newFile`、`filesExplorer.paste`
 *   这些**不接受 URI 参数**，它们只作用于「资源管理器里当前选中的条目」—— 传进去的 uri 会被
 *   忽略，于是按钮看起来在操作子树表格里的条目，实际动的是资源管理器里的东西。
 *   这一层必须自己做，对象才可能是「子树表格的选中项」。
 * - `builtin`：**接受 URI 参数**的内置命令（复制路径 / 在资源管理器中显示 / 在终端打开…）。
 *   这部分可以安全地 `executeCommand(id, uri)`。它们不在任何扩展的 contributes 里，
 *   所以只能手工维护白名单，执行前用 `commands.getCommands(true)` 校验，不存在的直接消失。
 * - `extension`：已安装扩展 `contributes.menus['explorer/context']` 里贡献的命令 ——
 *   扩展自己声明的，收集到就能调；标题缺失时做本地化解析或派生，**绝不显示原始 command id**。
 */

export type CommandGroup = 'clipboard' | 'edit' | 'path' | 'navigate' | 'compare' | 'extension' | 'other';

/** 操作区里分组的先后顺序（同组之间会画分隔线）。 */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
	'clipboard',
	'edit',
	'path',
	'navigate',
	'compare',
	'extension',
	'other',
];

export const COMMAND_GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
	clipboard: '剪贴板',
	edit: '编辑',
	path: '路径',
	navigate: '导航',
	compare: '比较',
	extension: '扩展提供',
	other: '其他',
};

export type CommandKind = 'builtin' | 'native' | 'extension';

/**
 * 命令对「子树表格选中项」的要求 —— 前端据此置灰（不是按命令存不存在）。
 *
 * - `any`    ：任意选中，含多选。
 * - `single` ：恰好选中一个。
 * - `folders`：选中的必须**全是文件夹**。未选中时视为「操作根目录」，仍然可用。
 * - `two`    ：恰好选中两个（比较）。
 */
export type CommandAppliesTo = 'any' | 'single' | 'folders' | 'two';

export interface ExplorerCommand {
	readonly id: string;
	readonly label: string;
	readonly kind: CommandKind;
	/** `builtin` / `native` 之外，是贡献它的扩展 id。 */
	readonly source: string;
	/** 右侧操作区里的分组。 */
	readonly group: CommandGroup;
	/** 图标名，对应页面里内联 SVG sprite 的 `wispkit-icon-<name>`。 */
	readonly icon: string;
	readonly appliesTo: CommandAppliesTo;
	/** 置灰时作为 `title` 告诉用户为什么不能用。 */
	readonly disabledReason?: string;
}

export interface ExtensionContribution {
	readonly id: string;
	readonly packageJson: unknown;
	/** 该扩展 `package.nls.json` 的内容（英文键值对），用于解析 `%key%` 占位符标题。 */
	readonly nls?: Readonly<Record<string, string>>;
}

/**
 * Wispkit 自己实现的文件操作。id 前缀 `wispkit.subtree.` —— 前端看到这个 kind
 * 就走 `wispkit.subtree.fileAction` 消息，由宿主用 `workspace.fs` 执行。
 */
export const NATIVE_FILE_COMMANDS: readonly ExplorerCommand[] = [
	{ id: 'wispkit.subtree.cut', label: '剪切', kind: 'native', source: 'wispkit', group: 'clipboard', icon: 'cut', appliesTo: 'any' },
	{ id: 'wispkit.subtree.copy', label: '复制', kind: 'native', source: 'wispkit', group: 'clipboard', icon: 'copy', appliesTo: 'any' },
	{
		id: 'wispkit.subtree.paste', label: '粘贴', kind: 'native', source: 'wispkit', group: 'clipboard', icon: 'paste',
		appliesTo: 'folders', disabledReason: '粘贴需要一个文件夹作为目标（选中文件时请改选它所在的文件夹）',
	},

	{
		id: 'wispkit.subtree.rename', label: '重命名', kind: 'native', source: 'wispkit', group: 'edit', icon: 'rename',
		appliesTo: 'single', disabledReason: '重命名一次只能作用于一个条目',
	},
	{ id: 'wispkit.subtree.delete', label: '删除', kind: 'native', source: 'wispkit', group: 'edit', icon: 'trash', appliesTo: 'any' },
	{
		id: 'wispkit.subtree.newFile', label: '新建文件', kind: 'native', source: 'wispkit', group: 'edit', icon: 'new-file',
		appliesTo: 'folders', disabledReason: '新建文件需要选中一个文件夹（或取消选中，作用于根目录）',
	},
	{
		id: 'wispkit.subtree.newFolder', label: '新建文件夹', kind: 'native', source: 'wispkit', group: 'edit', icon: 'new-folder',
		appliesTo: 'folders', disabledReason: '新建文件夹需要选中一个文件夹（或取消选中，作用于根目录）',
	},

	{
		id: 'wispkit.subtree.compare', label: '比较所选', kind: 'native', source: 'wispkit', group: 'compare', icon: 'compare',
		appliesTo: 'two', disabledReason: '比较需要恰好选中两个文件',
	},
];

/**
 * 内置命令白名单 —— **只收录接受 URI 参数的那些**。
 *
 * 标签是中文的（内置命令没有可本地化的标题可用）。这里刻意不含
 * `filesExplorer.*` / `explorer.newFile` / `explorer.newFolder` / `compareSelected`：
 * 它们忽略传入的 uri、只作用于资源管理器选中项，已由 `NATIVE_FILE_COMMANDS` 取代。
 */
export const BUILTIN_EXPLORER_COMMANDS: readonly ExplorerCommand[] = [
	{ id: 'copyFilePath', label: '复制绝对路径', kind: 'builtin', source: 'builtin', group: 'path', icon: 'link', appliesTo: 'any' },
	{ id: 'copyRelativeFilePath', label: '复制相对路径', kind: 'builtin', source: 'builtin', group: 'path', icon: 'link', appliesTo: 'any' },

	{
		id: 'revealInExplorer', label: '在资源管理器中显示', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'reveal',
		appliesTo: 'single', disabledReason: '请在子树里选中一个条目',
	},
	{
		id: 'revealFileInOS', label: '在系统文件管理器中显示', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'reveal',
		appliesTo: 'single', disabledReason: '请在子树里选中一个条目',
	},
	{
		id: 'openInTerminal', label: '在终端中打开', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'terminal',
		appliesTo: 'single', disabledReason: '请在子树里选中一个条目',
	},
	{
		id: 'vscode.openFolder', label: '在新窗口打开文件夹', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'folder',
		appliesTo: 'single', disabledReason: '请在子树里选中一个文件夹',
	},
];

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function readContributes(packageJson: unknown): Record<string, unknown> | undefined {
	return readRecord(readRecord(packageJson)?.contributes);
}

/**
 * 该扩展是否贡献了 `explorer/context` 菜单项 —— 决定要不要为它读 `package.nls.json`
 * （读文件是异步 IO，只对真正可能贡献命令的扩展做）。
 */
export function hasExplorerContextMenu(packageJson: unknown): boolean {
	const contributes = readContributes(packageJson);
	if (!contributes) {
		return false;
	}
	const menu = readRecord(contributes.menus)?.['explorer/context'];
	return Array.isArray(menu) && menu.length > 0;
}

/**
 * 从 command id 派生人类可读名称：
 * `typescript.findAllFileReferences` → `Find All File References`。
 *
 * 这是**最后一道兜底** —— 任何情况下都不能把原始 command id 当成标题显示。
 */
export function humanizeCommandId(id: string): string {
	const trimmed = id.trim();
	if (!trimmed) {
		return '未命名命令';
	}

	const tail = trimmed.includes('.') ? trimmed.slice(trimmed.lastIndexOf('.') + 1) : trimmed;
	const words = tail
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim();

	if (!words) {
		return trimmed;
	}
	// 逐词首字母大写（`weird_id-here` → `Weird Id Here`）；已经是全大写的缩写（HTTP）保持原样
	return words
		.split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/**
 * 解析命令标题。三种情况依次处理：
 *
 * 1. 正常标题（可能带 `Wispkit: 前缀`）→ 去掉前缀直接用。
 * 2. `%key%` 本地化占位符 → 查该扩展的 `package.nls.json`；查不到就用**派生名**。
 * 3. 没有 title → 派生名。
 *
 * 实测案例：typescript-language-features 的 `package.json` 里
 * `{"command":"typescript.findAllFileReferences","title":"%typescript.findAllFileReferences%"}`
 * —— 不解析就会在界面上显示成 command id。
 */
export function resolveCommandLabel(title: unknown, id: string, nls?: Readonly<Record<string, string>>): string {
	if (typeof title === 'string' && title.trim()) {
		const raw = title.trim();
		const placeholder = /^%(.*)%$/.exec(raw);
		if (!placeholder) {
			return raw.replace(/^[^:：]*[:：]\s*/, '').trim() || humanizeCommandId(id);
		}

		const key = placeholder[1] || id;
		const localized = nls?.[key];
		if (typeof localized === 'string' && localized.trim()) {
			return localized.trim();
		}
		return humanizeCommandId(key);
	}

	return humanizeCommandId(id);
}

function rawCommandTitle(contributes: Record<string, unknown>, id: string): unknown {
	const commands = contributes.commands;
	if (!Array.isArray(commands)) {
		return undefined;
	}
	for (const item of commands) {
		const record = readRecord(item);
		if (record?.command === id) {
			return record.title;
		}
	}
	return undefined;
}

/**
 * 收集 `explorer/context` 里所有被贡献的命令，叠加自研命令与内置白名单。
 * 同 id 时以**先出现的**为准（native → builtin → extension）。
 */
export function collectExplorerCommands(extensions: readonly ExtensionContribution[]): ExplorerCommand[] {
	const collected: ExplorerCommand[] = [...NATIVE_FILE_COMMANDS, ...BUILTIN_EXPLORER_COMMANDS];
	const seen = new Set(collected.map(command => command.id));

	for (const extension of extensions) {
		const contributes = readContributes(extension.packageJson);
		if (!contributes) {
			continue;
		}
		const explorerMenu = readRecord(contributes.menus)?.['explorer/context'];
		if (!Array.isArray(explorerMenu)) {
			continue;
		}

		for (const item of explorerMenu) {
			const command = readRecord(item)?.command;
			if (typeof command !== 'string' || !command.trim() || seen.has(command)) {
				continue;
			}
			seen.add(command);
			collected.push({
				id: command,
				// 扩展贡献的命令保留原作者语言，标题缺失/未本地化时做派生，不给 command id
				label: resolveCommandLabel(rawCommandTitle(contributes, command), command, extension.nls),
				kind: 'extension',
				source: extension.id,
				group: 'extension',
				icon: 'extension',
				// 扩展命令自己决定要不要 uri；只要选中了东西就允许试，失败会可见地报错
				appliesTo: 'any',
			});
		}
	}

	return collected;
}

/**
 * 过滤掉当前 VS Code 里**确实不存在**的内置命令。
 *
 * - `builtin`：严格过滤，因为内置 id 随版本变动。
 * - `native`：我们自己注册的，永不过滤。
 * - `extension`：**不能**这样筛 —— 扩展可能还没激活，此时 `getCommands` 里没有，
 *   一旦激活就能用；这类命令在执行时再校验并可见地失败。
 *
 * 同一 label 只留第一条存活的（防止白名单里出现同义重复项）。
 */
export function filterAvailableCommands(
	commands: readonly ExplorerCommand[],
	available: ReadonlySet<string>,
): ExplorerCommand[] {
	const usedLabels = new Set<string>();
	const result: ExplorerCommand[] = [];

	for (const command of commands) {
		if (command.kind === 'builtin') {
			if (!available.has(command.id) || usedLabels.has(command.label)) {
				continue;
			}
			usedLabels.add(command.label);
		}
		result.push(command);
	}

	return result;
}

/** 按 `COMMAND_GROUP_ORDER` 归组，空组直接丢掉（界面上不留空标题）。 */
export function groupCommands(
	commands: readonly ExplorerCommand[],
): Array<{ group: CommandGroup; label: string; commands: ExplorerCommand[] }> {
	const buckets = new Map<CommandGroup, ExplorerCommand[]>();
	for (const command of commands) {
		const bucket = buckets.get(command.group);
		if (bucket) {
			bucket.push(command);
		} else {
			buckets.set(command.group, [command]);
		}
	}

	return COMMAND_GROUP_ORDER
		.filter(group => (buckets.get(group)?.length ?? 0) > 0)
		.map(group => ({ group, label: COMMAND_GROUP_LABELS[group], commands: buckets.get(group) as ExplorerCommand[] }));
}

/** 选中项的形状 —— 判断命令适不适用只需要这两个事实。 */
export interface SelectionShape {
	readonly count: number;
	readonly directoryCount: number;
	/** 有没有「选中项的类型」还不确定的条目（例如它已从树里消失）。 */
	readonly unknown: boolean;
}

/**
 * 命令对当前选中项是否适用。这是**唯一**的置灰判据，前端与测试共用。
 *
 * `folders` 在**未选中**时返回 true：没有选中就是「操作根目录」，
 * 否则首屏（还没点任何条目）连新建文件都用不了。
 */
export function isCommandApplicable(command: ExplorerCommand, selection: SelectionShape): boolean {
	if (selection.unknown) {
		return false;
	}

	switch (command.appliesTo) {
		case 'any':
			return selection.count > 0;
		case 'single':
			return selection.count === 1;
		case 'two':
			return selection.count === 2;
		case 'folders':
			return selection.count === 0 || (selection.directoryCount === selection.count && selection.count > 0);
		default:
			return false;
	}
}
