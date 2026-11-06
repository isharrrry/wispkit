import * as vscode from 'vscode';
import * as fs from 'node:fs';
import {
	addFolder,
	addGroup,
	countStoreNodes,
	countNodes,
	createStore,
	findNode,
	flattenContainers,
	folderNameFromPath,
	isDescendant,
	moveNode,
	moveSibling,
	removeNode,
	renameNode,
	serializeStore,
	type ResourceFolderNode,
	type ResourceGroupNode,
	type ResourceTreeStore,
	type ResourceTreeNode,
} from './resourceTree/model';
import {
	displayStoredPath,
	resolveStoredPath,
	toStoredPath,
	type WorkspaceFolderLike,
} from './resourceTree/paths';
import {
	currentStorageResolution,
	errorText,
	isFileNotFound,
	readStore,
	storageDescription,
	workspaceFolderLikes,
	writeStore,
	writeTextAtomically,
} from './resourceTree/storage';
import { classifyExternalChange, decodeStoreText, type ExternalChangeKind } from './resourceTree/storageCore';
import { planExplorerFolderAdd, type UriClassification } from './resourceTree/explorerSelection';
import { planImport } from './resourceTree/transfer';
import {
	FolderStateCache,
	type CachedFolderState,
} from './resourceTree/folderStateCache';
import {
	clickCommandFor,
	folderDescription,
	folderOpenHint,
	folderStateFromCached,
	terminalNameFor,
} from './resourceTree/presentation';
import { SubtreePanel } from './subtreeProvider';
import { ComparePanel } from './compareProvider';
import { launchSystemTerminal } from './resourceTree/systemTerminalLaunch';
import type { SystemTerminalKind } from './resourceTree/systemTerminal';

/**
 * 活动栏「自定义资源管理」。
 *
 * 与 drawcode 的程序集树同一套交互范式（TreeDataProvider + 拖拽 + 视图标题 /
 * 条目右键命令），但存储从 workspaceState 换成了**工作区里的普通 JSON**：
 * 需求要求外部可改、可导出、可导入、点刷新重载，这些都必须落到一个用户
 * 看得见、改得动的文件上。
 */

export const RESOURCE_TREE_VIEW_TYPE = 'wispkit.resourceTree';
const INTERNAL_MIME = 'application/vnd.code.tree.wispkit.resourcetree';
const URI_LIST_MIME = 'text/uri-list';
/** 检测到外部修改时，警告通知里唯一会继续写入的按钮。 */
const OVERWRITE_EXTERNAL = '覆盖外部修改';
const CANCEL_SAVE = '取消';
/** getTreeItem 里发现未命中时，合并成一次微批再补取，避免每个节点各打一次盘。 */
const STATE_REFRESH_DELAY_MS = 25;

function isResourceNode(value: unknown): value is ResourceTreeNode {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (record.type === 'group' || record.type === 'folder')
		&& typeof record.id === 'string'
		&& typeof record.name === 'string'
		&& Array.isArray(record.children);
}

function folderNodes(nodes: readonly ResourceTreeNode[]): ResourceFolderNode[] {
	const result: ResourceFolderNode[] = [];
	for (const node of nodes) {
		if (node.type === 'folder') {
			result.push(node);
		}
		result.push(...folderNodes(node.children));
	}
	return result;
}

export class ResourceTreeProvider implements
	vscode.TreeDataProvider<ResourceTreeNode>,
	vscode.TreeDragAndDropController<ResourceTreeNode>,
	vscode.Disposable {
	public static readonly viewType = RESOURCE_TREE_VIEW_TYPE;

	readonly dragMimeTypes: readonly string[] = [INTERNAL_MIME, URI_LIST_MIME];
	readonly dropMimeTypes: readonly string[] = [INTERNAL_MIME, URI_LIST_MIME];

	private store: ResourceTreeStore = createStore();
	private storageUri: vscode.Uri | undefined;
	/**
	 * 最后一次成功读取 / 写入磁盘时的**规范化**文本。
	 *
	 * 写入前用它和磁盘当前内容比较：不同说明文件被外部改过，必须先让用户确认，
	 * 避免扩展在用户不知情时整体覆盖外部修改。`undefined` 表示还没确认过文件
	 * （首次使用 / 文件不存在）。
	 */
	private lastPersistedText: string | undefined;
	/** 存储配置 / 读取失败时显示在视图正文里的诊断；成功后清空。 */
	private storageMessage: string | undefined;
	private view: vscode.TreeView<ResourceTreeNode> | undefined;
	private ready: Promise<void> | undefined;
	private readonly emitter = new vscode.EventEmitter<ResourceTreeNode | undefined | void>();
	private loadChain: Promise<void> = Promise.resolve();
	/**
	 * 文件夹状态只在异步阶段用 `workspace.fs.stat` 预取，`getTreeItem` 只读缓存。
	 * 本地盘无感，但网络盘 / 上千节点时同步 stat 会阻塞扩展宿主线程。
	 */
	private readonly stateCache = new FolderStateCache({
		ttlMs: 30_000,
		maxEntries: 2000,
		maxConcurrency: 8,
		stat: async fsPath => {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
			// 断链：stat 成功但只有 SymbolicLink 位，目标既不是目录也不是文件。
			// 不能按「file」处理，否则界面会误报「不是文件夹」。
			if ((stat.type & vscode.FileType.SymbolicLink)
				&& !(stat.type & vscode.FileType.Directory)
				&& !(stat.type & vscode.FileType.File)) {
				return 'broken-link';
			}
			return (stat.type & vscode.FileType.Directory) ? 'directory' : 'file';
		},
	});
	private readonly pendingStatePaths = new Set<string>();
	private stateRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	readonly onDidChangeTreeData = this.emitter.event;

	public constructor() { }

	public attachView(view: vscode.TreeView<ResourceTreeNode>): void {
		this.view = view;
		this.updateViewState();
	}

	public initialize(): Promise<void> {
		if (!this.ready) {
			this.ready = this.reload(false).then(() => undefined);
		}
		return this.ready;
	}

	public async ensureReady(): Promise<void> {
		if (this.ready) {
			await this.ready;
		}
	}

	public getStore(): ResourceTreeStore {
		return this.store;
	}

	public getStorageUri(): vscode.Uri | undefined {
		return this.storageUri;
	}

	public folderLikes(): WorkspaceFolderLike[] {
		return workspaceFolderLikes();
	}

	// ── TreeDataProvider ─────────────────────────────────────────────────

	public getTreeItem(element: ResourceTreeNode): vscode.TreeItem {
		const collapsible = element.children.length > 0
			? vscode.TreeItemCollapsibleState.Collapsed
			: vscode.TreeItemCollapsibleState.None;
		const item = new vscode.TreeItem(element.name, collapsible);
		item.id = element.id;
		item.contextValue = element.type === 'folder' ? 'wispkitResourceFolder' : 'wispkitResourceGroup';

		if (element.type === 'group') {
			item.iconPath = new vscode.ThemeIcon('folder-library');
			item.description = element.children.length > 0 ? `${element.children.length} 项` : '';
			item.tooltip = [
				element.name,
				'类型：虚拟分组（只用于命名和归类，不对应磁盘文件夹）',
				`子项：${element.children.length}`,
				'点击只提示不能浏览；文件夹节点才对应磁盘目录',
			].join('\n');
			// 虚拟组也给 command：单击时明确提示“不能浏览”，而不是毫无反馈。
			const groupCommand = clickCommandFor(element);
			item.command = { ...groupCommand, arguments: [element] };
			return item;
		}

		const resolved = resolveStoredPath(element.path, this.folderLikes());
		const state = resolved
			? folderStateFromCached(this.cachedFolderState(resolved))
			: 'unresolved';
		if (state === 'directory' || state === 'unknown') {
			// unknown 是首次展开时的临时态：先给普通文件夹图标，异步补取后再纠正。
			item.iconPath = new vscode.ThemeIcon('folder');
		} else {
			item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
		}
		const relative = resolved ? vscode.workspace.asRelativePath(resolved, false) : '';
		item.description = folderDescription(element.name, state, relative);
		item.tooltip = [
			element.name,
			'类型：文件夹',
			`路径：${displayStoredPath(element.path, this.folderLikes())}`,
			`子项：${element.children.length}`,
			folderOpenHint(state),
		].join('\n');
		const folderCommand = clickCommandFor(element);
		item.command = { ...folderCommand, arguments: [element] };
		return item;
	}

	public getChildren(element?: ResourceTreeNode): ResourceTreeNode[] {
		const children = element ? [...element.children] : [...this.store.roots];
		// getChildren 是同步 API，但可以在这里“顺势”把下一层文件夹状态异步预取好，
		// 等 VS Code 紧接着为每行调 getTreeItem 时缓存通常已经就绪。
		this.prefetchFolderStates(children);
		return children;
	}

	public getParent(element: ResourceTreeNode): ResourceTreeNode | undefined {
		return findNode(this.store, element.id)?.parent;
	}

	// ── 文件夹状态缓存 ──────────────────────────────────────────────────

	/**
	 * `getTreeItem` 的同步入口：只读缓存，绝不同步读取磁盘。
	 * 未命中 / 已过期时把路径记进微批，稍后异步补取并触发一次重绘。
	 */
	private cachedFolderState(resolved: string): CachedFolderState | undefined {
		const lookup = this.stateCache.lookup(resolved);
		if (!lookup.fresh) {
			this.pendingStatePaths.add(resolved);
			this.scheduleStateRefresh();
		}
		return lookup.state;
	}

	private scheduleStateRefresh(): void {
		if (this.stateRefreshTimer) {
			return;
		}
		this.stateRefreshTimer = setTimeout(() => {
			this.stateRefreshTimer = undefined;
			const paths = [...this.pendingStatePaths];
			this.pendingStatePaths.clear();
			if (paths.length === 0) {
				return;
			}
			void this.stateCache.refresh(paths).then(changed => {
				if (changed) {
					this.fire();
				}
			});
		}, STATE_REFRESH_DELAY_MS);
	}

	private prefetchFolderStates(nodes: readonly ResourceTreeNode[]): void {
		const folders = nodes.filter((node): node is ResourceFolderNode => node.type === 'folder');
		if (folders.length === 0) {
			return;
		}
		const likes = this.folderLikes();
		const paths: string[] = [];
		for (const folder of folders) {
			const resolved = resolveStoredPath(folder.path, likes);
			if (resolved) {
				paths.push(resolved);
			}
		}
		if (paths.length === 0) {
			return;
		}
		void this.stateCache.refresh(paths).then(changed => {
			if (changed) {
				this.fire();
			}
		});
	}

	/** 重建缓存：先按当前树裁掉已删除节点，再补取缺失 / 过期条目。 */
	private async rebuildStateCache(force: boolean): Promise<void> {
		const likes = this.folderLikes();
		const paths = folderNodes(this.store.roots)
			.map(node => resolveStoredPath(node.path, likes))
			.filter((value): value is string => value !== undefined);
		this.stateCache.prune(paths);
		this.pendingStatePaths.clear();
		await this.stateCache.refresh(paths, { force });
	}

	private clearStateCache(): void {
		if (this.stateRefreshTimer) {
			clearTimeout(this.stateRefreshTimer);
			this.stateRefreshTimer = undefined;
		}
		this.pendingStatePaths.clear();
		this.stateCache.clear();
	}

	// ── 加载 / 保存 ──────────────────────────────────────────────────────

	public reload(notify: boolean): Promise<boolean> {
		const run = this.loadChain
			.then(() => this.doReload(notify))
			.catch(error => {
				this.showError('刷新资源树失败', error);
				return false;
			});
		this.loadChain = run.then(() => undefined, () => undefined);
		return run;
	}

	private async doReload(notify: boolean): Promise<boolean> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			const changed = this.store.roots.length > 0;
			this.store = createStore();
			this.storageUri = undefined;
			this.lastPersistedText = undefined;
			this.storageMessage = undefined;
			this.clearStateCache();
			if (changed) {
				this.fire();
			}
			this.updateViewState();
			if (notify) {
				void vscode.window.showWarningMessage('当前没有打开工作区文件夹，资源树没有可保存的 JSON。');
			}
			return false;
		}
		const resolution = currentStorageResolution();
		if (!resolution.uri) {
			this.storageMessage = resolution.error ?? '资源树存储路径配置无效。';
			this.updateViewState();
			void vscode.window.showErrorMessage(`资源树配置错误：${this.storageMessage}`);
			return false;
		}
		const uri = resolution.uri;
		let result;
		try {
			result = await readStore(uri);
		} catch (error) {
			this.showError('刷新资源树失败', error);
			return false;
		}
		if (result.error) {
			// 非法 / 不可读的文件不能替换当前树，也不能触发任何写盘。
			this.storageMessage = result.error;
			this.updateViewState();
			void vscode.window.showWarningMessage(`资源树刷新失败：${result.error} 当前树保持不变，文件不会被覆盖。`);
			return false;
		}
		this.storageUri = uri;
		this.storageMessage = undefined;
		this.store = result.store;
		// 规范化文本代表「用户确认过的磁盘内容」；之后写入前用它检测外部修改。
		this.lastPersistedText = result.exists ? serializeStore(result.store) : undefined;
		// 刷新是用户显式要求「以磁盘为准」：强制重查全部 folder，外部删除 / 恢复
		// 会在这次 fire 前落到缓存里，展开时立刻显示警告，不会先闪一下旧状态。
		await this.rebuildStateCache(true);
		this.fire();
		this.updateViewState();
		if (result.warnings.length > 0) {
			const preview = result.warnings.slice(0, 3).join('；');
			void vscode.window.showWarningMessage(`资源树 JSON 有 ${result.warnings.length} 处问题：${preview}`);
		}
		if (notify) {
			if (!result.exists) {
				void vscode.window.showInformationMessage('资源树文件不存在，已按空树显示；第一次编辑时会自动创建。');
			} else {
				void vscode.window.showInformationMessage(`资源树已刷新：${countStoreNodes(this.store)} 个节点。`);
			}
		}
		return true;
	}

	private updateViewState(): void {
		if (!this.view) {
			return;
		}
		this.view.description = storageDescription(this.storageUri);
		this.view.message = this.storageMessage
			?? (this.storageUri
				? undefined
				: '请先打开一个工作区文件夹；资源树会保存在第一个工作区的 .WispkitView/resource-tree.json。');
	}

	private fire(): void {
		if (this.disposed) {
			// 在途 stat 可能在扩展释放后才完成，不能再对已 dispose 的 emitter 发事件。
			return;
		}
		this.emitter.fire();
	}

	private async commit(next: ResourceTreeStore): Promise<boolean> {
		if (next === this.store) {
			return false;
		}
		const resolution = currentStorageResolution();
		if (!resolution.uri) {
			void vscode.window.showErrorMessage(
				`保存资源树失败：${resolution.error ?? '没有可用的资源树存储位置。'}`,
			);
			return false;
		}
		const uri = resolution.uri;
		// 写入前再读一次：外部已保存的修改不能被静默覆盖。检测到变化时先弹
		// 模态确认；用户取消则内存树与磁盘都不动。
		const external = await this.detectExternalChange(uri);
		if (external.kind !== 'none' && !await this.confirmExternalOverwrite(external)) {
			return false;
		}
		try {
			await writeStore(uri, next);
		} catch (error) {
			// 内存树保持不变：没写成功就不能让界面显示「已修改」。
			this.showError('保存资源树失败（旧文件保持不变）', error);
			return false;
		}
		this.store = next;
		this.storageUri = uri;
		this.storageMessage = undefined;
		this.lastPersistedText = serializeStore(next);
		// 增删改移后先裁掉被移除节点的缓存、补取新增节点，再刷新视图，
		// 这样新加的失效文件夹第一次出现就带警告。
		await this.rebuildStateCache(false);
		this.fire();
		this.updateViewState();
		return true;
	}

	private showError(prefix: string, error: unknown): void {
		const detail = error instanceof Error ? error.message : String(error);
		console.error(`[wispkit-resource-tree] ${prefix}:`, error);
		void vscode.window.showErrorMessage(`${prefix}：${detail}`);
	}

	/**
	 * 写入前再读一次磁盘，判断外部是否改过文件。
	 *
	 * 只比较规范化后的树内容：外部仅调整缩进 / BOM 不算冲突。非法 JSON、读取失败
	 * 都按「已修改」处理——此时磁盘内容无法安全解释，覆盖前必须让用户确认。
	 */
	private async detectExternalChange(uri: vscode.Uri): Promise<{ kind: ExternalChangeKind; detail: string }> {
		// 存储位置刚刚切换（还没重新加载）时不能拿旧文件的文本比较；此时把已有的
		// 新目标文件当作「外部新建」，宁可多问一次也不静默覆盖。
		const knownText = this.storageUri && this.storageUri.toString() === uri.toString()
			? this.lastPersistedText
			: undefined;
		let result;
		try {
			result = await readStore(uri);
		} catch (error) {
			return { kind: 'modified', detail: `读取失败：${errorText(error)}` };
		}
		if (result.error) {
			return { kind: 'modified', detail: result.error };
		}
		if (!result.exists) {
			return { kind: classifyExternalChange(knownText, undefined), detail: '文件已不存在' };
		}
		const diskText = serializeStore(result.store);
		const kind = classifyExternalChange(knownText, diskText);
		return { kind, detail: kind === 'none' ? '' : '内容与扩展上次确认的版本不同' };
	}

	/**
	 * 检测到外部修改后的确认。
	 *
	 * 用**非模态**警告通知而不是模态对话框：写入本来就在等这个 Promise，
	 * 不点「覆盖外部修改」就不会落盘；通知不抢占整个窗口，也不阻塞其它视图中
	 * 的浏览操作。关闭 / 忽略通知按取消处理。
	 */
	private async confirmExternalOverwrite(
		change: { kind: ExternalChangeKind; detail: string },
	): Promise<boolean> {
		const what = change.kind === 'created'
			? '资源树文件在外部被创建'
			: change.kind === 'deleted'
				? '资源树文件已被外部删除'
				: '资源树文件已被外部修改';
		const answer = await vscode.window.showWarningMessage(
			`${what}（${change.detail}）。继续保存会用当前树覆盖外部内容；`
				+ '此检查只发生在写入前，外部未保存的编辑之后保存时仍可能覆盖本次写入。',
			OVERWRITE_EXTERNAL,
			CANCEL_SAVE,
		);
		if (answer === OVERWRITE_EXTERNAL) {
			return true;
		}
		void vscode.window.showInformationMessage('已取消保存：资源树文件保持外部内容。');
		return false;
	}

	/** 「打开资源树 JSON」在文件不存在时会先写当前树，避免下一次写入误判为外部新建。 */
	public markPersisted(): void {
		this.lastPersistedText = serializeStore(this.store);
	}

	public async reveal(node: ResourceTreeNode | undefined): Promise<void> {
		if (!node || !this.view) {
			return;
		}
		try {
			await this.view.reveal(node, { select: true, focus: false, expand: true });
		} catch {
			// 树还没刷新到该节点时 reveal 会失败，忽略即可。
		}
	}

	// ── 变更 ────────────────────────────────────────────────────────────

	public async createGroup(parentId: string | null | undefined, name: string): Promise<ResourceGroupNode | undefined> {
		await this.ensureReady();
		const result = addGroup(this.store, parentId, name);
		if (!result.node) {
			void vscode.window.showWarningMessage('无法新建分组：已达到节点数量或层级上限。');
			return undefined;
		}
		if (!await this.commit(result.store)) {
			return undefined;
		}
		await this.reveal(result.node);
		return result.node;
	}

	public async createFolder(
		parentId: string | null | undefined,
		name: string,
		path: string,
	): Promise<ResourceFolderNode | undefined> {
		await this.ensureReady();
		const result = addFolder(this.store, parentId, name, path);
		if (!result.node) {
			void vscode.window.showWarningMessage('无法添加文件夹：路径为空或已达到节点数量 / 层级上限。');
			return undefined;
		}
		if (!await this.commit(result.store)) {
			return undefined;
		}
		await this.reveal(result.node);
		return result.node;
	}

	public async createFolders(
		parentId: string | null | undefined,
		items: ReadonlyArray<{ name: string; path: string }>,
	): Promise<number> {
		await this.ensureReady();
		let next = this.store;
		let last: ResourceFolderNode | undefined;
		let created = 0;
		for (const item of items) {
			const result = addFolder(next, parentId, item.name, item.path);
			if (result.node) {
				next = result.store;
				last = result.node;
				created += 1;
			}
		}
		if (created === 0) {
			void vscode.window.showWarningMessage('没有添加任何文件夹（路径为空或达到上限）。');
			return 0;
		}
		if (!await this.commit(next)) {
			return 0;
		}
		await this.reveal(last);
		return created;
	}

	public async rename(id: string, name: string): Promise<boolean> {
		await this.ensureReady();
		const next = renameNode(this.store, id, name);
		if (next === this.store) {
			return false;
		}
		const ok = await this.commit(next);
		if (ok) {
			await this.reveal(findNode(next, id)?.node);
		}
		return ok;
	}

	public async remove(id: string): Promise<boolean> {
		await this.ensureReady();
		const next = removeNode(this.store, id);
		if (next === this.store) {
			return false;
		}
		return this.commit(next);
	}

	public async move(id: string, targetParentId: string | null | undefined): Promise<boolean> {
		await this.ensureReady();
		const next = moveNode(this.store, id, targetParentId);
		if (next === this.store) {
			void vscode.window.showWarningMessage('无法移动：目标不能是节点自身或它的子节点。');
			return false;
		}
		const ok = await this.commit(next);
		if (ok) {
			await this.reveal(findNode(next, id)?.node);
		}
		return ok;
	}

	public async moveMany(ids: readonly string[], targetParentId: string | null | undefined): Promise<boolean> {
		await this.ensureReady();
		let next = this.store;
		for (const id of ids) {
			next = moveNode(next, id, targetParentId);
		}
		if (next === this.store) {
			void vscode.window.showWarningMessage('没有可移动的节点（目标可能位于节点自身内部）。');
			return false;
		}
		return this.commit(next);
	}

	public async moveSibling(id: string, delta: number): Promise<boolean> {
		await this.ensureReady();
		const next = moveSibling(this.store, id, delta);
		if (next === this.store) {
			return false;
		}
		const ok = await this.commit(next);
		if (ok) {
			await this.reveal(findNode(next, id)?.node);
		}
		return ok;
	}

	public async replaceStore(store: ResourceTreeStore): Promise<boolean> {
		await this.ensureReady();
		return this.commit(store);
	}

	// ── 拖拽 ────────────────────────────────────────────────────────────

	public handleDrag(source: readonly ResourceTreeNode[], dataTransfer: vscode.DataTransfer): void {
		const ids = source.map(node => node.id);
		if (ids.length === 0) {
			return;
		}
		dataTransfer.set(INTERNAL_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
		const folders = folderNodes(source)
			.map(node => resolveStoredPath(node.path, this.folderLikes()))
			.filter((value): value is string => value !== undefined)
			.map(value => vscode.Uri.file(value).toString());
		if (folders.length > 0) {
			dataTransfer.set(URI_LIST_MIME, new vscode.DataTransferItem(folders.join('\r\n')));
		}
	}

	public async handleDrop(
		target: ResourceTreeNode | undefined,
		dataTransfer: vscode.DataTransfer,
		_token: vscode.CancellationToken,
	): Promise<void> {
		await this.ensureReady();
		const targetId = target ? target.id : null;

		const internal = dataTransfer.get(INTERNAL_MIME);
		if (internal) {
			let ids: string[] = [];
			try {
				const parsed: unknown = JSON.parse(await internal.asString());
				if (Array.isArray(parsed)) {
					ids = parsed.filter((value): value is string => typeof value === 'string');
				}
			} catch {
				return;
			}
			if (ids.length === 0) {
				return;
			}
			await this.moveMany(ids, targetId);
			return;
		}

		const uriList = dataTransfer.get(URI_LIST_MIME);
		if (!uriList) {
			return;
		}
		const raw = await uriList.asString();
		const items: Array<{ name: string; path: string }> = [];
		let skipped = 0;
		for (const line of raw.split(/\r?\n/)) {
			const value = line.trim();
			if (!value || value.startsWith('#')) {
				continue;
			}
			let uri: vscode.Uri;
			try {
				uri = vscode.Uri.parse(value);
			} catch {
				skipped += 1;
				continue;
			}
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				if (!(stat.type & vscode.FileType.Directory)) {
					skipped += 1;
					continue;
				}
			} catch {
				skipped += 1;
				continue;
			}
			const fsPath = uri.fsPath || uri.path;
			items.push({
				name: folderNameFromPath(fsPath),
				path: toStoredPath(fsPath, this.folderLikes()),
			});
		}
		if (items.length === 0) {
			void vscode.window.showWarningMessage('拖入的内容里没有可添加的文件夹。');
			return;
		}
		const created = await this.createFolders(targetId, items);
		if (skipped > 0) {
			void vscode.window.showWarningMessage(`已添加 ${created} 个文件夹，跳过 ${skipped} 个非文件夹条目。`);
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.clearStateCache();
		this.emitter.dispose();
	}
}

// ── 命令层 ────────────────────────────────────────────────────────────────

interface CommandDeps {
	readonly provider: ResourceTreeProvider;
	readonly view: vscode.TreeView<ResourceTreeNode>;
	readonly context: vscode.ExtensionContext;
}

function selectedNode(deps: CommandDeps, arg: unknown): ResourceTreeNode | undefined {
	if (isResourceNode(arg)) {
		return arg;
	}
	return deps.view.selection[0];
}

function containerArg(arg: unknown): ResourceTreeNode | undefined {
	return isResourceNode(arg) ? arg : undefined;
}

function run(action: (...args: any[]) => Promise<void>): (...args: any[]) => void {
	return (...args: any[]) => {
		void action(...args).catch(error => {
			console.error('[wispkit-resource-tree] command failed:', error);
			void vscode.window.showErrorMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`);
		});
	};
}

function validateName(value: string): string | undefined {
	return value.trim().length === 0 ? '名称不能为空' : undefined;
}

async function addGroupCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const parent = containerArg(arg);
	const name = await vscode.window.showInputBox({
		title: parent ? `在「${parent.name}」下新建虚拟组` : '新建虚拟组',
		prompt: '虚拟组只用于命名和分组，不对应磁盘文件夹',
		value: '新建分组',
		validateInput: validateName,
	});
	if (name === undefined) {
		return;
	}
	await deps.provider.createGroup(parent?.id ?? null, name);
}

async function addFolderCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const parent = containerArg(arg);
	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: true,
		title: parent ? `添加文件夹到「${parent.name}」` : '添加文件夹到自定义资源管理',
		openLabel: '添加文件夹',
		defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
	});
	if (!picked || picked.length === 0) {
		return;
	}
	const items: Array<{ name: string; path: string }> = [];
	let skipped = 0;
	for (const uri of picked) {
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (!(stat.type & vscode.FileType.Directory)) {
				skipped += 1;
				continue;
			}
		} catch {
			skipped += 1;
			continue;
		}
		const base = folderNameFromPath(uri.fsPath || uri.path);
		let name = base;
		if (picked.length === 1) {
			const input = await vscode.window.showInputBox({
				title: '文件夹显示名称',
				prompt: '只影响树里的显示名，不会重命名磁盘文件夹',
				value: base,
				validateInput: validateName,
			});
			if (input === undefined) {
				return;
			}
			name = input.trim() || base;
		}
		items.push({ name, path: toStoredPath(uri.fsPath || uri.path, deps.provider.folderLikes()) });
	}
	if (items.length === 0) {
		void vscode.window.showWarningMessage('选择的内容里没有可添加的文件夹。');
		return;
	}
	const created = await deps.provider.createFolders(parent?.id ?? null, items);
	if (skipped > 0) {
		void vscode.window.showWarningMessage(`已添加 ${created} 个文件夹，跳过 ${skipped} 个非文件夹条目。`);
	}
}

async function addFolderFromExplorerCommand(deps: CommandDeps, ...args: unknown[]): Promise<void> {
	const plan = await planExplorerFolderAdd(args, {
		folders: deps.provider.folderLikes(),
		classify: async (uri): Promise<UriClassification> => {
			try {
				const stat = await vscode.workspace.fs.stat(uri as vscode.Uri);
				return (stat.type & vscode.FileType.Directory) ? 'directory' : 'not-directory';
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
		},
		promptName: async (defaultName: string) => vscode.window.showInputBox({
			title: '添加到自定义资源管理',
			prompt: '显示名称（不会重命名磁盘文件夹）',
			value: defaultName,
			validateInput: validateName,
		}),
	});
	switch (plan.kind) {
		case 'no-selection':
			void vscode.window.showInformationMessage('请从资源管理器右键一个文件夹再使用此命令。');
			return;
		case 'invalid-single':
			void vscode.window.showWarningMessage('只能添加文件夹。');
			return;
		case 'stat-failed':
			void vscode.window.showWarningMessage(`无法读取文件夹：${plan.message}`);
			return;
		case 'no-folders':
			void vscode.window.showWarningMessage('选择的内容里没有可添加的文件夹。');
			return;
		case 'cancelled':
			return;
		case 'ready': {
			const created = await deps.provider.createFolders(null, plan.items);
			if (plan.skipped > 0) {
				void vscode.window.showWarningMessage(`已添加 ${created} 个文件夹，跳过 ${plan.skipped} 个非文件夹条目。`);
			} else if (created > 1) {
				void vscode.window.showInformationMessage(`已添加 ${created} 个文件夹。`);
			}
			return;
		}
	}
}

async function renameCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const name = await vscode.window.showInputBox({
		title: `重命名「${node.name}」`,
		prompt: node.type === 'folder' ? '只改树里的显示名，不会重命名磁盘文件夹' : '虚拟组名称',
		value: node.name,
		validateInput: validateName,
	});
	if (name === undefined || name.trim() === node.name) {
		return;
	}
	await deps.provider.rename(node.id, name.trim());
}

async function removeCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const count = countNodes(node);
	const detail = count > 1 ? `「${node.name}」及其 ${count - 1} 个子节点` : `「${node.name}」`;
	const answer = await vscode.window.showWarningMessage(
		`确定从自定义资源管理中删除${detail}？不会删除磁盘上的任何文件。`,
		{ modal: true },
		'删除',
	);
	if (answer !== '删除') {
		return;
	}
	await deps.provider.remove(node.id);
}

interface MovePick extends vscode.QuickPickItem {
	readonly targetId: string | null;
}

async function moveToCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const store = deps.provider.getStore();
	const items: MovePick[] = [{
		label: '$(home) 根目录',
		description: '移到资源树最外层',
		targetId: null,
	}];
	for (const entry of flattenContainers(store)) {
		if (entry.node.id === node.id || isDescendant(store, node.id, entry.node.id)) {
			continue;
		}
		items.push({
			label: `${'　'.repeat(entry.depth)}$(folder) ${entry.node.name}`,
			description: entry.path.join(' / '),
			targetId: entry.node.id,
		});
	}
	const picked = await vscode.window.showQuickPick(items, {
		title: `移动「${node.name}」到…`,
		placeHolder: '选择目标分组 / 文件夹',
		matchOnDescription: true,
	});
	if (!picked) {
		return;
	}
	await deps.provider.move(node.id, picked.targetId);
}

async function moveUpCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (node) {
		await deps.provider.moveSibling(node.id, -1);
	}
}

async function moveDownCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (node) {
		await deps.provider.moveSibling(node.id, 1);
	}
}

/**
 * 文件夹节点 → 绝对路径（不做磁盘校验）。
 *
 * 供「复制路径」这类**不要求目录存在**的操作使用：网盘离线、目录临时不在时
 * 用户仍可能需要把路径复制走。虚拟组没有磁盘路径，直接提示并返回 undefined。
 */
function folderPath(
	node: ResourceTreeNode,
	likes: WorkspaceFolderLike[],
	action: string,
): string | undefined {
	if (node.type !== 'folder') {
		void vscode.window.showInformationMessage(`虚拟分组不对应真实文件夹，不能${action}。`);
		return undefined;
	}
	const resolved = resolveStoredPath(node.path, likes);
	if (!resolved) {
		void vscode.window.showWarningMessage(`无法解析路径「${node.path}」；请检查工作区是否匹配。`);
		return undefined;
	}
	return resolved;
}

/**
 * 文件夹节点 → 磁盘 Uri 的共用校验（浏览 / 打开终端 / 在系统资源管理器中打开）。
 *
 * 这里以触发瞬间的实时 stat 为准，不复用 getTreeItem 的缓存：缓存可能是 30s
 * 前的状态，而建终端 / 开面板都必须拿到当下真实存在的目录。失败时给出具体
 * 原因并返回 undefined，调用方只负责成功路径。
 */
async function folderTarget(
	node: ResourceTreeNode,
	likes: WorkspaceFolderLike[],
	action: string,
): Promise<vscode.Uri | undefined> {
	const resolved = folderPath(node, likes, action);
	if (!resolved) {
		return undefined;
	}
	const uri = vscode.Uri.file(resolved);
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if ((stat.type & vscode.FileType.SymbolicLink)
			&& !(stat.type & vscode.FileType.Directory)
			&& !(stat.type & vscode.FileType.File)) {
			void vscode.window.showWarningMessage(`链接已断开（目标不存在）：${resolved}`);
			return undefined;
		}
		if (!(stat.type & vscode.FileType.Directory)) {
			void vscode.window.showWarningMessage('目标路径不是文件夹。');
			return undefined;
		}
	} catch {
		void vscode.window.showWarningMessage(`文件夹不存在：${resolved}`);
		return undefined;
	}
	return uri;
}

async function openFolderCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const uri = await folderTarget(node, deps.provider.folderLikes(), '浏览');
	if (!uri) {
		return;
	}
	await SubtreePanel.open(deps.context, uri);
}

/**
 * 「在终端中打开」：在资源树文件夹条目行尾的内联按钮 / 右键菜单触发。
 *
 * 终端标签用树的显示名（用户起的别名，未改名时就是文件夹名）；cwd 指向该
 * 文件夹，show() 确保终端面板被带到前台。重复点击按 VS Code 原生行为
 * 新建终端，不复用已有终端——用户可能就是要开第二个。
 */
async function openTerminalCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const uri = await folderTarget(node, deps.provider.folderLikes(), '打开终端');
	if (!uri) {
		return;
	}
	const terminal = vscode.window.createTerminal({
		name: terminalNameFor(node),
		cwd: uri,
	});
	terminal.show();
}

/**
 * 「复制路径」：只解析占位符，不做 stat。
 *
 * 路径可能是网络盘 / 临时离线的目录，此时仍然应该允许复制；与「打开」类
 * 操作区分开，避免“路径不存在就不能复制”的反直觉行为。
 */
async function copyPathCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const path = folderPath(node, deps.provider.folderLikes(), '复制路径');
	if (!path) {
		return;
	}
	await vscode.env.clipboard.writeText(path);
	void vscode.window.showInformationMessage(`已复制路径：${path}`);
}

/**
 * 「在 VS Code 中打开」：把该文件夹作为工作区打开。
 *
 * 固定 `forceNewWindow: true`：在当前窗口打开会替换掉用户现有的工作区（包括
 * 这棵资源树），属于破坏性副作用；新窗口则保留现场。
 */
async function openInVSCodeCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const uri = await folderTarget(node, deps.provider.folderLikes(), '在 VS Code 中打开');
	if (!uri) {
		return;
	}
	try {
		await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
	} catch (error) {
		void vscode.window.showErrorMessage(`在 VS Code 中打开失败：${errorText(error)}`);
	}
}

/** 「在系统资源管理器中打开」：交回操作系统打开该目录（Windows 为资源管理器）。 */
async function openInSystemExplorerCommand(deps: CommandDeps, arg?: unknown): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const uri = await folderTarget(node, deps.provider.folderLikes(), '在系统资源管理器中打开');
	if (!uri) {
		return;
	}
	const opened = await vscode.env.openExternal(uri);
	if (!opened) {
		void vscode.window.showWarningMessage(`无法打开系统资源管理器：${uri.fsPath}`);
	}
}

/** 「系统终端打开」：按菜单选中的终端类型启动独立于 VS Code 的终端窗口。 */
async function systemTerminalCommand(
	deps: CommandDeps,
	kind: SystemTerminalKind,
	arg?: unknown,
): Promise<void> {
	const node = selectedNode(deps, arg);
	if (!node) {
		return;
	}
	const uri = await folderTarget(node, deps.provider.folderLikes(), '用系统终端打开');
	if (!uri) {
		return;
	}
	const outcome = await launchSystemTerminal(kind, uri.fsPath);
	if (!outcome.ok) {
		void vscode.window.showWarningMessage(`打开系统终端失败：${outcome.message}`);
	}
}

async function refreshCommand(deps: CommandDeps): Promise<void> {
	await deps.provider.reload(true);
}

/**
 * 「对比浏览」：左右两个树浏览面板。默认位置由 ComparePanel 按平台计算，
 * 下拉候选里会实时带上当前自定义资源管理树的文件夹节点。
 */
async function compareBrowseCommand(deps: CommandDeps): Promise<void> {
	await ComparePanel.open(deps.context, deps.provider);
}

async function exportCommand(deps: CommandDeps): Promise<void> {
	const first = vscode.workspace.workspaceFolders?.[0];
	const target = await vscode.window.showSaveDialog({
		title: '导出自定义资源管理',
		filters: { JSON: ['json'] },
		defaultUri: first ? vscode.Uri.joinPath(first.uri, 'wispkit-resource-tree.json') : undefined,
		saveLabel: '导出',
	});
	if (!target) {
		return;
	}
	try {
		await writeTextAtomically(target, serializeStore(deps.provider.getStore()));
	} catch (error) {
		void vscode.window.showErrorMessage(`导出失败：${errorText(error)}`);
		return;
	}
	void vscode.window.showInformationMessage(`资源树已导出到 ${vscode.workspace.asRelativePath(target, false)}。`);
}

async function importCommand(deps: CommandDeps): Promise<void> {
	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		title: '导入自定义资源管理 JSON',
		filters: { JSON: ['json'] },
		openLabel: '导入',
	});
	if (!picked || picked.length === 0) {
		return;
	}
	const source = picked[0];
	let text: string;
	try {
		text = decodeStoreText(await vscode.workspace.fs.readFile(source));
	} catch (error) {
		void vscode.window.showErrorMessage(`读取导入文件失败：${errorText(error)}`);
		return;
	}
	const plan = planImport(text, countStoreNodes(deps.provider.getStore()));
	if (!plan.ok || !plan.store) {
		// 解析失败时在确认框之前就返回：当前树完全不动。
		void vscode.window.showErrorMessage(`导入失败：${plan.error ?? '文件内容无法解析。'}`);
		return;
	}
	if (plan.warningMessage) {
		// 先让用户看到修复说明，再弹替换确认。
		await vscode.window.showWarningMessage(plan.warningMessage);
	}
	const answer = await vscode.window.showWarningMessage(
		plan.confirmMessage ?? '',
		{ modal: true },
		'导入并替换',
	);
	if (answer !== '导入并替换') {
		return;
	}
	if (await deps.provider.replaceStore(plan.store)) {
		void vscode.window.showInformationMessage(`资源树已导入：${plan.nodeCount} 个节点。`);
	}
}

/**
 * 「打开资源树 JSON」：
 *   - 配置无效 / 无工作区 → 明确提示；
 *   - 路径是目录 → 拒绝并说明；
 *   - 文件不存在 → 先写当前树（初次使用时就是空树）再打开；
 *   - 只读 / 被占用 → 打开前提示，打开失败则给出具体错误；
 *   - 不会因为打不开而改动已有文件。
 */
async function openStorageCommand(deps: CommandDeps): Promise<void> {
	const resolution = currentStorageResolution();
	if (!resolution.uri) {
		void vscode.window.showWarningMessage(resolution.error ?? '当前没有打开工作区文件夹。');
		return;
	}
	const uri = resolution.uri;
	let stat: vscode.FileStat | undefined;
	try {
		stat = await vscode.workspace.fs.stat(uri);
	} catch (error) {
		if (!isFileNotFound(error)) {
			void vscode.window.showErrorMessage(`无法访问资源树文件：${errorText(error)}`);
			return;
		}
	}
	if (stat && (stat.type & vscode.FileType.Directory)) {
		void vscode.window.showErrorMessage(`资源树路径是一个目录，无法打开：${uri.fsPath || uri.toString()}`);
		return;
	}
	if (!stat) {
		try {
			await writeStore(uri, deps.provider.getStore());
			deps.provider.markPersisted();
		} catch (error) {
			void vscode.window.showErrorMessage(`无法创建资源树文件：${errorText(error)}`);
			return;
		}
	} else if (uri.scheme === 'file') {
		try {
			fs.accessSync(uri.fsPath, fs.constants.W_OK);
		} catch {
			void vscode.window.showWarningMessage('资源树文件当前不可写（只读或被占用）：可以查看，但保存修改会失败。');
		}
	}
	try {
		await vscode.window.showTextDocument(uri, { preview: false });
	} catch (error) {
		void vscode.window.showErrorMessage(`无法打开资源树 JSON：${errorText(error)}`);
	}
}

export function registerResourceTree(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new ResourceTreeProvider();
	const view = vscode.window.createTreeView(RESOURCE_TREE_VIEW_TYPE, {
		treeDataProvider: provider,
		dragAndDropController: provider,
		showCollapseAll: true,
	});
	provider.attachView(view);

	const deps: CommandDeps = { provider, view, context };
	const disposables: vscode.Disposable[] = [
		view,
		provider,
		vscode.commands.registerCommand('wispkit.resourceTree.addGroup', run((arg?: unknown) => addGroupCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.addFolder', run((arg?: unknown) => addFolderCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.addFolderFromExplorer', run((...args: unknown[]) => addFolderFromExplorerCommand(deps, ...args))),
		vscode.commands.registerCommand('wispkit.resourceTree.rename', run((arg?: unknown) => renameCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.remove', run((arg?: unknown) => removeCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.moveTo', run((arg?: unknown) => moveToCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.moveUp', run((arg?: unknown) => moveUpCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.moveDown', run((arg?: unknown) => moveDownCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.openFolder', run((arg?: unknown) => openFolderCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.openTerminal', run((arg?: unknown) => openTerminalCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.copyPath', run((arg?: unknown) => copyPathCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.openInVSCode', run((arg?: unknown) => openInVSCodeCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.openInSystemExplorer', run((arg?: unknown) => openInSystemExplorerCommand(deps, arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.systemTerminal.cmd', run((arg?: unknown) => systemTerminalCommand(deps, 'windows-cmd', arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.systemTerminal.powerShell', run((arg?: unknown) => systemTerminalCommand(deps, 'windows-powershell', arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.systemTerminal.cmdAdmin', run((arg?: unknown) => systemTerminalCommand(deps, 'windows-cmd-admin', arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.systemTerminal.powerShellAdmin', run((arg?: unknown) => systemTerminalCommand(deps, 'windows-powershell-admin', arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.systemTerminal.terminalApp', run((arg?: unknown) => systemTerminalCommand(deps, 'macos-terminal', arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.systemTerminal.linux', run((arg?: unknown) => systemTerminalCommand(deps, 'linux-terminal', arg))),
		vscode.commands.registerCommand('wispkit.resourceTree.refresh', run(() => refreshCommand(deps))),
		vscode.commands.registerCommand('wispkit.resourceTree.compareBrowse', run(() => compareBrowseCommand(deps))),
		vscode.commands.registerCommand('wispkit.resourceTree.export', run(() => exportCommand(deps))),
		vscode.commands.registerCommand('wispkit.resourceTree.import', run(() => importCommand(deps))),
		vscode.commands.registerCommand('wispkit.resourceTree.openStorage', run(() => openStorageCommand(deps))),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('wispkit.resourceTree.file')) {
				// 改设置后立即切到新文件，并告诉用户读到了多少节点（或文件不存在）。
				void provider.reload(true);
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void provider.reload(false);
		}),
	];

	void provider.initialize();
	return vscode.Disposable.from(...disposables);
}
