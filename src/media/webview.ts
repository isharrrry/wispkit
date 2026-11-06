import * as vscode from 'vscode';

/**
 * 媒体文件本体在工作区里，不在扩展目录下。`asWebviewUri` 生成的地址只有在
 * localResourceRoots 覆盖到它时才会被 webview 放行 —— 只写 extensionUri 会让
 * 整页空白（图片 / 视频被拒载）。父目录覆盖同目录引用，工作区目录覆盖跨目录引用。
 */
export function collectMediaResourceRoots(
	context: vscode.ExtensionContext,
	documentUri: vscode.Uri,
): vscode.Uri[] {
	const roots: vscode.Uri[] = [context.extensionUri];

	try {
		roots.push(vscode.Uri.joinPath(documentUri, '..'));
	} catch {
		// untitled: 等没有父目录的 scheme
	}

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		roots.push(folder.uri);
	}

	return roots;
}

/** 复制路径时 file: 用系统路径，其它 scheme 原样给 URI（与媒体右键菜单的取值一致）。 */
export function mediaClipboardPath(uri: vscode.Uri): string {
	return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

export interface MediaHostMessage {
	readonly type?: unknown;
}

/**
 * 图片 / 视频视图只接受两条宿主消息：外部打开与复制路径。
 * webview 里跑的都是本地打包脚本，但仍按白名单处理，未知消息直接忽略。
 */
export function handleMediaHostMessage(documentUri: vscode.Uri, message: MediaHostMessage): void {
	if (message?.type === 'wispkit.media.openExternal') {
		void vscode.env.openExternal(documentUri).then(opened => {
			if (!opened) {
				void vscode.window.showWarningMessage(`无法用系统默认应用打开：${mediaClipboardPath(documentUri)}`);
			}
		});
		return;
	}
	if (message?.type === 'wispkit.media.copyPath') {
		void vscode.env.clipboard.writeText(mediaClipboardPath(documentUri));
	}
}
