/**
 * `.lnk` 的「简单编辑」。
 *
 * 二进制层面重写整个 Shell Link 会丢掉图标、热键、IDList 等一大堆字段；这里改走
 * `WScript.Shell.CreateShortcut` —— 它打开**已有**快捷方式后只覆盖指定字段再保存，
 * 其余内容原样保留，这也是 Windows 自己的做法。
 */
export interface ShortcutEdits {
	readonly targetPath?: string;
	readonly arguments?: string;
	readonly workingDirectory?: string;
	readonly description?: string;
}

export function psLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function hasShortcutEdits(edits: ShortcutEdits): boolean {
	return edits.targetPath !== undefined
		|| edits.arguments !== undefined
		|| edits.workingDirectory !== undefined
		|| edits.description !== undefined;
}

export function buildShortcutRewriteScript(shortcutPath: string, edits: ShortcutEdits): string {
	const lines = [
		"$ErrorActionPreference = 'Stop'",
		`$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut(${psLiteral(shortcutPath)})`,
	];
	if (edits.targetPath !== undefined) {
		lines.push(`$shortcut.TargetPath = ${psLiteral(edits.targetPath)}`);
	}
	if (edits.arguments !== undefined) {
		lines.push(`$shortcut.Arguments = ${psLiteral(edits.arguments)}`);
	}
	if (edits.workingDirectory !== undefined) {
		lines.push(`$shortcut.WorkingDirectory = ${psLiteral(edits.workingDirectory)}`);
	}
	if (edits.description !== undefined) {
		lines.push(`$shortcut.Description = ${psLiteral(edits.description)}`);
	}
	lines.push('$shortcut.Save()');
	return lines.join('\n');
}

export interface ShortcutEditForm {
	readonly targetPath: string;
	readonly arguments: string;
	readonly workingDirectory: string;
	readonly description: string;
}

/**
 * 把界面表单换算成「真正需要写回」的字段。
 *
 * 只把**与原值不同**的字段放进结果：没动的字段不参与写回，避免
 * `CreateShortcut` 把用户手工设置过、但我们解析不到的内容覆盖成空串。
 */
export function diffShortcutEdits(
	form: ShortcutEditForm,
	current: { readonly targetPath?: string; readonly arguments?: string; readonly workingDirectory?: string; readonly description?: string },
): ShortcutEdits {
	const edits: { targetPath?: string; arguments?: string; workingDirectory?: string; description?: string } = {};
	const compare = (next: string, previous: string | undefined): string | undefined =>
		next === (previous ?? '') ? undefined : next;
	const targetPath = compare(form.targetPath, current.targetPath);
	if (targetPath !== undefined) {
		edits.targetPath = targetPath;
	}
	const args = compare(form.arguments, current.arguments);
	if (args !== undefined) {
		edits.arguments = args;
	}
	const workingDirectory = compare(form.workingDirectory, current.workingDirectory);
	if (workingDirectory !== undefined) {
		edits.workingDirectory = workingDirectory;
	}
	const description = compare(form.description, current.description);
	if (description !== undefined) {
		edits.description = description;
	}
	return edits;
}
