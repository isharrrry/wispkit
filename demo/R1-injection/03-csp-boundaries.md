# R1-03 CSP 边界（观察项）

> **这一份不是"通过/失败"题，而是让你看清 CSP 到底拦了什么。**
> Wispkit 的 Markdown 视图用的是**严格策略**（镜像内置预览的 Strict 级）：
>
> ```
> default-src 'none';
> img-src 'self' <cspSource> https: data:;
> media-src 'self' <cspSource> https: data:;
> script-src 'nonce-<每次随机>';
> style-src 'self' <cspSource> 'unsafe-inline' https: data:;
> font-src 'self' <cspSource> https: data:;
> ```
>
> 怎么开控制台：命令面板 → **Developer: Open Webview Developer Tools** → Console 标签。

## 1. 内联 `<script>`（预期：被拦）

下面这段来自 Markdown 源码里的原始 HTML：

<script>document.title = 'INLINE-SCRIPT-RAN';</script>

**期望**：标题**不变**，Console 里出现 `Refused to execute inline script ...`。
**如果标题变了**（标签页标题变成 `INLINE-SCRIPT-RAN`）→ 这是安全缺陷，请报告。

## 2. 内联 `onclick`（预期：被拦）

<button onclick="document.title='ONCLICK-RAN'">点我试试（预期没反应）</button>

**期望**：按钮能显示，点击**无任何反应**。

## 3. 内联 `<style>`（预期：**放行**）

<style>#csp-style-probe { color: rgb(200, 0, 0); font-weight: bold; }</style>

<p id="csp-style-probe">这段字应该是红色加粗的（style-src 里有 'unsafe-inline'，所以内联样式被允许）。</p>

**期望**：**红色加粗**。这说明"内联样式放行、内联脚本不放行"这条边界是准的。

## 4. 内联 `style=""` 属性（预期：放行）

<p style="background:#eef; padding:8px;">这段有浅蓝背景（属性内联样式，同样走 'unsafe-inline'）。</p>

## 5. http:// 图片（预期：被拦）

![http 图片应被拦](http://127.0.0.1:9/blocked.png)

**期望**：显示成**裂图**，且 Console 里有 `Refused to load the image` 字样（因为 `img-src` 只放行 `https:`，没放行 `http:`）。

## 6. data: 图片（预期：放行）

![data URI 应显示](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iNjAiIGZpbGw9IiMwMDc4ZDciLz48dGV4dCB4PSIxMiIgeT0iMzYiIGZpbGw9IndoaXRlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0Ij5kYXRhIFVSSSBPSzwvdGV4dD48L3N2Zz4=)

**期望**：显示一块**蓝色圆角条**，上面白色字 `data URI OK`。

## 7. `<iframe>`（预期：被拦）

<iframe src="https://example.com" width="300" height="120"></iframe>

**期望**：**什么都不显示**（`default-src 'none'` 里没有 `frame-src`）。

## 对照表

| # | 内容 | 策略里的相关指令 | 预期 |
|---|---|---|---|
| 1 | 内联 `<script>` | `script-src 'nonce-...'` | 拦 |
| 2 | 内联 `onclick` | 同上 | 拦 |
| 3 | 内联 `<style>` | `style-src ... 'unsafe-inline'` | 放行 |
| 4 | `style=""` 属性 | 同上 | 放行 |
| 5 | `http://` 图片 | `img-src ...`（无 `http:`） | 拦 |
| 6 | `data:` 图片 | `img-src ... data:` | 放行 |
| 7 | `<iframe>` | 无 `frame-src`，落到 `default-src 'none'` | 拦 |
| — | Mermaid 脚本（来自另一个扩展） | 带 nonce，`script-src 'nonce-...'` | 放行 |

**这张表就是 R1 的验收清单**：只有第 7 行之外的所有"应拦的拦住了、应放的放行了"，才算 CSP 既安全又够用。

> 顺带一句边界：**HTML 视图**（`R5-jump/` 那些 .html）用的是**宽松策略**（为了让页面自带脚本能跑，故意放行 `'unsafe-inline'`）。
> 所以同一段 `<script>` 在 .md 里被拦、在 .html 里会执行——这是设计如此，不是 bug。
