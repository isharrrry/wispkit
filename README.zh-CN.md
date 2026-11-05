# Wispkit

[English](README.md) | **中文** | [Español](README.es.md)

> VS Code 的浏览增强扩展。**不修改 VS Code 任何文件、不依赖补丁**，用 7 个自定义编辑器承载 Markdown / Mermaid / 图片 / 视频 / HTML / XAML / 只读文本，另加一个活动栏的自定义资源管理视图、一个资源管理器子树面板，以及 Markdown / Mermaid 的 3D 图浏览面板。

扩展宿主是纯 TypeScript（`engines.vscode: ^1.71.0`），在 Windows 上开发与验证。XAML 视图附带一个 framework-dependent 的 .NET 渲染器，需要 .NET 10 的 Windows Desktop 运行时；其余 6 个视图零原生依赖。

## 它解决什么问题

| 问题 | Wispkit 的做法 |
|---|---|
| Markdown 预览是个"只读死页面" | 目录树导航 + 工具栏多级缩放（50%–300%，Ctrl+滚轮）+ **Ctrl+F 关键字查找 / 高亮 / 跳转** + 媒体右键菜单 + drawio 就地编辑 + **光标段落就地编辑**（点哪段改哪段，不分栏、不新开编辑器）；400 KB 级多图多表文档自动虚拟化，点目录不卡 |
| 文档里的 Mermaid / ASCII 树只能是二维静态图 | **Markdown 一键 3D 图浏览**：右键 `.md` → 「3D 可视化浏览」，左右各选一个图元素，旋转 / 平移 / 缩放，同名节点可合并成一张图；合并后可选「互斥」布局，把左右两张图的核心节点拉到布局两端、让融合节点留在中间；可勾选数据显示流名称，悬停节点气泡查看条目注释；Mermaid 里标签为 `void` 的「对侧未创建」占位不画气泡，相关流变成绕开拥挤位置的悬空箭头；节点名写成 `[文字](图片路径)` 且图片有效时，气泡直接显示图片（四角贴球面） |
| 只有 `.mmd` 源码，没有图形预览 | **Mermaid 文件浏览**：双击 `.mmd` / `.mermaid` 直接渲染图表；右键同一文件还能用 3D 浏览它的拓扑 |
| 图片要看细节得按 Ctrl 滚轮，还没法拖 | 图片浏览覆盖 PNG / JPG / GIF / BMP / ICO / WebP / AVIF / APNG / SVG 等；默认滚轮缩放（光标为锚点）+ 按住右键拖动平移 + 双击 fit/100%，SVG 按矢量重绘不糊。HEIF / TIFF / JXL 内核没有解码器，显示原因并一键交给系统默认应用 |
| 视频文件在 VS Code 里只能看到二进制 | 双击常见视频（MP4 / WebM / MOV / MKV / AVI / WMV / FLV / RMVB 等）进入原生 `<video>` 播放；容器或编码不受支持时同样给「系统播放器打开」兜底 |
| 文档里的相对链接、`vscode://file/<路径>:<行号>` 点不开（或被丢给系统浏览器） | Markdown / HTML 视图统一做链接路由：相对路径按文档位置解析，`vscode://file` 与 `#L行号` 在**当前窗口**打开并定位 |
| 想看一个 WPF 视图长什么样 | XAML 源码与渲染**并排**，渲染可缩放平移，改完可保存回文件 |
| 只想读一读，不想改动也不想要完整加载 | 全局只读模式：只读文件头若干字节、**不创建 TextDocument** |
| 资源管理器只能一列名称看目录 | 子树面板：列可配置（大小/时间/类型/用户…）、右侧操作区、自定义工具 |
| 常用文件夹分散在各处，每次都要一层层点 | **自定义资源管理**：活动栏里用虚拟组 + 文件夹自由组织（任意层级），支持拖拽、导入导出与直接编辑 JSON；下方可收纳的「存储器」区域直接列出硬盘 / U 盘 / 网络位置的挂载点 |

## 快速开始

```bash
npm install
npm run compile     # tsc + esbuild（8 个 webview bundle）
npm test            # mocha，纯逻辑，不启动 VS Code
npm run package     # 产出 wispkit-<version>.vsix
```

GitHub Actions CI 在每次 push 与 pull request 上跑同一套门禁：`npm ci` → `npm run lint` → `npm run compile` → `npm test`（见[构建与验证](docs/build-and-verify.zh-CN.md#ci)）。

安装到本机 VS Code（把路径换成你的 `code.cmd`）：

```powershell
& "D:\app\VSCodeEXE\bin\code.cmd" --install-extension .\wispkit-0.1.0.vsix --force
```

XAML 视图的渲染器以预编译二进制随扩展分发：`tools/xaml-render/bin/Release/net10.0-windows/` 已入库并会打进 VSIX，**属于运行时依赖，不是构建产物**；发版时不要删除或重新生成，只有改了渲染器源码才需要重建：

```powershell
cd tools\xaml-render
dotnet build -c Release
```

## 核心概念

1. **用自定义编辑器，不补丁 VS Code** — 7 个 `CustomEditorProvider` 竞争打开方式；Markdown / Mermaid / 图片 / 视频 / HTML / XAML 是 `priority: default`（默认接管），只读文本是 `option`（要显式切换）。想退回内置：*Reopen Editor With…* 或 `workbench.editorAssociations`。
2. **宿主定路径，前端定交互** — webview 里的资源地址是 `vscode-webview://`，**反解不出真实路径**；所以媒体右键只上报「第几个元素 + 类型」，路径与源码由宿主回 Markdown 原文里取，图片再用 `alt` 交叉校验。详见 [架构](docs/architecture.zh-CN.md)。
3. **渲染走内置管线，不自己实现 Markdown** — 用内置引擎的隐藏命令 `markdown.api.render`，这样第三方 `markdown.markdownItPlugins`（mermaid、katex）自动生效；内容更新后在 `window` 派发 `vscode.markdown.updateContent` 让前端脚本重渲染。详见 [视图与交互](docs/views-and-interaction.zh-CN.md)。
4. **只读 = 不加载，不是禁编辑** — 只读预览读文件头若干字节、按行截断，不构建 `TextDocument`、不整份进内存；右下角「解锁编辑」切回原生编辑器。详见 [配置参考](docs/configuration.zh-CN.md)。
5. **断言要咬结果，不是咬"规则存在"** — 仓库踩过只验证"CSS 规则写了"却漏掉真 bug 的坑；现存测试尽量断言"点完之后发生了什么"。详见 [构建与验证](docs/build-and-verify.zh-CN.md)。
6. **3D 浏览只解析拓扑，不移植 Mermaid 渲染器** — 宿主从 Markdown 或独立 `.mmd` 抽出图元素的节点 / 边，前端用 three.js + 自研布局画 3D；不追求与 Mermaid 主题逐像素一致，换来离线（three.js 打进本地 bundle）、可单测的布局与零 CDN。素材见 [`demo/R8-graph3d/`](demo/R8-graph3d/README.md)。
7. **自定义资源管理是工作区里的普通 JSON** — 虚拟组只用于命名归类、不对应磁盘；文件夹用 `${workspaceFolder}` 占位符保存；增删改移即时写入 `.WispkitView/resource-tree.json`（同目录临时文件 + rename），外部编辑后点刷新重载。详见[视图与交互](docs/views-and-interaction.zh-CN.md#自定义资源管理wispkitresourcetree)，素材见 [`demo/R9-resource-tree/`](demo/R9-resource-tree/README.md)。

## 安全边界

- **Markdown / XAML 视图沿用内置 Markdown 预览的 Strict 级 CSP**（`nonce` + `cspSource`，无 `unsafe-inline`），第三方预览脚本按该策略编写即可正常工作。
- **HTML 视图是宽松 CSP**（放行内联脚本与 http(s) 资源）—— 浏览 HTML 本身就需要页面自带脚本能跑，风险等级与内置 Simple Browser 相当。**不要用它打开不可信来源的 HTML。**
- 媒体「另存为」与 XAML「保存」都写回**用户主动指定的路径**，不覆盖原文件之外的任何位置。

## 文档

| 想了解 | 读 |
|---|---|
| 分层、模块职责、一次完整数据流 | [架构](docs/architecture.zh-CN.md) |
| 7 个视图、自定义资源管理、子树面板与 3D 图浏览的交互、手势、消息契约 | [视图与交互](docs/views-and-interaction.zh-CN.md) |
| 14 个配置项的字段级参考、`Wispkit.json`、工具占位符 | [配置参考](docs/configuration.zh-CN.md) |
| 构建、测试、真机探针、打包安装 | [构建与验证](docs/build-and-verify.zh-CN.md) |
| 做不到的事、没验证过的事 | [已知限制与未验证项](docs/limitations.zh-CN.md) |
| 一步步是怎么做出来的、每个真实踩过的坑 | [开发过程与踩坑](docs/development-notes.zh-CN.md) |

**文档纪律**：`docs/` 下每篇主题都有英/中/西三个版本，**任何修改必须在同一次改动里同步更新三份**（语言变体是忠实翻译，不是摘要）。唯一例外是 `docs/development-notes.zh-CN.md`——内部工程记录，仅中文。未验证项一律在[已知限制](docs/limitations.zh-CN.md)显式标注，不当作设计保证陈述。

## 构建与实测环境

| 项 | 值 |
|---|---|
| Node / npm | **^22.22.2 / ^24.15.0 / >=26**（jsdom 30 接受的范围）；CI 固定 22.22.2，在 Windows 上按 `npm ci` → lint → compile → test 执行 |
| TypeScript | 5.7 |
| esbuild | 0.24（8 个 webview bundle，`graph3d` 单独压缩） |
| 测试 | mocha + jsdom，**952 passing**，57 个测试文件 |
| 3D bundle | `media/dist/graph3d.js` 约 603 KB（含 three.js，minified） |
| lint | eslint 9，**0 error** |
| VSIX | 154 条目 / 约 1.57 MB（含 docs、三语 README 与界面截图） |
| 实测 VS Code | **1.137.0**（Windows） |

## 界面截图

截图取自真实 VS Code 1.137.0 的扩展开发宿主，素材是仓库自带的 `demo/`。

**Markdown 视图** —— drawio 图块渲染、目录导航、编辑开关与「Wispkit Markdown」徽标：

![Wispkit Markdown 视图：drawio 图块渲染、目录导航与编辑开关](docs/images/wispkit-markdown.png)

**XAML 视图** —— 源码高亮与渲染结果并排，状态行给出根类型、尺寸与承载模式：

![Wispkit XAML 视图：源码高亮与渲染并排](docs/images/wispkit-xaml.png)

**图片视图** —— 默认滚轮缩放（无需按 Ctrl）、右键拖动平移，标尺用于核对缩放比例：

![Wispkit 图片视图：滚轮缩放与拖动平移](docs/images/wispkit-image.png)

**只读文本视图** —— 只加载文件头（默认 64 KB / 800 行），右下角「解锁编辑」切回原生编辑器：

![Wispkit 只读文本视图：只加载文件头并可解锁编辑](docs/images/wispkit-readonly.png)

**子树浏览** —— 多列（名称 / 大小 / 类型 / 修改时间 / 创建时间）、列宽可拖，右侧是选中条目的文件操作分组。支持拖放：文件拖入会问**复制 / 移动**，树内（含左右两个子树面板互拖）按住 **Ctrl** 拖动条目则直接**移动**、不再询问；文本 / HTML / 图片等会问**存储类型与名称**；条目可直接拖出到桌面 / 资源管理器（系统文件拖入直接拖即可，不需要按 **Shift**）：

![Wispkit 子树浏览：多列视图与文件操作分组](docs/images/wispkit-subtree.png)

## 实测过的行为

以下每一条都在真实 VS Code 里跑过，不是设计意图：

| 验证项 | 结果 |
|---|---|
| Markdown 媒体右键菜单 | 图片 4 项 / mermaid 3 项 / drawio 4 项全部出现；点击后剪贴板拿到正确原文 |
| 3D 图浏览（VS Code 1.137.0 真机 + 打包 VSIX 复验） | 右键 / 命令面板入口、重复打开只 reveal、标题计数、左右 15%–85% 分栏、合并与 `Esc`、间隔 0.25×–3×、刷新、重置视角、左键旋转 / 右键平移 / 滚轮缩放、窗口自适应全部通过；扩展宿主与 webview 0 异常 |
| Mermaid 文件浏览（VS Code 1.137.0 开发宿主真机） | 双击 `demo/R8-graph3d/04-standalone.mmd` 由 `wispkit.mermaid` 接管并渲染出 SVG；状态栏 `流程图 · 6 节点 · 6 边`；资源管理器右键菜单出现「3D 可视化浏览」；刷新后仍渲染出 SVG；「源码」在侧边打开普通文本编辑器；从预览页打开 3D 后下拉为 `订单处理 · 流程图 · 6 节点 / 6 边` |
| drawio 就地编辑 | 抽出代码块 → 临时文件 → 保存后按内容重新定位回写，逐字一致 |
| XAML 渲染（`Common.Resources` 真实控件，带 `x:Class` 与 `Binding`） | **6/6 渲染成功**；`Work.xaml` 目视确认为「▶ ⏸ ⏹」按钮组 |
| XAML 端到端 webview | 自动发现 3 个程序集 → `ok:true` → 图片加载 102×49 → 27 行源码 → CSP 违规 0 / 脚本错误 0 |
| 子树图标与资源管理器一致性 | 真机 CDP 对照 6 个文件（`.md`/`.json`/`.mjs`）**全部一致**；修复前 3 个是通用 `file.svg` |
| 编辑段回车 | 单个回车补成空行 → 渲染出新段落；`Shift+回车` 为段内换行 |
| 图片 / 视频浏览（VS Code 1.137.0 真机 + CDP 探针） | SVG / WebP / AVIF 解码成功；SVG 滚轮放大改布局尺寸（400→440px）不变糊；HEIC 显示解码失败兜底；MP4 元数据 160×90 / 2s 且播放时 `currentTime` 前进；损坏 MKV 显示错误码 4 兜底；「复制路径」写入剪贴板；探针 **17/17** |
| Markdown 缩放 / 查找 / 大文档性能（VS Code 1.137.0 开发宿主真机 + CDP 探针 12/12） | 243 KB、400 段标题、100 张表格、27 张 mermaid 的文档自动虚拟化；27 张图全部正常渲染且不被虚拟化跳过；工具栏逐级缩放与 Ctrl+0 复位生效；Ctrl+F 命中 2416 处并走 CSS Highlight API（DOM 中 0 个 mark），上一个/下一个计数正确；点目录远跳落点 0.04 px，200% 缩放下 0.75 px |
| 自定义资源管理（VS Code 1.137.0 真机 + 打包 VSIX 复验） | 活动栏 / 空树提示、标题栏六入口、资源管理器右键添加、任意层级增删改移、内部与外部拖拽、环拒绝、打开子树、虚拟组点击提示、三种异常状态、刷新状态保持、外部删除警告、配置切换、外部编辑后刷新、非法 JSON 不覆盖、导入 / 导出 / 打开 JSON 全部通过；扩展宿主与 webview 0 异常 |

没有一行是估计。未验证项集中列在 [已知限制与未验证项](docs/limitations.zh-CN.md)。

## 已知限制（摘要）

1. **没有编辑器↔预览的滚动同步**（不做 `data-line` 源映射）；目录导航的高亮与定位不依赖它。
2. **Simple Browser 无法被接管** —— 它是命令创建的 webviewPanel，不走 customEditors 竞争。
3. **XAML 是静态快照**：无 DataContext、不跑事件处理器、不启动消息循环；`App.xaml` 与 `BlazorWebView` 场景没有可视内容（后者空白是**正确**的）。
4. **段落编辑框无语法高亮**：它是纯 `<textarea>`，换来与正文的行对齐和零依赖。
5. **子树视图的 `atime` 与 POSIX 权限位恒为 `-`** —— VS Code 的 `FileStat` 不暴露这两项。
6. **字体形态的图标主题（如 Seti）不回退**：子树图标走自绘 sprite，只有 SVG 形态的主题会被解析。
7. **3D 浏览只做拓扑**：不还原 Mermaid 主题与样式；未支持图种按行串成链兜底；每篇最多 200 个图元素、单图最多 600 个节点；需要 WebGL。
8. **自定义资源管理**：虚拟组不对应磁盘；工作区外绝对路径换机失效；没有文件监听，外部编辑要手动刷新且最后写入者获胜；符号链接 / 断链已于 2026-10-26 完成真机验证，无权限目录的边界（本地 NTFS 上 stat 仍成功）见限制页；多根工作区已于 2026-10-26 完成真机验证（见限制页）；远程 / 虚拟文件系统方面，本机没有 Remote-SSH / WSL / Dev Containers / Remote Tunnels 环境，原子写只在 SMB 回环共享上检查过（见限制页未验证第 13 条）。
9. **HEIF / HEIC 与部分视频容器不能内嵌解码**：解码交给 VS Code 的 Chromium 内核；HEIF 需要 libheif（数 MB），TIFF / JXL / MKV / AVI / WMV / FLV / RMVB 多数没有内核解码器。按「不加大依赖」的约定，这些格式只给「系统默认应用 / 播放器打开」兜底；MP4（H.264/AAC）与 WebM（VP8/VP9）可以真正播放。

完整 27 条 + 未验证清单见 [已知限制](docs/limitations.zh-CN.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
