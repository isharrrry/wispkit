# demo

**Wispkit 五项功能的验证数据。** 每个文件开头都写了「验证什么 / 期望看到什么 / 失败长什么样」，
照着点一遍就能判断扩展到底对不对，不用读源码。

覆盖的功能：

| 编号 | 功能 | 素材目录 |
|---|---|---|
| R1 | 贡献脚本注入 nonce + CSP 放行（即"扩展点"） | [R1-injection](R1-injection) |
| R2 | 左侧目录导航（层级 / 跳级 / 特殊标题 / 海量） | [R2-toc](R2-toc) |
| R3 | Mermaid 放大（默认即可滚轮缩放 + 拖动） | [R3-mermaid](R3-mermaid) |
| R4 | 图片默认滚轮缩放 + 右键平移 | [R4-image](R4-image) + [assets/images](assets/images) |
| R5 | `vscode://` 内部跳转（当前窗口 + 精确行号） | [R5-jump](R5-jump) |

---

## 三条前提（不满足会误判成扩展的 bug）

1. **先装 Wispkit 并重载窗口**：`code --install-extension Wispkit\wispkit-0.1.0.vsix`，
   然后在 VS Code 里执行命令面板 → **Developer: Reload Window**。
2. **用「打开文件夹」的方式打开 `demo`**（`File → Open Folder`），
   **不要**只单独打开某个文件。原因：webview 的 `localResourceRoots` 只覆盖"文档所在目录 +
   工作区目录"，单文件模式下跨目录的 `../assets/…` 会被拦成裂图。
   *（R5-jump 的 `01-basic.html` 里专门把这一条做成了可见的验证点。）*
3. **别手动改过这两个设置**：`markdown-mermaid.mouseNavigation.enabled`（R3 依赖它的默认值被抬成 `always`）、
   `wispkit.toc.depth` / `wispkit.toc.enabled`。用户显式设置会盖掉 Wispkit 的默认值。

---

## 5 分钟上手

```
1. 打开 demo 文件夹
2. R2-toc/01-depth-default.md      → 看左侧目录 11 条（含 h4/h5/h6）、滚动高亮、点击定位
3. R2-toc/03-special-chars.md      → 看重复标题三条是否各跳各的
4. R1-injection/01-injection-baseline.md → 图是图形 + 公式排版正常 = 注入成功
5. R3-mermaid/02-large.md          → 在图上直接滚轮放大、拖动平移（不用按 Alt）
6. assets/images/grid-4000x3000.png → 右键 Reopen Editor With… → Wispkit Image
                                      → 滚轮缩放、右键平移、双击复位
7. R5-jump/01-basic.html           → 右键 Reopen Editor With… → Wispkit HTML → 点第 1 条链接
8. R5-jump/02-edge.html            → 10 条边界，逐条核对"预期"
```

## 需求 → 素材映射

| 素材 | 验证点 | 关键期望 |
|---|---|---|
| [R1-injection/01-injection-baseline.md](R1-injection/01-injection-baseline.md) | 贡献脚本被注入且 nonce 被放行 | Mermaid 出图形、KaTeX 排版正常 |
| [R1-injection/02-code-highlight.md](R1-injection/02-code-highlight.md) | 贡献样式（highlight.css）覆盖多语言 | 每块代码至少两种 token 颜色 |
| [R1-injection/03-csp-boundaries.md](R1-injection/03-csp-boundaries.md) | CSP 到底拦了什么 | 内联 `<script>` 拦、内联 `<style>` 放、`http:` 图拦、`data:` 图放、`<iframe>` 拦 |
| [R1-injection/04-markdown-it-plugins.md](R1-injection/04-markdown-it-plugins.md) | 复用 `markdown.api.render` 的插件通路 | 数学 + Mermaid fence 都生效 |
| [R2-toc/01-depth-default.md](R2-toc/01-depth-default.md) | 默认 depth=3 | 目录 8 条，h4~h6 不出现；depth 改 6 后立刻 11 条 |
| [R2-toc/02-skip-levels.md](R2-toc/02-skip-levels.md) | 跳级标题的缩进 | h4→h2→h5→h3→h6 的缩进按实际层级 |
| [R2-toc/03-special-chars.md](R2-toc/03-special-chars.md) | 特殊字符与重复标题 | 目录文字干净；3 个同名标题各跳各的 |
| [R2-toc/04-no-headings.md](R2-toc/04-no-headings.md) | 无标题 | 目录无条目；补一个标题后立刻出现 |
| [R2-toc/05-many-headings.md](R2-toc/05-many-headings.md) | 海量标题（77 条） | 滚动跟随不卡、点击仍准 |
| [R3-mermaid/01-types.md](R3-mermaid/01-types.md) | 9 种图类型 | 全部渲染成图形 |
| [R3-mermaid/02-large.md](R3-mermaid/02-large.md) | 大图缩放平移 | 光标锚点缩放、拖动看到视口外 |
| [R3-mermaid/03-edge.md](R3-mermaid/03-edge.md) | 单图失败不拖垮整篇 | 错图之后的内容依然正常 |
| [R3-mermaid/04-many.md](R3-mermaid/04-many.md) | 批量 20 张 + 增量重渲染 | 追加新图后整篇重渲染仍正常 |
| [R4-image/01-sizes.md](R4-image/01-sizes.md) | 图片在文档里显示 + 图片视图交互 | 16×16 显示 100%（不被放大）、≥300% 触发 pixelated |
| [R5-jump/01-basic.html](R5-jump/01-basic.html) | 基础跳转 + 相对资源 | 当前窗口打开并定位到 `LINE-xx-MARKER` |
| [R5-jump/02-edge.html](R5-jump/02-edge.html) | 10 条跳转边界 | 每条都写了预期，逐条核对 |
| [R5-jump/03-markdown-links.md](R5-jump/03-markdown-links.md) | Markdown 视图与 HTML 视图的**故意不对称** | `vscode://` 走系统协议；`command:` 点不动 |

## 目录结构

```
demo/
├─ R1-injection/     贡献脚本注入、CSP 边界、markdownItPlugins
├─ R2-toc/           目录导航：深度、跳级、特殊字符、无标题、海量
├─ R3-mermaid/       图类型、大图缩放、容错、批量
├─ R4-image/         图片在文档里的显示（交互素材在 assets/images）
├─ R5-jump/          HTML 跳转 + 边界 + Markdown 链接差异
│  └─ targets/       跳转靶子（行号与 LINE-xx-MARKER 严格对齐）
├─ assets/
│  ├─ images/        13 张图：超大/极高/极宽/极小/透明/棋盘 + jpg bmp gif ico webp avif svg
│  └─ html/          HTML 视图用的相对资源（css / js）
└─ tools/            生成与自检脚本
```

## 工具链

在 `tools/` 目录下：

```bash
# 1. 生成图片素材（PNG/JPEG/BMP/GIF/ICO；依赖 System.Drawing，无需第三方库）
powershell -NoProfile -ExecutionPolicy Bypass -File gen-images.ps1

# 2. 生成"批量型"素材（05-many-headings.md、04-many.md）
node gen-fixtures.mjs

# 3. 转出 WebP / AVIF（本机无系统编码器，依赖 npm 的 sharp；可选）
npm install sharp && node gen-webp-avif.mjs

# 4. 素材自检 —— 改完素材一定要跑
node check-fixtures.mjs
```

**`check-fixtures.mjs` 校验的不是插件，而是"素材自己有没有毛病"**：
相对资源是否存在、跳转链接的目标文件与行号是否真的对得上（要求该行正好写着 `LINE-xx-MARKER` 且编号等于行号）、
手写的 `command:` 链接能否 decode 成合法 JSON、图片的**真实像素尺寸是否与文件名里的 `宽x高` 一致**、
以及 R2 各文件的标题数与 [tools/expected.json](tools/expected.json) 是否一致。

> 这条自检是**必需的**：第一版素材里我自己的跳转行号就算错了两处、`01-depth-default.md` 里写的
> "6 条"实际是 8 条 —— 都是它抓出来的。素材错了，手工验证时会把锅算到扩展头上。

## 已知边界（这些"不工作"是设计如此，不是 bug）

| 现象 | 原因 |
|---|---|
| 单文件模式下 `../assets/…` 是裂图 | webview `localResourceRoots` 只覆盖文档目录 + 工作区目录 |
| HEIC / TIFF / JXL 只能看兜底面板 | Chromium 内核没有这些解码器；Wispkit 不打包 libheif 等大依赖，只提供「用系统默认应用打开」 |
| MKV / AVI / WMV / FLV 可能无法播放 | 取决于运行时编解码器；失败时显示原因和「系统播放器打开」，不会静默黑屏 |
| Markdown 视图里 `command:` 链接点不动 | Markdown 视图**没有**开 `enableCommandUris`（安全取舍） |
| Markdown 视图里 `vscode://file/…` 可能另起窗口 | Markdown 视图**不做**链接改写（改写只在 HTML 视图） |
| HTML 视图里内联 `<script>` 能跑 | HTML 视图故意用宽松 CSP（"浏览 HTML"的本意） |
| 同一段 `<script>` 在 .md 被拦、在 .html 能跑 | 同上：两个视图策略不同 |
| 相对链接（`targets/x.md`）在 HTML 里点不动 | 会被解析成 `vscode-webview://…`，该 scheme 不在宿主白名单 |
| `03-csp-boundaries.md` 里第 5、7 条不显示 | CSP 拦的，正是要看的 |
| `:abc` / `#L10` 形式的跳转不生效 | 改写只认 `vscode://file/<路径>[:数字]` |

## 真实环境验证结果（已跑过，原始证据在 [tools/live-result.json](tools/live-result.json)）

**平台**：`D:\app\VSCodeEXE`（**1.137.0**），已装 `narnat.wispkit-0.1.0`。
**方式**：用 [Wispkit/tools/selftest](../tools/selftest/extension.js) 这个自检扩展 ——
它**复用 Wispkit 自己的页面生成代码**（`out/markdown/page.js` + `contributions.js` + `csp.js`），
在**真实 webview** 里渲染本目录的素材，再由页面内探针把结果回传成 JSON。
也就是说：下面这些数字不是"我以为"，是渲染完在页面里数出来的。

```powershell
$env:WISPKIT_SELFTEST_WS        = '<本目录绝对路径>'
$env:WISPKIT_SELFTEST_DEMO      = '1'
$env:WISPKIT_SELFTEST_DEMO_LIST = 'R1-injection/01-injection-baseline.md;R2-toc/01-depth-default.md;R2-toc/05-many-headings.md;R3-mermaid/02-large.md;R4-image/01-sizes.md'
$env:WISPKIT_SELFTEST_OUT       = '<本目录>\tools\live-result.json'
& 'D:\app\VSCodeEXE\bin\code.cmd' --new-window --extensionDevelopmentPath='..\Wispkit\tools\selftest'
```

| 素材 | 真实渲染出来的 | 与文件里写的判据 |
|---|---|---|
| R1-01 | `mermaidSvgs=1`、`katexNodes=2`、`tocLinks=5`、**CSP 违规 0 条** | 一致 |
| R2-01 | `tocLinks=8`（h1=1 h2=3 h3=4；h4/h5/h6 未进目录） | 一致（文件里写的就是"8 条"） |
| R2-05 | `tocLinks=77` | 一致（生成脚本声明的 77 条） |
| R3-02 | `mermaidDivs=3` / `mermaidSvgs=3` | 三张大图全部渲染 |
| R4-01 | `imgCount=10` / `imgLoadedCount=10` | **10 张跨目录相对图片全部加载成功** |

**顺带得到的两条硬证据**（这两条比上面更重要）：

1. **CSP 与 nonce 的接缝是通的**：本机这版 VS Code 里，`markdown.previewScripts` 的实际贡献方有 **4 个** ——
   `markdown-language-features` 自己的 `media/index.js`、`mermaid-markdown-features` 的
   `markdown-preview-out/index.js`，另外还有本机装的 **drawio** 与 **markdown inline-editor** 两个扩展的脚本。
   这 4 个脚本在我们的严格 CSP（`script-src 'nonce-…'`）下**全部执行成功，且违规数为 0**。
2. **`<base href>` 通路是通的**：探针里 `imgSrc` 仍是原始的 `../assets/images/grid-4000x3000.png`
   （`markdown.api.render` 传字符串时**不**改写相对路径，与设计一致），而 `imgLoaded=true` 说明
   `<base href="vscode-webview://…">` 把它正确解析并加载了 —— 这也是"必须用打开文件夹的方式用本目录"的原因。

## 五分钟"全绿"清单

- [ ] R1：baseline 里图是图形、公式排版正常、代码有色
- [ ] R1：CSP 边界里「应拦的拦住了、应放的放行了」（对照文件里的表）
- [ ] R2：01 显示 8 条，depth 改 6 后变 11 条且不用重开标签页
- [ ] R2：03 的三个「重复标题」各跳各的
- [ ] R2：05 滚到底时高亮停在最后一章
- [ ] R3：02 的宽图上直接滚轮能放大（不按 Alt），拖动能看到视口外
- [ ] R3：03 里语法错误图之后的内容全部正常
- [ ] R4：`tiny-16x16.png` 打开时显示 **100%**（不被放大）
- [ ] R4：`grid-4000x3000.png` 放大到 ≥300% 出现像素化
- [ ] R5：`01-basic.html` 前 6 条链接都在**当前窗口**打开并定位到对的 `LINE-xx-MARKER`
- [ ] R5：`02-edge.html` 的 10 条边界与文件里写的预期一致

任何一条不符，把**编号 + 实际现象**告诉我即可（例如"R3-02：滚轮没反应，按 Alt 才行"）。
