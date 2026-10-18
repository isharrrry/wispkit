---
type: Guide
title: 已知限制与未验证项
description: Wispkit 做不到的事、每条限制的成因，以及从未在真机验证过的内容
tags: [limitations, unverified, honesty]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# 已知限制与未验证项

[English](limitations.md) | **中文** | [Español](limitations.es.md)

这一篇只写"做不到"和"没验证过"。**未验证不等于已知不行** —— 两者分开列。

## 一、能力限制

### 1. 没有编辑器↔预览的滚动同步

- **现象**：在 Markdown 源码里滚动，预览不跟着动；反之亦然。
- **成因**：实现目录导航时走的是 webview 内按 `h1..h6` 建树，**不依赖 `data-line` 源映射**。滚动同步需要整套 `data-line`/`code-line` 协议，等于复刻内置预览的滚动同步机制。
- **规避**：目录导航的高亮与定位不依赖它，点击目录条目仍能准确跳转。
- **验证**：看 `src/markdown/` 下没有 scroll-sync 相关模块。

### 2. Simple Browser 无法被接管

- **现象**：HTML 文件在 Simple Browser 里打开时，Wispkit 的 `vscode://file/` 跳转能力不生效。
- **成因**：Simple Browser 是由命令创建的 `webviewPanel`（`onWebviewPanel:simpleBrowser.view`），**不走 customEditors 竞争**，扩展没有接管入口。
- **规避**：用 Wispkit 自己的 HTML 视图打开同一文件。

### 3. HTML 视图使用宽松 CSP

- **现象**：HTML 视图允许内联脚本与 http(s) 资源，安全等级低于 Markdown/XAML 视图的 Strict 策略。
- **成因**：浏览 HTML 本身就需要页面自带脚本能跑；收紧 CSP 会让大多数真实页面失效。风险等级与内置 Simple Browser 相当。
- **规避**：**不要用 HTML 视图打开不可信来源的 HTML。**

### 4. Markdown / 图片 / XAML 会接管默认打开方式

- **现象**：装完扩展后双击 `.md`、图片与 `.xaml`，进的是 Wispkit 视图而不是内置编辑器。
- **成因**：这三个视图在 `package.json` 里是 `priority: default`（要"双击即进"就必须这样）。
- **规避**：右键文件 → *Reopen Editor With…* 选内置编辑器；或用 `workbench.editorAssociations` 固定。
- **注意**：**HTML 与只读文本是 `option` 优先级**，默认不抢打开方式，需要时显式切换。

### 5. mermaid 默认缩放依赖内置扩展

- **现象**：`contributes.configurationDefaults` 把 `markdown-mermaid.mouseNavigation.enabled` 抬成 `always`，让 mermaid 图默认可缩放。
- **成因**：这个默认值只在装了 `mermaid-markdown-features`（VS Code 自带）时才有意义；未装时是无害的未注册键。用户显式改过该设置时，用户值优先。

### 6. XAML 渲染是静态快照

- **现象**：渲染出的图只有排版，没有数据、没有交互。
- **成因**：渲染器在独立进程里用 XAML 解析器构造控件树后离屏渲染成 PNG —— **没有 DataContext、不跑事件处理器、不启动消息循环**。
- **后果**：`{Binding}` 渲染为空、`BlazorWebView` 渲染为空白（**后者是正确行为**，UI 在 Razor 里，XAML 只剩宿主控件）、`App.xaml` 渲染不了（`Application` 根在进程内只能一个实例，且本就不是可视视图）。
- **适用**：看排版，不适合看运行态。

### 7. `x:Class` 引用的类型必须已编译

- **现象**：项目没编译过（找不到 `bin/(Release|Debug)/<tfm>/*.dll`）时，带 `x:Class` 的 XAML 渲染失败。
- **成因**：渲染器优先走「加载已编译程序集 + `RootObjectInstance`」路线，根类型必须存在；没有 `x:Class` 时才回退 `XamlReader.Parse`。
- **规避**：先 `dotnet build` 目标项目。

### 8. 编辑模式没有语法高亮

- **现象**：Markdown 段落编辑框是纯 `<textarea>`，XAML 源码区也只有自研轻量高亮。
- **成因**：换来的是与行号栏的**像素级对齐**和零第三方依赖（自研高亮必须保证输出与输入逐字相同，否则光标会偏）。
- **规避**：需要高亮时用 *Reopen Editor With…* 切到 VS Code 原生编辑器。

### 9. 只读模式不作用于 Wispkit 自己的浏览视图

- **现象**：Markdown / HTML / XAML / 图片在只读模式下仍按原样打开。
- **成因**：它们本来就是浏览视图（不写文件），而**截断 Markdown 会渲染出残缺结果**。
- **例外**：XAML 视图的源码区仍可编辑 —— 这一条将来会随只读模式一起收紧。

### 10. 只读模式换编辑器时有一次标签替换

- **现象**：开启只读模式后打开一个文本文件，会看到"原生编辑器标签关掉、只读预览顶上"。
- **成因**：拦截发生在文件已经被原生编辑器打开之后（`onDidOpenTextDocument` 时机），无法在打开前替换。
- **例外**：peek / diff / 后台打开的文件不会被拦截。

### 11. 子树视图的 `atime` 与 POSIX 权限位恒为 `-`

- **成因**：VS Code 的 `FileStat` 不暴露这两项，扩展拿不到。
- **规避**：无（除非自己 `fs.stat`，但那就绕开了 `workspace.fs` 的远端支持）。

### 12. 字体形态的图标主题不回退

- **现象**：用 Seti 这类**字体形态**（自带 `fonts` 定义）的图标主题时，子树图标与资源管理器不一致。
- **成因**：`parseIconTheme` 只解析 SVG 形态的主题（`iconDefinitions` 里是 svg 路径）；字体主题整体解析失败，回退到自绘 sprite。
- **规避**：换成 SVG 形态的主题（如本机验证用的 modern icons）。

### 13. 内置资源管理器命令白名单未逐个真机核实

- **现象**：操作区里的内置命令（`revealInExplorer`、`copyFilePath` 等）没有逐个在真机点过。
- **成因**：VS Code 的内置资源管理器命令**没有可枚举清单**（不在任何扩展的 `contributes` 里），只能手工列。
- **保护**：执行前一律用 `commands.getCommands(true)` 校验，不存在就弹出说明，**不静默**；参数类型不符会当场抛错并显示原因。

### 14. 子树文件操作是自研的，不是内置命令

- **成因**：内置 `filesExplorer.rename` / `explorer.newFile` / `filesExplorer.paste` 不接受外部 URI 参数，无法作用于面板里选中的条目，所以剪切/复制/粘贴/重命名/删除/新建/比较全部自研（`src/subtree/fileActions.ts`）。
- **含义**：这些操作的行为细节（冲突提示、回收站、递归复制）由 Wispkit 决定，不保证与资源管理器逐字一致。

## 二、未验证项

以下内容**没有在真实 VS Code 里验证过**。不代表不能工作，只是没有证据。

| # | 未验证项 | 为什么值得怀疑 | 怎么验证 |
|---|---|---|---|
| 1 | **像素级观感** | 多次改动只验证了"解析出的 SVG/规则值正确"，没有做渲染截图对比 | 打开实际文件目视比对 |
| 2 | **真实引擎上的段落边界** | 段落编辑靠 `data-line`（段落首行）推断结束行（下一个块的起始行减一），嵌套结构（列表项、引用块、代码块内部）边界可能不精确 | 在含嵌套列表/引用/代码块的文档里逐段点开编辑，看切出的源码是否完整 |
| 3 | **`workspace.fs` 写操作全链** | 重命名冲突文案、`useTrash` 不可用时的回落、目录递归复制、只读文件系统的错误路径 —— 都只有单元测试，没有真机点过 | 在真实工作区里逐个操作并观察提示 |
| 4 | **扩展贡献的 `explorer/context` 命令实际执行** | 自动收集命令 id 是可靠的，但"执行时参数类型是否匹配"没逐个试过 | 选中文件后逐个点扩展命令 |
| 5 | **`package.nls.json` 真机读取** | 命令标题与配置描述的本地化是否被 VS Code 正确读取 | 在非英文界面下看命令面板与设置页 |
| 6 | **只读模式标签替换的时序** | "先原生打开、再替换" 在慢磁盘/大文件/`preview` 标签上的表现 | 在 `workbench.editor.enablePreview` 开/关两种状态下各试一次 |
| 7 | **超大目录的懒加载表现** | 单层上万条目、深层嵌套、网络路径下的读取与渲染 | 在 node_modules 或大目录上打开子树面板 |
| 8 | **图标主题的语言桥覆盖率** | 349 条「扩展名 → 语言 id」来自各扩展的 `contributes.languages`，未与 VS Code 内置完整语言表逐条比对；未覆盖的扩展名会回退到 `file` 图标 | 换几个主题、看不同扩展名文件是否都正确 |

> 第 9 条在本次文档梳理中关闭：三语链接与锚点已由 `node tools/docs-check.mjs` 自动检查，**0 问题**才算通过。

## 三、这份清单怎么用

- **依赖某个行为之前**，先在本篇确认它不在「未验证」里。
- **报告 bug 时**，如果落在上表任一项，说明可能是已知盲区而不是新问题。
- 本文档只列"当前做不到/没验证"，不列"计划做" —— 计划在看板或提交记录里。
