import * as assert from 'assert';
import { resolveLeftSelection, resolveRightSelection, type SelectableElement } from '../graph3d/selection';

function element(id: string, name: string): SelectableElement {
	return { id, name };
}

describe('graph3d/selection', () => {
	it('按 id 保持之前的左选择（即使改名）', () => {
		const elements = [element('g1', '新名字'), element('g2', 'B')];
		assert.strictEqual(resolveLeftSelection(element('g2', '旧名字'), elements, true), 1);
	});

	it('id 变了但名字没变时按名字保持', () => {
		const elements = [element('g9', '同样的名字'), element('g2', 'B')];
		assert.strictEqual(resolveLeftSelection(element('g1', '同样的名字'), elements, true), 0);
	});

	it('之前的左元素被删除时退回第 1 个', () => {
		const elements = [element('g2', 'B'), element('g3', 'C')];
		assert.strictEqual(resolveLeftSelection(element('g1', 'A'), elements, true), 0);
	});

	it('用户主动「不选」且文档本来就有图元素时，刷新后仍然是「不选」', () => {
		const elements = [element('g1', 'A'), element('g2', 'B')];
		assert.strictEqual(resolveLeftSelection(undefined, elements, true), -1);
	});

	it('文档从没有图元素变为有图元素时自动选第 1 个', () => {
		const elements = [element('g1', 'A')];
		assert.strictEqual(resolveLeftSelection(undefined, elements, false), 0);
	});

	it('刷新后仍然没有图元素时返回 -1', () => {
		assert.strictEqual(resolveLeftSelection(undefined, [], true), -1);
		assert.strictEqual(resolveLeftSelection(element('g1', 'A'), [], true), -1);
	});

	it('右侧选择保持原值；被删除或原本不选时保持 -1', () => {
		const elements = [element('g1', 'A'), element('g2', 'B')];
		assert.strictEqual(resolveRightSelection(element('g2', 'B'), elements), 1);
		assert.strictEqual(resolveRightSelection(element('gX', 'X'), elements), -1);
		assert.strictEqual(resolveRightSelection(undefined, elements), -1);
	});
});
