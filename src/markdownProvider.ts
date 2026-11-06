import * as vscode from 'vscode';
import { readMarkdownPreviewTypography, readMarkdownViewConfig } from './config';
import { collectMarkdownContributions, hasMarkdownPreviewResources } from './markdown/contributions';
import {
	MARKDOWN_MERMAID_THEME_STATE_KEY,
	applyMermaidThemeToBodyHtml,
	isMarkdownMermaidTheme,
	normalizeMarkdownMermaidTheme,
	type MarkdownMermaidTheme,
} from './markdown/mermaidTheme';
import { renderMarkdownPage } from './markdown/page';
import { renderMarkdownHtml } from './markdown/render';
import {
	MARKDOWN_THEME_STATE_KEY,
	isMarkdownThemeMode,
	normalizeMarkdownThemeMode,
	type MarkdownThemeMode,
} from './markdown/theme';
import { runMediaAction, type MediaRequest } from './mediaActions';
import { strictContentSecurityPolicy } from './util/csp';
import { escapeHtml } from './util/html';
import { openWebviewLinkSafely } from './util/linkOpen';
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

	/**
	 * 打开中的 Markdown webview。主题是**全局**的：在一个文档里切换，
	 * 其它已打开的 Markdown 标签页要同时变；新开的标签页从 globalState 取初值。
	 */
	private readonly webviews = new Set<vscode.Webview>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	/** 当前全局主题模式；`globalState` 里是任何值都按默认「跟随主题」处理。 */
	private themeMode(): MarkdownThemeMode {
		return normalizeMarkdownThemeMode(this.context.globalState.get(MARKDOWN_THEME_STATE_KEY));
	}

	/** 当前全局 Mermaid 图表主题；非法值回落到内置扩展的默认 `vscode`。 */
	private mermaidTheme(): MarkdownMermaidTheme {
		return normalizeMarkdownMermaidTheme(this.context.globalState.get(MARKDOWN_MERMAID_THEME_STATE_KEY));
	}

	/**
	 * 切换全局 Mermaid 主题并广播给所有 Markdown 视图。
	 * 与明暗主题同一约定：非法值直接忽略，不能 normalize 成默认值。
	 */
	private async setMermaidTheme(value: unknown): Promise<void> {
		if (!isMarkdownMermaidTheme(value) || value === this.mermaidTheme()) {
			return;
		}
		await this.context.globalState.update(MARKDOWN_MERMAID_THEME_STATE_KEY, value);
		for (const webview of this.webviews) {
			void webview.postMessage({ type: 'wispkit.mermaidTheme', theme: value });
		}
	}

	/**
	 * 切换全局主题并广播给所有 Markdown 视图。
	 *
	 * **只认合法的三态值**：非法消息直接忽略，不能经 `normalize` 回落成 auto ——
	 * 那会把一个手滑的消息变成「悄悄切回跟随主题」。
	 */
	private async setThemeMode(value: unknown): Promise<void> {
		if (!isMarkdownThemeMode(value) || value === this.themeMode()) {
			return;
		}
		await this.context.globalState.update(MARKDOWN_THEME_STATE_KEY, value);
		for (const webview of this.webviews) {
			void webview.postMessage({ type: 'wispkit.theme', mode: value });
		}
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const webview = webviewPanel.webview;
		this.webviews.add(webview);

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
			// 内置 Mermaid 扩展在渲染时前置了一个配置 span；把明暗两套主题改成用户选中的
			// 那个再交给 webview。必须在这里做（而不是等前端脚本），否则 async 模块脚本
			// 可能先于前端执行，首屏图表会先按旧主题画一次。
			return result.html
				? applyMermaidThemeToBodyHtml(result.html, this.mermaidTheme())
				: this.renderRenderError(result.error);
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
				case 'wispkit.openLink':
					// 前端截住了 <a> 点击：把原始 href 按文档位置解析后在本窗口打开。
					// 不能交给 webview 外壳 —— `<base>` 会把相对链接变成 https 资源 URL，
					// 外壳按外部链接丢给系统浏览器。
					if (typeof message.href === 'string') {
						await openWebviewLinkSafely(document.uri, message.href);
					}
					break;
				case 'wispkit.setTheme':
					// 全局主题：落盘并广播给所有 Markdown 视图（含发起方自己）。
					await this.setThemeMode(message.mode);
					break;
				case 'wispkit.setMermaidTheme':
					// 全局 Mermaid 图表主题：同上，落盘后广播。
					await this.setMermaidTheme(message.theme);
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
			this.webviews.delete(webview);
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
			themeMode: this.themeMode(),
			mermaidTheme: this.mermaidTheme(),
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
