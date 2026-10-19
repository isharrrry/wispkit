---
type: Guide
title: 开发过程与踩坑
description: 这台扩展是怎么一步步做出来的，以及每一个真实踩过的坑的现象、根因与做法；面向要改它的人
tags: [development, pitfalls, process]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-19T14:40:00+08:00 }
---

# 开发过程与踩坑

[中文]（本文仅中文）

> 这篇不介绍功能，只讲两件事：**功能是怎么一步步验证出来的**，以及**哪些地方会让人踩坑**。
> 每一条坑都标了现象和根因，能复现；没有实测过的推测一律标「未验证」。

## 一、开发节奏：先冒烟，再写代码

这个扩展的每个功能都走同一条路径，顺序不能颠倒：

| 阶段 | 做的事 | 为什么必须先做 |
|---|---|---|
| 1. 冒烟 | 在真实 VS Code 里确认要用的 API / 扩展点**确实存在、签名如预期** | 文档写的和实际能用的经常不一致；早期 plan 以 1.71.2 为基线，实机是 1.137.0，行为差很多 |
| 2. 纯逻辑先行 | 解析、格式化、排序、高亮这类不碰 `vscode` 的代码先写 + 单测 | 这些是 477 个用例的主体，能在纯 Node 里跑，不必起 VS Code |
| 3. 宿主接线 | 把纯逻辑接到 provider / webview 上 | 接线错误编译器能抓一部分，运行时才能抓全部 |
| 4. 探针实测 | 用真机探针读 webview 里的 computed style、节点数、CSP 违规 | **目视看不出的错误**（行高重叠、配色变黑、图片被拒载）只能靠探针读数值 |
| 5. 打包安装 | `npm run package` → 装进真实 VS Code 手动点一遍 | 打包后的资源路径、`.vscodeignore` 与开发态不同 |
| 6. 目视 | 真人看一遍 | 探针证明"值对"，证明不了"好看" |

**关键教训**：第 1 步不是形式。本扩展的 XAML 渲染方向就因为在冒烟里发现了 `System.Xaml` 与 WPF 依赖属性不兼容，才避免在错路上写几百行（见 §4.4）。

## 二、平台基线

| 项 | 值 | 说明 |
|---|---|---|
| VS Code | **1.137.0**（`D:\app\VSCodeEXE`） | 探针与验收都以此为准；plan 早期写的 1.71.2 已作废 |
| Node / npm | 随开发机 | esbuild 打 4 个前端 bundle |
| .NET | 10（`Microsoft.WindowsDesktop.App`） | 仅 XAML 渲染器需要 |
| 测试框架 | mocha + node:test 风格断言 | `npm test` 用 electron 与 node 两种 runner |

## 三、踩坑清单

下面按区域分组。每条格式都是 **现象 → 根因 → 做法**。

### 4.1 webview 与 CSP

| 现象 | 根因 | 做法 |
|---|---|---|
| 页面报 `Could not load data for data-settings` | 我们的配置 meta 用了 `data-settings`，而**内置** `media/index.js` 正好按该属性取数据 | 改名为 `data-wispkit`，并加断言防回归 |
| 内置 `media/index.js` 一加载就崩 | 它顶层调用 `acquireVsCodeApi()`，而该 API **在一个 webview 里只能调用一次**；我们的前端也要它 | 有意**过滤**掉内置 `index.js`（保留它的样式：正文排版用的就是它们）。它提供的复制按钮/图片原生菜单本扩展已自行实现 |
| mermaid 放大后图变黑（正文里正常） | 克隆 svg 时 `removeAttribute('id')`，而 mermaid 把配色写在 `<style>#mermaid-abc .node rect{fill:...}</style>` 这种 **id 作用域**规则里 → 规则全失配 → 填充回落成黑 | 克隆时**换新 id** 并同步改写内联 `<style>` 的作用域 |
| 图片视图里所有图片都显示不出来 | `localResourceRoots` 只含扩展目录，而**图片本体在工作区** → 被 webview 拒载 | 把图片父目录加进 `localResourceRoots` |
| 前端想拿图片真实路径拿不到 | webview 里的地址是 `vscode-webview://`，**反解不出真实文件路径** | 前端只上报「第几个元素 + 类型」，路径与源码由**宿主**回 Markdown 原文里取（`src/media/parse.ts` 纯函数）；图片再用 `alt` 交叉校验，索引错位也能救回 |
| CSP 拦截自定义前端脚本 | `default-src 'none'` 下所有脚本必须带 nonce | 每个页面注入 nonce；`media/subtree.js` 用 `<script type="module" nonce=...>` 直接引源文件（自包含 ESM，不走 esbuild） |

**通用原则**：webview 里**不要相信任何"看起来能用"的路径**。所有资源 URL 一律经 `webview.asWebviewUri` 生成，所有跨边界数据一律走 `postMessage` 的消息契约。

### 4.2 VS Code API 的真实边界

| 事实 | 影响 | 依据 |
|---|---|---|
| `markdown.preview.lineHeight` 的语义是**字号倍数**（默认 `1.6`），不是像素 | 填 `26` 表示 26 倍，正文会变成 442px | 内置 `markdown.css:10` 直接 `line-height: var(--markdown-line-height, 22px)` |
| `--markdown-line-height` 由内置渲染器**原样输出**，不能拼 `px`；而 `--markdown-font-size` 需要 `px` | 多拼一个 `px` → 行高变 `1.6px` → 正文/目录/代码块**全部重叠** | `documentRenderer.ts:213` |
| 给 `body` 写 `font` 简写，会挡住内置 `--markdown-font-*` 变量 | 字体、加粗都不像内置预览 | 只注入变量，不写简写 |
| `FileStat` 不暴露 `atime` 与权限位 | 子树视图这两列**恒为 `-`**（编译期就报 `Property 'atime' does not exist`） | 不是 bug，是 API 边界 |
| 内置资源管理器命令**没有可枚举清单** | 无法自动发现"资源管理器右键菜单里有什么" | 只能手工白名单 + 执行前用 `commands.getCommands(true)` 校验 |
| `view/item/context` 的 `inline` 组只对**扩展自己贡献的视图**生效 | **不能**往内置资源管理器树项插图标；文件夹行的两个图标最终走的是 `explorer/context` 菜单 | 用户已接受此限制 |
| `markdown.api.render` 传字符串 → 内置引擎的 `currentDocument` 恒为 `undefined` | 第三方 markdown-it 插件拿不到文档 URI（drawio 的编辑按钮依赖它） | 改传**文档对象** `{ uri, getText }` |
| 漏配 `enableCommandUris` → 所有 `command:` 链接**点了没反应** | 这类失败是静默的，极难发现 | markdown 与 html 视图都要配 |
| `workbench.editorAssociations` 比"打开后拦截替换"更彻底 | 后者会先加载原生编辑器（闪烁 + 白费加载），且能被绕过 | 只读模式改用 editorAssociations |

### 4.3 事件与交互

| 现象 | 根因 | 做法 |
|---|---|---|
| 目录树点击定位不展开折叠的祖先 | 只做了滚动，没更新折叠状态与高亮 | `reveal()` 先展开祖先再定位；文档内 `#锚点` 走同一路径 |
| 列表项点击区域错位 | webview 里的坐标要减 `getBoundingClientRect()`，不是文档坐标 | 统一用元素相对坐标 |
| 高亮器光标偏移 | 高亮层叠在透明 `<textarea>` 下，**token 拼接结果与输入差一个字符，光标就漂** | 高亮器必须**逐字保真**，测试断言逐字相等 |

### 4.4 XAML 渲染（踩得最深的一块）

这一块值得单开一节，因为它先后走过两条路，第一条走死的证据很有价值。

**探针结论（`XamlReader.Parse` 单文件路径）**：自建样本 **5/5** 成功，真实项目文件 **0/17**。根因分布：`x:Class` 引用未编译类型 7/17、自定义控件类型未知 3/17、MAUI/WinUI 类型 3/17、`Application` 根构造失败 1/17、跨文件 `StaticResource` 1/17、解析成功但根不可视（`ResourceDictionary`）2/17。文本预处理收益为零（删 `x:Class`、删事件处理器后障碍全部收敛到「自定义类型未知」）。

| 现象 | 根因 | 做法 |
|---|---|---|
| 真实项目 XAML **0/6** 全部失败于 `Binding` / `Command` | `System.Xaml` 的 `XamlObjectWriter` 把依赖属性当普通 CLR 属性，遇到 `Binding` 必抛「只能在 DependencyObject 的 DependencyProperty 上设置 Binding」；给 schema context 传程序集**不能**解决 | 改走 WPF 自己的解析路径（认识 DP），并对 `x:Class` / 事件处理器做变体退化 |
| 补全 `clr-namespace` 时类型解析到错误的程序集 | 扩展会把**整个输出目录的 dll** 传给渲染器，第一个未必是 `x:Class` 所在程序集 | 先用 `x:Class` 在已加载程序集里**反查**，命中的排最前 |
| 真实窗口 `new` 不出来 | 窗口构造函数普遍依赖 DI / App 单例 | 不再强求实例化真实类型：按 `--class` → `x:Class` → **根元素对应的 WPF 基类**依次尝试，用 `RootObjectInstance` 让 XAML 往基类实例上填内容。**基类承载是主力路径**，`XamlReader.Parse` 只是最后兜底 |
| `App.xaml` 渲染不了 | `Application` 在同一进程只能有一个实例，且它本就不是可视视图 | 明确不支持，写进限制 |
| Blazor Hybrid 项目渲染出整片空白 | XAML 里只剩 `<BlazorWebView>` 宿主控件，UI 在 Razor 里 | 这是**正确结果**，不是 bug |
| `dotnet build` 报 MC3074/MC6024 | `Microsoft.NET.Sdk` 默认把所有 `**/*.xaml` 当 `Page` 编译 | csproj 设 `EnableDefaultPageItems=false` |
| `DataGrid` 抛 `Cannot find non-neutral culture related to 'en-us'` | `<InvariantGlobalization>true</InvariantGlobalization>` | 移除该属性 |

**官方出路是异常原文自己给的**，不是猜的：

> `Remove the Class directive or provide an instance via XamlObjectWriterSettings.RootObjectInstance.`

**必须接受的前提**：XAML 渲染是**静态快照** —— 无 DataContext、事件不触发、`x:Name` 不写字段、跨文件资源会失败。适合看排版，不适合看运行态。

### 4.5 资源、打包与分发

| 现象 | 根因 | 做法 |
|---|---|---|
| vsix 从 289 KB 涨到 5 MB+ | `demo/`（演示素材 5 MB）被一起打包 | `.vscodeignore` 加 `demo/**` |
| 安装后 README 里文档链接全断 | `docs/` 没进包，而 README 用相对链接指向它 | **docs 必须进包**（18 篇 × 3 语） |
| `vsce package` 直接中止 | 有相对链接但没给 `--baseContentUrl` / `--baseImagesUrl` | 打包脚本补这两个参数 |
| 换机器后 XAML 渲染报找不到 exe | `tools/xaml-render/bin/Release` 是**运行时加载**的产物，被当成构建垃圾忽略 | 它必须**入库**；忽略规则要精确到 `bin/Debug`、`obj`、`publish`，不能整目录忽略 `bin/` |
| 自编译的 exe 写不了 `%TEMP%` / `%APPDATA%` | 本机沙箱限制（非产品缺陷），D 盘工作区正常 | 自检脚本把输出改到工作区内 |

### 4.6 探针与测试

| 教训 | 具体 |
|---|---|
| **探针缺陷 ≠ 产品缺陷** | M4 曾报 `Could not load data for data-settings`，实为探针漏传扩展 `id`；真实 provider 传了，用户侧无此错 |
| 探针硬编码排版值 → 测不到真配置 | 改为读真实配置换算后再断言 |
| **测试要能变红才有意义** | 用变异测试证明：把 Ctrl 前置加回去 → 5 红；写错贡献键 → 4 红 |
| 时间敏感断言会 flaky | 100 倍缩放时钟 + 5ms 轮询，机器一忙检查点就被"冲过去"；修法是把检查点往窗口里侧挪、容差放宽 |
| 纯逻辑必须能脱离 `vscode` 运行 | 解析/格式化/排序/高亮全部不 import `vscode`，477 个用例因此能在纯 Node 里跑 |

### 4.7 本机工具链（Windows 专项）

| 现象 | 根因 | 做法 |
|---|---|---|
| PowerShell 脚本里中文路径变乱码，`Test-Path` 报 MISSING | **PowerShell 5.1 的 `Get-Content` 默认按 ANSI(GBK) 解码**，无 BOM 的 UTF-8 一律读坏 | 脚本补 UTF-8 BOM；读文件用 `[System.IO.File]::ReadAllText` 而不是 `Get-Content` |
| `git status` 里中文文件名显示成 `\346\226\260...` | `core.quotePath=true` 把非 ASCII 路径转义 | `git config core.quotePath false` |
| 把"看起来乱码"当成文件损坏 | 就是上一条的显示问题，文件本身合法 | 判定编码要用严格 UTF-8 解码器逐文件验，不要看终端输出 |

### 4.8 协作与流程（用 AI 并行开发时的坑）

| 现象 | 根因 | 做法 |
|---|---|---|
| 一个文件被覆盖，上一轮的改动消失 | `write` 全量覆盖前**没有先 `read`**（当时仓库还没有 git，无法回滚） | **写之前必须先读**；仓库有 git 后可以兜底，但不能依赖它 |
| 三语文档互相覆盖、出现编码损坏 | 同一批文件被**多个写入方并行改写** | 同一批文件只允许一个写入方；三语必须由同一次改动一起落 |
| 编码/内容错了但检查脚本报 OK | `docs-check` 只验 frontmatter、三语齐全、链接可达，**不验编码、不验语义** | 编码另用严格解码器验；内容错误靠人读 |
| `.git` 占 109 MB 但最大文件才 1.9 MB | 曾经 `git add` 过 `.selftest` / `node_modules` 又没提交，留下 894 个 dangling blob | `git fsck` 查悬空对象，`git gc --prune=now` 清理；忽略规则要精确 |

## 五、如果重做一次

按优先级排，这几件事应该更早做：

1. **先建 git 仓库**。M3 那次事故（覆盖掉 `config.ts` 里的配置读取函数）在有 git 的情况下 30 秒就能恢复。
2. **先把探针脚手架搭好**。本扩展大半的"真 bug"（图片被拒载、行高重叠、lightbox 变黑、`command:` 链接失效）都是探针读数值发现的，不是人眼看出来的。
3. **XAML 方向先冒烟**。0/17 的结论是在写了完整实现之后才得到的；如果先跑那个探针，能省掉一整轮实现。
4. **忽略规则先写**。`.selftest`（425 MB）和 `node_modules` 曾经差点进仓库，`git gc` 才把 dangling blob 清掉。

## 六、未验证

以下事项本文没有当作保证：

- 像素级的"好看程度"、不同主题/字号下的观感 —— 只有探针数值，没有多人目视评审
- 真实引擎上的段落边界（嵌套列表、引用、代码块混排）
- `workspace.fs` 写操作的全链（重命名冲突文案、`useTrash` 回落、递归复制）
- 扩展贡献命令的实际执行（只验证了"能被发现"）
- 超大目录的懒加载表现
- 图标主题语言桥的实际覆盖率
