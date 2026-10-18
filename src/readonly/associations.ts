/**
 * 全局只读模式的落地机制：把文本文件的**原生打开方式**关联到只读视图
 * （`workbench.editorAssociations`），让 VS Code 直接用 `wispkit.text` 打开 ——
 * 它用 `CustomEditorProvider`，**不创建 TextDocument**，所以省加载与防误改同时成立，
 * 也不会先闪一下原生编辑器再被替换掉。
 *
 * 本模块是纯逻辑（**不 import vscode**，便于单测）；读写配置的副作用在 `state.ts`。
 */

export const READONLY_VIEW_TYPE = 'wispkit.text';

/** `workbench.editorAssociations` 是「glob → viewType」的对象。 */
export type EditorAssociations = Readonly<Record<string, string>>;

/**
 * 默认覆盖的扩展名。
 * **不含** Wispkit 自己接管的浏览类型（`.md` / `.html` / `.xaml` / 图片）——
 * 那些本来就是浏览视图，而截断 Markdown 会渲染出残缺结果。
 */
export const DEFAULT_READONLY_GLOBS: readonly string[] = [
	'*.txt', '*.text', '*.log', '*.csv', '*.ini', '*.cfg', '*.conf', '*.properties',
	'*.json', '*.jsonc', '*.json5', '*.xml', '*.yml', '*.yaml', '*.toml',
	'*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.vue', '*.svelte',
	'*.py', '*.cs', '*.fs', '*.vb', '*.java', '*.kt', '*.go', '*.rs', '*.rb', '*.php', '*.swift', '*.lua', '*.pl',
	'*.c', '*.h', '*.cc', '*.cpp', '*.cxx', '*.hpp', '*.m', '*.mm',
	'*.sql', '*.sh', '*.bash', '*.zsh', '*.ps1', '*.psm1', '*.bat', '*.cmd', '*.gradle',
	'*.css', '*.scss', '*.less', '*.styl', '*.diff', '*.patch',
];

/** 从配置值里取出可用的 glob 列表；配歪了（非数组 / 空数组 / 全是空白）就回退默认集合。 */
export function readReadonlyGlobs(configured: unknown): readonly string[] {
	if (!Array.isArray(configured)) {
		return DEFAULT_READONLY_GLOBS;
	}
	const cleaned = configured
		.filter((item): item is string => typeof item === 'string')
		.map(item => item.trim())
		.filter(item => item.length > 0);
	return cleaned.length > 0 ? cleaned : DEFAULT_READONLY_GLOBS;
}

export interface AssociationPlan {
	/** **我们实际占了哪些 glob** —— 关闭时要照着它删，才不会误删用户自己设的。 */
	readonly applied: readonly string[];
	readonly next: EditorAssociations;
}

/**
 * 算出该写入什么，以及"我们实际占了哪些 glob"。
 *
 * 用户已经给某个 glob 指定过**别的** viewType 就跳过它 —— 绝不抢用户的既有配置。
 * 值已经是我们的 viewType 时仍记进 `applied`，这样重复开关不会丢掉"这些是我们写的"这个事实。
 */
export function planApply(
	existing: EditorAssociations,
	globs: readonly string[],
	viewType: string = READONLY_VIEW_TYPE,
): AssociationPlan {
	const applied: string[] = [];
	const next: Record<string, string> = { ...existing };

	for (const glob of globs) {
		const current = existing[glob];
		if (current !== undefined && current !== viewType) {
			continue;
		}
		applied.push(glob);
		next[glob] = viewType;
	}

	return { applied, next };
}

/** 只删「我们写过的 glob」且**值仍是我们写的**（用户后来改过的要留着）。 */
export function planRemove(
	existing: EditorAssociations,
	applied: readonly string[],
	viewType: string = READONLY_VIEW_TYPE,
): EditorAssociations {
	const next: Record<string, string> = { ...existing };
	for (const glob of applied) {
		if (next[glob] === viewType) {
			delete next[glob];
		}
	}
	return next;
}

/** 用于判断"这次写入是否真的改变了什么"，避免无谓写配置、无谓提示重载。 */
export function associationsEqual(a: EditorAssociations, b: EditorAssociations): boolean {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	return keysA.length === keysB.length && keysA.every(key => a[key] === b[key]);
}
