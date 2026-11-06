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
	/** 小写扩展名。前端据此决定 SVG 用矢量缩放、HEIF 等给出解码失败兜底。 */
	readonly format: string;
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
<body class="wispkit-image scale-to-fit" data-format="${escapeAttribute(options.format)}">
	<div class="wispkit-image-viewport" id="wispkit-image-viewport">
		<img id="wispkit-image" src="${escapeAttribute(options.imageSrc)}" alt="${escapeAttribute(options.title)}" draggable="false">
	</div>
	<div class="wispkit-image-error" id="wispkit-image-error" hidden>
		<div class="wispkit-image-error-card">
			<p class="wispkit-image-error-title" id="wispkit-image-error-title">图片无法显示</p>
			<p class="wispkit-image-error-detail" id="wispkit-image-error-detail"></p>
			<div class="wispkit-image-error-actions">
				<button type="button" id="wispkit-image-open-external" title="交给操作系统的默认看图应用">用系统默认应用打开</button>
				<button type="button" id="wispkit-image-copy-path" title="把图片的绝对路径复制到剪贴板">复制路径</button>
			</div>
		</div>
	</div>
	<div class="wispkit-image-hint" id="wispkit-image-hint"></div>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
