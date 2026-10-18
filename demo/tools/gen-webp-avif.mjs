/**
 * 把 assets/images 里的 PNG 转成 WebP / AVIF。
 *
 * 为什么单独一个脚本：本机没有系统级图像编码器（无 ImageMagick、无 cwebp、无 avifenc），
 * 所以这两张格式依赖 npm 的 sharp。sharp 是**可选**依赖——没装时这个脚本会明确告诉你，
 * 而 check-fixtures.mjs 也只把缺 webp/avif 记为 WARN，不影响其余素材的验证。
 *
 * 用法：
 *   cd tools
 *   npm install sharp      # 或 npm install（本目录有 package.json）
 *   node gen-webp-avif.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'assets', 'images');

const require = createRequire(import.meta.url);
let sharp;
try {
	sharp = require('sharp');
} catch {
	console.error('找不到 sharp。先在 tools 目录执行： npm install sharp');
	process.exit(1);
}

const jobs = [
	{ from: 'grid-4000x3000.png', to: 'grid-4000x3000.webp' },
	{ from: 'grid-4000x3000.png', to: 'grid-4000x3000.avif' }
];

for (const job of jobs) {
	const source = path.join(IMAGES, job.from);
	const target = path.join(IMAGES, job.to);
	if (!fs.existsSync(source)) {
		console.error(`跳过 ${job.to}：源文件 ${job.from} 不存在`);
		process.exitCode = 1;
		continue;
	}

	const pipeline = sharp(source);
	if (job.to.endsWith('.webp')) {
		pipeline.webp({ quality: 80 });
	} else {
		pipeline.avif({ quality: 55 });
	}

	await pipeline.toFile(target);
	const size = fs.statSync(target).size;
	const meta = await sharp(target).metadata();
	console.log(`${job.to}  ${meta.width}x${meta.height}  ${size.toLocaleString()} 字节  （源 ${job.from}）`);
}
