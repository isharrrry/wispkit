import * as assert from 'assert';

import { iconRelativePath, mergeLanguageIcons, parseIconTheme } from '../subtree/iconTheme';

/**
 * 一份「SVG 形态」的最小主题。字段名与结构取自本机真实生效的
 * `vscode-modern-icons`（内置扩展 theme-modern-icons），只是把图标数量压到最小。
 *
 * 注意 `fileExtensions` 与 `languageIds` 的取值**刻意复刻真机那份 json 的形态**：
 * `vscode-modern-icons` 里 `fileExtensions.md` 是**空字符串**、`fileExtensions.json` 也是空，
 * 真正的图标由 `languageIds`（语言 id → 图标）决定 —— 这正是子树图标曾与资源管理器
 * 不一致的根因，所以 fixture 必须保留这个"扩展名映射为空"的特征。
 */
function svgTheme(overrides: Record<string, unknown> = {}): unknown {
	return {
		iconDefinitions: {
			_file: { iconPath: './images/file.svg' },
			_folder: { iconPath: './images/folder.svg' },
			_folderOpen: { iconPath: './images/folder-open.svg' },
			_typescript: { iconPath: './images/typescript.svg' },
			_markdown: { iconPath: './images/markdown.svg' },
			_json: { iconPath: './images/json.svg' },
			_javascript: { iconPath: './images/javascript.svg' },
			_info: { iconPath: './images/info.svg' },
		},
		file: '_file',
		folder: '_folder',
		folderExpanded: '_folderOpen',
		fileExtensions: { ts: '_typescript', tsx: '_typescript', md: '', json: '' },
		fileNames: { readme: '_info' },
		languageIds: { markdown: '_markdown', json: '_json', javascript: '_javascript' },
		...overrides,
	};
}

describe('subtree/iconTheme', () => {
	it('解析 SVG 形态的主题：默认图标、文件夹、扩展名与文件名映射、图标路径', () => {
		const theme = parseIconTheme(svgTheme());
		assert.ok(theme, '应当解析成功');
		assert.strictEqual(theme.file, '_file');
		assert.strictEqual(theme.folder, '_folder');
		assert.strictEqual(theme.folderExpanded, '_folderOpen');
		assert.strictEqual(theme.byExtension.ts, '_typescript');
		assert.strictEqual(theme.byFileName.readme, '_info');
		assert.strictEqual(theme.byLanguage.markdown, '_markdown');
		assert.strictEqual(theme.paths._file, './images/file.svg');
	});

	it('字体形态的主题（有 fonts 块）一律放弃，交给调用方回退自绘 sprite', () => {
		assert.strictEqual(parseIconTheme(svgTheme({ fonts: [{ id: 'x', src: [] }] })), undefined);
	});

	it('iconDefinitions 里混入 fontCharacter 也放弃，避免一半图标一半字形', () => {
		const raw = svgTheme({
			iconDefinitions: {
				_file: { iconPath: './images/file.svg' },
				_folder: { iconPath: './images/folder.svg' },
				_glyph: { fontCharacter: '\\E001' },
			},
		});
		assert.strictEqual(parseIconTheme(raw), undefined);
	});

	it('缺默认文件图标 / 文件夹图标，或图标名指向不存在的定义时放弃', () => {
		assert.strictEqual(parseIconTheme(svgTheme({ file: undefined })), undefined);
		assert.strictEqual(parseIconTheme(svgTheme({ folder: undefined })), undefined);
		assert.strictEqual(parseIconTheme(svgTheme({ file: '_nope' })), undefined);
	});

	it('非对象 / 缺 iconDefinitions / iconDefinitions 不是对象 都放弃', () => {
		const bad: unknown[] = [undefined, null, 42, 'x', [], {}, { iconDefinitions: [] }, { iconDefinitions: 'x' }];
		for (const raw of bad) {
			assert.strictEqual(parseIconTheme(raw), undefined, `不该解析成功：${JSON.stringify(raw)}`);
		}
	});

	it('映射里指向不存在图标名的条目被丢掉，而不是留一条坏记录', () => {
		const theme = parseIconTheme(svgTheme({ fileExtensions: { ts: '_typescript', md: '_missing' } }));
		assert.ok(theme);
		assert.strictEqual(theme.byExtension.ts, '_typescript');
		assert.strictEqual(theme.byExtension.md, undefined);
	});

	it('扩展名与文件名一律按小写规范化（资源管理器的匹配本来就不区分大小写）', () => {
		const theme = parseIconTheme(
			svgTheme({ fileExtensions: { TS: '_typescript' }, fileNames: { 'README.MD': '_typescript' } }),
		);
		assert.ok(theme);
		assert.strictEqual(theme.byExtension.ts, '_typescript');
		assert.strictEqual(theme.byFileName['readme.md'], '_typescript');
	});

	it('folderExpanded 缺失时退回 folder，而不是留下 undefined', () => {
		const theme = parseIconTheme(svgTheme({ folderExpanded: undefined }));
		assert.ok(theme);
		assert.strictEqual(theme.folderExpanded, '_folder');
	});

	it('图标路径规整：去掉 ./ 前缀、反斜杠转正斜杠（否则 join 出的地址取不到文件，图标会整片消失）', () => {
		assert.strictEqual(iconRelativePath('./images/file.svg'), 'images/file.svg');
		assert.strictEqual(iconRelativePath('images\\sub\\x.svg'), 'images/sub/x.svg');
		assert.strictEqual(iconRelativePath('  images/a.svg  '), 'images/a.svg');
	});

	it('fileNames 与 fileExtensions 两侧都保留（谁优先由前端按资源管理器的口径决定）', () => {
		const theme = parseIconTheme(svgTheme());
		assert.ok(theme);
		assert.ok(Object.keys(theme.byFileName).length > 0);
		assert.ok(Object.keys(theme.byExtension).length > 0);
	});

	// —— mergeLanguageIcons：真机不一致的根因就在这一层，断言必须咬住它 ——

	it('扩展名在 fileExtensions 里为空时，靠 languageIds 拿到图标（真机 .md 场景）', () => {
		const theme = parseIconTheme(svgTheme());
		assert.ok(theme);
		// 真机 vscode-modern-icons：fileExtensions.md 是空串，唯一来源是 languageIds.markdown
		assert.strictEqual(theme.byExtension.md, undefined, '前提：扩展名映射确实是空的');

		const merged = mergeLanguageIcons(theme, { md: 'markdown', json: 'json', mjs: 'javascript' });
		assert.strictEqual(merged.md, '_markdown', '.md 必须拿到语言图标而不是回退到默认 file.svg');
		assert.strictEqual(merged.json, '_json');
		assert.strictEqual(merged.mjs, '_javascript');
	});

	it('fileExtensions 的优先级高于 languageIds（与资源管理器的查找顺序一致）', () => {
		const theme = parseIconTheme(svgTheme({ fileExtensions: { ts: '_typescript' }, languageIds: { typescript: '_markdown' } }));
		assert.ok(theme);
		const merged = mergeLanguageIcons(theme, { ts: 'typescript' });
		assert.strictEqual(merged.ts, '_typescript', 'fileExtensions 必须压过 languageIds');
	});

	it('语言 id 在主题里没有对应图标时不产生条目（不能塞个 undefined 进去）', () => {
		const theme = parseIconTheme(svgTheme());
		assert.ok(theme);
		const merged = mergeLanguageIcons(theme, { cs: 'csharp', txt: 'plaintext' });
		assert.strictEqual(merged.cs, undefined);
		assert.strictEqual(merged.txt, undefined);
		assert.strictEqual(merged.ts, '_typescript', '主题自己 fileExtensions 里的条目不受影响');
	});

	it('合并结果按小写扩展名归一（资源管理器本来就不区分大小写）', () => {
		const theme = parseIconTheme(svgTheme());
		assert.ok(theme);
		const merged = mergeLanguageIcons(theme, { MD: 'markdown' });
		assert.strictEqual(merged.md, '_markdown');
		assert.strictEqual(merged.MD, undefined);
	});
});
