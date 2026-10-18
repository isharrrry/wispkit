import { escapeAttribute, escapeHtml } from '../util/html';

export interface ImageViewConfig {
	readonly wheelZoom: boolean;
	readonly wheelStep: number;
	readonly dragButton: 'left' | 'right' | 'middle';
}

export interface ImagePageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly imageSrc: string;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	readonly config: ImageViewConfig;
}

export function renderImagePage(options: ImagePageOptions): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<meta id="wispkit-config" data-settings="${escapeAttribute(JSON.stringify(options.config))}">
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body class="wispkit-image scale-to-fit">
	<div class="wispkit-image-viewport" id="wispkit-image-viewport">
		<img id="wispkit-image" src="${escapeAttribute(options.imageSrc)}" alt="${escapeAttribute(options.title)}" draggable="false">
	</div>
	<div class="wispkit-image-hint" id="wispkit-image-hint"></div>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
