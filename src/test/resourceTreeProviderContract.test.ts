import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * provider 依赖 vscode，不能在普通 mocha 里实例化；这里用源码契约锁定
 * 「getTreeItem 不做同步 IO」这条性能要求，防止以后又改回 `fs.statSync`。
 */
function providerSource(): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'resourceTreeProvider.ts'), 'utf8');
}

describe('resourceTreeProvider 文件夹状态 IO 契约', () => {
	it('getTreeItem 只读缓存，不含同步 stat / 直接 fs 调用', () => {
		const source = providerSource();
		assert.ok(!source.includes('statSync'), 'provider 不应再出现 statSync');
		const start = source.indexOf('public getTreeItem');
		const end = source.indexOf('public getChildren', start);
		assert.ok(start >= 0 && end > start, '源码里应能定位 getTreeItem');
		const body = source.slice(start, end);
		assert.ok(body.includes('cachedFolderState'), 'getTreeItem 必须走缓存查询');
		assert.ok(!/\bfs\./.test(body), 'getTreeItem 内部不能直接调用 node:fs');
	});

	it('异步预取使用 workspace.fs.stat，并配置 TTL / 上限 / 并发', () => {
		const source = providerSource();
		assert.ok(source.includes('vscode.workspace.fs.stat'), '应使用 workspace.fs.stat 异步检查');
		assert.ok(source.includes('ttlMs: 30_000'), 'TTL 应为 30s');
		assert.ok(source.includes('maxEntries: 2000'), '缓存上限应不超过节点上限 2000');
		assert.ok(source.includes('maxConcurrency: 8'), '批量 stat 并发上限应为 8');
	});

	it('「在终端中打开」命令已注册，终端名取显示名 / 别名，cwd 指向文件夹', () => {
		const source = providerSource();
		assert.ok(
			source.includes("registerCommand('wispkit.resourceTree.openTerminal'"),
			'package.json 里的内联按钮必须有对应命令注册，否则点击会报 command not found',
		);
		assert.ok(source.includes('terminalNameFor(node)'), '终端标签必须走别名 / 文件夹名规则');
		assert.ok(source.includes('cwd: uri'), '终端 cwd 必须指向该文件夹');
		assert.ok(source.includes('terminal.show()'), '创建后应弹出终端面板');
	});

	it('文件夹右键菜单的新命令全部注册，并且都先经过文件夹校验', () => {
		const source = providerSource();
		for (const command of [
			'wispkit.resourceTree.copyPath',
			'wispkit.resourceTree.openInVSCode',
			'wispkit.resourceTree.openInSystemExplorer',
			'wispkit.resourceTree.systemTerminal.cmd',
			'wispkit.resourceTree.systemTerminal.powerShell',
			'wispkit.resourceTree.systemTerminal.cmdAdmin',
			'wispkit.resourceTree.systemTerminal.powerShellAdmin',
			'wispkit.resourceTree.systemTerminal.terminalApp',
			'wispkit.resourceTree.systemTerminal.linux',
		]) {
			assert.ok(source.includes(`registerCommand('${command}'`), `缺少命令注册：${command}`);
		}
		assert.ok(source.includes("executeCommand('vscode.openFolder', uri, { forceNewWindow: true })"),
			'在 VS Code 中打开必须强制新窗口，不能替换当前工作区');
		assert.ok(source.includes('vscode.env.clipboard.writeText'), '复制路径必须写系统剪贴板');
		assert.ok(source.includes('vscode.env.openExternal(uri)'), '系统资源管理器应交给操作系统打开');
		assert.ok(source.includes('launchSystemTerminal(kind, uri.fsPath)'), '系统终端必须走统一的启动层');
	});

	it('复制路径不做 stat：文件夹离线时仍可复制', () => {
		const source = providerSource();
		const start = source.indexOf('async function copyPathCommand');
		const end = source.indexOf('async function openInVSCodeCommand', start);
		assert.ok(start >= 0 && end > start, '源码里应能定位 copyPathCommand');
		const body = source.slice(start, end);
		assert.ok(body.includes('folderPath('), '复制路径只需解析占位符');
		assert.ok(!body.includes('folderTarget('), '复制路径不应要求目录当前存在');
	});
});
