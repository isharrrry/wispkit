import * as assert from 'assert';
import { buildLocationGroups } from '../compare/locations';
import type { ResourceTreeStore } from '../resourceTree/model';
import type { WorkspaceFolderLike } from '../resourceTree/paths';

const WORKSPACE: WorkspaceFolderLike = { name: 'ws', fsPath: 'C:\\work' };
const DOCS: WorkspaceFolderLike = { name: 'docs', fsPath: 'D:\\docs' };
const LIKES = [WORKSPACE, DOCS];

const STORE: ResourceTreeStore = {
	version: 1,
	roots: [
		{
			type: 'group',
			id: 'g1',
			name: '项目',
			children: [
				{ type: 'folder', id: 'f1', name: '源码', path: '${workspaceFolder}/src', children: [] },
				{
					type: 'group',
					id: 'g2',
					name: '外部',
					children: [
						{ type: 'folder', id: 'f2', name: '文档', path: '${workspaceFolder:docs}/assets', children: [] },
						{ type: 'folder', id: 'f3', name: '失效', path: '${workspaceFolder:missing}/x', children: [] },
					],
				},
			],
		},
	],
};

describe('compare/locations 下拉候选', () => {
	it('常用位置去重，工作区与自定义资源管理各自成组', () => {
		const groups = buildLocationGroups({
			left: { path: 'C:\\Users\\u\\Desktop', label: '桌面', kind: 'desktop' },
			right: { path: 'C:\\Users\\u\\Desktop', label: '桌面', kind: 'desktop' },
			home: 'C:\\Users\\u',
			workspaceFolders: [WORKSPACE],
			store: STORE,
			folderLikes: LIKES,
			tempDirectory: 'C:\\Temp',
		});

		const titles = groups.map(group => group.title);
		assert.deepStrictEqual(titles, ['常用位置', '工作区', '自定义资源管理']);

		const common = groups[0].locations;
		assert.deepStrictEqual(common.map(item => item.label), ['桌面', '主目录', '临时目录']);
		assert.strictEqual(new Set(common.map(item => item.path)).size, common.length, '常用位置不能重复');

		assert.deepStrictEqual(groups[1].locations.map(item => item.label), ['ws']);
		assert.strictEqual(groups[1].locations[0].path, 'C:\\work');
	});

	it('资源树里的虚拟组只作为层级前缀，文件夹按 depth-first 展开', () => {
		const groups = buildLocationGroups({
			left: { path: 'C:\\Users\\u', label: '主目录', kind: 'home' },
			right: { path: 'C:\\Users\\u', label: '主目录', kind: 'home' },
			home: 'C:\\Users\\u',
			workspaceFolders: [WORKSPACE],
			store: STORE,
			folderLikes: LIKES,
		});
		const tree = groups.find(group => group.title === '自定义资源管理');
		assert.ok(tree);
		assert.deepStrictEqual(
			tree.locations.map(item => item.label),
			['项目 / 源码', '项目 / 外部 / 文档', '项目 / 外部 / 失效'],
		);
		assert.strictEqual(tree.locations[0].path, 'C:\\work\\src');
		assert.strictEqual(tree.locations[1].path, 'D:\\docs\\assets');
		assert.strictEqual(tree.locations[2].path, '', '无法解析占位符的节点 path 为空');
		assert.ok(tree.locations[2].description.includes('无法解析'));
	});

	it('没有资源树 / 没有工作区时只保留常用位置，且不产生空组', () => {
		const groups = buildLocationGroups({
			left: { path: '/home/u', label: '主目录', kind: 'home' },
			right: { path: '/home/u', label: '主目录', kind: 'home' },
			home: '/home/u',
			workspaceFolders: [],
		});
		assert.deepStrictEqual(groups.map(group => group.title), ['常用位置']);
		assert.deepStrictEqual(groups[0].locations.map(item => item.label), ['主目录']);
	});
});
