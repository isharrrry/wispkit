export interface DemoOptions {
	readonly label: string;
	readonly retries: number;
}

export function greet(options: DemoOptions): string {
	return `${options.label}（最多重试 ${options.retries} 次）`;
}
