import * as vscode from 'vscode';
import { resolveLinkTarget } from './linkTarget';

/**
 * 页面点击拦截后送来的原始 href → 在 VS Code 里打开。
 *
 * `vscode.open` 而不是 `window.showTextDocument`：目标是 Markdown / HTML / 图片时，
 * 用户配置的默认编辑器（本扩展自己的 custom editor 就在其中）会按关联生效；
 * 行号通过 `TextDocumentShowOptions.selection` 传给文本编辑器。
 */
export async function openWebviewLink(documentUri: vscode.Uri, rawHref: string): Promise<void> {
	const workspaceRoot = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.path;
	const target = resolveLinkTarget(rawHref, documentUri.path, workspaceRoot);

	switch (target.kind) {
		case 'external':
			await vscode.env.openExternal(vscode.Uri.parse(target.href, true));
			return;

		case 'file': {
			// untitled: 等没有磁盘位置的文档：相对链接没有解析基准，别把拼出来的
			// `Untitled-1/foo.md` 当成真实路径。绝对路径仍然照常打开。
			if (documentUri.scheme !== 'file' && !/^([a-zA-Z]:[\\/]|\/)/.test(target.path ?? '')) {
				return;
			}
			const uri = vscode.Uri.file(target.path ?? '');
			const options: vscode.TextDocumentShowOptions = {};
			if (target.line !== undefined) {
				options.selection = new vscode.Range(target.line - 1, 0, target.line - 1, 0);
			}
			await vscode.commands.executeCommand('vscode.open', uri, options);
			return;
		}

		default:
			// 页内锚点 / 不支持的 scheme：前端本来就不该送来；静默忽略。
			return;
	}
}

/** `openWebviewLink` 的安全包装：失败只在界面提示，不让消息处理抛成未捕获异常。 */
export async function openWebviewLinkSafely(documentUri: vscode.Uri, rawHref: string): Promise<void> {
	try {
		await openWebviewLink(documentUri, rawHref);
	} catch (error) {
		void vscode.window.showWarningMessage(
			`Wispkit 打开链接失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
