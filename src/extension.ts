import * as vscode from 'vscode';
import { HTML_VIEW_TYPE, HtmlEditorProvider } from './htmlProvider';
import { IMAGE_VIEW_TYPE, ImageEditorProvider } from './imageProvider';
import { MARKDOWN_VIEW_TYPE, MarkdownEditorProvider } from './markdownProvider';
import { isImagePath, isVideoPath } from './media/formats';
import { MERMAID_VIEW_TYPE, MermaidEditorProvider } from './mermaidProvider';
import { VIDEO_VIEW_TYPE, VideoEditorProvider } from './videoProvider';
import { XAML_VIEW_TYPE, XamlEditorProvider } from './xamlProvider';
import { SubtreePanel } from './subtreeProvider';
import { registerWispkitView } from './wispkitViewProvider';
import { createReadonlyInterceptor } from './readonly/intercept';
import { ReadonlyEditorProvider } from './readonlyProvider';
import { createReadOnlyMode } from './readonly/state';
import { registerGraph3d } from './graph3dProvider';
import { registerResourceTree } from './resourceTreeProvider';
import { registerStorageView } from './storageProvider';

export function activate(context: vscode.ExtensionContext): void {
	const markdownProvider = new MarkdownEditorProvider(context);
	const mermaidProvider = new MermaidEditorProvider(context);
	const readOnlyMode = createReadOnlyMode(context);

	context.subscriptions.push(
		markdownProvider.register(),
		mermaidProvider.register(),
		new XamlEditorProvider(context).register(),
		ImageEditorProvider.register(context),
		VideoEditorProvider.register(context),
		HtmlEditorProvider.register(context),
		ReadonlyEditorProvider.register(context),
		createReadonlyInterceptor(readOnlyMode),
		SubtreePanel.register(context),
		registerWispkitView(context),
		registerGraph3d(context),
		registerResourceTree(context),
		registerStorageView(),
		vscode.commands.registerCommand('wispkit.openWith', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			const viewType = viewTypeFor(editor.document.uri);
			if (!viewType) {
				void vscode.window.showInformationMessage('Wispkit 没有适用于该文件类型的视图。');
				return;
			}
			await vscode.commands.executeCommand('vscode.openWith', editor.document.uri, viewType);
		}),
	);
}

export function deactivate(): void {
	// 无需清理：所有 disposables 都挂在 context.subscriptions 上
}

export function viewTypeFor(uri: vscode.Uri): string | undefined {
	const path = uri.path.toLowerCase();
	if (path.endsWith('.md') || path.endsWith('.markdown')) {
		return MARKDOWN_VIEW_TYPE;
	}
	if (path.endsWith('.mmd') || path.endsWith('.mermaid')) {
		return MERMAID_VIEW_TYPE;
	}
	if (path.endsWith('.html') || path.endsWith('.htm')) {
		return HTML_VIEW_TYPE;
	}
	if (isVideoPath(path)) {
		return VIDEO_VIEW_TYPE;
	}
	if (isImagePath(path)) {
		return IMAGE_VIEW_TYPE;
	}
	if (path.endsWith('.xaml')) {
		return XAML_VIEW_TYPE;
	}
	return undefined;
}
