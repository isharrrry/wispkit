import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { renderSubtreePage, type SubtreeViewConfig } from '../subtree/page';
import { renderComparePage, type CompareViewConfig } from '../compare/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';

const CSP_SOURCE = 'vscode-webview://abc';
const ROOT = 'C:\\demo';
const SUB = `${ROOT}\\sub`;
const FILE = `${ROOT}\\a.txt`;

const COMMANDS = [
	{ id: 'wispkit.subtree.rename', label: '重命名', kind: 'native', source: 'wispkit', group: 'edit', icon: 'rename', appliesTo: 'single', disabledReason: '重命名一次只能作用于一个条目' },
	{ id: 'wispkit.subtree.newFile', label: '新建文件', kind: 'native', source: 'wispkit', group: 'edit', icon: 'new-file', appliesTo: 'folders', disabledReason: '新建文件需要选中一个文件夹' },
	{ id: 'copyFilePath', label: '复制绝对路径', kind: 'builtin', source: 'builtin', group: 'path', icon: 'link', appliesTo: 'any' },
	{ id: 'revealInExplorer', label: '在资源管理器中显示', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'reveal', appliesTo: 'single' },
	{ id: 'demo.doThing', label: '做点事', kind: 'extension', source: 'demo.ext', group: 'extension', icon: 'extension', appliesTo: 'any' },
];

const SUBTREE_CONFIG: SubtreeViewConfig = {
	rootPath: ROOT,
	rootName: 'demo',
	owner: 'tester',
	columns: [{ id: 'name', label: '名称', align: 'left', width: 280 }],
	commands: COMMANDS,
	tools: [{ label: '打开终端', command: 'cmd', shell: 'newTerminal' }],
	sort: { key: 'name', direction: 'asc' },
};

const COMPARE_CONFIG: CompareViewConfig = {
	panes: [
		{ id: 'left', root: ROOT, title: '左侧' },
		{ id: 'right', root: ROOT, title: '右侧' },
	],
	columns: [{ id: 'name', label: '名称', align: 'left', width: 260 }],
	locationGroups: [],
	commands: COMMANDS,
};

const LEVEL = [
	{ name: 'sub', path: SUB, isDirectory: true, parentPath: ROOT, cells: { name: 'sub' } },
	{ name: 'a.txt', path: FILE, isDirectory: false, parentPath: ROOT, cells: { name: 'a.txt' } },
];

function subtreePage(): string {
	return renderSubtreePage({
		title: 'demo',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: `${CSP_SOURCE}/subtree.js`,
		runtimeStyle: `${CSP_SOURCE}/subtree.css`,
		config: SUBTREE_CONFIG,
	});
}

function comparePage(): string {
	return renderComparePage({
		title: '对比浏览',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: `${CSP_SOURCE}/compare.js`,
		runtimeStyle: `${CSP_SOURCE}/compare.css`,
		baseStyle: `${CSP_SOURCE}/subtree.css`,
		config: COMPARE_CONFIG,
	});
}

function installStorage(dom: JSDOM): void {
	Object.defineProperty(dom.window, 'localStorage', {
		configurable: true,
		value: {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
			clear: () => undefined,
		},
	});
}

function setupSubtree(): { dom: JSDOM; api: any; messages: any[] } {
	const dom = installDom(subtreePage());
	installStorage(dom);
	const messages: any[] = [];
	(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
		postMessage: (message: any) => messages.push(message),
	});
	loadMediaModule('media/subtree.js');
	const api = (dom.window as unknown as { __wispkitSelftest: any }).__wispkitSelftest;
	api.applyLevel(ROOT, LEVEL);
	return { dom, api, messages };
}

function setupCompare(): { dom: JSDOM; api: any; messages: any[] } {
	const dom = installDom(comparePage());
	const messages: any[] = [];
	(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
		postMessage: (message: any) => messages.push(message),
	});
	loadMediaModule('media/compare.js');
	const api = (dom.window as unknown as { __wispkitCompareSelftest: any }).__wispkitCompareSelftest;
	api.applyLevel('left', ROOT, LEVEL);
	api.applyLevel('right', ROOT, LEVEL);
	return { dom, api, messages };
}

afterEach(() => {
	delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

describe('子树浏览右键菜单', () => {
	it('右键文件夹列出右侧操作项与工具，且每项都有图标', () => {
		const { api } = setupSubtree();
		assert.strictEqual(api.openContextMenu(SUB), true);

		const menu = api.contextMenu();
		assert.ok(menu.open);
		for (const label of ['展开', '展开一层', '重命名', '新建文件', '复制绝对路径', '在资源管理器中显示', '做点事', '打开终端']) {
			assert.ok(menu.labels.includes(label), `菜单里应当有「${label}」`);
		}
		assert.strictEqual(menu.icons.length, menu.labels.length);
		assert.ok(menu.icons.every((href: string) => href.startsWith('#wispkit-icon-')), '每个菜单项都要有图标');
		assert.ok(menu.icons.includes('#wispkit-icon-rename'));
		assert.ok(menu.icons.includes('#wispkit-icon-terminal'));
	});

	it('右键文件也能用「新建文件」：宿主会把目标解析成它的父目录', () => {
		const { api, messages } = setupSubtree();
		api.openContextMenu(FILE);
		assert.strictEqual(api.contextMenu().disabled.includes('新建文件'), false, '右键文件时新建文件不应置灰');
		assert.strictEqual(api.clickContextMenu('新建文件'), true);
		const message = messages.filter(item => item.type === 'wispkit.subtree.fileAction').pop();
		assert.ok(message);
		assert.strictEqual(message.action, 'wispkit.subtree.newFile');
		assert.deepStrictEqual(message.paths, [FILE]);
	});

	it('右键空白处作用于根目录（无选中），并提供刷新 / 全部折叠', () => {
		const { api } = setupSubtree();
		api.openContextMenu(null);
		const menu = api.contextMenu();
		assert.ok(menu.labels.includes('刷新'));
		assert.ok(menu.labels.includes('全部折叠'));
		assert.strictEqual(api.selectedPaths().length, 0);
	});

	it('点击菜单项执行对应命令，菜单关闭', () => {
		const { api, messages } = setupSubtree();
		api.openContextMenu(FILE);
		assert.strictEqual(api.clickContextMenu('复制绝对路径'), true);
		const message = messages.filter(item => item.type === 'wispkit.subtree.command').pop();
		assert.ok(message);
		assert.strictEqual(message.command, 'copyFilePath');
		assert.deepStrictEqual(message.paths, [FILE]);
		assert.strictEqual(api.contextMenu().open, false);
	});
});

describe('对比浏览右键菜单', () => {
	it('右键行列出同一份文件操作，并带图标', () => {
		const { api } = setupCompare();
		assert.strictEqual(api.openContextMenu('left', FILE), true);
		const menu = api.contextMenu();
		for (const label of ['打开', '重命名', '新建文件', '复制绝对路径', '在资源管理器中显示', '做点事']) {
			assert.ok(menu.labels.includes(label), `菜单里应当有「${label}」`);
		}
		assert.strictEqual(menu.icons.length, menu.labels.length);
		assert.ok(menu.icons.every((href: string) => href.startsWith('#wispkit-icon-')));
		assert.strictEqual(api.selection('left'), FILE, '右键未选中行应先选中它');
	});

	it('点击重命名发出 fileAction，对象是右键的那一行', () => {
		const { api, messages } = setupCompare();
		api.openContextMenu('left', FILE);
		assert.strictEqual(api.clickContextMenu('重命名'), true);
		const message = messages.filter(item => item.type === 'wispkit.compare.fileAction').pop();
		assert.ok(message);
		assert.strictEqual(message.pane, 'left');
		assert.strictEqual(message.action, 'wispkit.subtree.rename');
		assert.deepStrictEqual(message.paths, [FILE]);
	});

	it('右键文件夹时「新建文件」「粘贴」可用；右键文件时也不置灰', () => {
		const { api } = setupCompare();
		api.openContextMenu('left', SUB);
		assert.strictEqual(api.contextMenu().disabled.includes('新建文件'), false);
		api.closeContextMenu();
		api.openContextMenu('left', FILE);
		assert.strictEqual(api.contextMenu().disabled.includes('新建文件'), false);
	});

	it('右键空白处提供刷新，并清空该侧选中', () => {
		const { api } = setupCompare();
		api.selection('left');
		api.openContextMenu('left', null);
		assert.ok(api.contextMenu().labels.includes('刷新'));
		assert.strictEqual(api.selection('left'), null);
	});
});
