import * as vscode from 'vscode';
import * as path from 'node:path';
import { renderGraph3dPage, type Graph3dPayload } from './graph3d/page';
import { attachNodeImages, type NodeImageIO } from './graph3d/nodeImages';
import { extractElementsForSource, graphSourceKind } from './graph3d/sources';
import type { GraphElement } from './graph3d/types';
import { strictContentSecurityPolicy } from './util/csp';
import { generateNonce } from './util/nonce';

/**
 * 「3D 可视化浏览」面板。
 *
 * 入口是资源管理器里 Markdown（`.md` / `.markdown`）与独立 Mermaid 文件
 * （`.mmd` / `.mermaid`）的右键菜单。宿主只负责读文件 / 解析 / 把图元素数据
 * 交给 webview；布局与 three.js 渲染全在前端（`media/graph3d.js`）。
 * 同一个文件重复打开只 reveal，不叠新面板。
 */

export const GRAPH3D_VIEW_TYPE = 'wispkit.graph3d';
export const GRAPH3D_OPEN_COMMAND = 'wispkit.graph3d.open';

function baseName(uri: vscode.Uri): string {
	const name = uri.path.split('/').pop() ?? uri.fsPath.split(/[\\/]/).pop() ?? 'Markdown';
	return name || 'Markdown';
}

function fallbackName(uri: vscode.Uri): string {
	const fsPath = uri.fsPath || uri.path;
	return path.basename(fsPath, path.extname(fsPath));
}

function payloadFor(uri: vscode.Uri, elements: readonly GraphElement[]): Graph3dPayload {
	return {
		fileName: baseName(uri),
		filePath: uri.scheme === 'file' ? uri.fsPath : uri.toString(),
		elements,
	};
}

/**
 * 图片解析用的文件系统：绝对路径（例如用户示例里的 `F:\…\Atlantis(1).png`）
 * 走 `vscode.Uri.file`，相对路径基于当前 Markdown / Mermaid 文件所在目录。
 */
function imageIOFor(uri: vscode.Uri): NodeImageIO {
	const fallback = uri.scheme === 'file' ? uri.fsPath : uri.path;
	return {
		baseDir: path.dirname(fallback),
		async stat(fsPath: string) {
			try {
				const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
				return stat.type === vscode.FileType.File ? { size: stat.size } : undefined;
			} catch {
				return undefined;
			}
		},
		async read(fsPath: string) {
			try {
				return await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
			} catch {
				return undefined;
			}
		},
	};
}

/** 解析图元素，并把「Markdown 链接 → 图片」的节点挂上 data URL。 */
async function loadElements(uri: vscode.Uri, text: string): Promise<GraphElement[]> {
	const kind = graphSourceKind(uri.fsPath || uri.path);
	if (!kind) {
		throw new Error('只支持 Markdown（.md / .markdown）与 Mermaid（.mmd / .mermaid）文件');
	}
	const elements = extractElementsForSource(kind, text, fallbackName(uri));
	return await attachNodeImages(elements, imageIOFor(uri));
}

class Graph3dPanel {
	private disposed = false;

	public static async create(
		context: vscode.ExtensionContext,
		uri: vscode.Uri,
	): Promise<Graph3dPanel | undefined> {
		const kind = graphSourceKind(uri.fsPath || uri.path);
		if (!kind) {
			throw new Error('只支持 Markdown（.md / .markdown）与 Mermaid（.mmd / .mermaid）文件');
		}
		const text = await vscode.workspace.openTextDocument(uri).then(document => document.getText());
		const elements = await loadElements(uri, text);
		const panel = vscode.window.createWebviewPanel(
			GRAPH3D_VIEW_TYPE,
			`3D：${baseName(uri)}`,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri],
			},
		);
		const instance = new Graph3dPanel(context, uri, panel, elements);
		return instance;
	}

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly uri: vscode.Uri,
		private readonly panel: vscode.WebviewPanel,
		private elements: readonly GraphElement[],
	) {
		this.panel.webview.html = this.buildHtml();
		this.updateTitle();
		this.panel.webview.onDidReceiveMessage(message => void this.handleMessage(message));
		this.panel.onDidDispose(() => {
			this.disposed = true;
			Graph3dPanels.remove(this.uri);
		});
	}

	public reveal(): void {
		if (!this.disposed) {
			this.panel.reveal(vscode.ViewColumn.Active);
		}
	}

	private buildHtml(): string {
		const webview = this.panel.webview;
		const nonce = generateNonce();
		return renderGraph3dPage({
			title: `3D 可视化浏览：${baseName(this.uri)}`,
			csp: strictContentSecurityPolicy(webview.cspSource, nonce),
			nonce,
			runtimeScript: webview.asWebviewUri(
				vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'graph3d.js'),
			).toString(),
			runtimeStyle: webview.asWebviewUri(
				vscode.Uri.joinPath(this.context.extensionUri, 'media', 'graph3d.css'),
			).toString(),
			payload: payloadFor(this.uri, this.elements),
		});
	}

	private updateTitle(): void {
		const count = this.elements.length;
		this.panel.title = `3D：${baseName(this.uri)}${count > 0 ? `（${count}）` : ''}`;
	}

	private async handleMessage(message: unknown): Promise<void> {
		if (!message || typeof message !== 'object') {
			return;
		}
		const record = message as Record<string, unknown>;
		if (record.type !== 'wispkit.graph3d.refresh') {
			return;
		}
		try {
			const kind = graphSourceKind(this.uri.fsPath || this.uri.path);
			if (!kind) {
				throw new Error('只支持 Markdown（.md / .markdown）与 Mermaid（.mmd / .mermaid）文件');
			}
			const document = await vscode.workspace.openTextDocument(this.uri);
			const elements = await loadElements(this.uri, document.getText());
			this.elements = elements;
			this.updateTitle();
			void this.panel.webview.postMessage({
				type: 'wispkit.graph3d.elements',
				elements,
				message: elements.length > 0
					? `已重新解析：${elements.length} 个图元素`
					: kind === 'mermaid'
						? '已重新解析：文件里没有解析出可显示的 Mermaid 节点。'
						: '已重新解析：文档里没有找到 ASCII 树或 Mermaid 图元素。',
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			void this.panel.webview.postMessage({
				type: 'wispkit.graph3d.error',
				message: `刷新失败：${detail}`,
			});
			void vscode.window.showWarningMessage(`Wispkit 3D 刷新失败：${detail}`);
		}
	}
}

/** 每个文件一个面板；重复点右键只 reveal。 */
class Graph3dPanels {
	private static readonly instances = new Map<string, Graph3dPanel>();

	public static async open(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
		const key = uri.toString();
		const existing = Graph3dPanels.instances.get(key);
		if (existing) {
			existing.reveal();
			return;
		}
		const panel = await Graph3dPanel.create(context, uri);
		if (panel) {
			Graph3dPanels.instances.set(key, panel);
		}
	}

	public static remove(uri: vscode.Uri): void {
		Graph3dPanels.instances.delete(uri.toString());
	}
}

function uriFromActiveTab(): vscode.Uri | undefined {
	const active = vscode.window.tabGroups.activeTabGroup.activeTab;
	const input = active?.input as { uri?: vscode.Uri } | undefined;
	return input?.uri;
}

export function registerGraph3d(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand(GRAPH3D_OPEN_COMMAND, async (uri?: vscode.Uri) => {
		const target = uri && typeof uri.fsPath === 'string'
			? uri
			: vscode.window.activeTextEditor?.document.uri ?? uriFromActiveTab();
		if (!target) {
			void vscode.window.showInformationMessage('请先在资源管理器里右键一个 Markdown（.md / .markdown）或 Mermaid（.mmd / .mermaid）文件。');
			return;
		}
		if (!graphSourceKind(target.fsPath || target.path)) {
			void vscode.window.showInformationMessage('「3D 可视化浏览」只支持 Markdown（.md / .markdown）与 Mermaid（.mmd / .mermaid）文件。');
			return;
		}
		try {
			await Graph3dPanels.open(context, target);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Wispkit 无法打开 3D 浏览：${detail}`);
			console.error('[wispkit-3d] open failed:', error);
		}
	});
}
