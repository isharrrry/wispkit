---
type: Guide
title: 视图与交互
description: 五个自定义编辑器与子树面板的界面组成、手势、快捷键与消息契约
tags: [views, interaction, webview, gestures]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# 视图与交互

[English](views-and-interaction.md) | **中文** | [Español](views-and-interaction.es.md)

## 总表

| 视图 | viewType | 打开方式 | 优先级 |
|---|---|---|---|
| Markdown 浏览 | `wispkit.markdown` | 双击 `.md` / `.markdown` | `default`（接管） |
| 图片浏览 | `wispkit.image` | 双击 `.png` `.jpg` `.jpe` `.jpeg` `.bmp` `.gif` `.ico` `.webp` `.avif` | `default`（接管） |
| HTML 浏览 | `wispkit.html` | *Reopen Editor With…* / `wispkit.openWith` | `option`（不抢） |
| XAML 浏览 | `wispkit.xaml` | 双击 `.xaml` | `default`（接管） |
| 只读文本 | `wispkit.text` | 全局只读模式开启后自动 | `option`（由 associations 驱动） |
| 子树面板 | `wispkit.subtree`（webviewPanel） | 资源管理器文件夹行右侧图标 / 命令 | 非编辑器 |

`wispkit.openWith` 命令按扩展名选视图（`src/extension.ts` 的 `viewTypeFor`）；不匹配时弹出「Wispkit 没有适用于该文件类型的视图」。

## Markdown 视图（`wispkit.markdown`）

### 界面组成

```text
┌──────────┬──────────────────────────────────────────────┐
│  目录树   │  正文（内置 Markdown 预览同款排版）              │
│  h1..h6  │                                              │
│  （可拖宽/ │  代码块 / 表格 / mermaid / drawio / 图片       │
│   可收纳） │                                              │
└──────────┴──────────────────────────────────────────────┘
```

### 目录导航

- webview 内按 `h1..h6` 建树，**不依赖 `data-line` 源映射** —— 因此不需要编辑器↔预览的滚动同步协议。
- 滚动时跟随高亮当前章节；点击条目跳转并聚焦。
- 目录栏可拖拽调宽，**双击分隔条复位**；可一键收纳（收纳后正文占满）。
- 显示层级受 `wispkit.toc.depth` 限制（默认 3），可整体关闭（`wispkit.toc.enabled`）。

### 媒体右键菜单

| 右键对象 | 菜单项 | 点击后发生什么 |
|---|---|---|
| 普通图片 | 放大查看 / 另存为… / 复制路径 / 复制 Markdown 文本 | 另存为走系统保存对话框；复制路径取绝对路径；复制 Markdown 文本取原文里的 `![alt](src)` |
| mermaid 图 | 放大查看 / 另存为 SVG… / 复制源码 | 复制源码取 ` ```mermaid ` 围栏内的原文 |
| drawio 图 | 放大查看 / **用 Draw.io 编辑器打开** / 另存为 SVG… / 复制源码 | 见下节 |

「放大查看」是**占满主窗口的模态框**，支持滚轮缩放与按住右键拖动平移（与图片视图同一套 panzoom 实现），`Esc` 或点击遮罩关闭。

前端只上报 `{ action, kind, index, alt?, src? }`；**真实路径与源码由宿主回 Markdown 原文取**（`src/media/parse.ts`，纯函数，20 条单测）。图片额外用 `alt` 交叉校验，索引错位也能救回。

### drawio 就地编辑

drawio 扩展 1.17.0 已把编辑交给新版 Markdown 编辑器（`markdown.codeBlockEditorProviders`），自定义编辑器里没有那套宿主，所以 Wispkit 自己接：

1. 从前端上报的 index 定位代码块，抽出 XML 内容；
2. 写成临时 `.drawio` 文件；
3. `vscode.openWith(..., 'hediet.vscode-drawio-text')` 打开；
4. 保存时**按内容重新定位**回写原文 —— 即使文档在别处被编辑过，也不会错位替换。

### 编辑模式（光标段落就地编辑）

工具栏「编辑」是个滑动开关（`role="switch"`，开关态只看 `aria-checked`）。打开后**点正文任意一段**，那一段原地变成 `<textarea>`，其余段落保持渲染后的样子 —— 不分栏、不新开编辑器。

| 操作 | 行为 |
|---|---|
| 单击某一段 | 该段原地变成编辑框，内容是这一段对应的 Markdown 原文（verbatim，不补分隔空行） |
| `Enter` | 插入空行（`\n\n`）—— 单个回车在 CommonMark 里只是软换行，补成空行才真的分出新段落 |
| `Shift+Enter` | 段内软换行，留在同一段 |
| `Ctrl+Enter`（macOS `Cmd+Enter`） | 提交当前段：写回整篇源码并立即保存 |
| `Esc` | 放弃当前段的修改 |
| `Ctrl+S`（macOS `Cmd+S`） | 保存整篇；编辑框未提交时先提交 |

映射依据：内置引擎给每个块级 token 打 `data-line`（起始行），段落结束行按**下一个块的起始行减一**推断，末段以源码总行数兜底；区间左闭右开 `[start, end)`。这一层是纯函数（`media/shared/paragraph.js`），有单测覆盖 —— 嵌套结构（列表项、引用块、代码块内部）的边界是本方案最不精确的地方。

保存经 `WorkspaceEdit` 整篇替换，进正常撤销栈。整篇源码只在**进入编辑模式时**向宿主索取一次（`wispkit.requestSource`），纯预览不背这份开销。

### 消息契约

| 前端 → 宿主 | 载荷 | 宿主返回 |
|---|---|---|
| `wispkit.requestSource` | 无 | 源码文本 |
| `wispkit.render` | `requestId`、`text` | `{ requestId, html }`（宿主保留分支；段落编辑提交后由 `onDidChangeTextDocument` 自动重渲染，前端已不再主动发） |
| `wispkit.save` | `requestId`、`text` | `wispkit.saveResult { requestId, ok }` |
| `wispkit.media` | `action`、`kind`（`image`/`mermaid`/`drawio`）、`index`、`alt?`、`src?`、`data?` | 无（宿主自行执行） |

### 正文排版

内置 `markdown.css` 的字体/字号/行高读的是 `--markdown-font-family` / `--markdown-font-size` / `--markdown-line-height` 三个变量。Wispkit 把 `markdown.preview.*` 的设置喂给它们，所以正文与内置预览逐字一致。

换算照抄内置（`documentRenderer.ts:211-213`）：`fontSize` 拼 `px`，`lineHeight` **原样输出**（数字表示字号倍数，内置默认 1.6）。给 `lineHeight` 拼 `px` 会让行高变成 `1.6px`，正文、代码块、目录一起重叠 —— 这是实际踩过的坑，`src/test/markdownPage.test.ts` 有防回归断言。**不要**给 `body` 写 `font` 简写，那会覆盖这三个变量。

## 图片视图（`wispkit.image`）

| 手势 | 行为 |
|---|---|
| 滚轮 | 直接缩放（不用按 Ctrl），以**光标位置为锚点**，视图中心不跳；`wispkit.image.wheelZoom=false` 时退回"需按 Ctrl" |
| 按住 `wispkit.image.dragButton`（默认右键）拖动 | 平移 |
| 双击 | 在「适应窗口」与「100%」之间切换 |
| 放大 ≥ 3× | 渲染切换为 `pixelated`，避免糊成一团 |

缩放步长由 `wispkit.zoom.wheelStep` 决定（默认 1.1），同一套 panzoom 也用于 Markdown 模态框与 XAML 渲染。

## HTML 视图（`wispkit.html`）

- 采用**宽松 CSP**：放行内联脚本与 http(s) 资源 —— 浏览 HTML 本身就需要页面自带脚本能跑。
- 把 `href="vscode://file/<路径>[:<行号>]"` 改写成 `command:vscode.open?<args>`，并开启 webview 的 `enableCommandUris`。**前端 0 行脚本**：点击上报由 webview 外壳完成，改写版直连当前窗口，不绕系统协议处理器。
- 未改写的 `vscode://` 也在宿主白名单内，两条路都可用。

## XAML 视图（`wispkit.xaml`）

### 界面

左侧源码栏（可编辑）+ 右侧渲染图，中间分隔条可拖动。源码栏可隐藏（`wispkit.xaml.codeVisible`），宽度受 `wispkit.xaml.codeWidth` 控制（默认 460px）。

- 源码区有**自研轻量高亮**：高亮层与 `<textarea>` 叠放，textarea 文字透明只留光标，因此输出必须与输入**逐字相同**（多一个少一个字符光标就会偏）。
- 渲染图支持滚轮缩放与拖动平移；点图可进全屏模态框。
- 改动后保存，写回原 `.xaml` 文件。

### 渲染调用链

1. 从 `.xaml` 所在目录**逐级向上**找 `bin/(Release|Debug)/<tfm>/*.dll`；
2. 调外部 .NET 进程，契约冻结为 `<renderer> render <in.xaml> <out.png> [--assembly <dll>]... [--width N] [--height N] [--class <T>] [--json]`；扩展侧只用到 `--assembly` 与 `--json`，stdout **最后一行**的单行 JSON 是唯一结果通道；
3. 根类型按 `--class`（扩展未传）→ XAML 的 `x:Class` → **根元素对应的 WPF 基类**（`<Window>` → `System.Windows.Window`、`<UserControl>` → …）依次尝试，每个候选都配「原样」与「去掉 `x:Class` + 事件处理器」两种文本变体，再用 `XamlObjectWriterSettings.RootObjectInstance` 让 XAML 往该实例上填内容（`mode=rootObjectInstance`）。真实窗口的构造函数普遍依赖 DI/App 单例、`new` 不出来，所以基类承载是主力路径；全都走不通才回退 `XamlReader.Parse`（`mode=parse`）；
4. 结果 PNG 回传到页面。

渲染失败时页面显示错误面板与常见原因提示，不会白屏。

## 只读文本视图（`wispkit.text`）

- 全局只读模式开启后，`.ts` / `.json` / `.txt` / `.log` 等（由 `wispkit.readonly.extensions` 决定）打开时换成只读预览。
- 只读**文件头若干字节**（`wispkit.readonly.previewBytes`，默认 64 KB），再按 `wispkit.readonly.previewLines`（默认 800 行）截断。
- 页面含行号与**自研通用语法高亮**（注释/字符串/数字/关键字级别，非 TextMate 精确着色）。
- 右下角悬浮「解锁编辑」：点了改用原生编辑器打开（可编辑），并在本次会话内放行该文件。
- 已被 Wispkit 接管的浏览视图（Markdown / HTML / XAML / 图片）**不受只读模式影响** —— 它们本来就是浏览视图，而截断 Markdown 会渲染出残缺结果。

## 子树面板（`wispkit.subtree`）

### 打开方式

资源管理器里每个**文件夹行**右侧两个图标：左边「展示」（`wispkit.wispkitView.open`）、右边「子树浏览」（`wispkit.subtree.open`）。两个命令都只在该行是文件夹时出现，且不在命令面板里出现。

**同一文件夹复用同一个面板**：重复点击只 reveal 已存在的面板，不会开一堆。

### 界面

```text
┌────────────────────────────────────────────────────────┐
│ 表头：名称 | 大小 | 类型 | 修改时间 | 创建时间 | 用户     │
├────────────────────────────────────────────────────────┤
│ ▸ 目录A                                                 │
│   ▸ 目录B                                               │
│     文件.txt                                            │
├────────────────────────────────────────────────────────┤
│ 右侧操作区：文件操作（剪切/复制/粘贴/重命名/删除/新建/比较）│
│             扩展命令（带来源徽标）· 自定义工具            │
└────────────────────────────────────────────────────────┘
```

- **懒加载**：展开某一层才读那一层，不一次递归整棵树。
- **列可配置**：严格按 `wispkit.subtree.columns` 顺序渲染；表头与数据行共用 `--wispkit-col-*` 变量保证对齐。取不到的属性显示 `-` 而不是崩（`atime`、POSIX 权限位恒为 `-`）。
- **排序**：点表头按该列排序，纯逻辑在 `src/subtree/sort.ts`。

### 右侧操作区的三类操作

| 类别 | 来源 | 说明 |
|---|---|---|
| 文件操作（native） | Wispkit 自研 | 剪切 / 复制 / 粘贴 / 重命名 / 删除 / 新建文件 / 新建文件夹 / 比较。**不自研就用不了**：内置 `filesExplorer.*` 命令不接受外部 URI 参数 |
| 扩展贡献命令 | 自动收集 | 遍历已装扩展的 `contributes.menus['explorer/context']`，执行前校验命令存在 |
| 内置白名单 | 手工列 | 执行前用 `commands.getCommands(true)` 校验；不存在就明说，不静默 |
| 自定义工具 | `wispkit.subtree.tools` | 支持 `${file}` `${dir}` `${name}` `${workspaceFolder}`；四种执行方式见下表 |

| `shell` | 行为 |
|---|---|
| `silent` | 后台执行，不弹窗 |
| `currentTerminal` | 写入当前活动终端 |
| `newTerminal` | 新建终端并写入 |
| `external` | 脱离进程启动系统终端窗口 |

**对象是「表格选中条目」而不是资源管理器选中条目** —— 右侧所有按钮都作用于子树面板里当前选中的那一行。

### 消息契约

| 前端 → 宿主 | 说明 |
|---|---|
| `wispkit.subtree.read` | 读取某一层目录（懒加载） |
| `wispkit.subtree.sort` | 按列排序 |
| `wispkit.subtree.command` | 执行扩展/内置命令 |
| `wispkit.subtree.fileAction` | 文件操作，具体分支 `cut` / `copy` / `paste` / `rename` / `delete` / `newFile` / `newFolder` / `compare` |
| `wispkit.subtree.tool` | 执行自定义工具 |
| `wispkit.subtree.open` | 打开/定位条目 |

## 共享交互组件

| 文件 | 被谁用 | 职责 |
|---|---|---|
| `media/shared/panzoom.js` | 图片视图、Markdown 模态框、XAML 渲染 | 滚轮缩放（光标锚点）+ 拖动平移 + 双击 fit |
| `media/shared/lightbox.js` | Markdown 模态框 | 全屏遮罩、`Esc` 关闭 |
| `media/shared/toc.js` | Markdown 视图 | 建树、跟随高亮、折叠 |
| `media/shared/contextmenu.js` | Markdown / 子树 | 菜单定位、命中、关闭 |
| `media/shared/paragraph.js` | Markdown 编辑模式 | 段落 ↔ 源码行的映射与切片 |
