// Documentation consistency check: frontmatter, three-language completeness,
// relative links and anchors. No dependencies, plain Node.
// Usage: node tools/docs-check.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const problems = [];

function slug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{Nd}\s\-_]/gu, '')
    .replace(/\s+/gu, '-');
}

function headingsOf(file) {
  const set = new Set();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) set.add(slug(m[2]));
  }
  return set;
}

// 1. frontmatter: every docs/*.md must carry a non-empty type
const docFiles = readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
for (const f of docFiles) {
  const head = readFileSync(join(docsDir, f), 'utf8').split('\n').slice(0, 10).join('\n');
  if (!/^---$/m.test(head) || !/^type:\s*\S+/m.test(head)) {
    problems.push(`${f}: missing YAML frontmatter or an empty type`);
  }
}

// 2. three-language completeness
const topics = new Set(docFiles.filter((f) => !f.includes('.zh-CN.') && !f.includes('.es.')).map((f) => f.replace(/\.md$/, '')));
for (const topic of topics) {
  for (const variant of ['.md', '.zh-CN.md', '.es.md']) {
    if (!existsSync(join(docsDir, topic + variant))) problems.push(`docs/${topic}${variant}: missing language variant`);
  }
}
for (const f of docFiles) {
  const base = f.replace(/\.(zh-CN|es)\.md$/, '.md');
  if (base !== f && !existsSync(join(docsDir, base))) problems.push(`docs/${f}: counterpart ${base} does not exist`);
}

// 3. relative links and anchors (inline code and fenced blocks are ignored)
const slugCache = new Map();
function slugsFor(file) {
  if (!slugCache.has(file)) slugCache.set(file, headingsOf(file));
  return slugCache.get(file);
}

const linkSources = docFiles.map((f) => join(docsDir, f));
for (const name of ['README.md', 'README.zh-CN.md', 'README.es.md']) {
  const p = join(root, name);
  if (existsSync(p)) linkSources.push(p);
}

for (const file of linkSources) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let insideFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) insideFence = !insideFence;
    if (insideFence) return;
    const cleaned = line.replace(/`[^`]*`/g, '');
    for (const m of cleaned.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|command:|#)/.test(target)) continue;
      const [pathPart, anchor] = target.split('#');
      const abs = pathPart ? resolve(dirname(file), pathPart) : file;
      if (!existsSync(abs)) {
        problems.push(`${file.slice(root.length + 1)}:${i + 1}: link target not found -> ${target}`);
        continue;
      }
      if (anchor && !slugsFor(abs).has(anchor.toLowerCase())) {
        problems.push(`${file.slice(root.length + 1)}:${i + 1}: anchor not found in ${pathPart || 'this file'} -> ${target}`);
      }
    }
  });
}

if (problems.length === 0) {
  console.log(`docs-check: OK (${docFiles.length} docs, ${topics.size} topics x 3 languages)`);
} else {
  console.log(`docs-check: ${problems.length} problem(s)`);
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
}
