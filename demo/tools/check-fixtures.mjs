/**
 * 素材自检：验证"验证数据本身"是有效的。
 *
 * 为什么需要它：如果素材自己就有毛病（图片路径写错、跳转行号指偏、PNG 尺寸与文件名不符），
 * 那么手工验证时看到的现象会被误判成 Wispkit 的缺陷。先让素材自证清白，再谈扩展对不对。
 *
 * 检查项：
 *   1. 相对路径资源（md 图片 / html 的 css·js·img）是否存在
 *   2. `vscode://file/…` 跳转链接：目标文件存在？行号处是否正好是 `LINE-xx-MARKER`？
 *   3. 手写的 `command:vscode.open?…` 链接：能否 decode 出合法 JSON、第一项是否指向真实文件
 *   4. 图片像素尺寸是否与文件名里的 `宽x高` 一致（PNG/JPEG/BMP/GIF/ICO 头解析）
 *   5. 标题层级分布统计（用于核对 R2 各文件里写的期望值）
 *
 * 用法： node tools/check-fixtures.mjs
 * 退出码：有 FAIL → 1，否则 0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** R2 各文件的标题数期望值（改内容就要同步改它，否则自检报 FAIL）。 */
const EXPECTED_PATH = path.join(ROOT, 'tools', 'expected.json');
const EXPECTED_HEADINGS = fs.existsSync(EXPECTED_PATH)
	? JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'))
	: {};

/** 这些链接**故意**指向不存在/越界的目标，用来观察边界行为，不计失败。 */
const EXPECTED_MISSING = [
	{ pattern: /target-simple\.md:0$/, why: '行号 0：预期只打开文件不定位' },
	{ pattern: /target-simple\.md:999999$/, why: '行号越界：观察 VS Code 如何夹取' },
	{ pattern: /target-simple\.md:abc$/, why: '非数字行号：预期被当成文件名' },
	{ pattern: /target-simple\.md#L10$/, why: '#L10 形式：不在改写范围' },
	{ pattern: /x240\.gif$/i, why: '文件名以数字结尾：只测切分逻辑，本文件确实存在则另算' }
];

/** 允许缺失的资源（依赖外部工具生成，缺失只提示不失败）。 */
const OPTIONAL_ASSETS = [/\.webp$/i, /\.avif$/i];

const pass = [];
const fail = [];
const warn = [];
const info = [];

function rel(full) {
	return path.relative(ROOT, full).replace(/\\/g, '/');
}

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, out);
		} else {
			out.push(full);
		}
	}
	return out;
}

// ---------------------------------------------------------------- 图片尺寸头解析
function pngSize(buffer) {
	if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
		return null;
	}
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifSize(buffer) {
	if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') {
		return null;
	}
	return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function bmpSize(buffer) {
	if (buffer.length < 26 || buffer.toString('ascii', 0, 2) !== 'BM') {
		return null;
	}
	return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
}

function icoSize(buffer) {
	if (buffer.length < 8 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
		return null;
	}
	return { width: buffer[6] === 0 ? 256 : buffer[6], height: buffer[7] === 0 ? 256 : buffer[7] };
}

function jpegSize(buffer) {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
		return null;
	}
	let offset = 2;
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = buffer[offset + 1];
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
		}
		const length = buffer.readUInt16BE(offset + 2);
		if (length < 2) {
			return null;
		}
		offset += 2 + length;
	}
	return null;
}

function svgSize(buffer) {
	const text = buffer.toString('utf8');
	const width = /width="(\d+)"/.exec(text);
	const height = /height="(\d+)"/.exec(text);
	return width && height ? { width: Number(width[1]), height: Number(height[1]) } : null;
}

/** WebP：RIFF 容器。只处理最常出现的两种负载（VP8X 扩展格式 / VP8 有损格式）。 */
function webpSize(buffer) {
	if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
		return null;
	}
	const chunk = buffer.toString('ascii', 12, 16);
	if (chunk === 'VP8X') {
		const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
		const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
		return { width, height };
	}
	if (chunk === 'VP8 ') {
		const start = 20 + 6;
		return { width: buffer.readUInt16LE(start) & 0x3fff, height: buffer.readUInt16LE(start + 2) & 0x3fff };
	}
	return null;
}

/** AVIF：ISOBMFF，扫 `ispe` box —— 其后依次是版本+flags(4)、宽(4, 大端)、高(4, 大端)。 */
function avifSize(buffer) {
	const at = buffer.indexOf('ispe', 0, 'ascii');
	if (at < 0 || at + 16 > buffer.length) {
		return null;
	}
	return { width: buffer.readUInt32BE(at + 8), height: buffer.readUInt32BE(at + 12) };
}

function imageSize(full) {
	const buffer = fs.readFileSync(full);
	const ext = path.extname(full).toLowerCase();
	if (ext === '.png') return pngSize(buffer);
	if (ext === '.jpg' || ext === '.jpeg') return jpegSize(buffer);
	if (ext === '.gif') return gifSize(buffer);
	if (ext === '.bmp') return bmpSize(buffer);
	if (ext === '.ico') return icoSize(buffer);
	if (ext === '.svg') return svgSize(buffer);
	if (ext === '.webp') return webpSize(buffer);
	if (ext === '.avif') return avifSize(buffer);
	return null;
}

// ---------------------------------------------------------------- 链接解析
function fileUriToPath(uri) {
	const match = /^file:\/\/(\/?)(.*)$/i.exec(uri);
	if (!match) {
		return null;
	}
	let decoded = decodeURIComponent(match[2]);
	if (/^\/[A-Za-z]:/.test(decoded)) {
		decoded = decoded.slice(1);
	}
	return decoded;
}

/**
 * 把 Markdown 里的围栏代码块和行内代码抹掉。
 * 原因：代码块里出现的 `vscode://file/…` 是**示例文本**，不是真链接；
 * 不抹掉就会把示例当成"跳转目标不存在"报错（自检第一次跑就踩了这个）。
 */
function stripMarkdownCode(text) {
	let inFence = false;
	let fenceChar = '';
	const stripped = text.split(/\r?\n/).map(line => {
		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceChar = fence[1][0];
			} else if (fence[1][0] === fenceChar) {
				inFence = false;
			}
			return '';
		}
		return inFence ? '' : line;
	});
	return stripped.join('\n').replace(/`[^`\n]*`/g, '');
}

/** HTML 同理：注释、`<code>`、`<pre>` 里的内容不是真引用。 */
function stripHtmlCode(text) {
	return text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
}

/** 抽出所有"引用候选"：Markdown 链接目标 + HTML 的 src/href 属性值。 */
function collectReferences(text) {
	const refs = [];
	for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s][^)]*)\)/g)) {
		refs.push(match[1].trim().replace(/^<|>$/g, ''));
	}
	for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
		refs.push(match[1]);
	}
	return refs;
}

function checkRelative(fromFile, ref) {
	if (/^(https?:|data:|mailto:|#|command:|vscode:|wispkit-demo:|\/\/)/i.test(ref)) {
		return;
	}
	const clean = ref.split('#')[0].split('?')[0];
	if (clean.length === 0) {
		return;
	}
	const target = path.resolve(path.dirname(fromFile), decodeURIComponent(clean));
	if (fs.existsSync(target)) {
		pass.push(`${rel(fromFile)} → ${ref}`);
		return;
	}
	if (OPTIONAL_ASSETS.some(pattern => pattern.test(clean))) {
		warn.push(`${rel(fromFile)} → ${ref} 不存在（可选资源，需先跑 gen-webp-avif.mjs）`);
		return;
	}
	fail.push(`${rel(fromFile)} → 相对资源不存在：${ref}`);
}

function checkVscodeLink(fromFile, rawLink) {
	const match = /^(.*?)(?::(\d+))?$/.exec(rawLink);
	const decodedPath = decodeURIComponent(match[1]);
	const line = match[2] ? Number(match[2]) : undefined;
	const target = path.isAbsolute(decodedPath) ? decodedPath : path.resolve(ROOT, decodedPath);

	for (const expected of EXPECTED_MISSING) {
		if (expected.pattern.test(rawLink) && !fs.existsSync(target)) {
			info.push(`边界（预期缺失）：${rel(fromFile)} → ${rawLink}  · ${expected.why}`);
			return;
		}
	}

	if (!fs.existsSync(target)) {
		fail.push(`${rel(fromFile)} → 跳转目标不存在：${rawLink}`);
		return;
	}

	if (line === undefined) {
		pass.push(`${rel(fromFile)} → ${rawLink}（无行号，文件存在）`);
		return;
	}

	const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);
	if (line < 1 || line > lines.length) {
		info.push(`边界（越界）：${rel(fromFile)} → ${rawLink}（目标只有 ${lines.length} 行）`);
		return;
	}

	const content = lines[line - 1];
	const marker = /LINE-(\d+)-MARKER/.exec(content);
	if (!marker) {
		fail.push(`${rel(fromFile)} → ${rawLink}：第 ${line} 行没有 LINE-xx-MARKER（实际是「${content.slice(0, 40)}」）`);
		return;
	}
	if (Number(marker[1]) !== line) {
		fail.push(`${rel(fromFile)} → ${rawLink}：标记写的是 LINE-${marker[1]}，但链接指向第 ${line} 行`);
		return;
	}
	pass.push(`${rel(fromFile)} → ${rawLink}（行号与 LINE 标记一致）`);
}

function checkCommandLink(fromFile, encoded) {
	let payload;
	try {
		payload = JSON.parse(decodeURIComponent(encoded));
	} catch (error) {
		fail.push(`${rel(fromFile)} → command: 链接无法 decode 成 JSON（${error.message}）`);
		return;
	}
	if (!Array.isArray(payload) || payload.length === 0 || typeof payload[0] !== 'string') {
		fail.push(`${rel(fromFile)} → command: 链接的 JSON 不是 [资源, 选项?] 形式`);
		return;
	}
	const target = fileUriToPath(payload[0]);
	if (!target) {
		fail.push(`${rel(fromFile)} → command: 链接第一项不是 file:// URI：${payload[0]}`);
		return;
	}
	if (!fs.existsSync(target)) {
		fail.push(`${rel(fromFile)} → command: 链接指向的文件不存在：${target}`);
		return;
	}
	pass.push(`${rel(fromFile)} → command:vscode.open 指向真实文件（${path.basename(target)}）`);
}

// ---------------------------------------------------------------- 主流程
function analyze(file) {
	const ext = path.extname(file).toLowerCase();
	const text = fs.readFileSync(file, 'utf8');
	const lines = text.split(/\r?\n/);

	if (ext === '.md') {
		let inFence = false;
		let fenceChar = '';
		const headings = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
		for (const line of lines) {
			const fence = /^\s*(`{3,}|~{3,})/.exec(line);
			if (fence) {
				if (!inFence) {
					inFence = true;
					fenceChar = fence[1][0];
				} else if (fence[1][0] === fenceChar) {
					inFence = false;
				}
				continue;
			}
			if (inFence) {
				continue;
			}
			const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
			if (heading) {
				headings[`h${heading[1].length}`] += 1;
			}
		}
		const summary = `h1=${headings.h1} h2=${headings.h2} h3=${headings.h3} h4=${headings.h4} h5=${headings.h5} h6=${headings.h6}`;
		info.push(`标题统计 ${rel(file)}  ${summary}  · depth3 目录=${headings.h1 + headings.h2 + headings.h3} 条`);

		const expected = EXPECTED_HEADINGS[rel(file)];
		if (expected) {
			for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
				if (typeof expected[level] === 'number' && expected[level] !== headings[level]) {
					fail.push(`${rel(file)}：${level} 实际 ${headings[level]} 个，tools/expected.json 写的是 ${expected[level]} 个`
						+ `（改了内容就要同步改 expected.json 和文件里写的判据）`);
				}
			}
		}
	}

	if (ext === '.md' || ext === '.html') {
		const stripped = ext === '.md' ? stripMarkdownCode(text) : stripHtmlCode(text);
		for (const ref of collectReferences(stripped)) {
			// 说明文字里的占位符（`…`、`&lt;路径&gt;`）与残留反引号不是真链接
			if (ref.length === 0 || ref.includes('…') || ref.includes('&lt;') || ref.includes('&gt;') || ref.includes('`')) {
				continue;
			}
			if (/^vscode:\/\/file\//i.test(ref)) {
				checkVscodeLink(file, ref.slice('vscode://file/'.length));
			} else if (/^command:vscode\.open\?/i.test(ref)) {
				checkCommandLink(file, ref.slice('command:vscode.open?'.length));
			} else {
				checkRelative(file, ref);
			}
		}
	}

	const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.avif'];
	if (IMAGE_EXTS.includes(ext)) {
		const declared = /(\d+)x(\d+)/.exec(path.basename(file));
		if (!declared) {
			warn.push(`图片文件名里没有「宽x高」：${rel(file)}（无法自动核对尺寸）`);
			return;
		}
		const actual = imageSize(file);
		if (!actual) {
			fail.push(`无法解析图片头：${rel(file)}`);
			return;
		}
		const expected = { width: Number(declared[1]), height: Number(declared[2]) };
		if (actual.width !== expected.width || actual.height !== expected.height) {
			fail.push(`${rel(file)} 尺寸不符：文件名说 ${expected.width}x${expected.height}，实际 ${actual.width}x${actual.height}`);
			return;
		}
		pass.push(`${rel(file)} 尺寸 ${actual.width}x${actual.height} 与文件名一致`);
	}
}

for (const file of walk(ROOT)) {
	if (file.includes(`${path.sep}tools${path.sep}`) && !path.basename(file).startsWith('README')) {
		continue;
	}
	analyze(file);
}

console.log(`\n=== 素材自检 ${rel(ROOT)} ===\n`);
console.log(`通过 ${pass.length} 项`);
if (warn.length > 0) {
	console.log(`\n[WARN] ${warn.length} 项`);
	for (const item of warn) {
		console.log(`  - ${item}`);
	}
}
if (info.length > 0) {
	console.log(`\n[INFO] ${info.length} 条`);
	for (const item of info) {
		console.log(`  - ${item}`);
	}
}
if (fail.length > 0) {
	console.log(`\n[FAIL] ${fail.length} 项`);
	for (const item of fail) {
		console.log(`  ✗ ${item}`);
	}
	console.log('\n结果：失败');
	process.exit(1);
}
console.log('\n结果：全部通过');
