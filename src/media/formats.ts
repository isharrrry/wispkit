/**
 * Wispkit 接管的图片 / 视频扩展名清单。
 *
 * `package.json` 的 `customEditors.selector` 是静态 JSON，没法 import 这里的常量，
 * 所以两边必须保持一致 —— `packageManifest.test.ts` 会把清单和 manifest 逐项比对，
 * 改这里却忘了改 manifest（或反过来）会直接测试失败。
 */

/** Chromium / Electron 内核能直接解码的图片格式（SVG 由内核直接渲染）。 */
export const NATIVE_IMAGE_EXTENSIONS = [
	'png',
	'jpg',
	'jpe',
	'jpeg',
	'jfif',
	'bmp',
	'gif',
	'ico',
	'webp',
	'avif',
	'apng',
	'svg',
] as const;

/**
 * 需要额外解码器的格式：HEIF/HEIC 要 libheif（WASM 版约数 MB），
 * TIFF / JPEG XL 在 Chromium 里也没有默认解码器。
 * 为了不引入大依赖，这几种仍由图片视图接管，但只显示失败提示 + 「系统默认应用打开」。
 */
export const FALLBACK_IMAGE_EXTENSIONS = ['heic', 'heif', 'tif', 'tiff', 'jxl'] as const;

export const IMAGE_EXTENSIONS = [...NATIVE_IMAGE_EXTENSIONS, ...FALLBACK_IMAGE_EXTENSIONS] as const;

/**
 * 常见视频容器。能播的交给 `<video>` 原生解码；不能播的（MKV/AVI/WMV/FLV/RMVB…）
 * 会在页面上给出「用系统播放器打开」兜底。
 *
 * 注意：**不能加 `.ts` / `.mts`** —— 那是 TypeScript 源码的扩展名，加进来会把
 * 所有 TS 文件抢去当视频打开。MPEG-TS 只收 `.m2ts`。
 */
export const VIDEO_EXTENSIONS = [
	'mp4',
	'm4v',
	'mov',
	'webm',
	'ogv',
	'mkv',
	'avi',
	'wmv',
	'flv',
	'mpg',
	'mpeg',
	'm2ts',
	'3gp',
	'3g2',
	'rm',
	'rmvb',
] as const;

const imageExtensionSet = new Set<string>(IMAGE_EXTENSIONS);
const videoExtensionSet = new Set<string>(VIDEO_EXTENSIONS);
const nativeImageExtensionSet = new Set<string>(NATIVE_IMAGE_EXTENSIONS);

/** 取路径 / URI 的小写扩展名；会先丢掉 `?query` 与 `#fragment`。 */
export function fileExtension(target: string): string {
	const clean = target.split('#')[0].split('?')[0];
	const nameStart = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1;
	const name = clean.slice(nameStart);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isImagePath(target: string): boolean {
	return imageExtensionSet.has(fileExtension(target));
}

export function isVideoPath(target: string): boolean {
	return videoExtensionSet.has(fileExtension(target));
}

/** SVG 用矢量方式缩放（改布局尺寸），避免 `transform: scale()` 把矢量图栅格化后放大变糊。 */
export function isVectorImagePath(target: string): boolean {
	return fileExtension(target) === 'svg';
}

/** 内核能否直接解码；false 的格式只需要外部打开兜底，不必尝试内嵌渲染。 */
export function isNativelyDecodedImage(target: string): boolean {
	return nativeImageExtensionSet.has(fileExtension(target));
}
