import { escapeAttribute, escapeHtml } from '../util/html';

/**
 * `.lnk` / `.exe` 的属性页。宿主侧把解析结果整理成分区块的表，页面只负责显示
 * 与（`.lnk` 的）简单编辑表单；没有前端渲染逻辑，改一个字段要落盘也走消息回宿主。
 */

export interface BinaryRow {
	readonly label: string;
	readonly value: string;
	/** 值的旁注，例如「原始值」「未解析」。 */
	readonly hint?: string;
}

export interface BinarySection {
	readonly title: string;
	readonly rows: readonly BinaryRow[];
}

export interface BinaryFormField {
	readonly key: 'targetPath' | 'arguments' | 'workingDirectory' | 'description';
	readonly label: string;
	readonly value: string;
	readonly placeholder: string;
	readonly multiline: boolean;
}

export interface BinaryEditForm {
	readonly fields: readonly BinaryFormField[];
	readonly note: string;
}

export interface BinaryPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	readonly kind: 'lnk' | 'pe';
	readonly subtitle: string;
	readonly sections: readonly BinarySection[];
	readonly notices: readonly string[];
	readonly error?: string;
	readonly form?: BinaryEditForm;
	/** 打开时状态栏的初始文案（保存后重绘用）。 */
	readonly statusText?: string;
	readonly statusLevel?: 'ok' | 'error' | 'info';
}

function renderRow(row: BinaryRow): string {
	const hint = row.hint ? `<span class="wispkit-binary-hint">${escapeHtml(row.hint)}</span>` : '';
	return `<tr><th scope="row">${escapeHtml(row.label)}</th><td><code>${escapeHtml(row.value)}</code>${hint}</td></tr>`;
}

function renderSection(section: BinarySection): string {
	return `<section class="wispkit-binary-section">
	<h2>${escapeHtml(section.title)}</h2>
	<table><tbody>${section.rows.map(renderRow).join('')}</tbody></table>
</section>`;
}

function renderField(field: BinaryFormField): string {
	const id = `wispkit-binary-field-${field.key}`;
	if (field.multiline) {
		return `<label class="wispkit-binary-field" for="${id}"><span>${escapeHtml(field.label)}</span>
<textarea id="${id}" name="${field.key}" rows="2" placeholder="${escapeAttribute(field.placeholder)}" spellcheck="false">${escapeHtml(field.value)}</textarea></label>`;
	}
	return `<label class="wispkit-binary-field" for="${id}"><span>${escapeHtml(field.label)}</span>
<input id="${id}" name="${field.key}" type="text" value="${escapeAttribute(field.value)}" placeholder="${escapeAttribute(field.placeholder)}" spellcheck="false"></label>`;
}

function renderForm(form: BinaryEditForm, statusText: string, statusLevel: string): string {
	return `<section class="wispkit-binary-edit">
	<h2>编辑快捷方式</h2>
	<p class="wispkit-binary-note">${escapeHtml(form.note)}</p>
	<form id="wispkit-binary-form">${form.fields.map(renderField).join('')}
		<div class="wispkit-binary-actions">
			<button type="submit" id="wispkit-binary-save">保存</button>
			<button type="button" id="wispkit-binary-open-system" data-wispkit-binary-action="openSystem">用系统方式打开</button>
		</div>
	</form>
	<p class="wispkit-binary-status" id="wispkit-binary-status" data-level="${escapeAttribute(statusLevel)}" role="status">${escapeHtml(statusText)}</p>
</section>`;
}

export function renderBinaryPage(options: BinaryPageOptions): string {
	const notices = options.notices.length > 0
		? `<ul class="wispkit-binary-notices">${options.notices.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
		: '';
	const error = options.error
		? `<div class="wispkit-binary-error" id="wispkit-binary-error"><p>${escapeHtml(options.error)}</p>
			<div class="wispkit-binary-actions"><button type="button" id="wispkit-binary-open-system" data-wispkit-binary-action="openSystem">用系统方式打开</button></div></div>`
		: '';
	const body = options.error
		? error
		: `${notices}${options.sections.map(renderSection).join('')}${options.form ? renderForm(options.form, options.statusText ?? '', options.statusLevel ?? 'info') : ''}`;
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-binary" data-kind="${escapeAttribute(options.kind)}" data-title="${escapeAttribute(options.title)}">
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body class="wispkit-binary" data-kind="${escapeAttribute(options.kind)}">
	<header class="wispkit-binary-head">
		<h1>${escapeHtml(options.title)}</h1>
		<p class="wispkit-binary-subtitle">${escapeHtml(options.subtitle)}</p>
	</header>
	<main class="wispkit-binary-body">${body}</main>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}"></script>
</body>
</html>`;
}
