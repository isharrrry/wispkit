# Plan: Wispkit —— VS Code「浏览增强」扩展

**Source**: 本会话调研 `vscode-browse-eval/01-image-preview.md`、`02-markdown-preview.md`、`03-web-browsing.md`（基于克隆源码 `vscode` @ `b74b34d6` = **1.143.0**）+ 本机实机 `D:\app\VSCode-win32-x64-1.46.1`（实际版本 **1.71.2**）的安装目录实测
**Selected Milestone**: M1 = 单扩展骨架 + Markdown 浏览视图（扩展点 / 目录导航 / mermaid 放大 / 跳转）
**Complexity**: Medium（3 个 viewType、1 个前端共享库、无 VS Code 源码改动）

---

## Summary

做一个**独立 VS Code 扩展**（不修改 VS Code 任何文件、不依赖补丁），用三个 `customEditors` 承载四件事：Markdown 浏览视图（**给第三方 `markdown.previewScripts`/`previewStyles` 注入 nonce 并放行 CSP** + 左侧目录导航 + mermaid 放大）、图片视图（**默认滚轮缩放 + 右键平移**）、HTML 视图（**`vscode://` / `command:` 点击在 VS Code 内跳转**）。三个视图共享同一份前端基础库（TOC、缩放手势、链接上报），宿主侧共享 nonce/CSP/资源根三件套。

---

## 1. 需求复述（Requirements Restatement）

| # | 需求 | 承载标签页 | 归属 viewType |
|---|---|---|---|
| R1 | Markdown 里的第三方贡献脚本要能跑起来（给每个贡献脚本注入 nonce、CSP 放行） | Markdown 浏览 | `wispkit.markdown` |
| R2 | Markdown 左侧目录导航（标题树 + 跟随高亮 + 点击定位） | Markdown 浏览 | `wispkit.markdown` |
| R3 | Markdown 里的 mermaid 图可放大/平移 | Markdown 浏览 | `wispkit.markdown` |
| R4 | 图片**默认**滚轮缩放（不需按 Ctrl）+ **右键拖拽平移** | 图片浏览 | `wispkit.image` |
| R5 | HTML 里的 `vscode://file/...:行号` 点击后在 VS Code **内部**打开文件并定位 | HTML 浏览 | `wispkit.html` |

**非目标（本里程碑明确不做）**：`data-line`/`code-line` 源映射、编辑器↔预览双向滚动同步、接管 Simple Browser、改内置扩展、改安装目录。

---

## 2. 版本基线与硬约束（**最重要的一节**）

调研文档的行号属 **1.143.0**，实机是 **1.71.2**。两者差异经实测确认如下，**plan 的实现以实机为准**：

| 事实 | 1.143.0（调研文档） | **1.71.2（实机，已实测）** | 影响 |
|---|---|---|---|
| Markdown 自定义编辑器 | 两个：`vscode.markdown.preview.editor`(option) + `vscode.markdown.editor` | **只有一个**：`vscode.markdown.preview.editor`，`priority: "option"` | ✅ 好消息：R1 要解决的"给新版编辑器加扩展点"在 1.71.2 **根本不存在这个对手** |
| 图片扩展 | `media-preview`，selector 含 `svg` | **`image-preview`**，viewType `imagePreview.previewEditor`，`priority: "builtin"`，selector `*.{jpg,jpe,jpeg,png,bmp,gif,ico,webp,avif}`（**不含 svg**） | R4 需覆盖 `builtin` |
| 网页浏览 | `simple-browser`(iframe) + `browserView`(WebContentsView) | **只有 `simple-browser`**；`contributes` 仅 `commands`/`configuration`，靠 `onWebviewPanel:simpleBrowser.view` 激活 | R5 **不能**接管 Simple Browser，只能另起新标签页 |
| 内置扩展 `contributes.markdown` | 有（自身贡献 previewStyles/Scripts） | **为空**（`contributes.markdown` 无内容） | 无损：我们自己遍历 `extensions.all` 聚合，不依赖内置 |
| 安装版 `package.json` | — | 所有内置扩展 `version` 被统一改写成 `1.0.0`、`scripts` 为空 | ⚠️ 不能靠 version 判断、不能靠 scripts 复现构建 |

**硬约束（写进 `package.json`）**
- `"engines": { "vscode": "^1.71.0" }`
- `devDependencies`: `"@types/vscode": "^1.71.0"`、`"typescript"`、`"@vscode/test-electron"`、`"mocha"`、`"@types/mocha"`、`"eslint"`、`"esbuild"`、`"@vscode/vsce"`
- **禁止使用 1.71 之后的 API**（`@types/vscode@1.71` 编译通过即为门禁）

---

## 3. Patterns to Mirror（代码库惯例，均已核实）

| Category | Source | Pattern |
|---|---|---|
| 扩展清单 / 构建（独立扩展） | `vscode-livepreview/package.json`（`main`、`engines`、`scripts.test`） | `main: ./out/extension.js`；`"test": "node ./out/test/runTest.js"`；`@vscode/test-electron` + `mocha` |
| customEditor 注册 | `vscode/extensions/image-preview/src/imagePreview/index.ts:256-258` | `registerCustomEditorProvider(viewType, provider, { webviewOptions:{ retainContextWhenHidden:true }, supportsMultipleEditorsPerDocument:true })` |
| Webview 三件套（nonce/CSP/资源 URL） | `vscode/extensions/image-preview/src/imagePreview/index.ts:180-220` | nonce 生成 `:188`、`cspSource` `:190`、`asWebviewUri` `:202`/`:217`、CSP meta `:204`、settings 以 JSON 内嵌 `:205` |
| webview options 基线 | `vscode/extensions/image-preview/src/mediaPreview.ts:57-64` | `enableScripts:true` / `enableForms:false` / `localResourceRoots` |
| 扩展点聚合（读别人的贡献） | `vscode/extensions/markdown-language-features/src/markdownExtensions.ts:60-63`、`:118-128`、`:138-141` | 遍历 `vscode.extensions.all` → `packageJSON.contributes.markdown.previewScripts/previewStyles`；资源根由贡献方的 `extensionUri` 聚合 |
| 脚本注入 HTML | `.../src/preview/documentRenderer.ts:245-255` | `<script async nonce=… type="module" src=asWebviewUri>` |
| CSP 文本形态 | `.../src/preview/markdownEditorProvider.ts:1159` | `default-src 'none'; … script-src 'nonce-${nonce}' ${cspSource}; style-src ${cspSource} 'unsafe-inline'` |
| 渲染复用（宿主侧拿 HTML） | `.../src/commands/renderDocument.ts:11,21-23` → `markdown.api.render` | `await commands.executeCommand<string>('markdown.api.render', text)` |
| 相对资源（`<base>`） | `.../src/preview/markdownEditorProvider.ts:1128,1163` | `<base href="${asWebviewUri(document.uri)}">` |
| 前端内容更新事件 | `.../preview-src/index.ts:413` | `dispatchEvent(new CustomEvent('vscode.markdown.updateContent'))` |
| mermaid 块渲染契约 | `vscode/extensions/mermaid-markdown-features/preview-src/markdown/index.ts:43,56` | 扫 `pre > code.language-mermaid` + 监听 `updateContent` |
| 图片缩放/平移手势 | `vscode/extensions/image-preview/media/imagePreview.js:253-341`（1.71.2 同族）、`:141-189` | 现有 Ctrl+滚轮缩放的实现；Wispkit 去掉 Ctrl 前置判断并补 `button===2` 平移 |
| 测试文件布局 | `vscode/extensions/markdown-language-features/src/test/*.test.ts` | `src/test/<module>.test.ts`，mocha |
| 代码风格 | `vscode-livepreview`（`.prettierrc.yaml`、`eslint.config.js`） | tab 缩进、单引号、`eslint src` |

---

## 4. Files to Change（全部 CREATE，工作区 `Wispkit/`，**不改任何已有文件**）

| File | Action | Why |
|---|---|---|
| `package.json` | CREATE | 扩展清单：3 个 `customEditors` + 命令 + 配置 + `engines ^1.71.0` |
| `tsconfig.json` | CREATE | 宿主侧 TS → `out/` |
| `esbuild.mjs` | CREATE | 打包 `src/extension.ts` → `out/extension.js`；打包 3 个 webview 前端 → `media/dist/*.js` |
| `.vscodeignore` | CREATE | 排除 `src/`、`out/test`、`node_modules` |
| `.eslintrc` / `eslint.config.js` | CREATE | `eslint src`（镜像 livepreview） |
| `src/extension.ts` | CREATE | `activate()`：注册 3 个 provider + 命令 |
| `src/util/nonce.ts` | CREATE | 32 字节随机串（镜像 image-preview `:188`） |
| `src/util/csp.ts` | CREATE | 生成 CSP 文本（镜像 `markdownEditorProvider.ts:1159`） |
| `src/util/linkRewrite.ts` | CREATE | `vscode://file/<path>[:line]` → `command:vscode.open?<encoded args>` |
| `src/markdownProvider.ts` | CREATE | `CustomTextEditorProvider`：渲染 + 注入 + 目录数据 + 消息路由 |
| `src/markdown/render.ts` | CREATE | 调 `markdown.api.render`，包 `<base href>` |
| `src/markdown/contributions.ts` | CREATE | 聚合 `previewScripts`/`previewStyles` + 资源根（镜像 `markdownExtensions.ts:118-128`） |
| `src/imageProvider.ts` | CREATE | `CustomTextEditorProvider`：`<img>` + settings JSON |
| `src/htmlProvider.ts` | CREATE | `CustomTextEditorProvider`：读文件 → 链接改写 → `enableCommandUris` |
| `media/markdown.js` | CREATE | 前端入口：TOC + mermaid 放大 + 派发 `updateContent` |
| `media/image.js` | CREATE | 滚轮缩放（默认生效）+ 右键拖拽平移 |
| `media/html.js` | CREATE | 点击链接上报 / 交给宿主 |
| `media/shared/toc.js` | CREATE | 目录树构建 + IntersectionObserver 高亮 + 点击定位（三视图可复用） |
| `media/shared/panzoom.js` | CREATE | 缩放/平移手势核心（mermaid 与图片共用） |
| `media/*.css` | CREATE | 视图样式（用 `--vscode-*` 主题变量） |
| `src/test/contributions.test.ts` | CREATE | 扩展点聚合纯逻辑单测 |
| `src/test/linkRewrite.test.ts` | CREATE | 链接改写正反例单测 |
| `src/test/runTest.ts` | CREATE | `@vscode/test-electron` 拉起 1.71.2 跑集成测试 |
| `src/test/suite/*.test.ts` | CREATE | 集成：三个 viewType 能开、CSP 违规计数为 0、命令可执行 |
| `README.md` | CREATE | 安装、三个视图的打开方式、配置项、已知限制 |
| `.claude/plans/*.plan.md` | UPDATE | 本文件（确认后回填执行状态） |

**代码量预估**：宿主 ~450 行、前端 ~450 行、测试 ~250 行 → **合计约 800–1200 行**（不含 `package.json`）。

---

## 5. Tasks

### Task 0：可行性冒烟（**先做，决定 Task 2 走哪条路**）
- **Action**：在 1.71.2 上验证三件事：① `markdown.api.render` 传字符串的实际返回（含相对图片 URL 是否为原样相对路径）；② `WebviewPanelOptions.enableCommandUris` 在 `@types/vscode@1.71` 中是否存在；③ 自建 `priority:"default"` 的图片编辑器能否胜出内置 `builtin`。
- **Mirror**：`src/vscode-dts/vscode.d.ts:9916-9923`（`enableCommandUris` 语义：`true` 全放行、数组仅白名单）
- **Validate**：三份实测记录（每条附命令与输出）写入 `.claude/plans/m1-smoke.md`。**任一条为否 → 按下表切换 fallback**。

| 验证项 | 为真 | 为否 → fallback |
|---|---|---|
| `markdown.api.render` 可用且行为符合 | 直接复用 | 自 bundle `markdown-it` + `markdown-it-katex` 渲染（多 ~60 行，包体积增大） |
| `enableCommandUris` 存在 | 用 `command:` 改写 | 保留 `vscode://` 原样（在白名单内，实测 `workbench.desktop.main.js` 偏移 6014223 的 `standardSupportedLinkSchemes` 含 `vscode`）；外层仍开 `enableCommandUris:true` 无效则退化为 `vscode.open` 命令的显式命令链接 |
| `default` 胜出 `builtin` | 图片默认接管 | 不改默认，README 指引 `Reopen With` / `workbench.editorAssociations` |

### Task 1：工程骨架
- **Action**：建 `package.json`（`engines ^1.71.0`、3 个 viewType、命令 `wispkit.openMarkdown`/`wispkit.openImage`/`wispkit.openHtml`、配置项见 §6）、`tsconfig.json`、`esbuild.mjs`、`.vscodeignore`、`eslint.config.js`；`src/extension.ts` 先只注册空 provider。
- **Mirror**：`vscode-livepreview/package.json`（`main`/`scripts`）、`image-preview/src/imagePreview/index.ts:245-282`（注册段结构）
- **Validate**：`npm run compile` 0 错误；`npx vsce package` 出 VSIX；`Code.exe --install-extension` 装进 1.71.2 后 **扩展激活**（`Developer: Show Running Extensions` 里可见）。

### Task 2：Markdown 视图 —— 渲染 + nonce + CSP
- **Action**：`CustomTextEditorProvider` 读 `document.getText()` → `markdown.api.render` → 注入 `<base href="asWebviewUri(document.uri)">` → 生成含 nonce 的 CSP meta → `webview.html`。
- **Mirror**：`renderDocument.ts:11,21-23`；CSP 文本 `markdownEditorProvider.ts:1159`；`<base>` `:1128,1163`
- **Validate**：打开含**相对路径图片**、表格、`$公式$`、代码块的 md → 全部正确渲染；DevTools Console 中 `securitypolicyviolation` 事件计数 = 0。

### Task 3：Markdown 视图 —— 扩展点注入（R1 核心）
- **Action**：`contributions.ts` 遍历 `vscode.extensions.all`，取 `contributes.markdown.previewStyles`（→ `<link>`）与 `previewScripts`（支持 `string | {path, type}` → `<script nonce type src>`）；把贡献扩展的 `extensionUri` 全部并入 `localResourceRoots`；文档更新后向 webview 发消息并**派发 `vscode.markdown.updateContent`** 自定义事件。
- **Mirror**：`markdownExtensions.ts:60-63,118-128`；注入 HTML `documentRenderer.ts:245-255`；事件 `preview-src/index.ts:413`
- **Validate**：装一个真实的 `markdown.previewScripts` 扩展（如 mermaid 扩展）后打开 md：① 其脚本被执行（Console 可见其日志/图表渲染）；② 资源能加载（无 404、无 CSP 拦截）；③ 编辑文档后脚本重跑（图表更新）；④ 卸载该扩展后不报错。

### Task 4：Markdown 视图 —— 左侧目录导航（R2）
- **Action**：前端 `shared/toc.js`：`querySelectorAll('h1,h2,h3,h4,h5,h6')` → 建树（含 `textContent` 与层级缩进）→ `IntersectionObserver` 跟随高亮 → 点击 `scrollIntoView`；宿主不参与（无 `revealLine`，不需要源映射）。
- **Mirror**：`preview-src/index.ts`（webview 内 DOM 处理风格）
- **Validate**：① 目录条目数与文档标题数一致（同一 md 用脚本对比）；② 滚动正文时高亮跟随，误差 0 条；③ 点击任一条目后该标题进入视口顶部 ±32px；④ 更新文档后目录重建且计数仍一致。

### Task 5：Markdown 视图 —— mermaid 放大（R3）
- **Action**：`MutationObserver` 抓 `svg[id^=mermaid]`/`.mermaid svg`；点击图表进入放大层，复用 `shared/panzoom.js`（滚轮缩放、拖拽平移、双击复位、Esc 关闭）。
- **Mirror**：`mermaid-markdown-features/preview-src/markdown/index.ts:43`（块定位）
- **Validate**：① 含 mermaid 的 md 中图表可放大 ≥4×、可拖动、可复位；② **编辑文档触发重渲染后放大能力仍生效**（MutationObserver 重新挂载）；③ 不改动图表原 DOM 结构（对比重渲染前后 `outerHTML` 仅 transform 属性差异）。

### Task 6：图片视图 —— 默认滚轮缩放 + 右键平移（R4）
- **Action**：`CustomTextEditorProvider` + `<img src=asWebviewUri>` + settings JSON（初始 scale=fit）；`media/image.js`：`wheel` 直接缩放（**去掉 Ctrl 前置判断**），`pointerdown` `button===2` 时 `setPointerCapture` 拖拽平移，保持视图中心（镜像 `imagePreview.js:163-180` 语义），≥3× 加 `image-rendering: pixelated`。
- **Mirror**：`image-preview/src/imagePreview/index.ts:180-220`（HTML/CSP/settings）、`media/imagePreview.js:141-189`、`:253-341`、`media/imagePreview.css:48-61`
- **Validate**：① 打开 `png/jpg/gif/webp` 各一，图片非空白；② **不按任何修饰键直接滚轮即缩放**（对照改造前必须按 Ctrl）；③ 右键按住拖动可平移，松开后不再跟随；④ 缩放后视图中心不跳；⑤ 大尺寸图（≥4000px）在 3× 时像素化；⑥ 宿主 `zoom` 状态与状态栏数值一致。

### Task 7：HTML 视图 —— `vscode://` 内部跳转（R5）
- **Action**：`CustomTextEditorProvider` 打开 `.html/.htm`；`webviewOptions.enableCommandUris = true`；`linkRewrite.ts` 把 `vscode://file/<path>[:line]` 改写为 `command:vscode.open?<uri+selection>`；`<base href>` + `localResourceRoots=[文件所在目录]` 以加载相对 css/js/图片。
- **Mirror**：`vscode.d.ts:9916-9923`（`enableCommandUris`）；本会话已核实的宿主链 `isSupportedLink` / `standardSupportedLinkSchemes`（含 `vscode`）
- **Validate**：① HTML 中 `vscode://file/…:207` 点击后**当前窗口**打开目标文件且光标在第 207 行（不是新窗口、不报 "unable to open"）；② `http(s)`/`mailto` 链接走系统默认处理；③ 未改写为 `command:` 时原样 `vscode://` 也能点通（两条路都测）；④ 相对路径 css/图片正常加载。

### Task 8：测试、打包与回归
- **Action**：单测（`contributions` 聚合、`linkRewrite`）+ `@vscode/test-electron` 集成（拉 1.71.2 实机跑：三视图可开、CSP 违规 0、命令存在）；`vsce package` 出 VSIX。
- **Mirror**：`vscode-livepreview/package.json` 的 `test` 脚本；`markdown-language-features/src/test/*.test.ts` 布局
- **Validate**：`npm run lint` 0 error；`npm test` 全绿；VSIX 装进 1.71.2 后五项验收全通过（见下）。

---

## 6. 配置项（`contributes.configuration`）

| Key | 默认 | 作用 |
|---|---|---|
| `wispkit.markdown.enabled` | `true` | Markdown 是否用 Wispkit 打开（关掉即退回内置） |
| `wispkit.image.enabled` | `true` | 图片是否用 Wispkit 打开 |
| `wispkit.toc.enabled` | `true` | 目录导航开关 |
| `wispkit.toc.depth` | `3` | 目录最大层级 |
| `wispkit.zoom.wheelStep` | `1.1` | 每次滚轮的缩放倍率 |
| `wispkit.mermaid.zoomMax` | `8` | mermaid 放大上限 |

---

## 7. Validation

```bash
npm run compile      # tsc + esbuild，0 错误
npm run lint         # eslint src，0 error
npm test             # mocha 单测 + @vscode/test-electron 集成（指向 1.71.2）
npx vsce package     # 产出 wispkit-0.1.0.vsix

# 装进实机（1.71.2 解压版）
& "D:\app\VSCode-win32-x64-1.46.1\Code.exe" --install-extension .\wispkit-0.1.0.vsix --force
```

---

## 8. Risks

| Risk | 可能性 | 缓解 |
|---|---|---|
| `markdown.api.render` 在 1.71.2 的行为与预期不符（**命令存在已核实，行为未核实**） | 中 | Task 0 先验；fallback 自 bundle `markdown-it` |
| `priority:"default"` 抢占 `.md`/图片默认打开方式，用户觉得被夺权 | 高 | 两个 `enabled` 配置项 + README 首屏说明 + `Reopen With` 一句指引 |
| 自建编辑器 vs 内置 `builtin` 图片编辑器的优先级竞争（**1.71.2 未核实**） | 中 | Task 0 实测；不行则只提供 `Reopen With` 路径 |
| 第三方贡献脚本被 CSP 拦（nonce 未覆盖其内联脚本） | 中 | CSP 用 `script-src 'nonce-…' ${cspSource}`；违规事件计数作为验收项；README 记录已知不兼容扩展 |
| 无 `data-line` 源映射 → 编辑器↔预览滚动同步缺失 | 高（**已知取舍**） | 明确写入非目标；目录导航高亮不依赖它 |
| `@types/vscode` 版本与实机 1.71.2 错配（编译过、运行缺 API） | 中 | 锁 `@types/vscode@^1.71.0`，且不使用任何更新 API |
| 1.71.2 的 webview 外壳行为与新版本有差异 | 低 | 集成测试直接跑在 1.71.2 上 |

---

## 9. Acceptance

- [ ] Task 0 的三条冒烟结论各有命令与输出记录
- [ ] `npm run compile` / `npm run lint` / `npm test` 全绿
- [ ] R1：装第三方 `previewScripts` 扩展后其脚本执行且 CSP 违规计数 = 0
- [ ] R2：目录条目数 == 标题数；滚动高亮准确；点击定位误差 ≤32px
- [ ] R3：mermaid 放大 ≥4× 且**重渲染后仍生效**
- [ ] R4：**无需按 Ctrl** 直接滚轮即缩放；右键拖拽可平移
- [ ] R5：`vscode://file/…:207` 在当前窗口打开并定位到第 207 行
- [ ] 三个视图均不需要修改 VS Code 任何文件（`git status` 断言：只动 `Wispkit/`）

---

## 10. 待复核 / 未核实（诚实清单）

| # | 条目 | 现状 | 核实方式 |
|---|---|---|---|
| 1 | `markdown.api.render` 在 1.71.2 的输入/输出行为 | **未核实**（命令存在已核实：`activationEvents` 含 `onCommand:markdown.api.render`，且不在 `contributes.commands` 中） | Task 0 ① |
| 2 | `WebviewPanelOptions.enableCommandUris` 在 1.71.2 的 API 签名 | **间接核实**：1.143 `vscode.d.ts:9923` 有该字段；1.71.2 bundle（`workbench.desktop.main.js` 偏移 6014223）读取 `contentOptions.enableCommandUris` | Task 0 ②（用 `@types/vscode@1.71` 编译即证） |
| 3 | `default` 能否胜出内置 `builtin`（1.71.2 排序） | **未核实**（1.143 侧只核实"非 option 编辑器优先"：`customEditor/browser/customEditors.ts:417-418`） | Task 0 ③（实机 `Reopen With` 对比） |
| 4 | 1.71.2 是否有已安装的 mermaid 扩展作为 R3 的注入对象 | **未核实**（1.71.2 无内置 mermaid） | 装机检查 `code --list-extensions`；若无，R3 退化为 Wispkit 自带 mermaid（前端多 ~50 行） |
| 5 | `@vscode/test-electron` 拉 1.71.2 跑集成测试的可用性 | **未核实** | Task 8 首次跑通即证 |

---

## 11. 需要你拍板的三个决策

| # | 决策 | 选项 A（推荐） | 选项 B |
|---|---|---|---|
| D1 | 默认打开方式 | Markdown 与图片都 `priority:"default"`（真正"默认生效"），HTML 用 `option` | 三个都用 `option`，全靠 `Reopen With`（零侵入，但达不到"默认"） |
| D2 | mermaid 来源 | 依赖宿主已装的 mermaid 扩展（走 `previewScripts` 契约，Wispkit 不打包 mermaid） | Wispkit 自带 mermaid（体积 +~1MB，但开箱即用、不依赖第三方） |
| D3 | 图片 selector | 与内置一致（不含 `svg`） | 加上 `svg`（`.svg` 也进图片视图，会抢走文本编辑） |

---

## 12. 执行状态：M1 已完成（2026-10-16）

实机验证平台按用户指定的 `D:\app\VSCodeEXE` 改为 **1.137.0**（原 plan 以 1.71.2 为基线）。三项决策全部按推荐项 A 执行（D1 两个视图 `priority:"default"`、D2 走预览扩展点、D3 selector 不含 `svg`），执行中做了一处修订：

> **R3 改用 `contributes.configurationDefaults`** —— 把 `markdown-mermaid.mouseNavigation.enabled` 的默认值从 `alt` 抬成 `always`，于是**默认**就能滚轮缩放/拖动平移。不再自 bundle mermaid（宿主的 mermaid 前端脚本自带 pan/zoom，只是默认要求按 Alt）。少写约 50 行前端代码，且不产生双手势冲突。

| 产物 | 位置 |
|---|---|
| Task 0 冒烟记录 | `.claude/plans/m1-smoke.md` |
| 端到端验证记录 | `.claude/plans/m1-verify.md` |
| 安装包 | `wispkit-0.1.0.vsix`（27 文件 / 33.54 KB），已装进 1.137.0 |
| 自检工具（不进 VSIX） | `tools/selftest/`、`.selftest/` |

关键证据：真实 webview 里内置 mermaid 脚本渲染出 **1 个 svg**、目录 **7 条**、相对图片**加载成功**、**CSP 违规 0**；`npm test` **65 passing**，并通过两次变异测试证明测试有效（加回 Ctrl 前置 → 5 红；写错贡献键 → 4 红）。

## 13. 执行状态：M2 已完成（2026-10-16）

用户在本轮报告了 7 个界面问题，并追加 3 项需求（媒体右键菜单 / drawio 就地编辑 / XAML 源码+渲染并排）。全部落地并在真实 **1.137.0** 上验证。

### 13.1 用户报告的 7 个问题 → 根因与证据

| # | 问题 | 根因 | 实测证据 |
|---|---|---|---|
| 1 | 缺编辑模式切换 | 没有入口 | 工具栏「编辑」+ 标题栏图标 + `wispkit.toggleEditorType`；`toggleCommandRegistered: true` |
| 2 | 目录树不能调宽 / 收纳 / 折叠 | 宽度写死 240px、无折叠概念 | 分隔条拖拽（下限 120px）+ 双击复位 + 跨会话记住；`sidebarState.hiddenAfterToggle: true`；`collapseState` 折叠后 4 → 展开后 0 |
| 3 | 点击定位没有聚焦到对应层级 | 只滚动，不展开折叠祖先、不更新高亮 | `reveal()` 先展开祖先再定位；文档内 `#锚点` 走同一路径 |
| 4 | 加粗 / 字体不像内置预览 | **我们自己给 `body` 写了 `font` 简写**，把内置 `--markdown-font-*` 变量挡住了 | 改为只注入变量后 `bodyFontSize: 17px` == 注入值，`markdownFontSizeVar: 17px` |
| 5 | mermaid 还是只能区域内放大 | 用的是宿主自带 pan/zoom（区域级） | 改为占满主窗口的模态框 + 滚轮缩放 + 右键拖动 + 双击复位 + Esc；`lightboxSvg.opened/visible: true` |
| 6 | `data:` 图片缺少放大预览 | 没有入口 | `dataImageLoadedCount: 1`，点击即进模态框 |
| 7 | **image 预览页全部图片显示不出来** | `localResourceRoots` 只含扩展目录，而**图片本体在工作区** → 被 webview 拒载 | `imagePage.probe: loaded true, naturalWidth 1200` |

### 13.2 顺带查出的 3 个真 bug（此前一直存在）

1. **`data-settings` 属性名撞车**：我们的配置 meta 用了 `data-settings`，而内置 `media/index.js` 恰好按该属性取数据 → 它抛 `Could not load data for data-settings`。已改名 `data-wispkit`，并加断言防回归。
2. **markdown 视图漏了 `enableCommandUris`**（html 视图有）→ 所有 `command:` 链接点了没反应，**包括 M1 的 R5 改写，它在 markdown 视图里一直是坏的**。
3. **`markdown.api.render` 传字符串** → 内置引擎的 `currentDocument` 恒为 `undefined`（`markdownEngine.ts:206`）；改传文档对象后第三方 markdown-it 插件才能拿到文档 URI。

### 13.3 新增功能

**① 媒体右键菜单**（图片 / mermaid / drawio）：webview 里的图片地址是 `vscode-webview://`，**反解不出真实路径** —— 所以前端只报「第几个元素 + 类型」，路径与源码由宿主回原文里取（`src/media/parse.ts`，纯函数）。图片额外用 `alt` 交叉校验。

**② drawio 就地编辑**：drawio 扩展 1.17.0 已把编辑交给新版 Markdown 编辑器（`markdown.codeBlockEditorProviders`），custom editor 里没有那套宿主 → 自研：抽代码块 → 临时 `.drawio` → `vscode.openWith(..., 'hediet.vscode-drawio-text')` → 保存时按内容重新定位回写。

**③ XAML 源码 + 渲染并排**（`wispkit.xaml`，`priority: option`）：调用随扩展分发的 .NET 渲染器（`tools/xaml-render`，framework-dependent 201 KB），程序集从 xaml 目录逐级向上找 `bin/(Release|Debug)/<tfm>/*.dll`。

### 13.4 XAML 路线①：两处关键修正（都是本轮实测踩出来的）

渲染器第一版在真实项目上 **0/6**（全部失败于 `DataContext`/`Binding`），修正后 **6/6 渲染成功**。

1. **`System.Xaml` 的 `XamlObjectWriter` 与 WPF 依赖属性结构上不兼容** —— 它把 DP 当普通 CLR 属性，遇到 `Binding` / `Command` 必然抛「只能在 DependencyObject 的 DependencyProperty 上设置 Binding」。给 schema context 传程序集**不能**解决（已实测）。**出路是改用 WPF 自己的 `XamlReader.Parse`**（认识 DP），并对 `x:Class` / 事件处理器做变体退化。修正后这一路径被提到优先位置。
2. **补全 `clr-namespace` 时不能盲取 `--assembly` 的第一个** —— VS Code 侧 `discoverAssemblies` 会传整个输出目录的 dll，第一个未必是 `x:Class` 所在程序集，猜错就把类型解析指到别的程序集上。改为**先用 `x:Class` 在已加载程序集里反查**，命中的排最前。
3. Window 根仍渲染 `Content`；`App.xaml`（`Application` 根）无法渲染 —— 同一 AppDomain 不能有两个 `Application` 实例，且它本就不是可视视图。

### 13.5 验证

| 项 | 结果 |
|---|---|
| `npm run compile` / `npm run lint` | 0 错 / **0 error** |
| `npm test` | **164 passing** |
| 真实项目 XAML 批量 | `Common.Resources` 6 个控件 **6/6 成功**（含 `Binding`/`Command`/自定义控件）；目视确认 `Work.xaml` 渲染出「▶ ⏸ ⏹」控制按钮组 |
| 用户项目 `NewsBoard.Wpf` | MainWindow.xaml **渲染成功**（`root=BlazorWebView` 1280×800；因是 Blazor Hybrid，XAML 里只有宿主控件，空白是正确的） |
| 端到端（真实 VS Code webview，素材=真实项目 XAML） | 自动发现 3 个程序集 → `ok:true` → 页面 `imageLoaded:true`(102×49) / 27 行源码 / 4 按钮 / splitter / lightbox ✓ / **违规 0、脚本错误 0** |
| 右键菜单（真实 webview 探针） | 图片菜单 4 项、图表菜单 3 项、点击回传 `{action:'copyText',kind:'mermaid',index:0}` ✓ |
| drawio 编辑链路（宿主侧） | 临时文件生成 ✓、内容与源码块**逐字一致** ✓、剪贴板拿到 mermaid 原文 ✓ |

### 13.6 已知边界（诚实清单）

1. **XAML 渲染是静态快照**：无 DataContext、不跑事件处理器、`x:Name` 不写字段。
2. **`App.xaml` 这类 `Application` 根渲染不了**（上条已述）；`ResourceDictionary` 根同样无可视内容。
3. **跨文件资源字典未预加载**：`StaticResource` 指向别的 XAML 时会失败。
4. **Blazor Hybrid 项目的 XAML 渲染必然空白** —— UI 在 Razor 里，XAML 只剩 `<BlazorWebView>` 宿主。
5. **本机沙箱限制（非产品缺陷）**：自编译的 exe 无法写 C 盘用户目录（`%TEMP%`/`%APPDATA%`/`Documents` 均被拒），D 盘工作区正常。真实 VS Code 环境无此限制；自检脚本因此把 XAML 输出改到工作区内。
6. `note` 是渲染器附加的 JSON 字段（说明用哪个类型承载），宿主忽略它；若将来做严格 schema 校验需注意。

## 14. 执行状态：M3 —— 用户反馈的问题与新需求（2026-10-16）

### 14.1 用户截图里的两个现象 → 根因与修复（均有实测）

| 现象 | 根因 | 修复 | 证据 |
|---|---|---|---|
| 正文 / 目录 / 代码块**行高重叠** | 本扩展给 `--markdown-line-height` **多拼了 `px`**：内置 `documentRenderer.ts:213` 是原样输出（数字 = 字号倍数，默认 `1.6`），拼上后变成 `1.6px` | 照抄内置换算：`fontSize` 拼 `px`，`lineHeight` 原样 | `src/test/markdownPage.test.ts` 防回归断言；真机探针 `markdownLineHeightVar` 与实际计算值一致 |
| 放大后的 **mermaid 图变黑**（正文里正常） | `media/shared/lightbox.js` 克隆 svg 时 `removeAttribute('id')`，而 mermaid 把配色写在 `<style>#mermaid-abc .node rect{fill:...}</style>` 这种 **id 作用域**规则里 → 规则全部失配 → 填充回落成黑 | 克隆换新 id（`<原id>-wispkit-lightbox`）并同步改写内联 `<style>` 的作用域 | 真机探针：`sourceNodeFill = rgb(243,243,243)` 与 `clonedNodeFill = rgb(243,243,243)` **一致**（修复前为纯黑）；`lightbox.test.ts` 新增 2 条 |

### 14.2 `markdown.preview.lineHeight` 的语义陷阱

内置 `markdown.preview.lineHeight` **默认 `1.6`**，语义是**字号倍数**（`markdown-language-features/package.json:1824-1829`），`markdown.css:10` 直接 `line-height: var(--markdown-line-height, 22px)`。
填 `26` 表示 **26 倍**（17px × 26 = 442px），想约 26px 要填 `1.5`。**内置预览在同样的值下表现完全相同** —— 本扩展只是不再额外制造第二个错误。

### 14.3 本轮新增/变更的功能

- **交互渲染编辑模式**（用户明确要求"当前视图切换"，不是另开无渲染编辑器）：工具栏「编辑」→ 左 `<textarea>` / 右实时渲染；输入 250ms 防抖 → 宿主用同一条 `markdown.api.render` 管线渲染 → 回传替换预览；替换后在 `window` 派发 `vscode.markdown.updateContent` 让 mermaid 重渲染；`Ctrl+S` /「保存」经 `WorkspaceEdit` 整篇写回。源码按需索取（纯预览不加载）。
- **移除** `wispkit.toggleEditorType` 命令与标题栏按钮（原设计切到 VS Code 原生编辑器，与新要求冲突）。
- **XAML 源码区可编辑**：`<pre>` → gutter + `<textarea wrap="off">`，行号与文本行同字体/字号/行高/上内边距并同步滚动；工具栏加「保存」；「重新渲染」改用编辑区当前文本（宿主先落 `storageDirectory/preview-<hash>.xaml` 再渲染）。
- **XAML 示例数据**：`demo/R6-xaml/` 4 个必定渲染成功的 XAML + README。
- **修复** `src/imageProvider.ts` 的 `localResourceRoots` 缺图片父目录（"image 预览全部图片显示不出来"的根因）。

### 14.4 本轮事故（如实记录）

重写 `src/config.ts` 前**没有先读它**（`Wispkit/` 目录尚无 git commit，无法回滚），把上一轮加的 `readXamlViewConfig()` 覆盖掉了，导致并行子代理编译中断。已按 `package.json` 的 `wispkit.xaml.codeVisible` / `codeWidth` 默认值重建并复验。**教训：write 覆盖前必须先 read。**

### 14.5 验证

`npm run lint` 0 error · `npm test` **173 passing** · `npm run package` 42 files / 180.54 KB · 真机探针（VS Code 1.137.0）复验 lightbox 克隆配色与行高变量。

### 14.6 未完成 / 待办

1. **XAML 宿主侧未实机验证**：`wispkit.saveText` / `wispkit.renderXaml` 的写盘与临时文件渲染只经静态审查与单测，端到端需在真机点一次「保存」与「重新渲染」。
2. **两项新需求待用户拍板后开工**：全局只读模式 + 悬浮解锁；资源管理器子树浏览 + `.WispkitView/Wispkit.json` 展示按钮。

## 15. 执行状态：M4 —— 全局只读模式 + 子树浏览（2026-10-16）

用户已拍板：只读开关放**状态栏右侧**；只读模式**接管所有文本文件**（md/html/xaml/图片除外，理由见下）。

### 15.1 全局只读模式

- **入口**：状态栏右侧开关 `wispkit.toggleReadOnly`（用户指定位置）；启动值由 `wispkit.readonly.default` 决定，默认**非只读**。状态存在 `workspaceState`，没手动切过时跟随设置。
- **只读时**：其他文本文件（`.ts` / `.json` / `.txt` / `.log` …）被换成 `wispkit.text` 只读预览。
- **真省开销的落点**：用 `CustomEditorProvider`（**不创建 TextDocument**）+ `fs.promises.open/read` **只读文件头**（`readonly.previewBytes`，默认 64 KB），再按 `readonly.previewLines`（默认 800）截行 —— 大文件永远不会整份进内存。
- **解锁**：预览右下角悬浮「解锁编辑」→ 该文件改回 VS Code 原生编辑器，并关掉只读标签页（`window.tabGroups.close`）。
- **不打扰的边界**：不拦截 peek / diff / 后台打开（找不到标签页就跳过）；不改已被 Wispkit 接管的浏览视图 —— 截断 Markdown 会渲染出残缺结果。
- **文件**：`src/readonly/file.ts`（BOM 解码 + 字节/行截断，纯逻辑可测）、`src/readonly/state.ts`（状态 + 状态栏）、`src/readonly/intercept.ts`（拦截 + 标签页工具）、`src/readonlyProvider.ts`、`src/readonly/page.ts`、`media/readonly.{js,css}`。
- **演示数据**：`demo/R7-readonly/`（1.6 MB / 20000 行合成日志 + README 验收步骤）。

### 15.2 资源管理器子树浏览 + `.WispkitView` 展示

- **入口**：资源管理器每个文件夹行右侧两个图标 —— `wispkit.subtree.open`（子树浏览）与 `wispkit.wispkitView.open`（展示）。
- **面板复用**：同一文件夹重复点击只 `reveal`，不新开面板（`src/subtreeProvider.ts` 按文件夹路径索引）。
- **懒加载**：展开某一层才读盘；`FileStat` 给 size/mtime/ctime，`atime` 与权限位 VS Code 不暴露，对应列恒为 `-`。
- **列与工具可配置**：`wispkit.subtree.columns` 决定列顺序（非法项过滤、去重、回退默认）；自定义工具支持 `${file}` / `${dir}` / `${name}` / `${workspaceFolder}` 占位与四种执行方式（静默 / 当前终端 / 新终端 / 系统终端窗口）。
- **复用资源管理器菜单**：扩展贡献的 `explorer/context` 命令自动收集（可靠）；内置命令走手工白名单（`revealInExplorer` / `revealFileInOS` / `copyFilePath` / …），执行前用 `commands.getCommands(true)` 校验，不存在则弹警告说明，绝不静默；参数类型不符时当场抛错并显示原因。
- **`.WispkitView`**：先查 `<文件夹>/.WispkitView/Wispkit.json`，再查 `<文件夹>/Wispkit.json`；按 `entry` + `openWith` 打开（`src/subtree/wispkitView.ts` 纯逻辑）。
- **文件**：`src/subtree/{types,columns,config,wispkitView,explorerCommands,page}.ts`、`src/subtreeProvider.ts`、`src/wispkitViewProvider.ts`、`media/subtree.{js,css}`；`src/extension.ts` 只加 4 行注册。
- **演示数据**：`demo/R7-subtree/`（含 `.WispkitView/Wispkit.json` 与三层嵌套目录）。

### 15.3 验证（真实 VS Code 1.137.0，`tools/selftest` 探针）

| 项 | 实测 |
|---|---|
| 只读拦截 | `intercepted: true` / `tabCount: 1` / `noLeftoverTextTab: true`；截断 `shownBytes: 64` / `shownLines: 10` |
| 只读命令注册 | `wispkit.toggleReadOnly: true` |
| 子树面板 | `panelOpened: true`，viewType `wispkit.subtree`，标题「子树：演示工程」 |
| 面板复用 | 对同一文件夹再执行一次命令 → `reusedSinglePanel: true` |
| `.WispkitView` 展示 | `openedAsHtml: true`，打开的正是 `.WispkitView/index.html` |
| 正文行高 | `bodyLineHeight: 22.4px`（`--markdown-line-height: 1.6`，14 × 1.6）；TOC 项高 26px、间隔 26–27px，**无重叠** |
| 背景 / 主题 | body 与放大模态框均为 `rgb(18,19,20)`；`vscode-dark` 下 mermaid 节点 `rgb(32,33,34)` + 描边 `rgb(35,107,142)` + 文字 `rgb(204,204,204)` |
| 脚本错误 / CSP 违规 | **0 / 0** |

M4 期间发现并修掉**两个探针缺陷**（不是产品缺陷）：① 探针的扩展映射漏传 `id`，导致内置 `media/index.js` 的过滤失效、报出 `Could not load data for data-settings` —— 真实 provider 传了 `id`，用户侧没有这个错；② 探针硬编码排版值而非读真实配置，测不到 `markdown.preview.lineHeight` 的换算。两者都已修，探针现在与产品行为一致。

**仍然过滤内置 `media/index.js`（有意为之）**：它顶层调用 `acquireVsCodeApi()`，而该 API 在同一个 webview 里**只能调用一次** —— 我们的前端也要它，两者必有一崩。它提供的价值（代码块复制按钮、图片原生右键菜单）本扩展已自行实现；它的**样式**保留（正文排版用的就是它们）。实测 `media/index.js` 跑不起来**不影响** mermaid：mermaid 由独立贡献脚本 `markdown-preview-out/index.js` 负责（`mermaidSvgs: 3`）。

## 16. 执行状态：M5 —— 第二轮用户反馈（2026-10-16）

用户对编辑模式、目录位置、XAML 打开方式、只读实现、子树视图提出 6 组修改要求。

### 16.1 决策（用户已拍板）

| 议题 | 决策 |
|---|---|
| Markdown 编辑模式 | 放弃「左源码 / 右渲染」分栏，改为**无分栏的整篇覆盖式编辑**（对齐内置新版 markdown editor：切到编辑态即就地编辑，光标就地） |
| 目录栏位置 | 默认**右侧**，可切换左右 |
| XAML 打开方式 | **只关联 `*.xaml`** —— 用户明确纠正「`*.xaml.cs` 不需要」；`priority` 由 `option` 改为 **`default`**（即原生默认就用本视图打开） |
| XAML 视图 | 代码区要**语法高亮**；新增「收纳左 / 收纳右 / 都显示」三个快速切换 |
| 只读模式 | 改用 `workbench.editorAssociations`，让**原生打开方式就是只读视图** —— 不再先加载原生编辑器（消除闪烁、真省加载、无法绕过）。用户的两个目的：省加载开销、防误修改 |
| 子树视图 | 文件类型列、点列名排序、列宽可拖、Ctrl/Shift/Ctrl+A 多选、type-ahead 定位、操作区分组、补剪切/复制/粘贴/重命名/删除、未配置工具隐藏、内置命令中文标签、选中路径靠右取代文件夹名、「展开一层」按选中项生效、按钮配主题图标 |

### 16.2 已说明的硬限制

- **资源管理器文件夹行右侧的图标**：VS Code 不提供让扩展把按钮插入**内置**资源管理器树项的机制 —— `view/item/context` 的 `inline` 组只对扩展自己贡献的视图生效。用户已接受保持**右键菜单**；子树视图**内部**的图标改为对齐资源管理器的图标风格。

### 16.3 待修正（子代理不可寻址）

本会话的 `subagent_fork` 子代理**不可寻址**（`list_agents` 只返回 lead，`send_message` 报 not found），无法在运行中纠偏。以下在子代理交付后立即修正：

1. **移除任何 `*.xaml.cs` 关联** —— 子代理按最初任务书可能会加上，而用户已明确不需要；
2. 「整篇覆盖式编辑」不得与目录位置改动在同一批文件上并发，单独串行执行。
