const format = (document.body?.dataset?.format || '').toLowerCase();
const video = document.getElementById('wispkit-video');
const errorPanel = document.getElementById('wispkit-video-error');
const errorTitle = document.getElementById('wispkit-video-error-title');
const errorDetail = document.getElementById('wispkit-video-error-detail');
const hint = document.getElementById('wispkit-video-hint');

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const post = type => vscode?.postMessage({ type });

const ERROR_MESSAGES = {
	1: '播放被中止。',
	2: '视频读取失败：文件不可访问，或读取过程中断。',
	3: '视频解码失败：文件可能已损坏，或编码不受当前内核支持。',
	4: '当前 webview 内核不支持这个视频的容器或编码（常见于 MKV / AVI / WMV / FLV / RMVB，或 H.265 等编码）。',
};

function formatDuration(value) {
	if (!Number.isFinite(value) || value <= 0) {
		return '未知时长';
	}
	const total = Math.round(value);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const mm = String(minutes).padStart(2, '0');
	const ss = String(seconds).padStart(2, '0');
	return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function showError() {
	const code = video?.error?.code;
	if (errorTitle) {
		errorTitle.textContent = `${format ? format.toUpperCase() : '视频'} 无法播放`;
	}
	if (errorDetail) {
		errorDetail.textContent = ERROR_MESSAGES[code] ?? '视频加载失败：请尝试用系统默认播放器打开。';
	}
	if (errorPanel) {
		errorPanel.hidden = false;
	}
	if (hint) {
		hint.textContent = '播放失败';
	}
}

function onLoadedMetadata() {
	if (errorPanel) {
		errorPanel.hidden = true;
	}
	const width = video?.videoWidth ?? 0;
	const height = video?.videoHeight ?? 0;
	const size = width > 0 && height > 0 ? `${width}×${height}` : '分辨率未知';
	if (hint) {
		hint.textContent = `${format ? format.toUpperCase() : '视频'} · ${size} · ${formatDuration(video?.duration)}`;
	}
}

/**
 * 元数据 / 失败都可能在脚本执行前就发生（本地小文件、缓存命中）。
 * 事件只发一次，晚绑监听会永远等不到 —— 所以先读一次当前状态。
 */
function settleInitialState() {
	if (!video) {
		return true;
	}
	if (video.error) {
		showError();
		return true;
	}
	if (video.readyState >= 1) {
		onLoadedMetadata();
		return true;
	}
	return false;
}

if (!settleInitialState()) {
	video.addEventListener('error', showError);
	video.addEventListener('loadedmetadata', onLoadedMetadata);
}

// 切到别的标签页时暂停，避免保留上下文（retainContextWhenHidden）带来后台声音。
document.addEventListener('visibilitychange', () => {
	if (document.hidden && video && !video.paused) {
		video.pause();
	}
});
video?.addEventListener('dblclick', () => {
	if (document.fullscreenElement) {
		void document.exitFullscreen?.();
	} else {
		void video.requestFullscreen?.();
	}
});

document.getElementById('wispkit-video-open-external')?.addEventListener('click', () => {
	post('wispkit.media.openExternal');
});

document.getElementById('wispkit-video-copy-path')?.addEventListener('click', () => {
	post('wispkit.media.copyPath');
});

Object.defineProperty(window, '__wispkitSelftest', {
	value: {
		format: () => format,
		hasVideo: () => Boolean(video),
		src: () => video?.currentSrc || video?.src || '',
		errorVisible: () => Boolean(errorPanel && !errorPanel.hidden),
		showError,
	},
});
