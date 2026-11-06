import * as assert from 'assert';
import type { ResourceFolderNode, ResourceGroupNode } from '../resourceTree/model';
import {
	clickCommandFor,
	folderDescription,
	folderOpenHint,
	folderStateFrom,
	folderStateFromCached,
	terminalNameFor,
} from '../resourceTree/presentation';

const group: ResourceGroupNode = { type: 'group', id: 'g1', name: '前端', children: [] };
const folder: ResourceFolderNode = { type: 'folder', id: 'f1', name: 'docs', path: '${workspaceFolder}/docs', children: [] };

describe('resourceTree/presentation 文件夹状态', () => {
	it('空路径 → unresolved；stat 抛错 → missing；目录 / 文件分别识别', () => {
		assert.strictEqual(folderStateFrom(undefined, () => 'directory'), 'unresolved');
		assert.strictEqual(folderStateFrom('   ', () => 'directory'), 'unresolved', '空白路径同样不可解析');
		assert.strictEqual(folderStateFrom('D:/gone', () => { throw new Error('ENOENT'); }), 'missing');
		assert.strictEqual(folderStateFrom('D:/dir', () => 'directory'), 'directory');
		assert.strictEqual(folderStateFrom('D:/file.txt', () => 'file'), 'file');
		assert.strictEqual(folderStateFrom('D:/broken', () => 'broken-link'), 'broken-link');
	});
});

describe('resourceTree/presentation 描述与提示', () => {
	it('目录：相对路径和显示名不同才显示相对路径', () => {
		assert.strictEqual(folderDescription('guide', 'directory', 'docs/guide'), 'docs/guide');
		assert.strictEqual(folderDescription('docs', 'directory', 'docs'), '', '同名时不重复显示');
		assert.strictEqual(folderDescription('外部', 'directory', 'D:/external/shared'), 'D:/external/shared');
	});

	it('三种异常状态各自给明确警告，不显示路径', () => {
		assert.strictEqual(folderDescription('x', 'missing', 'x'), '⚠ 文件夹不存在');
		assert.strictEqual(folderDescription('x', 'file', 'x'), '⚠ 不是文件夹');
		assert.strictEqual(folderDescription('x', 'broken-link', 'x'), '⚠ 链接已断开', '断链不能误报成「不是文件夹」');
		assert.strictEqual(folderDescription('x', 'unresolved', 'x'), '⚠ 路径无法解析');
	});

	it('只有目录提示可点击打开', () => {
		assert.strictEqual(folderOpenHint('directory'), '点击可在 Wispkit 子树浏览器中打开');
		for (const state of ['missing', 'file', 'broken-link', 'unresolved'] as const) {
			assert.ok(folderOpenHint(state).includes('不可打开'), `${state} 必须提示不可打开`);
		}
		assert.ok(folderOpenHint('broken-link').includes('链接目标不存在'));
	});
});

describe('resourceTree/presentation 缓存状态 → 呈现状态', () => {
	it('缓存未命中 → unknown：首次展开不误报警告，提示正在检查', () => {
		assert.strictEqual(folderStateFromCached(undefined), 'unknown');
		assert.strictEqual(folderStateFromCached('directory'), 'directory');
		assert.strictEqual(folderStateFromCached('file'), 'file');
		assert.strictEqual(folderStateFromCached('missing'), 'missing');
		assert.strictEqual(folderStateFromCached('broken-link'), 'broken-link');
		assert.strictEqual(folderDescription('x', 'unknown', 'x'), '', '未知状态不能显示「不存在」');
		assert.ok(folderOpenHint('unknown').includes('正在检查'));
	});
});

describe('resourceTree/presentation 点击命令', () => {
	it('文件夹与虚拟组都绑定浏览命令：组由命令层提示不能浏览，避免点击无反馈', () => {
		const folderCommand = clickCommandFor(folder);
		const groupCommand = clickCommandFor(group);
		assert.strictEqual(folderCommand.command, 'wispkit.resourceTree.openFolder');
		assert.strictEqual(groupCommand.command, 'wispkit.resourceTree.openFolder');
		assert.strictEqual(folderCommand.title, '浏览文件夹');
		assert.notStrictEqual(groupCommand.title, folderCommand.title);
	});
});

describe('resourceTree/presentation 终端名称', () => {
	it('优先用用户起的别名（树的显示名）', () => {
		assert.strictEqual(terminalNameFor({ ...folder, name: '前端文档' }), '前端文档');
		assert.strictEqual(terminalNameFor(folder), 'docs', '未改名时显示名就是文件夹名');
	});

	it('名字为空白时回退到文件夹路径最后一段，不产生无标题终端', () => {
		assert.strictEqual(
			terminalNameFor({ ...folder, name: '   ', path: '${workspaceFolder}/projects/frontend' }),
			'frontend',
		);
		assert.strictEqual(terminalNameFor({ ...folder, name: '', path: '${workspaceFolder}/docs/' }), 'docs');
	});

	it('虚拟组理论上不会开终端，兜底给通用名', () => {
		assert.strictEqual(terminalNameFor({ ...group, name: ' ' }), '终端');
	});
});
