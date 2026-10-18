/**
 * 聚合第三方扩展声明的 Markdown 预览扩展点。
 *
 * 契约来自 VS Code 的 `contributes` ——**键是扁平点号形式** `"markdown.previewScripts"`，
 * 不是嵌套的 `"markdown": { "previewScripts": ... }`。内置聚合代码读的也是扁平键
 * （extensions/markdown-language-features/src/markdownExtensions.ts:138,153,160）。
 *
 * 真实使用者（本机 1.137.0 内置扩展）：
 * - mermaid-markdown-features → `markdown.previewScripts` + `markdown.markdownItPlugins`
 * - markdown-math            → `markdown.previewStyles` + `markdown.markdownItPlugins`
 *
 * 本模块不 import vscode：输入是纯数据，输出保留贡献方身份，便于单测。
 */

/** 一个贡献方。`extensionUri` 用 `Uri.toString()`，避免把 vscode 类型带进纯逻辑。 */
export interface ContributingExtension {
	readonly packageJson: unknown;
	/** vscode.Extension.extensionUri.toString() */
	readonly extensionUri: string;
	/** vscode.Extension.id —— 用于按来源过滤（见 markdownProvider 的 INTERNAL_PREVIEW_EXTENSION_ID）。 */
	readonly id?: string;
}

export interface ResolvedPreviewScript {
	readonly extensionUri: string;
	readonly path: string;
	readonly type?: 'module';
	readonly extensionId?: string;
}

export interface ResolvedPreviewStyle {
	readonly extensionUri: string;
	readonly path: string;
}

export interface MarkdownContributions {
	readonly scripts: readonly ResolvedPreviewScript[];
	readonly styles: readonly ResolvedPreviewStyle[];
}

export const emptyMarkdownContributions: MarkdownContributions = { scripts: [], styles: [] };

function readContributes(packageJson: unknown): Record<string, unknown> | undefined {
	if (!packageJson || typeof packageJson !== 'object') {
		return undefined;
	}
	const contributes = (packageJson as Record<string, unknown>).contributes;
	if (!contributes || typeof contributes !== 'object') {
		return undefined;
	}
	return contributes as Record<string, unknown>;
}

/** 镜像 markdownExtensions.ts:334-352 的 getPreviewScriptContribution（`type` 只认 'module'）。 */
export function readPreviewScript(value: unknown): { path: string; type?: 'module' } | undefined {
	if (typeof value === 'string') {
		return { path: value, type: undefined };
	}
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.path !== 'string') {
		return undefined;
	}
	return {
		path: record.path,
		type: record.type === 'module' ? 'module' : undefined,
	};
}

export function collectMarkdownContributions(extensions: readonly ContributingExtension[]): MarkdownContributions {
	const scripts: ResolvedPreviewScript[] = [];
	const styles: ResolvedPreviewStyle[] = [];

	for (const extension of extensions) {
		const contributes = readContributes(extension.packageJson);
		if (!contributes) {
			continue;
		}

		const rawScripts = contributes['markdown.previewScripts'];
		if (Array.isArray(rawScripts)) {
			for (const raw of rawScripts) {
				const script = readPreviewScript(raw);
				if (script) {
					scripts.push({ extensionUri: extension.extensionUri, path: script.path, type: script.type, extensionId: extension.id });
				}
			}
		}

		const rawStyles = contributes['markdown.previewStyles'];
		if (Array.isArray(rawStyles)) {
			for (const raw of rawStyles) {
				if (typeof raw === 'string') {
					styles.push({ extensionUri: extension.extensionUri, path: raw });
				}
			}
		}
	}

	return { scripts, styles };
}

/**
 * 该扩展是否贡献了预览资源 —— 决定它的 extensionUri 要不要进 webview 的
 * localResourceRoots（镜像 markdownExtensions.ts:120）。
 */
export function hasMarkdownPreviewResources(packageJson: unknown): boolean {
	const contributes = readContributes(packageJson);
	if (!contributes) {
		return false;
	}
	const scripts = contributes['markdown.previewScripts'];
	const styles = contributes['markdown.previewStyles'];
	return (Array.isArray(scripts) && scripts.length > 0) || (Array.isArray(styles) && styles.length > 0);
}
