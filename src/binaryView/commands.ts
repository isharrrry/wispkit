import * as vscode from 'vscode';
import * as path from 'node:path';
import { readShellLinkViewConfig } from '../config';
import { parseShellLink } from '../shellLink/lnk';
import { planExecutableOpen, planShellLinkOpen, isExecutablePath, isShellLinkPath, type LinkPlan } from '../shellLink/policy';
import { planSystemOpen, runSystemOpen } from '../shellLink/open';
import { SubtreePanel } from '../subtreeProvider';
import { EXECUTABLE_VIEW_TYPE, SHELL_LINK_VIEW_TYPE } from './provider';

/**
 * `.lnk` / `.exe` 的入口命令。
 *
 * 这四个命令都在 `explorer/context` 里出现，因此参数是资源管理器传进来的 `Uri`
 * （多选时可能是一个数组）。没有参数时退回到当前活动编辑器/标签页。
 */

function uriArgument(arg: unknown): vscode.Uri | undefined {
	if (arg instanceof vscode.Uri) {
		return arg;
	}
	if (Array.isArray(arg)) {
		const first = arg.find(item => item instanceof vscode.Uri);
		if (first instanceof vscode.Uri) {
			return first;
		}
	}
	return activeTabUri();
}

function activeTabUri(): vscode.Uri | undefined {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		return editor.document.uri;
	}
	for (const group of vscode.window.tabGroups.all) {
		const input = group.activeTab?.input;
		if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
			return input.uri;
		}
	}
	return undefined;
}

async function withUri(arg: unknown, action: (uri: vscode.Uri) => Promise<void>): Promise<void> {
	const uri = uriArgument(arg);
	if (!uri) {
		void vscode.window.showWarningMessage('没有可处理的文件：请从资源管理器里右键一个 .lnk 或 .exe。');
		return;
	}
	try {
		await action(uri);
	} catch (error) {
		void vscode.window.showErrorMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`);
	}
}

/** 系统打开：`.lnk` 与 `.exe` 都等价于资源管理器双击。 */
async function openWithSystem(uri: vscode.Uri): Promise<void> {
	// `.lnk` 的工作目录由快捷方式自己记录，不能在外面再覆盖一层。
	const plan = planSystemOpen(uri.fsPath, process.platform, isShellLinkPath(uri.fsPath)
		? {}
		: { workingDirectory: path.dirname(uri.fsPath) });
	await runSystemOpen(plan);
}

async function folderExists(targetPath: string): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
		return (stat.type & vscode.FileType.Directory) !== 0;
	} catch {
		return false;
	}
}

async function fileExists(targetPath: string): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
		return true;
	} catch {
		return false;
	}
}

async function openLinkTarget(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	const parsed = parseShellLink(bytes);
	if (!parsed.ok) {
		void vscode.window.showWarningMessage(`无法读取快捷方式：${parsed.error}`);
		return;
	}
	const targetPath = parsed.value.targetPath ?? parsed.value.environmentTarget;
	if (!targetPath) {
		void vscode.window.showWarningMessage('这个快捷方式里没有可读的目标路径，只能用系统方式打开。');
		return;
	}
	if (!(await fileExists(targetPath))) {
		void vscode.window.showWarningMessage(`目标不存在：${targetPath}`);
		return;
	}
	if (await folderExists(targetPath)) {
		await SubtreePanel.open(context, vscode.Uri.file(targetPath));
		return;
	}
	await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetPath));
}

async function runLinkPlan(context: vscode.ExtensionContext, plan: LinkPlan, uri: vscode.Uri): Promise<void> {
	switch (plan.kind) {
		case 'system':
			await openWithSystem(uri);
			return;
		case 'subtree':
			if (await folderExists(plan.path)) {
				await SubtreePanel.open(context, vscode.Uri.file(plan.path));
				return;
			}
			void vscode.window.showWarningMessage(`目标文件夹不存在：${plan.path}`);
			return;
		case 'file':
			if (await fileExists(plan.path)) {
				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(plan.path));
				return;
			}
			void vscode.window.showWarningMessage(`目标文件不存在：${plan.path}`);
			return;
		case 'unresolved':
			void vscode.window.showWarningMessage('这个快捷方式里没有可读的目标路径，只能用系统方式打开。');
			return;
		case 'ask':
			await askShellLink(context, uri);
			return;
	}
}

async function askShellLink(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
	const pick = await vscode.window.showQuickPick(
		[
			{ label: '$(link-external) 用系统方式打开', description: '与资源管理器双击一致', value: 'system' as const },
			{ label: '$(list-tree) 在 Wispkit 里打开目标', description: '文件夹进子树面板，文件在编辑器里打开', value: 'internal' as const },
			{ label: '$(eye) 查看快捷方式属性', value: 'viewer' as const },
		],
		{ placeHolder: `${path.basename(uri.fsPath)} 这次怎么打开？`, ignoreFocusOut: true },
	);
	if (!pick) {
		return;
	}
	if (pick.value === 'system') {
		await openWithSystem(uri);
		return;
	}
	if (pick.value === 'internal') {
		await openLinkTarget(context, uri);
		return;
	}
	await vscode.commands.executeCommand('vscode.openWith', uri, SHELL_LINK_VIEW_TYPE);
}

async function openDefault(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
	const settings = readShellLinkViewConfig();
	if (isShellLinkPath(uri.fsPath)) {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const parsed = parseShellLink(bytes);
		if (!parsed.ok) {
			await openWithSystem(uri);
			return;
		}
		const plan = planShellLinkOpen(settings.openBehavior, settings.folderTarget, {
			targetPath: parsed.value.targetPath ?? parsed.value.environmentTarget,
			targetIsFolder: parsed.value.targetLooksLikeFolder,
		});
		await runLinkPlan(context, plan, uri);
		return;
	}
	if (isExecutablePath(uri.fsPath)) {
		const plan = planExecutableOpen(settings.executableOpenBehavior);
		if (plan.kind === 'viewer') {
			await vscode.commands.executeCommand('vscode.openWith', uri, EXECUTABLE_VIEW_TYPE);
			return;
		}
		if (plan.kind === 'ask') {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: '$(play) 用系统方式运行', description: '与资源管理器双击一致', value: 'system' as const },
					{ label: '$(eye) 查看 PE 结构', value: 'viewer' as const },
				],
				{ placeHolder: `${path.basename(uri.fsPath)} 这次怎么打开？`, ignoreFocusOut: true },
			);
			if (!pick) {
				return;
			}
			if (pick.value === 'viewer') {
				await vscode.commands.executeCommand('vscode.openWith', uri, EXECUTABLE_VIEW_TYPE);
				return;
			}
		}
		await openWithSystem(uri);
		return;
	}
	void vscode.window.showInformationMessage('该文件不是 .lnk 或 .exe，没有可切换的默认响应方式。');
}

export function registerBinaryCommands(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.Disposable.from(
		vscode.commands.registerCommand('wispkit.openDefault', (arg?: unknown) =>
			withUri(arg, uri => openDefault(context, uri))),
		vscode.commands.registerCommand('wispkit.shellLink.openSystem', (arg?: unknown) =>
			withUri(arg, uri => openWithSystem(uri))),
		vscode.commands.registerCommand('wispkit.shellLink.openTarget', (arg?: unknown) =>
			withUri(arg, uri => openLinkTarget(context, uri))),
		vscode.commands.registerCommand('wispkit.shellLink.openViewer', (arg?: unknown) =>
			withUri(arg, async uri => {
				await vscode.commands.executeCommand('vscode.openWith', uri, SHELL_LINK_VIEW_TYPE);
			})),
		vscode.commands.registerCommand('wispkit.executable.openSystem', (arg?: unknown) =>
			withUri(arg, uri => openWithSystem(uri))),
		vscode.commands.registerCommand('wispkit.executable.openViewer', (arg?: unknown) =>
			withUri(arg, async uri => {
				await vscode.commands.executeCommand('vscode.openWith', uri, EXECUTABLE_VIEW_TYPE);
			})),
	);
}
