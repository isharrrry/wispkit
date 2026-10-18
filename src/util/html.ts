export function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function escapeHtml(value: string): string {
	return escapeAttribute(value).replace(/'/g, '&#39;');
}
