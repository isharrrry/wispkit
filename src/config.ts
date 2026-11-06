import * as vscode from 'vscode';
import type { ImageViewConfig } from './image/page';
import type { MarkdownTypography, MarkdownViewConfig } from './markdown/page';
import type { XamlViewConfig } from './xaml/page';

function numberSetting(config: vscode.WorkspaceConfiguration, key: string, fallback: number, minimum: number): number {
	const value = config.get<number>(key);
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function dragButtonSetting(config: vscode.WorkspaceConfiguration): 'left' | 'right' | 'middle' {
	const dragButton = config.get<string>('image.dragButton', 'right');
	return dragButton === 'left' || dragButton === 'middle' ? dragButton : 'right';
}

export function readMarkdownViewConfig(): MarkdownViewConfig {
	const config = vscode.workspace.getConfiguration('wispkit');
	return {
		tocEnabled: config.get<boolean>('toc.enabled', true),
		tocDepth: numberSetting(config, 'toc.depth', 6, 1),
	};
}

/**
 * 正文排版沿用内置预览的三个设置，并且**照抄内置换算**（documentRenderer.ts:211-213）：
 * fontSize 拼 `px`，lineHeight 原样输出（数字即字号倍数），缺省则整条不输出、
 * 让 markdown.css 里的 `var(..., 22px)` 兜底。
 */
export function readMarkdownPreviewTypography(): MarkdownTypography {
	const config = vscode.workspace.getConfiguration('markdown.preview');

	const fontFamily = config.get<string>('fontFamily');
	const fontSize = config.get<number>('fontSize');
	const lineHeight = config.get<string | number>('lineHeight');

	return {
		fontFamily: typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily.trim() : undefined,
		fontSize: typeof fontSize === 'number' && Number.isFinite(fontSize) ? fontSize : undefined,
		lineHeight: typeof lineHeight === 'number' && Number.isFinite(lineHeight)
			? String(lineHeight)
			: typeof lineHeight === 'string' && lineHeight.trim()
				? lineHeight.trim()
				: undefined,
	};
}

export function readImageViewConfig(): ImageViewConfig {
	const config = vscode.workspace.getConfiguration('wispkit');
	return {
		wheelZoom: config.get<boolean>('image.wheelZoom', true),
		wheelStep: numberSetting(config, 'zoom.wheelStep', 1.1, 1.01),
		dragButton: dragButtonSetting(config),
	};
}

export function readXamlViewConfig(): XamlViewConfig {
	const config = vscode.workspace.getConfiguration('wispkit');
	return {
		wheelStep: numberSetting(config, 'zoom.wheelStep', 1.1, 1.01),
		dragButton: dragButtonSetting(config),
		codeVisible: config.get<boolean>('xaml.codeVisible', true),
		codeWidth: numberSetting(config, 'xaml.codeWidth', 460, 120),
	};
}
