import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { renderComparePage, type CompareViewConfig } from '../compare/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';
import { localizedManifest } from './helpers/manifest';

const CSP_SOURCE = 'vscode-webview://abc';
const LEFT = 'C:\\Users\\tester\\Desktop';
const RIGHT = 'C:\\Users\\tester\\AppData\\Roaming\\Microsoft\\Windows\\Recent';
const SUB = `${LEFT}\\sub`;
const FILE = `${LEFT}\\a.txt`;

const CONFIG: CompareViewConfig = {
	panes: [
		{ id: 'left', root: LEFT, title: '桌面', note: '左侧默认位置' },
		{ id: 'right', root: RIGHT, title: '最近使用' },
	],
	columns: [
		{ id: 'name', label: '名称', align: 'left', width: 260 },
		{ id: 'size', label: '大小', align: 'right', width: 90 },
		{ id: 'mtime', label: '修改时间', align: 'left', width: 150 },
	],
	locationGroups: [
		{
			title: '常用位置',
			locations: [
				{ label: '桌面', path: LEFT, description: LEFT, kind: 'common' },
				{ label: '最近使用', path: RIGHT, description: RIGHT, kind: 'common' },
			],
		},
	],
};

function pageHtml(config: CompareViewConfig = CONFIG): string {
	return renderComparePage({
		title: '对比浏览',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: `${CSP_SOURCE}/compare.js`,
		runtimeStyle: `${CSP_SOURCE}/compare.css`,
		baseStyle: `${CSP_SOURCE}/subtree.css`,
		config,
	});
}

interface Message {
	readonly type: string;
	readonly pane?: string;
	readonly path?: string;
	readonly input?: string;
	readonly root?: string;
}

function setupPage(config: CompareViewConfig = CONFIG): {
	dom: JSDOM;
	doc: Document;
	api: any;
	messages: Message[];
} {
	const dom = installDom(pageHtml(config));
	const messages: Message[] = [];
	(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
		postMessage: (message: Message) => messages.push(message),
	});
	loadMediaModule('media/compare.js');
	const api = (dom.window as unknown as { __wispkitCompareSelftest: any }).__wispkitCompareSelftest;
	assert.ok(api, 'compare.js 应暴露 __wispkitCompareSelftest');
	return { dom, doc: dom.window.document, api, messages };
}

afterEach(() => {
	delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

describe('compare/page', () => {
	it('CSP、nonce、配置 meta 与两侧结构都落地', () => {
		const html = pageHtml();
		assert.ok(html.includes(`script-src 'nonce-NONCE1'`));
		assert.ok(html.includes(`src="vscode-webview://abc/compare.js" nonce="NONCE1"`));
		assert.ok(html.includes('id="wispkit-compare-config"'));
		assert.ok(/data-wispkit="[^"]*"C:\\\\Users\\\\tester\\\\Desktop"/.test(html) || html.includes('Desktop'));
		assert.ok(!html.includes('data-settings'), 'data-settings 会被内置 markdown 预览脚本抢走');
		for (const id of [
			'wispkit-compare-main',
			'wispkit-compare-splitter',
			'wispkit-compare-pane-left',
			'wispkit-compare-pane-right',
			'wispkit-compare-input-left',
			'wispkit-compare-input-right',
			'wispkit-compare-dropdown-left',
			'wispkit-compare-dropdown-right',
			'wispkit-compare-rows-left',
			'wispkit-compare-rows-right',
		]) {
			assert.ok(html.includes(`id="${id}"`), `缺少 ${id}`);
		}
		const leftIndex = html.indexOf('id="wispkit-compare-pane-left"');
		const splitIndex = html.indexOf('id="wispkit-compare-splitter"');
		const rightIndex = html.indexOf('id="wispkit-compare-pane-right"');
		assert.ok(leftIndex < splitIndex && splitIndex < rightIndex, '分隔条必须在左右面板之间');
	});

	it('页面里没有重复 id，列宽变量来自配置', () => {
		const html = pageHtml();
		const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
		const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
		assert.deepStrictEqual(duplicated, [], `重复 id：${duplicated.join(', ')}`);
		assert.ok(html.includes('--wispkit-col-name:260px'));
		assert.ok(html.includes('--wispkit-col-mtime:150px'));
		assert.ok(html.includes('media/subtree.css') || html.includes('subtree.css'));
	});
});

describe('media/compare.js', () => {
	it('打开时左右各自请求自己的默认根目录', () => {
		const { api, messages } = setupPage();
		assert.deepStrictEqual(api.panes(), ['left', 'right']);
		const reads = messages.filter(message => message.type === 'wispkit.compare.read');
		assert.strictEqual(reads.length, 2);
		const byPane = new Map(reads.map(read => [read.pane, read.path]));
		assert.strictEqual(byPane.get('left'), LEFT);
		assert.strictEqual(byPane.get('right'), RIGHT);
		assert.strictEqual(api.inputValue('left'), LEFT);
		assert.strictEqual(api.inputValue('right'), RIGHT);
	});

	it('两侧层级互不影响', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [
			{ name: 'sub', path: SUB, isDirectory: true, cells: { name: 'sub', size: '-', mtime: '-' } },
			{ name: 'a.txt', path: FILE, isDirectory: false, cells: { name: 'a.txt', size: '1 B', mtime: '-' } },
		]);
		assert.strictEqual(api.rowCount('left'), 2);
		assert.strictEqual(api.rowCount('right'), 0);
		assert.deepStrictEqual(api.rows('left').map((row: any) => row.cells[0]), ['sub', 'a.txt']);

		api.applyLevel('right', RIGHT, [
			{ name: 'recent.lnk', path: `${RIGHT}\\recent.lnk`, isDirectory: false, cells: { name: 'recent.lnk', size: '2 B', mtime: '-' } },
		]);
		assert.strictEqual(api.rowCount('right'), 1);
		assert.strictEqual(api.rowCount('left'), 2, '右侧数据不应影响左侧');
	});

	it('展开文件夹只请求该侧该层，并插入到正确层级', () => {
		const { api, doc, messages } = setupPage();
		api.applyLevel('left', LEFT, [
			{ name: 'sub', path: SUB, isDirectory: true, cells: { name: 'sub', size: '-', mtime: '-' } },
		]);
		messages.length = 0;
		const twisty = doc.querySelector('#wispkit-compare-rows-left .wispkit-subtree-twisty');
		assert.ok(twisty);
		(twisty as HTMLElement).click();
		const read = messages.find(message => message.type === 'wispkit.compare.read');
		assert.ok(read);
		assert.strictEqual(read.pane, 'left');
		assert.strictEqual(read.path, SUB);

		api.applyLevel('left', SUB, [
			{ name: 'deep.md', path: `${SUB}\\deep.md`, isDirectory: false, cells: { name: 'deep.md', size: '1 B', mtime: '-' } },
		]);
		const rows = api.rows('left');
		assert.strictEqual(rows.length, 2);
		assert.strictEqual(rows[1].depth, 1);
		assert.strictEqual(rows[1].cells[0], 'deep.md');
	});

	it('输入路径回车 / 点跳转都发出 navigate 消息', () => {
		const { api, doc } = setupPage();
		const input = doc.getElementById('wispkit-compare-input-left') as HTMLInputElement;
		api.clearLastMessage();
		input.value = 'C:\\Users\\tester\\Documents';
		input.dispatchEvent(new (doc.defaultView as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		assert.deepStrictEqual(api.lastMessage(), {
			type: 'wispkit.compare.navigate',
			pane: 'left',
			input: 'C:\\Users\\tester\\Documents',
		});

		api.clearLastMessage();
		const go = doc.getElementById('wispkit-compare-go-right');
		assert.ok(go);
		(go as HTMLElement).click();
		const message = api.lastMessage();
		assert.strictEqual(message.type, 'wispkit.compare.navigate');
		assert.strictEqual(message.pane, 'right');
		assert.strictEqual(message.input, RIGHT);
	});

	it('下拉包含资源树候选，点击候选即跳转；不可解析项置灰', () => {
		const { api, doc } = setupPage();
		assert.strictEqual(api.toggleLocations('left'), true);
		const groups = [
			{
				title: '自定义资源管理',
				locations: [
					{ label: '项目 / 源码', path: 'C:\\work\\src', description: 'C:\\work\\src', kind: 'resourceTree' },
					{ label: '项目 / 失效', path: '', description: '${workspaceFolder:missing}/x（无法解析）', kind: 'resourceTree' },
				],
			},
		];
		api.applyLocations(groups);
		const locations = api.locations('left');
		assert.deepStrictEqual(locations.map((item: any) => item.label), ['项目 / 源码', '项目 / 失效']);
		assert.strictEqual(locations[1].disabled, true, '无法解析的候选项必须置灰');

		api.clearLastMessage();
		assert.strictEqual(api.clickLocation('left', 'C:\\work\\src'), true);
		assert.deepStrictEqual(api.lastMessage(), {
			type: 'wispkit.compare.navigate',
			pane: 'left',
			input: 'C:\\work\\src',
		});
		assert.ok(doc.getElementById('wispkit-compare-locations-left')?.hasAttribute('hidden'));
	});

	it('宿主回包 root 时清空该侧旧层级与展开状态，并更新输入框', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [
			{ name: 'sub', path: SUB, isDirectory: true, cells: { name: 'sub', size: '-', mtime: '-' } },
		]);
		api.expand('left', SUB);
		api.applyRoot('left', 'C:\\Users\\tester', 'tester');
		assert.strictEqual(api.root('left'), 'C:\\Users\\tester');
		assert.strictEqual(api.inputValue('left'), 'C:\\Users\\tester');
		assert.strictEqual(api.rowCount('left'), 0);
		assert.strictEqual(api.root('right'), RIGHT, '另一侧不受影响');
	});

	it('不可读层级显示错误文本而不是崩溃', () => {
		const { api, doc } = setupPage();
		api.applyLevel('left', LEFT, [], '无法读取：拒绝访问');
		const error = doc.querySelector('#wispkit-compare-rows-left .wispkit-subtree-error');
		assert.ok(error);
		assert.ok(error.textContent?.includes('拒绝访问'));
		assert.strictEqual(api.rowCount('left'), 0);
	});

	it('状态栏显示宿主错误，默认回退说明在无状态时保留', () => {
		const { api } = setupPage();
		assert.strictEqual(api.status('left'), '正在打开…');
		api.applyLevel('left', LEFT, []);
		assert.ok(api.status('left')?.includes('左侧默认位置'), '加载完成后应回落到默认位置说明');
		api.applyStatus('left', '路径不存在：X', 'error');
		assert.strictEqual(api.status('left'), '路径不存在：X');
	});

	it('分隔条比例可调、越界会夹紧、双击复位 50%', () => {
		const { api, doc } = setupPage();
		assert.strictEqual(api.getSplit(), 50);
		assert.strictEqual(api.setSplit(73), 73);
		assert.strictEqual(api.rootElement(), '73%');
		assert.strictEqual(api.setSplit(5), 20);
		assert.strictEqual(api.setSplit(95), 80);
		const splitter = doc.getElementById('wispkit-compare-splitter');
		assert.ok(splitter);
		(splitter as HTMLElement).dispatchEvent(new (doc.defaultView as any).MouseEvent('dblclick', { bubbles: true }));
		assert.strictEqual(api.getSplit(), 50);
	});
});

describe('对比浏览命令契约', () => {
	function manifest(): any {
		return localizedManifest();
	}

	function providerSource(): string {
		return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'resourceTreeProvider.ts'), 'utf8');
	}

	it('资源管理视图标题有「对比浏览」入口', () => {
		const data = manifest();
		const command = (data.contributes.commands ?? [])
			.find((item: any) => item.command === 'wispkit.resourceTree.compareBrowse');
		assert.ok(command, '必须贡献 wispkit.resourceTree.compareBrowse');
		assert.strictEqual(command.title, 'Compare Browse');
		assert.strictEqual(command.icon, '$(split-horizontal)');

		const viewTitle = data.contributes.menus?.['view/title'] ?? [];
		assert.ok(
			viewTitle.some((item: any) => item.command === 'wispkit.resourceTree.compareBrowse'
				&& item.when === 'view == wispkit.resourceTree'),
			'对比浏览必须出现在自定义资源管理的视图标题栏',
		);
		assert.ok(
			(data.activationEvents ?? []).includes('onCommand:wispkit.resourceTree.compareBrowse'),
			'缺少激活事件',
		);
	});

	it('命令注册到 ComparePanel.open，且面板复用资源树作为下拉来源', () => {
		const source = providerSource();
		assert.ok(source.includes("registerCommand('wispkit.resourceTree.compareBrowse'"));
		assert.ok(source.includes('ComparePanel.open(deps.context, deps.provider)'));
	});
});
