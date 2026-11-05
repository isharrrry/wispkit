import * as fs from 'fs';
import * as path from 'path';

/** 从编译产物位置向上找项目根（含 package.json 的目录），避免依赖 __dirname 的相对层级。 */
export function projectRoot(): string {
	let dir = __dirname;
	for (;;) {
		if (fs.existsSync(path.join(dir, 'package.json'))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`找不到项目根（从 ${__dirname} 起）`);
		}
		dir = parent;
	}
}

export function readJson(relativePath: string): any {
	return JSON.parse(fs.readFileSync(path.join(projectRoot(), relativePath), 'utf8'));
}

function localize(value: any, translations: Record<string, string>, source: string): any {
	if (typeof value === 'string') {
		return value.replace(/%([^%]+)%/g, (_match, key: string) => {
			if (!(key in translations)) {
				throw new Error(`${source} 中不存在 package.json 引用的键：%${key}%`);
			}
			return translations[key];
		});
	}
	if (Array.isArray(value)) {
		return value.map(item => localize(item, translations, source));
	}
	if (value && typeof value === 'object') {
		const result: Record<string, any> = {};
		for (const [key, item] of Object.entries(value)) {
			result[key] = localize(item, translations, source);
		}
		return result;
	}
	return value;
}

/**
 * 读 package.json 并按 VS Code 的规则把 `%key%` 换成 `package.nls.json` 里的文案。
 * 传 `'zh-cn'` 时改用 `package.nls.zh-cn.json`，用来验证中文 locale 的显示。
 */
export function localizedManifest(locale?: string): any {
	const translationsFile = locale ? `package.nls.${locale}.json` : 'package.nls.json';
	return localize(readJson('package.json'), readJson(translationsFile), translationsFile);
}
