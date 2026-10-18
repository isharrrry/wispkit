import * as vscode from 'vscode';
import * as path from 'node:path';
import {
	decodeDataUri,
	findMediaSource,
	isAbsoluteTarget,
	isRemoteTarget,
	targetSegments,
	type MediaKind,
	type MediaSource,
} from './media/parse';

export type { MediaKind, MediaSource } from './media/parse';

export type MediaAction = 'saveAs' | 'copyPath' | 'copyText' | 'editDrawio';

export interface MediaRequest {
	readonly action: MediaAction;
	readonly kind: MediaKind;
	readonly index: number;
	readonly alt?: string;
	/** 前端拿到的 src（可能是 data: 或 vscode-webview:）；本地文件另存为不依赖它。 */
	readonly src?: string;
	/** SVG 序列化文本 / data: URI，用于把"图"本身存成文件。 */
	readonly data?: string;
}

export interface MediaActionResult {
	readonly ok: boolean;
	readonly message?: string;
}

export interface MediaActionContext {
	readonly storageDir: vscode.Uri;
	readonly subscriptions: { push(...items: vscode.Disposable[]): unknown };
}

/** 把源码里写的图片路径解析成磁盘位置；data:/http: 没有本地文件。 */
export function resolveImageUri(document: vscode.TextDocument, target: string): vscode.Uri | undefined {
	if (!target) {
		return undefined;
	}
	if (isRemoteTarget(target)) {
		return target.toLowerCase().startsWith('file:') ? vscode.Uri.parse(target) : undefined;
	}

	const decoded = decodeURIComponent(target.split('#')[0].split('?')[0]);
	if (isAbsoluteTarget(decoded)) {
		return vscode.Uri.file(decoded);
	}

	try {
		return vscode.Uri.joinPath(document.uri, '..', ...targetSegments(target));
	} catch {
		return undefined;
	}
}

async function copyToClipboard(value: string, message: string): Promise<MediaActionResult> {
	await vscode.env.clipboard.writeText(value);
	return { ok: true, message };
}

function defaultDirectory(): string {
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
}

async function saveBuffer(
	buffer: Buffer | Uint8Array,
	defaultName: string,
	filterName: string,
	extensions: string[],
): Promise<MediaActionResult> {
	const target = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(defaultDirectory(), defaultName)),
		filters: { [filterName]: extensions },
	});
	if (!target) {
		return { ok: false };
	}
	await vscode.workspace.fs.writeFile(target, buffer);
	return { ok: true, message: `已保存到 ${target.fsPath}` };
}

function suggestedName(source: MediaSource | undefined, kind: MediaKind, fallbackExtension: string): string {
	const target = source?.target;
	if (target) {
		const name = decodeURIComponent(target.split('/').pop() ?? '').split('?')[0];
		if (name) {
			return name;
		}
	}
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `wispkit-${kind}-${stamp}.${fallbackExtension}`;
}

/**
 * drawio 的"编辑"：把代码块抽成临时 `.drawio` 文件交给 drawio 扩展打开；
 * 保存时把改动写回 md 里原来那段 —— 按内容重新定位，文档在别处改过也不会错位替换。
 */
async function editDrawio(
	document: vscode.TextDocument,
	source: MediaSource,
	context: MediaActionContext,
): Promise<MediaActionResult> {
	if (typeof source.body !== 'string') {
		return { ok: false, message: '没能在源码里定位这段 drawio 内容。' };
	}

	const directory = vscode.Uri.joinPath(context.storageDir, 'drawio');
	await vscode.workspace.fs.createDirectory(directory);
	const temp = vscode.Uri.joinPath(directory, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.drawio`);
	await vscode.workspace.fs.writeFile(temp, Buffer.from(source.body, 'utf8'));

	const original = source.text;
	const bodyStart = original.indexOf(source.body);
	const hasDrawioExtension = Boolean(vscode.extensions.getExtension('hediet.vscode-drawio'));
	await vscode.commands.executeCommand('vscode.openWith', temp, hasDrawioExtension ? 'hediet.vscode-drawio-text' : 'default');

	const subscription = vscode.workspace.onDidSaveTextDocument(async saved => {
		if (saved.uri.toString() !== temp.toString() || bodyStart < 0) {
			return;
		}
		const updated = original.slice(0, bodyStart)
			+ saved.getText().replace(/\n$/, '')
			+ original.slice(bodyStart + source.body!.length);
		const offset = document.getText().indexOf(original);
		if (offset < 0) {
			void vscode.window.showWarningMessage('源文档已改动，未自动回写 drawio 内容。');
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(document.positionAt(offset), document.positionAt(offset + original.length)),
			updated,
		);
		await vscode.workspace.applyEdit(edit);
		await document.save();
		void vscode.window.showInformationMessage('drawio 改动已写回文档。');
	});
	context.subscriptions.push(subscription);

	return {
		ok: true,
		message: hasDrawioExtension ? undefined : '未检测到 drawio 扩展，已用默认编辑器打开临时文件。',
	};
}

export async function runMediaAction(
	document: vscode.TextDocument,
	request: MediaRequest,
	context: MediaActionContext,
): Promise<MediaActionResult> {
	const source = findMediaSource(document.getText(), request.kind, request.index, request.alt);

	if (request.action === 'copyText') {
		if (!source) {
			return { ok: false, message: '没能在源码里定位这段内容。' };
		}
		return copyToClipboard(source.text, '已复制原始文本。');
	}

	if (request.action === 'copyPath') {
		const target = source?.target ?? request.src;
		if (!target) {
			return { ok: false, message: '这幅图没有独立文件（可能是内嵌 data: 数据）。' };
		}
		return copyToClipboard(target, '已复制路径。');
	}

	if (request.action === 'editDrawio') {
		if (!source) {
			return { ok: false, message: '没能在源码里定位这段 drawio 内容。' };
		}
		return editDrawio(document, source, context);
	}

	// saveAs
	if (request.kind === 'image') {
		const uri = source?.target ? resolveImageUri(document, source.target) : undefined;
		if (uri) {
			const target = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(path.join(defaultDirectory(), suggestedName(source, request.kind, 'png'))),
			});
			if (!target) {
				return { ok: false };
			}
			await vscode.workspace.fs.copy(uri, target, { overwrite: true });
			return { ok: true, message: `已保存到 ${target.fsPath}` };
		}

		const decoded = request.data ? decodeDataUri(request.data) : undefined;
		if (!decoded) {
			return { ok: false, message: '这幅图既没有本地文件也没有内嵌数据，无法另存。' };
		}
		const extension = /^data:image\/(\w+)/.exec(request.data ?? '')?.[1] ?? 'png';
		return saveBuffer(decoded, suggestedName(source, request.kind, extension), '图片', [extension, 'png']);
	}

	if (!request.data) {
		return { ok: false, message: '没有拿到图像数据，无法另存。' };
	}
	return saveBuffer(Buffer.from(request.data, 'utf8'), suggestedName(source, request.kind, 'svg'), 'SVG', ['svg']);
}
