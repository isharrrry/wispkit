/**
 * 生成"批量型"素材（手写会很长、且需要改数字才能调规模的那两类）：
 *   R2-toc/05-many-headings.md   —— 大量标题，验证目录的滚动跟随与条目渲染
 *   R3-mermaid/04-many.md        —— 大量 Mermaid 图，验证批量渲染与 updateContent 重渲染
 *
 * 可重复运行（同参数产出同内容）。
 * 用法： node tools/gen-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const H2_COUNT = 15;
const H3_PER_H2 = 4;
const MERMAID_COUNT = 20;

function manyHeadings() {
	const lines = [
		'# R2-05 海量标题（验证滚动跟随）',
		'',
		'> **验证点**：目录条目很多时，滚动跟随是否还跟得上、点击是否还准。',
		'> **期望**：滚动右侧内容，左侧高亮**始终**指向"当前顶部那一段"对应的条目；',
		'> 条目栏自身如果被撑得比视口高，看它是**整栏滚动**还是**溢出被裁**（后者说明缺 `overflow: auto`）。',
		'> **规模**：由 `tools/gen-fixtures.mjs` 生成，本文件共 1 个 h1 + ' + H2_COUNT + ' 个 h2 + ' + H2_COUNT * H3_PER_H2 + ' 个 h3。',
		''
	];

	for (let i = 1; i <= H2_COUNT; i += 1) {
		const index = String(i).padStart(2, '0');
		lines.push(`## 第 ${index} 章`, '');
		lines.push(`第 ${index} 章的正文。滚到这里时，左侧应高亮「第 ${index} 章」。`, '');
		for (let j = 1; j <= H3_PER_H2; j += 1) {
			lines.push(`### 第 ${index} 章 · 小节 ${j}`, '');
			lines.push(`小节正文。三个填充段让页面足够长：`, '');
			lines.push(`- ${index}-${j} 第一行`, `- ${index}-${j} 第二行`, `- ${index}-${j} 第三行`, '');
			lines.push(`段落占位。段落占位。段落占位。段落占位。段落占位。段落占位。段落占位。`, '');
		}
	}

	lines.push('## 最后一章（末尾）', '');
	lines.push('滚到底时，高亮应停在「最后一章（末尾）」。', '');
	return lines.join('\n');
}

function manyMermaid() {
	const lines = [
		'# R3-04 批量 Mermaid（验证一次渲染 20 张）',
		'',
		'> **验证点**：多张图并存时，是否**每张都渲染**、是否互相干扰、是否拖慢滚动。',
		'> **期望**：下面 20 张全部是图形；没有哪几张退化成代码块。',
		'> **加练**：在文件末尾追加一个新 ```mermaid 块并保存 → 200ms 防抖后应**整篇重渲染**，',
		'> 新图出现、其余 20 张仍然正常（重渲染走 `wispkit.update` → `content.innerHTML` → 派发 `vscode.markdown.updateContent`）。',
		'> **规模**：由 `tools/gen-fixtures.mjs` 生成。',
		''
	];

	for (let i = 1; i <= MERMAID_COUNT; i += 1) {
		const index = String(i).padStart(2, '0');
		lines.push(`## 图 ${index}`, '');
		lines.push('```mermaid');
		lines.push(`flowchart LR`);
		lines.push(`  A${i}[图 ${index} 起点] --> B${i}{分支}`);
		lines.push(`  B${i} -->|左| C${i}[图 ${index} 左]`);
		lines.push(`  B${i} -->|右| D${i}[图 ${index} 右]`);
		lines.push('```', '');
	}

	return lines.join('\n');
}

const targets = [
	{ file: 'R2-toc/05-many-headings.md', content: manyHeadings() },
	{ file: 'R3-mermaid/04-many.md', content: manyMermaid() }
];

for (const target of targets) {
	const fullPath = path.join(ROOT, target.file);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, target.content, 'utf8');
	const lineCount = target.content.split('\n').length;
	console.log(`写入 ${target.file}（${lineCount} 行，${Buffer.byteLength(target.content, 'utf8')} 字节）`);
}
