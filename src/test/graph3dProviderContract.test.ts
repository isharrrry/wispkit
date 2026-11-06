import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * provider 依赖 vscode，不能在 mocha 里实例化；这里锁定「打开」与「刷新」
 * 都必须走同一条图片解析管线，避免以后只在其中一条路径上挂图片。
 */
function providerSource(): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'graph3dProvider.ts'), 'utf8');
}

describe('graph3dProvider 图片解析契约', () => {
	it('打开与刷新共用 loadElements，且都经过 attachNodeImages', () => {
		const source = providerSource();
		assert.ok(source.includes("from './graph3d/nodeImages'"), '必须复用 nodeImages 模块');
		assert.ok(source.includes('await attachNodeImages('), 'loadElements 必须挂图片');
		assert.strictEqual((source.match(/await loadElements\(/g) ?? []).length, 2,
			'初始打开与刷新都要调用 loadElements（缺一个就会有一条路径没有图片）');
		assert.ok(!/extractElementsForSource\(kind, text, fallbackName\(uri\)\);\s*\n\s*const panel/.test(source),
			'create 不能再走未经图片解析的旧路径');
	});

	it('图片 IO 走 workspace.fs 的异步 stat / readFile', () => {
		const source = providerSource();
		assert.ok(source.includes('vscode.workspace.fs.stat'), '存在性检查必须用异步 stat');
		assert.ok(source.includes('vscode.workspace.fs.readFile'), '图片内容必须用异步 readFile');
		assert.ok(source.includes('vscode.FileType.File'), '目录不能当成图片文件读取');
		assert.ok(source.includes('baseDir: path.dirname('), '相对路径要基于源文件目录');
	});
});
