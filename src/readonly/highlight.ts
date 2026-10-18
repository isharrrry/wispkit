/**
 * 只读视图的通用语法高亮。
 *
 * 只读视图走 `CustomEditorProvider`（**不创建 TextDocument**），因此拿不到 VS Code 的语法着色，
 * 只能自研。零第三方运行时依赖、纯函数、可单测。
 *
 * 与 `src/xaml/highlight.ts` 的分工：那一份只服务 XAML / C# 两种语言，且叠在 textarea 下面，
 * 要求输出与输入**逐字符相同**（错一个字符光标就串位）；这一份要覆盖
 * `wispkit.readonly.extensions` 默认那 61 种扩展名，按"语法族"分组，同样保证
 * **token 拼接 === 原文**（否则行号与正文会错行）。
 */

import { escapeHtml } from '../util/html';

export type HighlightKind =
	| 'plain'
	| 'comment'
	| 'string'
	| 'number'
	| 'keyword'
	| 'type'
	/** JSON / YAML / INI 的键名 */
	| 'key'
	| 'tag'
	| 'attr'
	| 'added'
	| 'removed';

export interface HighlightToken {
	readonly kind: HighlightKind;
	readonly text: string;
}

export type ReadonlySyntax =
	| 'json'
	| 'xml'
	| 'yaml'
	| 'ini'
	| 'clike'
	| 'shell'
	| 'python'
	| 'sql'
	| 'diff'
	| 'text';

/** 超过这个长度只出行号、不着色：整篇扫描在大文件上会拖慢首屏。 */
export const MAX_HIGHLIGHT_LENGTH = 200000;

const EXTENSION_SYNTAX: Readonly<Record<string, ReadonlySyntax>> = {
	json: 'json', jsonc: 'json', json5: 'json',
	xml: 'xml', xsd: 'xml', svg: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml',
	csproj: 'xml', vbproj: 'xml', props: 'xml', targets: 'xml', nuspec: 'xml', resx: 'xml', config: 'xml',
	yml: 'yaml', yaml: 'yaml',
	ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', editorconfig: 'ini', env: 'ini', toml: 'ini',
	ts: 'clike', tsx: 'clike', mts: 'clike', cts: 'clike', js: 'clike', jsx: 'clike', mjs: 'clike', cjs: 'clike',
	cs: 'clike', fs: 'clike', vb: 'clike', java: 'clike', kt: 'clike', kts: 'clike', go: 'clike', rs: 'clike',
	c: 'clike', h: 'clike', cc: 'clike', cpp: 'clike', cxx: 'clike', hpp: 'clike', hh: 'clike', m: 'clike', mm: 'clike',
	css: 'clike', scss: 'clike', less: 'clike', styl: 'clike', vue: 'clike', svelte: 'clike', gradle: 'clike',
	php: 'clike', swift: 'clike', dart: 'clike', scala: 'clike', groovy: 'clike', lua: 'clike',
	sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', psm1: 'shell', bat: 'shell', cmd: 'shell',
	py: 'python', pyw: 'python', pyi: 'python',
	sql: 'sql',
	diff: 'diff', patch: 'diff',
};

/** 无扩展名的常见文件名（Makefile / Dockerfile 之类）。 */
const FILENAME_SYNTAX: Readonly<Record<string, ReadonlySyntax>> = {
	makefile: 'shell', dockerfile: 'shell', '.bashrc': 'shell', '.zshrc': 'shell',
	'.gitignore': 'text', '.editorconfig': 'ini', '.env': 'ini',
};

export function detectSyntax(fileName: string): ReadonlySyntax {
	const base = fileName.replace(/^.*[\\/]/, '').toLowerCase();
	const dot = base.lastIndexOf('.');
	if (dot <= 0) {
		return FILENAME_SYNTAX[base] ?? 'text';
	}
	return EXTENSION_SYNTAX[base.slice(dot + 1)] ?? 'text';
}

interface SyntaxSpec {
	readonly lineComments: readonly string[];
	readonly blockComments: readonly (readonly [string, string])[];
	readonly quotes: readonly string[];
	readonly keywords: ReadonlySet<string>;
	/** Python 的三引号字符串。 */
	readonly tripleQuotes: boolean;
	/** SQL 之类惯用大写的语言：关键字集合按小写存，匹配时把词也转小写。 */
	readonly keywordCaseInsensitive?: boolean;
}

const CLikeKeywords = new Set([
	'abstract', 'as', 'async', 'await', 'base', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
	'delegate', 'delete', 'do', 'else', 'enum', 'event', 'export', 'extends', 'extern', 'false', 'finally', 'for',
	'foreach', 'from', 'function', 'get', 'goto', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
	'internal', 'is', 'let', 'namespace', 'new', 'null', 'of', 'operator', 'out', 'override', 'package', 'params',
	'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sealed', 'set', 'static', 'struct', 'super',
	'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'unsafe', 'using', 'var', 'virtual',
	'void', 'while', 'yield',
]);

const ShellKeywords = new Set([
	'break', 'case', 'continue', 'do', 'done', 'elif', 'else', 'esac', 'exit', 'export', 'fi', 'for', 'function',
	'if', 'in', 'local', 'readonly', 'return', 'select', 'set', 'shift', 'source', 'then', 'time', 'trap', 'until',
	'while', 'param', 'begin', 'process', 'end', 'filter', 'foreach', 'throw', 'try', 'catch', 'finally',
]);

const PythonKeywords = new Set([
	'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
	'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not',
	'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield', 'self', 'match', 'case',
]);

const SqlKeywords = new Set([
	'add', 'all', 'alter', 'and', 'as', 'asc', 'begin', 'between', 'by', 'case', 'cast', 'column', 'commit',
	'constraint', 'create', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exec', 'exists', 'from', 'full',
	'group', 'having', 'if', 'in', 'index', 'inner', 'insert', 'into', 'is', 'join', 'key', 'left', 'like', 'limit',
	'not', 'null', 'on', 'or', 'order', 'outer', 'primary', 'procedure', 'references', 'right', 'rollback', 'select',
	'set', 'table', 'then', 'top', 'transaction', 'union', 'unique', 'update', 'values', 'view', 'when', 'where',
]);

const SPECS: Readonly<Record<Exclude<ReadonlySyntax, 'xml' | 'diff' | 'text'>, SyntaxSpec>> = {
	json: { lineComments: ['//'], blockComments: [['/*', '*/']], quotes: ['"'], keywords: new Set(['true', 'false', 'null']), tripleQuotes: false },
	yaml: { lineComments: ['#'], blockComments: [], quotes: ['"', "'"], keywords: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']), tripleQuotes: false },
	ini: { lineComments: ['#', ';'], blockComments: [], quotes: ['"', "'"], keywords: new Set(['true', 'false', 'yes', 'no', 'on', 'off']), tripleQuotes: false },
	clike: { lineComments: ['//'], blockComments: [['/*', '*/']], quotes: ['"', "'", '`'], keywords: CLikeKeywords, tripleQuotes: false },
	shell: { lineComments: ['#'], blockComments: [['<#', '#>']], quotes: ['"', "'"], keywords: ShellKeywords, tripleQuotes: false },
	python: { lineComments: ['#'], blockComments: [], quotes: ['"', "'"], keywords: PythonKeywords, tripleQuotes: true },
	sql: { lineComments: ['--'], blockComments: [['/*', '*/']], quotes: ["'", '"'], keywords: SqlKeywords, tripleQuotes: false, keywordCaseInsensitive: true },
};

const WORD = /^[A-Za-z_$][\w$]*/;
const NUMBER = /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/;

function scanStandard(code: string, spec: SyntaxSpec): HighlightToken[] {
	const tokens: HighlightToken[] = [];
	let plain = '';
	let index = 0;
	let lineStart = true;

	const flush = (): void => {
		if (plain) {
			tokens.push({ kind: 'plain', text: plain });
			plain = '';
		}
	};
	const push = (kind: HighlightKind, text: string): void => {
		flush();
		tokens.push({ kind, text });
	};
	const literal = (text: string): void => {
		flush();
		if (text) {
			tokens.push({ kind: 'plain', text });
		}
	};

	while (index < code.length) {
		const rest = code.slice(index);
		const char = code[index];

		if (char === '\n') {
			literal('\n');
			index += 1;
			lineStart = true;
			continue;
		}

		// 行注释
		const lineComment = spec.lineComments.find(marker => rest.startsWith(marker));
		if (lineComment) {
			const end = rest.indexOf('\n');
			const text = end === -1 ? rest : rest.slice(0, end);
			push('comment', text);
			index += text.length;
			continue;
		}

		// 块注释
		const block = spec.blockComments.find(([open]) => rest.startsWith(open));
		if (block) {
			const closeAt = rest.indexOf(block[1], block[0].length);
			const text = closeAt === -1 ? rest : rest.slice(0, closeAt + block[1].length);
			push('comment', text);
			index += text.length;
			continue;
		}

		// Python 三引号
		if (spec.tripleQuotes && (rest.startsWith('"""') || rest.startsWith("'''"))) {
			const fence = rest.slice(0, 3);
			const closeAt = rest.indexOf(fence, 3);
			const text = closeAt === -1 ? rest : rest.slice(0, closeAt + 3);
			push('string', text);
			index += text.length;
			continue;
		}

		// 字符串（含 `\` 转义；不跨行，未闭合也吃掉本行剩下的部分）
		if (spec.quotes.includes(char)) {
			let cursor = index + 1;
			while (cursor < code.length) {
				const current = code[cursor];
				if (current === '\\') {
					cursor += 2;
					continue;
				}
				if (current === '\n') {
					break;
				}
				cursor += 1;
				if (current === char) {
					break;
				}
			}
			push('string', code.slice(index, cursor));
			index = cursor;
			continue;
		}

		// 数字
		const number = NUMBER.exec(rest);
		if (number && /[\d]/.test(char)) {
			push('number', number[0]);
			index += number[0].length;
			continue;
		}

		// 标识符
		const word = WORD.exec(rest);
		if (word && !/[\d]/.test(char)) {
			const text = word[0];
			let kind: HighlightKind = 'plain';
			if (spec.keywords.has(text) || (spec.keywordCaseInsensitive === true && spec.keywords.has(text.toLowerCase()))) {
				kind = 'keyword';
			} else if (text === 'true' || text === 'false' || text === 'null') {
				kind = 'keyword';
			} else if (lineStart && /^[A-Za-z_$][\w$]*$/.test(text)) {
				// 行首标识符后跟 `:` 或 `=` → 键名（YAML / INI）
				const after = code.slice(index + text.length);
				if (/^\s*[:=]/.test(after)) {
					kind = 'key';
				}
			}
			if (kind === 'plain') {
				literal(text);
			} else {
				push(kind, text);
			}
			index += text.length;
			if (!/^\s*$/.test(text)) {
				lineStart = false;
			}
			continue;
		}

		literal(char);
		index += 1;
		if (!/\s/.test(char)) {
			lineStart = false;
		}
	}

	flush();
	return tokens;
}

const XML_OPEN = /^<\/?[A-Za-z_][\w.:-]*/;
const XML_CLOSE = /^\/?>/;
const XML_ATTR = /^[A-Za-z_][\w.:-]*(?=\s*=)/;
const XML_STRING = /^(?:"[^"]*"|'[^']*')/;

function scanXml(code: string): HighlightToken[] {
	const tokens: HighlightToken[] = [];
	let plain = '';
	let index = 0;
	let inTag = false;

	const flush = (): void => {
		if (plain) {
			tokens.push({ kind: 'plain', text: plain });
			plain = '';
		}
	};
	const push = (kind: HighlightKind, text: string): void => {
		flush();
		tokens.push({ kind, text });
	};

	while (index < code.length) {
		const rest = code.slice(index);
		let match: RegExpExecArray | null = null;
		let kind: HighlightKind | null = null;

		if ((match = /^<!--[\s\S]*?(?:-->|$)/.exec(rest))) {
			kind = 'comment';
		} else if ((match = /^<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/.exec(rest))) {
			kind = 'string';
		} else if ((match = /^<!DOCTYPE[^>]*>/i.exec(rest))) {
			kind = 'keyword';
		} else if ((match = /^<\?[\s\S]*?(?:\?>|$)/.exec(rest))) {
			kind = 'keyword';
		} else if (!inTag && (match = XML_OPEN.exec(rest))) {
			kind = 'tag';
		} else if (inTag && (match = XML_CLOSE.exec(rest))) {
			kind = 'tag';
		} else if (inTag && (match = XML_ATTR.exec(rest))) {
			kind = 'attr';
		} else if (inTag && (match = XML_STRING.exec(rest))) {
			kind = 'string';
		}

		if (!match || !kind) {
			plain += code[index];
			index += 1;
			continue;
		}
		push(kind, match[0]);
		index += match[0].length;
		if (kind === 'tag') {
			inTag = !XML_CLOSE.test(match[0]);
		}
	}

	flush();
	return tokens;
}

/** diff / patch：按行首决定整行着色，`+` 绿 `-` 红 `@@` 蓝。 */
function scanDiff(code: string): HighlightToken[] {
	const tokens: HighlightToken[] = [];
	const lines = code.split('\n');
	lines.forEach((line, position) => {
		const isLast = position === lines.length - 1;
		const text = isLast ? line : `${line}\n`;
		if (!text) {
			return;
		}
		let kind: HighlightKind = 'plain';
		if (line.startsWith('+++') || line.startsWith('---')) {
			kind = 'keyword';
		} else if (line.startsWith('@@')) {
			kind = 'keyword';
		} else if (line.startsWith('+')) {
			kind = 'added';
		} else if (line.startsWith('-')) {
			kind = 'removed';
		} else if (line.startsWith('diff ') || line.startsWith('index ')) {
			kind = 'comment';
		}
		tokens.push({ kind, text });
	});
	return tokens;
}

export function tokenize(text: string, syntax: ReadonlySyntax): HighlightToken[] {
	if (syntax === 'text' || text.length > MAX_HIGHLIGHT_LENGTH) {
		return text ? [{ kind: 'plain', text }] : [];
	}
	if (syntax === 'xml') {
		return scanXml(text);
	}
	if (syntax === 'diff') {
		return scanDiff(text);
	}
	const tokens = scanStandard(text, SPECS[syntax]);
	return syntax === 'json' ? markJsonKeys(tokens) : tokens;
}

/**
 * JSON 的键名：字符串 token 后紧跟 `:` 时改成 `key`。
 * 放在后处理里做，免得主扫描器为了这一个特例长出一堆状态。
 */
function markJsonKeys(tokens: readonly HighlightToken[]): HighlightToken[] {
	return tokens.map((token, position) => {
		if (token.kind !== 'string') {
			return token;
		}
		const next = tokens[position + 1];
		if (next && next.kind === 'plain' && /^\s*:/.test(next.text)) {
			return { kind: 'key', text: token.text };
		}
		return token;
	});
}

export function highlightToHtml(text: string, syntax: ReadonlySyntax): string {
	const tokens = tokenize(text, syntax);
	const resolved = syntax === 'json' ? markJsonKeys(tokens) : tokens;
	return resolved
		.map(token => (token.kind === 'plain'
			? escapeHtml(token.text)
			: `<span class="wispkit-hl-${token.kind}">${escapeHtml(token.text)}</span>`))
		.join('');
}
