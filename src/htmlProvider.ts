import * as vscode from 'vscode';
import { buildHtmlFromSource } from './html/page';
import { openWebviewLinkSafely } from './util/linkOpen';

export const HTML_VIEW_TYPE = 'wispkit.html';

/**
 * HTML 浏览视图 = 原样渲染 + 两处小手术：
 * 1. `vscode://file/<路径>:<行号>` → `command:vscode.open?...`，配合 `enableCommandUris`
 *    让点击在**当前窗口**打开目标文件并定位行号；
 * 2. 注入 `<base href="<文档的 webview uri>">`，让相对路径的 css/js/图片能加载。
 *
 * 前端 0 行脚本：点击上报由 webview 外壳完成，扩展侧只要放行 scheme。
 */
export class HtmlEditorProvider implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			HTML_VIEW_TYPE,
			new HtmlEditorProvider(context),
			{
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: true,
			},
		);
	}

	constructor(private readonly context: vscode.ExtensionContext) { }

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const webview = webviewPanel.webview;

		webview.options = {
			enableScripts: true,
			enableForms: false,
			// 关键开关：宿主的 isSupportedLink 只在它为真时才放行 `command:` 链接。
			enableCommandUris: true,
			localResourceRoots: collectLocalResourceRoots(this.context, document.uri),
		};

		const scriptSrc = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'html.js'),
		).toString();

		const update = () => {
			let baseHref: string | undefined;
			try {
				baseHref = webview.asWebviewUri(document.uri).toString();
			} catch {
				baseHref = undefined;
			}
			webview.html = buildHtmlFromSource(document.getText(), {
				baseHref,
				cspSource: webview.cspSource,
				scriptSrc,
			});
		};
		update();

		const messageSubscription = webview.onDidReceiveMessage(message => {
			if (message?.type === 'wispkit.openLink' && typeof message.href === 'string') {
				void openWebviewLinkSafely(document.uri, message.href);
			}
		});

		let timer: ReturnType<typeof setTimeout> | undefined;
		const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(update, 200);
		});

		webviewPanel.onDidDispose(() => {
			if (timer) {
				clearTimeout(timer);
			}
			changeSubscription.dispose();
			messageSubscription.dispose();
		});
	}
}

function collectLocalResourceRoots(context: vscode.ExtensionContext, documentUri: vscode.Uri): vscode.Uri[] {
	const roots: vscode.Uri[] = [context.extensionUri];
	try {
		roots.push(vscode.Uri.joinPath(documentUri, '..'));
	} catch {
		// untitled: 等
	}
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		roots.push(folder.uri);
	}
	return roots;
}
