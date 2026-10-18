// R5 相对资源验证：这个文件通过 <script src="../assets/html/js/demo.js"> 加载。
// 能执行说明：HTML 视图的 CSP 放行了外部脚本（script-src 'self' <cspSource>）。
document.addEventListener('DOMContentLoaded', () => {
	const target = document.getElementById('js-probe');
	if (target) {
		target.textContent = '✅ 外部 JS 已执行（loader.js 就绪）· ' + new Date().toLocaleTimeString();
		target.classList.add('r5-js-ok');
	}
});
