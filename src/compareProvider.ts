import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	computeDefaultRoots,
	resolveCompareInput,
	type CompareRoot,
} from './compare/defaults';
import {
	buildLocationGroups,
	type CompareLocationGroup,
} from './compare/locations';
import {
	renderComparePage,
	type ComparePaneView,
	type CompareViewConfig,
} from './compare/page';
import {
	deleteConfirmation,
	pasteTargetNames,
	uniqueName,
	validateEntryName,
	type ClipboardState,
} from './subtree/fileActions';
import {
	normalizeMime,
	parsePlainPathList,
	parseUriList,
	type DroppedFile,
	type DroppedString,
} from './subtree/drop';
import type { ExplorerCommand } from './subtree/explorerCommands';
import type { SubtreeCommandView } from './subtree/page';
import {
	isMoveDropRequested,
	isSameOrInside,
	readDropPaths,
	refreshDirectories,
} from './compare/transfer';
import type { ResourceTreeStore } from './resourceTree/model';
import { workspaceFolderLikes } from './resourceTree/storage';
import type { WorkspaceFolderLike } from './resourceTree/paths';
import { columnDefinition, type ColumnId } from './subtree/columns';
import {
	availableExplorerCommands,
	copyPathsToSystemClipboard,
	findExplorerDropTarget,
	readDirectoryEntries,
	readDroppedFiles,
	readDroppedStrings,
} from './subtreeProvider';
import { strictContentSecurityPolicy } from './util/csp';
import { generateNonce } from './util/nonce';

export const COMPARE_VIEW_TYPE = 'wispkit.compare';

/** 资源树只读视图：对比浏览需要它的文件夹列表做下拉候选。 */
export interface ResourceTreeLocationSource {
	getStore(): ResourceTreeStore;
	folderLikes(): WorkspaceFolderLike[];
}

type PaneId = 'left' | 'right';

const COLUMN_IDS: readonly ColumnId[] = ['name', 'size', 'mtime'];

const COLUMNS = [
	{ ...columnDefinition('name'), width: 260 },
	{ ...columnDefinition('size'), width: 90 },
	{ ...columnDefinition('mtime'), width: 150 },
] as const;

function isPaneId(value: unknown): value is PaneId {
	return value === 'left' || value === 'right';
}

function safeHome(): string {
	try {
		return os.homedir();
	} catch {
		return process.env.USERPROFILE ?? process.env.HOME ?? '';
	}
}

function isDirectorySync(fsPath: string): boolean {
	try {
		return fs.statSync(fsPath).isDirectory();
	} catch {
		return false;
	}
}

/** `path.relative` 在 Windows 上大小写不敏感，这里再兜一层绝对路径判断。 */
function isInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 状态栏里显示文件夹名；根目录（`C:\`）没有 basename 时退回完整路径。 */
function displayDirectoryName(targetDir: string): string {
	const name = path.basename(targetDir) || targetDir;
	return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}

/** 同一个文件系统条目：Windows 上大小写不敏感。 */
function samePath(left: string, right: string): boolean {
	const normalize = (value: string): string => {
		const resolved = path.resolve(value);
		return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
	};
	return normalize(left) === normalize(right);
}

/**
 * 「对比浏览」面板。
 *
 * 单实例：再次触发命令只 reveal 并刷新下拉候选，不叠新标签页。左右两侧的根目录
 * 完全独立，读盘统一走 `workspace.fs`（远程 / 虚拟工作区也能浏览）。
 */
export class ComparePanel implements vscode.Disposable {
	public static readonly viewType = COMPARE_VIEW_TYPE;

	private static current: ComparePanel | undefined;

	public static async open(
		context: vscode.ExtensionContext,
		source?: ResourceTreeLocationSource,
	): Promise<ComparePanel> {
		if (ComparePanel.current && !ComparePanel.current.disposed) {
			ComparePanel.current.source = source ?? ComparePanel.current.source;
			ComparePanel.current.panel.reveal(vscode.ViewColumn.Active);
			ComparePanel.current.pushLocations();
			return ComparePanel.current;
		}

		const home = safeHome();
		const defaults = computeDefaultRoots({
			platform: process.platform,
			env: process.env,
			home,
			isDirectory: isDirectorySync,
		});
		// 右键菜单与子树浏览共用同一份「资源管理器里能用的命令」清单
		const commands = await availableExplorerCommands();
		const panel = vscode.window.createWebviewPanel(
			COMPARE_VIEW_TYPE,
			'对比浏览',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				enableForms: false,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri],
			},
		);
		const instance = new ComparePanel(context, panel, defaults, home, commands, source);
		ComparePanel.current = instance;
		return instance;
	}

	private readonly disposables: vscode.Disposable[] = [];
	private readonly paneRoots: Record<PaneId, string>;
	private readonly defaults: { left: CompareRoot; right: CompareRoot };
	private readonly home: string;
	private readonly commands: readonly ExplorerCommand[];
	/** 右键菜单「剪切 / 复制 / 粘贴」的剪贴板（只活在面板实例里）。 */
	private clipboard: ClipboardState | undefined;
	private source: ResourceTreeLocationSource | undefined;
	private disposed = false;

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly panel: vscode.WebviewPanel,
		defaults: { left: CompareRoot; right: CompareRoot },
		home: string,
		commands: readonly ExplorerCommand[],
		source?: ResourceTreeLocationSource,
	) {
		this.defaults = defaults;
		this.home = home;
		this.commands = commands;
		this.source = source;
		this.paneRoots = { left: defaults.left.path, right: defaults.right.path };

		this.panel.webview.html = this.buildHtml();
		this.disposables.push(
			this.panel.webview.onDidReceiveMessage(message => void this.handleMessage(message)),
			this.panel.onDidDispose(() => this.dispose()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.pushLocations()),
		);
	}

	private buildHtml(): string {
		const webview = this.panel.webview;
		const nonce = generateNonce();
		const toUri = (...parts: string[]): string =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts)).toString();

		return renderComparePage({
			title: '对比浏览',
			csp: strictContentSecurityPolicy(webview.cspSource, nonce),
			nonce,
			runtimeScript: toUri('media', 'compare.js'),
			runtimeStyle: toUri('media', 'compare.css'),
			baseStyle: toUri('media', 'subtree.css'),
			config: this.viewConfig(),
		});
	}

	private viewConfig(): CompareViewConfig {
		const panes: ComparePaneView[] = [
			{
				id: 'left',
				root: this.paneRoots.left,
				title: '左侧',
				note: this.defaults.left.note,
			},
			{
				id: 'right',
				root: this.paneRoots.right,
				title: '右侧',
				note: this.defaults.right.note,
			},
		];
		const commands: SubtreeCommandView[] = this.commands.map(command => ({
			id: command.id,
			label: command.label,
			kind: command.kind,
			source: command.source,
			group: command.group,
			icon: command.icon,
			appliesTo: command.appliesTo,
			disabledReason: command.disabledReason,
		}));
		return {
			panes,
			columns: COLUMNS,
			locationGroups: this.buildLocations(),
			commands,
		};
	}

	private buildLocations(): CompareLocationGroup[] {
		const workspaceFolders = workspaceFolderLikes();
		let store: ResourceTreeStore | undefined;
		let folderLikes = workspaceFolders;
		try {
			store = this.source?.getStore();
			folderLikes = this.source?.folderLikes() ?? workspaceFolders;
		} catch {
			// 资源树还没就绪时不影响下拉里的常用位置 / 工作区条目。
			store = undefined;
		}
		return buildLocationGroups({
			left: this.defaults.left,
			right: this.defaults.right,
			home: this.home,
			workspaceFolders,
			store,
			folderLikes,
			tempDirectory: os.tmpdir(),
		});
	}

	private pushLocations(): void {
		void this.panel.webview.postMessage({
			type: 'wispkit.compare.locations',
			groups: this.buildLocations(),
		});
	}

	private async handleMessage(message: Record<string, unknown>): Promise<void> {
		if (!message || typeof message !== 'object' || this.disposed) {
			return;
		}
		try {
			switch (message.type) {
				case 'wispkit.compare.read':
					await this.handleRead(
						String(message.pane ?? ''),
						String(message.path ?? ''),
						String(message.requestId ?? ''),
					);
					return;
				case 'wispkit.compare.navigate':
					await this.handleNavigate(String(message.pane ?? ''), String(message.input ?? ''));
					return;
				case 'wispkit.compare.up':
					await this.handleUp(String(message.pane ?? ''));
					return;
				case 'wispkit.compare.refresh':
					await this.handleRefresh(String(message.pane ?? ''));
					return;
				case 'wispkit.compare.open':
					await this.handleOpen(
						String(message.pane ?? 'left'),
						String(message.path ?? ''),
					);
					return;
				case 'wispkit.compare.drop':
					await this.handleDrop(String(message.pane ?? ''), message);
					return;
				case 'wispkit.compare.dragOut':
					await this.handleDragOut(String(message.pane ?? ''), message);
					return;
				case 'wispkit.compare.command':
					await this.runExplorerCommand(
						String(message.pane ?? ''),
						String(message.command ?? ''),
						readDropPaths(message.paths),
					);
					return;
				case 'wispkit.compare.fileAction':
					await this.runFileAction(
						String(message.pane ?? ''),
						String(message.action ?? ''),
						readDropPaths(message.paths),
					);
					return;
				case 'wispkit.compare.locations':
					this.pushLocations();
					return;
				default:
					return;
			}
		} catch (error) {
			console.error('[wispkit-compare] message failed:', error);
			const pane = isPaneId(message.pane) ? message.pane : 'left';
			this.status(pane, `操作失败：${error instanceof Error ? error.message : String(error)}`, 'error');
		}
	}

	private status(pane: PaneId, message: string, kind?: 'error'): void {
		void this.panel.webview.postMessage({
			type: 'wispkit.compare.status',
			pane,
			message,
			kind,
		});
	}

	private async postLevel(pane: PaneId, requestedPath: string, requestId: string): Promise<void> {
		const result = await readDirectoryEntries(vscode.Uri.file(requestedPath), COLUMN_IDS, this.owner());
		await this.panel.webview.postMessage({
			type: 'wispkit.compare.level',
			pane,
			requestId,
			path: requestedPath,
			rows: result.rows,
			error: result.error,
		});
	}

	private owner(): string {
		try {
			return os.userInfo().username;
		} catch {
			return '';
		}
	}

	private async handleRead(paneId: string, requestedPath: string, requestId: string): Promise<void> {
		if (!isPaneId(paneId)) {
			return;
		}
		const root = this.paneRoots[paneId];
		if (!requestedPath || !root || !isInside(root, requestedPath)) {
			await this.panel.webview.postMessage({
				type: 'wispkit.compare.level',
				pane: paneId,
				requestId,
				path: requestedPath,
				rows: [],
				error: requestedPath
					? '这个路径不在当前浏览范围内。'
					: '没有可浏览的路径。',
			});
			return;
		}
		await this.postLevel(paneId, requestedPath, requestId);
	}

	private async handleNavigate(paneId: string, rawInput: string): Promise<void> {
		if (!isPaneId(paneId)) {
			return;
		}
		const resolved = resolveCompareInput({
			input: rawInput,
			base: this.paneRoots[paneId],
			home: this.home,
			env: process.env,
			platform: process.platform,
		});
		if ('error' in resolved) {
			this.status(paneId, resolved.error, 'error');
			return;
		}

		let stat: vscode.FileStat;
		try {
			stat = await vscode.workspace.fs.stat(vscode.Uri.file(resolved.path));
		} catch (error) {
			this.status(paneId, `无法访问「${resolved.path}」：${error instanceof Error ? error.message : String(error)}`, 'error');
			return;
		}

		if ((stat.type & vscode.FileType.Directory) !== 0) {
			await this.setPaneRoot(paneId, resolved.path);
			return;
		}
		if ((stat.type & vscode.FileType.File) !== 0) {
			try {
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolved.path));
				this.status(paneId, `已在编辑器中打开文件：${resolved.path}`);
			} catch (error) {
				this.status(paneId, `打开文件失败：${error instanceof Error ? error.message : String(error)}`, 'error');
			}
			return;
		}
		this.status(paneId, `目标既不是文件夹也不是文件（可能是断开的链接）：${resolved.path}`, 'error');
	}

	private async setPaneRoot(paneId: PaneId, fsPath: string): Promise<void> {
		this.paneRoots[paneId] = fsPath;
		await this.panel.webview.postMessage({
			type: 'wispkit.compare.root',
			pane: paneId,
			root: fsPath,
			title: path.basename(fsPath) || fsPath,
		});
		await this.postLevel(paneId, fsPath, '');
	}

	private async handleUp(paneId: string): Promise<void> {
		if (!isPaneId(paneId)) {
			return;
		}
		const root = this.paneRoots[paneId];
		const parent = root ? path.dirname(root) : '';
		if (!parent || parent === root) {
			this.status(paneId, '已经在顶层文件夹。');
			return;
		}
		await this.setPaneRoot(paneId, parent);
	}

	private async handleRefresh(paneId: string): Promise<void> {
		if (!isPaneId(paneId)) {
			return;
		}
		const root = this.paneRoots[paneId];
		if (!root) {
			this.status(paneId, '没有可刷新的文件夹。', 'error');
			return;
		}
		await this.postLevel(paneId, root, '');
	}

	private async handleOpen(paneId: string, targetPath: string): Promise<void> {
		if (!targetPath) {
			return;
		}
		const pane: PaneId = isPaneId(paneId) ? paneId : 'left';
		try {
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetPath));
		} catch (error) {
			this.status(pane, `打开失败：${error instanceof Error ? error.message : String(error)}`, 'error');
		}
	}

	/** 右键菜单命令：与子树浏览一样，执行前再校验一次 id 是否存在。 */
	private async runExplorerCommand(paneId: string, command: string, targets: readonly string[]): Promise<void> {
		const pane: PaneId = isPaneId(paneId) ? paneId : 'left';
		if (!command || targets.length === 0) {
			return;
		}
		const available = new Set(await vscode.commands.getCommands(true));
		if (!available.has(command)) {
			this.status(pane, `命令 ${command} 不可用`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：命令 ${command} 不可用（可能来自未安装的扩展，或已被重命名）。`);
			return;
		}
		const failures: string[] = [];
		for (const target of targets) {
			try {
				await vscode.commands.executeCommand(command, vscode.Uri.file(target));
			} catch (error) {
				failures.push(errorText(error));
			}
		}
		const scope = targets.length > 1 ? `（${targets.length} 项）` : '';
		if (failures.length > 0) {
			this.status(pane, `执行 ${command} 失败${scope}：${failures[0]}`, 'error');
			return;
		}
		this.status(pane, `已执行 ${command}${scope}`);
	}

	/** 右键菜单里的自研文件操作（剪切 / 复制 / 粘贴 / 重命名 / 删除 / 新建 / 比较）。 */
	private async runFileAction(paneId: string, action: string, targets: readonly string[]): Promise<void> {
		const pane: PaneId = isPaneId(paneId) ? paneId : 'left';
		try {
			switch (action) {
				case 'wispkit.subtree.cut':
				case 'wispkit.subtree.copy': {
					const op = action === 'wispkit.subtree.cut' ? 'cut' : 'copy';
					this.clipboard = { op, paths: [...targets] };
					this.status(pane, `已${op === 'cut' ? '剪切' : '复制'} ${targets.length} 项`);
					return;
				}
				case 'wispkit.subtree.paste':
					await this.pasteInto(pane, targets);
					return;
				case 'wispkit.subtree.rename':
					await this.renameEntry(pane, targets[0]);
					return;
				case 'wispkit.subtree.delete':
					await this.deleteEntries(pane, targets);
					return;
				case 'wispkit.subtree.newFile':
					await this.createEntry(pane, targets, false);
					return;
				case 'wispkit.subtree.newFolder':
					await this.createEntry(pane, targets, true);
					return;
				case 'wispkit.subtree.compare':
					await this.compareEntries(pane, targets);
					return;
				default:
					this.status(pane, `未知操作：${action}`, 'error');
					return;
			}
		} catch (error) {
			const detail = errorText(error);
			this.status(pane, `操作失败：${detail}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：操作失败 —— ${detail}`);
		}
	}

	/** 右键目标的**操作目录**：文件夹用自己，文件用父目录，空白处用该侧根目录。 */
	private async directoryFor(pane: PaneId, targets: readonly string[]): Promise<string> {
		if (targets.length === 0) {
			return this.paneRoots[pane];
		}
		const first = targets[0];
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(first));
			if ((stat.type & vscode.FileType.Directory) !== 0) {
				return first;
			}
		} catch {
			// 已经消失的条目：退回父目录，让后续操作给出更直接的错误
		}
		return path.dirname(first);
	}

	private async pasteInto(pane: PaneId, targets: readonly string[]): Promise<void> {
		const state = this.clipboard;
		if (!state) {
			this.status(pane, '剪贴板是空的：先「复制」或「剪切」几个条目。', 'error');
			return;
		}
		const directory = await this.directoryFor(pane, targets);
		if (!isInside(this.paneRoots[pane], directory)) {
			this.status(pane, '粘贴目标不在这一侧的浏览范围内。', 'error');
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
		}
		this.status(pane, `已${moved ? '移动' : '粘贴'} ${state.paths.length} 项到 ${displayDirectoryName(directory)}`);
		await this.refreshDirs([directory, ...state.paths.map(source => path.dirname(source))]);
	}

	private async renameEntry(pane: PaneId, target: string | undefined): Promise<void> {
		if (!target) {
			this.status(pane, '请先选中一个条目。', 'error');
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
			this.status(pane, problem, 'error');
			return;
		}
		const destination = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(target)), name);
		await vscode.workspace.fs.rename(vscode.Uri.file(target), destination, { overwrite: false });
		this.status(pane, `已重命名为 ${name}`);
		await this.refreshDirs([path.dirname(target)], [target]);
	}

	private async deleteEntries(pane: PaneId, targets: readonly string[]): Promise<void> {
		if (targets.length === 0) {
			this.status(pane, '请先选中要删除的条目。', 'error');
			return;
		}
		const confirmed = await vscode.window.showWarningMessage(
			deleteConfirmation(targets.length, path.basename(targets[0])),
			{ modal: true },
			'删除',
		);
		if (confirmed !== '删除') {
			this.status(pane, '已取消删除');
			return;
		}
		const failures: string[] = [];
		for (const target of targets) {
			try {
				await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true });
			} catch (error) {
				failures.push(`${path.basename(target)}：${errorText(error)}`);
			}
		}
		const scope = targets.length > 1 ? `（${targets.length} 项）` : '';
		if (failures.length > 0) {
			this.status(pane, `删除失败${scope}：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：删除失败 —— ${failures[0]}`);
		} else {
			this.status(pane, `已删除${scope}`);
		}
		await this.refreshDirs(targets.map(target => path.dirname(target)), targets);
	}

	private async createEntry(pane: PaneId, targets: readonly string[], asFolder: boolean): Promise<void> {
		const directory = await this.directoryFor(pane, targets);
		if (!isInside(this.paneRoots[pane], directory)) {
			this.status(pane, '目标目录不在这一侧的浏览范围内。', 'error');
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
			this.status(pane, problem, 'error');
			return;
		}
		const target = vscode.Uri.joinPath(vscode.Uri.file(directory), name);
		if (asFolder) {
			await vscode.workspace.fs.createDirectory(target);
		} else {
			await vscode.workspace.fs.writeFile(target, new Uint8Array());
		}
		this.status(pane, `已新建 ${name}`);
		await this.refreshDirs([directory]);
	}

	private async compareEntries(pane: PaneId, targets: readonly string[]): Promise<void> {
		if (targets.length !== 2) {
			this.status(pane, '比较需要恰好选中两个文件。', 'error');
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

	/** 通知前端刷新已经读过的目录（前端只重读缓存里存在的层级）。 */
	private async refreshDirs(dirs: readonly string[], removed: readonly string[] = []): Promise<void> {
		const unique = Array.from(new Set(dirs.filter(Boolean)));
		await this.panel.webview.postMessage({
			type: 'wispkit.compare.refreshDirs',
			dirs: unique,
			removed: [...removed],
		});
	}

	/**
	 * 拖出到系统资源管理器：光标在资源管理器上 → 复制 / 移动到它的当前目录；
	 * 否则把文件列表放进 Windows 剪贴板（CF_HDROP），可在资源管理器 Ctrl+V。
	 */
	private async handleDragOut(paneId: string, message: Record<string, unknown>): Promise<void> {
		const pane: PaneId = isPaneId(paneId) ? paneId : 'left';
		const paths = readDropPaths(message.paths);
		if (paths.length === 0) {
			return;
		}
		const moveRequested = message.moveRequested === true;
		if (process.platform !== 'win32' || vscode.env.remoteName) {
			await vscode.env.clipboard.writeText(paths.join('\r\n'));
			this.status(pane, '已把条目路径复制到剪贴板（拖出到系统只支持本机 Windows）。');
			return;
		}
		const folder = await findExplorerDropTarget(this.context.asAbsolutePath(path.join('resources', 'drop-target.ps1')));
		if (folder) {
			await this.copyOrMoveDroppedPaths(paths, folder, moveRequested, false, pane);
			return;
		}
		const copied = await copyPathsToSystemClipboard(paths);
		if (copied) {
			this.status(pane, `已把 ${paths.length} 个条目放入剪贴板，在资源管理器里 Ctrl+V 即可粘贴。`);
			void vscode.window.showInformationMessage('Wispkit：已把文件放入剪贴板，可在资源管理器里按 Ctrl+V 粘贴。');
			return;
		}
		this.status(pane, '没有找到可放置的资源管理器窗口。', 'error');
	}

	/**
	 * 有源路径的复制 / 移动（拖出到资源管理器、从 VS Code 资源管理器拖入都走这里）。
	 *
	 * `ask=false` 用于拖出：默认复制，按住 Ctrl/Shift 才是移动；`ask=true` 时
	 * 弹一次复制/移动选择。同名冲突始终询问（避免静默覆盖）。
	 */
	private async copyOrMoveDroppedPaths(
		sources: readonly string[],
		targetDir: string,
		moveByModifier: boolean,
		ask: boolean,
		pane: PaneId = 'left',
	): Promise<void> {
		let operation: 'copy' | 'move';
		if (!ask) {
			operation = moveByModifier ? 'move' : 'copy';
		} else {
			const choice = await vscode.window.showQuickPick(
				[
					{ label: '$(files) 复制', description: '保留源文件，把副本放到目标文件夹', operation: 'copy' as const },
					{ label: '$(move) 移动', description: '把源文件移到目标文件夹（源位置删除）', operation: 'move' as const },
				],
				{
					placeHolder: `把 ${sources.length} 个条目放到 ${displayDirectoryName(targetDir)}：复制还是移动？`,
					ignoreFocusOut: true,
				},
			);
			if (!choice) {
				this.status(pane, '已取消拖入。');
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
				this.status(pane, '已取消拖入。');
				return;
			}
			mode = conflictChoice.value;
		}

		const names = mode === 'rename'
			? pasteTargetNames(sources, existing, path.basename)
			: sources.map(source => path.basename(source));
		const failures: string[] = [];
		const touchedDirectories = new Set<string>([targetDir]);

		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			const destination = vscode.Uri.joinPath(vscode.Uri.file(targetDir), names[index]);
			if (samePath(source, destination.fsPath)) {
				continue;
			}
			try {
				const stat = await vscode.workspace.fs.stat(vscode.Uri.file(source));
				const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
				if (isDirectory && isInside(source, targetDir)) {
					failures.push(`${path.basename(source)}：不能把文件夹放到它自己里面`);
					continue;
				}
				if (operation === 'copy') {
					await vscode.workspace.fs.copy(vscode.Uri.file(source), destination, { overwrite: mode === 'overwrite' });
				} else {
					await this.movePath(source, destination.fsPath, mode === 'overwrite');
					touchedDirectories.add(path.dirname(source));
				}
			} catch (error) {
				failures.push(`${path.basename(source)}：${errorText(error)}`);
			}
		}

		await this.refreshDirs([...touchedDirectories]);
		if (failures.length > 0) {
			this.status(pane, `拖入失败：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：拖入失败 —— ${failures[0]}`);
		} else {
			this.status(pane, `已${operation === 'copy' ? '复制' : '移动'} ${sources.length} 个条目到 ${displayDirectoryName(targetDir)}`);
		}
	}

	/** 系统文件拖入（浏览器只给 File 内容，没有源路径）：按字节写入目标目录。 */
	private async importDroppedFiles(
		pane: PaneId,
		files: readonly DroppedFile[],
		targetDir: string,
	): Promise<void> {
		const usable = files.filter(file => file.bytes && file.bytes.byteLength > 0);
		const broken = files.find(file => file.error || !file.bytes);
		if (usable.length === 0) {
			this.status(pane, broken?.error || '拖入的文件没有可读取的内容。', 'error');
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
			const choice = await vscode.window.showQuickPick(
				[
					{ label: '$(warning) 覆盖', description: `已有同名文件：${conflicts.join('、')}`, value: 'overwrite' as const },
					{ label: '$(diff-renamed) 自动重命名', description: '用「副本」后缀避开冲突', value: 'rename' as const },
					{ label: '$(close) 取消', value: 'cancel' as const },
				],
				{ placeHolder: `目标文件夹里有 ${conflicts.length} 个同名文件，怎么处理？`, ignoreFocusOut: true },
			);
			if (!choice || choice.value === 'cancel') {
				this.status(pane, '已取消拖入。');
				return;
			}
			mode = choice.value;
		}
		const names = mode === 'rename'
			? pasteTargetNames(desiredNames, existing, name => name)
			: desiredNames;
		const failures: string[] = [];
		for (let index = 0; index < usable.length; index += 1) {
			const destination = vscode.Uri.joinPath(vscode.Uri.file(targetDir), names[index]);
			try {
				await vscode.workspace.fs.writeFile(destination, usable[index].bytes!);
			} catch (error) {
				failures.push(`${usable[index].name}：${errorText(error)}`);
			}
		}
		await this.refreshDirs([targetDir]);
		if (failures.length > 0) {
			this.status(pane, `拖入失败：${failures[0]}`, 'error');
			void vscode.window.showWarningMessage(`Wispkit：拖入失败 —— ${failures[0]}`);
		} else {
			this.status(pane, `已复制 ${usable.length} 个文件到 ${displayDirectoryName(targetDir)}`);
		}
	}

	/**
	 * 左右拖动：把条目从一侧复制 / 移动到目标文件夹。
	 *
	 * 语义是**默认复制**；只有前端确认「拖拽源自 Wispkit 面板」且用户按住了
	 * Ctrl/Cmd（或备用键）时才是移动。宿主只信 `internalDrag + moveRequested`
	 * 这对显式标记，不直接拿 ctrlKey 推断，避免系统文件拖入时误删源文件。
	 */
	private async handleDrop(paneId: string, message: Record<string, unknown>): Promise<void> {
		if (!isPaneId(paneId)) {
			return;
		}
		const paneRoot = this.paneRoots[paneId];
		const targetDir = String(message.targetDir ?? '');
		if (!targetDir) {
			this.status(paneId, '没有可放置的目标文件夹。', 'error');
			return;
		}
		if (!paneRoot || !isInside(paneRoot, targetDir)) {
			this.status(paneId, '拖放目标不在这一侧的浏览范围内。', 'error');
			return;
		}

		let targetStat: vscode.FileStat;
		try {
			targetStat = await vscode.workspace.fs.stat(vscode.Uri.file(targetDir));
		} catch (error) {
			this.status(paneId, `拖放目标不可用：${errorText(error)}`, 'error');
			return;
		}
		if ((targetStat.type & vscode.FileType.Directory) === 0) {
			this.status(paneId, '拖放目标不是文件夹。', 'error');
			return;
		}

		const stringDrops = readDroppedStrings(message.strings);
		const fileDrops = readDroppedFiles(message.files);
		const sources = this.resolveDropSources(message);
		for (const extra of await this.resolveDroppedStringPaths(stringDrops)) {
			if (!sources.some(existing => samePath(existing, extra))) {
				sources.push(extra);
			}
		}
		if (sources.length === 0) {
			// 系统资源管理器拖入的 File 只有内容、没有源路径
			if (fileDrops.length > 0) {
				await this.importDroppedFiles(paneId, fileDrops, targetDir);
				return;
			}
			this.status(paneId, '没有可拖动的条目：请从 Wispkit 面板或资源管理器拖动文件。', 'error');
			return;
		}

		const operation: 'copy' | 'move' = isMoveDropRequested(message) ? 'move' : 'copy';
		const failures: string[] = [];
		const usable: string[] = [];

		for (const source of sources) {
			try {
				const stat = await vscode.workspace.fs.stat(vscode.Uri.file(source));
				const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
				if (samePath(source, targetDir)) {
					// 拖到条目自己身上：没有可做的事
					continue;
				}
				if (isDirectory && isSameOrInside(source, targetDir)) {
					failures.push(`${path.basename(source)}：不能把文件夹放到它自己里面`);
					continue;
				}
				if (operation === 'move' && samePath(path.dirname(source), targetDir)) {
					// 已经在目标文件夹里，移动是空操作
					continue;
				}
				usable.push(source);
			} catch (error) {
				failures.push(`${path.basename(source)}：${errorText(error)}`);
			}
		}

		if (usable.length === 0) {
			await this.finishDrop(paneId, {
				operation,
				targetDir,
				moved: [],
				refresh: [],
				error: failures[0],
				message: failures[0] ? `拖放失败：${failures[0]}` : '没有需要处理的条目。',
			});
			return;
		}

		let existing: Set<string>;
		try {
			existing = new Set(
				(await vscode.workspace.fs.readDirectory(vscode.Uri.file(targetDir))).map(([name]) => name),
			);
		} catch (error) {
			this.status(paneId, `无法读取目标文件夹：${errorText(error)}`, 'error');
			return;
		}

		const existingLower = new Set([...existing].map(name => name.toLowerCase()));
		const conflicts = usable.filter(source =>
			!samePath(path.join(targetDir, path.basename(source)), source)
			&& existingLower.has(path.basename(source).toLowerCase()));

		let mode: 'overwrite' | 'rename' | 'cancel' = 'rename';
		if (conflicts.length > 0) {
			const choice = await vscode.window.showQuickPick(
				[
					{
						label: '$(diff-renamed) 自动重命名',
						description: `目标里已有同名条目（${conflicts.map(name => path.basename(name)).join('、')}），用「副本」后缀避开冲突`,
						value: 'rename' as const,
					},
					{
						label: '$(warning) 覆盖',
						description: '用拖过来的条目替换目标里的同名条目',
						value: 'overwrite' as const,
					},
					{ label: '$(close) 取消', value: 'cancel' as const },
				],
				{
					placeHolder: `目标文件夹里有 ${conflicts.length} 个同名条目，怎么处理？`,
					ignoreFocusOut: true,
				},
			);
			if (!choice || choice.value === 'cancel') {
				this.status(paneId, '已取消拖放。');
				return;
			}
			mode = choice.value;
		}

		const taken = new Set(existing);
		const names = usable.map(source => {
			const desired = path.basename(source);
			// 原地复制（拖回同一个文件夹）永远另起名字，避免把自己覆盖掉
			if (mode === 'rename' || samePath(path.join(targetDir, desired), source)) {
				const name = uniqueName(taken, desired);
				taken.add(name);
				return name;
			}
			return desired;
		});

		let copiedCount = 0;
		const moved: string[] = [];
		for (let index = 0; index < usable.length; index += 1) {
			const source = usable[index];
			const destination = vscode.Uri.joinPath(vscode.Uri.file(targetDir), names[index]);
			if (samePath(source, destination.fsPath)) {
				continue;
			}
			try {
				if (operation === 'copy') {
					await vscode.workspace.fs.copy(
						vscode.Uri.file(source),
						destination,
						{ overwrite: mode === 'overwrite' },
					);
					copiedCount += 1;
				} else {
					await this.movePath(source, destination.fsPath, mode === 'overwrite');
					moved.push(source);
				}
			} catch (error) {
				failures.push(`${path.basename(source)}：${errorText(error)}`);
			}
		}

		const successCount = operation === 'copy' ? copiedCount : moved.length;
		let summary: string;
		let error: string | undefined;
		if (successCount === 0 && failures.length === 0) {
			summary = '没有需要处理的条目。';
		} else if (failures.length === 0) {
			summary = `已${operation === 'copy' ? '复制' : '移动'} ${successCount} 个条目到 ${displayDirectoryName(targetDir)}`;
		} else if (successCount > 0) {
			error = failures[0];
			summary = `已${operation === 'copy' ? '复制' : '移动'} ${successCount} 个条目，${failures.length} 个失败：${failures[0]}`;
		} else {
			error = failures[0];
			summary = `拖放失败：${failures[0]}`;
		}

		await this.finishDrop(paneId, {
			operation,
			targetDir,
			moved,
			refresh: refreshDirectories(targetDir, moved, operation),
			error,
			message: summary,
		});
		if (error) {
			void vscode.window.showWarningMessage(`Wispkit：${summary}`);
		}
	}

	/** 系统拖入 / 前端冒泡上来的字符串里，能落到真实文件路径的那些。 */
	private async resolveDroppedStringPaths(strings: readonly DroppedString[]): Promise<string[]> {
		const uriList = strings
			.filter(item => normalizeMime(item.mime) === 'text/uri-list')
			.map(item => item.text)
			.join('\r\n');
		const candidates: string[] = [];
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
		for (const candidate of candidates) {
			if (!candidate || out.some(existing => samePath(existing, candidate))) {
				continue;
			}
			try {
				await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
				out.push(candidate);
			} catch {
				// 不存在的条目当作普通文本，不在这里报错
			}
		}
		return out;
	}

	/** 前端给的绝对路径 + 跨面板拖入的 `file:` URI，统一成源路径列表。 */
	private resolveDropSources(message: Record<string, unknown>): string[] {
		const out: string[] = [];
		const seen = new Set<string>();
		const add = (value: string): void => {
			const resolved = path.resolve(value);
			const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			out.push(value);
		};
		for (const item of readDropPaths(message.paths)) {
			add(item);
		}
		for (const item of readDropPaths(message.uris)) {
			try {
				const uri = vscode.Uri.parse(item);
				if (uri.scheme === 'file') {
					add(uri.fsPath);
				}
			} catch {
				// 不是合法 URI 就忽略；paths 已经覆盖同一面板内的拖动
			}
		}
		return out;
	}

	/** 移动：优先 rename（同盘原子）；跨盘时退回「复制 + 删除」。 */
	private async movePath(source: string, destination: string, overwrite: boolean): Promise<void> {
		try {
			await vscode.workspace.fs.rename(
				vscode.Uri.file(source),
				vscode.Uri.file(destination),
				{ overwrite },
			);
			return;
		} catch {
			// 跨卷 / 目标被占用时 rename 会失败，走复制再删
		}
		await vscode.workspace.fs.copy(vscode.Uri.file(source), vscode.Uri.file(destination), { overwrite });
		await vscode.workspace.fs.delete(vscode.Uri.file(source), { recursive: true, useTrash: true });
	}

	/**
	 * 落盘结束后把结果和需要刷新的目录回给前端。
	 *
	 * 刷新目录按左右各自的浏览根过滤：被移动的源可能在另一侧，前端只重新请求
	 * 自己已经读过的那几层（`pane.levels` 里有的），避免给没展开的目录塞过期缓存。
	 */
	private async finishDrop(
		paneId: PaneId,
		result: {
			readonly operation: 'copy' | 'move';
			readonly targetDir: string;
			readonly moved: readonly string[];
			readonly refresh: readonly string[];
			readonly error?: string;
			readonly message: string;
		},
	): Promise<void> {
		await this.panel.webview.postMessage({
			type: 'wispkit.compare.dropResult',
			pane: paneId,
			operation: result.operation,
			targetDir: result.targetDir,
			moved: result.moved,
			refresh: {
				left: result.refresh.filter(item => isInside(this.paneRoots.left, item)),
				right: result.refresh.filter(item => isInside(this.paneRoots.right, item)),
			},
			error: result.error,
			message: result.message,
		});
	}

	public dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		if (ComparePanel.current === this) {
			ComparePanel.current = undefined;
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}
