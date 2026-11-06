# R8-03 代码结构双树：底层库与顶层模块

> **验证点**：同一份 Wispkit 源码可以从两个视角各画一棵 ASCII 树 ——
> 树 A 按「底层依赖」归类（扩展运行在什么之上），树 B 按「顶层模块」归类
> （扩展由什么组成）。两棵树的末端节点**刻意复用同一批契约名**：
> `postMessage`、`three`、`OrbitControls`、`WebGL`、`markdown.api.render`、
> `markdown.previewScripts`、`XamlRender.exe`、`node:*`、`workspace.fs` 等。
> 在 3D 面板里左右各选一棵再点「合并左右」，这些共享叶子会把两棵树连成一张图。
>
> **怎么验**：
> 1. 右键本文件 → **3D 可视化浏览**；
> 2. 左下拉选「树 A：底层库 · ASCII 树」，右下拉选「树 B：顶层模块 · ASCII 树」；
> 3. 两侧都选中后点「合并左右」；
> 4. 预期统计：**66 节点 / 98 条边 / 已合并 34 个同名节点**；
> 5. 旋转场景，观察 `three`、`OrbitControls`、`postMessage`、`node:path` 等叶子
>    成为两棵树之间的连接点。
>
> 统计口径：合并节点数按「右侧树中命中左侧同名节点的节点数」计，因此
> `postMessage` 在树 B 出现 7 次就会计 7 次，而不是按去重后的名称数计。

## 树 A：底层库

从「Wispkit 运行在什么之上」出发，按依赖族归类。它不是 `package.json` 清单：
`three` / `OrbitControls` 是唯一进入 webview bundle 的第三方运行时库；
`markdown.api.render` 与 `markdown.previewScripts` / `markdown.previewStyles`
是 VS Code 内置 Markdown 管线的隐藏命令与贡献点；
`XamlRender.exe` 是随扩展分发的 .NET WPF 外部进程；其余是 VS Code API、
Node 内置模块、浏览器 WebGL 能力与构建 / 测试工具链。

```text
Wispkit 底层库
├── VS Code 扩展宿主
│   ├── vscode
│   ├── workspace.fs
│   ├── Webview API
│   │   └── postMessage
│   ├── CustomEditorProvider
│   ├── WebviewPanel
│   ├── TreeDataProvider
│   └── workbench.editorAssociations
├── Node.js 运行时
│   ├── node:fs
│   ├── node:path
│   ├── node:child_process
│   ├── node:crypto
│   └── node:os
├── webview 浏览器运行时
│   ├── DOM
│   ├── WebGL
│   ├── three
│   └── OrbitControls
├── VS Code 内置管线
│   ├── markdown.api.render
│   ├── markdown.previewScripts
│   └── markdown.previewStyles
├── 构建与测试工具链
│   ├── esbuild
│   ├── TypeScript
│   ├── mocha
│   ├── jsdom
│   └── vsce
└── 原生外部渲染器
    ├── XamlRender.exe
    └── .NET WPF
```

## 树 B：顶层模块

从「扩展由哪些顶层模块组成」出发。宿主侧：`extension.ts` 一次注册 11 个
disposable；5 个 `CustomEditorProvider`；`subtree` / `graph3d` 两个
`WebviewPanel`；`resourceTree` 一个 `TreeView`；`wispkitView` 一个命令。
前端侧：6 个 esbuild bundle（其中 graph3d 含 three.js，也是唯一开启压缩的
bundle）、直接加载的 `media/subtree.js`，以及 `media/shared/` 下的复用组件。
纯逻辑侧：7 个刻意不 `import 'vscode'` 的功能域。

每个模块下面挂的是它实际触碰的底层契约，而不是它的全部内部文件；这样树 B
的末端节点才能与树 A 的名称一一对上。

```text
Wispkit 顶层模块
├── 激活入口
│   └── extension.ts
│       └── vscode
├── 自定义编辑器
│   ├── CustomEditorProvider
│   ├── markdownProvider.ts
│   │   ├── markdown.api.render
│   │   └── postMessage
│   ├── htmlProvider.ts
│   │   └── postMessage
│   ├── imageProvider.ts
│   │   └── postMessage
│   ├── xamlProvider.ts
│   │   ├── XamlRender.exe
│   │   └── node:crypto
│   └── readonlyProvider.ts
│       └── node:fs
├── 面板与树视图
│   ├── WebviewPanel
│   ├── TreeDataProvider
│   ├── graph3dProvider.ts
│   │   └── postMessage
│   ├── subtreeProvider.ts
│   │   ├── node:os
│   │   ├── node:path
│   │   └── node:child_process
│   ├── resourceTreeProvider.ts
│   │   ├── workspace.fs
│   │   └── node:fs
│   └── wispkitViewProvider.ts
│       └── node:path
├── webview 前端
│   ├── media/markdown.js
│   │   └── postMessage
│   ├── media/graph3d.js
│   │   ├── three
│   │   ├── OrbitControls
│   │   └── WebGL
│   ├── media/html.js
│   ├── media/image.js
│   ├── media/xaml.js
│   ├── media/readonly.js
│   ├── media/subtree.js
│   │   └── postMessage
│   └── media/shared
│       └── postMessage
├── 共享纯逻辑
│   ├── src/markdown
│   │   ├── markdown.previewScripts
│   │   └── markdown.previewStyles
│   ├── src/graph3d
│   ├── src/resourceTree
│   │   └── node:path
│   ├── src/xaml
│   ├── src/readonly
│   ├── src/subtree
│   │   └── node:path
│   └── src/util
│       └── node:crypto
└── 测试与构建
    ├── mocha
    ├── jsdom
    ├── esbuild
    ├── TypeScript
    └── vsce
```

## 共同的末端节点

两棵树共有 **23 个不同名称**的共享末端节点，在树 B 中因多处出现共命中 **34 个节点**
（`postMessage` 7 次、`node:path` 4 次、`node:fs` 2 次、`node:crypto` 2 次）：

| 末端节点 | 树 A 中的归类 | 树 B 中的使用方 |
|---|---|---|
| `vscode` | VS Code 扩展宿主 | `extension.ts` |
| `workspace.fs` | VS Code 扩展宿主 | `resourceTreeProvider.ts` |
| `postMessage` | Webview API | 4 个 Provider + 3 个前端入口 |
| `CustomEditorProvider` | VS Code 扩展宿主 | 「自定义编辑器」分支（5 个编辑器共用） |
| `WebviewPanel` | VS Code 扩展宿主 | 「面板与树视图」分支 |
| `TreeDataProvider` | VS Code 扩展宿主 | 「面板与树视图」分支 |
| `node:fs` | Node.js 运行时 | `readonlyProvider.ts` / `resourceTreeProvider.ts` |
| `node:path` | Node.js 运行时 | `subtreeProvider.ts` / `wispkitViewProvider.ts` / `src/resourceTree` / `src/subtree` |
| `node:child_process` | Node.js 运行时 | `subtreeProvider.ts`（执行自定义工具） |
| `node:crypto` | Node.js 运行时 | `xamlProvider.ts` / `src/util`（nonce） |
| `node:os` | Node.js 运行时 | `subtreeProvider.ts` |
| `three` | webview 浏览器运行时 | `media/graph3d.js` |
| `OrbitControls` | webview 浏览器运行时 | `media/graph3d.js` |
| `WebGL` | webview 浏览器运行时 | `media/graph3d.js` |
| `markdown.api.render` | VS Code 内置管线 | `markdownProvider.ts` |
| `markdown.previewScripts` | VS Code 内置管线 | `src/markdown`（贡献聚合） |
| `markdown.previewStyles` | VS Code 内置管线 | `src/markdown`（贡献聚合） |
| `esbuild` | 构建与测试工具链 | 「测试与构建」分支（6 个前端 bundle） |
| `TypeScript` | 构建与测试工具链 | 「测试与构建」分支 |
| `mocha` | 构建与测试工具链 | 「测试与构建」分支 |
| `jsdom` | 构建与测试工具链 | 「测试与构建」分支 |
| `vsce` | 构建与测试工具链 | 「测试与构建」分支 |
| `XamlRender.exe` | 原生外部渲染器 | `xamlProvider.ts` |

树 A 独有（不会参与合并）：`DOM`、`workbench.editorAssociations`、`.NET WPF`。
树 B 独有：`media/html.js`、`media/image.js`、`media/xaml.js`、`media/readonly.js`、
`src/graph3d`、`src/xaml`、`src/readonly`。

## 两棵树的关系

| 问题 | 树 A（底层库） | 树 B（顶层模块） |
|---|---|---|
| 回答什么 | 扩展运行在什么之上 | 扩展由什么组成 |
| 分组依据 | 依赖能力族（宿主 API / Node / 浏览器 / 内置管线 / 工具链 / 原生进程） | 代码职责（激活 / 编辑器 / 面板 / 前端 / 纯逻辑 / 测试） |
| 叶节点含义 | 一项具体能力或工具 | 该模块实际使用的下层契约 |
| 共享叶子的意义 | 同一项契约的「提供方」 | 同一项契约的「使用方」 |

因此合并后的 3D 图不是两张重复的目录树，而是「依赖视角 ↔ 模块视角」的对照图：
每一条共享叶子都是一条从模块指向底层能力的实际引用。

## 合并规则（与 02-merge-scenario.md 一致）

- 只跨左右两个图元素合并，同一张图内部的同名节点不合并；
- 名称比较：`trim` → 连续空白压成一个空格 → 去掉首尾引号 / 反引号 → 转小写；
- 右侧未匹配节点用 `r:` 前缀重新分配 id，边按 `source + target + label + dashed` 去重；
- 若统计显示的数字与本页不一致，优先以面板实际解析结果为准（本页数字由
  `parseAsciiTree` / `mergeElements` 对上面两段文本计算得出）。
