import * as assert from 'assert';
import {
	DEFAULT_READONLY_GLOBS,
	READONLY_VIEW_TYPE,
	associationsEqual,
	planApply,
	planRemove,
	readReadonlyGlobs,
} from '../readonly/associations';

describe('readonly/associations: 合并进用户的 editorAssociations', () => {
	it('用户已有的其他条目原样保留', () => {
		const existing = { '*.foo': 'default', '*.bar': 'some.other.view' };
		const plan = planApply(existing, ['*.ts', '*.json']);
		assert.strictEqual(plan.next['*.foo'], 'default');
		assert.strictEqual(plan.next['*.bar'], 'some.other.view');
		assert.strictEqual(plan.next['*.ts'], READONLY_VIEW_TYPE);
		assert.strictEqual(plan.next['*.json'], READONLY_VIEW_TYPE);
	});

	it('用户给同一个 glob 指定过别的 viewType 时不抢', () => {
		const existing = { '*.txt': 'default' };
		const plan = planApply(existing, ['*.txt', '*.log']);
		assert.strictEqual(plan.next['*.txt'], 'default', '不能覆盖用户的显式选择');
		assert.deepStrictEqual(plan.applied, ['*.log'], '被跳过的 glob 不算我们占的');
	});

	it('值已经是我们的 viewType 时仍记进 applied，且不产生写入', () => {
		const existing = { '*.txt': READONLY_VIEW_TYPE };
		const plan = planApply(existing, ['*.txt']);
		assert.deepStrictEqual(plan.applied, ['*.txt']);
		assert.ok(associationsEqual(existing, plan.next), '已到位时不该写配置');
	});

	it('重复开启幂等：next 不变、applied 不缩水', () => {
		const globs = ['*.ts', '*.json', '*.log'];
		const first = planApply({}, globs);
		const second = planApply(first.next, globs);
		assert.ok(associationsEqual(first.next, second.next));
		assert.deepStrictEqual(second.applied, first.applied);
	});

	it('空 glob 列表不写入任何垃圾', () => {
		const plan = planApply({ '*.foo': 'default' }, []);
		assert.deepStrictEqual(plan.applied, []);
		assert.ok(associationsEqual(plan.next, { '*.foo': 'default' }));
	});
});

describe('readonly/associations: 移除', () => {
	it('只删我们写过的，用户的其他条目不动', () => {
		const existing = { '*.ts': READONLY_VIEW_TYPE, '*.json': READONLY_VIEW_TYPE, '*.foo': 'default' };
		assert.deepStrictEqual(planRemove(existing, ['*.ts', '*.json']), { '*.foo': 'default' });
	});

	it('用户后来把某个 glob 改成别的 viewType 时保留它', () => {
		assert.deepStrictEqual(planRemove({ '*.ts': 'default' }, ['*.ts']), { '*.ts': 'default' });
	});

	it('applied 里没有的条目一律不动', () => {
		assert.deepStrictEqual(planRemove({ '*.ts': READONLY_VIEW_TYPE }, []), { '*.ts': READONLY_VIEW_TYPE });
	});

	it('开一轮再关一轮必须回到用户原来的配置', () => {
		const original = { '*.foo': 'default' };
		const plan = planApply(original, ['*.ts', '*.log']);
		const back = planRemove(plan.next, plan.applied);
		assert.ok(associationsEqual(back, original));
	});
});

describe('readonly/associations: 配置解析', () => {
	it('非数组回退默认集合', () => {
		assert.deepStrictEqual(readReadonlyGlobs(undefined), DEFAULT_READONLY_GLOBS);
		assert.deepStrictEqual(readReadonlyGlobs('*.ts'), DEFAULT_READONLY_GLOBS);
	});

	it('空数组或全空白回退默认集合', () => {
		assert.deepStrictEqual(readReadonlyGlobs([]), DEFAULT_READONLY_GLOBS);
		assert.deepStrictEqual(readReadonlyGlobs(['  ', '']), DEFAULT_READONLY_GLOBS);
	});

	it('去掉空白项与首尾空格', () => {
		assert.deepStrictEqual(readReadonlyGlobs([' *.ts ', '', '*.json']), ['*.ts', '*.json']);
	});

	it('默认集合不含 Wispkit 自己接管的浏览类型', () => {
		const handled = ['*.md', '*.markdown', '*.html', '*.htm', '*.xaml', '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg', '*.bmp', '*.ico'];
		for (const glob of handled) {
			assert.ok(!DEFAULT_READONLY_GLOBS.includes(glob), `${glob} 不该在默认只读集合里`);
		}
	});
});

describe('readonly/associations: 相等判断', () => {
	it('键值完全一致才算相等，顺序无关', () => {
		assert.ok(associationsEqual({ a: '1', b: '2' }, { b: '2', a: '1' }));
		assert.ok(!associationsEqual({ a: '1' }, { a: '1', b: '2' }));
		assert.ok(!associationsEqual({ a: '1' }, { a: '2' }));
		assert.ok(associationsEqual({}, {}));
	});
});
