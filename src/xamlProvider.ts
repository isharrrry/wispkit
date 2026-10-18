import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { readXamlViewConfig } from './config';
import { strictContentSecurityPolicy } from './util/csp';
import { escapeHtml } from './util/html';
import { generateNonce } from './util/nonce';
import { renderXamlPage } from './xaml/page';
import { renderXaml, type XamlRenderResult } from './xaml/renderer';

export const XAML_VIEW_TYPE = 'wispkit.xaml';

/** 渲染器随扩展分发：tools/xaml-render 的 Release 产物（framework-dependent，几百 KB）。 */
export function rendererExecutable(extensionUri: vscode.Uri): string {
	return vscode.Uri.joinPath(extensionUri, 'tools', 'xaml-render', 'bin', 'Release', 'net10.0-windows', 'XamlRender.exe').fsPath;
}

/** 关联的 XAML：`.xaml.cs` 渲染同名 `.xaml`，其他文件渲染自己。 */
export function linkedXamlUri(documentUri: vscode.Uri): vscode.Uri {
	const name = documentUri.path.split('/').pop() ?? '';
	if (!name.toLowerCase().endsWith('.xaml.cs')) {
		return documentUri;
	}
	// 去掉结尾的 `.cs`，留下 `Foo.xaml`
	return vscode.Uri.joinPath(documentUri, '..', name.slice(0, -3));
}

/** 找不到关联 XAML 时的 errorType。 */
export const LINKED_XAML_MISSING = '找不到同名 XAML';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
	try {
		return await vscode.workspace.fs.readDirectory(uri);
	} catch {
		return [];
	}
}

/** 某目录下 `bin/(Release|Debug)/<tfm>/*.dll` —— 就是该项目的编译产物。 */
async function binAssemblies(directory: vscode.Uri): Promise<string[]> {
	const found: string[] = [];
	for (const configuration of ['Release', 'Debug']) {
		const configurationRoot = vscode.Uri.joinPath(directory, 'bin', configuration);
		for (const [framework, type] of await readDirectory(configurationRoot)) {
			if (type !== vscode.FileType.Directory) {
				continue;
			}
			const frameworkRoot = vscode.Uri.joinPath(configurationRoot, framework);
			for (const [file, fileType] of await readDirectory(frameworkRoot)) {
				if (fileType === vscode.FileType.File && file.toLowerCase().endsWith('.dll')) {
					found.push(vscode.Uri.joinPath(frameworkRoot, file).fsPath);
				}
			}
		}
	}
	return found;
}

/**
 * `x:Class` 指向的类型必须先在进程里，渲染器才能把内容填上去。
 * 从 xaml 所在目录逐级向上找 bin（最多 4 层），拿到项目自己的 dll。
 */
export async function discoverAssemblies(documentUri: vscode.Uri, maxDepth = 4): Promise<string[]> {
	let directory = vscode.Uri.joinPath(documentUri, '..');

	for (let depth = 0; depth < maxDepth; depth++) {
		const found = await binAssemblies(directory);
		if (found.length > 0) {
			return found.slice(0, 40);
		}
		const parent = vscode.Uri.joinPath(directory, '..');
		if (parent.toString() === directory.toString()) {
			break;
		}
		directory = parent;
	}
	return [];
}

interface Rendered {
	readonly result: XamlRenderResult;
	readonly imageSrc?: string;
}

export class XamlEditorProvider implements vscode.CustomTextEditorProvider {

	public register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			XAML_VIEW_TYPE,
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
		const storageDirectory = vscode.Uri.joinPath(this.context.storageUri ?? this.context.globalStorageUri, 'xaml-render');
		await vscode.workspace.fs.createDirectory(storageDirectory);

		webview.options = {
			enableScripts: true,
			enableForms: false,
			localResourceRoots: [
				this.context.extensionUri,
				// PNG 写在这个目录里：不进 localResourceRoots 的话 webview 会拒载，右侧一片空白
				storageDirectory,
				...collectDocumentRoots(document.uri),
			],
		};

		const nonce = generateNonce();
		const documentKey = crypto.createHash('sha1').update(document.uri.toString()).digest('hex').slice(0, 16);

		/** 编辑区里的语言决定高亮规则。 */
		const language: 'xaml' | 'csharp' = document.uri.path.toLowerCase().endsWith('.xaml.cs') ? 'csharp' : 'xaml';
		const linkedUri = linkedXamlUri(document.uri);
		const rendersLinked = linkedUri.toString() !== document.uri.toString();
		const renderTargetName = rendersLinked ? (linkedUri.path.split('/').pop() ?? undefined) : undefined;

		/** 渲染某个 xaml 文件；`assembliesFrom` 决定去哪儿找 x:Class 所在程序集。 */
		const renderPath = async (xamlPath: string, pngPath: string): Promise<Rendered> => {
			const executable = rendererExecutable(this.context.extensionUri);
			if (!(await fileExists(vscode.Uri.file(executable)))) {
				return {
					result: {
						ok: false,
						errorType: 'RendererMissing',
						error: `找不到 XAML 渲染器：${executable}\n请在 Wispkit\\tools\\xaml-render 下执行 dotnet build -c Release。`,
					},
				};
			}

			const rendered = await renderXaml(
				{ executable, extraAssemblies: await discoverAssemblies(document.uri) },
				xamlPath,
				pngPath,
			);
			return {
				result: rendered,
				imageSrc: rendered.ok ? webview.asWebviewUri(vscode.Uri.file(pngPath)).toString() : undefined,
			};
		};

		/** 找不到关联 XAML 时的结果：给一条能看懂的说明，而不是空白或崩溃。 */
		const linkedMissing = (): Rendered => ({
			result: {
				ok: false,
				errorType: LINKED_XAML_MISSING,
				error: `${linkedUri.fsPath} 不存在。`,
			},
		});

		const renderDocument = async (): Promise<Rendered> => {
			// 每次都重新判断：视图开着的时候用户可能把同名 .xaml 建出来
			if (rendersLinked && !(await fileExists(linkedUri))) {
				return linkedMissing();
			}
			return renderPath(
				linkedUri.fsPath,
				vscode.Uri.joinPath(storageDirectory, `${documentKey}.png`).fsPath,
			);
		};

		/**
		 * 用编辑区里的**当前文本**渲染：渲染器只认磁盘路径，所以先落到临时文件。
		 * 程序集仍按原文档的位置去找（临时文件在存储目录里，向上找不到 bin）。
		 */
		const renderText = async (text: string): Promise<Rendered> => {
			// 编辑区装的是 C# 时，可渲染的只有磁盘上的同名 .xaml
			if (rendersLinked) {
				return renderDocument();
			}
			const xamlUri = vscode.Uri.joinPath(storageDirectory, `preview-${documentKey}.xaml`);
			await vscode.workspace.fs.writeFile(xamlUri, Buffer.from(text, 'utf8'));
			return renderPath(
				xamlUri.fsPath,
				vscode.Uri.joinPath(storageDirectory, `preview-${documentKey}.png`).fsPath,
			);
		};

		/** 关联 XAML 缺失时覆盖默认那套「x:Class 常见原因」提示。 */
		const missingHint = `这个视图渲染的是与它同名的 <code>.xaml</code>（<code>${escapeHtml(renderTargetName ?? '')}</code>）。当前找不到该文件，所以右侧没有可渲染的内容；左侧代码不受影响，照常可以编辑与保存。`;

		const paint = (rendered: Rendered): void => {
			webview.html = renderXamlPage({
				title: document.uri.path.split('/').pop() ?? 'XAML',
				csp: strictContentSecurityPolicy(webview.cspSource, nonce),
				nonce,
				runtimeScript: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'xaml.js')).toString(),
				runtimeStyle: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'xaml.css')).toString(),
				code: document.getText(),
				language,
				imageSrc: rendered.imageSrc,
				result: rendered.result,
				renderTargetName,
				errorHint: rendered.result.errorType === LINKED_XAML_MISSING ? missingHint : undefined,
				config: readXamlViewConfig(),
			});
		};

		/** 全文替换 + 落盘。返回可展示的原因，绝不抛给 webview。 */
		const saveText = async (text: string): Promise<{ ok: boolean; error?: string }> => {
			try {
				const current = document.getText();
				const edit = new vscode.WorkspaceEdit();
				edit.replace(
					document.uri,
					new vscode.Range(document.positionAt(0), document.positionAt(current.length)),
					text,
				);
				if (!(await vscode.workspace.applyEdit(edit))) {
					return { ok: false, error: '编辑被拒绝（文件可能是只读的）' };
				}
				return (await document.save()) ? { ok: true } : { ok: false, error: '保存未完成' };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		};

		paint(await renderDocument());

		const messageSubscription = webview.onDidReceiveMessage(async message => {
			if (message?.type === 'wispkit.saveText') {
				const outcome = await saveText(String(message.text ?? ''));
				void webview.postMessage({ type: 'wispkit.saveResult', requestId: message.requestId, ...outcome });
				return;
			}

			if (message?.type === 'wispkit.renderXaml') {
				const rendered = await renderText(String(message.text ?? ''));
				void webview.postMessage({
					type: 'wispkit.xamlRendered',
					requestId: message.requestId,
					ok: rendered.result.ok,
					imageSrc: rendered.imageSrc,
					error: rendered.result.error,
					errorType: rendered.result.errorType,
					root: rendered.result.root,
					width: rendered.result.width,
					height: rendered.result.height,
					mode: rendered.result.mode,
				});
			}
		});

		let timer: ReturnType<typeof setTimeout> | undefined;
		const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
			const changed = event.document.uri.toString();
			// `.xaml.cs` 视图还要跟随同名 .xaml 的变化
			if (changed !== document.uri.toString() && changed !== linkedUri.toString()) {
				return;
			}
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				void renderDocument().then(paint);
			}, 300);
		});

		webviewPanel.onDidDispose(() => {
			if (timer) {
				clearTimeout(timer);
			}
			messageSubscription.dispose();
			changeSubscription.dispose();
		});
	}
}

function collectDocumentRoots(documentUri: vscode.Uri): vscode.Uri[] {
	const roots: vscode.Uri[] = [];
	try {
		roots.push(vscode.Uri.joinPath(documentUri, '..'));
	} catch {
		// untitled: 之类没有父目录的文档
	}
	return roots;
}
