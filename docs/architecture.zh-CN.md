---
type: Guide
title: 架构
description: Wispkit 的三层结构、每个模块的职责、一次完整数据流、3D 可视化的宿主/前端分工、自定义资源管理的分层与关键设计取舍
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
│ src/extension.ts        激活入口：注册 7 个编辑器 + 只读拦截器 + 子树 / 3D 面板 + 2 个命令  │
│ src/*Provider.ts        7 个 CustomEditorProvider + 2 个 webviewPanel + 资源树 + 命令提供者 │
│ src/config.ts           把所有 wispkit.* 设置读成强类型对象                               │
│ src/mediaActions.ts     媒体右键菜单的宿主侧处理（另存为 / 复制路径 / 复制源码）            │
│ src/graph3dProvider.ts  3D 面板：读 Markdown / Mermaid、抽取图元素、把 payload 交给 webview │
│ src/mermaidProvider.ts  .mmd 浏览：内置 Mermaid 渲染 + 源码 / 3D 入口                     │
│ src/mermaid/            .mmd 页面骨架与状态（纯逻辑 + HTML）                              │
│ src/graph3d/            ASCII / Mermaid 解析、图元素抽取、合并、3D 布局（纯逻辑）           │
│ src/markdown/ src/html/ src/image/ src/xaml/ src/readonly/ src/subtree/ src/media/ src/util/ │
│                         每个目录 = 一个功能域，纯逻辑与 vscode 依赖分离                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
              │  ① 生成 HTML 字符串 + nonce/CSP   ② postMessage 双向
              ▼
┌─────────────────────────── webview 前端（浏览器环境，无 vscode API）──────────────────────┐
│ media/markdown.js  目录树、媒体右键、全屏模态框、drawio 桥、编辑模式                       │
│ media/mermaid.js   .mmd 工具栏：源码 / 3D / 刷新，更新时通知内置脚本重渲染                │
│ media/image.js     滚轮缩放 / 拖动平移 / 双击 fit                                     │
│ media/video.js     原生 <video>、系统播放器 / 复制路径工具栏                            │
│ media/xaml.js      源码高亮叠层、渲染图 panzoom、分栏拖拽                                │
│ media/readonly.js  只读预览的解锁按钮                                                  │
│ media/subtree.js   树渲染、排序、选中、右侧操作区、列宽拖拽                              │
│ media/graph3d.js   three.js 3D 场景、气泡 / 文字 Sprite / 连线、左右分栏与合并            │
│ media/shared/      panzoom · lightbox · toc · contextmenu · paragraph（复用组件）        │
└──────────────────────────────────────────────────────────────────────────────────────┘
              ▲  ③ 同一份纯逻辑被两端共用（host 侧 import、前端由 esbuild 打包）
              │
       src/util/  src/media/{parse,formats,csp}.ts  src/subtree/{columns,sort,wispkitView,fileActions}.ts
       src/readonly/highlight.ts  src/xaml/highlight.ts  src/subtree/iconTheme.ts
       src/graph3d/{ascii,mermaid,markdownElements,merge,layout,selection,types}.ts
       src/resourceTree/{model,paths,storageCore,transfer,presentation}.ts
```

第三段的含义：这些模块**刻意不 import `vscode`**，因此既能在扩展宿主里直接调用，也能在 Node 测试环境里直接单测，还能被 esbuild 打进前端 bundle。它们是这个项目测试覆盖最高的一批文件。

## 扩展宿主层：模块职责

| 文件 | 职责 |
|---|---|
| `src/extension.ts` | 激活入口。`activate()` 里一次性 push 了 **17 个 disposable**：9 个自定义编辑器的 `register()`（其中快捷方式与可执行文件两个页面共用一个实现类、按 viewType 各注册一次）、只读拦截器、子树面板、`wispkitView` 命令、3D 面板、资源树、存储器视图、链接与可执行文件的命令组、`wispkit.openWith` 命令。另导出 `viewTypeFor(uri)` —— 按扩展名决定用哪个视图，供 `openWith` 与测试共用 |
| `src/config.ts` | 读取并规整全部 `wispkit.*` 设置。前端需要的字段（字号、行高、缩放步长…）单独切出，**不把整个配置对象丢给 webview** |
| `src/markdownProvider.ts` | Markdown 视图的 `CustomEditorProvider`。聚合第三方 `markdown.previewScripts` / `previewStyles`，喂 nonce/CSP，处理 `render` / `save` / 媒体动作 / drawio 等消息 |
| `src/mermaidProvider.ts` | Mermaid 文件视图（`.mmd` / `.mermaid`）的 `CustomTextEditorProvider`：把整份源码交给内置 Mermaid 预览脚本渲染，处理刷新 / 打开源码 / 3D 入口；没有预览脚本时退化为源码模式 |
| `src/mediaActions.ts` | 媒体右键菜单的宿主侧执行：`另存为…`、`复制路径`、`复制 Markdown 原文`、`用 Draw.io 打开` |
| `src/htmlProvider.ts` | HTML 视图（`priority: default`），把源码包装成带宽松 CSP 的页面，改写 `vscode://file/` 链接并注入链接路由脚本（`media/dist/html.js`） |
| `src/imageProvider.ts` | 图片视图（`priority: default`），把文件转成 webview 可加载的 URI 并下发给前端；`wispkit.media.openExternal` / `wispkit.media.copyPath` 两条消息支撑无法解码格式的兜底面板 |
| `src/videoProvider.ts` | 视频视图（`priority: default`）：把文件包成带 `media-src` CSP 的原生 `<video>` 页面；同两条宿主消息驱动「系统播放器打开 / 复制路径」按钮 |
| `src/xamlProvider.ts` | XAML 视图：读写源码、调用外部渲染器、把 PNG 以 data URI 或临时文件形式回传 |
| `src/readonlyProvider.ts` | 只读文本视图：读文件头、截行、交给 `readonly/page.ts` 生成带高亮的 HTML |
| `src/subtreeProvider.ts` | 子树面板（webviewPanel，非 customEditor）：懒加载读盘、排序、自研文件操作、四种 shell 工具执行。仓库里最大的宿主文件（约 28 KB） |
| `src/graph3dProvider.ts` | 3D 面板（`wispkit.graph3d`，webviewPanel）：读 Markdown / Mermaid 原文、按扩展名调 `extractElementsForSource`、生成带 strict CSP / nonce 的页面，把图元素 payload 放进 `<meta>`；处理 `wispkit.graph3d.refresh`。同一文件重复打开只 reveal（`Graph3dPanels` 按 URI 复用） |
| `src/resourceTreeProvider.ts` | 自定义资源管理（`wispkit.resourceTree`，TreeView，非 webview）：实现 `TreeDataProvider` + `TreeDragAndDropController`，注册 13 个 `wispkit.resourceTree.*` 命令与配置 / 工作区监听；每次变更先走纯数据层，再原子写工作区 JSON |
| `src/wispkitViewProvider.ts` | `wispkit.wispkitView.open` 命令：按 `.WispkitView/Wispkit.json` 的 `entry` + `openWith` 打开目标 |

## 功能域目录

| 目录 | 文件 | 职责 |
|---|---|---|
| `src/markdown/` | `contributions.ts` | 遍历 `vscode.extensions.all`，按**扁平点号键**读 `contributes["markdown.previewScripts"]` / `["markdown.previewStyles"]`。这是 VS Code 的真实契约，不是嵌套的 `markdown: { previewScripts }` |
| | `render.ts` | 调用内置隐藏命令 `markdown.api.render` 把源码渲染成 HTML；这样第三方 `markdownItPlugins`（mermaid、katex）自动生效 |
| | `page.ts` | 生成 Markdown 视图的 HTML 骨架，前端配置只传必要字段 |
| `src/html/` | `page.ts` | HTML 页面包装：宽松 CSP（放行内联脚本与 http(s)）+ `vscode://file/` 链接改写 + 链接路由脚本注入 |
| `src/image/` | `page.ts` | 图片页面的 HTML 与前端配置，含解码失败兜底面板 |
| `src/video/` | `page.ts` | 视频页面骨架：原生 `<video>`、工具栏（系统播放器 / 复制路径）与不支持容器的提示面板 |
| `src/xaml/` | `page.ts` | XAML 视图 HTML（源码栏 + 渲染栏 + 分隔条） |
| | `highlight.ts` | 自研 XAML / XAML.cs 轻量高亮。高亮层与 `<textarea>` 叠放，textarea 文字透明只留光标，所以**输出的可见字符必须与输入逐字相同** |
| | `renderer.ts` | 调用独立 .NET 进程，契约冻结为 `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...` |
| `src/readonly/` | `associations.ts` | 把文本文件的**原生打开方式**写进 `workbench.editorAssociations`，让 VS Code 直接用 `wispkit.text` 打开 |
| | `intercept.ts` | 拦截"已被原生编辑器打开"的文件，换成只读预览（会产生一次标签替换，见限制篇） |
| | `state.ts` | 全局只读开关的状态、应用/移除 associations、状态栏项 |
| | `file.ts` | 判定哪些类型**不拦截**（Markdown / HTML / XAML / 图片 / 视频 —— 它们本来就是浏览视图；扩展名正则由 `media/formats.ts` 生成） |
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
| `src/resourceTree/` | `model.ts` | 资源树的**纯数据层**（不 import `vscode` / `fs`）：`group` / `folder` 节点、解析与清洗、序列化、增删改移、环检测、id 与数量 / 深度上限 |
| | `paths.ts` | 存储路径 ↔ 绝对路径：`${workspaceFolder}` / `${workspaceFolder:名称}` / `${workspaceFolder:序号}`、工作区外绝对路径、Windows 大小写归一 |
| | `storageCore.ts` | **纯**存储逻辑：配置值解析与非法值诊断、UTF-8 BOM 解码、同目录临时路径、`writeFileAtomically` |
| | `storage.ts` | 宿主适配：把解析结果映射成 `vscode.Uri`（保留 remote / virtual 工作区 scheme），`workspace.fs` 读写与原子写 |
| | `transfer.ts` | 导入计划 `planImport`：非法文件拒绝、警告修复摘要、替换确认文案 |
| | `presentation.ts` | TreeItem 呈现契约：文件夹状态（目录 / 缺失 / 文件 / 无法解析）、description / tooltip 文案、点击命令 |
| `src/graph3d/` | `types.ts` | 图元素 / 节点 / 边 / 分组 / 合并结果的纯数据类型，以及图种中文标签 |
| | `markdownElements.ts` | 从 Markdown 抽图元素：围栏 / 正文裸 ASCII 树、按标题与 title 命名、同名追加序号、`MAX_ELEMENTS` 200 |
| | `ascii.ts` | Unicode / ASCII 树解析：连接线、缩进层级、折行合并、`MAX_NODES` 600 |
| | `mermaid.ts` | Mermaid 拓扑子集解析：12 类图种 + 通用按行兜底、`MAX_NODES` 600 |
| | `mermaidFile.ts` | 独立 `.mmd` / `.mermaid` 文件：整份解析为一个图元素，命名优先 title、其次文件名 |
| | `sources.ts` | 按扩展名分派 Markdown 多元素 / Mermaid 单元素解析，宿主与单测共用 |
| | `merge.ts` | 左右两个图元素按名称合并同名节点、重映射右侧 id / 分组、边去重 |
| | `layout.ts` | 3D 布局：径向树、SCC 缩点分层、确定性力导向、紧凑分层、Louvain 壳内 FR-3D、合并图互斥分离、时序、象限、`void` 悬空占位；纯函数、结果可复现 |
| | `selection.ts` | 刷新后恢复左右下拉选择（保留「不选」、按 id / name 找回） |
| | `page.ts` | 3D 页面骨架、CSP、nonce、payload `<meta>` |
| `src/mermaid/` | `page.ts` | `.mmd` / `.mermaid` 浏览页骨架：工具栏、状态徽标、diagram / source 两种正文 |
| | `status.ts` | 复用 `graph3d/mermaid.ts` 的解析结果，给预览徽标与 3D 入口提供图种 / 节点 / 边计数 |
| `src/media/` | `parse.ts` | 源码侧媒体定位：把"页面上第 N 个图片/图表"映射回 Markdown 原文那一段。纯函数 |
| | `formats.ts` | 图片 / 视频扩展名清单的唯一事实来源、`fileExtension`、矢量图判定与内核可解码分类。纯函数 |
| | `csp.ts` | 图片 / 视频视图的 CSP 文本（`img-src` / `media-src`）。纯函数 |
| | `webview.ts` | 宿主侧共用：媒体文件的 `localResourceRoots`、剪贴板路径、白名单化的 `openExternal` / `copyPath` 消息处理 |
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
6. **webview 加载**：`media/markdown.js` 拿到正文后建目录树（`shared/toc.js`）、套用正文缩放档位（`shared/pagezoom.js`）、挂上 Ctrl+F 查找（`shared/find.js`）、绑定媒体右键（`shared/contextmenu.js` + `shared/lightbox.js`）、初始化 panzoom（`shared/panzoom.js`）。
7. **第三方脚本重渲染**：前端在 `window` 上派发 `vscode.markdown.updateContent`，内置 mermaid 脚本据此把 `<div class="mermaid">` 画成 svg。
8. **用户交互 → 消息回传**：右键"复制源码"时，前端只发 `{ action: 'copyText', kind: 'mermaid', index: 0 }`；宿主用 `media/parse.ts` 按 index 回原文取源码，写剪贴板。
9. **保存（编辑模式）**：前端发文本，宿主用 `WorkspaceEdit` 整篇替换，进正常撤销栈。

## 3D 可视化的分工

3D 面板刻意做成「宿主只出数据、前端只画图」：

| 层 | 做什么 | 不做什么 |
|---|---|---|
| 宿主（`src/graph3dProvider.ts`） | 用 `workspace.openTextDocument` 读 Markdown 原文；调 `extractGraphElements(text)` 得到 `GraphElement[]`（id、名字、图种、语言、起始行、原始源码、节点、边、分组、降级说明）；把 `{ fileName, filePath, elements }` 序列化成 JSON，HTML 转义后放进 `<meta id="wispkit-3d-data" data-wispkit>` | 不碰 three.js、不做布局、不拼接脚本字符串 |
| webview（`media/graph3d.js`） | 读 `<meta>` 里的 payload；左右下拉选择 / 合并；调纯函数 `layoutGraph` 算坐标；用 three.js + OrbitControls 画气泡、文字 Sprite、连线与箭头 | 不读文件、不访问 `vscode` API |

`extractGraphElements` 与 `layoutGraph` 都不 import `vscode` / three / DOM，因此宿主和 webview 能共用同一份代码，也能在 mocha 里直接单测。图种解析、ASCII 树解析、同名节点合并、布局策略全部在这一层，前端只负责选择、相机和绘制。

**three.js 的打包**：`media/graph3d.js` 直接 `import * as THREE from 'three'` 与 `OrbitControls`，esbuild 把 three.js、OrbitControls、`src/graph3d/*` 一起打进 `media/dist/graph3d.js`。这是唯一开启 `minify: true` 的 bundle（three.js 这个较大的依赖 + 手写代码），当前约 **603 KB**；其余 5 个 webview bundle 保持未压缩便于排查。运行时没有任何 CDN 或网络请求。

**CSP / nonce**：页面沿用内置 Markdown 预览的 strict 策略（与 `src/util/csp.ts` 同一份）：`default-src 'none'`；`script-src 'nonce-<random>'`（无 `unsafe-inline`）；`style-src` / `img-src` / `font-src` 放行 `cspSource`、`https:` 与 `data:`（样式另放行 `'unsafe-inline'`）。`<script>` 标签带同一个 nonce；图元素数据只放在转义过的 `data-*` 属性里，不生成内联脚本。样式通过 `media/graph3d.css` 的 webview URI 加载。

**文件结构**：

| 路径 | 职责 |
|---|---|
| `src/graph3dProvider.ts` | 面板生命周期、命令注册、读文件、刷新消息 |
| `src/graph3d/markdownElements.ts` | 从 Markdown 抽图元素：围栏 / 正文裸树、命名与去重、`MAX_ELEMENTS` |
| `src/graph3d/ascii.ts` | Unicode / ASCII 树解析 |
| `src/graph3d/mermaid.ts` | Mermaid 拓扑子集解析（各图种 + 通用兜底、`MAX_NODES`） |
| `src/graph3d/merge.ts` | 左右两个图元素的同名节点合并 |
| `src/graph3d/layout.ts` | 3D 布局：树 / 分层（SCC 缩点）/ 力导向 / 紧凑分层 / Louvain / 合并图互斥分离 / 时序 / 象限 |
| `src/graph3d/selection.ts` | 刷新后恢复左右下拉选择 |
| `src/graph3d/page.ts` | 页面骨架、CSP、nonce、payload meta |
| `src/graph3d/types.ts` | 图元素 / 节点 / 边 / 分组 / 合并结果的纯数据类型 |
| `media/graph3d.js` · `.css` | 前端交互与样式 |
| `media/dist/graph3d.js` | esbuild 产物（含 three.js） |

**一次 3D 数据流**：

1. 用户在资源管理器右键 `.md`（或在命令面板执行 `wispkit.graph3d.open`）。
2. 宿主 `workspace.openTextDocument` 读原文，`extractGraphElements` 解析出 `GraphElement[]`。
3. 宿主创建 `wispkit.graph3d` webviewPanel，生成 nonce / CSP / 资源 URI，把 payload 放进 `<meta>`。
4. `media/graph3d.js` 读取 payload，左侧默认选第 1 个；用户可再选右侧。
5. 每次选择 / 合并 / 间隔变化，前端调 `layoutGraph`（纯函数）得到节点与边的坐标，再交给 three.js 重建场景。
6. 点「刷新」时前端发 `wispkit.graph3d.refresh`，宿主重新读文件并回 `wispkit.graph3d.elements`；失败回 `wispkit.graph3d.error`。

## 自定义资源管理的分层

资源管理沿用 drawcode 的程序集树范式：**`TreeDataProvider` + `TreeDragAndDropController`**、视图标题 / 条目右键命令、内部拖拽与从资源管理器拖入。区别只在存储：drawcode 把树放进 `workspaceState`，Wispkit 必须让用户能外部编辑、导出、导入、点刷新重载，所以落到工作区里一个普通 JSON 文件。

| 层 | 文件 | 依赖 | 职责 |
|---|---|---|---|
| 宿主 / 视图 | `src/resourceTreeProvider.ts` | `vscode` | 实现 `TreeDataProvider` 与 `TreeDragAndDropController`；创建 `TreeView`（`showCollapseAll`）；注册 13 个命令；配置 / 工作区变化时重载；把纯逻辑结果提交为一次原子写 |
| 纯数据层 | `src/resourceTree/model.ts` | 无（不 import `vscode` / `fs`） | 节点类型、解析与清洗、序列化、增删改移、环检测、id 与数量 / 深度上限 |
| 路径层 | `src/resourceTree/paths.ts` | `node:path` | 存储路径 ↔ 绝对路径：工作区占位符、工作区外绝对路径、大小写归一 |
| 存储纯逻辑 | `src/resourceTree/storageCore.ts` | `node:path` | 配置值解析与非法值诊断、UTF-8 BOM 解码、同目录临时路径、原子写 |
| 存储宿主适配 | `src/resourceTree/storage.ts` | `vscode` | 把解析结果映射成 `vscode.Uri`（保留 remote / virtual 工作区 scheme），`workspace.fs` 读写与原子写 |
| 导入 / 导出 | `src/resourceTree/transfer.ts` | `model` | `planImport`：非法文件拒绝、警告修复摘要、替换确认文案 |
| 文件夹状态缓存 | `src/resourceTree/folderStateCache.ts` | `node:path` | `directory` / `file` / `missing` 缓存：30s TTL、LRU 上限 2000、同路径去重、并发上限 8 的 stat 队列 |
| 呈现契约 | `src/resourceTree/presentation.ts` | 仅类型 | 文件夹状态（异步检查返回前为 `unknown`）、description / tooltip 文案、点击命令 |

**一次资源树数据流**：

1. `registerResourceTree` 创建 `TreeView` 与 `ResourceTreeProvider`，注册 `wispkit.resourceTree.*` 命令、配置监听与工作区文件夹监听。
2. 启动 / 刷新：`currentStorageResolution()` 用 `storageCore.resolveStoragePath` 解析 `wispkit.resourceTree.file`（默认第一个工作区的 `.WispkitView/resource-tree.json`）→ `readStore` 先 `stat`；缺失返回空树，目录 / 无权限 / 非法 JSON 返回 `error`。
3. `model.parseStoreJson` 解析并清洗：未知类型、缺 `path` 的文件夹、重复 id、超量 / 超深节点都记 `warnings`；有 `error` 时**不替换**当前树、不写盘。
4. `TreeView` 拉取 `getChildren`；每个条目由 `presentation` 纯函数决定状态、描述与点击命令。文件夹状态由 `workspace.fs.stat` 异步预取并缓存（30s TTL、最多 2000 条、并发 8）；`getTreeItem` 只读缓存，不做同步磁盘 IO。
5. 增删改移 / 拖拽：provider 调 `model` 的纯函数得到**新的不可变 store**（原 store 不动），再 `commit` → `serializeStore` → `writeTextAtomically`（同目录临时文件 + `rename`）→ 成功后替换内存树并 `fire()`；失败则内存树保持旧值。
6. 导入：`planImport` 先判定能否导入并给出警告 / 确认文案，命令层确认后才 `replaceStore`；导出复用 `serializeStore` 与同一个原子写。
7. 外部编辑：没有文件监听，用户点「刷新」重新走第 2–4 步；`wispkit.resourceTree.file` 配置变更与工作区文件夹变化也会触发重载。

**为什么不用 `workspaceState`？** 需求要求「外部可改、可导出、可导入、点刷新重载」。`workspaceState` 是扩展私有存储，用户看不见也改不了；改成工作区里的普通 JSON 后，这些能力都变成普通文件操作，同时保留 drawcode 那套树交互。代价是必须自己处理并发编辑、损坏文件与原子写（见[已知限制](limitations.zh-CN.md#19-虚拟组不对应磁盘)）。

## 设计理由

**为什么用 `CustomEditorProvider` 而不是 `webviewPanel`？** 因为要**接管打开方式** —— 双击 `.md` 就该进这个视图。`webviewPanel` 只能由命令创建，抢不到打开方式（Simple Browser 就是这种形态，所以它无法被接管）。

**为什么媒体右键只报「索引 + 类型」？** webview 里的资源地址是 `vscode-webview://`，**反解不出真实文件路径**。既然前端拿不到路径，就让它只报位置，路径与源码由宿主回原文取。图片额外用 `alt` 做交叉校验，索引错位也能救回来。

**为什么走 `markdown.api.render` 隐藏命令？** 自己实现 Markdown 渲染就会丢掉第三方 `markdownItPlugins`（mermaid、katex 全靠它）。用内置命令等于复用官方管线，代价是依赖一个未公开命令。

**为什么只读模式不创建 `TextDocument`？** 目标就是"省加载开销"。走 `CustomEditorProvider` + 直读文件头，才能做到不整份进内存；代价是拿不到官方语法着色，所以 `readonly/highlight.ts` 自研了一套通用着色。

**为什么纯逻辑要独立成不 import `vscode` 的文件？** 为了可测。`src` 共 39,534 行 TypeScript（其中测试 16,202 行）、70 个测试文件、1149 个用例，其中大量用例跑在 Node 里、不启动 VS Code —— 只有把解析/格式化/排序/高亮/布局这类逻辑与 `vscode` 解耦才做得到。

**为什么 3D 不复用 Mermaid 的渲染器？** Mermaid 输出的是 2D SVG，无法直接变成可旋转的 3D 场景；而 3D 需要的是拓扑（谁连谁），不是样式。Wispkit 只解析拓扑、自己布局，换来离线、零 CDN 与可单测的布局，代价是视觉不与 Mermaid 主题一致（见[已知限制](limitations.zh-CN.md#15-3d-可视化只解析拓扑不还原-mermaid-原图)）。

## 规模

| 项 | 值 |
|---|---|
| 扩展宿主与纯逻辑 | `src` 共 22,816 行 TypeScript（不含测试 13,093 行） |
| 前端 | `media` 22 个手写文件（含 `shared/` 6 个复用组件）+ 7 个 esbuild 产物 |
| 测试 | 70 个测试文件 / 1149 用例 |
| 随扩展分发的原生工具 | `tools/xaml-render`（.NET，framework-dependent） |
