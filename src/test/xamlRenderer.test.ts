import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseRendererOutput, renderXaml } from '../xaml/renderer';

describe('xaml/renderer', () => {
	describe('parseRendererOutput', () => {
		it('解析成功结果', () => {
			const result = parseRendererOutput(
				'{"ok":true,"png":"C:\\\\out\\\\a.png","width":1280,"height":800,"root":"MainWindow","mode":"rootObjectInstance","ms":123}',
			);

			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.pngPath, 'C:\\out\\a.png');
			assert.strictEqual(result.width, 1280);
			assert.strictEqual(result.height, 800);
			assert.strictEqual(result.root, 'MainWindow');
			assert.strictEqual(result.mode, 'rootObjectInstance');
		});

		it('取最后一行可解析的结果，跳过前面的日志与无关 JSON', () => {
			const stdout = [
				'MSBuild version 17.9.0',
				'{"version":"1.2.3"}',
				'Restored 3 projects',
				'{"ok":true,"png":"/tmp/a.png"}',
			].join('\n');

			const result = parseRendererOutput(stdout);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.pngPath, '/tmp/a.png');
		});

		it('失败结果带出 error 与 errorType', () => {
			const result = parseRendererOutput(
				'{"ok":false,"error":"Specified class name \'X\' doesn\'t match actual root instance type","errorType":"XamlParseException","ms":12}',
			);

			assert.strictEqual(result.ok, false);
			assert.ok(result.error?.includes('Specified class name'));
			assert.strictEqual(result.errorType, 'XamlParseException');
		});

		it('失败但没给原因时给出可诊断文案', () => {
			const result = parseRendererOutput('{"ok":false}');
			assert.strictEqual(result.ok, false);
			assert.ok(result.error?.includes('没有给出原因'), `实际：${result.error}`);
		});

		it('完全不是 JSON → 失败且可诊断', () => {
			const result = parseRendererOutput('boom: something went wrong\nat Program.cs:line 42');
			assert.strictEqual(result.ok, false);
			assert.ok(result.error?.includes('没有输出可解析的结果 JSON'), `实际：${result.error}`);
		});

		it('空 stdout → 失败', () => {
			assert.strictEqual(parseRendererOutput('').ok, false);
			assert.strictEqual(parseRendererOutput('   \n\t\n').ok, false);
		});

		it('非法 JSON 行被跳过，继续往前找', () => {
			const stdout = ['{ not json at all', '{"ok":true,"png":"x.png"}'].join('\n');
			assert.strictEqual(parseRendererOutput(stdout).pngPath, 'x.png');
		});

		it('报告成功但缺 png → 视为失败', () => {
			const result = parseRendererOutput('{"ok":true,"width":10}');
			assert.strictEqual(result.ok, false);
			assert.ok(result.error?.includes('没有给出 PNG 路径'), `实际：${result.error}`);
		});

		it('非对象 JSON（数组/字面量）被跳过', () => {
			assert.strictEqual(parseRendererOutput('[1,2,3]').ok, false);
			assert.strictEqual(parseRendererOutput('{"ok":true,"png":"a.png"}\n[1,2]').pngPath, 'a.png');
		});

		it('最后一行是无关 JSON 对象（如版本信息）时，必须继续往前找真正的结果', () => {
			const stdout = [
				'{"ok":true,"png":"C:/out/a.png","width":1280,"height":800}',
				'{"version":"1.7.0","commit":"abc123"}',
			].join('\n');

			const result = parseRendererOutput(stdout);
			assert.strictEqual(result.ok, true, `实际：${result.error}`);
			assert.strictEqual(result.pngPath, 'C:/out/a.png');
			assert.strictEqual(result.width, 1280);
		});
	});

	describe('renderXaml', () => {
		it('可执行文件不存在 → 返回失败，而不是抛异常', async () => {
			const result = await renderXaml({ executable: 'wispkit-definitely-missing-renderer-xyz' }, 'a.xaml', 'b.png');
			assert.strictEqual(result.ok, false);
			assert.ok(result.error?.includes('找不到渲染器可执行文件'), `实际：${result.error}`);
		});

		it('非零退出 → 返回失败，error 里带退出码', async () => {
			// 用 node 启动一个不存在的脚本：进程以非零码退出并往 stderr 写堆栈
			const result = await renderXaml({ executable: process.execPath }, 'a.xaml', 'b.png');
			assert.strictEqual(result.ok, false);
			assert.ok(result.error?.includes('退出码'), `实际：${result.error}`);
		});

		it('成功路径：解析出 PNG 与尺寸（mock 渲染器 + 真实子进程）', async () => {
			// renderXaml 固定以 args[0]='render' 启动，所以 mock 是一个叫 render 的脚本，
			// 让 node 按 cwd 解析到它 —— 这样走的是真实 spawn 路径，不是打桩。
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispkit-xaml-render-'));
			const originalCwd = process.cwd();
			try {
				fs.writeFileSync(path.join(dir, 'render'), [
					"console.log('building project...');",
					'const out = process.argv[3];',
					"console.log(JSON.stringify({ ok: true, png: out, width: 640, height: 480, root: 'MainWindow', mode: 'rootObjectInstance', ms: 9 }));",
				].join('\n'), 'utf8');

				process.chdir(dir);
				const result = await renderXaml(
					{ executable: process.execPath, extraAssemblies: ['App.dll'] },
					'in.xaml',
					'out.png',
				);

				assert.strictEqual(result.ok, true, `实际：${result.error}`);
				assert.strictEqual(result.pngPath, 'out.png');
				assert.strictEqual(result.width, 640);
				assert.strictEqual(result.height, 480);
				assert.strictEqual(result.root, 'MainWindow');
			} finally {
				process.chdir(originalCwd);
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		it('mock 渲染器自报失败 → 把它的 error 原样带出', async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispkit-xaml-fail-'));
			const originalCwd = process.cwd();
			try {
				fs.writeFileSync(path.join(dir, 'render'), [
					"console.log(JSON.stringify({ ok: false, error: 'Cannot create unknown type WorkSpaceTreeView', errorType: 'XamlParseException' }));",
					'process.exit(1);',
				].join('\n'), 'utf8');

				process.chdir(dir);
				const result = await renderXaml({ executable: process.execPath }, 'in.xaml', 'out.png');

				assert.strictEqual(result.ok, false);
				assert.ok(result.error?.includes('Cannot create unknown type WorkSpaceTreeView'), `实际：${result.error}`);
				assert.strictEqual(result.errorType, 'XamlParseException');
			} finally {
				process.chdir(originalCwd);
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
