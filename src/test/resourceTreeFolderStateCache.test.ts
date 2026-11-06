import * as assert from 'assert';
import { FolderStateCache } from '../resourceTree/folderStateCache';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('resourceTree/folderStateCache 命中与未命中', () => {
	it('未检查过 → undefined + fresh=false；检查后命中且 fresh=true', async () => {
		const cache = new FolderStateCache({ stat: async () => 'directory' });
		assert.deepStrictEqual(cache.lookup('C:/work/docs'), { state: undefined, fresh: false });

		assert.strictEqual(await cache.refresh(['C:/work/docs']), true, '首次写入应报告变化');
		assert.deepStrictEqual(cache.lookup('C:/work/docs'), { state: 'directory', fresh: true });
		assert.strictEqual(await cache.refresh(['C:/work/docs']), false, '未过期时不应重复 stat');
	});

	it('file / broken-link / missing 都按磁盘结果缓存；stat 抛错统一映射为 missing', async () => {
		const cache = new FolderStateCache({
			stat: async fsPath => {
				if (fsPath.endsWith('notes.txt')) {
					return 'file';
				}
				if (fsPath.endsWith('dangling')) {
					return 'broken-link';
				}
				if (fsPath.endsWith('gone')) {
					throw new Error('ENOENT');
				}
				return 'directory';
			},
		});
		await cache.refresh(['C:/work/notes.txt', 'C:/work/dangling', 'C:/work/gone', 'C:/work/docs']);
		assert.strictEqual(cache.lookup('C:/work/notes.txt').state, 'file');
		assert.strictEqual(cache.lookup('C:/work/dangling').state, 'broken-link', '断链必须保留独立状态');
		assert.strictEqual(cache.lookup('C:/work/gone').state, 'missing');
		assert.strictEqual(cache.lookup('C:/work/docs').state, 'directory');
	});
});

describe('resourceTree/folderStateCache TTL 与失效', () => {
	it('超过 TTL 后仍返回上次值但标记 fresh=false（由调用方异步补取）', async () => {
		let now = 1_000;
		const cache = new FolderStateCache({ ttlMs: 30_000, now: () => now, stat: async () => 'directory' });
		await cache.refresh(['C:/work/docs']);

		now += 29_999;
		assert.deepStrictEqual(cache.lookup('C:/work/docs'), { state: 'directory', fresh: true });

		now += 1;
		assert.deepStrictEqual(cache.lookup('C:/work/docs'), { state: 'directory', fresh: false }, '过期仍保留上次值');
	});

	it('invalidate 单条 / 全部后回到未命中', async () => {
		const cache = new FolderStateCache({ stat: async () => 'directory' });
		await cache.refresh(['C:/a', 'C:/b']);
		cache.invalidate('C:/a');
		assert.strictEqual(cache.lookup('C:/a').state, undefined);
		assert.strictEqual(cache.lookup('C:/b').state, 'directory');
		cache.invalidate();
		assert.strictEqual(cache.lookup('C:/b').state, undefined);
		assert.strictEqual(cache.size, 0);
	});

	it('prune 只保留当前树里的路径，不无限增长', async () => {
		const cache = new FolderStateCache({ stat: async () => 'directory' });
		await cache.refresh(['C:/keep', 'C:/removed', 'C:/also-removed']);
		cache.prune(['C:/keep']);
		assert.strictEqual(cache.size, 1);
		assert.strictEqual(cache.lookup('C:/keep').state, 'directory');
		assert.strictEqual(cache.lookup('C:/removed').state, undefined);
	});

	it('force 跳过 TTL 重新检查，并在状态翻转时报告变化', async () => {
		let current: 'directory' | 'file' = 'directory';
		let calls = 0;
		const cache = new FolderStateCache({
			stat: async () => { calls += 1; return current; },
		});
		await cache.refresh(['C:/thing']);
		assert.strictEqual(calls, 1);

		assert.strictEqual(await cache.refresh(['C:/thing']), false);
		assert.strictEqual(calls, 1, 'fresh 条目不应重复 stat');

		current = 'file';
		assert.strictEqual(await cache.refresh(['C:/thing'], { force: true }), true);
		assert.strictEqual(calls, 2);
		assert.strictEqual(cache.lookup('C:/thing').state, 'file');
	});

	it('条目数不超过 maxEntries（LRU 淘汰最旧条目）', async () => {
		const cache = new FolderStateCache({
			maxEntries: 2,
			maxConcurrency: 1,
			stat: async () => 'directory',
		});
		await cache.refresh(['C:/a', 'C:/b', 'C:/c']);
		assert.strictEqual(cache.size, 2);
		assert.strictEqual(cache.lookup('C:/a').state, undefined, '最旧的 a 应被淘汰');
		assert.strictEqual(cache.lookup('C:/c').state, 'directory');
	});
});

describe('resourceTree/folderStateCache 并发与去重', () => {
	it('批量 stat 并发不超过 maxConcurrency，且条目数正确', async () => {
		let active = 0;
		let maxActive = 0;
		const cache = new FolderStateCache({
			maxConcurrency: 3,
			stat: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise(resolve => setTimeout(resolve, 4));
				active -= 1;
				return 'directory';
			},
		});
		const paths = Array.from({ length: 12 }, (_, index) => `C:/dir-${index}`);
		const changed = await cache.refresh(paths);
		assert.strictEqual(changed, true);
		assert.strictEqual(cache.size, 12);
		assert.strictEqual(maxActive, 3, '应恰好打满 3 路并发，且不超过');
	});

	it('同一路径重复传入 / 并发刷新时只 stat 一次', async () => {
		let calls = 0;
		let release: (() => void) | undefined;
		const cache = new FolderStateCache({
			stat: () => {
				calls += 1;
				return new Promise<'directory'>(resolve => { release = () => resolve('directory'); });
			},
		});
		const first = cache.refresh(['C:/same', 'C:/same']);
		const second = cache.refresh(['C:/same']);
		await flush();
		assert.strictEqual(calls, 1);
		release?.();
		await Promise.all([first, second]);
		assert.strictEqual(calls, 1);
		assert.strictEqual(cache.lookup('C:/same').state, 'directory');
	});
});
