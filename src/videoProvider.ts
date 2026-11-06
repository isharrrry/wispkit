import * as vscode from 'vscode';
import { videoContentSecurityPolicy } from './media/csp';
import { fileExtension } from './media/formats';
import { collectMediaResourceRoots, handleMediaHostMessage } from './media/webview';
import { generateNonce } from './util/nonce';
import { renderVideoPage } from './video/page';

export { videoContentSecurityPolicy } from './media/csp';

export const VIDEO_VIEW_TYPE = 'wispkit.video';

/**
 * 视频是二进制：与图片视图一样用只读 `CustomEditorProvider`，
 * 页面只放一个原生 `<video>`，不打包播放器、不引入解码依赖。
 */
export class VideoEditorProvider implements vscode.CustomEditorProvider<vscode.CustomDocument> {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			VIDEO_VIEW_TYPE,
			new VideoEditorProvider(context),
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

		webview.html = renderVideoPage({
			title: document.uri.path.split('/').pop() ?? 'Video',
			csp: videoContentSecurityPolicy(cspSource, nonce),
			nonce,
			videoSrc: webview.asWebviewUri(document.uri).toString(),
			runtimeScript: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'video.js')).toString(),
			runtimeStyle: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'video.css')).toString(),
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

