import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { renderComparePage, type CompareViewConfig } from '../compare/page';
import { strictContentSecurityPolicy } from '../util/csp';
import { installDom, loadMediaModule } from './helpers/dom';

const CSP_SOURCE = 'vscode-webview://abc';
const LEFT = 'C:\\Users\\tester\\Desktop';
const RIGHT = 'C:\\Users\\tester\\Dest';
const LEFT_SUB = `${LEFT}\\sub`;
const LEFT_FILE = `${LEFT}\\a.txt`;
const RIGHT_FOLDER = `${RIGHT}\\inbox`;
const RIGHT_FILE = `${RIGHT}\\b.txt`;

const CONFIG: CompareViewConfig = {
	panes: [
		{ id: 'left', root: LEFT, title: '左侧' },
		{ id: 'right', root: RIGHT, title: '右侧' },
	],
	columns: [
		{ id: 'name', label: '名称', align: 'left', width: 260 },
		{ id: 'size', label: '大小', align: 'right', width: 90 },
		{ id: 'mtime', label: '修改时间', align: 'left', width: 150 },
	],
	locationGroups: [],
};

function pageHtml(): string {
	return renderComparePage({
		title: '对比浏览',
		csp: strictContentSecurityPolicy(CSP_SOURCE, 'NONCE1'),
		nonce: 'NONCE1',
		runtimeScript: `${CSP_SOURCE}/compare.js`,
		runtimeStyle: `${CSP_SOURCE}/compare.css`,
		baseStyle: `${CSP_SOURCE}/subtree.css`,
		config: CONFIG,
	});
}

interface Message {
	readonly type: string;
	readonly [key: string]: any;
}

function setupPage(): {
	dom: JSDOM;
	doc: Document;
	api: any;
	messages: Message[];
} {
	const dom = installDom(pageHtml());
	const messages: Message[] = [];
	(globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
		postMessage: (message: Message) => messages.push(message),
	});
	loadMediaModule('media/compare.js');
	const api = (dom.window as unknown as { __wispkitCompareSelftest: any }).__wispkitCompareSelftest;
	assert.ok(api, 'compare.js 应暴露 __wispkitCompareSelftest');
	return { dom, doc: dom.window.document, api, messages };
}

function fileRow(name: string, fullPath: string, parentPath: string) {
	return {
		name,
		path: fullPath,
		parentPath,
		isDirectory: false,
		cells: { name, size: '1 B', mtime: '-' },
	};
}

function folderRow(name: string, fullPath: string, parentPath: string) {
	return {
		name,
		path: fullPath,
		parentPath,
		isDirectory: true,
		cells: { name, size: '-', mtime: '-' },
	};
}

function dataTransfer(types: string[], data: Record<string, string> = {}): any {
	return {
		types,
		effectAllowed: 'none',
		dropEffect: 'none',
		setData: () => undefined,
		getData: (type: string) => data[type] ?? '',
		setDragImage: () => undefined,
	};
}

function fireDragOver(
	dom: JSDOM,
	target: Element,
	transfer: any,
	modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): { prevented: boolean; effect: string } {
	const event = new dom.window.Event('dragover', { bubbles: true, cancelable: true });
	Object.assign(event, {
		dataTransfer: transfer,
		ctrlKey: Boolean(modifiers.ctrlKey),
		metaKey: false,
		shiftKey: Boolean(modifiers.shiftKey),
	});
	target.dispatchEvent(event);
	return { prevented: event.defaultPrevented, effect: transfer.dropEffect };
}

function rowElement(doc: Document, paneId: string, path: string): Element {
	const row = Array.from(doc.querySelectorAll(`#wispkit-compare-rows-${paneId} .wispkit-subtree-row`))
		.find(element => (element as HTMLElement).dataset.path === path);
	assert.ok(row, `应当能定位到 ${path} 这一行`);
	return row;
}

afterEach(() => {
	delete (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

describe('media/compare.js 拖拽：默认复制，Ctrl/Shift = 移动', () => {
	it('行可拖动，dragstart 写入 uri-list / 私有 MIME 并记录会话', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [
			folderRow('sub', LEFT_SUB, LEFT),
			fileRow('a.txt', LEFT_FILE, LEFT),
		]);
		const started = api.startDrag('left', LEFT_FILE);
		assert.ok(started, '应当能取到拖拽载荷');
		assert.ok(started.types.includes('text/uri-list'));
		assert.ok(started.types.includes('application/x-wispkit-compare'));
		assert.ok(started.types.includes('application/x-wispkit-subtree'));
		assert.ok(started.dataTransfer.getData('text/uri-list').includes('file:///C:/'));
		assert.deepStrictEqual(api.dragSession().paths, [LEFT_FILE]);
		assert.strictEqual(api.dragSession().moveModifier, false);
	});

	it('行不使用 HTML5 原生拖拽（避免 webview 原生 OLE 拖拽把 VS Code 卡死）', () => {
		const { doc, api } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		const row = rowElement(doc, 'left', LEFT_FILE) as HTMLElement;
		assert.strictEqual(row.draggable, false, '拖拽必须由 pointer 事件驱动，不能再交给原生 DnD');
		assert.ok(row.classList.contains('wispkit-subtree-row'));
	});

	it('dragover：内部拖动默认复制、Ctrl 时移动；外部文件拖入也给出放置高亮', () => {
		const { dom, doc, api } = setupPage();
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		const row = rowElement(doc, 'right', RIGHT_FOLDER);

		const copy = fireDragOver(dom, row, dataTransfer(['application/x-wispkit-compare', 'text/uri-list']));
		assert.strictEqual(copy.prevented, true);
		assert.strictEqual(copy.effect, 'copy');
		assert.deepStrictEqual(api.highlight('right').rows, [RIGHT_FOLDER]);
		assert.strictEqual(api.highlight('right').move, false);

		const move = fireDragOver(
			dom,
			row,
			dataTransfer(['application/x-wispkit-compare', 'text/uri-list']),
			{ ctrlKey: true },
		);
		assert.strictEqual(move.prevented, true);
		assert.strictEqual(move.effect, 'move');
		assert.strictEqual(api.highlight('right').move, true);

		// 系统文件拖入由 document 捕获阶段接管；pane 自己的 dragover 也会给高亮
		const external = fireDragOver(dom, row, dataTransfer(['Files', 'text/plain']));
		assert.strictEqual(external.prevented, true, '系统文件拖入现在支持落盘');
		assert.strictEqual(external.effect, 'copy', '系统拖入按复制处理');
	});

	it('默认 drop 落在对侧文件夹上：targetDir 为该文件夹，moveRequested=false', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		api.startDrag('left', LEFT_FILE);
		const message = api.simulateDrop('right', {
			rowPath: RIGHT_FOLDER,
			types: ['application/x-wispkit-compare', 'text/uri-list'],
		});
		assert.ok(message);
		assert.strictEqual(message.type, 'wispkit.compare.drop');
		assert.strictEqual(message.pane, 'right');
		assert.strictEqual(message.targetDir, RIGHT_FOLDER);
		assert.deepStrictEqual(message.paths, [LEFT_FILE]);
		assert.strictEqual(message.internalDrag, true);
		assert.strictEqual(message.moveRequested, false);
		assert.strictEqual(api.dragSession(), null, 'drop 后应清掉拖拽会话');
	});

	it('drop 时按住 Ctrl：moveRequested=true', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		api.startDrag('left', LEFT_FILE);
		const message = api.simulateDrop('right', {
			rowPath: RIGHT_FOLDER,
			types: ['application/x-wispkit-compare'],
			ctrlKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, true);
		assert.strictEqual(message.ctrlKey, true);
	});

	it('先按 Ctrl 再拖、松手前已放开：drop 仍按移动处理', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		api.startDrag('left', LEFT_FILE, { ctrlKey: true });
		assert.strictEqual(api.dragSession().moveModifier, true, 'dragstart 时按过 Ctrl 应被记住');
		const message = api.simulateDrop('right', {
			rowPath: RIGHT_FOLDER,
			types: ['application/x-wispkit-compare'],
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, true);
	});

	it('Shift 作为备用移动键生效', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		api.startDrag('left', LEFT_FILE);
		const message = api.simulateDrop('right', {
			rowPath: RIGHT_FOLDER,
			types: ['application/x-wispkit-compare'],
			shiftKey: true,
		});
		assert.ok(message);
		assert.strictEqual(message.moveRequested, true);
	});

	it('落在文件行上 → 目标取它的父目录；落在空白处 → 目标取该侧根目录', () => {
		const { api } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		api.applyLevel('right', RIGHT, [fileRow('b.txt', RIGHT_FILE, RIGHT)]);
		api.startDrag('left', LEFT_FILE);
		let message = api.simulateDrop('right', {
			rowPath: RIGHT_FILE,
			types: ['application/x-wispkit-compare'],
		});
		assert.strictEqual(message.targetDir, RIGHT);

		api.startDrag('left', LEFT_FILE);
		message = api.simulateDrop('right', { types: ['application/x-wispkit-compare'] });
		assert.strictEqual(message.targetDir, RIGHT, '空白区域落到该侧根目录');
	});

	it('系统文件拖入（带 Files）完全不发消息', () => {
		const { api, messages } = setupPage();
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		messages.length = 0;
		api.clearLastMessage();
		const message = api.simulateDrop('right', {
			rowPath: RIGHT_FOLDER,
			types: ['Files', 'text/plain'],
		});
		assert.strictEqual(message, null);
		assert.ok(!messages.some(item => item.type === 'wispkit.compare.drop'));
	});

	it('dropResult 刷新已读层级、更新状态并清掉被移动条目的缓存', () => {
		const { api, messages } = setupPage();
		api.applyLevel('left', LEFT, [folderRow('sub', LEFT_SUB, LEFT)]);
		api.applyLevel('left', LEFT_SUB, [fileRow('deep.txt', `${LEFT_SUB}\\deep.txt`, LEFT_SUB)]);
		api.expand('left', LEFT_SUB);
		api.applyLevel('right', RIGHT, []);
		messages.length = 0;

		api.dropResult({
			pane: 'right',
			moved: [LEFT_SUB],
			refresh: { left: [LEFT, LEFT_SUB], right: [RIGHT] },
			message: '已移动 1 个条目到 Dest',
		});

		const reads = messages.filter(item => item.type === 'wispkit.compare.read');
		// 被移走的文件夹自身的层级缓存应被清掉，不再请求；源父目录与目标目录重读
		assert.deepStrictEqual(
			reads.map(item => `${item.pane}:${item.path}`).sort(),
			[`left:${LEFT}`, `right:${RIGHT}`].sort(),
		);
		assert.strictEqual(api.status('right'), '已移动 1 个条目到 Dest');
		// 被移走的子树缓存已清掉：再刷新不会残留旧的展开层级
		assert.strictEqual(api.rowCount('left'), 1);
	});

	it('dropResult：宿主把盘符规范成小写时仍能匹配根目录并刷新', () => {
		const { api, messages } = setupPage();
		api.applyLevel('right', RIGHT, [fileRow('b.txt', RIGHT_FILE, RIGHT)]);
		messages.length = 0;
		// Uri.fsPath 会把根目录的盘符变成小写；面板根目录来自输入，是大写
		api.dropResult({
			pane: 'left',
			moved: [`${RIGHT.toLowerCase()}\\target.txt`],
			refresh: { left: [LEFT], right: [RIGHT.toLowerCase()] },
			message: '已移动 1 个条目到 Desktop',
		});
		const reads = messages.filter(item => item.type === 'wispkit.compare.read');
		const rightRead = reads.find(item => item.pane === 'right');
		assert.ok(rightRead, '源面板必须刷新');
		assert.strictEqual(rightRead.path, RIGHT, '请求应沿用面板根目录的原始大小写');
	});

	it('dropResult 的错误用错误样式显示', () => {
		const { api, doc } = setupPage();
		api.dropResult({ pane: 'left', moved: [], refresh: { left: [], right: [] }, error: '拒绝访问', message: '拖放失败：拒绝访问' });
		const status = doc.getElementById('wispkit-compare-status-left');
		assert.ok(status?.classList.contains('is-error'));
		assert.ok(status?.textContent?.includes('拒绝访问'));
	});
});

describe('media/compare.js 与系统资源管理器双向交互', () => {
	it('拖到 webview 之外松手：发出 dragOut（默认复制）', () => {
		const { dom, doc, api, messages } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		const row = rowElement(doc, 'left', LEFT_FILE);
		(doc as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
		messages.length = 0;

		row.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
			bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10,
		}));
		doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
			bubbles: true, cancelable: true, clientX: 40, clientY: 40,
		}));
		assert.ok(doc.body.classList.contains('is-copy-drag'), '拖拽时要给出 copy 光标类');
		doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
			bubbles: true, cancelable: true, clientX: 2000, clientY: 1200,
		}));
		doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
			bubbles: true, cancelable: true, clientX: 2000, clientY: 1200,
		}));

		const message = messages.filter(item => item.type === 'wispkit.compare.dragOut').pop();
		assert.ok(message, '拖出视口应当发 dragOut');
		assert.strictEqual(message.pane, 'left');
		assert.deepStrictEqual(message.paths, [LEFT_FILE]);
		assert.strictEqual(message.moveRequested, false);
		assert.strictEqual(doc.body.classList.contains('is-copy-drag'), false, '松手后光标类要清掉');
	});

	it('按住 Ctrl 拖出：moveRequested=true', () => {
		const { dom, doc, api, messages } = setupPage();
		api.applyLevel('left', LEFT, [fileRow('a.txt', LEFT_FILE, LEFT)]);
		const row = rowElement(doc, 'left', LEFT_FILE);
		(doc as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
		messages.length = 0;

		row.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
			bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, ctrlKey: true,
		}));
		doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
			bubbles: true, cancelable: true, clientX: 40, clientY: 40, ctrlKey: true,
		}));
		assert.ok(doc.body.classList.contains('is-move-drag'));
		doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
			bubbles: true, cancelable: true, clientX: 2000, clientY: 1200, ctrlKey: true,
		}));

		const message = messages.filter(item => item.type === 'wispkit.compare.dragOut').pop();
		assert.ok(message);
		assert.strictEqual(message.moveRequested, true);
	});

	it('系统文件拖入：document 捕获阶段读取 File 并发 compare.drop', async () => {
		const { dom, doc, api } = setupPage();
		api.applyLevel('right', RIGHT, [folderRow('inbox', RIGHT_FOLDER, RIGHT)]);
		const bytes = new Uint8Array([1, 2, 3]);
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
		doc.getElementById('wispkit-compare-rows-right')!.dispatchEvent(drop);
		await new Promise(resolve => setTimeout(resolve, 0));

		const message = api.lastMessage();
		assert.ok(message, '应当发出 compare.drop');
		assert.strictEqual(message.type, 'wispkit.compare.drop');
		assert.strictEqual(message.pane, 'right');
		assert.strictEqual(message.targetDir, RIGHT);
		assert.strictEqual(message.internalDrag, false);
		assert.strictEqual(message.files.length, 1);
		assert.strictEqual(message.files[0].name, 'os.txt');
	});
});
