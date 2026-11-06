import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementSizeInfo, layoutGraph } from '../src/graph3d/layout';
import { mergeElements } from '../src/graph3d/merge';
import { resolveLeftSelection, resolveRightSelection } from '../src/graph3d/selection';
import { fitLabelText, preWrapLabel, LONG_LABEL_WIDTH } from '../src/graph3d/textLayout';
import { displayWidth, kindLabel } from '../src/graph3d/types';

/**
 * 3D 可视化浏览器前端。
 *
 * 分工：
 *   - 宿主：读 Markdown、解析 ASCII 树 / Mermaid、把 GraphElement[] 放进页面；
 *   - 这里：选元素、调布局（src/graph3d/layout.ts，纯函数）、用 three.js 画。
 *
 * 节点是「90% 透明的气泡球 + 始终面向相机的 Sprite 文字」：
 * 文字用 Sprite（不是贴在球面上的纹理），所以无论怎么旋转都正向用户，
 * 近大远小由 sizeAttenuation 自然处理。
 */

const META_ID = 'wispkit-3d-data';
const LEFT = 'left';
const RIGHT = 'right';
const MERGED = 'merged';

const vscodeApi = (() => {
	try {
		return typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
	} catch {
		return undefined;
	}
})();

function byId(id) {
	return document.getElementById(id);
}

/** 状态行里的核心节点名不能太长，截到 12 个字符。 */
function shortLabel(label) {
	const text = typeof label === 'string' ? label : '';
	return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

const ui = {
	leftSelect: byId('wispkit-3d-left-select'),
	rightSelect: byId('wispkit-3d-right-select'),
	merge: byId('wispkit-3d-merge'),
	reset: byId('wispkit-3d-reset'),
	refresh: byId('wispkit-3d-refresh'),
	algorithm: byId('wispkit-3d-algorithm'),
	spacing: byId('wispkit-3d-spacing'),
	spacingValue: byId('wispkit-3d-spacing-value'),
	edgeLabels: byId('wispkit-3d-edge-labels'),
	status: byId('wispkit-3d-status'),
	panes: byId('wispkit-3d-panes'),
	splitter: byId('wispkit-3d-splitter'),
	leftPane: byId('wispkit-3d-left'),
	rightPane: byId('wispkit-3d-right'),
	mergedPane: byId('wispkit-3d-merged'),
};

const ALGORITHM_LABELS = {
	auto: '自动（按拓扑）',
	compact: '紧凑分层',
	'compact-mutex': '互斥 · 紧凑分层',
	louvain: 'Louvain 壳内 FR-3D',
	radial: '径向树',
	layered: '分层环',
	force: '3D 力导向',
	'force-mutex': '互斥 · 3D 力导向',
};

const state = {
	elements: [],
	leftIndex: -1,
	rightIndex: -1,
	merge: false,
	algorithm: 'auto',
	spacing: 1,
	showEdgeLabels: true,
	ratio: 0.5,
	viewers: {},
};

function readPayload() {
	const meta = byId(META_ID);
	if (!meta) {
		return { fileName: '', filePath: '', elements: [] };
	}
	try {
		const parsed = JSON.parse(meta.getAttribute('data-wispkit') || '{}');
		return {
			fileName: typeof parsed.fileName === 'string' ? parsed.fileName : '',
			filePath: typeof parsed.filePath === 'string' ? parsed.filePath : '',
			elements: Array.isArray(parsed.elements) ? parsed.elements : [],
		};
	} catch {
		return { fileName: '', filePath: '', elements: [] };
	}
}

function post(message) {
	if (vscodeApi) {
		vscodeApi.postMessage(message);
	}
}

function elementAt(index) {
	return index >= 0 && index < state.elements.length ? state.elements[index] : undefined;
}

function isLightTheme() {
	if (document.body.classList.contains('vscode-light')) {
		return true;
	}
	if (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')) {
		return false;
	}
	// 独立页面（自动化冒烟测试）没有 VS Code 的主题 class，按系统偏好判断。
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function cssColor(variable, fallback) {
	const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
	return value || fallback;
}

function setStatus(text, kind) {
	if (!ui.status) {
		return;
	}
	ui.status.textContent = text || '';
	if (kind === 'error') {
		ui.status.dataset.kind = 'error';
	} else {
		delete ui.status.dataset.kind;
	}
}

function setButtonLabel(button, text) {
	const label = button?.querySelector('.wispkit-3d-btn-label');
	if (label) {
		label.textContent = text;
	}
}

function optionLabel(element, index) {
	// 与绘制时一致：`void` 占位不算节点，但悬空边仍算一条边。
	const info = elementSizeInfo(element);
	const stats = `${info.nodeCount} 节点 / ${info.edgeCount} 边`;
	// element.name 里已经带了图种（例如「登录流程 · 流程图」），不再重复拼 kindLabel。
	return `${index + 1}. ${element.name} · ${stats}`;
}

function populateSelect(select) {
	if (!select) {
		return;
	}
	select.textContent = '';
	const empty = document.createElement('option');
	empty.value = '-1';
	empty.textContent = '（不选）';
	select.appendChild(empty);
	state.elements.forEach((element, index) => {
		const option = document.createElement('option');
		option.value = String(index);
		option.textContent = optionLabel(element, index);
		select.appendChild(option);
	});
}

function syncSelects() {
	if (ui.leftSelect) {
		ui.leftSelect.value = String(state.leftIndex);
	}
	if (ui.rightSelect) {
		ui.rightSelect.value = String(state.rightIndex);
	}
}

// ── 文字 Sprite ───────────────────────────────────────────────────────────

const FONT_STACK = '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

/** 单个 Sprite 纹理的边长上限；超长文字只缩字号，绝不截断。 */
const MAX_CANVAS_SIDE = 2048;

/**
 * 节点文字可用的 world 尺寸（相对气泡球半径）。
 *
 * 文字 Sprite 是穿过球心的平面，四角必须落在球轮廓内，否则长名称的最后一行
 * 会从气泡外面露出来。按原宽高比（1.92 : 1.65）求内接矩形：
 * 半宽 a、半高 b 满足 a² + b² = r² →
 *   全宽 = 2·r·1.92/√(1.92²+1.65²) ≈ 1.52r
 *   全高 = 2·r·1.65/√(1.92²+1.65²) ≈ 1.30r
 * 再留 2% 余量抵消文字描边，取 1.48r / 1.28r。
 */
const BUBBLE_TEXT_WIDTH = 1.48;
const BUBBLE_TEXT_HEIGHT = 1.28;

function createTextSprite(text, detail, maxWorldWidth, maxWorldHeight, options = {}) {
	// 长名称先按分隔符预换行（用户要求：空格 / 斜杠 / 反斜杠 / 横杠 → 换行），
	// 再交给 textLayout 做「不丢字 + 贴气泡形状」的折行。
	const rawLabel = String(text ?? '').replace(/\r/g, '');
	const label = preWrapLabel(rawLabel);
	const detailTexts = Array.isArray(detail) ? detail.slice(0, 3) : [];
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	if (!context) {
		return undefined;
	}
	// 纹理按 2× 以上的字号绘制，再缩到世界坐标；否则放大时文字会糊成色块。
	const baseMainSize = options.small ? 64 : 132;
	const baseDetailSize = options.small ? 42 : 74;
	const basePadding = options.small ? 16 : 28;
	const targetAspect = maxWorldWidth / Math.max(0.001, maxWorldHeight);
	// 短名称、用户手写换行、以及按分隔符预换行过的名称都不做「宽高比自适应」：
	// 预换行的每一段就是用户（或分隔符）想要的行，再按宽高比平衡会把
	// `textLayout.ts` 拆成 `textLayout.` + `ts`、把 `订单处理服务` 拆出单字孤行。
	// 只有「很长的连续文本（无分隔符、无换行）」才重新平衡行宽。
	const separated = label !== rawLabel;
	const adaptive = !separated && !rawLabel.includes('\n') && displayWidth(rawLabel) > LONG_LABEL_WIDTH;
	// 预换行后的单段给足宽度（约 10 个汉字），避免把本来完整的段再拆开。
	const baseWrapWidth = separated
		? baseMainSize * 10
		: options.small ? 640 : baseMainSize * 4.6;

	let plan;
	let fontScale = 1;
	let mainSize = baseMainSize;
	let detailSize = baseDetailSize;
	let padding = basePadding;
	let lineHeight = mainSize * 1.22;
	let detailLineHeight = detailSize * 1.24;

	// 文字再多也只是把字号按比例缩小：画布与字号一起缩，最终 Sprite 的
	// world size 由气泡决定，看起来一样大，但一个字符都不会少。
	for (let attempt = 0; attempt < 12; attempt += 1) {
		mainSize = baseMainSize * fontScale;
		detailSize = baseDetailSize * fontScale;
		padding = basePadding * fontScale;
		lineHeight = mainSize * 1.22;
		detailLineHeight = detailSize * 1.24;

		// 测量回调里必须自己设 font：fitLabelText 会交替调用 main/detail 两个测量函数，
		// 依赖「调用前已经设好 font」会让主文字被按 detail 字号测量 —— 画布随之变窄，
		// 绘制时主文字按原字号画出就被左右裁掉（真机截图可见）。
		const measureMain = value => {
			context.font = `600 ${mainSize}px ${FONT_STACK}`;
			return context.measureText(value).width;
		};
		const measureDetail = value => {
			context.font = `400 ${detailSize}px ${FONT_STACK}`;
			return context.measureText(value).width;
		};

		let maxLineWidth = Math.max(mainSize * 0.9, detailSize * 0.9);
		for (const raw of label.split('\n')) {
			maxLineWidth = Math.max(maxLineWidth, measureMain(raw));
		}
		for (const raw of detailTexts) {
			maxLineWidth = Math.max(maxLineWidth, measureDetail(raw));
		}

		plan = fitLabelText(label, detailTexts, {
			measureMain,
			measureDetail,
			mainLineHeight: lineHeight,
			detailLineHeight,
			padding,
			targetAspect,
			minLineWidth: adaptive ? Math.max(1, mainSize * 0.9) : baseWrapWidth * fontScale,
			maxLineWidth: adaptive ? maxLineWidth : baseWrapWidth * fontScale,
			detailLimit: 3,
		});
		if (plan.width <= MAX_CANVAS_SIDE && plan.height <= MAX_CANVAS_SIDE) {
			break;
		}
		const shrink = Math.min(MAX_CANVAS_SIDE / plan.width, MAX_CANVAS_SIDE / plan.height);
		fontScale *= Math.max(0.01, Math.min(0.95, shrink * 0.98));
	}

	canvas.width = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.ceil(plan.width)));
	canvas.height = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.ceil(plan.height)));

	const ctx = canvas.getContext('2d');
	const light = isLightTheme();
	const fill = getComputedStyle(document.body).color || (light ? '#1f1f1f' : '#e6e6e6');
	const outline = light ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.82)';
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	let y = padding + lineHeight / 2;
	ctx.font = `600 ${mainSize}px ${FONT_STACK}`;
	ctx.lineJoin = 'round';
	for (const line of plan.mainLines) {
		ctx.strokeStyle = outline;
		ctx.lineWidth = mainSize * 0.09;
		ctx.strokeText(line, canvas.width / 2, y);
		ctx.fillStyle = fill;
		ctx.fillText(line, canvas.width / 2, y);
		y += lineHeight;
	}
	ctx.font = `400 ${detailSize}px ${FONT_STACK}`;
	ctx.globalAlpha = 0.8;
	for (const line of plan.detailLines) {
		ctx.strokeStyle = outline;
		ctx.lineWidth = detailSize * 0.09;
		ctx.strokeText(line, canvas.width / 2, y);
		ctx.fillStyle = fill;
		ctx.fillText(line, canvas.width / 2, y);
		y += detailLineHeight;
	}
	ctx.globalAlpha = 1;

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.generateMipmaps = true;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.anisotropy = 4;
	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthTest: true,
		depthWrite: false,
		sizeAttenuation: true,
	});
	const sprite = new THREE.Sprite(material);
	const scale = Math.min(maxWorldWidth / canvas.width, maxWorldHeight / canvas.height);
	sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
	sprite.center.set(0.5, 0.5);
	sprite.renderOrder = 30;
	// 自检钩子：探针可以核对「所有字符都在」以及贴气泡的尺寸。
	sprite.userData.labelPlan = {
		text: rawLabel,
		wrapped: label,
		mainLines: plan.mainLines.slice(),
		detailLines: plan.detailLines.slice(),
		canvasWidth: canvas.width,
		canvasHeight: canvas.height,
		worldWidth: canvas.width * scale,
		worldHeight: canvas.height * scale,
	};
	return sprite;
}

// ── 图片 Sprite ───────────────────────────────────────────────────────────

/** 图片纹理边长上限；超大截图先等比缩到画布，再上传 GPU。 */
const MAX_IMAGE_TEXTURE_SIDE = 2048;

/**
 * 节点图片：与文字 Sprite 一样始终面向相机，画在气泡球心。
 *
 * 尺寸规则（用户要求「图片边角要顶着气泡球上」）：矩形四角到球心的距离
 * 必须等于气泡半径 r —— 半宽 a、半高 b 满足 √(a²+b²) = r。因此按图片原始
 * 宽高比缩放 `scale = r / √((w/2)²+(h/2)²)`，四角正好落在球面的赤道上，
 * 整张图都在球内，不会从气泡轮廓外露。
 *
 * 图片加载期间先隐藏文字兜底 Sprite；加载成功就一直保持隐藏（气泡只呈现
 * 图片）；解码失败（扩展名对但内容坏掉）则重新显示文字。
 */
function createImageSprite(node, radius, fallbackSprite) {
	const src = node?.image?.src;
	if (typeof src !== 'string' || src.length === 0) {
		return undefined;
	}
	const material = new THREE.SpriteMaterial({
		transparent: true,
		depthTest: true,
		depthWrite: false,
		sizeAttenuation: true,
	});
	const sprite = new THREE.Sprite(material);
	sprite.position.set(node.x, node.y, node.z);
	sprite.renderOrder = 32;
	sprite.visible = false;
	if (fallbackSprite) {
		fallbackSprite.visible = false;
	}

	const image = new Image();
	image.decoding = 'async';
	image.onload = () => {
		try {
			const naturalWidth = image.naturalWidth || image.width;
			const naturalHeight = image.naturalHeight || image.height;
			if (!naturalWidth || !naturalHeight) {
				throw new Error('图片尺寸为 0');
			}
			const shrink = Math.min(1, MAX_IMAGE_TEXTURE_SIDE / Math.max(naturalWidth, naturalHeight));
			const width = Math.max(1, Math.round(naturalWidth * shrink));
			const height = Math.max(1, Math.round(naturalHeight * shrink));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d');
			if (!context) {
				throw new Error('无法创建 2D 画布');
			}
			context.drawImage(image, 0, 0, width, height);

			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.generateMipmaps = true;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.anisotropy = 4;
			material.map = texture;
			material.needsUpdate = true;

			const halfDiagonal = Math.sqrt(width * width + height * height) / 2;
			const scale = radius / Math.max(0.0001, halfDiagonal);
			sprite.scale.set(width * scale, height * scale, 1);
			sprite.visible = true;
			sprite.userData.imagePlan = {
				nodeId: node.id,
				alt: node.image?.alt ?? node.label,
				path: node.image?.path,
				mime: node.image?.mime,
				pixelWidth: width,
				pixelHeight: height,
				worldWidth: width * scale,
				worldHeight: height * scale,
				radius,
				cornerDistance: Math.sqrt((width * scale / 2) ** 2 + (height * scale / 2) ** 2),
				textHidden: Boolean(fallbackSprite && !fallbackSprite.visible),
			};
		} catch {
			if (fallbackSprite) {
				fallbackSprite.visible = true;
			}
		}
	};
	image.onerror = () => {
		if (fallbackSprite) {
			fallbackSprite.visible = true;
		}
	};
	image.src = src;
	return sprite;
}

// ── 节点颜色 / 气泡材质 ───────────────────────────────────────────────────

function hashText(text) {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function nodeColor(key) {
	const hue = (hashText(key) % 360) / 360;
	const light = isLightTheme();
	const color = new THREE.Color();
	color.setHSL(hue, 0.62, light ? 0.48 : 0.64);
	return color;
}

const BUBBLE_VERTEX = `
varying vec3 vNormalW;
varying vec3 vViewDir;
void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vNormalW = normalize(mat3(modelMatrix) * normal);
	vViewDir = normalize(cameraPosition - world.xyz);
	gl_Position = projectionMatrix * viewMatrix * world;
}`;

const BUBBLE_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main() {
	float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 2.1);
	// 中心几乎全透明（约 3%），边缘描出一圈可见的气泡轮廓。
	float alpha = (0.028 + fresnel * 0.22) * uOpacity;
	vec3 color = uColor * (0.82 + fresnel * 0.9);
	gl_FragColor = vec4(color, alpha);
}`;

function createBubble(radius, color) {
	const geometry = new THREE.SphereGeometry(radius, 30, 20);
	const material = new THREE.ShaderMaterial({
		uniforms: {
			uColor: { value: color },
			uOpacity: { value: 1 },
		},
		vertexShader: BUBBLE_VERTEX,
		fragmentShader: BUBBLE_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.renderOrder = 10;
	return mesh;
}

function disposeObject(object) {
	object.traverse(child => {
		if (child.geometry) {
			child.geometry.dispose();
		}
		if (child.material) {
			const materials = Array.isArray(child.material) ? child.material : [child.material];
			for (const material of materials) {
				if (material.map) {
					material.map.dispose();
				}
				material.dispose();
			}
		}
	});
}

// ── 单个 3D 视图 ─────────────────────────────────────────────────────────

class GraphViewer {
	constructor(stage, titleEl, statsEl, emptyEl, errorEl, tooltipEl) {
		this.stage = stage;
		this.titleEl = titleEl;
		this.statsEl = statsEl;
		this.emptyEl = emptyEl;
		this.errorEl = errorEl;
		this.tooltip = tooltipEl;
		this.visible = false;
		this.element = undefined;
		this.spacing = 1;
		this.algorithm = 'auto';
		this.showEdgeLabels = state.showEdgeLabels;
		this.edgeLabelSprites = [];
		this.hoverTargets = [];
		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
		this.dragging = false;
		this.layout = undefined;
		this.width = 1;
		this.height = 1;
		this.failed = false;
		this.currentRadius = 1;
		this.currentCenter = new THREE.Vector3();
		this.pendingFit = false;
		this.sized = false;
		this.userInteracted = false;
		this.raf = 0;

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100000);
		this.camera.position.set(0, 0, 10);
		try {
			this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
			this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			this.renderer.setClearColor(0x000000, 0);
			this.renderer.outputColorSpace = THREE.SRGBColorSpace;
			this.renderer.domElement.setAttribute('aria-hidden', 'true');
			stage.appendChild(this.renderer.domElement);
		} catch (error) {
			this.failed = true;
			this.renderer = undefined;
			this.showError(`无法创建 WebGL 上下文：${error instanceof Error ? error.message : String(error)}`);
		}

		this.controls = this.renderer
			? new OrbitControls(this.camera, this.renderer.domElement)
			: undefined;
		if (this.controls) {
			this.controls.enableDamping = true;
			this.controls.dampingFactor = 0.09;
			this.controls.screenSpacePanning = true;
			this.controls.rotateSpeed = 0.82;
			this.controls.panSpeed = 0.9;
			this.controls.zoomSpeed = 1.05;
			this.controls.mouseButtons = {
				LEFT: THREE.MOUSE.ROTATE,
				MIDDLE: THREE.MOUSE.DOLLY,
				RIGHT: THREE.MOUSE.PAN,
			};
			this.controls.touches = {
				ONE: THREE.TOUCH.ROTATE,
				TWO: THREE.TOUCH.DOLLY_PAN,
			};
			this.controls.minDistance = 0.2;
			this.controls.maxDistance = 100000;
			this.controls.addEventListener('start', () => {
				this.userInteracted = true;
			});
		}

		this.scene.add(new THREE.AmbientLight(0xffffff, 1.25));
		const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
		keyLight.position.set(8, 14, 10);
		this.scene.add(keyLight);
		const fillLight = new THREE.DirectionalLight(0x9fc4ff, 0.5);
		fillLight.position.set(-10, -6, -8);
		this.scene.add(fillLight);
		this.light = keyLight;

		this.root = new THREE.Group();
		this.scene.add(this.root);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(stage);

		// 悬停节点气泡时显示注释 tooltip。拖动 / 缩放时先隐藏，避免跟着鼠标乱跳。
		this.onPointerMove = event => this.updateHover(event);
		this.onPointerLeave = () => this.hideTooltip();
		this.onPointerDown = () => {
			this.dragging = true;
			this.hideTooltip();
		};
		this.onPointerUp = () => {
			this.dragging = false;
		};
		this.onWheel = () => this.hideTooltip();
		stage.addEventListener('pointermove', this.onPointerMove);
		stage.addEventListener('pointerleave', this.onPointerLeave);
		stage.addEventListener('pointerdown', this.onPointerDown);
		stage.addEventListener('wheel', this.onWheel, { passive: true });
		window.addEventListener('pointerup', this.onPointerUp);

		this.tick = this.tick.bind(this);
		this.raf = requestAnimationFrame(this.tick);
	}

	tick() {
		this.raf = requestAnimationFrame(this.tick);
		if (!this.visible || !this.element || this.failed) {
			return;
		}
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}

	resize() {
		if (this.failed) {
			return;
		}
		const actualWidth = this.stage.clientWidth;
		const actualHeight = this.stage.clientHeight;
		if (actualWidth > 0 && actualHeight > 0) {
			this.sized = true;
		}
		const width = Math.max(1, actualWidth);
		const height = Math.max(1, actualHeight);
		if (width === this.width && height === this.height) {
			if (this.pendingFit && this.element) {
				this.pendingFit = false;
				this.fit();
			}
			return;
		}
		this.width = width;
		this.height = height;
		this.renderer.setSize(width, height, false);
		this.renderer.domElement.style.width = '100%';
		this.renderer.domElement.style.height = '100%';
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		if (this.element && (this.pendingFit || !this.userInteracted)) {
			this.pendingFit = false;
			this.fit();
		}
	}

	setVisible(visible) {
		this.visible = visible;
		if (!visible) {
			this.hideTooltip();
		}
		if (visible) {
			this.resize();
			if (!this.element && this.element !== null) {
				// 由上层决定空状态文案，这里不覆盖。
			}
		}
	}

	setElement(element, spacing) {
		this.element = element;
		this.spacing = spacing;
		this.userInteracted = false;
		this.rebuild(false);
	}

	setSpacing(spacing) {
		if (this.spacing === spacing) {
			return;
		}
		this.spacing = spacing;
		if (this.element) {
			this.rebuild(true);
		}
	}

	/** 切换布局算法：立即重新布局并重绘；保留相机的相对视角。 */
	setAlgorithm(algorithm) {
		const next = Object.prototype.hasOwnProperty.call(ALGORITHM_LABELS, algorithm) ? algorithm : 'auto';
		if (this.algorithm === next) {
			return;
		}
		this.algorithm = next;
		if (this.element) {
			this.rebuild(true);
		}
	}

	clearOverlays() {
		if (this.emptyEl) {
			this.emptyEl.hidden = true;
		}
		if (this.errorEl) {
			this.errorEl.hidden = true;
		}
	}

	showEmpty(text) {
		if (this.emptyEl) {
			this.emptyEl.textContent = text;
			this.emptyEl.hidden = false;
		}
		if (this.errorEl) {
			this.errorEl.hidden = true;
		}
	}

	showError(text) {
		if (this.errorEl) {
			this.errorEl.textContent = text;
			this.errorEl.hidden = false;
		}
		if (this.emptyEl) {
			this.emptyEl.hidden = true;
		}
	}

	clearRoot() {
		this.edgeLabelSprites = [];
		this.hoverTargets = [];
		this.resetTooltip();
		while (this.root.children.length > 0) {
			const child = this.root.children[0];
			this.root.remove(child);
			disposeObject(child);
		}
	}

	rebuild(preserveView) {
		if (this.failed) {
			return;
		}
		if (this.titleEl) {
			this.titleEl.textContent = this.element ? this.element.name : '';
		}
		if (!this.element) {
			this.clearRoot();
			this.layout = undefined;
			if (this.statsEl) {
				this.statsEl.textContent = '';
			}
			return;
		}
		let layout;
		try {
			layout = layoutGraph(this.element, { spacing: this.spacing, algorithm: this.algorithm });
		} catch (error) {
			this.showError(`布局失败：${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		this.layout = layout;
		const previous = preserveView
			? {
				offset: this.camera.position.clone().sub(this.controls.target),
				target: this.controls.target.clone(),
				// 间隔变化会改变整张图的包围半径；相机距离按同一比例缩放，
				// 否则 3× 间隔时节点会被推到视口外，只能靠「重置视角」救回来。
				radius: Math.max(0.0001, this.currentRadius),
			}
			: undefined;

		this.clearRoot();
		this.clearOverlays();
		if (this.statsEl) {
			const note = this.element.note ? ` · ${this.element.note}` : '';
			const mutex = layout.mutex
				? ` · 互斥：左核「${shortLabel(layout.mutex.leftCoreLabel)}」· 右核「${shortLabel(layout.mutex.rightCoreLabel)}」`
				: '';
			const dangling = layout.danglingEdgeCount > 0 ? ` · ${layout.danglingEdgeCount} 悬空` : '';
			this.statsEl.textContent = `${kindLabel(this.element.kind)} · ${layout.nodes.length} 节点 · ${layout.edges.length} 边${dangling}${mutex}${note}`;
		}
		if (layout.nodes.length === 0) {
			this.showEmpty(this.element.note || '这个图元素没有可显示的节点。');
			return;
		}

		const nodeMap = new Map();
		for (const node of layout.nodes) {
			const color = nodeColor(node.group || node.id);
			const bubble = createBubble(node.radius, color);
			bubble.position.set(node.x, node.y, node.z);
			if (node.comment) {
				// 只对带注释的节点做悬停检测；气泡本身在 3D 里是半透明的，
				// 用解析球（而不是逐三角面 raycast）判断鼠标是否落在气泡区域。
				this.hoverTargets.push({
					sphere: new THREE.Sphere(
						new THREE.Vector3(node.x, node.y, node.z),
						node.radius * 1.06,
					),
					node,
				});
			}
			const sprite = createTextSprite(
				node.label,
				node.detail,
				node.radius * BUBBLE_TEXT_WIDTH,
				node.radius * BUBBLE_TEXT_HEIGHT,
			);
			if (sprite) {
				sprite.position.set(node.x, node.y, node.z);
				this.root.add(sprite);
			}
			// 链接到有效图片的节点：气泡里画图片、不显示文字。图片成功解码前
			// 文字保持隐藏（气泡只呈现图片）；解码失败时 createImageSprite 会把
			// 文字重新显示出来，作为坏图 / 不支持的天然兜底。
			if (node.image && typeof node.image.src === 'string' && node.image.src) {
				const imageSprite = createImageSprite(node, node.radius, sprite);
				if (imageSprite) {
					this.root.add(imageSprite);
				}
			}
			// 中心的小光点，让透明气泡有个“核心”。
			const core = new THREE.Mesh(
				new THREE.SphereGeometry(Math.max(0.035, node.radius * 0.07), 10, 8),
				new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
			);
			core.position.copy(bubble.position);
			core.renderOrder = 12;
			this.root.add(core);
			this.root.add(bubble);
			nodeMap.set(node.id, node);
		}

		const edgeColor = new THREE.Color(cssColor('--vscode-charts-blue', isLightTheme() ? '#2f6fb3' : '#7db4ff'));
		const mutedColor = new THREE.Color(cssColor('--vscode-descriptionForeground', isLightTheme() ? '#555555' : '#a8a8a8'));
		for (const edge of layout.edges) {
			this.addEdge(edge, nodeMap, edgeColor, mutedColor);
		}

		this.currentCenter.set(layout.bounds.center.x, layout.bounds.center.y, layout.bounds.center.z);
		this.currentRadius = Math.max(0.5, layout.bounds.radius);
		if (previous && previous.offset.lengthSq() > 0.0001) {
			const scale = this.currentRadius / previous.radius;
			this.controls.target.copy(this.currentCenter);
			this.camera.position.copy(this.currentCenter).addScaledVector(previous.offset, scale);
			const distance = this.camera.position.distanceTo(this.controls.target);
			this.camera.near = Math.max(0.05, distance / 2000);
			this.camera.far = Math.max(2000, distance * 20 + this.currentRadius * 12);
			this.camera.updateProjectionMatrix();
			this.controls.update();
		} else {
			this.pendingFit = true;
			this.fit();
		}
	}

	trimPoints(edge, nodeMap) {
		const points = edge.points.map(point => new THREE.Vector3(point.x, point.y, point.z));
		if (points.length < 2) {
			return points;
		}
		const source = nodeMap.get(edge.source);
		const target = nodeMap.get(edge.target);
		if (points.length === 2 && edge.source !== edge.target) {
			const direction = points[1].clone().sub(points[0]);
			const length = direction.length();
			if (length > 0.001) {
				const unit = direction.normalize();
				const startTrim = Math.min((source?.radius ?? 0) * 0.9, length * 0.4);
				const endTrim = Math.min((target?.radius ?? 0) * 0.9, length * 0.4);
				points[0] = points[0].clone().addScaledVector(unit, startTrim);
				points[1] = points[1].clone().addScaledVector(unit, -endTrim);
			}
		} else if (points.length === 3) {
			const direction = points[1].clone().sub(points[0]);
			if (direction.length() > 0.001) {
				points[0] = points[0].clone().addScaledVector(direction.normalize(), (source?.radius ?? 0) * 0.9);
			}
			const back = points[1].clone().sub(points[2]);
			if (back.length() > 0.001) {
				points[2] = points[2].clone().addScaledVector(back.normalize(), (target?.radius ?? 0) * 0.9);
			}
		}
		return points;
	}

	curveFor(points) {
		if (points.length === 2) {
			return new THREE.LineCurve3(points[0], points[1]);
		}
		if (points.length === 3) {
			return new THREE.QuadraticBezierCurve3(points[0], points[1], points[2]);
		}
		return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25);
	}

	addEdge(edge, nodeMap, edgeColor, mutedColor) {
		const points = this.trimPoints(edge, nodeMap);
		if (points.length < 2) {
			return;
		}
		const curve = this.curveFor(points);
		const length = Math.max(0.001, curve.getLength());
		const thickness = Math.max(0.012, Math.min(0.075, length * 0.014));
		const material = new THREE.MeshBasicMaterial({
			color: edge.dashed ? mutedColor : edgeColor,
			transparent: true,
			opacity: edge.dashed ? 0.32 : 0.62,
			depthWrite: false,
		});
		const tube = new THREE.Mesh(
			new THREE.TubeGeometry(curve, Math.max(10, Math.min(80, Math.ceil(length * 2.2))), thickness, 6, false),
			material,
		);
		tube.renderOrder = 5;
		this.root.add(tube);

		if (edge.arrow && edge.arrow !== 'none') {
			const end = curve.getPoint(0.985);
			const tangent = curve.getTangent(0.985).normalize();
			const height = Math.max(0.16, thickness * 7.5);
			const cone = new THREE.Mesh(
				new THREE.ConeGeometry(height * 0.42, height, 8),
				new THREE.MeshBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.72, depthWrite: false }),
			);
			cone.position.copy(end).addScaledVector(tangent, -height * 0.45);
			cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
			cone.renderOrder = 6;
			this.root.add(cone);
		}
		if (edge.arrow === 'both') {
			const start = curve.getPoint(0.015);
			const tangent = curve.getTangent(0.015).normalize().negate();
			const height = Math.max(0.16, thickness * 7.5);
			const cone = new THREE.Mesh(
				new THREE.ConeGeometry(height * 0.42, height, 8),
				new THREE.MeshBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.72, depthWrite: false }),
			);
			cone.position.copy(start).addScaledVector(tangent, -height * 0.45);
			cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
			cone.renderOrder = 6;
			this.root.add(cone);
		}

		if (edge.label) {
			// 标签高度跟两端节点半径挂钩：太小读不清，太大在时序图里会盖住弧线。
			const scale = ((nodeMap.get(edge.source)?.radius ?? 1) + (nodeMap.get(edge.target)?.radius ?? 1)) * 0.36;
			const labelHeight = Math.min(0.95, Math.max(0.42, scale));
			const labelSprite = createTextSprite(
				edge.label,
				undefined,
				Math.max(1.1, String(edge.label).length * 0.18),
				labelHeight,
				{ small: true },
			);
			if (labelSprite) {
				// 数据流名称放在连线中点上方一点；显隐由工具栏「显示数据流名称」控制。
				// 悬空边没有对端气泡，文字往悬空端挪：否则长名称会压在真实节点的
				// 气泡文字上，看起来比连线本身还挤。
				let labelT = 0.5;
				if (edge.dangling) {
					const sourceIsReal = nodeMap.has(edge.source);
					labelT = sourceIsReal ? 0.72 : 0.28;
				}
				labelSprite.position.copy(curve.getPoint(labelT));
				labelSprite.position.y += labelHeight * 0.3;
				labelSprite.renderOrder = 31;
				labelSprite.visible = this.showEdgeLabels;
				this.edgeLabelSprites.push(labelSprite);
				this.root.add(labelSprite);
			}
		}
	}

	setShowEdgeLabels(show) {
		this.showEdgeLabels = Boolean(show);
		for (const sprite of this.edgeLabelSprites) {
			sprite.visible = this.showEdgeLabels;
		}
	}

	hideTooltip() {
		if (this.tooltip) {
			this.tooltip.hidden = true;
		}
	}

	resetTooltip() {
		this.hideTooltip();
		if (this.tooltip) {
			this.tooltip.textContent = '';
			delete this.tooltip.dataset.nodeId;
		}
	}

	showTooltip(node, event) {
		if (!this.tooltip || !node || !node.comment) {
			this.hideTooltip();
			return;
		}
		if (this.tooltip.dataset.nodeId !== node.id) {
			// 用 DOM 节点 + textContent 拼装，注释里的尖括号按纯文本显示。
			this.tooltip.textContent = '';
			const title = document.createElement('div');
			title.className = 'wispkit-3d-tooltip-title';
			title.textContent = node.label || '节点';
			const body = document.createElement('div');
			body.className = 'wispkit-3d-tooltip-body';
			body.textContent = node.comment;
			this.tooltip.appendChild(title);
			this.tooltip.appendChild(body);
			this.tooltip.dataset.nodeId = node.id;
		}
		this.tooltip.hidden = false;
		const rect = this.stage.getBoundingClientRect();
		const width = this.tooltip.offsetWidth;
		const height = this.tooltip.offsetHeight;
		let left = event.clientX - rect.left + 14;
		let top = event.clientY - rect.top + 14;
		if (left + width > rect.width - 8) {
			left = Math.max(8, event.clientX - rect.left - width - 14);
		}
		if (top + height > rect.height - 8) {
			top = Math.max(8, event.clientY - rect.top - height - 14);
		}
		this.tooltip.style.left = `${Math.round(left)}px`;
		this.tooltip.style.top = `${Math.round(top)}px`;
	}

	updateHover(event) {
		if (!this.visible || this.failed || !this.renderer || this.dragging || this.hoverTargets.length === 0) {
			this.hideTooltip();
			return;
		}
		const rect = this.renderer.domElement.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}
		const x = (event.clientX - rect.left) / rect.width;
		const y = (event.clientY - rect.top) / rect.height;
		if (x < 0 || x > 1 || y < 0 || y > 1) {
			this.hideTooltip();
			return;
		}
		this.pointer.set(x * 2 - 1, -(y * 2 - 1));
		this.camera.updateMatrixWorld();
		this.raycaster.setFromCamera(this.pointer, this.camera);
		let hit;
		let best = Infinity;
		for (const target of this.hoverTargets) {
			if (!this.raycaster.ray.intersectsSphere(target.sphere)) {
				continue;
			}
			const distance = this.raycaster.ray.origin.distanceToSquared(target.sphere.center);
			if (distance < best) {
				best = distance;
				hit = target;
			}
		}
		if (hit) {
			this.showTooltip(hit.node, event);
		} else {
			this.hideTooltip();
		}
	}

	fit() {
		if (this.failed) {
			return;
		}
		const aspect = this.width / Math.max(1, this.height);
		const verticalFov = (this.camera.fov * Math.PI) / 180;
		const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
		const limiting = Math.min(verticalFov, horizontalFov);
		// 树从更低的角度看，层级（Y 方向）在屏幕上的分离更明显；
		// 时序图也放低一点，弧线与消息标签不容易叠在一起。
		const strategy = this.layout?.strategy;
		// 紧凑分层是一张张平行平面，用更低的角度看层级更清楚；
		// Louvain 壳层本身是立体的，保持默认斜俯视。
		const elevation = strategy === 'tree' ? 0.3
			: strategy === 'compact' || strategy === 'compact-mutex' ? 0.42
				: strategy === 'sequence' ? 0.34 : 0.62;
		const direction = new THREE.Vector3(1, elevation, 1.15).normalize();
		let distance = (this.currentRadius / Math.sin(limiting / 2)) * 1.05;
		// 用节点中心 + 边上的控制点做投影收敛。AABB 的 8 个角在斜视角下
		// 会包含没有几何体的“空角”，把图缩得过小；实际节点点集更贴近屏幕占比。
		const fitPoints = [];
		if (this.layout) {
			for (const node of this.layout.nodes) {
				fitPoints.push(new THREE.Vector3(node.x, node.y, node.z));
			}
			for (const edge of this.layout.edges) {
				for (const point of edge.points) {
					fitPoints.push(new THREE.Vector3(point.x, point.y, point.z));
				}
			}
		}
		if (fitPoints.length < 2) {
			this.camera.position.copy(this.currentCenter).addScaledVector(direction, distance);
			this.camera.lookAt(this.currentCenter);
			this.camera.updateMatrixWorld(true);
			this.camera.updateProjectionMatrix();
		} else {
			for (let iteration = 0; iteration < 7; iteration += 1) {
				this.camera.position.copy(this.currentCenter).addScaledVector(direction, distance);
				this.camera.lookAt(this.currentCenter);
				this.camera.updateMatrixWorld(true);
				this.camera.updateProjectionMatrix();
				let maxNdc = 0;
				for (const point of fitPoints) {
					const projected = point.clone().project(this.camera);
					if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
						maxNdc = Math.max(maxNdc, Math.abs(projected.x), Math.abs(projected.y));
					}
				}
				if (!Number.isFinite(maxNdc) || maxNdc <= 0.0001) {
					break;
				}
				const target = 0.86;
				if (Math.abs(maxNdc - target) < 0.012) {
					break;
				}
				distance *= maxNdc / target;
				distance = Math.max(this.currentRadius * 0.15, Math.min(this.currentRadius * 400 + 10, distance));
			}
			// 给节点半径和文字留一点边距。
			distance *= 1.1;
		}
		this.camera.position.copy(this.currentCenter).addScaledVector(direction, distance);
		this.camera.lookAt(this.currentCenter);
		this.controls.target.copy(this.currentCenter);
		this.camera.near = Math.max(0.05, distance / 2500);
		this.camera.far = Math.max(4000, distance * 22 + this.currentRadius * 14);
		this.camera.updateProjectionMatrix();
		this.controls.minDistance = Math.max(0.15, this.currentRadius * 0.04);
		this.controls.maxDistance = Math.max(distance * 14, this.currentRadius * 14);
		this.controls.update();
	}

	resetView() {
		if (this.element) {
			this.userInteracted = false;
			this.fit();
		}
	}

	dispose() {
		cancelAnimationFrame(this.raf);
		this.resizeObserver.disconnect();
		this.stage.removeEventListener('pointermove', this.onPointerMove);
		this.stage.removeEventListener('pointerleave', this.onPointerLeave);
		this.stage.removeEventListener('pointerdown', this.onPointerDown);
		this.stage.removeEventListener('wheel', this.onWheel);
		window.removeEventListener('pointerup', this.onPointerUp);
		this.hideTooltip();
		if (this.controls) {
			this.controls.dispose();
		}
		this.clearRoot();
		if (this.renderer) {
			this.renderer.dispose();
			if (this.renderer.domElement.parentElement) {
				this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
			}
		}
	}
}

// ── 视图实例与分栏 ────────────────────────────────────────────────────────

function createViewer(side) {
	const stage = byId(`wispkit-3d-${side}-stage`);
	const title = byId(`wispkit-3d-${side}-title`);
	const stats = byId(`wispkit-3d-${side}-stats`);
	const empty = byId(`wispkit-3d-${side}-empty`);
	const error = byId(`wispkit-3d-${side}-error`);
	const tooltip = byId(`wispkit-3d-${side}-tooltip`);
	if (!stage) {
		return undefined;
	}
	return new GraphViewer(stage, title, stats, empty, error, tooltip);
}

function initViewers() {
	for (const side of [LEFT, RIGHT, MERGED]) {
		try {
			state.viewers[side] = createViewer(side);
		} catch (error) {
			const stage = byId(`wispkit-3d-${side}-stage`);
			if (stage) {
				stage.textContent = `初始化 3D 视图失败：${error instanceof Error ? error.message : String(error)}`;
			}
		}
	}
}

function viewerFor(side) {
	return state.viewers[side];
}

function applyRatio() {
	if (!ui.leftPane || !ui.rightPane) {
		return;
	}
	ui.leftPane.style.flexGrow = String(state.ratio);
	ui.rightPane.style.flexGrow = String(1 - state.ratio);
	ui.leftPane.style.flexBasis = '0';
	ui.rightPane.style.flexBasis = '0';
}

function updatePanes() {
	const leftElement = elementAt(state.leftIndex);
	const rightElement = elementAt(state.rightIndex);
	const both = Boolean(leftElement && rightElement);

	if (state.merge && both) {
		if (ui.leftPane) {
			ui.leftPane.hidden = true;
		}
		if (ui.rightPane) {
			ui.rightPane.hidden = true;
		}
		if (ui.splitter) {
			ui.splitter.hidden = true;
		}
		if (ui.mergedPane) {
			ui.mergedPane.hidden = false;
		}
		setButtonLabel(ui.merge, '取消合并');
		if (ui.merge) {
			ui.merge.dataset.active = 'true';
		}
		const leftViewer = viewerFor(LEFT);
		const rightViewer = viewerFor(RIGHT);
		if (leftViewer) {
			leftViewer.setVisible(false);
		}
		if (rightViewer) {
			rightViewer.setVisible(false);
		}
		const mergedViewer = viewerFor(MERGED);
		if (mergedViewer) {
			const merged = mergeElements(leftElement, rightElement);
			mergedViewer.setVisible(true);
			mergedViewer.setElement(merged.element, state.spacing);
		}
		if (ui.merge) {
			ui.merge.title = mergedTitle(leftElement, rightElement);
		}
		return;
	}

	if (state.merge && !both) {
		state.merge = false;
	}
	setButtonLabel(ui.merge, '合并左右');
	if (ui.merge) {
		delete ui.merge.dataset.active;
		ui.merge.disabled = !both;
		ui.merge.title = both
			? '把左右两个图元素合并为一个 3D，同名节点会合并'
			: '左右两侧都选中图元素后才能合并';
	}
	if (ui.mergedPane) {
		ui.mergedPane.hidden = true;
	}
	const mergedViewer = viewerFor(MERGED);
	if (mergedViewer) {
		mergedViewer.setVisible(false);
	}

	// 只选中一边时另一边整块隐藏，可见的一边占 100%。
	if (ui.leftPane) {
		ui.leftPane.hidden = !leftElement;
		ui.leftPane.style.flexGrow = '1';
		ui.leftPane.style.flexBasis = '0';
	}
	if (ui.rightPane) {
		ui.rightPane.hidden = !rightElement;
		ui.rightPane.style.flexGrow = '1';
		ui.rightPane.style.flexBasis = '0';
	}
	if (!leftElement && !rightElement) {
		if (ui.leftPane) {
			ui.leftPane.hidden = false;
		}
		const leftViewer = viewerFor(LEFT);
		if (leftViewer) {
			leftViewer.setVisible(true);
			leftViewer.setElement(undefined, state.spacing);
			leftViewer.showEmpty('请选择图元素；如果文档里没有图元素，插入 ```mermaid 代码块或包含 ├── 的 ASCII 树后点「刷新」。');
		}
	}
	if (ui.splitter) {
		ui.splitter.hidden = !(leftElement && rightElement);
	}
	if (leftElement && rightElement) {
		applyRatio();
	}

	const leftViewer = viewerFor(LEFT);
	if (leftViewer) {
		leftViewer.setVisible(Boolean(leftElement));
		if (leftElement) {
			leftViewer.setElement(leftElement, state.spacing);
		}
	}
	const rightViewer = viewerFor(RIGHT);
	if (rightViewer) {
		rightViewer.setVisible(Boolean(rightElement));
		if (rightElement) {
			rightViewer.setElement(rightElement, state.spacing);
		}
	}
}

function mergedTitle(left, right) {
	return `合并：${left.name} + ${right.name}（同名节点自动合并）`;
}

function updateSelectionFromControls() {
	const leftValue = Number(ui.leftSelect?.value ?? '-1');
	const rightValue = Number(ui.rightSelect?.value ?? '-1');
	state.leftIndex = Number.isInteger(leftValue) && leftValue >= 0 && leftValue < state.elements.length ? leftValue : -1;
	state.rightIndex = Number.isInteger(rightValue) && rightValue >= 0 && rightValue < state.elements.length ? rightValue : -1;
	if (state.merge && (state.leftIndex < 0 || state.rightIndex < 0)) {
		state.merge = false;
	}
	updatePanes();
}

function applyElements(elements, message) {
	const previousLeft = elementAt(state.leftIndex);
	const previousRight = elementAt(state.rightIndex);
	const hadElements = state.elements.length > 0;
	state.elements = Array.isArray(elements) ? elements : [];
	state.leftIndex = resolveLeftSelection(previousLeft, state.elements, hadElements);
	state.rightIndex = resolveRightSelection(previousRight, state.elements);
	if (state.merge && (state.leftIndex < 0 || state.rightIndex < 0)) {
		state.merge = false;
	}
	populateSelect(ui.leftSelect);
	populateSelect(ui.rightSelect);
	syncSelects();
	updatePanes();
	setStatus(message || `已重新解析：${state.elements.length} 个图元素`, 'ok');
}

function elementCounts() {
	const totalNodes = state.elements.reduce((sum, element) => sum + elementSizeInfo(element).nodeCount, 0);
	return `${state.elements.length} 个图元素 · ${totalNodes} 个节点`;
}

function setupToolbar() {
	ui.leftSelect?.addEventListener('change', updateSelectionFromControls);
	ui.rightSelect?.addEventListener('change', updateSelectionFromControls);

	ui.merge?.addEventListener('click', () => {
		const both = Boolean(elementAt(state.leftIndex) && elementAt(state.rightIndex));
		if (!both) {
			setStatus('需要左右两侧都选中图元素才能合并。', 'error');
			return;
		}
		state.merge = !state.merge;
		updatePanes();
		if (state.merge) {
			const merged = mergeElements(elementAt(state.leftIndex), elementAt(state.rightIndex));
			setStatus(merged.mergedNodeCount > 0
				? `已合并左右图元素：合并了 ${merged.mergedNodeCount} 个同名节点，比例与间隔仍可调。`
				: '已合并左右图元素：两侧没有同名节点，已放在同一个 3D 场景里。');
		} else {
			setStatus('已取消合并。');
		}
	});

	ui.reset?.addEventListener('click', () => {
		for (const viewer of Object.values(state.viewers)) {
			if (viewer?.visible) {
				viewer.resetView();
			}
		}
		setStatus('视角已复位。');
	});

	let spacingTimer;
	ui.spacing?.addEventListener('input', () => {
		state.spacing = Math.max(0.25, Math.min(3, Number(ui.spacing.value) || 1));
		if (ui.spacingValue) {
			ui.spacingValue.textContent = `${state.spacing.toFixed(2)}×`;
		}
		clearTimeout(spacingTimer);
		spacingTimer = setTimeout(() => {
			for (const viewer of Object.values(state.viewers)) {
				if (viewer?.visible) {
					viewer.setSpacing(state.spacing);
				}
			}
			setStatus(`已按 ${state.spacing.toFixed(2)}× 间隔重新布局。`);
		}, 90);
	});

	ui.algorithm?.addEventListener('change', () => {
		const value = ui.algorithm.value;
		state.algorithm = ALGORITHM_LABELS[value] ? value : 'auto';
		for (const viewer of Object.values(state.viewers)) {
			viewer?.setAlgorithm(state.algorithm);
		}
		const mutexHint = (state.algorithm === 'compact-mutex' || state.algorithm === 'force-mutex') && !state.merge
			? '（互斥效果只在合并左右图后生效）'
			: '';
		setStatus(`已切换到「${ALGORITHM_LABELS[state.algorithm]}」布局并重新绘制。${mutexHint}`);
	});

	ui.edgeLabels?.addEventListener('change', () => {
		state.showEdgeLabels = Boolean(ui.edgeLabels.checked);
		for (const viewer of Object.values(state.viewers)) {
			viewer?.setShowEdgeLabels(state.showEdgeLabels);
		}
		setStatus(state.showEdgeLabels ? '已显示数据流名称。' : '已隐藏数据流名称。');
	});

	ui.refresh?.addEventListener('click', () => {
		if (!vscodeApi) {
			setStatus('刷新需要在 VS Code 的 3D 浏览面板中使用。', 'error');
			return;
		}
		ui.refresh.disabled = true;
		setButtonLabel(ui.refresh, '刷新中…');
		post({ type: 'wispkit.graph3d.refresh' });
		setTimeout(() => {
			if (ui.refresh) {
				ui.refresh.disabled = false;
				setButtonLabel(ui.refresh, '刷新');
			}
		}, 8000);
	});

	// 分隔条：鼠标拖动改左右占比，双击复位。
	const splitter = ui.splitter;
	if (splitter) {
		let dragging = false;
		const updateFromPointer = event => {
			const rect = ui.panes?.getBoundingClientRect();
			if (!rect || rect.width <= 0) {
				return;
			}
			state.ratio = Math.max(0.15, Math.min(0.85, (event.clientX - rect.left) / rect.width));
			applyRatio();
			Object.values(state.viewers).forEach(viewer => viewer?.resize());
		};
		splitter.addEventListener('pointerdown', event => {
			if (event.button !== 0) {
				return;
			}
			dragging = true;
			splitter.dataset.dragging = 'true';
			try {
				splitter.setPointerCapture?.(event.pointerId);
			} catch {
				// 合成事件（自动化测试）没有真实 pointer，捕获失败不影响拖动逻辑。
			}
			event.preventDefault();
		});
		splitter.addEventListener('pointermove', event => {
			if (dragging) {
				updateFromPointer(event);
			}
		});
		const stop = () => {
			if (!dragging) {
				return;
			}
			dragging = false;
			delete splitter.dataset.dragging;
		};
		splitter.addEventListener('pointerup', stop);
		splitter.addEventListener('pointercancel', stop);
		splitter.addEventListener('dblclick', () => {
			state.ratio = 0.5;
			applyRatio();
			Object.values(state.viewers).forEach(viewer => viewer?.resize());
		});
	}

	window.addEventListener('keydown', event => {
		if (event.key === 'Escape' && state.merge) {
			state.merge = false;
			updatePanes();
			setStatus('已取消合并。');
		}
	});
}

function setupMessages() {
	window.addEventListener('message', event => {
		const message = event.data;
		if (!message || typeof message !== 'object') {
			return;
		}
		if (message.type === 'wispkit.graph3d.elements') {
			if (ui.refresh) {
				ui.refresh.disabled = false;
				setButtonLabel(ui.refresh, '刷新');
			}
			applyElements(message.elements, message.message);
			return;
		}
		if (message.type === 'wispkit.graph3d.error') {
			if (ui.refresh) {
				ui.refresh.disabled = false;
				setButtonLabel(ui.refresh, '刷新');
			}
			setStatus(typeof message.message === 'string' ? message.message : '刷新失败。', 'error');
		}
	});
}

/**
 * 自检钩子（与 `.mmd` 页面同款约定）：探针读取气泡文字的实际排版结果，
 * 用来验证长名称完整保留、文字块贴合气泡宽高比，以及图片气泡的尺寸 /
 * 文字是否真的隐藏。只读，不影响渲染。
 */
Object.defineProperty(window, '__wispkitGraph3dSelftest', {
	value: {
		labelPlans: () => Object.values(state.viewers).flatMap(viewer => {
			if (!viewer || !viewer.root) {
				return [];
			}
			return viewer.root.children
				.filter(child => child.userData && child.userData.labelPlan)
				.map(child => ({ ...child.userData.labelPlan, visible: child.visible }));
		}),
		imagePlans: () => Object.values(state.viewers).flatMap(viewer => {
			if (!viewer || !viewer.root) {
				return [];
			}
			return viewer.root.children
				.filter(child => child.userData && child.userData.imagePlan)
				.map(child => ({ ...child.userData.imagePlan, visible: child.visible }));
		}),
		layouts: () => Object.entries(state.viewers)
			.filter(([, viewer]) => viewer && viewer.layout)
			.map(([side, viewer]) => ({
				side,
				strategy: viewer.layout.strategy,
				algorithm: viewer.layout.algorithm,
				mutex: viewer.layout.mutex ?? null,
				danglingEdgeCount: viewer.layout.danglingEdgeCount,
				edgeCount: viewer.layout.edges.length,
				nodes: viewer.layout.nodes.map(node => ({
					id: node.id,
					label: node.label,
					origin: node.origin ?? null,
					x: node.x,
					y: node.y,
					z: node.z,
					radius: node.radius,
				})),
			})),
	},
});

function start() {
	const payload = readPayload();
	state.elements = payload.elements;
	state.leftIndex = state.elements.length > 0 ? 0 : -1;
	state.rightIndex = -1;

	// 禁止画布上的浏览器右键菜单；OrbitControls 右键才是平移。
	window.addEventListener('contextmenu', event => {
		if (event.target instanceof HTMLCanvasElement) {
			event.preventDefault();
		}
	});

	initViewers();
	setupToolbar();
	setupMessages();
	populateSelect(ui.leftSelect);
	populateSelect(ui.rightSelect);
	syncSelects();
	updatePanes();
	if (ui.algorithm) {
		ui.algorithm.value = state.algorithm;
	}
	if (ui.spacing) {
		ui.spacing.value = String(state.spacing);
	}
	if (ui.spacingValue) {
		ui.spacingValue.textContent = `${state.spacing.toFixed(2)}×`;
	}
	if (ui.edgeLabels) {
		ui.edgeLabels.checked = state.showEdgeLabels;
	}
	const title = payload.fileName ? `3D 可视化浏览：${payload.fileName}` : '3D 可视化浏览';
	document.title = title;
	setStatus(state.elements.length > 0 ? elementCounts() : '文档中没有找到 ASCII 树或 Mermaid 图元素。', state.elements.length > 0 ? 'ok' : 'error');
	window.addEventListener('resize', () => {
		Object.values(state.viewers).forEach(viewer => viewer?.resize());
	});
}

start();
