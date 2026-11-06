import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import {
	decodeDataUrl,
	isMoveDropRequested,
	normalizeMime,
	parsePlainPathList,
	parseUriList,
	pickPrimaryString,
	renderContentForType,
	sanitizeFileNamePart,
	sanitizeSuggestedStem,
	stemFromUrl,
	storageTypesFor,
	suggestedFileName,
	type DroppedString,
	type StorageType,
} from '../subtree/drop';
import { renderSubtreePage, type SubtreeViewConfig } from '../subtree/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';

const ROOT = 'C:\\demo';

const CONFIG: SubtreeViewConfig = {
	rootPath: ROOT,
	rootName: 'demo',
	owner: 'tester',
	columns: [{ id: 'name', label: '名称', align: 'left', width: 280 }],
	commands: [],
	tools: [],
	sort: { key: 'name', direction: 'asc' },
};

const LEVELS: Record<string, unknown[]> = {
	[ROOT]: [
		{ name: 'sub', path: `${ROOT}\\sub`, isDirectory: true, parentPath: ROOT, cells: { name: 'sub' } },
		{ name: 'a.txt', path: `${ROOT}\\a.txt`, isDirectory: false, parentPath: ROOT, cells: { name: 'a.txt' } },
	],
	[`${ROOT}\\sub`]: [
		{ name: 'deep.md', path: `${ROOT}\\sub\\deep.md`, isDirectory: false, parentPath: `${ROOT}\\sub`, cells: { name: 'deep.md' } },
	],
};

function setupPage() {
	const html = renderSubtreePage({
		title: 'demo',
		csp: strictContentSecurityPolicy('vscode-webview://abc', 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: 'vscode-webview://abc/subtree.js',
		runtimeStyle: 'vscode-webview://abc/subtree.css',
		config: CONFIG,
	});
	const dom = installDom(html);
	loadMediaModule('media/subtree.js');
	const api = (dom.window as unknown as { __wispkitSelftest: any }).__wispkitSelftest;
	api.applyLevel(ROOT, LEVELS[ROOT]);
	api.applyLevel(`${ROOT}\\sub`, LEVELS[`${ROOT}\\sub`]);
	return { dom, api };
}

describe('subtree/drop 解析', () => {
	it('MIME 归一化：去掉 charset 并转小写', () => {
		assert.strictEqual(normalizeMime('Text/Plain; charset=utf-8'), 'text/plain');
		assert.strictEqual(normalizeMime(''), 'text/plain');
	});

	it('text/plain 覆盖 .txt 与 .md，且第一个是默认类型', () => {
		const types = storageTypesFor('text/plain');
		assert.deepStrictEqual(types.map(type => type.extension), ['.txt', '.md']);
	});

	it('text/uri-list 覆盖 .url / .md / .txt（多种存储方式都摆出来）', () => {
		const types = storageTypesFor('text/uri-list');
		assert.deepStrictEqual(types.map(type => type.extension), ['.url', '.md', '.txt']);
		assert.strictEqual(types[0].id, 'url');
	});

	it('文件名原扩展名排在最前，且不与 MIME 推荐重复', () => {
		const types = storageTypesFor('image/png', 'photo.png');
		assert.strictEqual(types[0].extension, '.png');
		assert.strictEqual(types.filter(type => type.extension === '.png').length, 1);
	});

	it('认不出的二进制资源回退 .bin', () => {
		assert.deepStrictEqual(storageTypesFor('application/x-vendor').map(type => type.extension), ['.bin']);
	});

	it('从 Markdown / HTML 内容抽默认名', () => {
		assert.strictEqual(sanitizeSuggestedStem('## 项目 架构\n第二行'), '项目 架构');
		assert.strictEqual(sanitizeSuggestedStem('<h1>Hello <b>World</b></h1>'), 'Hello World');
		assert.strictEqual(sanitizeSuggestedStem('> 引用的一句话\n正文'), '引用的一句话');
	});

	it('抽不出有意义文字时不强行给名字', () => {
		assert.strictEqual(sanitizeSuggestedStem('### --- !!!'), undefined);
		assert.strictEqual(sanitizeSuggestedStem('   \n\t '), undefined);
		assert.strictEqual(sanitizeSuggestedStem('😀😀😀'), undefined);
	});

	it('默认名限长 24 个字符且去掉非法字符', () => {
		const stem = sanitizeSuggestedStem('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十');
		assert.ok(stem);
		assert.strictEqual(Array.from(stem).length, 24);
		assert.strictEqual(sanitizeFileNamePart('a<b>c:d"e/f\\g|h?i*j'), 'a b c d e f g h i j');
	});

	it('URL 取路径最后一段，其次主机名', () => {
		assert.strictEqual(stemFromUrl('https://example.com/docs/report.md?x=1'), 'report');
		assert.strictEqual(stemFromUrl('https://example.com/a%20b.txt'), 'a b');
		assert.strictEqual(stemFromUrl('https://www.example.com/'), 'example.com');
	});

	it('suggestedFileName 用内容前缀 + 扩展名；抽不出则为空', () => {
		assert.strictEqual(suggestedFileName('text/plain', '第一行 内容\n第二行', '.txt'), '第一行 内容.txt');
		assert.strictEqual(suggestedFileName('text/plain', '!!!', '.txt'), '');
	});

	it('uri-list 忽略注释与空行；纯文本路径列表只认全路径', () => {
		assert.deepStrictEqual(
			parseUriList('# comment\r\nfile:///C:/a.txt\r\n\r\nhttp://x/y'),
			['file:///C:/a.txt', 'http://x/y'],
		);
		assert.deepStrictEqual(parsePlainPathList('C:\\a.txt\r\nD:\\b c.txt'), ['C:\\a.txt', 'D:\\b c.txt']);
		assert.deepStrictEqual(parsePlainPathList('C:\\a.txt\r\n普通文本'), []);
	});

	it('优先选择 uri-list，其次 HTML、Markdown、纯文本', () => {
		const strings: DroppedString[] = [
			{ kind: 'string', mime: 'text/plain', text: 'plain' },
			{ kind: 'string', mime: 'text/markdown', text: '# md' },
			{ kind: 'string', mime: 'text/uri-list', text: 'https://example.com/a' },
		];
		assert.strictEqual(pickPrimaryString(strings)?.mime, 'text/uri-list');
		assert.strictEqual(pickPrimaryString(strings.slice(0, 2))?.mime, 'text/markdown');
		assert.strictEqual(pickPrimaryString([]), undefined);
	});

	it('data URL 解码出 MIME 与字节', () => {
		const decoded = decodeDataUrl('data:image/png;base64,iVBORw0KGgo=');
		assert.ok(decoded);
		assert.strictEqual(decoded!.mime, 'image/png');
		assert.deepStrictEqual([...decoded!.bytes], [...Buffer.from('iVBORw0KGgo=', 'base64')]);
		assert.strictEqual(decodeDataUrl('not a data url'), undefined);
	});

	it('按类型生成内容：.url 快捷方式 / .md 链接 / HTML 转纯文本', () => {
		const urlType: StorageType = { id: 'url', label: 'URL', extension: '.url' };
		assert.ok(String(renderContentForType(urlType, { mime: 'text/uri-list', text: 'https://example.com/a' }).text)
			.includes('URL=https://example.com/a'));

		const mdType: StorageType = { id: 'md', label: 'MD', extension: '.md' };
		assert.strictEqual(
			renderContentForType(mdType, { mime: 'text/uri-list', text: 'https://example.com/report' }).text,
			'[report](https://example.com/report)\r\n',
		);

		const txtType: StorageType = { id: 'txt', label: 'TXT', extension: '.txt' };
		const plain = String(renderContentForType(txtType, { mime: 'text/html', text: '<p>你好&nbsp;<b>世界</b></p>' }).text);
		assert.strictEqual(plain.replace(/\s+/g, ' ').trim(), '你好 世界');
	});
});

describe('subtree 前端拖拽', () => {
	it('Windows 路径转 file URL 时逐段编码', () => {
		const { api } = setupPage();
		assert.strictEqual(api.toFileUrl('C:\\demo\\a b.txt'), 'file:///C:/demo/a%20b.txt');
		assert.strictEqual(api.toFileUrl('C:\\demo\\a#b.txt'), 'file:///C:/demo/a%23b.txt');
		assert.strictEqual(api.toFileUrl('/home/u/a b.txt'), 'file:///home/u/a%20b.txt');
	});

	it('拖出载荷：uri-list / ResourceURLs / CodeFiles / DownloadURL 齐备', () => {
		const { api } = setupPage();
		const payload = api.dragPayloadFor([`${ROOT}\\a.txt`, `${ROOT}\\sub`]);
		assert.deepStrictEqual(payload.paths, [`${ROOT}\\a.txt`, `${ROOT}\\sub`]);
		assert.strictEqual(payload.uriList, 'file:///C:/demo/a.txt\r\nfile:///C:/demo/sub');
		assert.deepStrictEqual(JSON.parse(payload.resourceUrls), ['file:///C:/demo/a.txt', 'file:///C:/demo/sub']);
		assert.deepStrictEqual(JSON.parse(payload.codeFiles), [`${ROOT}\\a.txt`, `${ROOT}\\sub`]);
		assert.strictEqual(payload.downloadUrl, 'application/octet-stream:a.txt:file:///C:/demo/a.txt');
	});

	it('行不使用 HTML5 原生拖拽（避免 webview 原生拖拽卡死）', () => {
		const { dom } = setupPage();
		const rows = Array.from(dom.window.document.querySelectorAll('.wispkit-subtree-row')) as HTMLElement[];
		assert.ok(rows.length > 0);
		for (const row of rows) {
			assert.strictEqual(row.draggable, false, 'draggable 必须为 false，真实拖拽走 Pointer Events');
		}
	});

	it('只有文件夹时没有 DownloadURL（Chromium 只支持单文件）', () => {
		const { api } = setupPage();
		const payload = api.dragPayloadFor([`${ROOT}\\sub`]);
		assert.strictEqual(payload.downloadUrl, undefined);
		assert.ok(payload.uriList.includes('file:///C:/demo/sub'));
	});

	it('拖放目标：文件夹行落到自己，文件行落到父目录，空白处落到根', () => {
		const { api } = setupPage();
		assert.strictEqual(api.dropTargetFor(`${ROOT}\\sub`), `${ROOT}\\sub`);
		assert.strictEqual(api.dropTargetFor(`${ROOT}\\a.txt`), ROOT);
		assert.strictEqual(api.dropTargetFor(null), ROOT);
	});

	it('模拟拖入文本：发出 drop 消息，带目标目录与原始字符串', async () => {
		const { api } = setupPage();
		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [
				{ mime: 'text/plain', text: '第一行内容' },
				{ mime: 'text/uri-list', text: 'https://example.com/a' },
			],
		});
		assert.ok(message, '应当发出 drop 消息');
		assert.strictEqual(message.type, 'wispkit.subtree.drop');
		assert.strictEqual(message.targetDir, `${ROOT}\\sub`);
		assert.strictEqual(message.strings.length, 2);
		assert.strictEqual(message.strings[0].text, '第一行内容');
		assert.strictEqual(message.files.length, 0);
	});

	it('模拟拖入文件：字节以 ArrayBuffer 发出', async () => {
		const { api } = setupPage();
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			files: [{ name: 'x.bin', mime: 'application/octet-stream', bytes }],
		});
		assert.ok(message);
		assert.strictEqual(message.files.length, 1);
		assert.strictEqual(message.files[0].name, 'x.bin');
		assert.deepStrictEqual([...new Uint8Array(message.files[0].data)], [1, 2, 3, 4]);
	});

	it('正常的小文件不带 error 字段', async () => {
		const { api } = setupPage();
		const message = await api.simulateDrop(ROOT, { files: [{ name: 'ok.bin', mime: '', bytes: new Uint8Array([7]) }] });
		assert.ok(message);
		assert.strictEqual(message.files[0].error, undefined);
	});

	it('拖入空内容时提示没有可导入的内容，不发消息', async () => {
		const { api } = setupPage();
		const message = await api.simulateDrop(ROOT, {});
		assert.strictEqual(message, null);
		assert.ok(api.status().includes('没有可导入的内容'));
	});

	it('页面里存在拖放提示与可拖拽容器', () => {
		const dom: JSDOM = setupPage().dom;
		assert.ok(dom.window.document.getElementById('wispkit-subtree-tree'));
	});

	it('系统文件拖拽在 document 捕获阶段被拦住，不再流向 window（否则 VS Code 会把 iframe 设为 pointer-events:none）', () => {
		const { dom } = setupPage();
		const row = dom.window.document.querySelector('.wispkit-subtree-row') as HTMLElement;
		const dataTransfer = { types: ['Files'], items: [], files: [] };
		let bubbled = 0;
		dom.window.addEventListener('dragenter', () => { bubbled += 1; });
		const make = (type: string, types: string[]) => {
			const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'dataTransfer', { value: { ...dataTransfer, types } });
			return event;
		};

		const fileEnter = make('dragenter', ['Files']);
		row.dispatchEvent(fileEnter);
		assert.strictEqual(fileEnter.defaultPrevented, true, '纯文件 dragenter 必须被捕获阶段 preventDefault');
		assert.strictEqual(bubbled, 0, '纯文件 dragenter 不能到达 window —— pre script 会在那里通知宿主禁用 iframe');

		const fileOver = make('dragover', ['Files']);
		row.dispatchEvent(fileOver);
		assert.strictEqual(fileOver.defaultPrevented, true);
		assert.strictEqual(bubbled, 0, '纯文件 dragover 同样不能到达 window');

		const internal = make('dragenter', ['text/plain', 'application/x-wispkit-subtree']);
		row.dispatchEvent(internal);
		assert.strictEqual(internal.defaultPrevented, false, '树内拖动不能被当成系统文件拦截');
		assert.strictEqual(bubbled, 1, '树内拖动仍走原来的树监听器');
	});

	it('系统文件 drop 在捕获阶段直接交给页面处理并发消息', async () => {
		const { dom, api } = setupPage();
		const row = dom.window.document.querySelector('.wispkit-subtree-row') as HTMLElement;
		const bytes = new Uint8Array([5, 6]);
		const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true });
		Object.defineProperty(drop, 'dataTransfer', {
			value: {
				types: ['Files'],
				files: [],
				items: [{
					kind: 'file',
					type: 'text/plain',
					getAsFile: () => ({
						name: 'os.txt',
						type: 'text/plain',
						size: bytes.byteLength,
						lastModified: 0,
						arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
					}),
				}],
			},
		});
		row.dispatchEvent(drop);
		await new Promise(resolve => setTimeout(resolve, 0));
		const message = api.lastMessage();
		assert.ok(message, '应当发出 drop 消息');
		assert.strictEqual(message.type, 'wispkit.subtree.drop');
		assert.strictEqual(message.internalDrag, false, '系统拖入不能被当成树内移动');
		assert.strictEqual(message.files.length, 1);
		assert.strictEqual(message.files[0].name, 'os.txt');
	});
});

/** 在某个行上触发一次真实 DOM 的 dragstart（jsdom 没有 DataTransfer，用同形状的桩）。 */
function fireDragStart(dom: JSDOM, path: string, init: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
	const doc = dom.window.document;
	const row = Array.from(doc.querySelectorAll('.wispkit-subtree-row'))
		.find(element => (element as HTMLElement).dataset.path === path) as HTMLElement | undefined;
	assert.ok(row, `应当能定位到 ${path} 这一行`);
	const event = new dom.window.Event('dragstart', { bubbles: true, cancelable: true }) as unknown as {
		ctrlKey: boolean;
		metaKey: boolean;
		dataTransfer: { types: string[]; setData(type: string, value: string): void; getData(type: string): string };
	};
	const store = new Map<string, string>();
	const dataTransfer = {
		types: [] as string[],
		setData(type: string, value: string) {
			store.set(type, value);
			if (!this.types.includes(type)) {
				this.types.push(type);
			}
		},
		getData(type: string) {
			return store.get(type) ?? '';
		},
	};
	Object.assign(event, { ctrlKey: Boolean(init.ctrlKey), metaKey: Boolean(init.metaKey), dataTransfer });
	row!.dispatchEvent(event as unknown as Event);
	return { dataTransfer, row: row! };
}

describe('subtree 拖拽：Ctrl = 移动', () => {
	it('宿主侧：只有「内部拖拽 + 明确要求移动」才直接移动（缺一不可）', () => {
		assert.strictEqual(isMoveDropRequested({ internalDrag: true, moveRequested: true }), true);
		assert.strictEqual(isMoveDropRequested({ internalDrag: true, moveRequested: false }), false);
		assert.strictEqual(isMoveDropRequested({ internalDrag: false, moveRequested: true }), false);
		assert.strictEqual(isMoveDropRequested({ moveRequested: true }), false);
		assert.strictEqual(isMoveDropRequested({ ctrlKey: true }), false);
	});

	it('dragover：内部 + Ctrl 显示移动光标与绿色高亮，外部 Ctrl 仍是复制', () => {
		const { dom } = setupPage();
		const tree = dom.window.document.getElementById('wispkit-subtree-tree');
		assert.ok(tree);
		const drag = (types: string[], ctrl: boolean) => {
			const event = new dom.window.Event('dragover', { bubbles: true, cancelable: true });
			const dataTransfer = { types, dropEffect: 'none' };
			Object.defineProperties(event, {
				dataTransfer: { value: dataTransfer },
				ctrlKey: { value: ctrl },
				metaKey: { value: false },
			});
			tree!.dispatchEvent(event);
			return { effect: dataTransfer.dropEffect, moveClass: tree!.classList.contains('is-move-drop') };
		};
		assert.deepStrictEqual(drag(['application/x-wispkit-subtree'], true), { effect: 'move', moveClass: true });
		assert.deepStrictEqual(drag(['application/x-wispkit-subtree'], false), { effect: 'copy', moveClass: false });
		assert.deepStrictEqual(drag(['text/plain'], true), { effect: 'copy', moveClass: false });
	});

	it('外部拖入按 Ctrl 不当作内部移动（资源管理器里 Ctrl 是复制）', async () => {
		const { api } = setupPage();
		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [{ mime: 'text/plain', text: 'hello' }],
			ctrlKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.ctrlKey, true);
		assert.strictEqual(message.internalDrag, false);
		assert.strictEqual(message.moveRequested, false);
	});

	it('跨子树面板：dragstart 写入的私有类型 + drop 时 Ctrl → 移动意图', async () => {
		const { api } = setupPage();
		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [{ mime: 'text/uri-list', text: `file:///C:/demo/a.txt` }],
			types: ['text/uri-list', 'application/x-wispkit-subtree'],
			ctrlKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.internalDrag, true);
		assert.strictEqual(message.moveRequested, true);
	});

	it('内部拖拽但没按 Ctrl → 仍询问复制 / 移动', async () => {
		const { api } = setupPage();
		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [{ mime: 'text/uri-list', text: 'file:///C:/demo/a.txt' }],
			types: ['text/uri-list', 'application/x-wispkit-subtree'],
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, false);
	});

	it('先按下 Ctrl 再拖、松手前已放开 Ctrl：drop 仍按移动处理', async () => {
		const { dom, api } = setupPage();
		const { dataTransfer } = fireDragStart(dom, `${ROOT}\\a.txt`, { ctrlKey: true });
		assert.ok(dataTransfer.types.includes('application/x-wispkit-subtree'));
		assert.deepStrictEqual(api.dragSession(), { moveModifier: true });

		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [{ mime: 'text/uri-list', text: 'file:///C:/demo/a.txt' }],
			ctrlKey: false,
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, true, 'dragstart 时按过 Ctrl 就应算移动');
		assert.strictEqual(api.dragSession(), null, 'drop 后应清掉拖拽会话');
	});

	it('拖动开始时没按 Ctrl，松手前才按下：drop 时 Ctrl 仍生效', async () => {
		const { dom, api } = setupPage();
		fireDragStart(dom, `${ROOT}\\a.txt`);
		assert.deepStrictEqual(api.dragSession(), { moveModifier: false });

		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [{ mime: 'text/uri-list', text: 'file:///C:/demo/a.txt' }],
			ctrlKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, true);
	});

	it('系统文件拖入（DataTransfer 带 Files）永远不当作内部移动', async () => {
		const { dom, api } = setupPage();
		// 先有一个按着 Ctrl 的内部拖动会话（模拟 dragend 因异常没送达）
		fireDragStart(dom, `${ROOT}\\a.txt`, { ctrlKey: true });
		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			files: [{ name: 'from-os.txt', mime: 'text/plain', bytes: new Uint8Array([1, 2]) }],
			types: ['Files', 'text/plain'],
			ctrlKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.internalDrag, false);
		assert.strictEqual(message.moveRequested, false);
	});

	it('dragend 会清掉拖拽会话，之后的普通 Ctrl 拖入不算移动', async () => {
		const { dom, api } = setupPage();
		const { row } = fireDragStart(dom, `${ROOT}\\a.txt`, { ctrlKey: true });
		row.dispatchEvent(new dom.window.Event('dragend', { bubbles: true }));
		assert.strictEqual(api.dragSession(), null);

		const message = await api.simulateDrop(`${ROOT}\\sub`, {
			strings: [{ mime: 'text/plain', text: 'hello' }],
			ctrlKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, false);
	});
});
