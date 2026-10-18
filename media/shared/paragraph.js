/**
 * 渲染块 ↔ Markdown 源码行的映射 —— 段落就地编辑的地基。
 *
 * 依据（已核实）：内置引擎给每个块级 token 写 `data-line`（= `token.map[0]`，0-based 起始行）
 * 并加 `class="code-line"`。在 1.137.0 的实际产物里找到的是这条 ruler：
 * `core.ruler.push("source_map_data_attribute", tokens => { … attrSet("data-line", String(token.map[0])) … })`。
 *
 * **末尾哨兵块**：内置**预览页**的 `renderBody` 会在正文末尾追加一个
 * `<div class="code-line" data-line="lineCount">`（起始行 = 源码总行数）。
 * 但那条路我们没走 —— 本扩展用的是 `markdown.api.render`，它的实现是
 * `execute(text) => (await engine.render(text)).html`，**既不包 `<div class="markdown-body">`
 * 也不追加哨兵**（页面把返回值直接放进 `<main id="wispkit-content">`）。
 *
 * 所以末段的结束行按 `totalLines` 兜底，而且这个兜底对**两种情形都成立**：
 * 区间是左闭右开 `[start, end)`，哨兵若真的出现，它的起始行恰好等于 `lineCount`，
 * 与 `totalLines` 是同一个数 —— 结果一致，不会因为哨兵有无而差一行。
 * 唯一的差别是哨兵会作为一个「块」进映射表，而它覆盖 `[lineCount, lineCount)` 零行；
 * `mapBlocksToSpans` 因此把零长度区间挡掉（见那里的注释），点它就不会开出空编辑框。
 *
 * 纯函数、无 DOM 依赖（只有一个读 `data-line` 的小工具），可在 node 里直接测。
 */

/** @typedef {{ startLine: number, endLine: number }} ParagraphSpan */
/** @typedef {{ element: any, span: ParagraphSpan }} BlockSpan */

/** 区间左闭右开：`[startLine, endLine)`。 */
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

function safeLineCount(totalLines) {
	return isFiniteNumber(totalLines) && totalLines > 0 ? Math.floor(totalLines) : 0;
}

/** 源码行数。与 `split('\n')` 同语义：空串算 1 行。 */
export function countLines(source) {
	return typeof source === 'string' ? source.split('\n').length : 0;
}

/**
 * 把「按 DOM 顺序排列的块起始行」折算成每个块覆盖的源码行区间。
 *
 * 返回数组**与入参等长**（不能落项的落 `null`），这样调用方按索引就能对上 DOM 元素 ——
 * 折叠掉重复项会让 DOM 与区间错位。
 *
 * - 结束行 = 向后第一个**严格更大**的起始行；都没有则取 `totalLines`
 * - 起始行非有限值（`data-line` 缺失/非法）→ 该项为 `null`
 * - 越界 → 夹到 `[0, totalLines]`
 * - 重复或倒退的起始行 → 与给出该值的块共享同一区间（不会产生重叠区间）
 */
export function paragraphSpans(startLines, totalLines) {
	const limit = safeLineCount(totalLines);
	const starts = Array.from(startLines ?? [], raw => (
		isFiniteNumber(raw) ? Math.max(0, Math.min(Math.floor(raw), limit)) : null
	));

	return starts.map((value, index) => {
		if (value === null) {
			return null;
		}
		let end = limit;
		for (let next = index + 1; next < starts.length; next += 1) {
			const candidate = starts[next];
			if (candidate !== null && candidate > value) {
				end = candidate;
				break;
			}
		}
		return { startLine: value, endLine: Math.max(value, end) };
	});
}

/**
 * 区间末尾有多少个空行。这些空行是「段与段之间的分隔」，属于区间但不属于段落内容 ——
 * 取原文时要剥掉（否则编辑框里会多出空行），写回时要补回来（否则改一段就把空行吃掉，
 * 整篇的段落会挤在一起）。
 */
function trailingBlankCount(lines, span) {
	let count = 0;
	for (let index = span.endLine - 1; index >= span.startLine; index -= 1) {
		if ((lines[index] ?? '').trim() === '') {
			count += 1;
		} else {
			break;
		}
	}
	return count;
}

function trimTrailingBlanks(lines) {
	const result = [...lines];
	while (result.length > 0 && result[result.length - 1].trim() === '') {
		result.pop();
	}
	return result;
}

/** 取某区间的源码原文（剥掉区间尾部的分隔空行）；区间非法或为空时返回空串。 */
export function sliceParagraph(source, span) {
	if (typeof source !== 'string' || !span) {
		return '';
	}
	const lines = source.split('\n');
	return trimTrailingBlanks(lines.slice(span.startLine, span.endLine)).join('\n');
}

/**
 * 用新文本替换某区间，返回新源码（不改动入参）。
 * 走「按行 splice」而不是字符串下标：段落边界本来就是行语义，按行替换不会因为
 * 行尾符差异（`\r\n` / 末尾有没有换行）而算错偏移。
 * 用户新内容里的尾随空行会被剥掉，再按原区间补回同样多的分隔空行。
 */
export function replaceParagraph(source, span, text) {
	if (typeof source !== 'string') {
		return '';
	}
	if (!span) {
		return source;
	}
	const lines = source.split('\n');
	const count = Math.max(0, Math.floor(span.endLine) - Math.floor(span.startLine));
	const blanks = trailingBlankCount(lines, span);
	const patch = trimTrailingBlanks(typeof text === 'string' ? text.split('\n') : []);
	const replacement = [...patch, ...Array.from({ length: blanks }, () => '')];
	lines.splice(Math.floor(span.startLine), count, ...replacement);
	return lines.join('\n');
}

/** 读出一个块的起始行；`data-line` 缺失或非法时返回 `null`。 */
export function blockStartLine(element) {
	const raw = element?.getAttribute?.('data-line');
	if (typeof raw !== 'string' || raw.trim() === '') {
		return null;
	}
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : null;
}

/**
 * 只保留「最外层的块」：嵌套块（列表项内部的段落、引用块内部的段落）本身也带
 * `data-line`，全都要会让同一段源码被切成好几份。判定就是「祖先里没有带 data-line 的元素」。
 */
export function outermostBlocks(elements) {
	const result = [];
	for (const element of elements ?? []) {
		let nested = false;
		let parent = element?.parentElement ?? null;
		while (parent) {
			if (typeof parent.hasAttribute === 'function' && parent.hasAttribute('data-line')) {
				nested = true;
				break;
			}
			parent = parent.parentElement ?? null;
		}
		if (!nested) {
			result.push(element);
		}
	}
	return result;
}

/**
 * 把 DOM 里的块元素折算成 `{ element, span }`：
 * 先取最外层块，再按 `data-line` 算区间，最后丢掉没有 `data-line` 的项
 * 与覆盖不到任何源码行的空块。
 */
export function mapBlocksToSpans(elements, totalLines) {
	const blocks = outermostBlocks(elements);
	const spans = paragraphSpans(blocks.map(blockStartLine), totalLines);

	const result = [];
	blocks.forEach((element, index) => {
		const span = spans[index];
		// 零长度区间（`[n, n)`）覆盖不到任何源码行 —— 典型来源是内置预览的末尾哨兵
		// （起始行 = 总行数，而兜底结束行也是总行数）。留着它只会让用户点出一个空编辑框。
		if (span && span.endLine > span.startLine) {
			result.push({ element, span });
		}
	});
	return result;
}

/**
 * 找出包含给定节点的那一项（段落就地编辑「点哪段改哪段」的入口）。
 * 从节点往上找最近的、能在映射表里查到的块，因此点段落内部的文字、图片、
 * 列表项都能落到正确的段上。
 */
export function findBlockSpan(items, node) {
	let current = node ?? null;
	while (current) {
		const hit = (items ?? []).find(item => item.element === current);
		if (hit) {
			return hit;
		}
		current = current.parentElement ?? null;
	}
	return null;
}

/**
 * 取某区间的源码原文，**连尾随的分隔空行一起**。
 *
 * 与 `sliceParagraph` 只差这一条：那个版本把尾随空行剥掉，于是编辑框里根本看不到空行，
 * 用户也就无从删除它（用户明确提过「建议空白的行也能编辑和去除」）。保留之后编辑框内容与
 * 区间原文一一对应：不动它就写回原样（见 `replaceParagraphVerbatim` 的说明），动了就照办。
 */
export function sliceParagraphVerbatim(source, span) {
	if (typeof source !== 'string' || !span) {
		return '';
	}
	return source.split('\n').slice(span.startLine, span.endLine).join('\n');
}

/**
 * 用新文本**原样**替换某区间 —— 不做「剥尾随空行、再补回同样多分隔空行」那套归一化。
 *
 * `replaceParagraph` 的归一化是为了防止"改一段就把段间空行吃掉"，但它同时让**删除空行变成
 * 不可能**（删了会被补回来）。段落编辑的编辑框现在展示区间的完整原文（含空行），所以这里按
 * 用户输入原样落地。用户不改空行时结果与原文逐字相同，`paragraph.commit` 的
 * `next === source` 判断会让这次提交走"无需保存"分支，不会白写一次磁盘。
 */
export function replaceParagraphVerbatim(source, span, text) {
	if (typeof source !== 'string') {
		return '';
	}
	if (!span) {
		return source;
	}
	const lines = source.split('\n');
	const start = Math.max(0, Math.floor(span.startLine));
	const count = Math.max(0, Math.floor(span.endLine) - start);
	const patch = typeof text === 'string' ? text.split('\n') : [];
	lines.splice(start, count, ...patch);
	return lines.join('\n');
}

/**
 * 在 `[fromLine, toLine)` 里找一段围栏代码块（``` 或 ~~~），返回它在源码里的行区间。
 *
 * 用途：mermaid / drawio / katex 这类块渲染后，前端脚本会把原本带 `data-line` 的 `<pre>`
 * 整个换掉（换成 `<div class="mermaid">` 加一段 svg），于是从 svg 往上找再也碰不到
 * `data-line`，编辑模式下点它们毫无反应。这时退一步：用在 DOM 里的前后邻居块夹出一个源码
 * 区间，再在区间里定位那段围栏，就能落回正确的段落。
 *
 * **只在区间里恰好找到一段围栏时返回它** —— 找到多段说明夹出来的区间不够精确，宁可放弃
 * 也不能猜错段落（那会把别处的代码写坏）。闭合行缺失时取区间末行。
 */
export function fenceSpanInRange(source, fromLine, toLine) {
	if (typeof source !== 'string') {
		return null;
	}
	const lines = source.split('\n');
	const from = Math.max(0, Math.min(Math.floor(fromLine ?? 0), lines.length));
	const to = Math.max(from, Math.min(Math.floor(toLine ?? 0), lines.length));
	const opener = /^\s*(`{3,}|~{3,})/;

	const fences = [];
	let openAt = -1;
	let marker = '';
	for (let index = from; index < to; index += 1) {
		const line = lines[index] ?? '';
		const match = opener.exec(line);
		if (openAt < 0) {
			if (match) {
				openAt = index;
				marker = match[1][0];
			}
			continue;
		}
		// 闭合行必须同种标记、长度不短于开启行，且标记之后没有别的字符（```js 是开启行）
		if (match && match[1][0] === marker && line.trim().slice(match[1].length).length === 0) {
			fences.push({ startLine: openAt, endLine: index + 1 });
			openAt = -1;
		}
	}
	if (openAt >= 0) {
		fences.push({ startLine: openAt, endLine: to });
	}

	return fences.length === 1 ? fences[0] : null;
}

/**
 * 这一行在源码里是不是「会被第三方脚本替换成渲染容器」的那个块的起始行？
 *
 * 两类：围栏代码块（``` / ~~~ —— mermaid 与 drawio 走这条）与块级公式（`$$`）。
 *
 * 用途是**自校验**：前端脚本替换块之后要把丢失的 `data-line` 搬到新容器上（见
 * `media/markdown.js` 的源映射接力），而配对万一错位，就会把行号安给别的段落 ——
 * 用户一改就把**别处的代码**写坏了。所以只认这两类起始行，其余一律放弃、退回邻居兜底。
 * （行内公式 `$x$` 的行首不是 `$$`，因此天然被挡在外面。）
 */
export function isRenderedBlockStartLine(source, line) {
	if (typeof source !== 'string' || !isFiniteNumber(line)) {
		return false;
	}
	const index = Math.floor(line);
	if (index < 0) {
		return false;
	}
	const text = source.split('\n')[index];
	if (typeof text !== 'string') {
		return false;
	}
	return /^\s*(`{3,}|~{3,})/.test(text) || /^\s*\$\$/.test(text);
}

/**
 * 从「已被移除、还没配到容器」的源映射队列里挑出第一个**通过自校验**的项，
 * 返回它在队列里的下标（供调用方 `splice` 掉）；没有合法项时返回 -1。
 *
 * 按先后顺序取第一个合法的，而不是「找最像的」：替换脚本移除块的顺序与它插入容器的顺序
 * 一致，所以同批（或分两批）配对天然一一对应。
 */
export function pickPendingSourceLine(source, pending) {
	const queue = Array.isArray(pending) ? pending : [];
	for (let index = 0; index < queue.length; index += 1) {
		if (isRenderedBlockStartLine(source, queue[index])) {
			return index;
		}
	}
	return -1;
}
