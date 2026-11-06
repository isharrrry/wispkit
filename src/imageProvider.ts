import * as vscode from 'vscode';
import { readImageViewConfig } from './config';
import { renderImagePage } from './image/page';
import { imageContentSecurityPolicy } from './media/csp';
import { fileExtension } from './media/formats';
import { collectMediaResourceRoots, handleMediaHostMessage } from './media/webview';
import { generateNonce } from './util/nonce';

export { imageContentSecurityPolicy } from './media/csp';

export const IMAGE_VIEW_TYPE = 'wispkit.image';

/**
 * 图片是二进制：用 `CustomEditorProvider`（只读）而不是 `CustomTextEditorProvider`，
 * 后者要求 VS Code 能把文件当文本打开。
 */
export class ImageEditorProvider implements vscode.CustomEditorProvider<vscode.CustomDocument> {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			IMAGE_VIEW_TYPE,
			new ImageEditorProvider(context),
			{
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: true,
			},
		);
	}

	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
	public readonly onDidChangeCustomDocument = this.onDidChangeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return {
			uri,
			dispose: () => {
				// 只读视图，没有需要释放的资源
			},
		};
	}

	public async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
	): Promise<void> {
		const webview = webviewPanel.webview;
		const nonce = generateNonce();
		const cspSource = webview.cspSource;

		webview.options = {
			enableScripts: true,
			enableForms: false,
			localResourceRoots: collectMediaResourceRoots(this.context, document.uri),
		};

		webview.onDidReceiveMessage(message => {
			handleMediaHostMessage(document.uri, message);
		});

		webview.html = renderImagePage({
			title: document.uri.path.split('/').pop() ?? 'Image',
			csp: imageContentSecurityPolicy(cspSource, nonce),
			nonce,
			imageSrc: webview.asWebviewUri(document.uri).toString(),
			runtimeScript: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'image.js')).toString(),
			runtimeStyle: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'image.css')).toString(),
			config: readImageViewConfig(),
			format: fileExtension(document.uri.path),
		});
	}

	public async saveCustomDocument(_document: vscode.CustomDocument): Promise<void> {
		// 只读
	}

	public async saveCustomDocumentAs(document: vscode.CustomDocument, destination: vscode.Uri): Promise<void> {
		await vscode.commands.executeCommand('vscode.open', destination);
	}

	public async revertCustomDocument(_document: vscode.CustomDocument): Promise<void> {
		// 只读
	}

	public async backupCustomDocument(
		document: vscode.CustomDocument,
		context: vscode.CustomDocumentBackupContext,
	): Promise<vscode.CustomDocumentBackup> {
		return {
			id: context.destination.toString(),
			delete: () => {
				// 只读视图没有备份内容需要删除
			},
		};
	}
}

/**
 * 图片本体放在工作区里，不在扩展目录下。`asWebviewUri` 生成的地址只有在
 * localResourceRoots 覆盖到它时才会被 webview 放行 —— 只写 extensionUri 会让
 * 整页空白（图被拒载）。父目录覆盖同目录引用，工作区目录覆盖跨目录引用。
 */
export const collectImageResourceRoots = collectMediaResourceRoots;

