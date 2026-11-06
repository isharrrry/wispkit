import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createStore, serializeStore } from '../resourceTree/model';
import type { WorkspaceFolderLike } from '../resourceTree/paths';
import {
	classifyExternalChange,
	DEFAULT_STORAGE_RELATIVE,
	decodeStoreText,
	includeWorkspaceFolderInStorageDescription,
	resolveStoragePath,
	temporarySiblingPath,
	writeFileAtomically,
	type AtomicWriteOperations,
} from '../resourceTree/storageCore';

const first = path.resolve('virtual-workspace', 'first');
const second = path.resolve('virtual-workspace', 'docs');
const folders: WorkspaceFolderLike[] = [
	{ name: 'first', fsPath: first },
	{ name: 'docs', fsPath: second },
];

describe('resourceTree/storageCore 存储位置解析', () => {
	it('空配置使用第一个工作区下的默认文件，并标记 usedDefault', () => {
		for (const configured of ['', '   ']) {
			const resolution = resolveStoragePath(configured, folders);
			assert.strictEqual(resolution.error, undefined);
			assert.strictEqual(resolution.usedDefault, true);
			assert.strictEqual(resolution.path, path.resolve(first, DEFAULT_STORAGE_RELATIVE));
		}
	});

	it('相对路径基于第一个工作区，绝对路径保持绝对', () => {
		const relative = resolveStoragePath('config/resource-tree.json', folders);
		assert.strictEqual(relative.path, path.resolve(first, 'config', 'resource-tree.json'));
		assert.strictEqual(relative.usedDefault, false);

		const absolutePath = path.resolve('virtual-workspace', 'elsewhere', 'tree.json');
		const absolute = resolveStoragePath(absolutePath, folders);
		assert.strictEqual(absolute.path, path.normalize(absolutePath));
		assert.strictEqual(absolute.error, undefined);
	});

	it('${workspaceFolder}、按名称、按序号都能解析', () => {
		assert.strictEqual(resolveStoragePath('${workspaceFolder}/tree.json', folders).path, path.resolve(first, 'tree.json'));
		assert.strictEqual(resolveStoragePath('${workspaceFolder:docs}/tree.json', folders).path, path.resolve(second, 'tree.json'));
		assert.strictEqual(resolveStoragePath('${workspaceFolder:1}/tree.json', folders).path, path.resolve(second, 'tree.json'));
	});

	it('无法解析的占位符给出可诊断错误，绝不静默退回默认文件', () => {
		const resolution = resolveStoragePath('${workspaceFolder:missing}/tree.json', folders);
		assert.strictEqual(resolution.path, undefined);
		assert.ok(resolution.error?.includes('无法解析工作区占位符'));
		assert.ok(resolution.error?.includes('workspaceFolder:missing'));
		assert.ok(resolution.error?.includes('可用工作区'));
	});

	it('没有工作区时：相对路径报错，绝对路径仍可用', () => {
		const relative = resolveStoragePath('tree.json', []);
		assert.strictEqual(relative.path, undefined);
		assert.ok(relative.error?.includes('没有打开工作区文件夹'));

		const absolutePath = path.resolve('virtual-workspace', 'tree.json');
		const absolute = resolveStoragePath(absolutePath, []);
		assert.strictEqual(absolute.error, undefined);
		assert.strictEqual(absolute.path, path.normalize(absolutePath));
	});

	it('多根工作区的视图描述带根名称，单根保持短路径', () => {
		assert.strictEqual(includeWorkspaceFolderInStorageDescription(0), false);
		assert.strictEqual(includeWorkspaceFolderInStorageDescription(1), false);
		assert.strictEqual(includeWorkspaceFolderInStorageDescription(2), true);
		assert.strictEqual(includeWorkspaceFolderInStorageDescription(3), true);
	});

	it('目录写法 / 盘符相对路径 / 非法字符都被拒绝', () => {
		const trailing = resolveStoragePath('trees/', folders);
		assert.ok(trailing.error?.includes('目录分隔符'));

		const driveRelative = resolveStoragePath('C:tree.json', folders);
		assert.ok(driveRelative.error?.includes('不是合法的绝对路径'));

		const control = resolveStoragePath(`trees/${String.fromCharCode(1)}.json`, folders);
		assert.ok(control.error?.includes('非法字符'));

		if (path.sep === '\\') {
			const windowsIllegal = resolveStoragePath('D:/trees/bad<name>.json', folders);
			assert.ok(windowsIllegal.error?.includes('非法字符'));
		}
	});
});

describe('resourceTree/storageCore 解码与临时路径', () => {
	it('UTF-8 解码容忍 BOM，中文内容无损', () => {
		const text = '{"version":1,"roots":[]}';
		const body = new TextEncoder().encode(text);
		assert.strictEqual(decodeStoreText(body), text);

		const withBom = new Uint8Array(3 + body.length);
		withBom.set([0xef, 0xbb, 0xbf], 0);
		withBom.set(body, 3);
		assert.strictEqual(decodeStoreText(withBom), text);

		const chinese = new TextEncoder().encode('{"name":"文档"}');
		assert.strictEqual(decodeStoreText(chinese), '{"name":"文档"}');
	});

	it('临时文件与目标同目录、路径唯一', () => {
		const target = 'C:/trees/resource-tree.json';
		const a = temporarySiblingPath(target);
		const b = temporarySiblingPath(target);
		assert.notStrictEqual(a, b);
		assert.ok(a.startsWith(`${target}.tmp-`));
		assert.strictEqual(path.dirname(a), path.dirname(target));
	});
});

class MemoryFileSystem implements AtomicWriteOperations<string> {
	readonly files = new Map<string, string>();
	readonly calls: string[] = [];
	failWrite = false;
	failRename = false;
	failDelete = false;

	async writeFile(target: string, data: Uint8Array): Promise<void> {
		this.calls.push(`write:${target}`);
		if (this.failWrite) {
			this.files.set(target, 'partial');
			throw new Error('disk full');
		}
		this.files.set(target, new TextDecoder().decode(data));
	}

	async rename(source: string, target: string): Promise<void> {
		this.calls.push(`rename:${source}->${target}`);
		if (this.failRename) {
			throw new Error('EPERM');
		}
		const content = this.files.get(source);
		if (content === undefined) {
			throw new Error('ENOENT');
		}
		this.files.delete(source);
		this.files.set(target, content);
	}

	async delete(target: string): Promise<void> {
		this.calls.push(`delete:${target}`);
		if (this.failDelete) {
			throw new Error('EACCES');
		}
		this.files.delete(target);
	}
}

describe('resourceTree/storageCore 外部修改检测', () => {
	it('首次使用（两边都没有）不算冲突', () => {
		assert.strictEqual(classifyExternalChange(undefined, undefined), 'none');
	});

	it('外部新建了扩展从没确认过的文件', () => {
		assert.strictEqual(classifyExternalChange(undefined, '{"roots":[]}'), 'created');
	});

	it('外部删除 / 内容变化 / 内容相同', () => {
		assert.strictEqual(classifyExternalChange('{"roots":[]}', undefined), 'deleted');
		assert.strictEqual(classifyExternalChange('{"roots":[]}', '{"roots":[1]}'), 'modified');
		assert.strictEqual(classifyExternalChange('{"roots":[]}', '{"roots":[]}'), 'none');
	});

	it('只比较传入的规范化文本：格式差异由调用方先规范化后再比较', () => {
		// 调用方在 provider 里对磁盘内容做 parse + serializeStore，所以缩进变化会被
		// 归一；这里锁定纯函数本身是逐字符比较，避免误以为它做了宽容匹配。
		assert.strictEqual(classifyExternalChange('{"roots":[]}', '{\n  "roots": []\n}'), 'modified');
	});
});

describe('resourceTree/storageCore 原子写入（内存文件系统）', () => {
	const target = 'tree.json';
	const temporary = 'tree.json.tmp-1';
	const data = new TextEncoder().encode('new content');

	it('成功后目标内容替换，临时文件消失，顺序为先写临时文件再 rename', async () => {
		const memory = new MemoryFileSystem();
		memory.files.set(target, 'old content');
		await writeFileAtomically(memory, target, temporary, data);
		assert.strictEqual(memory.files.get(target), 'new content');
		assert.strictEqual(memory.files.has(temporary), false);
		assert.deepStrictEqual(memory.calls, [
			`write:${temporary}`,
			`rename:${temporary}->${target}`,
		]);
	});

	it('临时文件写失败：目标保持旧内容，临时文件被清理', async () => {
		const memory = new MemoryFileSystem();
		memory.files.set(target, 'old content');
		memory.failWrite = true;
		await assert.rejects(writeFileAtomically(memory, target, temporary, data), /disk full/);
		assert.strictEqual(memory.files.get(target), 'old content', '旧文件不能被清空');
		assert.strictEqual(memory.files.has(temporary), false, '残留临时文件必须清理');
		assert.ok(memory.calls.includes(`delete:${temporary}`));
	});

	it('rename 失败：目标保持旧内容，临时文件被清理', async () => {
		const memory = new MemoryFileSystem();
		memory.files.set(target, 'old content');
		memory.failRename = true;
		await assert.rejects(writeFileAtomically(memory, target, temporary, data), /EPERM/);
		assert.strictEqual(memory.files.get(target), 'old content', 'rename 失败不能影响旧文件');
		assert.strictEqual(memory.files.has(temporary), false);
	});

	it('清理也失败时保留原始错误（清理异常不能盖住写入错误）', async () => {
		const memory = new MemoryFileSystem();
		memory.files.set(target, 'old content');
		memory.failRename = true;
		memory.failDelete = true;
		await assert.rejects(writeFileAtomically(memory, target, temporary, data), /EPERM/);
		assert.strictEqual(memory.files.get(target), 'old content');
	});
});

function nodeOperations(): AtomicWriteOperations<string> {
	return {
		writeFile: (file, bytes) => fs.promises.writeFile(file, bytes),
		rename: (source, destination) => fs.promises.rename(source, destination),
		delete: file => fs.promises.rm(file, { force: true }),
	};
}

describe('resourceTree/storageCore 原子写入（真实文件系统）', () => {
	it('覆盖已有文件：内容完整且没有临时文件残留', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispkit-storage-'));
		try {
			const target = path.join(dir, 'resource-tree.json');
			fs.writeFileSync(target, 'old content');
			const temporary = temporarySiblingPath(target);
			const text = serializeStore(createStore());
			await writeFileAtomically(nodeOperations(), target, temporary, new TextEncoder().encode(text));
			assert.strictEqual(fs.readFileSync(target, 'utf8'), text);
			assert.strictEqual(fs.existsSync(temporary), false);
			assert.strictEqual(path.dirname(temporary), path.dirname(target));
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('写临时文件失败（目录不存在）时旧文件一动不动', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispkit-storage-'));
		try {
			const target = path.join(dir, 'resource-tree.json');
			fs.writeFileSync(target, 'old content');
			const brokenTemporary = path.join(dir, 'missing', 'resource-tree.json.tmp');
			await assert.rejects(writeFileAtomically(
				nodeOperations(),
				target,
				brokenTemporary,
				new TextEncoder().encode('new content'),
			));
			assert.strictEqual(fs.readFileSync(target, 'utf8'), 'old content');
			assert.strictEqual(fs.existsSync(brokenTemporary), false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
