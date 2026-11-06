import * as assert from 'assert';
import * as path from 'node:path';
import {
	isMoveDropRequested,
	isSameOrInside,
	readDropPaths,
	refreshDirectories,
} from '../compare/transfer';

describe('compare/transfer 拖放语义', () => {
	it('默认复制：只有「内部拖拽 + 明确要求移动」才移动（缺一不可）', () => {
		assert.strictEqual(isMoveDropRequested({ internalDrag: true, moveRequested: true }), true);
		assert.strictEqual(isMoveDropRequested({ internalDrag: true, moveRequested: false }), false);
		assert.strictEqual(isMoveDropRequested({ internalDrag: false, moveRequested: true }), false);
		assert.strictEqual(isMoveDropRequested({ moveRequested: true }), false);
		assert.strictEqual(isMoveDropRequested({ ctrlKey: true }), false);
		assert.strictEqual(isMoveDropRequested({}), false);
	});

	it('readDropPaths 过滤非字符串、空串并保持顺序去重', () => {
		assert.deepStrictEqual(
			readDropPaths(['C:\\a.txt', 'C:\\a.txt', '', '  C:\\b.txt  ', 42, null, 'C:\\a.txt']),
			['C:\\a.txt', 'C:\\b.txt'],
		);
		assert.deepStrictEqual(readDropPaths(undefined), []);
		assert.deepStrictEqual(readDropPaths('C:\\a.txt'), []);
	});

	it('isSameOrInside：相等、子路径为真；兄弟与父级为假', () => {
		const root = path.join('C:', 'work', 'src');
		const child = path.join(root, 'nested', 'a.txt');
		const sibling = path.join('C:', 'work', 'other');
		const parent = path.join('C:', 'work');
		assert.strictEqual(isSameOrInside(root, root), true);
		assert.strictEqual(isSameOrInside(root, child), true);
		assert.strictEqual(isSameOrInside(root, sibling), false);
		assert.strictEqual(isSameOrInside(root, parent), false);
	});

	it('refreshDirectories：复制只刷新目标，移动还刷新源目录并去重', () => {
		const target = path.join('C:', 'right');
		const a = path.join('C:', 'left', 'a.txt');
		const b = path.join('C:', 'left', 'b.txt');
		assert.deepStrictEqual(refreshDirectories(target, [a, b], 'copy'), [target]);
		assert.deepStrictEqual(refreshDirectories(target, [a, b], 'move'), [target, path.dirname(a)]);
	});
});
