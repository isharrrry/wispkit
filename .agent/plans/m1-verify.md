# M1 验证记录 —— Wispkit 在 1.137.0 上的端到端证据

**验证平台**：`D:\app\VSCodeEXE`（1.137.0 安装版，Electron 42.10.0）
**方法**：`tools/selftest/` 是一个临时自检扩展（不进 VSIX），在**独立 `--user-data-dir` / `--extensions-dir` 的实例**里启动，因此不干扰正在使用的窗口。它用 `require()` 直接调用 Wispkit 编译产物（`out/markdown/page.js`、`out/markdown/contributions.js`、`out/util/csp.js`、`out/util/nonce.js`），把**真实页面**注入真实 webview，网页探针把结果 postMessage 回来。
**结果文件**：`.selftest/result.json`

---

## 一、静态门禁

| 门禁 | 结果 |
|---|---|
| `npm run compile`（tsc + esbuild） | 0 错误 |
| `npm run lint`（eslint src） | 0 error |
| `npm test`（mocha，含 jsdom 前端测试） | **65 passing** |
| 变异测试 A：给滚轮缩放加回 `ctrlKey` 前置 | **5 failing**（含「R4：不按任何修饰键，滚轮向上即放大」）→ 测试确实在测 R4 |
| 变异测试 B：把贡献键写成 `markdown.brokenKey` | **4 failing** → 测试确实在锁 R1 的契约 |
| `vsce package` | `wispkit-0.1.0.vsix`（27 文件 / 33.54 KB） |
| `code --install-extension` | `narnat.wispkit@0.1.0` 出现在 `--list-extensions` |

## 二、真实 VS Code 自检结果（`.selftest/result.json`）

| 检查 | 结果 | 说明 |
|---|---|---|
| `wispkit.active` | `true` | 扩展正常激活 |
| `wispkit.commandRegistered` | `true` | `wispkit.openWith` 已注册 |
| `viewType.{markdown,image,html}.opened` | 全 `true`，`error` 全 `null` | 三个自定义编辑器都能被 `vscode.openWith` 接受并开出标签页 |
| `csp.webviewMessage` | `{nonceScriptRan:true, violations:[]}` | 同款 CSP + nonce 下脚本执行成功、**0 违规** |
| `render.commandExistsBeforeActivation` | `false` → 之后 `true` | 证实 `markdown.api.render` 是**隐藏命令**：靠 `onCommand:` 激活事件注册，激活前查不到 |
| `render.returnType` / `length` | `string` / 7435 | `executeCommand('markdown.api.render', text)` 返回 HTML 字符串 |
| `render.mermaidDivPresent` | `true`（`mermaidLeftAsCodeFence` = `false`） | **```mermaid fence 被 `markdown.markdownItPlugins` 转成了 `div.mermaid`** —— R3 的接缝成立 |
| `render.katexRendered` | `true` | markdown-math 的 `markdownItPlugins` 对 `api.render` 生效 |
| `render.relativeImgUntouched` | `true` | `api.render` 不把相对图片转成 webview URI → 必须自行加 `<base href>`（实现已如此） |
| `render.headingHasId` | `true` | 标题自带 id，目录定位可用 |

### 真实页面探针（最重要的一节）

`realPage.contributionScripts` = `["./media/index.js", "./markdown-preview-out/index.js"]`
`realPage.contributionStyles` = `["./markdown.css", "./media/markdown.css", "./media/highlight.css", "./notebook-out/katex.min.css", "./preview-styles/index.css"]`

| 探针字段 | 值 | 说明 |
|---|---|---|
| `mermaidDivs` | 1 | 页面里确实有 `.mermaid` 容器 |
| **`mermaidSvgs`** | **1** | **内置 mermaid 的预览脚本（26 MB bundle）在我们的页面里成功渲染出 svg** → R1（注入）+ R3（图能显示）链路打通 |
| `tocLinks` | 7 | h1×1 + h2×3 + h3×3 = 7，h4 被 `toc.depth=3` 正确排除 → R2 |
| `imgLoaded` | `true` | 相对图片 `images/pic.png` 真的加载成功 → `<base href>` + `localResourceRoots` 生效 |
| `katexNodes` | 2 | 行内 + 块级公式 |
| `violations` | `[]` | **0 CSP 违规** |

> 附带说明：`imgResolvedToWebviewUri` 为 `false` 只是探针假设了旧的 URI 形式（现在 webview 资源走 `https://*.vscode-cdn.net/`），不影响加载（`imgLoaded: true`）。

**一个值得记录的发现**：内置 `markdown-language-features` **自己也贡献** `markdown.previewScripts` / `previewStyles`（`./media/index.js`、`./markdown.css`、`./media/markdown.css`、`./media/highlight.css`）。这是它给自己用的（内置预览页也走同一聚合），我们的聚合自动把内置预览的样式与前端一并纳入 —— 结果是 Wispkit 的 Markdown 页面在排版与高亮上得到与内置预览一致的观感。自检显示这不产生副作用（0 违规、渲染与目录均正常）。

## 三、仅靠自动化无法覆盖、需要目视的部分

| 项 | 为什么没自动测 | 怎么手工验证（30 秒） |
|---|---|---|
| R4 的真实手感 | jsdom 覆盖了算法（13 个用例），但真实窗口的指针/滚轮行为要人操作 | 打开 `.selftest/images/pic.png`：**不按任何键**滚轮缩放、按住右键拖动、双击复位 |
| R3 默认缩放 | `configurationDefaults` 让 mermaid 的 `mouseNavigation` 变 `always`，需真实手势 | 打开 `.selftest/fixture.md`，在 mermaid 图上滚轮/拖动 |
| R5 跳转 | 需要真实点击（`vscode://` 走宿主 OpenService） | 打开 `.selftest/page.html` 用 Wispkit 视图，点「跳转到 fixture.md 第 7 行」，光标应落在第 7 行、**在当前窗口** |
| R2 高亮跟随 | 需滚动 | 在 fixture.md 视图里滚动，看左侧目录高亮是否跟随 |
