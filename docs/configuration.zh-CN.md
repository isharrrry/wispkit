---
type: Guide
title: 配置参考
description: 全部配置项的字段级参考，以及 Wispkit.json、自定义工具与执行模式
tags: [configuration, settings, reference]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
---

# 配置参考

[English](configuration.md) | **中文** | [Español](configuration.es.md)

全部配置项定义在 `package.json` 的 `contributes.configuration` 下，共 **19 个**。

## 总表

| Key | 类型 | 默认 | 作用域 | 何时调 | 副作用 |
|---|---|---|---|---|---|
| `wispkit.toc.enabled` | boolean | `true` | Markdown 视图 | 正文够宽、只想看内容 | 侧栏整体不渲染，目录跳转一并消失 |
| `wispkit.toc.depth` | number (1–6) | `6` | Markdown 视图 | 深文档想让侧栏更紧凑 | 调低会把更深的标题挡在树外 |
| `wispkit.zoom.wheelStep` | number (1.01–3) | `1.1` | 图片 / 模态框 / XAML 渲染 | 觉得滚轮一下跳太快 | 三处同时变；1.01 几乎看不出缩放 |
| `wispkit.image.wheelZoom` | boolean | `true` | 图片视图 | 需要滚轮快速滚动浏览时关掉 | 关掉后退回「按住 Ctrl 才缩放」 |
| `wispkit.image.dragButton` | `right` \| `middle` \| `left` | `right` | 图片视图 | 右键被系统手势占用时改 | 改 `left` 与系统拖拽/选中打架，不推荐 |
| `wispkit.xaml.codeVisible` | boolean | `true` | XAML 视图 | 只想看渲染、不要源码占位 | 源码栏消失，只剩居中渲染图 |
| `wispkit.xaml.codeWidth` | number (≥160) | `460` | XAML 视图 | 控件树深、源码行很长 | 窗口窄时挤压渲染区；拖拽值优先 |
| `wispkit.readonly.default` | boolean | `false` | 全局只读模式 | 只想浏览、不想误改文件 | 会改写 `workbench.editorAssociations`，关闭时移除 |
| `wispkit.readonly.previewBytes` | number (≥1024) | `65536` | 全局只读模式 | 文件大、想更快打开 | 超出部分**没加载**（不是折叠） |
| `wispkit.readonly.previewLines` | number (≥50) | `800` | 全局只读模式 | 只想看前若干行 | 超出部分不显示，末尾提示截断 |
| `wispkit.readonly.extensions` | string[] | 61 个通配符 | 全局只读模式 | 只想让特定类型只读 | 改动即重写 associations；**不要**加 `.md`/`.html`/`.xaml`/图片/视频 |
| `wispkit.subtree.columns` | string[]（枚举 9 值） | `name,size,type,mtime,ctime,owner` | 子树面板 | 想按修改时间/大小审视目录 | 非法值过滤、重复去重、为空回退默认 |
| `wispkit.subtree.tools` | object[] | `[]` | 子树面板 | 想把常用外部命令挂到面板右侧 | 参数不做 shell 转义；`external` 会真起窗口 |
| `wispkit.subtree.typeAhead` | boolean | `true` | 子树面板 | 不希望按键改变选中项 | 只影响子树列表 |
| `wispkit.resourceTree.file` | string | `.WispkitView/resource-tree.json` | 自定义资源管理 | 想把树文件放到别处，或在多根工作区里固定到某个根 | 改完自动重载；路径解析失败时保留当前树并显示诊断 |
| `wispkit.shellLink.openBehavior` | `system` \| `internal` \| `ask` | `system` | Windows 快捷方式（`.lnk`） | 希望快捷方式指向的目标在 Wispkit 里打开而不是直接运行 | `internal` / `ask` 会取代快捷方式原本的双击行为 |
| `wispkit.shellLink.folderTarget` | `subtree` \| `system` | `subtree` | Windows 快捷方式（`.lnk`） | 希望文件夹目标交给系统资源管理器而不是子树面板 | 只在打开行为为 `internal` 时才被读取 |
| `wispkit.shellLink.allowEdit` | boolean | `true` | Windows 快捷方式（`.lnk`） | 希望属性页保持只读 | 设为 `false` 时不显示编辑表单 |
| `wispkit.executable.openBehavior` | `system` \| `viewer` \| `ask` | `system` | 可执行文件（`.exe`） | 希望可执行文件打开属性页而不是运行 | `viewer` / `ask` 会取代原本的双击行为 |

## 目录导航

### `wispkit.toc.enabled`

- 类型 `boolean`，默认 `true`。
- `false` 时整个目录侧栏不渲染，正文占满宽度。
- 只影响 Markdown 视图；改完立即生效（视图重新打开或用命令重载）。

### `wispkit.toc.depth`

- 类型 `number`，默认 `6`，范围 1–6。
- 决定目录树**最深列出到 h 几**。Markdown 规范定义六级标题（`#` 到 `######`），默认值 `6` 会把规范能产生的**全部标题**收进树；调低即有意隐藏更深的层级。
- 与正文无关，只影响侧栏。

## 缩放

### `wispkit.zoom.wheelStep`

- 类型 `number`，默认 `1.1`，范围 1.01–3。
- **每格滚轮**的缩放倍率：`1.1` 表示每次放大 10%。
- 同一套 panzoom 被三处共用：图片视图、Markdown 全屏模态框、XAML 渲染图 —— 改一处三处一起变。

## 图片视图

### `wispkit.image.wheelZoom`

- 类型 `boolean`，默认 `true`。
- `true`：滚轮直接缩放，不用按 Ctrl。
- `false`：退回"按住 Ctrl 才缩放"，滚轮恢复滚动语义。

### `wispkit.image.dragButton`

- 类型 `string`，枚举 `right` / `middle` / `left`，默认 `right`。
- 按住哪个键拖动可平移图片。
- 改成 `left` 会与系统拖拽行为冲突，不推荐。

## XAML 视图

### `wispkit.xaml.codeVisible`

- 类型 `boolean`，默认 `true`。
- 是否显示左侧源码栏；`false` 时只剩渲染图（居中显示）。

### `wispkit.xaml.codeWidth`

- 类型 `number`，默认 `460`，最小 `160`（像素）。
- 左侧源码栏初始宽度。运行时可拖拽分隔条临时改变，拖动值优先。

## 全局只读模式

### `wispkit.readonly.default`

- 类型 `boolean`，默认 `false`。
- 扩展启动时是否直接进入只读模式。运行时可用状态栏右侧开关切换（`wispkit.toggleReadOnly`）。

### `wispkit.readonly.previewBytes`

- 类型 `number`，默认 `65536`（64 KB），最小 `1024`。
- 只读预览**最多读取的字节数**；超出部分不加载。这是"省渲染开销"的实质机制。

### `wispkit.readonly.previewLines`

- 类型 `number`，默认 `800`，最小 `50`。
- 只读预览**最多显示的行数**（在字节上限之后再做行截断）。

### `wispkit.readonly.extensions`

- 类型 `string[]`，默认 61 个通配符（`.txt` `.log` `.json` `.ts` `.py` `.cs` …）。
- 只读模式**生效的文件类型**。开启时这些类型会被写进 `workbench.editorAssociations`，让它们的原生打开方式就是只读视图。
- **刻意不含** Wispkit 自己接管的浏览类型（`.md` / `.html` / `.xaml` / 图片 / 视频）—— 截断它们会渲染出残缺结果。
- 空数组 = 只读模式对任何文件都不生效。

## 子树面板

### `wispkit.subtree.columns`

- 类型 `string[]`，默认 `["name","size","type","mtime","ctime","owner"]`。
- 枚举：`name` `ext` `size` `mtime` `ctime` `atime` `owner` `mode` `type`。
- **数组顺序即列顺序**。非法值被过滤、重复值去重、过滤后为空则回退默认（`src/subtree/columns.ts` 的纯逻辑，有单测）。
- 两个已知恒为空值的列：`atime`（访问时间）与 `mode`（POSIX 权限位）—— VS Code 的 `FileStat` 不暴露，显示 `-`。

### `wispkit.subtree.tools`

自定义工具数组，默认空。每项结构：

```jsonc
{
  "label": "在终端里打开",          // 必填，按钮文字
  "command": "powershell",         // 必填，可执行文件或命令
  "args": ["-NoExit", "-Command", "cd '${dir}'"],  // 可选
  "shell": "newTerminal"           // 可选，默认 silent
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `label` | ✅ | 按钮文字 |
| `command` | ✅ | 要执行的命令 |
| `args` | — | 参数数组 |
| `shell` | — | `silent` / `currentTerminal` / `newTerminal` / `external` |

**四种执行方式**：

| `shell` | 行为 | 典型用途 |
|---|---|---|
| `silent`（默认） | 后台执行，不弹窗，不占终端 | 格式化、统计 |
| `currentTerminal` | 写入当前活动终端 | 在已有终端里 `cd` 或跑命令 |
| `newTerminal` | 新建终端并写入 | 需要独占终端的任务 |
| `external` | 脱离进程启动系统终端窗口 | 需要交互式窗口的程序 |

**占位符**（在 `command` 与 `args` 中替换）：

| 占位符 | 替换为 |
|---|---|
| `${file}` | 选中条目的绝对路径 |
| `${dir}` | 选中条目的父目录绝对路径 |
| `${name}` | 选中条目的文件名（含扩展名） |
| `${workspaceFolder}` | 第一个工作区文件夹的绝对路径 |

替换是**纯字符串替换**，不做 shell 转义 —— 路径含空格时请在配置里自己加引号（`"cd '${dir}'"`）。

### `wispkit.subtree.typeAhead`

- 类型 `boolean`，默认 `true`。
- 子树列表里的按键跳转，行为与资源管理器一致：输入字母或数字跳到以它开头的第一个条目，再按同一个字符继续往下找（到末尾回到开头）。
- 中文按**输入法落字的文本**匹配 —— 不做拼音转换，也没有字表需要预载。
- 每次按键只对**当前可见行**做一次前缀比较，而行数本来就有单层上限，所以没有需要配置的数量阈值。
- 关掉它不影响任何其它行为：点击、选择、排序、拖放照旧。

## 自定义资源管理

### `wispkit.resourceTree.file`

- 类型 `string`，默认 `.WispkitView/resource-tree.json`。
- 相对路径基于**第一个工作区文件夹**；也接受绝对路径。
- 支持占位符：`${workspaceFolder}`（第一个工作区）、`${workspaceFolder:名称}`、`${workspaceFolder:序号}`。
- 指向目录、含非法字符、盘符后缺斜杠、以目录分隔符结尾等非法写法会**报错并保留当前树**，不会静默退回默认文件。
- 修改设置后立即读取新文件；新文件不存在时按空树显示，第一次编辑时才创建。
- 写入是「同目录临时文件 + rename」：磁盘满或进程中断不会把旧文件清空。

文件结构（`version` 固定为 `1`）：

```jsonc
{
  "version": 1,
  "roots": [
    {
      "type": "group",
      "id": "g-frontend",
      "name": "前端",
      "children": [
        {
          "type": "folder",
          "id": "f-src",
          "name": "src",
          "path": "${workspaceFolder}/src",
          "children": []
        }
      ]
    }
  ]
}
```

- `group` 只有 `type` / `id` / `name` / `children`，**不指向磁盘**；`folder` 额外有 `path`。
- `id` 在同一文件内必须唯一；重复 / 超长 / 不是字符串会被自动重新分配并给出警告（缺失时直接生成新 id）。
- 节点上限：总节点 2000、单层子项 200、深度 12；超出部分在读取时截断并提示。

## Windows 快捷方式与可执行文件

这四个设置决定 `.lnk` 快捷方式与 `.exe` 可执行文件如何打开，以及快捷方式页是否可编辑。两者各自有一个 `option` 优先级的编辑器，所以除非你主动设置，这里的一切都不改变原来的双击行为。

### `wispkit.shellLink.openBehavior`

- 类型 `string`，枚举 `system` / `internal` / `ask`，默认 `system`。
- `system`：交给 Windows，等同资源管理器里双击。
- `internal`：在 Wispkit 里打开目标 —— 文件夹进子树面板，文件用对应视图打开。
- `ask`：每次询问走哪条。

### `wispkit.shellLink.folderTarget`

- 类型 `string`，枚举 `subtree` / `system`，默认 `subtree`。
- 只在 `openBehavior` 为 `internal` **且**目标看起来是文件夹时生效。
- `subtree`：进子树浏览面板；`system`：交给系统资源管理器。

### `wispkit.shellLink.allowEdit`

- 类型 `boolean`，默认 `true`。
- 快捷方式页是否显示编辑表单。设为 `false` 时页面仍可读，但不可写。

### `wispkit.executable.openBehavior`

- 类型 `string`，枚举 `system` / `viewer` / `ask`，默认 `system`。
- `system`：运行该可执行文件；`viewer`：打开 PE 属性页；`ask`：先询问。

**工作目录约定**（两者刻意不同）：从 Wispkit 启动可执行文件时，工作目录钉成它自己所在的目录；启动快捷方式时，用快捷方式里记录的启动目录，不做任何覆盖。

## `configurationDefaults`：mermaid 默认就能缩放

`package.json` 里有一段 `contributes.configurationDefaults`：

```json
{ "markdown-mermaid.mouseNavigation.enabled": "always" }
```

内置 mermaid 前端脚本自带 pan/zoom，但默认要求**按住 Alt**（该设置默认 `alt`）。本扩展把默认值抬成 `always`，于是 mermaid 图默认就能滚轮缩放、拖动平移。

两个前提：① 必须装了内置的 `mermaid-markdown-features`（VS Code 自带）；② 用户自己显式改过该设置时，用户值优先。未装该扩展时这是无害的未注册键。

## `.WispkitView/Wispkit.json`

资源管理器文件夹行左侧的「展示」图标读这个文件。

**查找顺序**：

1. `<文件夹>/.WispkitView/Wispkit.json`
2. `<文件夹>/Wispkit.json`

**Schema**：

```jsonc
{
  "title": "演示工程",                    // 可选：面板/标签标题
  "entry": ".WispkitView/index.html",    // 必填：相对该文件夹的入口文件
  "openWith": "wispkit.html"             // 必填：viewType
}
```

**校验**：`entry` 必须落在该文件夹内（越界即拒绝），`openWith` 必须是已注册的 viewType。找不到配置或校验失败时给出可见提示，不会静默失败。

## 一份完整的 settings.json 示例

```jsonc
{
  // Markdown
  "wispkit.toc.enabled": true,
  "wispkit.toc.depth": 4,

  // 图片与缩放
  "wispkit.zoom.wheelStep": 1.15,
  "wispkit.image.wheelZoom": true,
  "wispkit.image.dragButton": "middle",

  // XAML
  "wispkit.xaml.codeVisible": true,
  "wispkit.xaml.codeWidth": 520,

  // 只读模式
  "wispkit.readonly.default": false,
  "wispkit.readonly.previewBytes": 32768,
  "wispkit.readonly.previewLines": 500,

  // 子树面板
  "wispkit.subtree.columns": ["name", "size", "mtime", "owner"],
  "wispkit.subtree.tools": [
    {
      "label": "在资源管理器里显示",
      "command": "explorer",
      "args": ["${dir}"],
      "shell": "external"
    }
  ],

  // 自定义资源管理
  "wispkit.resourceTree.file": "${workspaceFolder}/.WispkitView/resource-tree.json",

  // Windows 快捷方式与可执行文件
  "wispkit.shellLink.openBehavior": "ask",
  "wispkit.shellLink.folderTarget": "subtree",
  "wispkit.shellLink.allowEdit": true,
  "wispkit.executable.openBehavior": "viewer"
}
```
