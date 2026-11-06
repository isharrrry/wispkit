import * as assert from 'assert';
import * as path from 'node:path';
import {
	normalizeExplorerSelection,
	planExplorerFolderAdd,
	uriPath,
	type UriClassification,
	type UriLike,
} from '../resourceTree/explorerSelection';

const root = path.resolve(process.cwd(), '.selftest-fixtures', 'ws');

function uri(name: string): UriLike {
	const fsPath = path.join(root, name);
	return { fsPath, path: fsPath.replace(/\\/g, '/') };
}

const docs = uri('docs');
const src = uri('src');
const notes = uri('notes.txt');

function classifyBy(directories: ReadonlyArray<UriLike>) {
	const allowed = new Set(directories.map(uriPath));
	return async (candidate: UriLike): Promise<UriClassification> => (
		allowed.has(uriPath(candidate)) ? 'directory' : 'not-directory'
	);
}

const folders = [{ name: 'ws', fsPath: root }];

describe('resourceTree/explorerSelection 实参归一化', () => {
	it('接受单个 Uri（命令面板/程序化调用）', () => {
		assert.deepStrictEqual(normalizeExplorerSelection([docs]).map(uriPath), [uriPath(docs)]);
	});

	it('接受 Uri[] 作为首参数', () => {
		assert.deepStrictEqual(
			normalizeExplorerSelection([[docs, src]]).map(uriPath),
			[uriPath(docs), uriPath(src)],
		);
	});

	it('按真机形态处理 (clickedUri, selectedUris[])，并保持选区顺序、去掉重复的被点击项', () => {
		const normalized = normalizeExplorerSelection([src, [docs, src]]);
		assert.deepStrictEqual(normalized.map(uriPath), [uriPath(docs), uriPath(src)]);
	});

	it('数组里缺少被点击项时仍会补上；重复的真实路径只保留一次', () => {
		const normalized = normalizeExplorerSelection([src, [docs, { fsPath: docs.fsPath }]]);
		assert.deepStrictEqual(normalized.map(uriPath), [uriPath(docs), uriPath(src)]);
	});

	it('忽略空值、非 Uri 对象与空数组', () => {
		assert.deepStrictEqual(normalizeExplorerSelection([]), []);
		assert.deepStrictEqual(normalizeExplorerSelection([undefined, null, []]), []);
		assert.deepStrictEqual(
			normalizeExplorerSelection([42, 'x', { nope: true }, docs, [src, null, { foo: 1 }]]).map(uriPath),
			[uriPath(docs), uriPath(src)],
		);
	});
});

describe('resourceTree/explorerSelection 批量添加计划', () => {
	it('多选两个目录：直接使用 basename，不弹输入框', async () => {
		const prompted: string[] = [];
		const plan = await planExplorerFolderAdd([src, [docs, src]], {
			folders,
			classify: classifyBy([docs, src]),
			promptName: async (name) => { prompted.push(name); return name; },
		});
		assert.strictEqual(plan.kind, 'ready');
		if (plan.kind !== 'ready') { return; }
		assert.deepStrictEqual(plan.items.map(item => item.name), ['docs', 'src']);
		assert.deepStrictEqual(plan.items.map(item => item.path), ['${workspaceFolder}/docs', '${workspaceFolder}/src']);
		assert.strictEqual(plan.skipped, 0);
		assert.deepStrictEqual(prompted, [], '多选不应逐个弹输入框');
	});

	it('单选目录沿用输入框改名；取消返回 cancelled', async () => {
		const prompted: string[] = [];
		const renamed = await planExplorerFolderAdd([docs, [docs]], {
			folders,
			classify: classifyBy([docs]),
			promptName: async (name) => { prompted.push(name); return '  文档  '; },
		});
		assert.strictEqual(renamed.kind, 'ready');
		if (renamed.kind !== 'ready') { return; }
		assert.deepStrictEqual(renamed.items, [{ name: '文档', path: '${workspaceFolder}/docs' }]);
		assert.deepStrictEqual(prompted, ['docs']);

		const cancelled = await planExplorerFolderAdd([docs], {
			folders,
			classify: classifyBy([docs]),
			promptName: async () => undefined,
		});
		assert.strictEqual(cancelled.kind, 'cancelled');
	});

	it('多选混合文件与文件夹：只加目录并统计跳过，不弹输入框', async () => {
		const plan = await planExplorerFolderAdd([notes, [notes, docs]], {
			folders,
			classify: classifyBy([docs]),
			promptName: async () => { throw new Error('多选不应弹输入框'); },
		});
		assert.strictEqual(plan.kind, 'ready');
		if (plan.kind !== 'ready') { return; }
		assert.deepStrictEqual(plan.items.map(item => item.name), ['docs']);
		assert.strictEqual(plan.skipped, 1);
	});

	it('单选非目录保持「只能添加文件夹」判定', async () => {
		const plan = await planExplorerFolderAdd([notes], {
			folders,
			classify: classifyBy([]),
		});
		assert.strictEqual(plan.kind, 'invalid-single');
	});

	it('多选全是非目录返回 no-folders；单选 stat 失败返回 stat-failed', async () => {
		const none = await planExplorerFolderAdd([notes, [notes, src]], {
			folders,
			classify: classifyBy([]),
		});
		assert.deepStrictEqual(none, { kind: 'no-folders', skipped: 2 });

		const failed = await planExplorerFolderAdd([docs], {
			folders,
			classify: async () => ({ error: 'EACCES' }),
		});
		assert.deepStrictEqual(failed, { kind: 'stat-failed', message: 'EACCES' });
	});

	it('空选择返回 no-selection', async () => {
		const plan = await planExplorerFolderAdd([], {
			folders,
			classify: async () => 'directory',
		});
		assert.strictEqual(plan.kind, 'no-selection');
	});
});
