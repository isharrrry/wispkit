import * as assert from 'assert';
import * as path from 'path';
import {
	displayStoredPath,
	isInside,
	pathKey,
	resolveStoredPath,
	samePath,
	toStoredPath,
	tokenForFolder,
	type WorkspaceFolderLike,
} from '../resourceTree/paths';

const first = path.resolve('virtual-workspace', 'first');
const second = path.resolve('virtual-workspace', 'docs');
const folders: WorkspaceFolderLike[] = [
	{ name: 'first', fsPath: first },
	{ name: 'docs', fsPath: second },
];

describe('resourceTree/paths', () => {
	it('工作区内的路径存成 ${workspaceFolder} 占位符（POSIX 分隔符）', () => {
		assert.strictEqual(toStoredPath(path.join(first, 'src'), folders), '${workspaceFolder}/src');
		assert.strictEqual(toStoredPath(path.join(first, 'src', 'a', 'b.ts'), folders), '${workspaceFolder}/src/a/b.ts');
		assert.strictEqual(toStoredPath(second, folders), '${workspaceFolder:docs}');
		assert.strictEqual(toStoredPath(path.join(second, 'assets'), folders), '${workspaceFolder:docs}/assets');
	});

	it('工作区外的路径保留绝对路径，并统一正斜杠', () => {
		const outside = path.resolve('virtual-workspace', 'external');
		const stored = toStoredPath(outside, folders);
		assert.ok(!stored.startsWith('${workspaceFolder'));
		assert.ok(stored.includes('external'));
		assert.ok(!stored.includes('\\'), '保存路径统一用 /');
	});

	it('占位符解析：默认第一个工作区、按名称、按序号', () => {
		assert.strictEqual(resolveStoredPath('${workspaceFolder}/src', folders), path.resolve(first, 'src'));
		assert.strictEqual(resolveStoredPath('${workspaceFolder:docs}/assets', folders), path.resolve(second, 'assets'));
		assert.strictEqual(resolveStoredPath('${workspaceFolder:1}/assets', folders), path.resolve(second, 'assets'));
		assert.strictEqual(resolveStoredPath('${workspaceFolder}', folders), first);
	});

	it('占位符无法解析 / 越界 / 空路径返回 undefined', () => {
		assert.strictEqual(resolveStoredPath('${workspaceFolder:missing}/x', folders), undefined);
		assert.strictEqual(resolveStoredPath('${workspaceFolder}/../escape', folders), undefined);
		assert.strictEqual(resolveStoredPath('   ', folders), undefined);
		assert.strictEqual(resolveStoredPath('${workspaceFolder}', []), undefined);
	});

	it('没有占位符的相对路径按第一个工作区解析；绝对路径原样归一化', () => {
		assert.strictEqual(resolveStoredPath('src/x', folders), path.resolve(first, 'src', 'x'));
		const absolute = path.resolve('outside', 'dir');
		assert.strictEqual(resolveStoredPath(absolute, folders), path.normalize(absolute));
	});

	it('tokenForFolder：第一个固定，其余按名称 / 序号', () => {
		assert.strictEqual(tokenForFolder(folders[0], 0), '${workspaceFolder}');
		assert.strictEqual(tokenForFolder(folders[1], 1), '${workspaceFolder:docs}');
		assert.strictEqual(tokenForFolder({ name: 'bad}name', fsPath: second }, 1), '${workspaceFolder:1}');
	});

	it('isInside 拒绝兄弟目录与上级目录', () => {
		assert.strictEqual(isInside(first, path.join(first, 'a')), true);
		assert.strictEqual(isInside(first, first), true);
		assert.strictEqual(isInside(first, second), false);
		assert.strictEqual(isInside(first, path.resolve(first, '..')), false);
	});

	it('displayStoredPath / pathKey 解析后展示，Windows 下大小写不敏感', () => {
		assert.strictEqual(displayStoredPath('${workspaceFolder}/src', folders), path.resolve(first, 'src'));
		assert.strictEqual(displayStoredPath('${workspaceFolder:missing}/x', folders), '${workspaceFolder:missing}/x');
		assert.strictEqual(pathKey('${workspaceFolder}/src', folders), pathKey(path.join(first, 'src'), folders));
		if (path.sep === '\\') {
			assert.strictEqual(samePath('C:\\Work\\Src', 'c:\\work\\src'), true);
		}
	});
});
