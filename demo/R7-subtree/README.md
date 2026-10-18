# R7：资源管理器两个图标 + 子树浏览

这个目录是给「资源管理器文件夹行上的两个图标」准备的可直接点击的验证数据。

| 图标 | 命令 | 点它会发生什么 |
|---|---|---|
| **展示**（左，`$(open-preview)`） | `wispkit.wispkitView.open` | 在这个文件夹（或其 `.WispkitView/` 子文件夹）里找 `Wispkit.json`，按配置的 `entry` + `openWith` 打开 |
| **子树浏览**（右，`$(list-tree)`） | `wispkit.subtree.open` | 打开一个**新视图窗口**，以树的形式浏览展开该文件夹 |

> 两个图标**只对文件夹行出现**（`explorerResourceIsFolder`）。悬停文件夹行右侧就能看到。

---

## 一、怎么验「展示」

1. 在资源管理器里**右键** `R7-subtree/演示工程` 这个文件夹 → 点「展示」。
2. 预期：打开一个 `wispkit.html` 视图，页面标题是「演示工程 · Wispkit 展示页」，页面里写着它是被 `.WispkitView/Wispkit.json` 打开的。

再验第二种查找位置：右键 `R7-subtree/根上配置示例` → 「展示」→ 这里没有 `.WispkitView/`，配置直接放在根上，同样应当打开。

### 配置最小 schema

```json
{
	"title": "R7 子树浏览演示",
	"entry": ".WispkitView/index.html",
	"openWith": "wispkit.html"
}
```

- `title` 可选，只用于打开后的提示消息。
- `entry` 是入口文件，**相对被点击的那个文件夹**解析；不允许用 `../` 跑到文件夹外面（会被拒绝并提示）。
- `openWith` 是 viewType，例如 `wispkit.html` / `wispkit.markdown` / `wispkit.image` / `wispkit.xaml` / `wispkit.text`。

**查找顺序**：先 `<文件夹>/.WispkitView/Wispkit.json`，再 `<文件夹>/Wispkit.json`。两者都在时以 `.WispkitView/` 里的为准。

> ⚠️ `.WispkitView` 以点号开头，VS Code 默认**不在资源管理器里显示**它（和 `.git` 一样）。这不影响功能 —— 图标点的是**父文件夹**。想编辑里面的文件：`Ctrl+P` 直接敲文件名，或临时把 `files.exclude` 里的 `**/.WispkitView` 关掉。

找不到配置或配置有错时，会弹出**明确说明**（查了哪两个路径、缺哪个字段、入口文件是否存在），不会静默什么都不做。

---

## 二、怎么验「子树浏览」

右键 `R7-subtree/演示工程` → 点「子树浏览」→ 打开树视图。

这个文件夹是特意铺开的：

```
演示工程/
├── .WispkitView/          ← 展示功能用（默认隐藏）
│   ├── Wispkit.json
│   └── index.html
├── 中文目录/中文文件.txt    ← 验证中文名排序
├── 文档/                   ← 多层嵌套，验证懒加载
│   ├── 说明.md
│   └── 深入/
│       ├── 深层文件.txt
│       └── 再深一层/底层文件.log
├── 源码/
│   ├── main.ts
│   ├── util.ts
│   └── 组件/button.ts
├── 数据/
│   ├── sample.json
│   └── 表格.csv
└── 图片/logo.svg
```

要点：

- **懒加载**：只有点了展开箭头才会去读那一层。展开「文档」→「深入」→「再深一层」可以看到逐层加载。
- **列**：默认是 `name / size / mtime / ctime / owner`。行高 22px、文件夹在前再按名称排 —— 观感对齐资源管理器。
- **右侧操作区**：先点一行选中，按钮才会启用。上半是资源管理器命令，下半是自定义工具。
- 双击目录 = 展开/折叠；双击文件 = 用默认编辑器打开。

### 列是可配置的

```json
"wispkit.subtree.columns": ["name", "ext", "size", "mtime", "ctime", "atime", "owner", "mode", "type"]
```

数组顺序就是列顺序。可选值：`name` `ext` `size` `mtime` `ctime` `atime` `owner` `mode` `type`。
写错的项会被**忽略**（不会让整个视图空掉）；一个合法项都没有时回退默认列。

### 自定义工具

```json
"wispkit.subtree.tools": [
	{ "label": "列出目录", "command": "cmd", "args": ["/c", "dir", "${dir}"], "shell": "silent" },
	{ "label": "git status", "command": "git", "args": ["status"], "shell": "currentTerminal" },
	{ "label": "在此处开新终端", "command": "cmd", "args": ["/k", "cd", "/d", "${dir}"], "shell": "newTerminal" },
	{ "label": "系统终端窗口", "command": "cmd", "args": ["/c", "start", "cmd"], "shell": "external" }
]
```

变量：`${file}`（完整路径）`${dir}`（目录：文件取其父目录，文件夹取自身）`${name}`（名称）`${workspaceFolder}`。

`shell` 四种模式：

| 值 | 行为 |
|---|---|
| `silent` | 后台执行不弹窗，结果只在视图状态栏显示（失败会弹警告） |
| `currentTerminal` | 送进当前活动终端（没有就新建一个） |
| `newTerminal` | 新建终端并在里面执行 |
| `external` | detached 启动，Windows 上会弹出独立的系统控制台窗口 |

**变量拼错时保留原样**（例如 `${flie}` 会原样出现在命令里）—— 静默替换成空串会让命令悄悄跑错目标。

---

## 已知近似与边界

1. **「用户」列是当前登录用户名**，不是文件真实属主 —— VS Code 的 `FileStat` 不暴露属主信息。
2. **`atime`（访问时间）与 `mode`（权限位）恒显示 `-`** —— VS Code 的 `FileStat` 不提供这两项。配置里仍可保留这两列。
3. **「文件操作」里的内置命令不保证每个都存在**：VS Code 的内置资源管理器命令没有可枚举的清单，只能手工维护一份白名单。执行前会校验，**不存在就弹出警告并说明**，不会静默失败。扩展贡献的命令（`explorer/context`）是自动收集的，带来源徽标。
4. 目录条数超过 2000 时只显示前 2000 项，并在树里提示。
