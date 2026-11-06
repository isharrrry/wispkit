import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `media/graph3d.js` 是 webview 前端，无法在 mocha 里直接跑 three.js；
 * 这里锁定几项「真机验收会看、但很容易被改回去」的契约：
 *   - 刷新后的左右选择恢复走纯函数（不能把用户主动的「不选」改回第 1 个）；
 *   - Esc 取消合并时状态栏同步；
 *   - 合并提示按实际同名节点数生成；
 *   - Sprite 文字、透明气泡、OrbitControls 左右键、ResizeObserver。
 */
function source(): string {
	return fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'graph3d.js'), 'utf8');
}

describe('media/graph3d.js 前端契约', () => {
	it('刷新恢复选择使用 resolveLeftSelection / resolveRightSelection', () => {
		const js = source();
		assert.ok(js.includes("from '../src/graph3d/selection'"), '必须复用纯函数模块');
		assert.ok(js.includes('resolveLeftSelection(previousLeft'), '左侧恢复必须走纯函数');
		assert.ok(js.includes('resolveRightSelection(previousRight'), '右侧恢复必须走纯函数');
	});

	it('Esc 取消合并时状态栏也更新为「已取消合并」', () => {
		const js = source();
		assert.ok(/event\.key === 'Escape'[\s\S]{0,220}setStatus\('已取消合并。'\)/.test(js),
			'Esc 处理器里必须同步 setStatus');
	});

	it('合并提示按实际同名节点数生成，而不是固定文案', () => {
		const js = source();
		assert.ok(/merged\.mergedNodeCount > 0/.test(js), '合并状态提示必须区分有没有同名节点');
		assert.ok(/合并了 \$\{merged\.mergedNodeCount\} 个同名节点/.test(js));
	});

	it('节点文字用 Sprite、气泡高透明、左右键与滚轮交互齐全', () => {
		const js = source();
		assert.ok(js.includes('new THREE.Sprite(material)'), '文字必须是始终面向相机的 Sprite');
		assert.ok(/alpha\s*=\s*\(0\.028 \+ fresnel \* 0\.22\)/.test(js), '气泡中心约 3% 不透明度，边缘 Fresnel');
		assert.ok(js.includes('LEFT: THREE.MOUSE.ROTATE'));
		assert.ok(js.includes('RIGHT: THREE.MOUSE.PAN'));
		assert.ok(js.includes('new ResizeObserver'), '窗口 / 分栏变化后 canvas 要自适应');
	});

	it('气泡文字完整显示：长名称先预换行，再按气泡宽高比自适应折行（不截断）', () => {
		const js = source();
		assert.ok(js.includes("from '../src/graph3d/textLayout'"), '文字排版必须复用纯函数模块');
		assert.ok(js.includes('preWrapLabel('), '长名称必须走分隔符预换行');
		assert.ok(js.includes('fitLabelText('), '折行宽度必须按气泡宽高比自适应');
		assert.ok(!js.includes('mainLines.length >= (options.small ? 2 : 4)'),
			'不能再按固定行数截断——超出的字符必须保留');
		assert.ok(!js.includes('label.slice(0, 40)'), '不能再把长名称直接砍成前 40 个字符');
		assert.ok(js.includes('__wispkitGraph3dSelftest'), '需要只读自检钩子核对排版结果');
	});

	it('文字 Sprite 的四角落在气泡球内，不会从轮廓外露出来', () => {
		const js = source();
		assert.ok(/BUBBLE_TEXT_WIDTH\s*=\s*[\d.]+/.test(js), '必须定义气泡内接矩形的宽度上限');
		assert.ok(/BUBBLE_TEXT_HEIGHT\s*=\s*[\d.]+/.test(js), '必须定义气泡内接矩形的高度上限');
		assert.ok(/node\.radius \* BUBBLE_TEXT_WIDTH/.test(js), '节点文字宽度必须按内接矩形计算');
		assert.ok(/node\.radius \* BUBBLE_TEXT_HEIGHT/.test(js), '节点文字高度必须按内接矩形计算');
		// 内接：半宽² + 半高² ≤ 半径²（留 2% 余量后仍须成立）
		const width = Number(/BUBBLE_TEXT_WIDTH\s*=\s*([\d.]+)/.exec(js)![1]);
		const height = Number(/BUBBLE_TEXT_HEIGHT\s*=\s*([\d.]+)/.exec(js)![1]);
		assert.ok((width / 2) ** 2 + (height / 2) ** 2 <= 1,
			`文字块四角必须在球内：(${width}/2)² + (${height}/2)² = ${(width / 2) ** 2 + (height / 2) ** 2}`);
	});

	it('分隔条比例限制 15%–85%，双击复位 50%', () => {
		const js = source();
		assert.ok(js.includes('Math.max(0.15, Math.min(0.85'), '拖动比例必须夹在 15%–85%');
		assert.ok(/addEventListener\('dblclick'[\s\S]{0,160}state\.ratio = 0\.5/.test(js), '双击分隔条复位 50%');
	});

	it('间隔重新布局时相机距离按包围半径缩放，避免节点被推出视口', () => {
		const js = source();
		assert.ok(/radius: Math\.max\(0\.0001, this\.currentRadius\)/.test(js), '要记录旧布局的包围半径');
		assert.ok(/const scale = this\.currentRadius \/ previous\.radius/.test(js));
		assert.ok(/addScaledVector\(previous\.offset, scale\)/.test(js), '相机 offset 必须按比例缩放');
	});

	it('数据流名称复选框控制边标签显隐，标签放在连线中点', () => {
		const js = source();
		assert.ok(js.includes("edgeLabels: byId('wispkit-3d-edge-labels')"), '工具栏必须有数据流名称复选框');
		assert.ok(/state\.showEdgeLabels = Boolean\(ui\.edgeLabels\.checked\)/.test(js));
		assert.ok(js.includes('setShowEdgeLabels(state.showEdgeLabels)'), '切换后要同步所有视图');
		assert.ok(/let labelT = 0\.5;/.test(js), '普通连线的标签必须在中点');
		assert.ok(/edge\.dangling/.test(js) && /curve\.getPoint\(labelT\)/.test(js), '悬空边标签要往悬空端偏移，避免压住气泡');
		assert.ok(/labelSprite\.visible = this\.showEdgeLabels/.test(js));
	});

	it('布局算法下拉切换后重绘，并把算法传给纯函数布局', () => {
		const js = source();
		assert.ok(js.includes("algorithm: byId('wispkit-3d-algorithm')"), '工具栏必须有布局算法下拉');
		assert.ok(js.includes('algorithm: this.algorithm'), 'layoutGraph 必须收到当前算法');
		assert.ok(/setAlgorithm\(algorithm\)\s*\{/.test(js), '每个视图要有 setAlgorithm');
		assert.ok(js.includes('viewer?.setAlgorithm(state.algorithm)'), '切换后要同步所有视图');
		assert.ok(/state\.algorithm = ALGORITHM_LABELS\[value\] \? value : 'auto'/.test(js), '非法算法回落到 auto');
		for (const algorithm of ['auto', 'compact', 'louvain', 'radial', 'layered', 'force']) {
			assert.ok(new RegExp(`\\b${algorithm}:`).test(js), `缺少算法标签 ${algorithm}`);
		}
		for (const algorithm of ['compact-mutex', 'force-mutex']) {
			assert.ok(new RegExp(`'${algorithm}':`).test(js), `缺少互斥算法标签 ${algorithm}`);
		}
	});

	it('互斥布局在合并视图里显示两个核心，并暴露只读自检钩子', () => {
		const js = source();
		assert.ok(js.includes('layout.mutex'), '统计行要读取布局返回的 mutex 诊断');
		assert.ok(js.includes('左核「'), '统计行要标出左侧核心');
		assert.ok(js.includes('右核「'), '统计行要标出右侧核心');
		assert.ok(js.includes('只在合并左右图后生效'), '未合并时要提示互斥效果的前提');
		assert.ok(/layouts: \(\) => Object\.entries\(state\.viewers\)/.test(js), '要暴露布局坐标自检钩子');
		assert.ok(/strategy === 'compact' \|\| strategy === 'compact-mutex' \? 0\.42/.test(js),
			'互斥紧凑分层应复用紧凑分层的低视角');
	});

	it('有效图片链接：气泡里画图片 Sprite、四角贴球面，文字保持隐藏', () => {
		const js = source();
		assert.ok(js.includes('createImageSprite('), '节点图片必须用独立 Sprite 绘制');
		assert.ok(/node\.image && typeof node\.image\.src === 'string'/.test(js), '图片来自节点的 image.src');
		assert.ok(js.includes('MAX_IMAGE_TEXTURE_SIDE'), '超大图片必须先缩到画布再上传 GPU');
		assert.ok(js.includes('halfDiagonal'), '按图片半对角线计算世界尺寸');
		assert.ok(/const scale = radius \/ Math\.max\(0\.0001, halfDiagonal\)/.test(js),
			'缩放必须让矩形四角到球心距离等于气泡半径');
		assert.ok(js.includes('cornerDistance'), '自检钩子必须报告四角到球心的距离');
		assert.ok(js.includes('fallbackSprite.visible = false'), '图片存在时先隐藏文字');
		assert.ok(js.includes('sprite.visible = true'), '图片解码成功后显示图片');
		assert.ok(js.includes('image.onerror'), '图片解码失败要回退显示文字');
		assert.ok(js.includes('createImageSprite(node, node.radius, sprite)'), '节点循环里要接入图片 Sprite');
		assert.ok(js.includes('imagePlans:'), '图片计划必须暴露只读自检钩子');
	});

	it('悬停节点气泡区域用 ray-sphere 检测，tooltip 显示注释', () => {
		const js = source();
		assert.ok(js.includes('this.hoverTargets.push'), '带注释的节点要加入悬停目标');
		assert.ok(js.includes('raycaster.ray.intersectsSphere(target.sphere)'), '用解析球判断鼠标是否在气泡区域');
		assert.ok(js.includes('node.comment'), 'tooltip 内容来自节点注释');
		assert.ok(/tooltip\.textContent = ''/.test(js), 'tooltip 必须用 textContent 防注入');
		assert.ok(js.includes("body.className = 'wispkit-3d-tooltip-body'"));
		assert.ok(js.includes("addEventListener('pointermove', this.onPointerMove)"), '需要监听 pointermove');
		assert.ok(js.includes("addEventListener('pointerleave', this.onPointerLeave)"), '离开舞台要隐藏 tooltip');
	});
});
