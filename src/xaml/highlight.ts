/**
 * `.xaml` / `.xaml.cs` 的轻量语法高亮。
 *
 * 零第三方依赖：按顺序扫描 + 少量正则。高亮层与 textarea 叠放（textarea 文字透明、
 * 只留光标），所以这里只要保证「输出的可见字符与输入逐字相同」——多一个少一个字符，
 * 光标就会和显示的文字错位。
 */

import { escapeHtml } from '../util/html';

export type HighlightKind =
	| 'plain'
	| 'comment'
	| 'cdata'
	| 'doctype'
	| 'preproc'
	| 'tag'
	| 'attr'
	| 'string'
	| 'text'
	| 'keyword'
	| 'type'
	| 'number'
	| 'attribute';

export interface HighlightToken {
	readonly kind: HighlightKind;
	readonly text: string;
}

export type HighlightLanguage = 'xaml' | 'csharp';

/** 超过这个长度就整篇按纯文本输出：每次按键重算整篇在大文件上会卡住输入。 */
const MAX_HIGHLIGHT_LENGTH = 120000;

const XAML_OPEN = /^<\/?[A-Za-z_][\w.:-]*/;
const XAML_CLOSE = /^\/?>/;
const XAML_ATTR = /^[A-Za-z_][\w.:-]*(?=\s*=)/;
const XAML_STRING = /^(?:"[^"]*"|'[^']*')/;
const XAML_ENTITY = /^&[A-Za-z#][\w#]*;/;

export function tokenizeXaml(code: string): HighlightToken[] {
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
			kind = 'cdata';
		} else if ((match = /^<!DOCTYPE[^>]*>/i.exec(rest))) {
			kind = 'doctype';
		} else if ((match = /^<\?[\s\S]*?(?:\?>|$)/.exec(rest))) {
			kind = 'preproc';
		} else if (!inTag && (match = XAML_OPEN.exec(rest))) {
			kind = 'tag';
		} else if (inTag && (match = XAML_CLOSE.exec(rest))) {
			kind = 'tag';
		} else if (inTag && (match = XAML_ATTR.exec(rest))) {
			kind = 'attr';
		} else if (inTag && (match = XAML_STRING.exec(rest))) {
			kind = 'string';
		} else if (!inTag && (match = XAML_ENTITY.exec(rest))) {
			kind = 'text';
		}

		if (!match || !kind) {
			plain += code[index];
			index += 1;
			continue;
		}

		push(kind, match[0]);
		index += match[0].length;
		if (kind === 'tag') {
			// 只有「开标签」进入标签内部状态；`/>` 与 `>` 都会把它关掉
			inTag = !XAML_CLOSE.test(match[0]);
		}
	}

	flush();
	return tokens;
}

const CSHARP_KEYWORDS = new Set([
	'abstract', 'add', 'as', 'async', 'await', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char',
	'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else',
	'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'get',
	'goto', 'if', 'implicit', 'in', 'init', 'int', 'interface', 'internal', 'is', 'lock', 'long',
	'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'partial', 'private',
	'protected', 'public', 'readonly', 'record', 'ref', 'remove', 'return', 'sbyte', 'sealed', 'set',
	'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true',
	'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'var', 'virtual', 'void',
	'volatile', 'when', 'where', 'while', 'yield',
]);

const CSHARP_STRING = /^(?:@\$|\$@|\$|@)?"(?:""|\\.|[^"\\])*(?:"|$)/;
const CSHARP_CHAR = /^'(?:\\.|[^'\\])*(?:'|$)/;
const CSHARP_NUMBER = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[fFdDmMuUlL]{0,3}/;
const CSHARP_IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

/** 行首（只允许前置空白）才算预处理指令与特性 —— 否则数组索引 `a[0]` 会被当成特性。 */
function isLineStart(code: string, index: number): boolean {
	for (let i = index - 1; i >= 0; i--) {
		const character = code[i];
		if (character === '\n') {
			return true;
		}
		if (character !== ' ' && character !== '\t' && character !== '\r') {
			return false;
		}
	}
	return true;
}

export function tokenizeCSharp(code: string): HighlightToken[] {
	const tokens: HighlightToken[] = [];
	let plain = '';
	let index = 0;

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

		if ((match = /^\/\/[^\n]*/.exec(rest))) {
			kind = 'comment';
		} else if ((match = /^\/\*[\s\S]*?(?:\*\/|$)/.exec(rest))) {
			kind = 'comment';
		} else if (isLineStart(code, index) && (match = /^#[a-zA-Z]+[^\n]*/.exec(rest))) {
			kind = 'preproc';
		} else if (isLineStart(code, index) && (match = /^\[[A-Z][A-Za-z0-9_.]*(?:\([^)\n]*\))?\]/.exec(rest))) {
			kind = 'attribute';
		} else if ((match = CSHARP_STRING.exec(rest))) {
			kind = 'string';
		} else if ((match = CSHARP_CHAR.exec(rest))) {
			kind = 'string';
		} else if ((match = CSHARP_NUMBER.exec(rest))) {
			kind = 'number';
		} else if ((match = CSHARP_IDENT.exec(rest))) {
			if (CSHARP_KEYWORDS.has(match[0])) {
				kind = 'keyword';
			} else if (/^[A-Z]/.test(match[0])) {
				kind = 'type';
			}
		}

		if (!match) {
			plain += code[index];
			index += 1;
			continue;
		}

		if (kind) {
			push(kind, match[0]);
		} else {
			// 普通标识符：并入 plain，少一层 span
			plain += match[0];
		}
		index += match[0].length;
	}

	flush();
	return tokens;
}

export function tokenize(code: string, language: HighlightLanguage): HighlightToken[] {
	return language === 'csharp' ? tokenizeCSharp(code) : tokenizeXaml(code);
}

/**
 * 输出可安全内嵌到 `<pre>` 的 HTML。
 * 每个 token 都整体转义 —— 源码里的 `<`、`&`、`>` 绝不能变成可执行的 HTML。
 */
export function highlightToHtml(code: string, language: HighlightLanguage): string {
	if (code.length > MAX_HIGHLIGHT_LENGTH) {
		return escapeHtml(code);
	}

	return tokenize(code, language)
		.map(token => (token.kind === 'plain'
			? escapeHtml(token.text)
			: `<span class="wispkit-hl-${token.kind}">${escapeHtml(token.text)}</span>`))
		.join('');
}
