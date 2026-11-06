import * as path from 'node:path';

/**
 * 文件夹状态缓存。
 *
 * `getTreeItem` 是同步 API，不能在里面 `await stat`；这个缓存把磁盘检查挪到
 * 异步阶段（reload / 刷新 / 增删改移 / getChildren 预取），同步侧只做一次
 * O(1) 的 Map 查询：
 *
 *   - 命中且未过期 → 直接返回缓存值；
 *   - 命中但已过期 → 返回**上次值**（调用方据此先渲染），调用方再安排异步补取；
 *   - 从未检查过 → 返回 undefined（呈现层显示「未知」），同样异步补取。
 *
 * 缓存本身不 import vscode，方便 mocha 直接测 TTL / 失效 / 并发上限。
 */

export type CachedFolderState = 'directory' | 'file' | 'missing' | 'broken-link';

export interface FolderStateLookup {
	readonly state: CachedFolderState | undefined;
	/** 条目存在且未超过 TTL；false 时调用方应安排一次异步刷新。 */
	readonly fresh: boolean;
}

export interface FolderStateCacheOptions {
	/**
	 * 对存在的路径返回 directory / file；断链（符号链接目标不存在）返回
	 * `broken-link`（`workspace.fs.stat` 对断链返回只有 SymbolicLink 位的 FileStat，
	 * 不会抛错）；不存在或无权限时抛错（映射为 missing）。
	 */
	readonly stat: (fsPath: string) => Promise<'directory' | 'file' | 'broken-link'>;
	/** 缓存有效期，默认 30s。 */
	readonly ttlMs?: number;
	/** 缓存条目上限，默认 2000（与资源树节点上限一致）。 */
	readonly maxEntries?: number;
	/** 同时进行的 stat 数量上限，默认 8。 */
	readonly maxConcurrency?: number;
	/** 测试注入用时钟。 */
	readonly now?: () => number;
}

interface CacheEntry {
	readonly state: CachedFolderState;
	readonly checkedAt: number;
}

interface QueueTask {
	readonly key: string;
	readonly fsPath: string;
	readonly resolve: (changed: boolean) => void;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_CONCURRENCY = 8;

function cacheKey(fsPath: string): string {
	const resolved = path.resolve(fsPath);
	return path.sep === '\\' ? resolved.toLowerCase() : resolved;
}

export class FolderStateCache {
	private readonly entries = new Map<string, CacheEntry>();
	private readonly inflight = new Map<string, Promise<boolean>>();
	private readonly queue: QueueTask[] = [];
	private readonly stat: FolderStateCacheOptions['stat'];
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly maxConcurrency: number;
	private readonly now: () => number;
	private active = 0;

	public constructor(options: FolderStateCacheOptions) {
		this.stat = options.stat;
		this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
		this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
		this.maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
		this.now = options.now ?? Date.now;
	}

	/** 当前缓存条目数；上限由 maxEntries 保证。 */
	public get size(): number {
		return this.entries.size;
	}

	/**
	 * 同步查询，不触发任何 IO。
	 * `fresh === false` 时调用方应把路径交给 `refresh()` 异步补取。
	 */
	public lookup(fsPath: string): FolderStateLookup {
		const key = cacheKey(fsPath);
		const entry = this.entries.get(key);
		if (!entry) {
			return { state: undefined, fresh: false };
		}
		const fresh = this.isFresh(entry);
		if (fresh) {
			// 简单 LRU：命中后挪到末尾，淘汰时从头部开始。
			this.entries.delete(key);
			this.entries.set(key, entry);
		}
		return { state: entry.state, fresh };
	}

	/**
	 * 批量检查路径并更新缓存。返回是否至少有一个状态发生变化
	 * （调用方据此决定要不要刷新树）。
	 */
	public async refresh(paths: Iterable<string>, options: { force?: boolean } = {}): Promise<boolean> {
		const force = options.force === true;
		const wanted = new Map<string, string>();
		for (const candidate of paths) {
			const value = candidate?.trim();
			if (!value) {
				continue;
			}
			const key = cacheKey(value);
			if (!wanted.has(key)) {
				wanted.set(key, value);
			}
		}

		const tasks: Array<Promise<boolean>> = [];
		for (const [key, fsPath] of wanted) {
			const running = this.inflight.get(key);
			if (running) {
				// 同一路径已有一次 stat 在飞：直接复用结果，避免重复打盘。
				tasks.push(running);
				continue;
			}
			const entry = this.entries.get(key);
			if (!force && entry && this.isFresh(entry)) {
				continue;
			}
			tasks.push(this.enqueue(key, fsPath));
		}
		if (tasks.length === 0) {
			return false;
		}
		const results = await Promise.all(tasks);
		return results.some(Boolean);
	}

	/** 让某条（或全部）缓存失效；下次 lookup 返回 undefined 并触发补取。 */
	public invalidate(fsPath?: string): void {
		if (fsPath === undefined) {
			this.entries.clear();
			return;
		}
		this.entries.delete(cacheKey(fsPath));
	}

	/** 只保留给定路径集合对应的条目，用于树重建后收缩缓存。 */
	public prune(paths: Iterable<string>): void {
		const keep = new Set<string>();
		for (const candidate of paths) {
			const value = candidate?.trim();
			if (value) {
				keep.add(cacheKey(value));
			}
		}
		for (const key of [...this.entries.keys()]) {
			if (!keep.has(key)) {
				this.entries.delete(key);
			}
		}
	}

	public clear(): void {
		this.entries.clear();
	}

	private isFresh(entry: CacheEntry): boolean {
		return this.now() - entry.checkedAt < this.ttlMs;
	}

	private enqueue(key: string, fsPath: string): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			this.queue.push({ key, fsPath, resolve });
			this.pump();
		});
	}

	private pump(): void {
		while (this.active < this.maxConcurrency && this.queue.length > 0) {
			const task = this.queue.shift();
			if (task) {
				this.start(task);
			}
		}
	}

	private start(task: QueueTask): void {
		this.active += 1;
		const running = this.runStat(task);
		this.inflight.set(task.key, running);
		void running
			.then(changed => task.resolve(changed), () => task.resolve(false))
			.finally(() => {
				if (this.inflight.get(task.key) === running) {
					this.inflight.delete(task.key);
				}
				this.active -= 1;
				this.pump();
			});
	}

	private async runStat(task: QueueTask): Promise<boolean> {
		let state: CachedFolderState;
		try {
			state = await this.stat(task.fsPath);
		} catch {
			// stat 抛错只可能是「不存在 / 无权限」这类拿不到元数据的情况；
			// 断链的 stat 会成功返回只有 SymbolicLink 位的 FileStat，由回调映射为 broken-link。
			state = 'missing';
		}
		const previous = this.entries.get(task.key)?.state;
		this.store(task.key, state);
		return previous !== state;
	}

	private store(key: string, state: CachedFolderState): void {
		if (this.entries.has(key)) {
			this.entries.delete(key);
		} else if (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
			}
		}
		this.entries.set(key, { state, checkedAt: this.now() });
	}
}
