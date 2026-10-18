import * as vscode from 'vscode';
import {
	READONLY_VIEW_TYPE,
	associationsEqual,
	planApply,
	planRemove,
	readReadonlyGlobs,
	type EditorAssociations,
} from './associations';

const STATE_KEY = 'wispkit.readonly.enabled';
const TOGGLE_COMMAND = 'wispkit.toggleReadOnly';
const ASSOCIATIONS_SECTION = 'workbench';
const ASSOCIATIONS_KEY = 'editorAssociations';
/** 记住"哪些 glob 是我们写进去的" —— 关闭时照它删，才不会误删用户自己设的关联。 */
const APPLIED_KEY = 'wispkit.readonly.appliedAssociations';
const RELOAD_ACTION = '重载窗口';

export interface ReadOnlyMode extends vscode.Disposable {
	readonly enabled: boolean;
	readonly onDidChange: vscode.Event<boolean>;
	toggle(): Promise<void>;
	setEnabled(enabled: boolean): Promise<void>;
}

interface AssociationOutcome {
	/** 这次是否真的改了配置（没改就不用让用户重载窗口）。 */
	readonly changed: boolean;
	readonly error?: string;
}

/**
 * `workbench.editorAssociations` 是对象型设置：`update()` 会**整体替换**，
 * 所以必须先读出全部现有条目、在内存里合并，再整体写回 —— 否则会把用户已有的关联抹掉。
 */
async function updateAssociations(value: EditorAssociations): Promise<void> {
	const workbench = vscode.workspace.getConfiguration(ASSOCIATIONS_SECTION);
	try {
		await workbench.update(ASSOCIATIONS_KEY, value, vscode.ConfigurationTarget.Global);
	} catch (globalError) {
		// Global 写不进去（例如用户设置文件只读）时退到工作区级，至少当前工作区能生效
		if (!vscode.workspace.workspaceFolders?.length) {
			throw globalError;
		}
		await workbench.update(ASSOCIATIONS_KEY, value, vscode.ConfigurationTarget.Workspace);
	}
}

/**
 * 把「原生打开方式就是只读」落成 `workbench.editorAssociations`。
 * 这样 VS Code 直接用 `wispkit.text` 打开，**根本不会创建 TextDocument** ——
 * 既省加载消耗，也不存在被原生编辑器"绕过"的窗口。
 */
async function syncAssociations(context: vscode.ExtensionContext, enabled: boolean): Promise<AssociationOutcome> {
	const workbench = vscode.workspace.getConfiguration(ASSOCIATIONS_SECTION);
	const existing = (workbench.get<Record<string, string>>(ASSOCIATIONS_KEY) ?? {}) as EditorAssociations;

	try {
		if (enabled) {
			const globs = readReadonlyGlobs(vscode.workspace.getConfiguration('wispkit').get('readonly.extensions'));
			const plan = planApply(existing, globs, READONLY_VIEW_TYPE);
			const changed = !associationsEqual(existing, plan.next);
			if (changed) {
				await updateAssociations(plan.next);
			}
			// 即使这次没写（已经是目标状态），也要保住"这些是我们写的"这条记录
			await context.globalState.update(APPLIED_KEY, plan.applied);
			return { changed };
		}

		const applied = context.globalState.get<readonly string[]>(APPLIED_KEY, []);
		if (applied.length === 0) {
			return { changed: false };
		}
		const next = planRemove(existing, applied, READONLY_VIEW_TYPE);
		const changed = !associationsEqual(existing, next);
		if (changed) {
			await updateAssociations(next);
		}
		await context.globalState.update(APPLIED_KEY, []);
		return { changed };
	} catch (error) {
		return { changed: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * 全局只读模式：状态栏右侧的开关（`wispkit.toggleReadOnly`）。
 * 开关状态存在 `workspaceState`，没手动切过时回落到 `wispkit.readonly.default`（默认非只读）。
 */
export function createReadOnlyMode(context: vscode.ExtensionContext): ReadOnlyMode {
	const emitter = new vscode.EventEmitter<boolean>();
	const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusItem.command = TOGGLE_COMMAND;
	statusItem.name = 'Wispkit 只读模式';

	const isEnabled = (): boolean => {
		const stored = context.workspaceState.get<boolean>(STATE_KEY);
		return typeof stored === 'boolean'
			? stored
			: vscode.workspace.getConfiguration('wispkit').get<boolean>('readonly.default', false);
	};

	const refresh = (): void => {
		const enabled = isEnabled();
		statusItem.text = enabled ? '$(lock) 只读' : '$(unlock) 可编辑';
		statusItem.tooltip = enabled
			? 'Wispkit 全局只读模式：文本文件的原生打开方式就是只读视图（只加载开头一小段）。点击退出。'
			: 'Wispkit 当前可编辑。点击进入全局只读模式（打开文本只加载小段）。';
		statusItem.show();
	};

	const setEnabled = async (enabled: boolean): Promise<void> => {
		await context.workspaceState.update(STATE_KEY, enabled);
		refresh();
		emitter.fire(enabled);

		const outcome = await syncAssociations(context, enabled);
		if (outcome.error) {
			void vscode.window.showWarningMessage(
				`Wispkit：写入文件关联失败（${outcome.error}）。本次仍靠拦截生效，重载窗口后才是干净状态。`,
			);
			return;
		}

		if (!outcome.changed) {
			vscode.window.setStatusBarMessage(
				enabled ? 'Wispkit：已进入全局只读模式' : 'Wispkit：已退出全局只读模式',
				3000,
			);
			return;
		}

		// 关联的改动要重载窗口才生效 —— 这点必须说清楚，不能让用户以为"点了没反应"
		const choice = await vscode.window.showInformationMessage(
			enabled
				? 'Wispkit：已把文本文件的原生打开方式改为只读视图。重载窗口后，新打开的文件不再经过原生编辑器。'
				: 'Wispkit：已恢复文本文件的原生打开方式。重载窗口后生效。',
			RELOAD_ACTION,
		);
		if (choice === RELOAD_ACTION) {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	};

	refresh();

	// 启动时让关联与当前状态一致。多数情况是幂等的空操作；真改了就用状态栏提示（不打断输入）。
	void syncAssociations(context, isEnabled()).then(outcome => {
		if (outcome.changed && !outcome.error) {
			vscode.window.setStatusBarMessage('Wispkit：只读模式的文件关联已更新，重载窗口后生效。', 8000);
		}
	});

	context.subscriptions.push(
		statusItem,
		emitter,
		vscode.commands.registerCommand(TOGGLE_COMMAND, () => setEnabled(!isEnabled())),
		// 没手动切过时，改设置要立刻反映到状态栏
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('wispkit.readonly.default') && context.workspaceState.get(STATE_KEY) === undefined) {
				refresh();
			}
		}),
	);

	return {
		get enabled() {
			return isEnabled();
		},
		onDidChange: emitter.event,
		toggle: () => setEnabled(!isEnabled()),
		setEnabled,
		dispose: () => {
			// 资源已挂到 context.subscriptions
		},
	};
}
