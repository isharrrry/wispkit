import * as vscode from 'vscode';
import { HANDLED_ELSEWHERE } from './file';
import { READONLY_VIEW_TYPE } from './associations';
import type { ReadOnlyMode } from './state';

export { READONLY_VIEW_TYPE };

/**
 * 解锁白名单：`wispkit.unlock` 让某个文件回到原生编辑器后，拦截器**不能再**把它换回只读视图，
 * 否则会瞬间被换回去（看起来像解锁无效），甚至来回切换。
 * 只在当前窗口会话内有效 —— 重载窗口后清空，符合"重载后按 editorAssociations 走"的语义。
 */
const allowedNativeOpen = new Set<string>();

export function allowNativeOpen(uri: vscode.Uri): void {
	allowedNativeOpen.add(uri.toString());
}

function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
	return a.toString() === b.toString();
}

export function findTextTab(uri: vscode.Uri): vscode.Tab | undefined {
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			if (input instanceof vscode.TabInputText && sameUri(input.uri, uri)) {
				return tab;
			}
		}
	}
	return undefined;
}

export function hasCustomTab(uri: vscode.Uri, viewType: string): boolean {
	return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => {
		const input = tab.input;
		return input instanceof vscode.TabInputCustom && input.viewType === viewType && sameUri(input.uri, uri);
	}));
}

export async function closeCustomTabsFor(uri: vscode.Uri, viewType: string): Promise<void> {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			if (input instanceof vscode.TabInputCustom && input.viewType === viewType && sameUri(input.uri, uri)) {
				tabs.push(tab);
			}
		}
	}
	if (tabs.length > 0) {
		await vscode.window.tabGroups.close(tabs, true);
	}
}

/**
 * 只读模式打开文本文件时，把它换成只读小段预览。
 * 只在"这个文件确实开了标签页"时动手 —— peek / diff / 后台打开一律不打扰。
 */
export function createReadonlyInterceptor(mode: ReadOnlyMode): vscode.Disposable {
	const pending = new Set<string>();

	return vscode.workspace.onDidOpenTextDocument(document => {
		if (!mode.enabled || document.uri.scheme !== 'file') {
			return;
		}
		if (HANDLED_ELSEWHERE.test(document.uri.path)) {
			return;
		}
		if (allowedNativeOpen.has(document.uri.toString())) {
			return;
		}
		if (hasCustomTab(document.uri, READONLY_VIEW_TYPE)) {
			return;
		}

		const key = document.uri.toString();
		if (pending.has(key)) {
			return;
		}

		const textTab = findTextTab(document.uri);
		if (!textTab) {
			return;
		}

		pending.add(key);
		void (async () => {
			try {
				await vscode.commands.executeCommand('vscode.openWith', document.uri, READONLY_VIEW_TYPE, vscode.ViewColumn.Active);
				await vscode.window.tabGroups.close(textTab);
			} catch {
				// 换不过去就保持原生编辑器，不打扰用户
			} finally {
				pending.delete(key);
			}
		})();
	});
}
