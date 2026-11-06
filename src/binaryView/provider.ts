import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { readShellLinkViewConfig } from '../config';
import { binaryContentSecurityPolicy } from '../media/csp';
import { collectMediaResourceRoots } from '../media/webview';
import { generateNonce } from '../util/nonce';
import { parseExecutable } from '../executable/pe';
import { parseShellLink } from '../shellLink/lnk';
import { planSystemOpen, runSystemOpen } from '../shellLink/open';
import { buildShortcutRewriteScript, diffShortcutEdits, hasShortcutEdits, type ShortcutEditForm } from '../shellLink/rewrite';
import { describeExecutable, describeShellLink, type PathProbe } from './describe';
import { renderBinaryPage } from './page';

export const SHELL_LINK_VIEW_TYPE = 'wispkit.shellLink';
export const EXECUTABLE_VIEW_TYPE = 'wispkit.executable';

export type BinaryKind = 'lnk' | 'pe';

/** 解析前先挡掉超大文件：整份读进内存再解析，没有流式处理的必要。 */
const MAX_BINARY_BYTES = 256 * 1024 * 1024;

function fileName(uri: vscode.Uri): string {
	const segments = uri.path.split('/').filter(Boolean);
	return segments[segments.length - 1] ?? uri.path;
}

async function probePath(targetPath: string): Promise<PathProbe | undefined> {
	try {
		const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
		return { exists: true, isDirectory: (stat.type & vscode.FileType.Directory) !== 0 };
	} catch {
		return { exists: false, isDirectory: false };
	}
}

function runPowerShell(script: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
		let stderr = '';
		child.stderr.on('data', chunk => {
			stderr += String(chunk);
		});
		child.once('error', reject);
		child.once('close', code => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(stderr.trim() || `powershell 退出码 ${code}`));
		});
	});
}

/**
 * `.lnk` / `.exe` 的属性页。
 *
 * 走 `CustomEditorProvider` 而不是文本编辑器：这两种格式根本不是文本，让 VS Code
 * 先把它读成 TextDocument 只会得到乱码。默认打开方式**不是**这个视图 —— 视图登记的
 * `priority` 是 `option`，只有用户主动「打开方式」或配置里选了才进来。
 */
export class BinaryEditorProvider implements vscode.CustomEditorProvider<vscode.CustomDocument> {

	public static register(context: vscode.ExtensionContext, viewType: string, kind: BinaryKind): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			viewType,
			new BinaryEditorProvider(context, kind),
			{
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: true,
			},
		);
	}

	constructor(private readonly context: vscode.ExtensionContext, private readonly kind: BinaryKind) { }

	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
	public readonly onDidChangeCustomDocument = this.onDidChangeEmitter.event;

	public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return {
			uri,
			dispose: () => {
				// 只读视图（`lnk` 的编辑走自己的按钮，不经过 document 的脏标记）
			},
		};
	}

	public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
		const webview = webviewPanel.webview;
		const nonce = generateNonce();
		const cspSource = webview.cspSource;

		webview.options = {
			enableScripts: true,
			enableForms: false,
			localResourceRoots: collectMediaResourceRoots(this.context, document.uri),
		};

		const runtimeScript = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'binary.js'),
		).toString();
		const runtimeStyle = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'binary.css'),
		).toString();

		const render = async (statusText?: string, statusLevel?: 'ok' | 'error' | 'info'): Promise<void> => {
			webview.html = await this.buildPage(document.uri, {
				nonce,
				csp: binaryContentSecurityPolicy(cspSource, nonce),
				runtimeScript,
				runtimeStyle,
				statusText,
				statusLevel,
			});
		};

		await render();

		webview.onDidReceiveMessage(async message => {
			if (message?.type === 'wispkit.binary.openSystem') {
				await this.openWithSystem(document.uri);
				return;
			}
			if (message?.type === 'wispkit.binary.save' && message.fields && typeof message.fields === 'object') {
				const fields = message.fields as Record<string, unknown>;
				const form: ShortcutEditForm = {
					targetPath: typeof fields.targetPath === 'string' ? fields.targetPath : '',
					arguments: typeof fields.arguments === 'string' ? fields.arguments : '',
					workingDirectory: typeof fields.workingDirectory === 'string' ? fields.workingDirectory : '',
					description: typeof fields.description === 'string' ? fields.description : '',
				};
				try {
					const result = await this.saveShortcut(document.uri, form);
					await render(result.text, result.level);
				} catch (error) {
					webview.postMessage({
						type: 'wispkit.binary.status',
						text: `保存失败：${error instanceof Error ? error.message : String(error)}`,
						level: 'error',
					});
				}
			}
		});
	}

	private async openWithSystem(uri: vscode.Uri): Promise<void> {
		try {
			await runSystemOpen(planSystemOpen(uri.fsPath, process.platform));
		} catch (error) {
			void vscode.window.showErrorMessage(`无法用系统方式打开：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async saveShortcut(uri: vscode.Uri, form: ShortcutEditForm): Promise<{ text: string; level: 'ok' | 'error' | 'info' }> {
		if (process.platform !== 'win32') {
			return { text: '只有 Windows 能改写快捷方式。', level: 'error' };
		}
		const bytes = await vscode.workspace.fs.readFile(uri);
		const parsed = parseShellLink(bytes);
		if (!parsed.ok) {
			return { text: `无法读取现有快捷方式：${parsed.error}`, level: 'error' };
		}
		const current = parsed.value;
		const edits = diffShortcutEdits(form, {
			targetPath: current.targetPath ?? current.environmentTarget,
			arguments: current.arguments,
			workingDirectory: current.workingDirectory,
			description: current.name,
		});
		if (!hasShortcutEdits(edits)) {
			return { text: '没有需要保存的改动。', level: 'info' };
		}
		try {
			await runPowerShell(buildShortcutRewriteScript(uri.fsPath, edits));
		} catch (error) {
			return { text: `保存失败：${error instanceof Error ? error.message : String(error)}`, level: 'error' };
		}
		return { text: '已保存，属性已刷新。', level: 'ok' };
	}

	private async buildPage(
		uri: vscode.Uri,
		chrome: {
			readonly nonce: string;
			readonly csp: string;
			readonly runtimeScript: string;
			readonly runtimeStyle: string;
			readonly statusText?: string;
			readonly statusLevel?: 'ok' | 'error' | 'info';
		},
	): Promise<string> {
		const title = fileName(uri);
		const base = {
			title,
			csp: chrome.csp,
			nonce: chrome.nonce,
			runtimeScript: chrome.runtimeScript,
			runtimeStyle: chrome.runtimeStyle,
			kind: this.kind,
			statusText: chrome.statusText,
			statusLevel: chrome.statusLevel,
		};

		let bytes: Uint8Array;
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > MAX_BINARY_BYTES) {
				return renderBinaryPage({
					...base,
					subtitle: '文件太大',
					sections: [],
					notices: [],
					error: `文件 ${stat.size} 字节，超过 ${MAX_BINARY_BYTES} 字节的解析上限。`,
				});
			}
			bytes = await vscode.workspace.fs.readFile(uri);
		} catch (error) {
			return renderBinaryPage({
				...base,
				subtitle: '无法读取',
				sections: [],
				notices: [],
				error: `读取失败：${error instanceof Error ? error.message : String(error)}`,
			});
		}

		if (this.kind === 'lnk') {
			const parsed = parseShellLink(bytes);
			if (!parsed.ok) {
				return renderBinaryPage({
					...base,
					subtitle: '不是可识别的 Windows 快捷方式',
					sections: [],
					notices: [],
					error: parsed.error,
				});
			}
			const targetPath = parsed.value.targetPath ?? parsed.value.environmentTarget;
			const probe = targetPath ? await probePath(targetPath) : undefined;
			const described = describeShellLink(parsed.value, probe, {
				allowEdit: readShellLinkViewConfig().allowEdit,
				platform: process.platform,
			});
			return renderBinaryPage({
				...base,
				subtitle: described.subtitle,
				sections: described.sections,
				notices: described.notices,
				form: described.form,
			});
		}

		const parsed = parseExecutable(bytes);
		if (!parsed.ok) {
			return renderBinaryPage({
				...base,
				subtitle: '不是可识别的 PE 可执行文件',
				sections: [],
				notices: [],
				error: parsed.error,
			});
		}
		const described = describeExecutable(parsed.value);
		return renderBinaryPage({
			...base,
			subtitle: described.subtitle,
			sections: described.sections,
			notices: described.notices,
		});
	}

	public async saveCustomDocument(_document: vscode.CustomDocument): Promise<void> {
		// 二进制属性页不是可保存的文本：`.lnk` 的改动由页面自己的按钮写回。
	}

	public async saveCustomDocumentAs(document: vscode.CustomDocument, destination: vscode.Uri): Promise<void> {
		const bytes = await vscode.workspace.fs.readFile(document.uri);
		await vscode.workspace.fs.writeFile(destination, bytes);
		await vscode.commands.executeCommand('vscode.open', destination);
	}

	public async revertCustomDocument(_document: vscode.CustomDocument): Promise<void> {
		// 只读视图
	}

	public async backupCustomDocument(
		document: vscode.CustomDocument,
		context: vscode.CustomDocumentBackupContext,
	): Promise<vscode.CustomDocumentBackup> {
		return {
			id: context.destination.toString(),
			delete: () => {
				// 没有备份内容需要删除
			},
		};
	}
}
