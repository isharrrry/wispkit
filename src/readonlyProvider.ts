import * as vscode from 'vscode';
import { allowNativeOpen, closeCustomTabsFor, READONLY_VIEW_TYPE } from './readonly/intercept';
import { readTextPrefix, type ReadonlyPreview } from './readonly/file';
import { renderReadonlyPage } from './readonly/page';
import { strictContentSecurityPolicy } from './util/csp';
import { generateNonce } from './util/nonce';

interface ReadonlyDocument extends vscode.CustomDocument {
	readonly preview: ReadonlyPreview;
}

/**
 * 只读小段预览（`wispkit.text`）。
 * 用 `CustomEditorProvider` 而不是 `CustomTextEditorProvider`：**不创建 TextDocument**，
 * 只读文件头若干字节 —— 大文件不会整份进内存，这才是"省渲染开销"的实质。
 */
export class ReadonlyEditorProvider implements vscode.CustomEditorProvider<ReadonlyDocument> {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			READONLY_VIEW_TYPE,
			new ReadonlyEditorProvider(context),
			{
				// 只读预览不值得为"隐藏后保活"付内存
				webviewOptions: { retainContextWhenHidden: false },
				supportsMultipleEditorsPerDocument: true,
			},
		);
	}

	private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ReadonlyDocument>>();
	public readonly onDidChangeCustomDocument = this.changeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	public async openCustomDocument(uri: vscode.Uri): Promise<ReadonlyDocument> {
		const config = vscode.workspace.getConfiguration('wispkit');
		const maxBytes = config.get<number>('readonly.previewBytes', 65536);
		const maxLines = config.get<number>('readonly.previewLines', 800);

		const preview = await readTextPrefix(uri.fsPath, maxBytes, maxLines);
		return {
			uri,
			preview,
			dispose: () => {
				// 只读，没有需要释放的资源
			},
		};
	}

	public async resolveCustomEditor(
		document: ReadonlyDocument,
		panel: vscode.WebviewPanel,
	): Promise<void> {
		const webview = panel.webview;
		const nonce = generateNonce();

		webview.options = {
			enableScripts: true,
			enableForms: false,
			localResourceRoots: [this.context.extensionUri],
		};

		webview.html = renderReadonlyPage({
			title: document.uri.path.split('/').pop() ?? 'Text',
			csp: strictContentSecurityPolicy(webview.cspSource, nonce),
			nonce,
			text: document.preview.text,
			totalBytes: document.preview.totalBytes,
			shownLines: document.preview.shownLines,
			truncated: document.preview.truncated,
			runtimeScript: this.resource(webview, 'media', 'dist', 'readonly.js'),
			runtimeStyle: this.resource(webview, 'media', 'readonly.css'),
		});

		panel.webview.onDidReceiveMessage(message => {
			if (message?.type === 'wispkit.unlock') {
				void this.unlock(document.uri);
			}
		});
	}

	/** 解锁 = 这一份文件按正常方式打开（回到 VS Code 原生编辑器，可编辑）。 */
	private async unlock(uri: vscode.Uri): Promise<void> {
		// 先登记白名单，否则拦截器会立刻把它换回只读视图
		allowNativeOpen(uri);
		await vscode.commands.executeCommand('vscode.openWith', uri, 'default', vscode.ViewColumn.Active);
		await closeCustomTabsFor(uri, READONLY_VIEW_TYPE);
	}

	private resource(webview: vscode.Webview, ...parts: string[]): string {
		return webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts)).toString();
	}

	public async saveCustomDocument(): Promise<void> {
		// 只读
	}

	public async saveCustomDocumentAs(document: ReadonlyDocument, destination: vscode.Uri): Promise<void> {
		await vscode.commands.executeCommand('vscode.open', destination);
	}

	public async revertCustomDocument(): Promise<void> {
		// 只读
	}

	public async backupCustomDocument(
		document: ReadonlyDocument,
		context: vscode.CustomDocumentBackupContext,
	): Promise<vscode.CustomDocumentBackup> {
		return {
			id: context.destination.toString(),
			delete: () => {
				// 只读预览没有备份内容
			},
		};
	}
}
