import { escapeAttribute, escapeHtml } from '../util/html';

export interface VideoPageOptions {
	readonly title: string;
	readonly csp: string;
	readonly nonce: string;
	readonly videoSrc: string;
	readonly runtimeScript: string;
	readonly runtimeStyle: string;
	/** 小写扩展名，用于提示与自检。 */
	readonly format: string;
}

/**
 * 视频页：交给 Chromium 原生 `<video>` 解码，不自带播放器、不引第三方库。
 * 容器 / 编码不受支持时由前端显示兜底面板，按钮消息交给宿主用系统播放器打开。
 */
export function renderVideoPage(options: VideoPageOptions): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
	<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(options.csp)}">
	<title>${escapeHtml(options.title)}</title>
	<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.runtimeStyle)}">
</head>
<body class="wispkit-video" data-format="${escapeAttribute(options.format)}">
	<div class="wispkit-video-toolbar">
		<span class="wispkit-video-title" title="${escapeAttribute(options.title)}">${escapeHtml(options.title)}</span>
		<button type="button" id="wispkit-video-open-external" title="交给操作系统的默认播放器">系统播放器打开</button>
		<button type="button" id="wispkit-video-copy-path" title="把视频的绝对路径复制到剪贴板">复制路径</button>
	</div>
	<div class="wispkit-video-stage" id="wispkit-video-stage">
		<video id="wispkit-video" src="${escapeAttribute(options.videoSrc)}" controls preload="metadata" playsinline draggable="false"></video>
		<div class="wispkit-video-error" id="wispkit-video-error" hidden>
			<div class="wispkit-video-error-card">
				<p class="wispkit-video-error-title" id="wispkit-video-error-title">无法播放这个视频</p>
				<p class="wispkit-video-error-detail" id="wispkit-video-error-detail"></p>
				<p class="wispkit-video-error-hint">可以点右上角「系统播放器打开」，或用其它工具转码成 MP4（H.264 / AAC）后再浏览。</p>
			</div>
		</div>
	</div>
	<div class="wispkit-video-hint" id="wispkit-video-hint"></div>
	<script src="${escapeAttribute(options.runtimeScript)}" nonce="${options.nonce}" charset="UTF-8"></script>
</body>
</html>`;
}
