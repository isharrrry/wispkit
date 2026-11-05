import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { columnDefinition, formatCell, resolveColumns, type ColumnId } from './subtree/columns';
import { formatCommandLine, parseTools, resolveToolInvocation, type SubtreeToolConfig } from './subtree/config';
import { collectExplorerCommands, filterAvailableCommands, hasExplorerContextMenu, nlsFileCandidates, type ExplorerCommand, type ExtensionContribution } from './subtree/explorerCommands';
import {
	deleteConfirmation,
	describeClipboard,
	pasteTargetNames,
	resolvePasteDirectory,
	uniqueName,
	validateEntryName,
	type ClipboardState,
} from './subtree/fileActions';
import {
	decodeDataUrl,
	isMoveDropRequested,
	normalizeMime,
	parsePlainPathList,
	parseUriList,
	pickPrimaryString,
	renderContentForType,
	shortName,
	stemOfFileName,
	storageTypesFor,
	suggestedFileName,
	type DroppedFile,
	type DroppedString,
	type StorageType,
} from './subtree/drop';
import { renderSubtreePage, type SubtreeViewConfig } from './subtree/page';
import { findIconThemeFile, loadIconThemeDefinition, toWebviewIconTheme } from './subtree/iconThemeHost';
import type { IconThemeDefinition } from './subtree/iconTheme';
import { DEFAULT_SORT, parseSortState, sortEntries, type SortState } from './subtree/sort';
import type { TreeEntry } from './subtree/types';
import { strictContentSecurityPolicy } from './util/csp';
import { generateNonce } from './util/nonce';

export const SUBTREE_VIEW_TYPE = 'wispkit.subtree';

/** 一次最多返回多少个子项：目录上千条时一次性塞进 webview 会把界面拖死。 */
const MAX_ENTRIES = 2000;

interface SubtreeRow {
	readonly name: string;
	readonly path: string;
	readonly isDirectory: boolean;
	/** 父目录：拖放落到文件行上时，目标目录取它的父目录。 */
	readonly parentPath: string;
	/** 按当前列定义格式化好的文本，前端直接摆放（列定义只有一份实现）。 */
	readonly cells: Readonly<Record<string, string>>;
}

interface ReadResult {
	readonly rows: SubtreeRow[];
	/** 原始条目：排序改的是顺序而不是内容，所以缓存下来重排即可，不必重读盘。 */
	readonly entries: TreeEntry[];
	readonly error?: string;
}

function isInside(rootPath: string, candidate: string): boolean {
	const relative = path.relative(rootPath, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** 读扩展的 nls 文件：命令标题是 `%key%` 占位符时靠它还原成人类可读名称（当前语言优先，英文主版兜底）。 */
async function readExtensionNls(extensionUri: vscode.Uri): Promise<Record<string, string> | undefined> {
	for (const file of nlsFileCandidates(vscode.env.language)) {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, file));
			const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				continue;
			}
			const out: Record<string, string> = {};
			for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof value === 'string') {
					out[key] = value;
				}
			}
			return out;
		} catch {
			// 该语言没有 nls 文件就继续尝试下一个候选；全部缺失时交给 resolveCommandLabel 走派生名
		}
	}
	return undefined;
}

/** 内置白名单里不存在的命令直接从界面上消失 —— 只筛内置，扩展贡献的留到执行时校验。 */
async function availableExplorerCommands(): Promise<ExplorerCommand[]> {
	const contributions: ExtensionContribution[] = [];
	// 只有真的贡献了 explorer/context 的扩展才值得为它读一次 nls（异步 IO，不做无谓的）
	for (const extension of vscode.extensions.all) {
		if (!hasExplorerContextMenu(extension.packageJSON)) {
			continue;
		}
		contributions.push({
			id: extension.id,
			packageJson: extension.packageJSON,
			nls: await readExtensionNls(extension.extensionUri),
		});
	}

	const available = new Set(await vscode.commands.getCommands(true));
	return filterAvailableCommands(collectExplorerCommands(contributions), available);
}

function buildRows(
	entries: readonly TreeEntry[],
	columns: readonly ColumnId[],
	owner: string,
	sort: SortState,
): SubtreeRow[] {
	return sortEntries(entries, sort, owner).map(entry => {
		const cells: Record<string, string> = {};
		for (const column of columns) {
			cells[column] = formatCell(column, entry, { owner });
		}
		return {
			name: entry.name,
			path: entry.path,
			isDirectory: entry.isDirectory,
			parentPath: path.dirname(entry.path),
			cells,
		};
	});
}

/** 前端来的路径数组：新协议是 `paths`，同时兼容旧的单个 `path`。 */
function readPaths(message: Record<string, unknown>): string[] {
	if (Array.isArray(message.paths)) {
		return message.paths.filter((item): item is string => typeof item === 'string' && item.length > 0);
	}
	return typeof message.path === 'string' && message.path ? [message.path] : [];
}

/**
 * 子树浏览面板。按文件夹复用：同一个文件夹重复点图标只 reveal，不叠新窗口。
 *
 * 目录读取走 `workspace.fs`（远程/虚拟工作区也能用），**懒加载** —— 展开哪层读哪层。
 */
export class SubtreePanel {
	private static readonly panels = new Map<string, SubtreePanel>();

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const disposables: vscode.Disposable[] = [
			vscode.commands.registerCommand('wispkit.subtree.open', (uri?: vscode.Uri) => {
				const target = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
				if (!target) {
					void vscode.window.showWarningMessage('没有可浏览的文件夹：请从资源管理器里右键一个文件夹。');
					return;
				}
				void SubtreePanel.open(context, target);
			}),
		];

		const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration('wispkit.subtree')) {
				return;
			}
			for (const panel of SubtreePanel.panels.values()) {
				void panel.refreshConfig();
			}
		});

		disposables.push(configurationSubscription);
		return vscode.Disposable.from(...disposables);
	}

	public static async open(context: vscode.ExtensionContext, folderUri: vscode.Uri): Promise<SubtreePanel> {
		try {
			return await SubtreePanel.openInner(context, folderUri);
		} catch (error) {
			console.error('[wispkit-subtree] open failed:', error instanceof Error ? error.stack ?? error.message : String(error));
			throw error;
		}
	}

	private static async openInner(context: vscode.ExtensionContext, folderUri: vscode.Uri): Promise<SubtreePanel> {
		const key = folderUri.fsPath.toLowerCase();
		const existing = SubtreePanel.panels.get(key);
		if (existing) {
			existing.panel.reveal(vscode.ViewColumn.Active);
			return existing;
		}

		// 先把命令可用性问清楚再建页面：内置命令 id 随 VS Code 版本变动，
		// 不存在的必须在首屏就不出现，而不是点下去才发现没反应。
		const commands = await availableExplorerCommands();

		// 图标主题必须在建面板之前定位：localResourceRoots 只能在这一刻给，而主题的 svg
		// 在 VS Code 安装目录里（本机是内置扩展 theme-modern-icons），不放进 roots 的话
		// asWebviewUri 出来的地址会被 webview 拒绝加载，图标会整片消失。
		const iconFile = findIconThemeFile();
		const iconRoot = iconFile ? vscode.Uri.joinPath(iconFile, '..') : undefined;
		const resourceRoots = iconRoot ? [context.extensionUri, iconRoot] : [context.extensionUri];

		const panel = vscode.window.createWebviewPanel(
			SUBTREE_VIEW_TYPE,
			`子树：${path.basename(folderUri.fsPath) || folderUri.fsPath}`,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				enableForms: false,
				retainContextWhenHidden: true,
				localResourceRoots: resourceRoots,
			},
		);

		// 读盘解析要等 webview 存在（asWebviewUri 依赖它）；解析不出来就回退自绘 sprite。
		const iconTheme = await loadIconThemeDefinition();

		const instance = new SubtreePanel(context, folderUri, panel, commands, iconTheme);
		SubtreePanel.panels.set(key, instance);
		return instance;
	}

	private readonly owner = os.userInfo().username;
	private readonly disposables: vscode.Disposable[] = [];
	/** 已读过的层级（path → 原始条目），排序时用它重排，不必重新读盘。 */
	private readonly levelEntries = new Map<string, TreeEntry[]>();
	private sortState: SortState = DEFAULT_SORT;
	/** 自研文件操作的剪贴板；只活在面板实例里，关掉面板即失效。 */
	private clipboard: ClipboardState | undefined;
	private explorerCommands: readonly ExplorerCommand[];

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly folderUri: vscode.Uri,
		private readonly panel: vscode.WebviewPanel,
		commands: readonly ExplorerCommand[],
		private readonly iconTheme?: { definition: IconThemeDefinition; root: vscode.Uri },
	) {
		this.explorerCommands = commands;
		this.panel.webview.html = this.buildHtml();
		this.disposables.push(
			this.panel.webview.onDidReceiveMessage(message => void this.handleMessage(message)),
			this.panel.onDidDispose(() => this.dispose()),
		);
	}

	private get columns(): ColumnId[] {
		return resolveColumns(vscode.workspace.getConfiguration('wispkit').get('subtree.columns'));
	}

	private get tools(): SubtreeToolConfig[] {
		return parseTools(vscode.workspace.getConfiguration('wispkit').get('subtree.tools'));
	}

	private viewConfig(): SubtreeViewConfig {
		return {
			rootPath: this.folderUri.fsPath,
			rootName: path.basename(this.folderUri.fsPath) || this.folderUri.fsPath,
			owner: this.owner,
			columns: this.columns.map(id => columnDefinition(id)),
			commands: this.explorerCommands.map(command => ({
				id: command.id,
				label: command.label,
				kind: command.kind,
				source: command.source,
				group: command.group,
				icon: command.icon,
				appliesTo: command.appliesTo,
				disabledReason: command.disabledReason,
			})),
			tools: this.tools.map(tool => ({ label: tool.label, command: tool.command, shell: tool.shell })),
			sort: { key: this.sortState.key, direction: this.sortState.direction },
			clipboard: describeClipboard(this.clipboard),
			// 转不出 URI（主题不可解析 / asWebviewUri 抛错）时为 undefined，前端回退自绘 sprite。
			iconTheme: this.iconTheme
				? toWebviewIconTheme(this.iconTheme.definition, this.iconTheme.root, this.panel.webview)
				: undefined,
		};
	}

	private buildHtml(): string {
		const webview = this.panel.webview;
		const nonce = generateNonce();
		// 前端是自包含 ESM，直接引 media/ 下的源文件（不经 esbuild 打包，所以没有 dist 产物）。
		const toUri = (...parts: string[]): string =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts)).toString();

		return renderSubtreePage({
			title: `子树：${path.basename(this.folderUri.fsPath)}`,
			csp: strictContentSecurityPolicy(webview.cspSource, nonce),
			nonce,
			runtimeScript: toUri('media', 'subtree.js'),
			runtimeStyle: toUri('media', 'subtree.css'),
			config: this.viewConfig(),
		});
	}

	private async refreshConfig(): Promise<void> {
		this.explorerCommands = await availableExplorerCommands();
		void this.panel.webview.postMessage({ type: 'wispkit.subtree.config', config: this.viewConfig() });
	}

	private async handleMessage(message: Record<string, unknown>): Promise<void> {
		if (!message || typeof message !== 'object') {
			return;
		}

		switch (message.type) {
			case 'wispkit.subtree.read':
				await this.readLevel(String(message.path ?? ''), String(message.requestId ?? ''));
				return;
			case 'wispkit.subtree.sort':
				await this.applySort(message);
				return;
			case 'wispkit.subtree.command':
				await this.runExplorerCommand(String(message.command ?? ''), readPaths(message));
				return;
			case 'wispkit.subtree.fileAction':
				await this.runFileAction(String(message.action ?? ''), readPaths(message));
				return;
			case 'wispkit.subtree.tool':
				await this.runTool(Number(message.index), readPaths(message));
				return;
			case 'wispkit.subtree.open':
				await this.openEntry(String(message.path ?? ''));
				return;
			case 'wispkit.subtree.drop':
				await this.handleDrop(message);
				return;
			default:
				return;
		}
	}

	/** 只读根目录之内的路径：前端传来的 path 不该能跳到别处去。 */
	private async readLevel(requestedPath: string, requestId: string): Promise<void> {
		const webview = this.panel.webview;

		if (!requestedPath || !isInside(this.folderUri.fsPath, requestedPath)) {
			await webview.postMessage({
				type: 'wispkit.subtree.level',
				requestId,
				path: requestedPath,
				rows: [],
				error: '这个路径不在当前子树范围内。',
			});
			return;
		}

		const result = await readDirectoryEntries(vscode.Uri.file(requestedPath), this.columns, this.owner, this.sortState);
		if (!result.error) {
			this.levelEntries.set(requestedPath, result.entries);
		}
		await webview.postMessage({
			type: 'wispkit.subtree.level',
			requestId,
			path: requestedPath,
			rows: result.rows,
			error: result.error,
		});
	}

	/** 排序：改状态 + 用缓存重排所有已加载层级，一个字节都不用重读。 */
	private async applySort(message: Record<string, unknown>): Promise<void> {
		const columns = this.columns;
		const state = parseSortState(message.key, message.direction, columns);
		if (!state) {
			this.status('排序请求无效（列不在当前配置里）', 'error');
			return;
		}

		this.sortState = state;
		const requested = Array.isArray(message.paths) ? message.paths.filter((item): item is string => typeof item === 'string') : [];

		for (const target of requested) {
			const entries = this.levelEntries.get(target);
			if (!entries) {
				continue;
			}
			await this.panel.webview.postMessage({
				type: 'wispkit.subtree.level',
				requestId: '',
				path: target,
				rows: buildRows(entries, columns, this.owner, this.sortState),
			});
		}

		void this.panel.webview.postMessage({ type: 'wispkit.subtree.config', config: this.viewConfig() });
	}

	private status(message: string, kind?: 'error'): void {
		void this.panel.webview.postMessage({ type: 'wispkit.subtree.status', message, kind });
	}

	private async runExplorerCommand(command: string, targets: readonly string[]): Promise<void> {
		if (!command || targets.length === 0) {
			return;
		}

		// 内置白名单不保证每个 id 都存在（内置命令没有可枚举的清单），所以执行前再校验一次。
		const available = new Set(await vscode.commands.getCommands(true));
		if (!available.has(command)) {
			this.status(`命令 ${command} 不可用`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：命令 ${command} 不可用（可能来自未安装的扩展，或已被重命名）。`);
			return;
		}

		const failures: string[] = [];
		for (const target of targets) {
			try {
				await vscode.commands.executeCommand(command, vscode.Uri.file(target));
			} catch (error) {
				failures.push(error instanceof Error ? error.message : String(error));
			}
		}

		const scope = targets.length > 1 ? `（${targets.length} 项）` : '';
		if (failures.length > 0) {
			this.status(`执行 ${command} 失败${scope}：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：执行 ${command} 失败 —— ${failures[0]}`);
			return;
		}
		this.status(`已执行 ${command}${scope}`);
	}

	/**
	 * 自研文件操作。**对象永远是子树表格里的选中项**（`targets`）——
	 * 这正是不能用 `filesExplorer.*` 的原因：那些命令忽略传入的 uri，
	 * 只认资源管理器自己的选中状态，于是「对表格操作」变成了「对资源管理器操作」。
	 */
	private async runFileAction(action: string, targets: readonly string[]): Promise<void> {
		try {
			switch (action) {
				case 'wispkit.subtree.cut':
				case 'wispkit.subtree.copy': {
					const op = action === 'wispkit.subtree.cut' ? 'cut' : 'copy';
					this.clipboard = { op, paths: [...targets] };
					this.status(`已${op === 'cut' ? '剪切' : '复制'} ${targets.length} 项`);
					void this.panel.webview.postMessage({ type: 'wispkit.subtree.config', config: this.viewConfig() });
					return;
				}
				case 'wispkit.subtree.paste':
					await this.pasteInto(targets);
					return;
				case 'wispkit.subtree.rename':
					await this.renameEntry(targets[0]);
					return;
				case 'wispkit.subtree.delete':
					await this.deleteEntries(targets);
					return;
				case 'wispkit.subtree.newFile':
					await this.createEntry(targets, false);
					return;
				case 'wispkit.subtree.newFolder':
					await this.createEntry(targets, true);
					return;
				case 'wispkit.subtree.compare':
					await this.compareEntries(targets);
					return;
				default:
					this.status(`未知操作：${action}`, 'error');
					return;
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.status(`操作失败：${detail}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：操作失败 —— ${detail}`);
		}
	}

	private async pasteInto(targets: readonly string[]): Promise<void> {
		const state = this.clipboard;
		if (!state) {
			this.status('剪贴板是空的：先「复制」或「剪切」几个条目。', 'error');
			return;
		}

		const directory = resolvePasteDirectory(
			targets,
			target => this.isDirectoryCached(target),
			path.dirname,
			this.folderUri.fsPath,
		);
		if (!isInside(this.folderUri.fsPath, directory)) {
			this.status('粘贴目标不在当前子树范围内。', 'error');
			return;
		}

		const existing = new Set((await vscode.workspace.fs.readDirectory(vscode.Uri.file(directory))).map(([name]) => name));
		const names = pasteTargetNames(state.paths, existing, path.basename);

		for (let index = 0; index < state.paths.length; index += 1) {
			const source = vscode.Uri.file(state.paths[index]);
			const destination = vscode.Uri.joinPath(vscode.Uri.file(directory), names[index]);
			await vscode.workspace.fs.copy(source, destination, { overwrite: false });
			if (state.op === 'cut') {
				await vscode.workspace.fs.delete(source, { recursive: true, useTrash: true });
			}
		}

		const moved = state.op === 'cut';
		if (moved) {
			this.clipboard = undefined;
			void this.panel.webview.postMessage({ type: 'wispkit.subtree.config', config: this.viewConfig() });
		}
		this.status(`已${moved ? '移动' : '粘贴'} ${state.paths.length} 项到 ${path.basename(directory) || directory}`);
		await this.refreshLevelsFor([...state.paths, directory]);
	}

	private async renameEntry(target: string | undefined): Promise<void> {
		if (!target) {
			this.status('请先在子树里选中一个条目。', 'error');
			return;
		}

		const currentName = path.basename(target);
		const dot = currentName.lastIndexOf('.');
		const input = await vscode.window.showInputBox({
			prompt: `重命名 ${currentName}`,
			value: currentName,
			valueSelection: [0, dot > 0 ? dot : currentName.length],
			validateInput: value => validateEntryName(value),
		});
		if (input === undefined || input.trim() === currentName) {
			return;
		}

		const name = input.trim();
		const problem = validateEntryName(name);
		if (problem) {
			this.status(problem, 'error');
			return;
		}

		await vscode.workspace.fs.rename(
			vscode.Uri.file(target),
			vscode.Uri.joinPath(vscode.Uri.file(path.dirname(target)), name),
			{ overwrite: false },
		);
		this.status(`已重命名为 ${name}`);
		await this.refreshLevelsFor([target]);
	}

	private async deleteEntries(targets: readonly string[]): Promise<void> {
		if (targets.length === 0) {
			this.status('请先在子树里选中要删除的条目。', 'error');
			return;
		}

		const confirmed = await vscode.window.showWarningMessage(
			deleteConfirmation(targets.length, path.basename(targets[0])),
			{ modal: true },
			'删除',
		);
		if (confirmed !== '删除') {
			this.status('已取消删除');
			return;
		}

		const failures: string[] = [];
		for (const target of targets) {
			try {
				await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true });
			} catch (error) {
				failures.push(`${path.basename(target)}：${error instanceof Error ? error.message : String(error)}`);
			}
		}

		const scope = targets.length > 1 ? `（${targets.length} 项）` : '';
		if (failures.length > 0) {
			this.status(`删除失败${scope}：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：删除失败 —— ${failures[0]}`);
		} else {
			this.status(`已删除${scope}`);
		}
		await this.refreshLevelsFor(targets);
	}

	private async createEntry(targets: readonly string[], asFolder: boolean): Promise<void> {
		// 未选中 = 对根目录操作；选中文件夹 = 对它操作；选中的是文件 = 落在它所在目录
		const directory = targets.length === 0
			? this.folderUri.fsPath
			: (this.isDirectoryCached(targets[0]) ? targets[0] : path.dirname(targets[0]));

		if (!isInside(this.folderUri.fsPath, directory)) {
			this.status('目标目录不在当前子树范围内。', 'error');
			return;
		}

		const existing = new Set((await vscode.workspace.fs.readDirectory(vscode.Uri.file(directory))).map(([name]) => name));
		const suggested = uniqueName(existing, asFolder ? '新建文件夹' : '新建文件.txt');
		const dot = suggested.lastIndexOf('.');

		const input = await vscode.window.showInputBox({
			prompt: `${asFolder ? '新建文件夹' : '新建文件'}于 ${path.basename(directory) || directory}`,
			value: suggested,
			valueSelection: [0, asFolder ? suggested.length : (dot > 0 ? dot : suggested.length)],
			validateInput: value => validateEntryName(value),
		});
		if (input === undefined) {
			return;
		}

		const name = input.trim();
		const problem = validateEntryName(name);
		if (problem) {
			this.status(problem, 'error');
			return;
		}

		const target = vscode.Uri.joinPath(vscode.Uri.file(directory), name);
		if (asFolder) {
			await vscode.workspace.fs.createDirectory(target);
		} else {
			await vscode.workspace.fs.writeFile(target, new Uint8Array());
		}
		this.status(`已新建 ${name}`);
		await this.refreshLevelsFor([target.fsPath]);
	}

	/** 用 `vscode.diff` 而不是内置的 `compareSelected`：后者只认资源管理器的多选。 */
	private async compareEntries(targets: readonly string[]): Promise<void> {
		if (targets.length !== 2) {
			this.status('比较需要恰好选中两个文件。', 'error');
			return;
		}
		const [left, right] = targets;
		await vscode.commands.executeCommand(
			'vscode.diff',
			vscode.Uri.file(left),
			vscode.Uri.file(right),
			`${path.basename(left)} ↔ ${path.basename(right)}`,
		);
	}

	/** 表格条目的类型查已读层级的缓存 —— 顶层条目一定在某个已读层级里。 */
	private isDirectoryCached(target: string): boolean {
		for (const entries of this.levelEntries.values()) {
			const found = entries.find(entry => entry.path === target);
			if (found) {
				return found.isDirectory;
			}
		}
		return false;
	}

	/** 操作后重读受影响的层级：只重读**已经读过**的目录，没展开的不必管。 */
	private async refreshLevelsFor(paths: readonly string[]): Promise<void> {
		const directories = new Set<string>();
		for (const target of paths) {
			directories.add(path.dirname(target));
		}
		for (const directory of directories) {
			if (this.levelEntries.has(directory)) {
				await this.readLevel(directory, '');
			}
		}
	}

	private async runTool(index: number, targets: readonly string[]): Promise<void> {
		const tools = this.tools;
		const tool = Number.isInteger(index) && index >= 0 && index < tools.length ? tools[index] : undefined;
		if (!tool) {
			this.status('工具配置已变化，请刷新后重试', 'error');
			return;
		}
		if (targets.length === 0) {
			return;
		}

		const resolved: Array<{ invocation: ReturnType<typeof resolveToolInvocation>; cwd: string }> = [];
		for (const target of targets) {
			const entry = await entryFor(target);
			if (!entry) {
				this.status(`找不到条目：${target}`, 'error');
				return;
			}
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(target))?.uri.fsPath;
			resolved.push({
				invocation: resolveToolInvocation(tool, entry, workspaceFolder),
				cwd: entry.isDirectory ? entry.path : path.dirname(entry.path),
			});
		}

		const scope = targets.length > 1 ? `（${targets.length} 项）` : '';

		try {
			switch (tool.shell) {
				case 'currentTerminal': {
					const terminal = vscode.window.activeTerminal
						?? vscode.window.createTerminal({ cwd: resolved[0].cwd });
					terminal.show();
					// 多选时复用同一个终端：否则 20 个选中项会炸出 20 个终端
					for (const item of resolved) {
						terminal.sendText(formatCommandLine(item.invocation), true);
					}
					this.status(`已在当前终端执行：${tool.label}${scope}`);
					return;
				}
				case 'newTerminal': {
					const terminal = vscode.window.createTerminal({ name: tool.label, cwd: resolved[0].cwd });
					terminal.show();
					for (const item of resolved) {
						terminal.sendText(formatCommandLine(item.invocation), true);
					}
					this.status(`已在新终端执行：${tool.label}${scope}`);
					return;
				}
				case 'external': {
					// 系统终端窗口：detached + shell，Windows 上会弹出独立控制台窗口
					for (const item of resolved) {
						const child = spawn(formatCommandLine(item.invocation), {
							cwd: item.cwd,
							detached: true,
							stdio: 'ignore',
							shell: true,
							windowsHide: false,
						});
						child.unref();
					}
					this.status(`已在系统终端执行：${tool.label}${scope}`);
					return;
				}
				default: {
					this.status(`正在执行：${tool.label}${scope}`);
					for (const item of resolved) {
						execFile(
							item.invocation.command,
							[...item.invocation.args],
							{ cwd: item.cwd, windowsHide: true },
							(error, stdout, stderr) => {
								if (error) {
									const detail = (stderr || error.message || '').split('\n')[0].trim();
									this.status(`${tool.label} 失败：${detail}`, 'error');
									void vscode.window.showWarningMessage(`Wispkit：${tool.label} 失败 —— ${detail}`);
									return;
								}
								const firstLine = stdout.split('\n').map(line => line.trim()).filter(Boolean)[0];
								this.status(`${tool.label} 完成${firstLine ? `：${firstLine}` : ''}`);
							},
						);
					}
					return;
				}
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.status(`${tool.label} 执行失败：${detail}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：${tool.label} 执行失败 —— ${detail}`);
		}
	}

	/**
	 * 拖入资源。三类来源走三条路：
	 * 1. `text/uri-list` / `text/plain` 里能解析出真实路径 → 复制 / 移动；
	 * 2. OS 直接拖入的 File（只有内容、没有源路径）→ 询问后复制内容；
	 * 3. 文本 / HTML / 图片等字符串资源 → 选择存储类型 + 填写文件名后另存。
	 */
	private async handleDrop(message: Record<string, unknown>): Promise<void> {
		const targetDir = String(message.targetDir ?? '');
		if (!targetDir || !isInside(this.folderUri.fsPath, targetDir)) {
			this.status('拖放目标不在当前子树范围内。', 'error');
			return;
		}
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetDir));
			if ((stat.type & vscode.FileType.Directory) === 0) {
				this.status('拖放目标不是文件夹。', 'error');
				return;
			}
		} catch (error) {
			this.status(`拖放目标不可用：${error instanceof Error ? error.message : String(error)}`, 'error');
			return;
		}

		const files = readDroppedFiles(message.files);
		const strings = readDroppedStrings(message.strings);
		if (files.length === 0 && strings.length === 0) {
			this.status('拖入的内容为空或无法读取。', 'error');
			return;
		}

		try {
			const sourcePaths = await this.resolveDroppedPaths(strings);
			if (sourcePaths.length > 0) {
				await this.copyOrMoveDroppedPaths(sourcePaths, targetDir, isMoveDropRequested(message));
				return;
			}
			// 浏览器 / 其他应用拖来的图片等常同时带 File 与 HTML/链接：
			// 这属于“其他类型资源”，应该问存储类型和名称，而不是当普通文件复制。
			const resourceHint = strings.some(item => {
				const mime = normalizeMime(item.mime);
				return mime === 'text/html'
					|| (mime === 'text/uri-list' && parseUriList(item.text).some(uri => /^https?:/i.test(uri)));
			});
			if (files.length > 0 && resourceHint) {
				const file = files.find(item => item.bytes && item.bytes.byteLength > 0);
				if (file) {
					await this.saveDroppedResource(file.mime, undefined, file.bytes, file.name, targetDir);
					return;
				}
			}
			if (files.length > 0) {
				await this.importDroppedFiles(files, targetDir);
				return;
			}
			const primary = pickPrimaryString(strings);
			if (!primary) {
				this.status('拖入的内容里没有可保存的资源。', 'error');
				return;
			}
			await this.saveDroppedString(primary, targetDir);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.status(`处理拖入内容失败：${detail}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：处理拖入内容失败 —— ${detail}`);
		}
	}

	/** 从 uri-list / 纯文本路径里找出**真实存在**的源路径。 */
	private async resolveDroppedPaths(strings: readonly DroppedString[]): Promise<string[]> {
		const candidates: string[] = [];
		const uriList = strings
			.filter(item => normalizeMime(item.mime) === 'text/uri-list')
			.map(item => item.text)
			.join('\r\n');
		for (const entry of parseUriList(uriList)) {
			try {
				const uri = vscode.Uri.parse(entry);
				if (uri.scheme === 'file') {
					candidates.push(uri.fsPath);
				}
			} catch {
				// 非法 URI 忽略
			}
		}

		if (candidates.length === 0) {
			const plain = strings
				.filter(item => normalizeMime(item.mime) === 'text/plain')
				.map(item => item.text)
				.join('\r\n');
			candidates.push(...parsePlainPathList(plain));
		}

		const out: string[] = [];
		const seen = new Set<string>();
		for (const candidate of candidates) {
			const key = candidate.toLowerCase();
			if (!candidate || seen.has(key)) {
				continue;
			}
			seen.add(key);
			try {
				await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
				out.push(candidate);
			} catch {
				// 不存在的条目当作普通文本资源，不在这里报错
			}
		}
		return out;
	}

	/**
	 * 变更路径广播给所有打开的面板：左右子树互拖时，drop 由目标面板处理，
	 * 但被移走的条目在**源面板**里 —— 它只缓存自己的层级，必须让它刷新，
	 * 否则源树会留下一条点了就报错的过期行。各面板只处理自己根目录内的路径。
	 */
	private static refreshAcrossPanels(paths: readonly string[], self: SubtreePanel): Promise<void> {
		for (const panel of SubtreePanel.panels.values()) {
			if (panel === self) {
				continue;
			}
			const inside = paths.filter(item => isInside(panel.folderUri.fsPath, item));
			if (inside.length > 0) {
				void panel.refreshLevelsFor(inside);
			}
		}
		return self.refreshLevelsFor(paths);
	}

	/**
	 * 有源路径：询问复制 / 移动，然后按 workspace.fs 执行。
	 *
	 * `moveByModifier` 为 true 表示用户拖拽时按着 Ctrl/Cmd（且拖拽源自 Wispkit 子树）——
	 * 直接按移动执行，不再弹「复制还是移动」。同名冲突仍然要问，避免覆盖丢数据。
	 */
	private async copyOrMoveDroppedPaths(
		sources: readonly string[],
		targetDir: string,
		moveByModifier = false,
	): Promise<void> {
		const scope = sources.length > 1 ? ` ${sources.length} 个条目` : `「${shortName(path.basename(sources[0]), 30)}」`;
		let operation: 'copy' | 'move';
		if (moveByModifier) {
			operation = 'move';
		} else {
			const choice = await vscode.window.showQuickPick(
				[
					{ label: '$(files) 复制', description: '保留源文件，把副本放到目标文件夹', operation: 'copy' as const },
					{ label: '$(move) 移动', description: '把源文件移到目标文件夹（源位置删除）', operation: 'move' as const },
				],
				{ placeHolder: `把${scope}放到 ${shortName(path.basename(targetDir) || targetDir, 30)}：复制还是移动？`, ignoreFocusOut: true },
			);
			if (!choice) {
				this.status('已取消拖入。');
				return;
			}
			operation = choice.operation;
		}

		const existing = new Set((await vscode.workspace.fs.readDirectory(vscode.Uri.file(targetDir))).map(([name]) => name));
		const existingLower = new Set([...existing].map(name => name.toLowerCase()));
		const conflicts = sources.filter(source => existingLower.has(path.basename(source).toLowerCase()));
		let mode: 'overwrite' | 'rename' | 'cancel' = 'rename';
		if (conflicts.length > 0) {
			const conflictChoice = await vscode.window.showQuickPick(
				[
					{ label: '$(warning) 覆盖', description: `目标文件夹里已有同名条目（${conflicts.map(name => path.basename(name)).join('、')}）`, value: 'overwrite' as const },
					{ label: '$(diff-renamed) 自动重命名', description: '用「副本」后缀避开冲突', value: 'rename' as const },
					{ label: '$(close) 取消', value: 'cancel' as const },
				],
				{ placeHolder: `目标文件夹里有 ${conflicts.length} 个同名条目，怎么处理？`, ignoreFocusOut: true },
			);
			if (!conflictChoice || conflictChoice.value === 'cancel') {
				this.status('已取消拖入。');
				return;
			}
			mode = conflictChoice.value;
		}

		const names = mode === 'rename'
			? pasteTargetNames(sources, existing, path.basename)
			: sources.map(source => path.basename(source));
		const failures: string[] = [];
		const touched: string[] = [];

		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			const destination = vscode.Uri.joinPath(vscode.Uri.file(targetDir), names[index]);
			if (path.resolve(source) === path.resolve(destination.fsPath)) {
				// 源和目标同一个条目：复制/移动都没有可做的事（“覆盖自己”也算成功）
				continue;
			}

			try {
				const sourceStat = await vscode.workspace.fs.stat(vscode.Uri.file(source));
				const isDirectory = (sourceStat.type & vscode.FileType.Directory) !== 0;
				if (isDirectory && isInside(source, targetDir)) {
					failures.push(`${path.basename(source)}：不能把文件夹放到它自己里面`);
					continue;
				}

				if (operation === 'copy') {
					await vscode.workspace.fs.copy(vscode.Uri.file(source), destination, { overwrite: mode === 'overwrite' });
				} else {
					await this.movePath(source, destination.fsPath, mode === 'overwrite');
				}
				touched.push(source, destination.fsPath);
			} catch (error) {
				failures.push(`${path.basename(source)}：${error instanceof Error ? error.message : String(error)}`);
			}
		}

		// 先刷新再报结果：前端收到 level 消息会清空状态栏，反过来会把“已移动”吃掉
		await SubtreePanel.refreshAcrossPanels([...touched, targetDir], this);
		if (failures.length > 0) {
			this.status(`拖入失败：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：拖入失败 —— ${failures[0]}`);
		} else {
			this.status(`已${operation === 'copy' ? '复制' : '移动'} ${sources.length} 个条目到 ${path.basename(targetDir) || targetDir}`);
		}
	}

	/** 移动：优先 rename（同盘原子）；跨盘时退回「复制 + 删除」。 */
	private async movePath(source: string, destination: string, overwrite: boolean): Promise<void> {
		try {
			await vscode.workspace.fs.rename(vscode.Uri.file(source), vscode.Uri.file(destination), { overwrite });
			return;
		} catch {
			// 跨卷 / 目标被占用时 rename 会失败，走复制再删
		}
		await vscode.workspace.fs.copy(vscode.Uri.file(source), vscode.Uri.file(destination), { overwrite });
		await vscode.workspace.fs.delete(vscode.Uri.file(source), { recursive: true, useTrash: true });
	}

	/** OS 直接拖入的 File：内容在手上，但系统不提供源路径，只能复制。 */
	private async importDroppedFiles(files: readonly DroppedFile[], targetDir: string): Promise<void> {
		const usable = files.filter(file => file.bytes && file.bytes.byteLength > 0);
		const broken = files.find(file => file.error || !file.bytes);
		if (usable.length === 0) {
			this.status(broken?.error || '拖入的文件没有可读取的内容。', 'error');
			return;
		}

		const choice = await vscode.window.showQuickPick(
			[
				{ label: '$(files) 复制', description: '把文件内容写入目标文件夹', operation: 'copy' as const },
				{ label: '$(move) 移动', description: '系统拖拽没有提供源路径，无法移动；请先在资源管理器里移动', operation: 'move' as const },
			],
			{ placeHolder: `把 ${usable.length} 个文件放到 ${shortName(path.basename(targetDir) || targetDir, 30)}：复制还是移动？`, ignoreFocusOut: true },
		);
		if (!choice) {
			this.status('已取消拖入。');
			return;
		}
		if (choice.operation === 'move') {
			this.status('系统拖拽的文件没有源路径，无法移动；请改用复制。', 'error');
			void vscode.window.showInformationMessage('Wispkit：从系统拖入的文件不带源路径（VS Code webview 限制），只能复制；如需移动请在资源管理器里操作。');
			return;
		}

		const existing = new Set((await vscode.workspace.fs.readDirectory(vscode.Uri.file(targetDir))).map(([name]) => name));
		const desiredNames = usable.map((file, index) => {
			const name = path.basename(String(file.name ?? '').replace(/[\\/]+/g, '/'));
			return name && !validateEntryName(name) ? name : `拖入文件-${index + 1}`;
		});
		const existingLower = new Set([...existing].map(name => name.toLowerCase()));
		const conflicts = desiredNames.filter(name => existingLower.has(name.toLowerCase()));
		let mode: 'overwrite' | 'rename' | 'cancel' = 'rename';
		if (conflicts.length > 0) {
			const conflictChoice = await vscode.window.showQuickPick(
				[
					{ label: '$(warning) 覆盖', description: `已有同名文件：${conflicts.join('、')}`, value: 'overwrite' as const },
					{ label: '$(diff-renamed) 自动重命名', description: '用「副本」后缀避开冲突', value: 'rename' as const },
					{ label: '$(close) 取消', value: 'cancel' as const },
				],
				{ placeHolder: `目标文件夹里有 ${conflicts.length} 个同名文件，怎么处理？`, ignoreFocusOut: true },
			);
			if (!conflictChoice || conflictChoice.value === 'cancel') {
				this.status('已取消拖入。');
				return;
			}
			mode = conflictChoice.value;
		}

		const names = mode === 'rename'
			? pasteTargetNames(desiredNames, existing, name => name)
			: desiredNames;
		const failures: string[] = [];
		const touched: string[] = [];
		for (let index = 0; index < usable.length; index += 1) {
			const file = usable[index];
			const destination = vscode.Uri.joinPath(vscode.Uri.file(targetDir), names[index]);
			try {
				await vscode.workspace.fs.writeFile(destination, file.bytes!);
				touched.push(destination.fsPath);
			} catch (error) {
				failures.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (failures.length > 0) {
			this.status(`拖入失败：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：拖入失败 —— ${failures[0]}`);
		} else {
			this.status(`已复制 ${usable.length} 个文件到 ${path.basename(targetDir) || targetDir}`);
		}
		await this.refreshLevelsFor([...touched, targetDir]);
	}

	/** 字符串资源：选类型 → 填名称 → 处理同名 → 落盘。 */
	private async saveDroppedString(primary: DroppedString, targetDir: string): Promise<void> {
		let mime = normalizeMime(primary.mime);
		let text: string | undefined = primary.text;
		let bytes: Uint8Array | undefined;

		if (/^data:/i.test(text.trim())) {
			const decoded = decodeDataUrl(text);
			if (decoded) {
				mime = decoded.mime;
				bytes = decoded.bytes;
				text = undefined;
			}
		}
		await this.saveDroppedResource(mime, text, bytes, undefined, targetDir);
	}

	/** 「其他类型资源」的另存流程：选类型 → 填名称 → 冲突处理 → 落盘。 */
	private async saveDroppedResource(
		mime: string,
		text: string | undefined,
		bytes: Uint8Array | undefined,
		fileName: string | undefined,
		targetDir: string,
	): Promise<void> {
		const types = storageTypesFor(mime, fileName);
		let type: StorageType | undefined;
		if (types.length === 1) {
			type = types[0];
		} else {
			const picked = await vscode.window.showQuickPick(
				types.map(item => ({ label: item.label, description: item.description, type: item })),
				{ placeHolder: `拖入的是 ${mime} 内容，存为哪种类型？`, ignoreFocusOut: true },
			);
			type = picked?.type;
		}
		if (!type) {
			this.status('已取消另存。');
			return;
		}

		const suggestion = bytes
			? (fileName ? `${stemOfFileName(fileName)}${type.extension}` : '')
			: suggestedFileName(mime, text ?? '', type.extension);
		const input = await vscode.window.showInputBox({
			prompt: `将拖入的 ${mime} 内容存为 ${type.extension} 文件（${type.label}）`,
			value: suggestion,
			placeHolder: suggestion ? undefined : '未能从内容中提取名称，请自行填写文件名',
			validateInput: value => validateEntryName(value),
		});
		if (input === undefined) {
			this.status('已取消另存。');
			return;
		}

		let name = input.trim();
		if (!path.extname(name)) {
			name += type.extension;
		}
		const problem = validateEntryName(name);
		if (problem) {
			this.status(problem, 'error');
			return;
		}

		const existing = new Set((await vscode.workspace.fs.readDirectory(vscode.Uri.file(targetDir))).map(([entry]) => entry));
		const existingLower = new Set([...existing].map(entry => entry.toLowerCase()));
		if (existingLower.has(name.toLowerCase())) {
			const overwrite = await vscode.window.showQuickPick(
				[
					{ label: '$(warning) 覆盖', description: `已有 ${name}`, value: 'overwrite' as const },
					{ label: '$(diff-renamed) 自动重命名', description: '用「副本」后缀避开冲突', value: 'rename' as const },
					{ label: '$(close) 取消', value: 'cancel' as const },
				],
				{ placeHolder: `${name} 已存在，怎么处理？`, ignoreFocusOut: true },
			);
			if (!overwrite || overwrite.value === 'cancel') {
				this.status('已取消另存。');
				return;
			}
			if (overwrite.value === 'rename') {
				name = uniqueName(existing, name);
			}
		}

		const content = renderContentForType(type, { mime, text, bytes });
		const destination = vscode.Uri.joinPath(vscode.Uri.file(targetDir), name);
		if (content.bytes) {
			await vscode.workspace.fs.writeFile(destination, content.bytes);
		} else {
			await vscode.workspace.fs.writeFile(destination, Buffer.from(content.text ?? '', 'utf8'));
		}
		this.status(`已保存 ${name} 到 ${path.basename(targetDir) || targetDir}`);
		await this.refreshLevelsFor([destination.fsPath, targetDir]);
	}

	private async openEntry(targetPath: string): Promise<void> {
		try {
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetPath));
		} catch (error) {
			this.status(`打开失败：${error instanceof Error ? error.message : String(error)}`, 'error');
		}
	}

	private dispose(): void {
		SubtreePanel.panels.delete(this.folderUri.fsPath.toLowerCase());
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}

/** 消息里的字符串条目：只收 kind='string'、有 mime 与文本的对象。 */
function readDroppedStrings(value: unknown): DroppedString[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: DroppedString[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const item = raw as Record<string, unknown>;
		if (item.kind !== 'string' || typeof item.mime !== 'string' || typeof item.text !== 'string') {
			continue;
		}
		out.push({ kind: 'string', mime: item.mime, text: item.text });
	}
	return out;
}

/** 消息里的文件条目：字节可能是 ArrayBuffer / Uint8Array / Buffer（跨进程序列化会变）。 */
function readDroppedFiles(value: unknown): DroppedFile[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: DroppedFile[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const item = raw as Record<string, unknown>;
		const name = typeof item.name === 'string' ? path.basename(item.name.replace(/[\\/]+/g, '/')) : '';
		if (!name) {
			continue;
		}
		out.push({
			kind: 'file',
			name,
			mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
			size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0,
			lastModified: typeof item.lastModified === 'number' ? item.lastModified : 0,
			bytes: toBytes(item.data),
			error: typeof item.error === 'string' ? item.error : undefined,
			sourcePath: typeof item.sourcePath === 'string' ? item.sourcePath : undefined,
		});
	}
	return out;
}

function toBytes(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	return undefined;
}

async function entryFor(targetPath: string): Promise<TreeEntry | undefined> {
	try {
		const uri = vscode.Uri.file(targetPath);
		const stat = await vscode.workspace.fs.stat(uri);
		return {
			name: path.basename(targetPath),
			path: targetPath,
			isDirectory: (stat.type & vscode.FileType.Directory) !== 0,
			size: stat.size,
			mtime: stat.mtime,
			ctime: stat.ctime,
			// VS Code 的 FileStat 不暴露 atime / POSIX 权限位，这两列恒为 `-`
			atime: 0,
			mode: 0,
		};
	} catch {
		return undefined;
	}
}

/** 读一层目录并排好序。排序在宿主做 —— 它有原始 size/mtime，前端只有格式化后的文本。 */
export async function readDirectoryEntries(
	folderUri: vscode.Uri,
	columns: readonly ColumnId[],
	owner: string,
	sort: SortState = DEFAULT_SORT,
): Promise<ReadResult> {
	let children: [string, vscode.FileType][];
	try {
		children = await vscode.workspace.fs.readDirectory(folderUri);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { rows: [], entries: [], error: `无法读取：${detail}` };
	}

	const limited = children.length > MAX_ENTRIES;
	const entries: TreeEntry[] = [];

	for (const [name, type] of children.slice(0, MAX_ENTRIES)) {
		const childUri = vscode.Uri.joinPath(folderUri, name);
		let stat: vscode.FileStat | undefined;
		try {
			stat = await vscode.workspace.fs.stat(childUri);
		} catch {
			// 断链的符号链接之类：拿不到 stat 也要把这一行显示出来
			stat = undefined;
		}

		entries.push({
			name,
			path: childUri.fsPath,
			isDirectory: (type & vscode.FileType.Directory) !== 0,
			size: stat?.size ?? 0,
			mtime: stat?.mtime ?? 0,
			ctime: stat?.ctime ?? 0,
			// VS Code 的 FileStat 不暴露 atime，这一列恒为 `-`（配置里仍可保留该列）
			atime: 0,
			mode: 0,
		});
	}

	return {
		rows: buildRows(entries, columns, owner, sort),
		entries,
		error: limited ? `条目过多，只显示了前 ${MAX_ENTRIES} 项。` : undefined,
	};
}
