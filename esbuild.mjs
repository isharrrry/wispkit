import esbuild from 'esbuild';

const targets = [
	{ entry: 'media/markdown.js', out: 'media/dist/markdown.js' },
	{ entry: 'media/image.js', out: 'media/dist/image.js' },
	{ entry: 'media/xaml.js', out: 'media/dist/xaml.js' },
	{ entry: 'media/readonly.js', out: 'media/dist/readonly.js' },
];

await Promise.all(targets.map(target => esbuild.build({
	entryPoints: [target.entry],
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'es2020',
	outfile: target.out,
	sourcemap: false,
	minify: false,
	logLevel: 'warning',
})));

console.log(`esbuild: built ${targets.length} webview bundles`);
