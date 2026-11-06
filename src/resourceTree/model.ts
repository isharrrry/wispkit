/**
 * 「自定义资源管理」的纯数据层。
 *
 * 这里刻意不 import vscode / fs：树的增删改、JSON 解析与清洗、移动时的环检测
 * 全部能在 mocha 里直接跑。宿主只负责把结果渲染成 TreeView 与读写文件。
 *
 * 两种节点：
 *   - `group`  ：虚拟分组，只用来命名与归类，不对应磁盘上的任何文件夹；
 *   - `folder` ：真实文件夹，path 指向磁盘（支持 `${workspaceFolder}` 占位符）。
 *
 * 两种节点都可以有子节点，所以「任意层级」的表达是统一的。
 */

export const RESOURCE_TREE_VERSION = 1;
export const MAX_NAME_LENGTH = 120;
export const MAX_NODES = 2000;
export const MAX_CHILDREN = 200;
export const MAX_DEPTH = 12;

export type ResourceNodeType = 'group' | 'folder';

export interface ResourceGroupNode {
	readonly type: 'group';
	readonly id: string;
	readonly name: string;
	readonly children: readonly ResourceTreeNode[];
}

export interface ResourceFolderNode {
	readonly type: 'folder';
	readonly id: string;
	readonly name: string;
	/** 真实文件夹路径；可以带 `${workspaceFolder}` / `${workspaceFolder:名称}`。 */
	readonly path: string;
	readonly children: readonly ResourceTreeNode[];
}

export type ResourceTreeNode = ResourceGroupNode | ResourceFolderNode;

export interface ResourceTreeStore {
	readonly version: number;
	readonly roots: readonly ResourceTreeNode[];
}

export interface FoundResourceNode {
	readonly node: ResourceTreeNode;
	readonly parent: ResourceGroupNode | ResourceFolderNode | undefined;
	readonly depth: number;
	/** 从根到父节点的名称链（不含当前节点）。 */
	readonly path: readonly string[];
}

export interface ContainerEntry {
	readonly node: ResourceGroupNode | ResourceFolderNode;
	readonly depth: number;
	readonly path: readonly string[];
}

export interface MutationResult<T extends ResourceTreeNode> {
	readonly store: ResourceTreeStore;
	readonly node: T | undefined;
}

export interface ParseResult {
	readonly store: ResourceTreeStore;
	readonly warnings: readonly string[];
	readonly error?: string;
}

let fallbackIdCounter = 0;

function newId(prefix: 'g' | 'f'): string {
	const cryptoObject = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
		return `${prefix}-${cryptoObject.randomUUID()}`;
	}
	fallbackIdCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isContainer(node: ResourceTreeNode): node is ResourceGroupNode | ResourceFolderNode {
	return node.type === 'group' || node.type === 'folder';
}

export function isFolder(node: ResourceTreeNode): node is ResourceFolderNode {
	return node.type === 'folder';
}

export function cleanName(value: unknown, fallback = '未命名'): string {
	const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	return (text || fallback).slice(0, MAX_NAME_LENGTH);
}

function cleanPath(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** 从路径取显示名，不依赖 node:path（Windows / POSIX 两种分隔符都处理）。 */
export function folderNameFromPath(fsPath: string): string {
	const trimmed = fsPath.replace(/[\\/]+$/, '');
	const parts = trimmed.split(/[\\/]/).filter(part => part.length > 0);
	return parts.length > 0 ? parts[parts.length - 1] : trimmed || '文件夹';
}

export function createStore(): ResourceTreeStore {
	return { version: RESOURCE_TREE_VERSION, roots: [] };
}

export function countNodes(node?: ResourceTreeNode): number {
	if (!node) {
		return 0;
	}
	return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export function countStoreNodes(store: ResourceTreeStore): number {
	return store.roots.reduce((sum, node) => sum + countNodes(node), 0);
}

export function findNode(store: ResourceTreeStore, id: string): FoundResourceNode | undefined {
	const walk = (
		nodes: readonly ResourceTreeNode[],
		parent: ResourceGroupNode | ResourceFolderNode | undefined,
		depth: number,
		path: readonly string[],
	): FoundResourceNode | undefined => {
		for (const node of nodes) {
			if (node.id === id) {
				return { node, parent, depth, path };
			}
			const found = walk(node.children, node, depth + 1, [...path, node.name]);
			if (found) {
				return found;
			}
		}
		return undefined;
	};
	return walk(store.roots, undefined, 0, []);
}

export function flattenContainers(store: ResourceTreeStore): ContainerEntry[] {
	const result: ContainerEntry[] = [];
	const walk = (nodes: readonly ResourceTreeNode[], depth: number, path: readonly string[]): void => {
		for (const node of nodes) {
			result.push({ node, depth, path });
			walk(node.children, depth + 1, [...path, node.name]);
		}
	};
	walk(store.roots, 0, []);
	return result;
}

export function isDescendant(store: ResourceTreeStore, ancestorId: string, nodeId: string): boolean {
	const ancestor = findNode(store, ancestorId);
	if (!ancestor) {
		return false;
	}
	const contains = (node: ResourceTreeNode): boolean => {
		for (const child of node.children) {
			if (child.id === nodeId || contains(child)) {
				return true;
			}
		}
		return false;
	};
	return contains(ancestor.node);
}

function cloneNode(node: ResourceTreeNode): ResourceTreeNode {
	const children = node.children.map(cloneNode);
	if (node.type === 'folder') {
		return { ...node, children };
	}
	return { ...node, children };
}

export function cloneStore(store: ResourceTreeStore): ResourceTreeStore {
	return { version: store.version, roots: store.roots.map(cloneNode) };
}

function locate(
	nodes: readonly ResourceTreeNode[],
	id: string,
): { node: ResourceTreeNode; siblings: readonly ResourceTreeNode[]; index: number; parent: ResourceTreeNode | undefined } | undefined {
	const walk = (
		list: readonly ResourceTreeNode[],
		parent: ResourceTreeNode | undefined,
	): { node: ResourceTreeNode; siblings: readonly ResourceTreeNode[]; index: number; parent: ResourceTreeNode | undefined } | undefined => {
		for (let index = 0; index < list.length; index += 1) {
			const node = list[index];
			if (node.id === id) {
				return { node, siblings: list, index, parent };
			}
			const found = walk(node.children, node);
			if (found) {
				return found;
			}
		}
		return undefined;
	};
	return walk(nodes, undefined);
}

function mutableChildren(node: ResourceTreeNode): ResourceTreeNode[] {
	return node.children as ResourceTreeNode[];
}

// ── 解析 / 序列化 ────────────────────────────────────────────────────────

export function normalizeStore(raw: unknown): ParseResult {
	const warnings: string[] = [];
	const rootsSource = Array.isArray(raw)
		? raw
		: isRecord(raw) && Array.isArray(raw.roots)
			? raw.roots
			: undefined;
	if (rootsSource === undefined) {
		return {
			store: createStore(),
			warnings,
			error: '资源树 JSON 的顶层必须是 { "roots": [...] } 或一个数组。',
		};
	}
	const usedIds = new Set<string>();
	const budget = { remaining: MAX_NODES };
	const roots: ResourceTreeNode[] = [];
	for (const item of rootsSource) {
		if (budget.remaining <= 0 || roots.length >= MAX_CHILDREN) {
			warnings.push('节点数量超过上限，后面的内容已忽略。');
			break;
		}
		const node = sanitizeNode(item, 0, usedIds, budget, warnings);
		if (node) {
			roots.push(node);
		}
	}
	if (isRecord(raw) && typeof raw.version === 'number' && Number.isFinite(raw.version) && raw.version !== RESOURCE_TREE_VERSION) {
		warnings.push(`资源树文件版本为 ${raw.version}，当前只支持 v${RESOURCE_TREE_VERSION}，已按 v${RESOURCE_TREE_VERSION} 读取。`);
	}
	return { store: { version: RESOURCE_TREE_VERSION, roots }, warnings };
}

function sanitizeNode(
	raw: unknown,
	depth: number,
	usedIds: Set<string>,
	budget: { remaining: number },
	warnings: string[],
): ResourceTreeNode | undefined {
	if (!isRecord(raw) || budget.remaining <= 0) {
		return undefined;
	}
	const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
	const hasPath = typeof raw.path === 'string' && raw.path.trim().length > 0;
	let type: ResourceNodeType;
	if (rawType === 'folder' || rawType === 'dir' || rawType === 'directory') {
		type = 'folder';
	} else if (rawType === 'group' || rawType === 'virtual' || rawType === 'virtual-group') {
		type = 'group';
	} else if (!rawType) {
		type = hasPath ? 'folder' : 'group';
	} else {
		warnings.push(`忽略未知节点类型「${rawType}」。`);
		return undefined;
	}
	if (type === 'folder' && !hasPath) {
		warnings.push(`文件夹节点「${String(raw.name ?? '')}」缺少 path，已忽略。`);
		return undefined;
	}
	budget.remaining -= 1;
	const id = takeId(raw.id, usedIds, warnings);
	const children: ResourceTreeNode[] = [];
	if (depth < MAX_DEPTH && Array.isArray(raw.children)) {
		for (const child of raw.children) {
			if (children.length >= MAX_CHILDREN || budget.remaining <= 0) {
				break;
			}
			const sanitized = sanitizeNode(child, depth + 1, usedIds, budget, warnings);
			if (sanitized) {
				children.push(sanitized);
			}
		}
	} else if (Array.isArray(raw.children) && raw.children.length > 0) {
		warnings.push(`节点「${String(raw.name ?? '')}」超过 ${MAX_DEPTH} 层，子节点已忽略。`);
	}

	if (type === 'folder') {
		const path = cleanPath(raw.path);
		const name = cleanName(raw.name, folderNameFromPath(path));
		return { type: 'folder', id, name, path, children };
	}
	return { type: 'group', id, name: cleanName(raw.name, '未命名分组'), children };
}

function takeId(value: unknown, usedIds: Set<string>, warnings: string[]): string {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length > 0 && trimmed.length <= 100) {
			if (!usedIds.has(trimmed)) {
				usedIds.add(trimmed);
				return trimmed;
			}
			warnings.push(`节点 id「${trimmed}」重复，已自动重新分配。`);
		} else if (trimmed.length > 100) {
			warnings.push('节点 id 超过 100 个字符，已自动重新分配。');
		} else {
			warnings.push('节点 id 为空，已自动重新分配。');
		}
	} else if (value !== undefined && value !== null) {
		warnings.push('节点 id 不是字符串，已自动重新分配。');
	}
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const candidate = newId('g');
		if (!usedIds.has(candidate)) {
			usedIds.add(candidate);
			return candidate;
		}
	}
	const fallback = `id-${Date.now().toString(36)}-${usedIds.size}`;
	usedIds.add(fallback);
	return fallback;
}

export function parseStoreJson(text: string): ParseResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			store: createStore(),
			warnings: [],
			error: `资源树 JSON 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return normalizeStore(value);
}

function serializeNode(node: ResourceTreeNode): Record<string, unknown> {
	const children = node.children.map(serializeNode);
	if (node.type === 'folder') {
		return { type: 'folder', id: node.id, name: node.name, path: node.path, children };
	}
	return { type: 'group', id: node.id, name: node.name, children };
}

export function serializeStore(store: ResourceTreeStore): string {
	return `${JSON.stringify({
		version: RESOURCE_TREE_VERSION,
		roots: store.roots.map(serializeNode),
	}, null, 2)}\n`;
}

// ── 变更 ────────────────────────────────────────────────────────────────

function parentContainer(
	store: ResourceTreeStore,
	parentId: string | null | undefined,
): { children: ResourceTreeNode[]; parent: ResourceTreeNode | undefined } | undefined {
	if (parentId === undefined || parentId === null || parentId === '') {
		return { children: store.roots as ResourceTreeNode[], parent: undefined };
	}
	const found = findNode(store, parentId);
	if (!found) {
		return undefined;
	}
	return { children: mutableChildren(found.node), parent: found.node };
}

export function addGroup(store: ResourceTreeStore, parentId: string | null | undefined, name: string): MutationResult<ResourceGroupNode> {
	if (countStoreNodes(store) >= MAX_NODES) {
		return { store, node: undefined };
	}
	const next = cloneStore(store);
	const target = parentContainer(next, parentId);
	if (!target || target.children.length >= MAX_CHILDREN) {
		return { store, node: undefined };
	}
	const depth = parentId ? (findNode(next, parentId)?.depth ?? 0) + 1 : 0;
	if (depth > MAX_DEPTH) {
		return { store, node: undefined };
	}
	const node: ResourceGroupNode = { type: 'group', id: newId('g'), name: cleanName(name, '未命名分组'), children: [] };
	target.children.push(node);
	return { store: next, node };
}

export function addFolder(
	store: ResourceTreeStore,
	parentId: string | null | undefined,
	name: string,
	path: string,
): MutationResult<ResourceFolderNode> {
	const cleanedPath = cleanPath(path);
	if (!cleanedPath || countStoreNodes(store) >= MAX_NODES) {
		return { store, node: undefined };
	}
	const next = cloneStore(store);
	const target = parentContainer(next, parentId);
	if (!target || target.children.length >= MAX_CHILDREN) {
		return { store, node: undefined };
	}
	const depth = parentId ? (findNode(next, parentId)?.depth ?? 0) + 1 : 0;
	if (depth > MAX_DEPTH) {
		return { store, node: undefined };
	}
	const node: ResourceFolderNode = {
		type: 'folder',
		id: newId('f'),
		name: cleanName(name, folderNameFromPath(cleanedPath)),
		path: cleanedPath,
		children: [],
	};
	target.children.push(node);
	return { store: next, node };
}

export function renameNode(store: ResourceTreeStore, id: string, name: string): ResourceTreeStore {
	if (!findNode(store, id)) {
		return store;
	}
	const next = cloneStore(store);
	const target = locate(next.roots, id);
	if (!target) {
		return store;
	}
	const cleaned = cleanName(name, target.node.type === 'folder' ? folderNameFromPath(target.node.path) : '未命名分组');
	const updated: ResourceTreeNode = target.node.type === 'folder'
		? { ...target.node, name: cleaned }
		: { ...target.node, name: cleaned };
	if (target.parent) {
		const parentInNext = locate(next.roots, target.parent.id);
		if (!parentInNext) {
			return store;
		}
		mutableChildren(parentInNext.node)[target.index] = updated;
	} else {
		(next.roots as ResourceTreeNode[])[target.index] = updated;
	}
	return next;
}

export function removeNode(store: ResourceTreeStore, id: string): ResourceTreeStore {
	const target = locate(store.roots, id);
	if (!target) {
		return store;
	}
	const next = cloneStore(store);
	const cloned = locate(next.roots, id);
	if (!cloned) {
		return store;
	}
	if (cloned.parent) {
		const parentInNext = locate(next.roots, cloned.parent.id);
		if (parentInNext) {
			mutableChildren(parentInNext.node).splice(cloned.index, 1);
		}
	} else {
		(next.roots as ResourceTreeNode[]).splice(cloned.index, 1);
	}
	return next;
}

function insertIntoParent(
	store: ResourceTreeStore,
	node: ResourceTreeNode,
	targetParentId: string | null | undefined,
	index: number,
): boolean {
	if (targetParentId === undefined || targetParentId === null || targetParentId === '') {
		const roots = store.roots as ResourceTreeNode[];
		const at = index < 0 || index > roots.length ? roots.length : index;
		roots.splice(at, 0, node);
		return true;
	}
	const parent = findNode(store, targetParentId);
	if (!parent || !isContainer(parent.node)) {
		return false;
	}
	const target = locate(store.roots, targetParentId);
	if (!target) {
		return false;
	}
	const children = mutableChildren(target.node);
	const at = index < 0 || index > children.length ? children.length : index;
	children.splice(at, 0, node);
	return true;
}

/**
 * 移动节点。targetParentId 为 null/undefined 表示移到树根。
 * 拒绝把节点移进自己或自己的后代（否则树会从世界上消失）。
 */
export function moveNode(
	store: ResourceTreeStore,
	id: string,
	targetParentId: string | null | undefined,
	index = -1,
): ResourceTreeStore {
	const source = locate(store.roots, id);
	if (!source) {
		return store;
	}
	if (targetParentId && (targetParentId === id || isDescendant(store, id, targetParentId))) {
		return store;
	}
	const next = cloneStore(store);
	const cloned = locate(next.roots, id);
	if (!cloned) {
		return store;
	}
	const node = cloned.node;
	if (cloned.parent) {
		const parentInNext = locate(next.roots, cloned.parent.id);
		if (parentInNext) {
			mutableChildren(parentInNext.node).splice(cloned.index, 1);
		}
	} else {
		(next.roots as ResourceTreeNode[]).splice(cloned.index, 1);
	}
	const ok = insertIntoParent(next, node, targetParentId, index);
	return ok ? next : store;
}

/** 在同级里上移 / 下移；delta = -1 上移，+1 下移。 */
export function moveSibling(store: ResourceTreeStore, id: string, delta: number): ResourceTreeStore {
	const target = locate(store.roots, id);
	if (!target || !Number.isFinite(delta) || delta === 0) {
		return store;
	}
	const siblings = target.parent ? target.parent.children : store.roots;
	const nextIndex = target.index + Math.sign(delta);
	if (nextIndex < 0 || nextIndex >= siblings.length) {
		return store;
	}
	const next = cloneStore(store);
	const cloned = locate(next.roots, id);
	if (!cloned) {
		return store;
	}
	let list: ResourceTreeNode[];
	if (cloned.parent) {
		const parentInNext = locate(next.roots, cloned.parent.id);
		if (!parentInNext) {
			return store;
		}
		list = mutableChildren(parentInNext.node);
	} else {
		list = next.roots as ResourceTreeNode[];
	}
	const node = list[cloned.index];
	list.splice(cloned.index, 1);
	list.splice(nextIndex, 0, node);
	return next;
}
