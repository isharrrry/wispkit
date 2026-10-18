const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const steps = [];
const step = (name, value) => steps.push({ name, value });

/** 探针在页面 load 之后等多久才回传结果（Mermaid / drawio 大图需要时间）。 */
const PROBE_MS = Number(process.env.WISPKIT_SELFTEST_PROBE_MS || 10000);

async function renderChecks(fixturePath, label) {
	const text = fs.readFileSync(fixturePath, 'utf8');
	const prefix = label ? `${label}.` : '';
	step(`${prefix}render.commandExistsBeforeActivation`, (await vscode.commands.getCommands(true)).includes('markdown.api.render'));

	let html = null;
	let error = null;
	try {
		// 与产品一致：传文档对象而不是字符串，内置引擎才会填 env.currentDocument
		// （drawio 的 data-doc-uri / 编辑按钮依赖它）
		html = await vscode.commands.executeCommand('markdown.api.render', {
			uri: vscode.Uri.file(fixturePath),
			getText: () => text,
		});
	} catch (e) {
		error = String(e);
	}

	step(`${prefix}render.returnType`, typeof html);
	step(`${prefix}render.error`, error);
	if (typeof html !== 'string') {
		return null;
	}

	step(`${prefix}render.length`, html.length);
	step(`${prefix}render.mermaidDivPresent`, /class="mermaid"/.test(html));
	step(`${prefix}render.drawioMxgraphPresent`, /class="mxgraph"/.test(html));
	step(`${prefix}render.drawioEditCommandLink`, /href="command:[^"]*drawio/i.test(html));
	// drawio 没出图时靠这几条定位：代码块被识别成什么语言、XML 有没有留在 HTML 里
	step(`${prefix}render.codeLanguages`, Array.from(new Set(Array.from(html.matchAll(/<code[^>]*class="([^"]*)"/g), m => m[1]))));
	step(`${prefix}render.mxgraphMentions`, (html.match(/mxgraph/gi) || []).length);
	step(`${prefix}render.drawioMentions`, (html.match(/drawio/gi) || []).length);
	step(`${prefix}render.mxfileMentions`, (html.match(/mxfile/gi) || []).length);
	step(`${prefix}render.drawioSnippets`, (html.match(/.{0,20}(?:drawio|mxgraph).{0,60}/gi) || []).slice(0, 8));
	step(`${prefix}render.katexRendered`, /class="katex/.test(html));
	step(`${prefix}render.headingHasId`, /<h[1-6][^>]*id="/.test(html));
	step(`${prefix}render.dataUriImageKept`, /<img[^>]+src="data:image\//.test(html));
	// 相对图片的 src 必须原样保留（相对路径交给 <base href> 解析，不能被 render 提前改写）
	// 注意：文件里没有图片时，这条不适用（返回 n/a 而不是 false，否则会被误读成失败）
	step(`${prefix}render.relativeImgSrcKept`,
		/<img[^>]+src="/.test(html)
			? /<img[^>]+src="(?!vscode-webview:|https?:|data:)/.test(html)
			: 'n/a（本文件没有图片）');
	step(`${prefix}render.headingCounts`, {
		h1: (html.match(/<h1[\s>]/g) || []).length,
		h2: (html.match(/<h2[\s>]/g) || []).length,
		h3: (html.match(/<h3[\s>]/g) || []).length,
		h4: (html.match(/<h4[\s>]/g) || []).length,
		h5: (html.match(/<h5[\s>]/g) || []).length,
		h6: (html.match(/<h6[\s>]/g) || []).length,
	});
	return html;
}

function cspFor(source, nonce) {
	const rule = source.split(';')[0];
	return `default-src 'none'; img-src 'self' ${rule} https: data:; media-src 'self' ${rule} https: data:; script-src 'nonce-${nonce}'; style-src 'self' ${rule} 'unsafe-inline' https: data:; font-src 'self' ${rule} https: data:;`;
}

async function cspChecks() {
	const panel = vscode.window.createWebviewPanel('wispkitSelftest', 'Wispkit Selftest', vscode.ViewColumn.Active, {
		enableScripts: true,
	});

	const nonce = crypto.randomBytes(32).toString('base64');
	const message = await new Promise(resolve => {
		const timer = setTimeout(() => resolve({ timeout: true }), 20000);
		panel.webview.onDidReceiveMessage(value => {
			clearTimeout(timer);
			resolve(value);
		});
		panel.webview.html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${cspFor(panel.webview.cspSource, nonce).replace(/"/g, '&quot;')}">
</head><body>
<script nonce="${nonce}">window.__violations=[];document.addEventListener('securitypolicyviolation',e=>window.__violations.push(e.violatedDirective));</script>
<script nonce="${nonce}">const api=acquireVsCodeApi();setTimeout(()=>api.postMessage({nonceScriptRan:true,violations:window.__violations}),300);</script>
</body></html>`;
	});

	step('csp.webviewMessage', message);
	panel.dispose();
}

async function viewTypeChecks(fixtureDir) {
	const cases = [
		{ name: 'markdown', file: process.env.WISPKIT_SELFTEST_FIXTURE || 'fixture.md', viewType: 'wispkit.markdown' },
		{ name: 'image', file: process.env.WISPKIT_SELFTEST_IMAGE || 'images/pic.png', viewType: 'wispkit.image' },
		{ name: 'html', file: process.env.WISPKIT_SELFTEST_HTML || 'page.html', viewType: 'wispkit.html' },
	];

	for (const testCase of cases) {
		const uri = vscode.Uri.file(path.join(fixtureDir, testCase.file));
		let error = null;
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, testCase.viewType);
			await new Promise(resolve => setTimeout(resolve, 1500));
		} catch (e) {
			error = String(e);
		}
		const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
		const opened = tabs.find(tab => tab.input && tab.input.viewType === testCase.viewType);
		step(`viewType.${testCase.name}.opened`, Boolean(opened));
		step(`viewType.${testCase.name}.error`, error);
	}
}

/**
 * 关键一项：直接用 Wispkit 自己编译出来的页面生成代码，在真实 webview 里渲染，
 * 看内置 mermaid / drawio 脚本是否真的出图、相对图片与 data: 图片是否真的加载、
 * 目录树 / 工具栏 / 放大预览是否真的可用、正文排版变量是否真的喂给了内置 CSS。
 */
async function realPageChecks(fixtureDir, relPath, bodyHtml, label) {
	const extension = vscode.extensions.getExtension('narnat.wispkit');
	if (!extension) {
		step('realPage.skipped', 'wispkit 未安装');
		return;
	}

	const pageModule = require(path.join(extension.extensionPath, 'out', 'markdown', 'page.js'));
	const contributionsModule = require(path.join(extension.extensionPath, 'out', 'markdown', 'contributions.js'));
	const cspModule = require(path.join(extension.extensionPath, 'out', 'util', 'csp.js'));
	const nonceModule = require(path.join(extension.extensionPath, 'out', 'util', 'nonce.js'));

	const contributions = contributionsModule.collectMarkdownContributions(
		vscode.extensions.all.map(ext => ({ packageJson: ext.packageJSON, extensionUri: ext.extensionUri.toString(), id: ext.id })),
	);
	step(`${label}.contributionScripts`, contributions.scripts.map(script => script.path));
	step(`${label}.contributionStyles`, contributions.styles.map(style => style.path));

	const roots = [
		extension.extensionUri,
		vscode.Uri.file(fixtureDir),
		...vscode.extensions.all
			.filter(ext => contributionsModule.hasMarkdownPreviewResources(ext.packageJSON))
			.map(ext => ext.extensionUri),
	];

	const panel = vscode.window.createWebviewPanel('wispkitPageTest', 'Wispkit Page', vscode.ViewColumn.Active, {
		enableScripts: true,
		enableCommandUris: true,
		localResourceRoots: roots,
	});

	const webview = panel.webview;
	const nonce = nonceModule.generateNonce();
	const toWebviewUri = (extensionUri, resourcePath) =>
		webview.asWebviewUri(vscode.Uri.joinPath(vscode.Uri.parse(extensionUri), resourcePath)).toString();

	const fixturePath = path.join(fixtureDir, relPath);
	const html = pageModule.renderMarkdownPage({
		title: path.basename(relPath),
		csp: cspModule.strictContentSecurityPolicy(webview.cspSource, nonce),
		nonce,
		baseHref: webview.asWebviewUri(vscode.Uri.file(fixturePath)).toString(),
		contributionStyles: contributions.styles.map(style => toWebviewUri(style.extensionUri, style.path)),
		contributionScripts: contributions.scripts.filter(script => script.extensionId !== 'vscode.markdown-language-features').map(script => ({
			src: toWebviewUri(script.extensionUri, script.path),
			type: script.type,
		})),
		runtimeScript: toWebviewUri(extension.extensionUri, 'media/dist/markdown.js'),
		runtimeStyle: toWebviewUri(extension.extensionUri, 'media/markdown.css'),
		bodyHtml,
		config: { tocEnabled: true, tocDepth: 3 },
		typography: require(path.join(extension.extensionPath, 'out', 'config.js')).readMarkdownPreviewTypography(),
	});

	const probe = `<script nonce="${nonce}">
	window.__violations = [];
	window.__probeStage = 'script-started';
	document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + '|' + e.blockedURI));
	const api = acquireVsCodeApi();
	let reported = false;
	const report = payload => { if (!reported) { reported = true; api.postMessage(payload); } };
	window.__errors = [];
	window.addEventListener('error', e => window.__errors.push((e.message || '') + ' @' + (e.filename || '')));
	const fire = () => {
		window.__probeStage = 'firing';
		try {
		const q = s => document.querySelectorAll(s).length;
		const self = window.__wispkitSelftest;
		const imgs = Array.from(document.querySelectorAll('#wispkit-content img'));
		const dataImgs = imgs.filter(i => String(i.getAttribute('src') || '').startsWith('data:'));
		const style = getComputedStyle(document.body);
		const rootStyle = getComputedStyle(document.documentElement);
		const nav = document.getElementById('wispkit-toc');
		const stage = document.getElementById('wispkit-lightbox-stage');
		const lightboxRoot = document.getElementById('wispkit-lightbox');
		const svg = document.querySelector('#wispkit-content svg');

		const toolbarIds = ['wispkit-sidebar-toggle', 'wispkit-expand-all', 'wispkit-collapse-all', 'wispkit-editor-toggle'];

		const collapseState = self ? (() => {
			self.collapseAll();
			const collapsed = q('#wispkit-toc .wispkit-toc-collapsed');
			self.expandAll();
			return { collapsedAfterCollapseAll: collapsed, collapsedAfterExpandAll: q('#wispkit-toc .wispkit-toc-collapsed') };
		})() : null;

		const sidebarState = self ? (() => {
			const before = self.sidebarVisible();
			self.toggleSidebar();
			const hiddenAfterToggle = nav ? nav.hidden : null;
			self.toggleSidebar();
			return { before, hiddenAfterToggle, after: self.sidebarVisible() };
		})() : null;

		const lightboxSvg = self && svg ? (() => {
			const opened = self.openSvg(svg);
			const sourceNode = svg.querySelector('.node rect, .node polygon, .node circle, rect');
			const clonedSvg = stage ? stage.querySelector('svg') : null;
			const clonedNode = clonedSvg ? clonedSvg.querySelector('.node rect, .node polygon, .node circle, rect') : null;
			const result = {
				opened,
				flag: self.lightboxOpen(),
				visible: lightboxRoot ? !lightboxRoot.hidden : null,
				stageWidth: stage ? stage.style.width : null,
				stageChildren: stage ? stage.children.length : null,
				sourceId: svg.getAttribute('id'),
				clonedId: clonedSvg ? clonedSvg.getAttribute('id') : null,
				sourceNodeFill: sourceNode ? getComputedStyle(sourceNode).fill : null,
				clonedNodeFill: clonedNode ? getComputedStyle(clonedNode).fill : null,
			};
			return result;
		})() : null;

		const lightboxImage = self ? (() => {
			const target = imgs.find(i => i.complete && i.naturalWidth > 0);
			if (!target) { return null; }
			const opened = self.openImage(target);
			return { opened, flag: self.lightboxOpen(), stageWidth: stage ? stage.style.width : null };
		})() : null;

		report({
			label: ${JSON.stringify(label)},
			mermaidDivs: q('.mermaid'),
			mermaidSvgs: q('.mermaid svg'),
			tocLinks: self ? self.tocLinkCount() : -1,
			h1: q('#wispkit-content h1'),
			h2: q('#wispkit-content h2'),
			h3: q('#wispkit-content h3'),
			h4: q('#wispkit-content h4'),
			katexNodes: q('.katex'),
			imgCount: imgs.length,
			imgSrc: imgs.length > 0 ? imgs[0].getAttribute('src') : null,
			imgResolvedToWebviewUri: imgs.length > 0 ? String(imgs[0].src).startsWith('vscode-webview:') : null,
			imgLoaded: imgs.length > 0 ? (imgs[0].complete && imgs[0].naturalWidth > 0) : null,
			imgLoadedCount: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
			dataImageCount: dataImgs.length,
			dataImageLoadedCount: dataImgs.filter(i => i.complete && i.naturalWidth > 0).length,
			drawioBlocks: q('.mxgraph'),
			drawioSvgs: q('.mxgraph svg'),
			drawioEditLinks: Array.from(document.querySelectorAll('a[href^="command:"]')).map(a => String(a.getAttribute('href')).slice(0, 80)),
			layoutProbe: (() => {
				const sample = selector => {
					const el = document.querySelector(selector);
					if (!el) { return null; }
					const s = getComputedStyle(el);
					const box = el.getBoundingClientRect();
					return {
						fontSize: s.fontSize,
						lineHeight: s.lineHeight,
						display: s.display,
						whiteSpace: s.whiteSpace,
						h: Math.round(box.height),
						top: Math.round(box.top),
					};
				};
				const codeLines = document.querySelectorAll('#wispkit-content .code-line');
				const tocRows = Array.from(document.querySelectorAll('#wispkit-toc .wispkit-toc-link')).slice(0, 4)
					.map(a => { const b = a.getBoundingClientRect(); return { text: (a.textContent || '').slice(0, 14), top: Math.round(b.top), h: Math.round(b.height) }; });
				return {
					body: sample('body'),
					tocLink: sample('#wispkit-toc .wispkit-toc-link'),
					tocItem: sample('#wispkit-toc li'),
					p: sample('#wispkit-content p'),
					pre: sample('#wispkit-content pre'),
					preCode: sample('#wispkit-content pre code'),
					h1: sample('#wispkit-content h1'),
					li: sample('#wispkit-content li'),
					codeLineCount: codeLines.length,
					codeLine: codeLines.length > 0 ? (() => {
						const s = getComputedStyle(codeLines[0]);
						return { display: s.display, position: s.position, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace };
					})() : null,
					tocRows,
					backgrounds: {
						body: getComputedStyle(document.body).backgroundColor,
						lightbox: lightboxRoot ? getComputedStyle(lightboxRoot).backgroundColor : null,
						content: document.getElementById('wispkit-content')
							? getComputedStyle(document.getElementById('wispkit-content')).backgroundColor
							: null,
						mermaidSvg: document.querySelector('.mermaid svg')
							? getComputedStyle(document.querySelector('.mermaid svg')).backgroundColor
							: null,
					},
					vars: {
						fontSize: rootStyle.getPropertyValue('--markdown-font-size').trim(),
						lineHeight: rootStyle.getPropertyValue('--markdown-line-height').trim(),
						editorFontSize: rootStyle.getPropertyValue('--vscode-editor-font-size').trim(),
					},
				};
			})(),
			themeProbe: (() => {
				const svg = document.querySelector('.mermaid svg');
				const node = svg ? svg.querySelector('.node rect, .node polygon, .node circle, rect') : null;
				const nodeText = svg ? svg.querySelector('.nodeLabel, .node text, text') : null;
				return {
					bodyClass: document.body.className,
					htmlClass: document.documentElement.className,
					editorBackground: rootStyle.getPropertyValue('--vscode-editor-background').trim(),
					editorForeground: rootStyle.getPropertyValue('--vscode-editor-foreground').trim(),
					bodyColor: getComputedStyle(document.body).color,
					mermaidTheme: (() => {
						try {
							return (window.mermaid && window.mermaid.mermaidAPI && window.mermaid.mermaidAPI.getConfig)
								? window.mermaid.mermaidAPI.getConfig().theme
								: null;
						} catch (error) {
							return 'error:' + String(error && error.message);
						}
					})(),
					nodeFill: node ? getComputedStyle(node).fill : null,
					nodeStroke: node ? getComputedStyle(node).stroke : null,
					textFill: nodeText ? getComputedStyle(nodeText).fill : null,
				};
			})(),
			editorElements: {
				editor: Boolean(document.getElementById('wispkit-editor')),
				editorHidden: document.getElementById('wispkit-editor') ? document.getElementById('wispkit-editor').hidden : null,
				save: Boolean(document.getElementById('wispkit-save')),
				editorToggle: Boolean(document.getElementById('wispkit-editor-toggle')),
				main: Boolean(document.getElementById('wispkit-main')),
			},
			lineHeightComputed: getComputedStyle(document.body).lineHeight,
			toolbarButtons: toolbarIds.filter(id => document.getElementById(id)).length,
			splitter: Boolean(document.getElementById('wispkit-splitter')),
			lightboxContainer: Boolean(lightboxRoot),
			bodyFontSize: style.fontSize,
			bodyLineHeight: style.lineHeight,
			markdownFontSizeVar: rootStyle.getPropertyValue('--markdown-font-size').trim(),
			markdownLineHeightVar: rootStyle.getPropertyValue('--markdown-line-height').trim(),
			markdownFontFamilyVar: rootStyle.getPropertyValue('--markdown-font-family').trim().slice(0, 40),
			collapseState,
			sidebarState,
			lightboxSvg,
			lightboxImage,
			mediaMenu: (() => {
				if (!self || !self.openContextMenu) { return null; }
				const imageLabels = self.openContextMenu('#wispkit-content img');
				self.closeMenu();
				const svgLabels = self.openContextMenu('#wispkit-content svg');
				const clicked = svgLabels && svgLabels.length > 0 ? self.clickMenu('复制源码') : false;
				const request = self.lastMediaRequest();
				self.closeMenu();
				return { imageLabels, svgLabels, clicked, request };
			})(),
			violations: window.__violations,
			scriptErrors: window.__errors,
			drawioSnippets: (document.documentElement.outerHTML.match(/.{0,20}(?:drawio|mxgraph).{0,40}/gi) || []).slice(0, 10),
			drawioLinks: Array.from(document.querySelectorAll('#wispkit-content a')).map(a => String(a.getAttribute('href') || '').slice(0, 60)).slice(0, 8),
			mxgraphInteractive: document.querySelectorAll('.mxgraph button, .mxgraph a, [class*="toolbar"] button, [class*="toolbar"] a').length,
			mxgraphHtml: document.querySelector('.mxgraph') ? String(document.querySelector('.mxgraph').outerHTML).slice(0, 240) : null,
		});
		} catch (err) {
			report({ label: ${JSON.stringify(label)}, probeError: String((err && err.stack) || err), stage: window.__probeStage, readyState: document.readyState });
		}
	};
	window.addEventListener('load', () => setTimeout(fire, ${PROBE_MS}));
	setTimeout(() => report({ label: ${JSON.stringify(label)}, fallback: true, stage: window.__probeStage, readyState: document.readyState }), ${PROBE_MS} + 8000);
</script>`;

	const instrumented = html.replace('</head>', `${probe}\n</head>`);
	step(`${label}.probeInjected`, instrumented !== html);

	const reply = await new Promise(resolve => {
		const timer = setTimeout(() => resolve({ timeout: true }), PROBE_MS + 30000);
		webview.onDidReceiveMessage(value => {
			clearTimeout(timer);
			resolve(value);
		});
		webview.html = instrumented;
	});

	step(`${label}.probe`, reply);
	panel.dispose();
}

/**
 * 图片视图单独验一遍：用扩展自己那份 localResourceRoots 计算，
 * 在真实 webview 里确认图片真的被加载（而不是被 webview 拒载成空白页）。
 */
async function imagePageChecks(fixtureDir, relPath) {
	const extension = vscode.extensions.getExtension('narnat.wispkit');
	if (!extension) {
		step('imagePage.skipped', 'wispkit 未安装');
		return;
	}

	const imagePage = require(path.join(extension.extensionPath, 'out', 'image', 'page.js'));
	const imageProvider = require(path.join(extension.extensionPath, 'out', 'imageProvider.js'));
	const nonceModule = require(path.join(extension.extensionPath, 'out', 'util', 'nonce.js'));

	const target = vscode.Uri.file(path.join(fixtureDir, relPath));
	const roots = imageProvider.collectImageResourceRoots({ extensionUri: extension.extensionUri }, target);
	step('imagePage.resourceRoots', roots.map(uri => uri.toString()));

	const panel = vscode.window.createWebviewPanel('wispkitImageTest', 'Wispkit Image', vscode.ViewColumn.Active, {
		enableScripts: true,
		localResourceRoots: roots,
	});
	const webview = panel.webview;
	const nonce = nonceModule.generateNonce();
	const page = imagePage.renderImagePage({
		title: path.basename(relPath),
		csp: imageProvider.imageContentSecurityPolicy(webview.cspSource, nonce),
		nonce,
		imageSrc: webview.asWebviewUri(target).toString(),
		runtimeScript: webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', 'dist', 'image.js')).toString(),
		runtimeStyle: webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', 'image.css')).toString(),
		config: { wheelZoom: true, wheelStep: 1.1, dragButton: 'right' },
	});

	const probe = `<script nonce="${nonce}">
	window.addEventListener('load', () => setTimeout(() => {
		const api = acquireVsCodeApi();
		const img = document.getElementById('wispkit-image');
		api.postMessage({
			label: ${JSON.stringify(relPath)},
			imageCount: document.querySelectorAll('img').length,
			loaded: Boolean(img && img.complete && img.naturalWidth > 0),
			naturalWidth: img ? img.naturalWidth : null,
			naturalHeight: img ? img.naturalHeight : null,
			srcPrefix: img ? String(img.getAttribute('src')).slice(0, 60) : null,
		});
	}, 2000));
</script>`;

	const reply = await new Promise(resolve => {
		const timer = setTimeout(() => resolve({ timeout: true }), 30000);
		webview.onDidReceiveMessage(value => {
			clearTimeout(timer);
			resolve(value);
		});
		webview.html = page.replace('</head>', `${probe}\n</head>`);
	});

	step('imagePage.probe', reply);
	panel.dispose();
}

/**
 * 宿主侧媒体动作：源码定位（第 N 个图片/图表 → 原文那一段）、图片路径解析、
 * 以及 drawio"编辑"链路（抽成临时 .drawio 文件并交给 drawio 扩展打开）。
 */
async function mediaActionChecks(fixtureDir) {
	const extension = vscode.extensions.getExtension('narnat.wispkit');
	if (!extension) {
		step('mediaAction.skipped', 'wispkit 未安装');
		return;
	}

	const mediaActions = require(path.join(extension.extensionPath, 'out', 'mediaActions.js'));
	const parse = require(path.join(extension.extensionPath, 'out', 'media', 'parse.js'));

	const document = await vscode.workspace.openTextDocument(path.join(fixtureDir, 'fixture.md'));
	const text = document.getText();

	const image = parse.findMediaSource(text, 'image', 0);
	step('mediaAction.imageText', image && image.text);
	step('mediaAction.imageTarget', image && image.target);

	const imageUri = image && image.target ? mediaActions.resolveImageUri(document, image.target) : null;
	step('mediaAction.imageResolved', imageUri && imageUri.fsPath);
	step('mediaAction.imageExists', Boolean(imageUri && fs.existsSync(imageUri.fsPath)));

	const mermaid = parse.findMediaSource(text, 'mermaid', 0);
	step('mediaAction.mermaidBody', mermaid && String(mermaid.body).split('\n')[0]);

	// 用 alt 交叉校验：索引故意给错，应当仍能定位到同一张图
	const byAlt = parse.findMediaSource(text, 'image', 99, 'pic');
	step('mediaAction.imageByAlt', byAlt && byAlt.target);

	const drawioIndexes = [];
	for (let index = 0; index < 4; index++) {
		const block = parse.findMediaSource(text, 'drawio', index);
		if (!block) { break; }
		drawioIndexes.push({ index, head: String(block.body).split('\n')[0].slice(0, 40) });
	}
	step('mediaAction.drawioBlocks', drawioIndexes);

	const storageDir = vscode.Uri.file(path.join(os.tmpdir(), 'wispkit-selftest-storage'));
	const editResult = await mediaActions.runMediaAction(
		document,
		{ action: 'editDrawio', kind: 'drawio', index: 0 },
		{ storageDir, subscriptions: [] },
	);
	step('mediaAction.editDrawio', editResult);

	const drawioTempDir = path.join(storageDir.fsPath, 'drawio');
	const tempFiles = fs.existsSync(drawioTempDir) ? fs.readdirSync(drawioTempDir) : [];
	step('mediaAction.drawioTempFiles', tempFiles);
	if (tempFiles.length > 0) {
		const content = fs.readFileSync(path.join(drawioTempDir, tempFiles[tempFiles.length - 1]), 'utf8');
		step('mediaAction.drawioTempMatchesSource', content.replace(/\r?\n/g, '\n').trim() === String(parse.findMediaSource(text, 'drawio', 0).body).replace(/\r?\n/g, '\n').trim());
	}

	const copyResult = await mediaActions.runMediaAction(document, { action: 'copyText', kind: 'mermaid', index: 0 }, { storageDir, subscriptions: [] });
	step('mediaAction.copyText', copyResult);
	step('mediaAction.clipboardHead', String(await vscode.env.clipboard.readText()).slice(0, 40));
}

/**
 * XAML 视图：先用扩展自己的渲染器 CLI 真跑一次，再把生成的页面放进真实 webview，
 * 确认图片真的加载、代码行真的渲染、工具栏与手势钩子真的在。
 */
async function xamlChecks() {
	const extension = vscode.extensions.getExtension('narnat.wispkit');
	if (!extension) {
		step('xaml.skipped', 'wispkit 未安装');
		return;
	}

	const xamlPath = process.env.WISPKIT_SELFTEST_XAML
		|| path.join(__dirname, '..', 'xaml-render', 'samples', 'minimal-window.xaml');
	step('xaml.sample', xamlPath);
	if (!fs.existsSync(xamlPath)) {
		step('xaml.skipped', `素材不存在：${xamlPath}`);
		return;
	}

	const provider = require(path.join(extension.extensionPath, 'out', 'xamlProvider.js'));
	const renderer = require(path.join(extension.extensionPath, 'out', 'xaml', 'renderer.js'));
	const xamlPage = require(path.join(extension.extensionPath, 'out', 'xaml', 'page.js'));
	const nonceModule = require(path.join(extension.extensionPath, 'out', 'util', 'nonce.js'));
	const cspModule = require(path.join(extension.extensionPath, 'out', 'util', 'csp.js'));

	const executable = provider.rendererExecutable(extension.extensionUri);
	step('xaml.rendererExists', fs.existsSync(executable));

	const assemblies = await provider.discoverAssemblies(vscode.Uri.file(xamlPath));
	step('xaml.assemblies', assemblies.map(item => path.basename(item)));

	// 输出到工作区内：本机沙箱允许工作区写入，而自编译的 exe 写用户临时目录会被拒
	const pngPath = path.join(process.env.WISPKIT_SELFTEST_WS || os.tmpdir(), 'wispkit-selftest-xaml.png');
	const result = await renderer.renderXaml({ executable, extraAssemblies: assemblies }, xamlPath, pngPath);
	step('xaml.renderResult', result);
	step('xaml.pngBytes', fs.existsSync(pngPath) ? fs.statSync(pngPath).size : null);

	const panel = vscode.window.createWebviewPanel('wispkitXamlTest', 'Wispkit XAML', vscode.ViewColumn.Active, {
		enableScripts: true,
		localResourceRoots: [extension.extensionUri, vscode.Uri.file(path.dirname(pngPath))],
	});
	const webview = panel.webview;
	const nonce = nonceModule.generateNonce();
	const imageSrc = result.ok ? webview.asWebviewUri(vscode.Uri.file(pngPath)).toString() : undefined;
	const html = xamlPage.renderXamlPage({
		title: path.basename(xamlPath),
		csp: cspModule.strictContentSecurityPolicy(webview.cspSource, nonce),
		nonce,
		runtimeScript: webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', 'dist', 'xaml.js')).toString(),
		runtimeStyle: webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', 'xaml.css')).toString(),
		code: fs.readFileSync(xamlPath, 'utf8'),
		imageSrc,
		result,
		config: { wheelStep: 1.1, dragButton: 'right', codeVisible: true, codeWidth: 460 },
	});

	const probe = `<script nonce="${nonce}">
	window.__violations = [];
	window.__errors = [];
	document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective));
	window.addEventListener('error', e => window.__errors.push(String(e.message || '')));
	// 必须在这里（head 里、页面模块之前）取 api：acquireVsCodeApi 只能取一次，
	// 等 load 再取时 media/dist/xaml.js 已经取走，会抛错并让探针静默。
	let xamlApi = null;
	try { xamlApi = acquireVsCodeApi(); } catch (e) { xamlApi = null; }
	const xamlReport = payload => {
		try { if (xamlApi) { xamlApi.postMessage(payload); } } catch (e) { /* 发不出去也无计可施 */ }
	};
	const xamlProbe = () => {
		try {
			const self = window.__wispkitSelftest;
			const img = document.getElementById('wispkit-xaml-image');
			let selfHooks = null;
			let lightboxOpened = null;
			if (self) {
				selfHooks = { imageLoaded: self.imageLoaded(), codeLineCount: self.codeLineCount(), splitterWidth: self.splitterWidth() };
				lightboxOpened = self.openLightbox();
			}
			xamlReport({
				imageLoaded: Boolean(img && img.complete && img.naturalWidth > 0),
				naturalWidth: img ? img.naturalWidth : null,
				naturalHeight: img ? img.naturalHeight : null,
				imageHasSrc: img ? Boolean(img.getAttribute('src')) : null,
				codeLines: document.querySelectorAll('.wispkit-xaml-line').length,
				toolbar: ['wispkit-xaml-rerender', 'wispkit-xaml-lightbox-button', 'wispkit-xaml-toggle-code', 'wispkit-xaml-fit'].filter(id => document.getElementById(id)),
				splitter: Boolean(document.getElementById('wispkit-xaml-splitter')),
				selfHooks,
				lightboxOpened,
				scriptErrors: window.__errors,
				violations: window.__violations,
			});
		} catch (err) {
			xamlReport({ probeError: String((err && err.stack) || err), scriptErrors: window.__errors, violations: window.__violations });
		}
	};
	window.addEventListener('load', () => setTimeout(xamlProbe, 1500));
	setTimeout(xamlProbe, 6000);
</script>`;

	const reply = await new Promise(resolve => {
		const timer = setTimeout(() => resolve({ timeout: true }), 20000);
		webview.onDidReceiveMessage(value => {
			clearTimeout(timer);
			resolve(value);
		});
		webview.html = html.replace('</head>', `${probe}\n</head>`);
	});
	step('xaml.probe', reply);
	panel.dispose();
}

/** 对新素材目录逐份做"渲染 + 真实页面探针"。默认关，靠 WISPKIT_SELFTEST_DEMO 打开。 */
async function demoChecks(fixtureDir) {
	const cases = (process.env.WISPKIT_SELFTEST_DEMO_LIST || '')
		.split(';')
		.map(item => item.trim())
		.filter(Boolean);

	for (const relPath of cases) {
		const label = relPath.replace(/[\\/]/g, '_');
		const bodyHtml = await renderChecks(path.join(fixtureDir, relPath), label);
		if (typeof bodyHtml === 'string') {
			await realPageChecks(fixtureDir, relPath, bodyHtml, label);
		}
	}
}

/** 子树浏览 + .WispkitView 展示：命令是否真的开出面板、重复点击是否复用。 */
async function subtreeChecks(fixtureDir) {
	const dir = path.resolve(fixtureDir, '..', '..', 'demo', 'R7-subtree', '演示工程');
	step('subtree.demoDirExists', fs.existsSync(dir));
	if (!fs.existsSync(dir)) {
		return;
	}

	const allTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
	const webviewTabs = () => allTabs().filter(tab => tab.input instanceof vscode.TabInputWebview);
	const htmlTabs = () => allTabs().filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'wispkit.html');

	try {
		await vscode.commands.executeCommand('wispkit.subtree.open', vscode.Uri.file(dir));
		await new Promise(resolve => setTimeout(resolve, 2500));
		const opened = webviewTabs();
		step('subtree.panelOpened', opened.length > 0);
		step('subtree.viewTypes', opened.map(tab => String(tab.input.viewType)));
		step('subtree.panelLabel', opened.map(tab => tab.label));

		await vscode.commands.executeCommand('wispkit.subtree.open', vscode.Uri.file(dir));
		await new Promise(resolve => setTimeout(resolve, 1500));
		step('subtree.reusedSinglePanel', webviewTabs().length === opened.length);

		await vscode.commands.executeCommand('wispkit.wispkitView.open', vscode.Uri.file(dir));
		await new Promise(resolve => setTimeout(resolve, 2500));
		const htmlOpened = htmlTabs();
		step('wispkitView.openedAsHtml', htmlOpened.length > 0);
		step('wispkitView.uris', htmlOpened.map(tab => tab.input.uri.fsPath.split('\\').slice(-2).join('/')));
	} finally {
		const leftovers = [...webviewTabs(), ...htmlTabs()];
		if (leftovers.length > 0) {
			await vscode.window.tabGroups.close(leftovers, true);
		}
	}
}

/** 只读模式：纯逻辑截断 + "原生方式打开后是否真的被换成了 wispkit.text" 的端到端验证。 */
async function readonlyChecks(extensionPath) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispkit-selftest-'));
	const file = path.join(dir, 'sample.txt');
	fs.writeFileSync(file, Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'), 'utf8');
	const uri = vscode.Uri.file(file);
	const tabsForFile = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
		const input = tab.input;
		return (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText)
			&& input.uri.toString() === uri.toString();
	});

	try {
		const fileModule = require(path.join(extensionPath, 'out', 'readonly', 'file.js'));
		const preview = await fileModule.readTextPrefix(file, 64, 10);
		step('readonly.truncate.shownBytes', preview.shownBytes);
		step('readonly.truncate.shownLines', preview.shownLines);
		step('readonly.truncate.flagged', preview.truncated);
		step('readonly.truncate.notWholeFile', preview.text.length < 200);

		await vscode.commands.executeCommand('wispkit.toggleReadOnly');
		await new Promise(resolve => setTimeout(resolve, 1800));

		// 「原生打开方式就是只读」的落点：workbench.editorAssociations 必须真的被写入。
		const assoc = vscode.workspace.getConfiguration('workbench').get('editorAssociations') ?? {};
		const ours = Object.entries(assoc).filter(([, value]) => value === 'wispkit.text');
		step('readonly.associationsEntries', ours.length);
		step('readonly.associationsHasTxt', assoc['*.txt'] === 'wispkit.text');
		step('readonly.associationsHasJson', assoc['*.json'] === 'wispkit.text');
		step('readonly.associationsNoMarkdown', assoc['*.md'] === undefined);

		await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
		await new Promise(resolve => setTimeout(resolve, 2500));

		const tabs = tabsForFile();
		step('readonly.intercepted', tabs.some(tab => {
			const input = tab.input;
			return input instanceof vscode.TabInputCustom && input.viewType === 'wispkit.text';
		}));
		step('readonly.tabCount', tabs.length);
		step('readonly.noLeftoverTextTab', !tabs.some(tab => tab.input instanceof vscode.TabInputText));
	} finally {
		await vscode.commands.executeCommand('wispkit.toggleReadOnly');
		const leftover = tabsForFile();
		if (leftover.length > 0) {
			await vscode.window.tabGroups.close(leftover, true);
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

async function main() {
	const outFile = process.env.WISPKIT_SELFTEST_OUT;
	step('vscode.version', vscode.version);

	try {
		const extension = vscode.extensions.getExtension('narnat.wispkit');
		step('wispkit.installed', Boolean(extension));
		step('wispkit.extensionPath', extension ? extension.extensionPath : null);
		if (extension && !extension.isActive) {
			await extension.activate();
		}
		step('wispkit.active', extension ? extension.isActive : false);
		const commands = await vscode.commands.getCommands(true);
		step('wispkit.commandRegistered', commands.includes('wispkit.openWith'));
		step('wispkit.legacyToggleCommandRemoved', !commands.includes('wispkit.toggleEditorType'));
		step('wispkit.readonlyCommandRegistered', commands.includes('wispkit.toggleReadOnly'));
		step('wispkit.subtreeCommandRegistered', commands.includes('wispkit.subtree.open'));
		step('wispkit.wispkitViewCommandRegistered', commands.includes('wispkit.wispkitView.open'));

		const fixtureDir = process.env.WISPKIT_SELFTEST_WS;
		await cspChecks();
		if (process.env.WISPKIT_SELFTEST_DEMO) {
			await demoChecks(fixtureDir);
		} else {
			const bodyHtml = await renderChecks(path.join(fixtureDir, 'fixture.md'), '');
			await viewTypeChecks(fixtureDir);
			if (typeof bodyHtml === 'string') {
				await realPageChecks(fixtureDir, 'fixture.md', bodyHtml, 'fixture');
			}
			await imagePageChecks(fixtureDir, process.env.WISPKIT_SELFTEST_IMAGE || 'images/pic.png');
		}
		await mediaActionChecks(fixtureDir);
		await xamlChecks();
		await subtreeChecks(fixtureDir);
		await readonlyChecks(extension ? extension.extensionPath : '');
	} catch (e) {
		step('fatal', String((e && e.stack) || e));
	}

	fs.writeFileSync(outFile, JSON.stringify({ steps }, null, 2), 'utf8');

	try {
		await vscode.commands.executeCommand('workbench.action.quit');
	} catch {
		// 退出失败不影响结果文件
	}
}

exports.activate = function () {
	setTimeout(() => {
		main();
	}, 2500);
};
