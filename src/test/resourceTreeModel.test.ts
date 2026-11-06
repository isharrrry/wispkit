import * as assert from 'assert';
import {
	addFolder,
	addGroup,
	MAX_CHILDREN,
	MAX_NODES,
	countNodes,
	countStoreNodes,
	createStore,
	findNode,
	flattenContainers,
	folderNameFromPath,
	isDescendant,
	moveNode,
	moveSibling,
	parseStoreJson,
	removeNode,
	renameNode,
	serializeStore,
	type ResourceTreeStore,
} from '../resourceTree/model';

function sample(): ResourceTreeStore {
	const parsed = parseStoreJson(JSON.stringify({
		version: 1,
		roots: [{
			type: 'group',
			id: 'g1',
			name: '文档',
			children: [{
				type: 'folder',
				id: 'f1',
				name: 'src',
				path: '${workspaceFolder}/src',
				children: [],
			}],
		}],
	}));
	assert.strictEqual(parsed.error, undefined);
	return parsed.store;
}

function buildNested(depth: number): unknown {
	let node: Record<string, unknown> = { type: 'group', name: `L${depth}` };
	for (let index = depth - 1; index >= 0; index -= 1) {
		node = { type: 'group', name: `L${index}`, children: [node] };
	}
	return { version: 1, roots: [node] };
}

describe('resourceTree/model 解析与序列化', () => {
	it('解析合法 JSON，保留 id / 路径 / 层级', () => {
		const store = sample();
		assert.strictEqual(store.roots.length, 1);
		const group = store.roots[0];
		assert.strictEqual(group.id, 'g1');
		assert.strictEqual(group.children.length, 1);
		const folder = group.children[0];
		assert.strictEqual(folder.type, 'folder');
		assert.strictEqual(folder.path, '${workspaceFolder}/src');
		assert.strictEqual(findNode(store, 'f1')?.depth, 1);
		assert.deepStrictEqual(findNode(store, 'f1')?.path, ['文档']);
	});

	it('接受顶层数组、推断缺失 type、丢弃非法节点并给出警告', () => {
		const parsed = parseStoreJson(JSON.stringify([
			{ type: 'group', name: '组', children: [] },
			{ type: 'bogus', name: '未知类型' },
			{ type: 'folder', name: '没有路径' },
			{ name: '推断出的文件夹', path: '/tmp/x', children: [] },
			{ name: '推断出的组', children: [] },
		]));
		assert.strictEqual(parsed.error, undefined);
		assert.strictEqual(parsed.store.roots.length, 3);
		assert.deepStrictEqual(parsed.store.roots.map(node => node.type), ['group', 'folder', 'group']);
		assert.ok(parsed.warnings.length >= 2);
	});

	it('重复 id 自动重新分配；超深层的子节点被截断并警告', () => {
		const duplicate = parseStoreJson(JSON.stringify([
			{ type: 'group', id: 'same', name: 'A' },
			{ type: 'group', id: 'same', name: 'B' },
		]));
		assert.notStrictEqual(duplicate.store.roots[0].id, duplicate.store.roots[1].id);
		assert.ok(duplicate.warnings.some(warning => warning.includes('重复')), '重复 id 必须给出警告');

		const deep = parseStoreJson(JSON.stringify(buildNested(15)));
		assert.strictEqual(deep.error, undefined);
		assert.ok(countStoreNodes(deep.store) <= 13, '最多保留到第 12 层');
		assert.ok(deep.warnings.some(warning => warning.includes('层')));
	});

	it('非法 JSON / 顶层结构错误返回 error，而不是抛异常', () => {
		assert.ok(parseStoreJson('{').error?.includes('不是合法 JSON'));
		assert.ok(parseStoreJson('{}').error?.includes('roots'));
		assert.strictEqual(parseStoreJson('{"roots":[]}').error, undefined);
	});

	it('版本不一致给出警告，但仍按 v1 读取', () => {
		const parsed = parseStoreJson(JSON.stringify({ version: 9, roots: [] }));
		assert.strictEqual(parsed.store.version, 1);
		assert.ok(parsed.warnings.some(warning => warning.includes('版本')));
	});

	it('序列化后再解析得到相同结构（含空 children）', () => {
		const store = sample();
		const text = serializeStore(store);
		assert.ok(text.includes('"version": 1'));
		const reparsed = parseStoreJson(text);
		assert.strictEqual(reparsed.error, undefined);
		assert.deepStrictEqual(reparsed.store, store);
	});

	it('文件结构固定：version=1、roots 数组、节点字段齐全、2 空格缩进、UTF-8 无 BOM', () => {
		const store = sample();
		const text = serializeStore(store);
		const bytes = new TextEncoder().encode(text);
		assert.strictEqual(bytes[0], 0x7b, '文件必须以 { 开头（无 BOM）');
		assert.strictEqual(new TextDecoder('utf-8').decode(bytes), text, 'UTF-8 编码往返无损');
		assert.ok(text.endsWith('\n'), '文件以换行结尾');
		assert.ok(text.includes('\n  "roots"'), '使用 2 空格缩进');

		const parsed = JSON.parse(text) as { version: number; roots: Array<Record<string, unknown>> };
		assert.strictEqual(parsed.version, 1);
		assert.ok(Array.isArray(parsed.roots));
		const group = parsed.roots[0];
		assert.deepStrictEqual(Object.keys(group).sort(), ['children', 'id', 'name', 'type']);
		const folder = (group.children as Array<Record<string, unknown>>)[0];
		assert.deepStrictEqual(Object.keys(folder).sort(), ['children', 'id', 'name', 'path', 'type']);
		assert.strictEqual(folder.type, 'folder');
		assert.strictEqual(folder.path, '${workspaceFolder}/src');
		assert.strictEqual(folder.name, 'src');
	});

	it('未知 type / 缺失 path 的节点被丢弃，并说明具体原因', () => {
		const parsed = parseStoreJson(JSON.stringify([
			{ type: 'bogus', name: '未知类型' },
			{ type: 'folder', name: '没有路径' },
			{ type: 'group', name: '保留', children: [] },
		]));
		assert.strictEqual(parsed.store.roots.length, 1);
		assert.ok(parsed.warnings.some(warning => warning.includes('未知节点类型')));
		assert.ok(parsed.warnings.some(warning => warning.includes('缺少 path')));
	});

	it('超过子项 / 节点总量上限时截断并给出警告', () => {
		const manyRoots = Array.from({ length: MAX_CHILDREN + 10 }, (_, index) => ({
			type: 'group',
			name: `G${index}`,
		}));
		const rootLimited = parseStoreJson(JSON.stringify({ version: 1, roots: manyRoots }));
		assert.strictEqual(rootLimited.store.roots.length, MAX_CHILDREN);
		assert.ok(rootLimited.warnings.some(warning => warning.includes('上限')));

		const nested = Array.from({ length: 200 }, (_, index) => ({
			type: 'group',
			name: `R${index}`,
			children: Array.from({ length: 20 }, (_, child) => ({
				type: 'group',
				name: `C${index}-${child}`,
			})),
		}));
		const over = parseStoreJson(JSON.stringify({ version: 1, roots: nested }));
		assert.strictEqual(over.error, undefined);
		assert.ok(countStoreNodes(over.store) <= MAX_NODES, `最多保留 ${MAX_NODES} 个节点`);
		assert.ok(over.warnings.some(warning => warning.includes('数量超过上限')));
	});

	it('路径显示名不依赖平台分隔符', () => {
		assert.strictEqual(folderNameFromPath('C:\\work\\src\\'), 'src');
		assert.strictEqual(folderNameFromPath('/work/src/'), 'src');
		assert.strictEqual(folderNameFromPath('src'), 'src');
		assert.strictEqual(folderNameFromPath(''), '文件夹');
	});
});

describe('resourceTree/model 变更', () => {
	it('新建虚拟组 / 文件夹：返回新 store，原对象不变', () => {
		const original = createStore();
		const before = JSON.stringify(original);
		const group = addGroup(original, null, '  前端  ');
		assert.ok(group.node);
		assert.strictEqual(group.node.name, '前端');
		assert.strictEqual(original.roots.length, 0, '原 store 不能被修改');
		assert.strictEqual(JSON.stringify(original), before);

		const folder = addFolder(group.store, group.node.id, '', 'C:\\work\\web');
		assert.ok(folder.node);
		assert.strictEqual(folder.node.name, 'web', '空名称回退到文件夹名');
		assert.strictEqual(folder.node.path, 'C:\\work\\web');
		assert.strictEqual(findNode(folder.store, folder.node.id)?.parent?.id, group.node.id);
		assert.strictEqual(countNodes(group.store.roots[0]), 1, '旧 store 里还只有分组');
		assert.strictEqual(countNodes(folder.store.roots[0]), 2);
		assert.strictEqual(countStoreNodes(folder.store), 2);
	});

	it('路径为空时拒绝添加文件夹', () => {
		const original = createStore();
		const result = addFolder(original, null, 'x', '   ');
		assert.strictEqual(result.node, undefined);
		assert.strictEqual(result.store, original);
	});

	it('重命名 / 删除：删除节点会连同子树一起消失', () => {
		const store = sample();
		const renamed = renameNode(store, 'f1', '  新名字  ');
		assert.strictEqual(findNode(renamed, 'f1')?.node.name, '新名字');
		assert.strictEqual(findNode(store, 'f1')?.node.name, 'src', '原 store 不变');

		const removed = removeNode(store, 'g1');
		assert.strictEqual(removed.roots.length, 0);
		assert.strictEqual(findNode(removed, 'f1'), undefined);
	});

	it('移动到任意层级、移动到根、拒绝移进自己的后代', () => {
		const store = sample();
		const movedToRoot = moveNode(store, 'f1', null);
		assert.strictEqual(movedToRoot.roots.length, 2);
		assert.strictEqual(movedToRoot.roots[1].id, 'f1');
		assert.strictEqual(findNode(movedToRoot, 'f1')?.depth, 0);

		const group = movedToRoot.roots[0];
		const movedIntoFolder = moveNode(movedToRoot, group.id, 'f1');
		assert.strictEqual(findNode(movedIntoFolder, group.id)?.depth, 1);
		assert.strictEqual(findNode(movedIntoFolder, group.id)?.parent?.id, 'f1');

		const cycle = moveNode(store, 'g1', 'f1');
		assert.strictEqual(cycle, store, '不能把父节点移进自己的子节点');
		assert.strictEqual(isDescendant(store, 'g1', 'f1'), true);
	});

	it('按索引移动与同级上移 / 下移', () => {
		const first = addGroup(createStore(), null, 'A');
		const second = addGroup(first.store, null, 'B');
		const third = addGroup(second.store, null, 'C');
		const store = third.store;
		assert.deepStrictEqual(store.roots.map(node => node.name), ['A', 'B', 'C']);

		const up = moveSibling(store, store.roots[2].id, -1);
		assert.deepStrictEqual(up.roots.map(node => node.name), ['A', 'C', 'B']);
		const down = moveSibling(store, store.roots[0].id, 1);
		assert.deepStrictEqual(down.roots.map(node => node.name), ['B', 'A', 'C']);
		assert.strictEqual(moveSibling(store, store.roots[0].id, -1), store, '已经在最前面时保持不变');

		const indexed = moveNode(store, store.roots[2].id, null, 0);
		assert.deepStrictEqual(indexed.roots.map(node => node.name), ['C', 'A', 'B']);
	});

	it('flattenContainers 给出深度与名称链，供移动选择器使用', () => {
		const store = sample();
		const entries = flattenContainers(store);
		assert.deepStrictEqual(entries.map(entry => [entry.node.name, entry.depth, entry.path.join('/')]), [
			['文档', 0, ''],
			['src', 1, '文档'],
		]);
	});
});
