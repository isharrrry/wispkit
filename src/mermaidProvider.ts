import * as vscode from 'vscode';
import * as path from 'node:path';
import {
	collectMarkdownContributions,
	hasMarkdownPreviewResources,
	type MarkdownContributions,
	type ResolvedPreviewScript,
} from './markdown/contributions';
import { renderMermaidPage, type MermaidPageScript, type MermaidPageStatus } from './mermaid/page';
import { mermaidFileStatus } from './mermaid/status';
import { strictContentSecurityPolicy } from './util/csp';
import { generateNonce } from './util/nonce';

export const MERMAID_VIEW_TYPE = 'wispkit.mermaid';

const UPDATE_DEBOUNCE_MS = 300;

/** 与 Markdown 视图相同：内置预览入口要求它自己的页面数据，直接排除。 */
const INTERNAL_PREVIEW_EXTENSION_ID = 'vscode.markdown-language-features';

const NO_MERMAID_HINT = '没有检测到 VS Code 内置的 Mermaid 预览扩展，当前按源码显示。'
	+ '3D 可视化浏览仍可直接解析这张图；安装带 Mermaid 预览的 VS Code 后重新打开本文件即可看到图形。';

/**
 * `.mmd` / `.mermaid` 文件的浏览视图。
 *
 * 2D 渲染交给 VS Code 内置 Mermaid 预览脚本（`markdown.previewScripts`），
 * 宿主不打包 Mermaid；3D 入口复用 `wispkit.graph3d.open`。没有 Mermaid
 * 预览脚本时退化为源码浏览，工具栏与 3D 入口保持不变。
 */
export class MermaidEditorProvider implements vscode.CustomTextEditorProvider {

	private readonly contributions: MarkdownContributions;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.contributions = collectMarkdownContributions(vscode.extensions.all.map(extension => ({
			packageJson: extension.packageJSON,
			extensionUri: extension.extensionUri.toString(),
			id: extension.id,
		})));
	}

	public register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			MERMAID_VIEW_TYPE,
			this,
			{
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: true,
			},
		);
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const webview = webviewPanel.webview;
		webview.options = {
			enableScripts: true,
			enableForms: false,
			localResourceRoots: this.resourceRoots(),
		};

		let renderedText = document.getText();
		webview.html = this.buildPage(webview, document, renderedText);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				const text = document.getText();
				if (text === renderedText) {
					return;
				}
				renderedText = text;
				const supported = this.hasMermaidPreview();
				void webview.postMessage({
					type: 'wispkit.mmd.update',
					source: text,
					status: toPageStatus(text),
					hint: supported ? undefined : NO_MERMAID_HINT,
				});
			}, UPDATE_DEBOUNCE_MS);
		});

		const messageSubscription = webview.onDidReceiveMessage(async message => {
			const type = message?.type;
			if (type === 'wispkit.mmd.refresh') {
				renderedText = document.getText();
				webview.html = this.buildPage(webview, document, renderedText);
				return;
			}
			if (type === 'wispkit.mmd.openSource') {
				await vscode.window.showTextDocument(document, {
					viewColumn: vscode.ViewColumn.Beside,
					preserveFocus: true,
					preview: false,
				});
				return;
			}
			if (type === 'wispkit.mmd.open3d') {
				await vscode.commands.executeCommand('wispkit.graph3d.open', document.uri);
			}
		});

		webviewPanel.onDidDispose(() => {
			if (timer) {
				clearTimeout(timer);
			}
			changeSubscription.dispose();
			messageSubscription.dispose();
		});
	}

	/** 预览脚本 / 样式来自内置扩展，必须把它们的扩展目录放进 localResourceRoots。 */
	private resourceRoots(): vscode.Uri[] {
		const roots = [this.context.extensionUri];
		for (const extension of vscode.extensions.all) {
			if (hasMarkdownPreviewResources(extension.packageJSON)) {
				roots.push(extension.extensionUri);
			}
		}
		return roots;
	}

	/** 除了内置 Markdown 预览自己的入口脚本，其它预览脚本都可以注入。 */
	private previewScripts(): ResolvedPreviewScript[] {
		return this.contributions.scripts.filter(script => script.extensionId !== INTERNAL_PREVIEW_EXTENSION_ID);
	}

	/**
	 * 是否有可用的 Mermaid 渲染脚本。
	 *
	 * 先看谁贡献了预览脚本（内置扩展 id 稳定为 `vscode.mermaid-markdown-features`，
	 * 路径名不一定含 mermaid），再看设置是否注册 —— 旧版 VS Code 两者都没有时
	 * 退化为源码模式。
	 */
	private hasMermaidPreview(): boolean {
		if (this.previewScripts().some(script =>
			/mermaid/i.test(`${script.extensionId ?? ''} ${script.path}`))) {
			return true;
		}
		return vscode.workspace.getConfiguration().has('markdown-mermaid.languages');
	}

	private buildPage(webview: vscode.Webview, document: vscode.TextDocument, text: string): string {
		const nonce = generateNonce();
		const supported = this.hasMermaidPreview();
		const fsPath = document.uri.scheme === 'file' ? document.uri.fsPath : document.uri.path;
		const fileName = path.basename(fsPath) || 'Mermaid';
		const scripts: MermaidPageScript[] = this.previewScripts().map(script => ({
			src: webview.asWebviewUri(
				vscode.Uri.joinPath(vscode.Uri.parse(script.extensionUri), script.path),
			).toString(),
			type: script.type,
		}));
		const styles = this.contributions.styles.map(style => webview.asWebviewUri(
			vscode.Uri.joinPath(vscode.Uri.parse(style.extensionUri), style.path),
		).toString());

		return renderMermaidPage({
			title: fileName,
			csp: strictContentSecurityPolicy(webview.cspSource, nonce),
			nonce,
			fileName,
			filePath: document.uri.scheme === 'file' ? document.uri.fsPath : document.uri.toString(),
			source: text,
			mode: supported ? 'diagram' : 'source',
			status: toPageStatus(text),
			hint: supported ? undefined : NO_MERMAID_HINT,
			runtimeScript: webview.asWebviewUri(
				vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'mermaid.js'),
			).toString(),
			runtimeStyle: webview.asWebviewUri(
				vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mermaid.css'),
			).toString(),
			contributionStyles: styles,
			contributionScripts: scripts,
		});
	}
}

function toPageStatus(source: string): MermaidPageStatus {
	return mermaidFileStatus(source);
}
