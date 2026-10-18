import * as vscode from 'vscode';
import * as path from 'node:path';
import { manifestPaths, parseManifest, resolveEntryPath, WISPKIT_VIEW_FOLDER, WISPKIT_VIEW_MANIFEST } from './subtree/wispkitView';

async function exists(target: string): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(target));
		return true;
	} catch {
		return false;
	}
}

async function readText(target: string): Promise<string> {
	const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
	return Buffer.from(bytes).toString('utf8');
}

/**
 * 「展示」图标：在文件夹（或它的 `.WispkitView/` 子文件夹）里找 `Wispkit.json`，
 * 按配置里的 `entry` + `openWith` 打开。
 *
 * 任何一步失败都**明确告诉用户查了哪里、缺什么** —— 静默失败会让人以为图标坏了。
 */
export function registerWispkitView(context: vscode.ExtensionContext): vscode.Disposable {
	void context;

	return vscode.commands.registerCommand('wispkit.wispkitView.open', async (uri?: vscode.Uri) => {
		const target = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!target) {
			void vscode.window.showWarningMessage('Wispkit：请从资源管理器里右键一个文件夹再点「展示」。');
			return;
		}

		const folderPath = target.fsPath;
		const candidates = manifestPaths(folderPath);

		let manifestPath: string | undefined;
		for (const candidate of candidates) {
			if (await exists(candidate)) {
				manifestPath = candidate;
				break;
			}
		}
		if (!manifestPath) {
			void vscode.window.showWarningMessage(
				`Wispkit：在 ${folderPath} 里没找到配置文件。已查找：\n`
				+ candidates.map(candidate => `· ${candidate}`).join('\n'),
			);
			return;
		}

		let text: string;
		try {
			text = await readText(manifestPath);
		} catch (error) {
			void vscode.window.showWarningMessage(
				`Wispkit：读不了 ${manifestPath} —— ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}

		const { manifest, error } = parseManifest(text);
		if (!manifest) {
			void vscode.window.showWarningMessage(`Wispkit：${manifestPath} ${error ?? '配置无效。'}`);
			return;
		}

		const entryPath = resolveEntryPath(folderPath, manifest.entry);
		if (!entryPath) {
			void vscode.window.showWarningMessage(
				`Wispkit：entry「${manifest.entry}」不是 ${folderPath} 内的相对路径。`,
			);
			return;
		}
		if (!(await exists(entryPath))) {
			void vscode.window.showWarningMessage(`Wispkit：入口文件不存在 —— ${entryPath}`);
			return;
		}

		try {
			await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(entryPath), manifest.openWith);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			void vscode.window.showWarningMessage(
				`Wispkit：viewType「${manifest.openWith}」打不开 ${path.basename(entryPath)} —— ${detail}\n`
				+ `（可用的 Wispkit 视图：wispkit.html / wispkit.markdown / wispkit.image / wispkit.xaml / wispkit.text）`,
			);
			return;
		}

		if (manifest.title) {
			void vscode.window.showInformationMessage(`Wispkit：${manifest.title}`);
		}
	});
}

export { WISPKIT_VIEW_FOLDER, WISPKIT_VIEW_MANIFEST };
