/** 子树视图里的一行。字段只保留能安全跨 webview 传递的原始类型（不传 vscode.Uri / Date）。 */
export interface TreeEntry {
	readonly name: string;
	readonly path: string;
	readonly isDirectory: boolean;
	readonly size: number;
	readonly mtime: number;
	readonly ctime: number;
	readonly atime: number;
	/** 权限位；Windows 上通常拿不到，0 表示未知。 */
	readonly mode: number;
}

/** 一行加载完的子项。前端按 path 缓存，避免重复读盘。 */
export interface TreeLevel {
	readonly path: string;
	readonly entries: readonly TreeEntry[];
	/** 读盘失败时的原因（权限、路径消失等），要在界面上可见地显示出来。 */
	readonly error?: string;
}
