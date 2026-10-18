import * as vscode from 'vscode';
import { readMarkdownPreviewTypography, readMarkdownViewConfig } from './config';
import { collectMarkdownContributions, hasMarkdownPreviewResources } from './markdown/contributions';
import { renderMarkdownPage } from './markdown/page';
import { renderMarkdownHtml } from './markdown/render';
import { runMediaAction, type MediaRequest } from './mediaActions';
import { strictContentSecurityPolicy } from './util/csp';
import { escapeHtml } from './util/html';
import { generateNonce } from './util/nonce';

export const MARKDOWN_VIEW_TYPE = 'wispkit.markdown';

const UPDATE_DEBOUNCE_MS = 200;

/**
 * 内置 markdown-language-features 的 `media/index.js` 是**它自己那套预览页面**的入口：
 * 一加载就去读页面里的 `#vscode-markdown-preview-data`（我们的页面没有这个元素），
 * 抛错后它的能力一个也用不上，只剩控制台报错（实测：`Could not load data for data-settings`）。
 * 它的样式要保留 —— 正文排版用的就是它们。
 */
const INTERNAL_PREVIEW_EXTENSION_ID = 'vscode.markdown-language-features';

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {

	public register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			MARKDOWN_VIEW_TYPE,
			this,
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
			// 预览里的 `vscode://file/...` 被改写成 `command:vscode.open`；第三方预览脚本
			// （例如 drawio 的"编辑"按钮）也用 command: 链接。不开这一项，它们点了毫无反应。
			enableCommandUris: true,
			localResourceRoots: collectLocalResourceRoots(this.context, document.uri),
		};

		/** 用任意文本渲染（编辑模式拿的是编辑区内容，不是磁盘内容）。 */
		const renderText = async (text: string): Promise<string> => {
			const result = await renderMarkdownHtml(
				text,
				(command, ...args) => vscode.commands.executeCommand(command, ...args),
				{ uri: document.uri, getText: () => text },
			);
			return result.html || this.renderRenderError(result.error);
		};

		webview.html = this.buildPage(webview, document, await renderText(document.getText()));

		const messageSubscription = webview.onDidReceiveMessage(async message => {
			switch (message?.type) {
				case 'wispkit.requestSource':
					void webview.postMessage({ type: 'wispkit.source', text: document.getText() });
					break;
				case 'wispkit.render':
					void webview.postMessage({
						type: 'wispkit.rendered',
						requestId: message.requestId,
						html: await renderText(typeof message.text === 'string' ? message.text : ''),
					});
					break;
				case 'wispkit.save':
					try {
						await this.saveText(document, typeof message.text === 'string' ? message.text : '');
						void webview.postMessage({ type: 'wispkit.saveResult', requestId: message.requestId, ok: true });
					} catch (error) {
						void webview.postMessage({
							type: 'wispkit.saveResult',
							requestId: message.requestId,
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
					break;
				case 'wispkit.media':
					void this.handleMediaMessage(document, message);
					break;
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
			timer = setTimeout(() => {
				void renderText(document.getText()).then(bodyHtml => webview.postMessage({
					type: 'wispkit.update',
					bodyHtml,
					source: document.getText(),
					config: readMarkdownViewConfig(),
				}));
			}, UPDATE_DEBOUNCE_MS);
		});

		const configSubscription = vscode.workspace.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration('wispkit')) {
				return;
			}
			void webview.postMessage({ type: 'wispkit.config', config: readMarkdownViewConfig() });
		});

		webviewPanel.onDidDispose(() => {
			if (timer) {
				clearTimeout(timer);
			}
			changeSubscription.dispose();
			configSubscription.dispose();
			messageSubscription.dispose();
		});
	}

	private buildPage(webview: vscode.Webview, document: vscode.TextDocument, bodyHtml: string): string {
		const nonce = generateNonce();
		const contributions = collectMarkdownContributions(vscode.extensions.all.map(extension => ({
			packageJson: extension.packageJSON,
			extensionUri: extension.extensionUri.toString(),
			id: extension.id,
		})));
		const scripts = contributions.scripts.filter(script => script.extensionId !== INTERNAL_PREVIEW_EXTENSION_ID);

		return renderMarkdownPage({
			title: document.uri.path.split('/').pop() ?? 'Markdown',
			csp: strictContentSecurityPolicy(webview.cspSource, nonce),
			nonce,
			baseHref: this.tryAsWebviewUri(webview, document.uri),
			contributionStyles: contributions.styles.map(style => this.asWebviewUri(webview, style.extensionUri, style.path)),
			contributionScripts: scripts.map(script => ({
				src: this.asWebviewUri(webview, script.extensionUri, script.path),
				type: script.type,
			})),
			runtimeScript: this.extensionResource(webview, 'media', 'dist', 'markdown.js'),
			runtimeStyle: this.extensionResource(webview, 'media', 'markdown.css'),
			bodyHtml,
			config: readMarkdownViewConfig(),
			typography: readMarkdownPreviewTypography(),
		});
	}

	private asWebviewUri(webview: vscode.Webview, extensionUri: string, resourcePath: string): string {
		return webview.asWebviewUri(vscode.Uri.joinPath(vscode.Uri.parse(extensionUri), resourcePath)).toString();
	}

	private extensionResource(webview: vscode.Webview, ...parts: string[]): string {
		return webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts)).toString();
	}

	private tryAsWebviewUri(webview: vscode.Webview, uri: vscode.Uri): string | undefined {
		try {
			return webview.asWebviewUri(uri).toString();
		} catch {
			// untitled: 之类没有磁盘位置的文档
			return undefined;
		}
	}

	private renderRenderError(error: string | undefined): string {
		return `<div class="wispkit-render-error"><p>Wispkit 无法渲染该文档。</p><pre>${escapeHtml(error ?? '未知错误')}</pre></div>`;
	}

	/** 编辑模式的落盘：整篇替换，走 WorkspaceEdit 以便进入正常的撤销栈。 */
	private async saveText(document: vscode.TextDocument, text: string): Promise<void> {
		const current = document.getText();
		if (current === text) {
			return;
		}

		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(current.length)), text);
		if (!await vscode.workspace.applyEdit(edit)) {
			throw new Error('VS Code 拒绝写入该文件（可能只读或已被外部修改）');
		}
	}

	private async handleMediaMessage(document: vscode.TextDocument, message: Record<string, unknown>): Promise<void> {
		const request: MediaRequest = {
			action: message.action as MediaRequest['action'],
			kind: message.kind as MediaRequest['kind'],
			index: typeof message.index === 'number' ? message.index : 0,
			alt: typeof message.alt === 'string' ? message.alt : undefined,
			src: typeof message.src === 'string' ? message.src : undefined,
			data: typeof message.data === 'string' ? message.data : undefined,
		};

		try {
			const result = await runMediaAction(document, request, {
				storageDir: this.context.storageUri ?? this.context.globalStorageUri,
				subscriptions: this.context.subscriptions,
			});
			if (result.message) {
				void (result.ok
					? vscode.window.showInformationMessage(result.message)
					: vscode.window.showWarningMessage(result.message));
			}
		} catch (error) {
			void vscode.window.showWarningMessage(`Wispkit 操作失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

function collectLocalResourceRoots(context: vscode.ExtensionContext, documentUri: vscode.Uri): vscode.Uri[] {
	const roots: vscode.Uri[] = [context.extensionUri];

	try {
		roots.push(vscode.Uri.joinPath(documentUri, '..'));
	} catch {
		// untitled: 等没有父目录的 scheme
	}

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		roots.push(folder.uri);
	}

	for (const extension of vscode.extensions.all) {
		if (hasMarkdownPreviewResources(extension.packageJSON)) {
			roots.push(extension.extensionUri);
		}
	}

	return roots;
}
