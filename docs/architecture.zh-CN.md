---
type: Guide
title: 架构
description: Wispkit 的三层结构、每个模块的职责、一次完整数据流与关键设计取舍
tags: [architecture, vscode-extension, webview]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# 架构

[English](architecture.md) | **中文** | [Español](architecture.es.md)

## 分层

Wispkit 是标准的 VS Code 扩展两段式结构，多出来的一段是**宿主与前端共享的纯逻辑**：

```text
┌─────────────────────────── 扩展宿主（Node，可访问 vscode API）───────────────────────────┐
│ src/extension.ts        激活入口：注册 5 个编辑器 + 拦截器 + 2 个命令                     │
│ src/*Provider.ts        5 个 CustomEditorProvider + 1 个面板 + 1 个命令提供者              │
│ src/config.ts           把所有 wispkit.* 设置读成强类型对象                               │
│ src/mediaActions.ts     媒体右键菜单的宿主侧处理（另存为 / 复制路径 / 复制源码）            │
│ src/markdown/ src/html/ src/image/ src/xaml/ src/readonly/ src/subtree/ src/media/ src/util/ │
│                         每个目录 = 一个功能域，纯逻辑与 vscode 依赖分离                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
              │  ① 生成 HTML 字符串 + nonce/CSP   ② postMessage 双向
              ▼
┌─────────────────────────── webview 前端（浏览器环境，无 vscode API）──────────────────────┐
│ media/markdown.js  目录树、媒体右键、全屏模态框、drawio 桥、编辑模式                       │
│ media/image.js     滚轮缩放 / 拖动平移 / 双击 fit                                     │
│ media/xaml.js      源码高亮叠层、渲染图 panzoom、分栏拖拽                                │
│ media/readonly.js  只读预览的解锁按钮                                                  │
│ media/subtree.js   树渲染、排序、选中、右侧操作区、列宽拖拽                              │
│ media/shared/      panzoom · lightbox · toc · contextmenu · paragraph（复用组件）        │
└──────────────────────────────────────────────────────────────────────────────────────┘
              ▲  ③ 同一份纯逻辑被两端共用（host 侧 import、前端由 esbuild 打包）
              │
       src/util/  src/media/parse.ts  src/subtree/{columns,sort,wispkitView,fileActions}.ts
       src/readonly/highlight.ts  src/xaml/highlight.ts  src/subtree/iconTheme.ts
```

第三段的含义：这些模块**刻意不 import `vscode`**，因此既能在扩展宿主里直接调用，也能在 Node 测试环境里直接单测，还能被 esbuild 打进前端 bundle。它们是这个项目测试覆盖最高的一批文件。

## 扩展宿主层：模块职责

| 文件 | 职责 |
|---|---|
| `src/extension.ts` | 激活入口。`activate()` 里一次性 push 了 9 个 disposable：5 个编辑器/面板的 `register()`、只读拦截器、子树面板、`wispkitView` 命令、`wispkit.openWith` 命令。另导出 `viewTypeFor(uri)` —— 按扩展名决定用哪个视图，供 `openWith` 与测试共用 |
| `src/config.ts` | 读取并规整全部 `wispkit.*` 设置。前端需要的字段（字号、行高、缩放步长…）单独切出，**不把整个配置对象丢给 webview** |
| `src/markdownProvider.ts` | Markdown 视图的 `CustomEditorProvider`。聚合第三方 `markdown.previewScripts` / `previewStyles`，喂 nonce/CSP，处理 `render` / `save` / 媒体动作 / drawio 等消息 |
| `src/mediaActions.ts` | 媒体右键菜单的宿主侧执行：`另存为…`、`复制路径`、`复制 Markdown 原文`、`用 Draw.io 打开` |
| `src/htmlProvider.ts` | HTML 视图（`priority: option`），把源码包装成带宽松 CSP 的页面，并改写 `vscode://file/` 链接 |
| `src/imageProvider.ts` | 图片视图（`priority: default`），把文件转成 webview 可加载的 URI 并下发给前端 |
| `src/xamlProvider.ts` | XAML 视图：读写源码、调用外部渲染器、把 PNG 以 data URI 或临时文件形式回传 |
| `src/readonlyProvider.ts` | 只读文本视图：读文件头、截行、交给 `readonly/page.ts` 生成带高亮的 HTML |
| `src/subtreeProvider.ts` | 子树面板（webviewPanel，非 customEditor）：懒加载读盘、排序、自研文件操作、四种 shell 工具执行。仓库里最大的宿主文件（约 28 KB） |
| `src/wispkitViewProvider.ts` | `wispkit.wispkitView.open` 命令：按 `.WispkitView/Wispkit.json` 的 `entry` + `openWith` 打开目标 |

## 功能域目录

| 目录 | 文件 | 职责 |
|---|---|---|
| `src/markdown/` | `contributions.ts` | 遍历 `vscode.extensions.all`，按**扁平点号键**读 `contributes["markdown.previewScripts"]` / `["markdown.previewStyles"]`。这是 VS Code 的真实契约，不是嵌套的 `markdown: { previewScripts }` |
| | `render.ts` | 调用内置隐藏命令 `markdown.api.render` 把源码渲染成 HTML；这样第三方 `markdownItPlugins`（mermaid、katex）自动生效 |
| | `page.ts` | 生成 Markdown 视图的 HTML 骨架，前端配置只传必要字段 |
| `src/html/` | `page.ts` | HTML 页面包装：宽松 CSP（放行内联脚本与 http(s)）+ `vscode://file/` 链接改写 |
| `src/image/` | `page.ts` | 图片页面的 HTML 与前端配置 |
| `src/xaml/` | `page.ts` | XAML 视图 HTML（源码栏 + 渲染栏 + 分隔条） |
| | `highlight.ts` | 自研 XAML / XAML.cs 轻量高亮。高亮层与 `<textarea>` 叠放，textarea 文字透明只留光标，所以**输出的可见字符必须与输入逐字相同** |
| | `renderer.ts` | 调用独立 .NET 进程，契约冻结为 `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...` |
| `src/readonly/` | `associations.ts` | 把文本文件的**原生打开方式**写进 `workbench.editorAssociations`，让 VS Code 直接用 `wispkit.text` 打开 |
| | `intercept.ts` | 拦截"已被原生编辑器打开"的文件，换成只读预览（会产生一次标签替换，见限制篇） |
| | `state.ts` | 全局只读开关的状态、应用/移除 associations、状态栏项 |
| | `file.ts` | 判定哪些类型**不拦截**（Markdown / HTML / XAML / 图片 —— 它们本来就是浏览视图） |
| | `highlight.ts` | 只读视图的通用语法高亮：零第三方依赖、纯函数、可单测 |
| | `page.ts` | 只读预览 HTML（行号 + 高亮 + 悬浮解锁按钮） |
| `src/subtree/` | `types.ts` | `TreeEntry` 等跨 webview 传递的**原始类型**（不传 `vscode.Uri` / `Date`） |
| | `columns.ts` | 9 种列定义、顺序解析（过滤非法/去重/回退默认）、单元格格式化 |
| | `sort.ts` | 按列排序的纯逻辑 |
| | `config.ts` | 自定义工具配置解析、`${file}/${dir}/${name}/${workspaceFolder}` 替换、命令行拼装 |
| | `wispkitView.ts` | `Wispkit.json` 解析、两处查找顺序、`entry` 越界校验 |
| | `explorerCommands.ts` | 操作区分三类：**native**（自研文件操作）、扩展贡献的 `explorer/context` 命令（自动收集）、内置白名单命令（执行前用 `commands.getCommands(true)` 校验） |
| | `fileActions.ts` | 自研文件操作（剪切/复制/粘贴/重命名/删除/新建/比较）的**纯逻辑**部分。之所以自研：内置 `filesExplorer.*` 命令不接受外部 URI 参数 |
| | `iconTheme.ts` | 图标主题的**纯解析**（不 import `vscode`），四级查找：`fileNames → fileExtensions → languageIds → file` |
| | `iconThemeHost.ts` | 宿主侧读盘与 URI 转换；从 `contributes.languages` 建「扩展名 → 语言 id」桥，供 `mergeLanguageIcons` 合成 |
| | `page.ts` | 子树面板 HTML；列宽走 `--wispkit-col-*` 变量，表头与数据行共用 |
| `src/media/` | `parse.ts` | 源码侧媒体定位：把"页面上第 N 个图片/图表"映射回 Markdown 原文那一段。纯函数 |
| `src/util/` | `csp.ts` | webview CSP 文本，镜像内置 Markdown 预览的 Strict 级策略（`documentRenderer.ts:275`） |
| | `nonce.ts` | 32 字节随机数的 base64，用于 CSP nonce |
| | `html.ts` | `escapeHtml` / `escapeAttribute` |
| | `linkRewrite.ts` | 把 `vscode://file/<路径>[:行号]` 改写成 `command:` 链接 —— 宿主 `isSupportedLink` 只放行 http(s)，不改写就点不动 |

## 一次完整数据流：打开一个 `.md`

1. **VS Code 决定用谁开**：`.md` 命中 `package.json` 里 `wispkit.markdown` 的 selector，且 `priority: default`，于是交给 `MarkdownEditorProvider`。
2. **宿主读配置**：`config.ts` 读出 `wispkit.toc.*`、`markdown.preview.*` 字号字体行高等，并切成前端要用的最小集合。
3. **宿主聚合第三方贡献**：`markdown/contributions.ts` 扫全部扩展的 `contributes`，得到脚本列表与样式列表，并把各自的 `extensionUri` 并入 `localResourceRoots`（否则那些资源在 webview 里加载不到）。
4. **宿主渲染正文**：`markdown/render.ts` 执行内置 `markdown.api.render`，得到 HTML —— 这一步让 mermaid、katex 的 `markdownItPlugins` 生效。
5. **宿主生成页面**：`markdown/page.ts` 拼出 HTML（注入 `<script nonce=...>`、`<link>`、CSP meta、初始正文），`nonce.ts` 生成随机 nonce。
6. **webview 加载**：`media/markdown.js` 拿到正文后建目录树（`shared/toc.js`）、绑定媒体右键（`shared/contextmenu.js` + `shared/lightbox.js`）、初始化 panzoom（`shared/panzoom.js`）。
7. **第三方脚本重渲染**：前端在 `window` 上派发 `vscode.markdown.updateContent`，内置 mermaid 脚本据此把 `<div class="mermaid">` 画成 svg。
8. **用户交互 → 消息回传**：右键"复制源码"时，前端只发 `{ action: 'copyText', kind: 'mermaid', index: 0 }`；宿主用 `media/parse.ts` 按 index 回原文取源码，写剪贴板。
9. **保存（编辑模式）**：前端发文本，宿主用 `WorkspaceEdit` 整篇替换，进正常撤销栈。

## 设计理由

**为什么用 `CustomEditorProvider` 而不是 `webviewPanel`？** 因为要**接管打开方式** —— 双击 `.md` 就该进这个视图。`webviewPanel` 只能由命令创建，抢不到打开方式（Simple Browser 就是这种形态，所以它无法被接管）。

**为什么媒体右键只报「索引 + 类型」？** webview 里的资源地址是 `vscode-webview://`，**反解不出真实文件路径**。既然前端拿不到路径，就让它只报位置，路径与源码由宿主回原文取。图片额外用 `alt` 做交叉校验，索引错位也能救回来。

**为什么走 `markdown.api.render` 隐藏命令？** 自己实现 Markdown 渲染就会丢掉第三方 `markdownItPlugins`（mermaid、katex 全靠它）。用内置命令等于复用官方管线，代价是依赖一个未公开命令。

**为什么只读模式不创建 `TextDocument`？** 目标就是"省加载开销"。走 `CustomEditorProvider` + 直读文件头，才能做到不整份进内存；代价是拿不到官方语法着色，所以 `readonly/highlight.ts` 自研了一套通用着色。

**为什么纯逻辑要独立成不 import `vscode` 的文件？** 为了可测。`src` 共 11,450 行 TypeScript（其中测试 5,730 行）、20 个测试文件、477 个用例，其中大量用例跑在 Node 里、不启动 VS Code —— 只有把解析/格式化/排序/高亮这类逻辑与 `vscode` 解耦才做得到。

## 规模

| 项 | 值 |
|---|---|
| 扩展宿主与纯逻辑 | `src` 共 11,450 行 TypeScript（不含测试 5,720 行） |
| 前端 | `media` 15 个文件（含 `shared/` 5 个复用组件） |
| 测试 | 20 个测试文件 / 477 用例 |
| 随扩展分发的原生工具 | `tools/xaml-render`（.NET，framework-dependent） |
