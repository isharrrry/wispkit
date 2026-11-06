import esbuild from 'esbuild';

const targets = [
	{ entry: 'media/markdown.js', out: 'media/dist/markdown.js' },
	{ entry: 'media/html.js', out: 'media/dist/html.js' },
	{ entry: 'media/image.js', out: 'media/dist/image.js' },
	{ entry: 'media/video.js', out: 'media/dist/video.js' },
	{ entry: 'media/xaml.js', out: 'media/dist/xaml.js' },
	{ entry: 'media/readonly.js', out: 'media/dist/readonly.js' },
	{ entry: 'media/mermaid.js', out: 'media/dist/mermaid.js' },
	{ entry: 'media/binary.js', out: 'media/dist/binary.js' },
	// three.js 体积较大，这个 bundle 单独压缩；其余 webview 保持未压缩便于排查。
	{ entry: 'media/graph3d.js', out: 'media/dist/graph3d.js', minify: true },
];

await Promise.all(targets.map(target => esbuild.build({
	entryPoints: [target.entry],
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'es2020',
	outfile: target.out,
	sourcemap: false,
	minify: target.minify === true,
	logLevel: 'warning',
})));

console.log(`esbuild: built ${targets.length} webview bundles`);
