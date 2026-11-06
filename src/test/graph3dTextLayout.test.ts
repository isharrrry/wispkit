import * as assert from 'assert';
import { displayWidth } from '../graph3d/types';
import { fitLabelText, preWrapLabel, wrapLabelText } from '../graph3d/textLayout';

/** 模拟 canvas.measureText：ASCII 1 宽、中文 2 宽，结果与 displayWidth 一致。 */
function measure(text: string): number {
	return displayWidth(text);
}

function baseMetrics(overrides: Partial<Parameters<typeof fitLabelText>[2]> = {}) {
	return {
		measureMain: measure,
		measureDetail: measure,
		mainLineHeight: 10,
		detailLineHeight: 8,
		padding: 4,
		targetAspect: 1.2,
		minLineWidth: 5,
		maxLineWidth: 80,
		detailLimit: 3,
		...overrides,
	};
}

describe('graph3d/textLayout 预换行', () => {
	it('短名称原样返回', () => {
		assert.strictEqual(preWrapLabel('订单处理'), '订单处理');
		assert.strictEqual(preWrapLabel('a/b'), 'a/b');
	});

	it('长名称没有换行时，把空格 / 斜杠 / 反斜杠 / 横杠换成换行', () => {
		const wrapped = preWrapLabel('src/graph3d\\layout-main section');
		const lines = wrapped.split('\n');
		assert.deepStrictEqual(lines, ['src', 'graph3d', 'layout', 'main', 'section']);
		assert.ok(!wrapped.includes(' '), '空格必须被替换');
		assert.ok(!wrapped.includes('/'), '斜杠必须被替换');
		assert.ok(!wrapped.includes('\\'), '反斜杠必须被替换');
		assert.ok(!wrapped.includes('-'), '横杠必须被替换');
	});

	it('已经带换行的名称不再动（尊重手写换行）', () => {
		const text = '很长的名字/with-separators\\and spaces\n第二行';
		assert.strictEqual(preWrapLabel(text), text);
	});

	it('长中文名（无分隔符）保持原样，交给折行处理', () => {
		const text = '这是一个很长很长很长的中文节点名称没有分隔符';
		assert.strictEqual(preWrapLabel(text), text);
	});
});

describe('graph3d/textLayout 折行', () => {
	it('按宽度折行且不丢字符', () => {
		const text = 'abcdefghijklmnopqrstuvwxyz';
		const lines = wrapLabelText(measure, text, 10);
		assert.deepStrictEqual(lines, ['abcdefghij', 'klmnopqrst', 'uvwxyz']);
		assert.strictEqual(lines.join(''), text);
	});

	it('单个超长单词按字符切开，不做省略', () => {
		const text = 'D'.repeat(30);
		const lines = wrapLabelText(measure, text, 12);
		assert.strictEqual(lines.join(''), text);
		assert.ok(lines.length > 1);
	});

	it('显式换行与空行都保留', () => {
		const lines = wrapLabelText(measure, 'a\n\nb', 10);
		assert.deepStrictEqual(lines, ['a', '', 'b']);
	});
});

describe('graph3d/textLayout 自适应贴气泡', () => {
	it('长名称的宽高比贴近气泡可用区域，且所有字符都在', () => {
		const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
		const fit = fitLabelText(text, [], baseMetrics({ maxLineWidth: measure(text) }));
		const aspect = fit.width / fit.height;
		assert.ok(Math.abs(aspect - 1.2) < 0.4, `宽高比应接近 1.2，实际 ${aspect.toFixed(2)}`);
		assert.ok(fit.mainLines.length > 1, '长名称必须折成多行');
		assert.strictEqual(fit.mainLines.join(''), text, '一个字符都不能少');
	});

	it('超长名称完整保留（不再只留前 4 行）', () => {
		const text = 'x'.repeat(240);
		const fit = fitLabelText(text, [], baseMetrics({ maxLineWidth: measure(text) }));
		assert.strictEqual(fit.mainLines.join(''), text);
		assert.ok(fit.height > 0 && fit.width > 0);
	});

	it('短名称单行显示，但文字块仍按气泡宽高比计算尺寸', () => {
		const fit = fitLabelText('AB', [], baseMetrics());
		assert.deepStrictEqual(fit.mainLines, ['AB']);
		assert.strictEqual(fit.width, measure('AB') + 8);
		assert.strictEqual(fit.height, 18);
	});

	it('次要文字最多保留 detailLimit 行', () => {
		const fit = fitLabelText('x', ['a', 'b', 'c', 'd', 'e'], baseMetrics({
			maxLineWidth: 40,
			detailLimit: 3,
		}));
		assert.strictEqual(fit.detailLines.length, 3);
	});

	it('气泡很扁时优先单行，很窄时折成多行', () => {
		const text = 'alpha beta gamma delta';
		const wide = fitLabelText(text, [], baseMetrics({
			targetAspect: 12,
			maxLineWidth: measure(text),
		}));
		const narrow = fitLabelText(text, [], baseMetrics({
			targetAspect: 0.5,
			maxLineWidth: measure(text),
		}));
		assert.ok(wide.mainLines.length < narrow.mainLines.length,
			`越扁的气泡行数应越少：wide=${wide.mainLines.length} narrow=${narrow.mainLines.length}`);
	});
});
