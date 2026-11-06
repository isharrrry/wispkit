const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

const status = document.getElementById('wispkit-binary-status');
const form = document.getElementById('wispkit-binary-form');

function setStatus(text, level) {
	if (!status) {
		return;
	}
	status.textContent = text || '';
	status.dataset.level = level || 'info';
}

form?.addEventListener('submit', event => {
	event.preventDefault();
	const data = new FormData(form);
	const fields = {};
	for (const key of ['targetPath', 'arguments', 'workingDirectory', 'description']) {
		const value = data.get(key);
		if (typeof value === 'string') {
			fields[key] = value;
		}
	}
	setStatus('正在保存…');
	vscode?.postMessage({ type: 'wispkit.binary.save', fields });
});

for (const button of document.querySelectorAll('[data-wispkit-binary-action="openSystem"]')) {
	button.addEventListener('click', () => vscode?.postMessage({ type: 'wispkit.binary.openSystem' }));
}

window.addEventListener('message', event => {
	const message = event.data;
	if (message?.type === 'wispkit.binary.status') {
		setStatus(String(message.text ?? ''), message.level);
	}
});
