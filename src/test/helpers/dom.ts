import * as assert from 'assert';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

/** 从编译产物位置向上找项目根（含 package.json 的目录），避免依赖 __dirname 的相对层级。 */
function projectRoot(): string {
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

/** media/ 下的前端模块是 ESM；测试跑在 CommonJS 里，用 esbuild 打包成 CJS 后求值（bundle 让模块间的相对 import 也能解析）。 */
export function loadMediaModule(relativePath: string): any {
	const result = esbuild.buildSync({
		entryPoints: [path.join(projectRoot(), relativePath)],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'es2020',
		write: false,
		logLevel: 'silent',
	});
	const moduleScope: { exports: any } = { exports: {} };
	new Function('module', 'exports', 'require', result.outputFiles[0].text)(moduleScope, moduleScope.exports, require);
	return moduleScope.exports;
}

export function installDom(html: string): JSDOM {
	const dom = new JSDOM(html, { pretendToBeVisual: true });
	const globalScope = globalThis as any;
	globalScope.window = dom.window;
	globalScope.document = dom.window.document;
	globalScope.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
	globalScope.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
	globalScope.CustomEvent = dom.window.CustomEvent;
	return dom;
}

/** jsdom 没实现 scrollIntoView，用 stub 记录谁被滚到了。 */
export function stubScrollIntoView(dom: JSDOM): { scrolled: string[] } {
	const record = { scrolled: [] as string[] };
	(dom.window.HTMLElement.prototype as any).scrollIntoView = function (this: HTMLElement) {
		record.scrolled.push(this.id || this.textContent || '');
	};
	return record;
}

export function dispatchMouse(target: any, type: string, init: Record<string, unknown>): void {
	const event = new (globalThis as any).window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
	if (init.pointerId !== undefined) {
		Object.defineProperty(event, 'pointerId', { value: init.pointerId });
	}
	target.dispatchEvent(event);
}

export function dispatchWheel(target: any, init: Record<string, unknown>): void {
	const event = new (globalThis as any).window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(event);
}

export function parseScale(image: any): number {
	const match = /scale\(([\d.]+)\)/.exec(image.style.transform || '');
	assert.ok(match, `transform 里应当有 scale()，实际为 "${image.style.transform}"`);
	return Number(match[1]);
}

export function parseTranslate(image: any): { x: number; y: number } {
	const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(image.style.transform || '');
	assert.ok(match, `transform 里应当有 translate()，实际为 "${image.style.transform}"`);
	return { x: Number(match[1]), y: Number(match[2]) };
}
