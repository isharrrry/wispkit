import * as vscode from 'vscode';
import { enumerateStorageNodes } from './storage/enumerate';
import {
	isStorageDevice,
	isStorageInfo,
	isStorageMount,
	makeInfoNode,
	type StorageDeviceKind,
	type StorageNode,
} from './storage/model';

/**
 * 活动栏「自定义资源管理」下方的「存储器」区域。
 *
 * 默认收纳（package.json 里 `visibility: "collapsed"`），展开时才枚举系统存储器，
 * 避免每次启动都拉起 PowerShell。设备下面一层是分区或挂载点；挂载点节点的形状
 * 与资源树 folder 节点一致，因此「浏览 / 复制路径 / 终端 / VS Code / 系统资源管理器」
 * 这些命令和右键菜单直接复用，无需单独实现一套。
 */

export const STORAGE_VIEW_TYPE = 'wispkit.storage';

/** 存储器列表变化不频繁；展开一次后短时间内重复展开直接复用缓存。 */
const CACHE_TTL_MS = 30_000;

/** 枚举失败的信息行 id（refresh 用它判断是否要提示失败）。 */
const STORAGE_ERROR_ID = 'storage:error';

const KIND_ICON: Record<StorageDeviceKind, string> = {
	disk: 'database',
	removable: 'plug',
	network: 'remote',
	optical: 'disc',
	other: 'circle-slash',
};

export class StorageTreeProvider implements vscode.TreeDataProvider<StorageNode>, vscode.Disposable {
	public static readonly viewType = STORAGE_VIEW_TYPE;

	private roots: StorageNode[] | undefined;
	private loadedAt = 0;
	private loading: Promise<StorageNode[]> | undefined;
	private loadToken = 0;
	private view: vscode.TreeView<StorageNode> | undefined;
	private disposed = false;
	private readonly emitter = new vscode.EventEmitter<StorageNode | undefined | void>();

	readonly onDidChangeTreeData = this.emitter.event;

	public attachView(view: vscode.TreeView<StorageNode>): void {
		this.view = view;
	}

	// ── TreeDataProvider ────────────────────────────────────────────────

	public getTreeItem(element: StorageNode): vscode.TreeItem {
		if (isStorageDevice(element)) {
			const item = new vscode.TreeItem(
				element.name,
				element.children.length > 0
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None,
			);
			item.id = element.id;
			item.contextValue = 'wispkitStorageDevice';
			item.iconPath = new vscode.ThemeIcon(KIND_ICON[element.kind]);
			item.description = element.description;
			item.tooltip = element.tooltip;
			return item;
		}

		if (isStorageMount(element)) {
			// 与资源树 folder 节点同样的外观和单击命令；右键菜单在 package.json
			// 里用同一批命令另行声明（viewItem == wispkitStorageMount）。
			const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
			item.id = element.id;
			item.contextValue = 'wispkitStorageMount';
			item.iconPath = new vscode.ThemeIcon('folder');
			item.description = element.sizeText;
			item.tooltip = element.tooltipText;
			item.command = {
				command: 'wispkit.resourceTree.openFolder',
				title: '浏览文件夹',
				arguments: [element],
			};
			return item;
		}

		const failed = element.id === STORAGE_ERROR_ID;
		const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
		item.id = element.id;
		item.contextValue = 'wispkitStorageInfo';
		item.iconPath = failed
			? new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'))
			: new vscode.ThemeIcon('info');
		item.description = element.description;
		item.tooltip = element.tooltip;
		return item;
	}

	public getChildren(element?: StorageNode): StorageNode[] | Promise<StorageNode[]> {
		if (element) {
			return isStorageDevice(element) ? [...element.children] : [];
		}
		return this.load(false);
	}

	// ── 加载 / 刷新 ─────────────────────────────────────────────────────

	/**
	 * 只在需要时枚举；枚举失败也返回一条信息行而不是抛错。
	 *
	 * 抛出 Promise 异常会让 VS Code 在视图里只显示通用的 "Loading..." 错误，
	 * 用户看不到 PowerShell / 挂载表到底出了什么问题。
	 */
	private load(force: boolean): Promise<StorageNode[]> {
		if (!force && this.roots && Date.now() - this.loadedAt < CACHE_TTL_MS) {
			return Promise.resolve(this.roots);
		}
		if (!force && this.loading) {
			return this.loading;
		}
		const token = ++this.loadToken;
		const promise = enumerateStorageNodes()
			.then((devices): StorageNode[] => {
				if (token !== this.loadToken) {
					return this.roots ?? devices;
				}
				const nodes: StorageNode[] = devices.length > 0
					? devices
					: [makeInfoNode(
						'storage:empty',
						'未检测到存储器',
						'系统没有返回可用的磁盘或挂载点',
						'可能是权限不足、运行在容器中，或系统没有任何已挂载的卷。',
					)];
				this.roots = nodes;
				this.loadedAt = Date.now();
				this.updateViewState(devices.length);
				return nodes;
			})
			.catch((error: unknown): StorageNode[] => {
				const message = error instanceof Error ? error.message : String(error);
				console.error('[wispkit-storage] 枚举存储器失败：', error);
				if (token === this.loadToken) {
					this.roots = [makeInfoNode(
						STORAGE_ERROR_ID,
						'无法读取系统存储器',
						'点击标题栏的刷新按钮重试',
						message,
					)];
					this.loadedAt = Date.now();
					this.updateViewState(0, message);
				}
				return this.roots ?? [];
			});
		this.loading = promise;
		void promise.finally(() => {
			if (this.loading === promise) {
				this.loading = undefined;
			}
		});
		return promise;
	}

	/** 「刷新存储器」：强制重新枚举（不弹确认，也不需要工作区）。 */
	public async refresh(notify: boolean): Promise<void> {
		this.loadToken += 1;
		this.roots = undefined;
		this.loading = undefined;
		this.loadedAt = 0;
		if (this.view?.visible) {
			this.fire();
		}
		const nodes = await this.load(true);
		this.fire();
		if (notify) {
			const devices = nodes.filter(isStorageDevice).length;
			if (nodes.some(node => isStorageInfo(node) && node.id === STORAGE_ERROR_ID)) {
				// 错误细节已经在视图正文里；这里只提示去查看，不重复长文案。
				void vscode.window.showWarningMessage('刷新存储器失败，详情见「存储器」视图正文。');
				return;
			}
			void vscode.window.showInformationMessage(`存储器已刷新：${devices} 个设备。`);
		}
	}

	/** 视图重新可见：缓存过期就静默刷新，兼顾 U 盘热插拔。 */
	public refreshIfStale(): void {
		if (!this.roots || Date.now() - this.loadedAt >= CACHE_TTL_MS) {
			void this.refresh(false);
		}
	}

	private updateViewState(deviceCount: number, error?: string): void {
		if (!this.view) {
			return;
		}
		this.view.message = error ? `无法读取系统存储器：${error}` : undefined;
		this.view.description = error
			? undefined
			: deviceCount > 0 ? `${deviceCount} 个设备` : undefined;
	}

	private fire(): void {
		if (!this.disposed) {
			this.emitter.fire();
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.loadToken += 1;
		this.emitter.dispose();
	}
}

export function registerStorageView(): vscode.Disposable {
	const provider = new StorageTreeProvider();
	const view = vscode.window.createTreeView(STORAGE_VIEW_TYPE, {
		treeDataProvider: provider,
		showCollapseAll: true,
	});
	provider.attachView(view);

	return vscode.Disposable.from(
		view,
		provider,
		view.onDidChangeVisibility(event => {
			if (event.visible) {
				provider.refreshIfStale();
			}
		}),
		vscode.commands.registerCommand('wispkit.storage.refresh', () => {
			void provider.refresh(true).catch(error => {
				console.error('[wispkit-storage] 刷新失败：', error);
				void vscode.window.showErrorMessage(`刷新存储器失败：${error instanceof Error ? error.message : String(error)}`);
			});
		}),
	);
}
