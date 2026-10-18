import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { renderSubtreePage, SUBTREE_ICON_NAMES, type SubtreeViewConfig } from '../subtree/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';
import type { WebviewIconTheme } from '../subtree/iconTheme';

const CSP_SOURCE = 'vscode-webview://abc';
const ROOT = 'C:\\demo';

const CONFIG: SubtreeViewConfig = {
	rootPath: ROOT,
	rootName: 'demo',
	owner: 'tester',
	columns: [
		{ id: 'name', label: '名称', align: 'left', width: 280 },
		{ id: 'size', label: '大小', align: 'right', width: 90 },
		{ id: 'mtime', label: '修改时间', align: 'left', width: 160 },
	],
	commands: [
		{
			id: 'wispkit.subtree.rename', label: '重命名', kind: 'native', source: 'wispkit', group: 'edit', icon: 'rename',
			appliesTo: 'single', disabledReason: '重命名一次只能作用于一个条目',
		},
		{
			id: 'wispkit.subtree.newFile', label: '新建文件', kind: 'native', source: 'wispkit', group: 'edit', icon: 'new-file',
			appliesTo: 'folders', disabledReason: '新建文件需要选中一个文件夹（或取消选中，作用于根目录）',
		},
		{ id: 'copyFilePath', label: '复制绝对路径', kind: 'builtin', source: 'builtin', group: 'path', icon: 'link', appliesTo: 'any' },
		{
			id: 'revealInExplorer', label: '在资源管理器中显示', kind: 'builtin', source: 'builtin', group: 'navigate', icon: 'reveal',
			appliesTo: 'single', disabledReason: '请在子树里选中一个条目',
		},
		{ id: 'demo.doThing', label: '做点事', kind: 'extension', source: 'demo.ext', group: 'extension', icon: 'extension', appliesTo: 'any' },
	],
	tools: [
		{ label: '打开终端', command: 'cmd', shell: 'newTerminal' },
	],
	sort: { key: 'name', direction: 'asc' },
};

/** 一份假的「用户图标主题」：只关心 URI 有没有落到条目上，所以路径随便填。 */
const ICON_THEME: WebviewIconTheme = {
	file: `${CSP_SOURCE}/file.svg`,
	folder: `${CSP_SOURCE}/folder.svg`,
	folderExpanded: `${CSP_SOURCE}/folder-open.svg`,
	byExtension: { ts: `${CSP_SOURCE}/typescript.svg` },
	byFileName: { 'readme.md': `${CSP_SOURCE}/readme.svg` },
};

function pageHtml(config: SubtreeViewConfig = CONFIG): string {
	return renderSubtreePage({
		title: 'demo',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: `${CSP_SOURCE}/subtree.js`,
		runtimeStyle: `${CSP_SOURCE}/subtree.css`,
		config,
	});
}

const SUB = `${ROOT}\\sub`;
const NESTED = `${ROOT}\\sub\\nested`;
const A_TXT = `${ROOT}\\a.txt`;

const LEVELS: Record<string, unknown[]> = {
	[ROOT]: [
		{ name: 'sub', path: SUB, isDirectory: true, cells: { name: 'sub', size: '-', mtime: '-' } },
		{ name: 'a.txt', path: A_TXT, isDirectory: false, cells: { name: 'a.txt', size: '1.5 KB', mtime: '2024-01-02 03:04:05' } },
	],
	[SUB]: [
		{ name: 'deep.md', path: `${SUB}\\deep.md`, isDirectory: false, cells: { name: 'deep.md', size: '12 B', mtime: '-' } },
		{ name: 'nested', path: NESTED, isDirectory: true, cells: { name: 'nested', size: '-', mtime: '-' } },
	],
	[NESTED]: [
		{ name: 'x.md', path: `${NESTED}\\x.md`, isDirectory: false, cells: { name: 'x.md', size: '1 B', mtime: '-' } },
	],
};

/** jsdom 在 about:blank 下访问 localStorage 会抛 SecurityError；换一份内存实现，让「记忆」可测。 */
function installStorage(dom: JSDOM): Map<string, string> {
	const store = new Map<string, string>();
	Object.defineProperty(dom.window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, String(value)),
			removeItem: (key: string) => void store.delete(key),
			clear: () => store.clear(),
		},
	});
	return store;
}

function setupPage(config: SubtreeViewConfig = CONFIG) {
	const dom = installDom(pageHtml(config));
	const store = installStorage(dom);
	loadMediaModule('media/subtree.js');
	const api = (dom.window as unknown as { __wispkitSelftest: any }).__wispkitSelftest;
	api.applyLevel(ROOT, LEVELS[ROOT]);
	return { dom, doc: dom.window.document, api, store };
}

describe('subtree/page', () => {
	it('CSP、nonce 与配置 meta 正确落地，且不出现 data-settings', () => {
		const html = pageHtml();
		assert.ok(html.includes(`script-src 'nonce-NONCE1'`));
		assert.ok(html.includes(`src="vscode-webview://abc/subtree.js" nonce="NONCE1"`));
		assert.ok(html.includes('id="wispkit-subtree-config"'));
		assert.ok(/data-wispkit="[^"]*rootPath/.test(html));
		assert.ok(!html.includes('data-settings'), 'data-settings 会被内置 markdown 预览脚本抢走');
	});

	it('列宽按配置生成 CSS 变量（表头与数据行共用同一组值）', () => {
		const html = pageHtml();
		assert.ok(html.includes('--wispkit-col-name:280px'));
		assert.ok(html.includes('--wispkit-col-size:90px'));
		assert.ok(html.includes('--wispkit-col-mtime:160px'));
	});

	it('内联 SVG sprite 含全部图标定义（图标随主题靠 currentColor，不引外部字体）', () => {
		const html = pageHtml();
		assert.ok(html.includes('class="wispkit-subtree-sprite"'));
		for (const name of SUBTREE_ICON_NAMES) {
			assert.ok(html.includes(`id="wispkit-icon-${name}"`), `sprite 里缺少 ${name}`);
		}
		assert.ok(html.includes('stroke="currentColor"'), '图标线条必须跟随主题色');
		assert.ok(!/codicon|\.ttf|\.woff/.test(html), '不应引入图标字体文件');
	});

	it('工具栏按钮除文字外都带图标', () => {
		const { doc } = setupPage();
		for (const id of ['wispkit-subtree-refresh', 'wispkit-subtree-collapse-all', 'wispkit-subtree-expand-root']) {
			const button = doc.getElementById(id);
			assert.ok(button, `缺少 ${id}`);
			assert.ok(button.querySelector('use'), `${id} 缺少图标`);
			assert.ok((button.textContent ?? '').trim().length > 0, `${id} 缺少文字`);
		}
	});

	it('图标主题可用时，条目直接用主题自己的图标（mask + currentColor），与资源管理器一致', () => {
		const { doc } = setupPage({ ...CONFIG, iconTheme: ICON_THEME });
		const icons = [...doc.querySelectorAll('.wispkit-subtree-item-icon')];
		assert.ok(icons.length >= 2, '根层两个条目都该有图标');
		for (const icon of icons) {
			assert.strictEqual(icon.tagName, 'SPAN');
			assert.ok(icon.classList.contains('wispkit-subtree-icon'), '应当用主题图标的容器类');
			assert.ok(
				(icon.getAttribute('style') ?? '').includes('--wispkit-subtree-icon-mask'),
				'必须把主题图标的 URI 写进 mask 变量',
			);
		}
		const masks = icons.map(icon => icon.getAttribute('style') ?? '');
		assert.ok(masks.some(m => m.includes('folder.svg')), '目录应当用主题的 folder 图标');
		assert.ok(masks.some(m => m.includes('file.svg')), '无专属映射的文件应当落到默认 file 图标');
		assert.strictEqual(doc.querySelectorAll('.wispkit-subtree-item-icon use').length, 0, '条目不该再用自绘 sprite');
	});

	it('没有图标主题时回退到内联自绘 sprite，不出现 mask 图标', () => {
		const { doc } = setupPage();
		assert.ok(doc.querySelectorAll('.wispkit-subtree-item-icon use').length >= 2, '应当用 sprite 的 <use>');
		assert.strictEqual(doc.querySelectorAll('.wispkit-subtree-icon').length, 0, '回退时不该有主题图标');
	});

	it('主题图标按资源管理器的口径匹配：完整文件名优先于扩展名', () => {
		const { dom, api } = setupPage({ ...CONFIG, iconTheme: ICON_THEME });
		api.applyLevel(ROOT, [
			{ name: 'README.md', path: `${ROOT}\\README.md`, isDirectory: false, cells: { name: 'README.md' } },
			{ name: 'app.ts', path: `${ROOT}\\app.ts`, isDirectory: false, cells: { name: 'app.ts' } },
		]);
		const masks = [...dom.window.document.querySelectorAll('.wispkit-subtree-item-icon')].map(
			icon => icon.getAttribute('style') ?? '',
		);
		assert.ok(masks.some(m => m.includes('readme.svg')), 'readme.md 应当命中 fileNames');
		assert.ok(masks.some(m => m.includes('typescript.svg')), 'app.ts 应当命中 fileExtensions');
	});

	it('工具栏最右是选中项路径所在元素（取代原先的文件夹名）', () => {
		const html = pageHtml();
		assert.ok(html.includes('id="wispkit-subtree-selected-path"'));
		assert.ok(!html.includes('id="wispkit-subtree-root"'));
	});

	it('工具栏与右侧操作区的容器都在', () => {
		const html = pageHtml();
		for (const id of [
			'wispkit-subtree-refresh',
			'wispkit-subtree-collapse-all',
			'wispkit-subtree-expand-root',
			'wispkit-subtree-selected-path',
			'wispkit-subtree-header',
			'wispkit-subtree-rows',
			'wispkit-subtree-splitter',
			'wispkit-subtree-actions',
			'wispkit-subtree-commands-section',
			'wispkit-subtree-commands',
			'wispkit-subtree-tools-section',
			'wispkit-subtree-tools',
			'wispkit-subtree-status',
		]) {
			assert.ok(html.includes(`id="${id}"`), `缺少 ${id}`);
		}
		// 右侧操作区原来还有一块和工具栏重复的「未选中条目 / 名称+路径」，已去掉
		assert.ok(!html.includes('id="wispkit-subtree-selection"'), '右侧不该再有与工具栏重复的选中信息块');
	});

	it('页面里没有重复 id', () => {
		const html = pageHtml();
		const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
		const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
		assert.deepStrictEqual(duplicated, [], `重复 id：${duplicated.join(', ')}`);
	});
});

describe('media/subtree.js', () => {
	it('表头按配置的列顺序渲染', () => {
		const { api, doc } = setupPage();
		assert.deepStrictEqual(api.headers(), ['名称', '大小', '修改时间']);
		assert.deepStrictEqual(api.columns(), ['name', 'size', 'mtime']);
		assert.ok(doc.getElementById('wispkit-subtree-header'));
	});

	it('行按列顺序摆放单元格，且取值来自宿主格式化的 cells', () => {
		const { api } = setupPage();
		const rows = api.rows();
		assert.strictEqual(rows.length, 2);
		assert.deepStrictEqual(rows[0].cells, ['sub', '-', '-']);
		assert.deepStrictEqual(rows[1].cells, ['a.txt', '1.5 KB', '2024-01-02 03:04:05']);
		assert.strictEqual(rows[0].depth, 0);
	});

	it('文件夹与文件用 sprite 图标区分，文件按扩展名取类型图标', () => {
		const { api, doc } = setupPage();
		const icons = () => Array.from(doc.querySelectorAll('.wispkit-subtree-row .wispkit-subtree-item-icon use'))
			.map(use => use.getAttribute('href'));

		assert.deepStrictEqual(icons(), ['#wispkit-icon-folder', '#wispkit-icon-file-text'], 'a.txt 走文本类型图标');

		// 同一层里铺开多种类型：图标必须各不相同，不能退化成清一色的通用 file。
		// 渲染是深度优先就地插入的，所以顺序是 sub → sub 的子层 → a.txt。
		api.applyLevel(SUB, LEVELS[SUB]);
		api.expand(SUB);
		api.applyLevel(NESTED, [
			{ name: 'm.py', path: `${NESTED}\\m.py`, isDirectory: false, cells: { name: 'm.py' } },
			{ name: 'n.png', path: `${NESTED}\\n.png`, isDirectory: false, cells: { name: 'n.png' } },
			{ name: 'o.zip', path: `${NESTED}\\o.zip`, isDirectory: false, cells: { name: 'o.zip' } },
			{ name: 'p.json', path: `${NESTED}\\p.json`, isDirectory: false, cells: { name: 'p.json' } },
			{ name: 'q.unknownext', path: `${NESTED}\\q.unknownext`, isDirectory: false, cells: { name: 'q.unknownext' } },
			{ name: '.gitignore', path: `${NESTED}\\.gitignore`, isDirectory: false, cells: { name: '.gitignore' } },
		]);
		api.expand(NESTED);

		assert.deepStrictEqual(icons(), [
			'#wispkit-icon-folder-open',     // sub：此刻已展开，所以是展开态文件夹（折叠态由上面的初始断言覆盖）
			'#wispkit-icon-file-markdown',   // deep.md
			'#wispkit-icon-folder-open',     // nested：已展开
			'#wispkit-icon-file-code',       // m.py
			'#wispkit-icon-file-image',      // n.png
			'#wispkit-icon-file-archive',    // o.zip
			'#wispkit-icon-file-config',     // p.json
			'#wispkit-icon-file',            // q.unknownext：认不出 → 通用
			'#wispkit-icon-file-config',     // .gitignore：点号开头算无扩展名 → gitignore → 配置
			'#wispkit-icon-file-text',       // a.txt
		]);
	});

	it('类型图标只认名字里的扩展名，与「扩展名」列是否显示无关', () => {
		// 配置里没有 ext 列，图标仍然要正确 —— 否则用户一关那列图标就全变通用 file
		const noExtColumn: SubtreeViewConfig = {
			...CONFIG,
			columns: [{ id: 'name', label: '名称', align: 'left', width: 280 }],
		};
		const { doc } = setupPage(noExtColumn);
		const icons = Array.from(doc.querySelectorAll('.wispkit-subtree-row .wispkit-subtree-item-icon use'))
			.map(use => use.getAttribute('href'));
		assert.deepStrictEqual(icons, ['#wispkit-icon-folder', '#wispkit-icon-file-text']);
	});

	it('展开目录时才把它那一层插进来，depth 递增；折叠后消失', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);

		assert.strictEqual(api.rowCount(), 2, '未展开时子层不出现');
		api.expand(SUB);
		assert.strictEqual(api.rowCount(), 4, 'sub 展开后应多出 deep.md 与 nested');
		assert.strictEqual(api.rows()[1].depth, 1);
		assert.ok(api.rows()[1].path.endsWith('deep.md'));

		api.collapse(SUB);
		assert.strictEqual(api.rowCount(), 2);
	});

	it('按钮按「选中项形状」启用，而不是一律全开全关', () => {
		const { api, doc } = setupPage();
		const byLabel = (label: string) => Array.from(doc.querySelectorAll('#wispkit-subtree-commands .wispkit-subtree-action'))
			.find(button => button.querySelector('.wispkit-subtree-action-label')?.textContent === label) as HTMLButtonElement | undefined;

		// 未选中：需要选中项的命令禁用；`folders` 类（新建文件）仍可用 —— 它作用于根目录
		assert.strictEqual(api.selectedPath(), null);
		assert.strictEqual(byLabel('重命名')?.disabled, true);
		assert.strictEqual(byLabel('复制绝对路径')?.disabled, true);
		assert.strictEqual(byLabel('新建文件')?.disabled, false);

		api.select(A_TXT);
		assert.strictEqual(api.selectedPath(), A_TXT);
		assert.strictEqual(doc.querySelectorAll('.wispkit-subtree-row.is-selected').length, 1);
		assert.strictEqual(byLabel('重命名')?.disabled, false);
		assert.strictEqual(byLabel('复制绝对路径')?.disabled, false);
		// 选中文件时「新建文件」必须置灰 —— 这正是用户报的「选中文件还能新建文件」
		assert.strictEqual(byLabel('新建文件')?.disabled, true);
		assert.match(byLabel('新建文件')?.title ?? '', /不可用：/);

		// 右侧不再有重复的选中信息块；路径只出现在工具栏最右
		assert.strictEqual(doc.getElementById('wispkit-subtree-selection'), null);
		assert.match(api.selectedPathText(), /a\.txt/);
	});

	it('选中项的完整路径显示在工具栏最右；没选中时退回根路径', () => {
		const { api } = setupPage();
		assert.strictEqual(api.selectedPathText(), ROOT);

		api.select(A_TXT);
		assert.strictEqual(api.selectedPathText(), A_TXT);

		api.select(NESTED);
		assert.strictEqual(api.selectedPathText(), NESTED);
	});

	it('多选：Ctrl 切换单项、Shift 连选可见范围、全选覆盖所有可见行', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.expand(SUB);

		api.select(SUB);
		assert.deepStrictEqual(api.selectedPaths(), [SUB]);

		// Ctrl：追加，再一次则取消该项
		assert.deepStrictEqual(api.selectWithModifiers(A_TXT, { ctrlKey: true }), [SUB, A_TXT]);
		assert.deepStrictEqual(api.selectWithModifiers(SUB, { ctrlKey: true }), [A_TXT]);

		// Shift：从锚点连选（可见顺序为 sub → deep.md → nested → a.txt）
		api.select(SUB);
		assert.deepStrictEqual(api.selectWithModifiers(A_TXT, { shiftKey: true }), [SUB, `${SUB}\\deep.md`, NESTED, A_TXT]);
		assert.strictEqual(api.selectedRowCount(), 4);

		assert.deepStrictEqual(api.selectAll(), [SUB, `${SUB}\\deep.md`, NESTED, A_TXT]);
	});

	it('批量操作把所有选中项一起发给宿主；自研操作走 fileAction 通道', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.expand(SUB);

		// 多选 + 内置命令：走 executeCommand 通道，路径整组带上
		api.select(SUB);
		api.selectWithModifiers(A_TXT, { ctrlKey: true });
		assert.ok(api.clickCommandByLabel('复制绝对路径'));

		assert.deepStrictEqual(api.lastMessage(), {
			type: 'wispkit.subtree.command',
			command: 'copyFilePath',
			paths: [SUB, A_TXT],
		});

		// 「重命名」要求恰好一个选中项：多选时它是禁用的，点了也不该发出消息
		assert.ok(api.clickCommandByLabel('重命名'));
		assert.strictEqual(api.lastMessage()?.type, 'wispkit.subtree.command', '禁用的按钮不该发消息');

		// 单选后「重命名」可用，且走自研通道（宿主据此操作子树选中项，而非资源管理器）
		api.select(A_TXT);
		assert.ok(api.clickCommandByLabel('重命名'));
		assert.deepStrictEqual(api.lastMessage(), {
			type: 'wispkit.subtree.fileAction',
			action: 'wispkit.subtree.rename',
			paths: [A_TXT],
		});

		api.selectAll();
		assert.ok(api.clickToolByLabel('打开终端'));
		assert.deepStrictEqual(api.lastMessage(), {
			type: 'wispkit.subtree.tool',
			index: 0,
			paths: [SUB, `${SUB}\\deep.md`, NESTED, A_TXT],
		});
	});

	it('点列头排序：同列切换升降序、指示器跟着变、重排请求带上已加载层级', () => {
		const { api } = setupPage();
		assert.deepStrictEqual(api.sortState(), { key: 'name', direction: 'asc' });

		assert.deepStrictEqual(api.sortBy('size'), { key: 'size', direction: 'asc' });
		assert.deepStrictEqual(api.sortIndicator(), { column: 'size', direction: 'asc', icon: '#wispkit-icon-sort-asc' });
		assert.deepStrictEqual(api.lastMessage(), {
			type: 'wispkit.subtree.sort',
			key: 'size',
			direction: 'asc',
			paths: [ROOT],
		});

		assert.deepStrictEqual(api.sortBy('size'), { key: 'size', direction: 'desc' });
		assert.strictEqual(api.sortIndicator()?.icon, '#wispkit-icon-sort-desc');

		// 换一列回到升序
		assert.deepStrictEqual(api.sortBy('mtime'), { key: 'mtime', direction: 'asc' });
	});

	it('type-ahead：字母累积跳到同名开头的条目', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.expand(SUB);

		assert.strictEqual(api.typeAhead('a.'), 'a.txt');
		assert.strictEqual(api.selectedPath(), A_TXT);

		assert.strictEqual(api.typeAhead('ne'), 'nested');
		assert.strictEqual(api.selectedPath(), NESTED);

		assert.strictEqual(api.typeAhead('zzz'), null, '没有匹配时不应改变选择');
		assert.strictEqual(api.selectedPath(), NESTED);
	});

	it('列宽可调并记住；复位回到配置宽度', () => {
		const { api, store } = setupPage();
		assert.strictEqual(api.columnWidths().name, 280);

		assert.strictEqual(api.setColumnWidth('name', 360), 360);
		assert.strictEqual(api.columnWidths().name, 360);
		assert.match(store.get('wispkit.subtree.columnWidths') ?? '', /"name":360/);

		// 太窄会被夹到下限，不会缩成看不见
		assert.strictEqual(api.setColumnWidth('name', 4), 48);

		assert.strictEqual(api.resetColumnWidth('name'), 280);
		assert.deepStrictEqual(api.storedColumnWidths(), {});
	});

	it('文件操作按功能类别分组，组间有标题与分隔', () => {
		const { api, doc } = setupPage();
		const groups = api.commandGroups();
		assert.deepStrictEqual(groups.map((group: any) => group.title), ['编辑', '路径', '导航', '扩展提供']);
		assert.deepStrictEqual(groups[0].labels, ['重命名', '新建文件']);
		assert.deepStrictEqual(groups[3].labels, ['做点事']);
		assert.strictEqual(doc.querySelectorAll('#wispkit-subtree-commands .wispkit-subtree-group').length, 4);
	});

	it('操作按钮带图标；扩展贡献的命令标注来源，内置的带中文标签', () => {
		const { api } = setupPage();
		assert.deepStrictEqual(api.actionIcons(), [
			'#wispkit-icon-rename',
			'#wispkit-icon-new-file',
			'#wispkit-icon-link',
			'#wispkit-icon-reveal',
			'#wispkit-icon-extension',
		]);

		const labels = api.commandLabels();
		assert.ok(labels[0].includes('重命名'), '文件操作用中文标签');
		assert.ok(labels[4].includes('做点事'), '扩展命令保留原作者语言');
		// 按钮右侧那个重复的来源名称已去掉，来源改由 title 说明
		assert.ok(labels.every((label: string) => !label.includes('demo.ext')), '按钮上不该再挂来源名称');
		assert.ok(labels.every((label: string) => !label.includes('wispkit')), '按钮上不该出现内部 id');
	});

	it('工具按钮显示执行方式徽标；没配工具时整个工具区隐藏', () => {
		const withTool = setupPage();
		assert.strictEqual(withTool.api.toolLabels().length, 1);
		assert.ok(withTool.api.toolLabels()[0].includes('newTerminal'));
		assert.strictEqual(withTool.api.toolsSectionHidden(), false);

		const withoutTool = setupPage({ ...CONFIG, tools: [] });
		assert.strictEqual(withoutTool.api.toolLabels().length, 0);
		assert.strictEqual(withoutTool.api.toolsSectionHidden(), true, '没配工具时不该留一块空标题');
	});

	it('「展开一层」作用于子树表格里选中的文件夹；选中文件时置灰且不展开任何东西', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.applyLevel(NESTED, LEVELS[NESTED]);

		// 选中 sub：展开的应当是 sub 的子文件夹（nested），而不是根的子文件夹（sub）
		api.select(SUB);
		const selected = api.expandSelected();
		assert.strictEqual(selected.applicable, true);
		assert.strictEqual(selected.target, SUB);
		assert.deepStrictEqual(api.expandedPaths(), [NESTED]);

		// 选中文件：**不适用** —— 不再展开任何层级（用户报的「对象错了」正是这里）
		const before = api.expandedPaths().slice().sort();
		api.select(A_TXT);
		const onFile = api.expandSelected();
		assert.strictEqual(onFile.applicable, false);
		assert.strictEqual(onFile.target, null);
		assert.deepStrictEqual(api.expandedPaths().slice().sort(), before, '对文件点「展开一层」不该再展开任何层级');
		assert.strictEqual(onFile.disabled, true, '按钮要跟着置灰');

		// 完全没选中 → 作用于根目录（首屏仍然可用）
		api.select(null);
		const onNothing = api.expandSelected();
		assert.strictEqual(onNothing.applicable, true);
		assert.strictEqual(onNothing.target, ROOT);
	});

	it('「展开一层」是切换：子文件夹已全部展开时再点一次就收起', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.select(SUB);

		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths(), [NESTED], '第一次点：展开 sub 的直接子文件夹');

		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths(), [], '再点一次：全部收起（用户报的"没办法切换展开状态"就是这里）');

		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths(), [NESTED], '第三次点：又展开，来回可切');
	});

	it('「展开一层」收起时保留后代的展开状态，重新展开后不丢', () => {
		const { api } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.applyLevel(NESTED, LEVELS[NESTED]);
		api.expand(NESTED);
		api.select(SUB);
		assert.deepStrictEqual(api.expandedPaths().slice().sort(), [NESTED].sort());

		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths(), [], '收起 sub 的直接子层（nested）');

		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths().slice().sort(), [NESTED].sort(),
			'重新展开：nested 的展开状态仍在（折叠只改可见性，不改状态）');
	});

	it('目标下没有子文件夹时「展开一层」不改动任何状态', () => {
		const { api } = setupPage();
		api.applyLevel(NESTED, LEVELS[NESTED]);   // NESTED 里只有 x.md，没有子文件夹
		api.select(NESTED);
		const before = api.expandedPaths().slice().sort();

		api.expandSelected();
		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths().slice().sort(), before, '没有子文件夹可切，点了不该乱改状态');
	});

	it('多选文件夹时对每个各自切换，而不是按多数状态统一', () => {
		const { api } = setupPage();
		const OTHER = `${ROOT}\\other`;
		const INNER = `${OTHER}\\inner`;
		api.applyLevel(ROOT, [
			...LEVELS[ROOT],
			{ name: 'other', path: OTHER, isDirectory: true, cells: { name: 'other', size: '-', mtime: '-' } },
		]);
		api.applyLevel(SUB, LEVELS[SUB]);   // sub 的子文件夹：nested
		api.applyLevel(OTHER, [{ name: 'inner', path: INNER, isDirectory: true, cells: { name: 'inner', size: '-', mtime: '-' } }]);

		// other 的子文件夹已展开，sub 的还折叠着 —— 两者状态不同
		api.expand(OTHER);
		api.expand(INNER);
		assert.deepStrictEqual(api.expandedPaths().slice().sort(), [INNER, OTHER].sort());

		api.selectMany([SUB, OTHER]);
		const result = api.expandSelected();
		assert.strictEqual(result.applicable, true);
		assert.deepStrictEqual(api.expandedPaths().slice().sort(), [NESTED, OTHER].sort(),
			'sub 应当展开它的子文件夹、other 应当收起它的 —— 各自切换，而不是统一展开或统一收起');
	});

	it('层级缩进只在名称列内部，其余列不随层级右移', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'subtree.css'), 'utf8');
		// 同一选择器可能出现在多条规则里（名称列既有"列宽"那条，也有"对齐/缩进"那条），
		// 所以把所有匹配到的规则体拼起来断言 —— 只取第一条会漏掉真正要看的那条。
		const ruleBody = (selector: string) => {
			const escaped = selector.replace(/[.[\]"=*+?^${}()|\\/]/g, ch => `\\${ch}`);
			const bodies = Array.from(css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g')))
				.map(match => match[1]);
			assert.ok(bodies.length > 0, `CSS 里找不到规则 ${selector}`);
			return bodies.join('\n');
		};

		const nameRule = ruleBody('.wispkit-subtree-cell[data-column="name"]');
		assert.ok(/padding-left:\s*6px/.test(nameRule), '名称列左内边距必须是固定值');
		assert.ok(!nameRule.includes('--wispkit-depth'),
			'缩进不能写成名称列的 padding-left —— 单元格是 content-box，padding 会撑宽单元格本身、把后面每一列一起推右');

		const indentRule = ruleBody('.wispkit-subtree-indent');
		assert.ok(indentRule.includes('--wispkit-depth'), '缩进量由名称列内部的占位元素按层级取值');

		const cellRule = ruleBody('.wispkit-subtree-cell');
		assert.ok(/box-sizing:\s*border-box/.test(cellRule), '单元格必须 border-box（双保险：padding 不得改变列宽）');
	});

	it('缩进占位元素是名称列的首个子元素，其余列不得有它', () => {
		const { api, doc } = setupPage();
		api.applyLevel(SUB, LEVELS[SUB]);
		api.expand(SUB);

		const rows = Array.from(doc.querySelectorAll('.wispkit-subtree-row')) as any[];
		const deepRow = rows.find(row => row.dataset.path === `${SUB}\\deep.md`);
		assert.ok(deepRow, '深层行应当被渲染出来');
		assert.strictEqual(deepRow.dataset.depth, '1');
		assert.strictEqual(deepRow.style.getPropertyValue('--wispkit-depth'), '1');

		const nameCell = deepRow.querySelector('.wispkit-subtree-cell[data-column="name"]');
		assert.strictEqual(nameCell.firstElementChild.className, 'wispkit-subtree-indent',
			'缩进是名称列内部的首个子元素（而不是加在行或单元格上）');

		for (const column of ['size', 'mtime']) {
			const cell = deepRow.querySelector(`.wispkit-subtree-cell[data-column="${column}"]`);
			assert.strictEqual(cell.querySelector('.wispkit-subtree-indent'), null, `${column} 列不该带缩进`);
		}
	});

	it('展开尚未读过的层时先读盘，读完再自动展开（不用点第二次）', () => {
		const { api } = setupPage();
		api.select(SUB);
		api.expandSelected();
		assert.deepStrictEqual(api.expandedPaths(), [], '还没读到 sub 的子项，先记挂起');

		api.applyLevel(SUB, LEVELS[SUB]);
		assert.deepStrictEqual(api.expandedPaths(), [NESTED], '回包之后自动展开');
	});

	it('读盘失败时把原因显示在树里，而不是静默空着', () => {
		const { api, doc } = setupPage();
		// 只有出现在树里的层级才会被渲染：先展开，再收到失败回包
		api.expand(SUB);
		api.applyLevel(SUB, [], '无法读取：EACCES');
		assert.match(doc.getElementById('wispkit-subtree-rows')?.textContent ?? '', /EACCES/);
	});

	it('空文件夹显示明确提示', () => {
		const { api, doc } = setupPage();
		api.expand(SUB);
		api.applyLevel(SUB, []);
		assert.match(doc.getElementById('wispkit-subtree-rows')?.textContent ?? '', /空文件夹/);
	});

	it('配置变化后按新的列重新渲染表头', () => {
		const { api } = setupPage();
		api.applyConfig({
			...CONFIG,
			columns: [{ id: 'name', label: '名称', align: 'left', width: 200 }, { id: 'owner', label: '用户', align: 'left', width: 120 }],
		});
		assert.deepStrictEqual(api.headers(), ['名称', '用户']);
	});

	it('rootPath 变化时会重新请求根层（清掉旧缓存）', () => {
		const { api } = setupPage();
		assert.strictEqual(api.rowCount(), 2);
		api.applyConfig({ ...CONFIG, rootPath: 'C:\\other', rootName: 'other' });
		assert.strictEqual(api.rowCount(), 0, '换了根就不该还留着旧的行');
		assert.strictEqual(api.rootPath(), 'C:\\other');
	});
});
