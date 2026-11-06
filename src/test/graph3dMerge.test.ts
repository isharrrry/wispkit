import * as assert from 'assert';
import { mergeElements } from '../graph3d/merge';
import type { GraphElement } from '../graph3d/types';

function element(
	id: string,
	nodes: GraphElement['nodes'],
	edges: GraphElement['edges'],
	groups?: GraphElement['groups'],
): GraphElement {
	return { id, name: id, kind: 'flowchart', language: 'mermaid', line: 1, source: id, nodes, edges, groups };
}

describe('graph3d/merge', () => {
	it('跨图按名称合并（trim + 大小写不敏感），边与分组一起重映射', () => {
		const left = element('L', [
			{ id: 'A', label: '  Start ' },
			{ id: 'B', label: 'End', detail: ['left'] },
		], [
			{ source: 'A', target: 'B', label: 'go' },
		], [
			{ id: 'g', label: '左组' },
		]);
		const right = element('R', [
			{ id: 'X', label: 'start', group: 'g' },
			{ id: 'Y', label: 'New', detail: ['right'], group: 'g' },
		], [
			{ source: 'X', target: 'Y', label: 'go', group: 'g' },
		], [
			{ id: 'g', label: '右组' },
		]);
		const result = mergeElements(left, right);
		assert.strictEqual(result.mergedNodeCount, 1);
		assert.strictEqual(result.leftNodeCount, 2);
		assert.strictEqual(result.rightNodeCount, 2);
		assert.deepStrictEqual(result.element.nodes.map(node => node.label), ['  Start ', 'End', 'New']);
		const start = result.element.nodes.find(node => node.id === 'A')!;
		assert.deepStrictEqual(start.detail, undefined);
		const newRight = result.element.nodes.find(node => node.label === 'New')!;
		assert.ok(newRight.id.startsWith('r:'));
		assert.notStrictEqual(newRight.group, 'g', '右图分组必须重命名，避免与左图撞车');
		assert.ok(result.element.groups?.some(group => group.label === '右组'));
		assert.deepStrictEqual(result.element.edges.map(edge => `${edge.source}>${edge.target}`), ['A>B', 'A>r:Y']);
		assert.ok(result.element.note?.includes('1 个同名节点'));
	});

	it('合并结果带来源标记：左侧 left、右侧独有 right、同名融合 both', () => {
		const left = element('L', [
			{ id: 'A', label: '共同' },
			{ id: 'B', label: '只在左侧' },
		], []);
		const right = element('R', [
			{ id: 'X', label: '共同' },
			{ id: 'Y', label: '只在右侧' },
		], []);
		const result = mergeElements(left, right);
		const originOf = (label: string) => result.element.nodes.find(node => node.label === label)?.origin;
		assert.strictEqual(originOf('共同'), 'both');
		assert.strictEqual(originOf('只在左侧'), 'left');
		assert.strictEqual(originOf('只在右侧'), 'right');
		// 原对象不能被写进 origin。
		assert.strictEqual(left.nodes[0].origin, undefined);
	});

	it('没有同名节点时全部保留，且不改动原对象', () => {
		const left = element('L', [{ id: 'A', label: '甲' }], []);
		const right = element('R', [{ id: 'B', label: '乙' }, { id: 'C', label: '丙' }], [{ source: 'B', target: 'C' }]);
		const before = JSON.stringify(left);
		const result = mergeElements(left, right);
		assert.strictEqual(result.mergedNodeCount, 0);
		assert.strictEqual(result.element.nodes.length, 3);
		assert.strictEqual(JSON.stringify(left), before, '左侧元素不能被修改');
		assert.ok(result.element.note?.includes('没有同名节点'));
	});

	it('同图内部的同名节点不会互相合并', () => {
		const left = element('L', [
			{ id: 'A', label: '重复' },
			{ id: 'B', label: '重复' },
		], []);
		const right = element('R', [{ id: 'X', label: '重复' }], []);
		const result = mergeElements(left, right);
		assert.strictEqual(result.mergedNodeCount, 1);
		assert.strictEqual(result.element.nodes.length, 2);
		assert.strictEqual(result.element.nodes.filter(node => node.label === '重复').length, 2);
	});

	it('右侧 id 与左侧冲突时自动加前缀；detail 合并去重', () => {
		const left = element('L', [{ id: 'X', label: '左', detail: ['a', 'b'] }], []);
		const right = element('R', [{ id: 'X', label: '右', detail: ['b', 'c'] }], []);
		const result = mergeElements(left, right);
		assert.strictEqual(result.mergedNodeCount, 0);
		assert.strictEqual(new Set(result.element.nodes.map(node => node.id)).size, 2);
		assert.deepStrictEqual(result.element.nodes[1].detail, ['b', 'c']);
	});

	it('同名节点合并时 detail 取并集', () => {
		const left = element('L', [{ id: 'A', label: '节点', detail: ['a', 'b'] }], []);
		const right = element('R', [{ id: 'X', label: '节点', detail: ['b', 'c'] }], []);
		const result = mergeElements(left, right);
		assert.strictEqual(result.mergedNodeCount, 1);
		assert.deepStrictEqual(result.element.nodes[0].detail, ['a', 'b', 'c']);
	});

	it('同名节点合并时注释取并集并去重', () => {
		const left = element('L', [{ id: 'A', label: '节点', comment: '左侧注释\n共同注释' }], []);
		const right = element('R', [{ id: 'X', label: '节点', comment: '共同注释\n右侧注释' }], []);
		const result = mergeElements(left, right);
		assert.strictEqual(result.mergedNodeCount, 1);
		assert.strictEqual(result.element.nodes[0].comment, '左侧注释\n共同注释\n右侧注释');
	});

	it('同名节点合并时保留有图片的一侧', () => {
		const image = {
			src: 'data:image/png;base64,AA==',
			alt: '图',
			path: 'D:\\docs\\a.png',
			mime: 'image/png',
		};
		const rightHasImage = mergeElements(
			element('L', [{ id: 'A', label: '图' }], []),
			element('R', [{ id: 'X', label: '图', image }], []),
		);
		assert.strictEqual(rightHasImage.element.nodes[0].image?.src, image.src);

		const leftHasImage = mergeElements(
			element('L', [{ id: 'A', label: '图', image }], []),
			element('R', [{ id: 'X', label: '图' }], []),
		);
		assert.strictEqual(leftHasImage.element.nodes[0].image?.src, image.src);
	});

	it('重复边在合并后会去重', () => {
		const left = element('L', [
			{ id: 'A', label: '甲' },
			{ id: 'B', label: '乙' },
		], [{ source: 'A', target: 'B', label: 'x' }]);
		const right = element('R', [
			{ id: 'X', label: '甲' },
			{ id: 'Y', label: '乙' },
		], [{ source: 'X', target: 'Y', label: 'x' }]);
		const result = mergeElements(left, right);
		assert.strictEqual(result.element.edges.length, 1);
	});
});
