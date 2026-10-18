import * as crypto from 'crypto';

/** 32 字节随机数的 base64 表示，用于 webview 的 CSP nonce。 */
export function generateNonce(): string {
	return crypto.randomBytes(32).toString('base64');
}
