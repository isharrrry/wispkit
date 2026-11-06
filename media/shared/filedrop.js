/**
 * 从 `DataTransfer` 里读取拖入内容（子树浏览 / 对比浏览共用）。
 *
 * 只做**同步快照 + File 内容读取**，不关心落盘策略：两个页面把读到的
 * `files` / `strings` 原样发给宿主，由宿主询问、查重并写盘。
 */

/** 单个拖入文件的上限：再大就不该走 webview 内存，直接提示。 */
export const MAX_DROP_FILE_BYTES = 64 * 1024 * 1024;
/** 单段拖入文本的上限。 */
export const MAX_DROP_STRING_CHARS = 10 * 1024 * 1024;

/**
 * 同步读取 DataTransfer。`getAsString` 必须在 drop 事件同步阶段发起 —
 * 事件回调返回后条目列表会失效，事后 await 再读只会拿到空内容。
 */
export function snapshotDrop(dataTransfer) {
	const stringPromises = [];
	const fileObjects = [];
	const directories = [];
	if (!dataTransfer) {
		return { stringPromises, fileObjects, directories };
	}

	const items = Array.from(dataTransfer.items ?? []);
	for (const item of items) {
		if (item.kind === 'file') {
			let entry = null;
			try {
				entry = item.webkitGetAsEntry?.() ?? null;
			} catch {
				entry = null;
			}
			if (entry && entry.isDirectory) {
				directories.push(entry.name);
				continue;
			}
			const file = item.getAsFile?.();
			if (file) {
				fileObjects.push(file);
			}
		} else if (item.kind === 'string') {
			const mime = item.type || 'text/plain';
			stringPromises.push(new Promise(resolve => {
				try {
					item.getAsString(text => resolve({ kind: 'string', mime, text: String(text ?? '') }));
				} catch {
					resolve(null);
				}
			}));
		}
	}

	// 没有 items 的环境（老浏览器 / 测试桩）退回到 files 列表
	if (items.length === 0 && dataTransfer.files) {
		fileObjects.push(...Array.from(dataTransfer.files));
	}
	return { stringPromises, fileObjects, directories };
}

/** 读取每个 File 的字节；超大 / 失败的文件保留元信息并标记 error。 */
export async function readDroppedFiles(fileObjects) {
	const out = [];
	for (const file of fileObjects) {
		const base = {
			kind: 'file',
			name: file.name,
			mime: file.type || 'application/octet-stream',
			size: file.size,
			lastModified: file.lastModified,
		};
		if (file.size > MAX_DROP_FILE_BYTES) {
			out.push({ ...base, error: `文件超过 ${Math.round(MAX_DROP_FILE_BYTES / 1024 / 1024)} MB，未读取` });
			continue;
		}
		try {
			out.push({ ...base, data: await file.arrayBuffer() });
		} catch (error) {
			out.push({ ...base, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return out;
}
