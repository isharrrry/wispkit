import * as assert from 'assert';
import { renderBinaryPage } from '../binaryView/page';

const CHROME = {
	csp: "default-src 'none'",
	nonce: 'n0nce',
	runtimeScript: 'vscode-resource://binary.js',
	runtimeStyle: 'vscode-resource://binary.css',
};

describe('binaryView/page', () => {
	it('渲染分区与行，并对内容做 HTML 转义', () => {
		const html = renderBinaryPage({
			...CHROME,
			title: '<script>alert(1)</script>',
			kind: 'pe',
			subtitle: 'PE32 · x86',
			sections: [{ title: '基本信息', rows: [{ label: '名称', value: '<b>x</b>' }] }],
			notices: [],
		});
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
		assert.ok(html.includes('基本信息'));
	});

	it('错误模式只显示错误卡片，不显示属性表', () => {
		const html = renderBinaryPage({
			...CHROME,
			title: 'a.lnk',
			kind: 'lnk',
			subtitle: '无法解析',
			sections: [{ title: '快捷方式', rows: [{ label: 'a', value: 'b' }] }],
			notices: [],
			error: '不是可识别的 Windows 快捷方式',
		});
		assert.ok(html.includes('不是可识别的 Windows 快捷方式'));
		assert.ok(!html.includes('快捷方式</h2>'));
	});

	it('有 form 时出现编辑区与系统打开按钮', () => {
		const html = renderBinaryPage({
			...CHROME,
			title: 'a.lnk',
			kind: 'lnk',
			subtitle: 's',
			sections: [],
			notices: [],
			form: {
				note: '说明',
				fields: [
					{ key: 'targetPath', label: '目标路径', value: 'C:\\a.exe', placeholder: 'p', multiline: false },
					{ key: 'arguments', label: '参数', value: '', placeholder: 'p', multiline: true },
				],
			},
		});
		assert.ok(html.includes('id="wispkit-binary-form"'));
		assert.ok(html.includes('data-wispkit-binary-action="openSystem"'));
		assert.ok(html.includes('<textarea id="wispkit-binary-field-arguments"'));
		assert.ok(html.includes('value="C:\\a.exe"'));
	});

	it('状态文案随页面带出，避免重绘后丢失「已保存」', () => {
		const html = renderBinaryPage({
			...CHROME,
			title: 'a.lnk',
			kind: 'lnk',
			subtitle: 's',
			sections: [],
			notices: [],
			statusText: '已保存',
			statusLevel: 'ok',
			form: { note: 'n', fields: [] },
		});
		assert.ok(html.includes('已保存'));
		assert.ok(html.includes('data-level="ok"'));
	});

	it('属性值里的双引号不会破坏属性', () => {
		const html = renderBinaryPage({
			...CHROME,
			title: 'a"b',
			kind: 'pe',
			subtitle: 's',
			sections: [],
			notices: [],
		});
		assert.ok(html.includes('a&quot;b'));
	});
});
