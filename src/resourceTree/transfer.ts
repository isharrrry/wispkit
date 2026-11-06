import { countStoreNodes, parseStoreJson, type ResourceTreeStore } from './model';

/**
 * 导入 / 导出的纯逻辑（不 import vscode）。
 *
 * 命令层只负责选文件、弹确认框和写盘；「这段文本能不能导入、导入后有多少节点、
 * 要提示哪些修复」在这里决定，便于在 mocha 里验证非法文件不会替换当前树。
 */

export const WARNING_PREVIEW_LIMIT = 3;

export interface ImportPlan {
	/** false 表示文件不可导入（非法 JSON / 顶层结构不对），调用方必须保留当前树。 */
	readonly ok: boolean;
	readonly store?: ResourceTreeStore;
	readonly warnings: readonly string[];
	readonly nodeCount: number;
	readonly error?: string;
	/** 替换前的 modal 确认文案（ok 时才有）。 */
	readonly confirmMessage?: string;
	/** 有警告时在确认前展示的提示文案。 */
	readonly warningMessage?: string;
}

export function warningPreview(warnings: readonly string[], limit = WARNING_PREVIEW_LIMIT): string {
	return warnings.slice(0, limit).join('；');
}

export function planImport(text: string, currentCount: number): ImportPlan {
	const parsed = parseStoreJson(text);
	if (parsed.error) {
		return {
			ok: false,
			warnings: parsed.warnings,
			nodeCount: 0,
			error: parsed.error,
		};
	}
	const nodeCount = countStoreNodes(parsed.store);
	return {
		ok: true,
		store: parsed.store,
		warnings: parsed.warnings,
		nodeCount,
		confirmMessage: `导入将替换当前资源树（当前 ${currentCount} 个节点）为 ${nodeCount} 个节点。是否继续？`,
		warningMessage: parsed.warnings.length > 0
			? `导入文件有 ${parsed.warnings.length} 处问题（已尽力修复）：${warningPreview(parsed.warnings)}`
			: undefined,
	};
}
