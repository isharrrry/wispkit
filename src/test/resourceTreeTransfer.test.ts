import * as assert from 'assert';
import {
	countStoreNodes,
	findNode,
	parseStoreJson,
	serializeStore,
	type ResourceTreeStore,
} from '../resourceTree/model';
import { planImport, warningPreview } from '../resourceTree/transfer';

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
				name: '源码',
				path: '${workspaceFolder}/src',
				children: [],
			}],
		}],
	}));
	assert.strictEqual(parsed.error, undefined);
	return parsed.store;
}

describe('resourceTree/transfer 导入计划', () => {
	it('合法文件：可导入，确认文案包含当前 / 导入后的节点数', () => {
		const plan = planImport(serializeStore(sample()), 7);
		assert.strictEqual(plan.ok, true);
		assert.strictEqual(plan.nodeCount, 2);
		assert.strictEqual(plan.warningMessage, undefined);
		assert.ok(plan.confirmMessage?.includes('当前 7 个节点'));
		assert.ok(plan.confirmMessage?.includes('为 2 个节点'));
		assert.deepStrictEqual(plan.store, sample());
	});

	it('非法 JSON：拒绝导入、不提供 store（调用方保留原树），错误可诊断', () => {
		for (const text of ['{', '', 'null', '{"rows":[]}']) {
			const plan = planImport(text, 5);
			assert.strictEqual(plan.ok, false, `${JSON.stringify(text)} 不能被当成合法文件`);
			assert.strictEqual(plan.store, undefined);
			assert.ok((plan.error ?? '').length > 0);
		}
	});

	it('带警告的文件：仍然可以导入，并给出警告摘要', () => {
		const text = JSON.stringify([
			{ type: 'group', id: 'dup', name: 'A' },
			{ type: 'bogus', name: '未知类型' },
			{ type: 'group', id: 'dup', name: 'B', children: [] },
		]);
		const plan = planImport(text, 0);
		assert.strictEqual(plan.ok, true);
		assert.ok(plan.warnings.length >= 2, '应同时报告未知类型与重复 id');
		assert.strictEqual(plan.nodeCount, 2, '非法节点被丢弃，重复 id 被重新分配');
		assert.ok(plan.warningMessage?.includes(`${plan.warnings.length} 处问题`));
		assert.ok(plan.warningMessage?.includes('已尽力修复'));
	});

	it('导出 → 导入 round-trip 后结构完全一致，占位符仍是原文本', () => {
		const exported = serializeStore(sample());
		const plan = planImport(exported, 0);
		assert.strictEqual(plan.ok, true);
		assert.deepStrictEqual(plan.store, sample());
		assert.deepStrictEqual(plan.store, parseStoreJson(exported).store);
		const folder = findNode(plan.store!, 'f1')?.node;
		if (!folder || folder.type !== 'folder') {
			assert.fail('round-trip 后应保留文件夹节点 f1');
		}
		assert.strictEqual(folder.path, '${workspaceFolder}/src');
		assert.strictEqual(countStoreNodes(plan.store!), 2);
	});

	it('warningPreview 只截取前三条，供消息框使用', () => {
		assert.strictEqual(warningPreview(['a', 'b', 'c', 'd']), 'a；b；c');
		assert.strictEqual(warningPreview(['a']), 'a');
	});
});
