# R9 — 自定义资源管理（`wispkit.resourceTree`）

这个目录是「自定义资源管理」视图的手工验证素材：一棵包含**虚拟组 + 文件夹 + 任意层级嵌套**的示例树，存储文件里同时用了 `${workspaceFolder}` 占位符和一条普通相对路径。

| 文件 | 用途 |
|---|---|
| [.WispkitView/resource-tree.json](.WispkitView/resource-tree.json) | 示例树（`version: 1`，group / folder 嵌套） |
| [docs/readme.md](docs/readme.md) | 文件夹节点「文档」指向的真实目录 |
| [projects/frontend/README.md](projects/frontend/README.md) | 文件夹节点「前端」指向的真实目录 |
| [projects/frontend/components/README.md](projects/frontend/components/README.md) | 嵌套文件夹「组件」 |
| [projects/backend/README.md](projects/backend/README.md) | 文件夹节点「后端」指向的真实目录 |

## 前置

1. 安装 Wispkit 并重载窗口（`code --install-extension .\wispkit-0.1.0.vsix --force`，再执行 *Developer: Reload Window*）；
2. 用**「打开文件夹」**打开工作区（不要只单独打开某个文件）；
3. 活动栏出现 **Wispkit** 图标 → 点开「自定义资源管理」。

## 怎么加载这棵示例树

### 方式 A（推荐）：直接把 `R9-resource-tree` 作为工作区

`File → Open Folder…` 选择本目录。默认存储位置正是第一个工作区的 `.WispkitView/resource-tree.json`，视图启动时会**自动读取**这份示例，不需要导入。

此时 `${workspaceFolder}` 指本目录，`../R2-toc` 指向同级的 `demo/R2-toc`（存在），所有节点都应是正常文件夹图标。

### 方式 B：在 `demo` 工作区里指定文件

打开 `demo` 文件夹，在 `.vscode/settings.json` 或用户设置里写：

```jsonc
{
  "wispkit.resourceTree.file": "${workspaceFolder}/R9-resource-tree/.WispkitView/resource-tree.json"
}
```

视图会自动重载到这份 JSON。**注意**：这时 `${workspaceFolder}` 是 `demo`，示例里的 `${workspaceFolder}/docs` 会解析成 `demo/docs`（不存在）；要看到正常节点，需要把路径改成 `${workspaceFolder}/R9-resource-tree/docs` 等（见下面的「外部编辑后刷新」）。

### 方式 C：导入

1. 打开任意工作区（例如 `demo`）；
2. 视图标题栏的 **⋯** 溢出菜单 → **导入资源树…**；
3. 选择本目录的 `.WispkitView/resource-tree.json`；
4. 确认「导入将替换当前资源树（当前 N 个节点）为 M 个节点」。

导入只替换**内存中的树**，随后写进当前配置的存储文件（默认第一个工作区的 `.WispkitView/resource-tree.json`）；它**不会**修改 R9 目录里的这份示例文件。

> 导入到 `demo` 工作区后，占位符同样按 `demo` 解析，路径大多会显示 `⚠ 文件夹不存在`——这正好可以配合下面的「外部编辑后刷新」练习修改路径。

### 方式 D：复制文件

把本目录的 `.WispkitView` 文件夹整体复制到工作区根目录，再点视图标题的**刷新**。

## 外部编辑后刷新

扩展**没有监听**这个 JSON，外部改动不会自动出现：

1. 视图标题 **⋯** → **打开资源树 JSON**（文件不存在时会先写入当前树）；
2. 修改 `name`、`path`，或新增 / 删除节点，保存；
3. 回到视图，点标题栏的**刷新**（⟳）；
4. 成功时提示「资源树已刷新：N 个节点」；展开 / 选中状态尽量保留。

**故意改坏试试**：把 JSON 改成 `{ "version": 1, "roots": [`（不合法）再刷新——应提示「资源树刷新失败：资源树 JSON 不是合法 JSON…当前树保持不变，文件不会被覆盖」，树与文件都不会被清空。

**修复路径练习**（在 `demo` 工作区导入后）：把存储文件里的

```json
"path": "${workspaceFolder}/docs"
```

改成

```json
"path": "${workspaceFolder}/R9-resource-tree/docs"
```

并刷新，节点会从 `⚠ 文件夹不存在` 变为正常文件夹。其余 `${workspaceFolder}/projects/...` 同理；「兄弟素材」的 `../R2-toc` 在 `demo` 工作区里要改成 `R2-toc`。

## 应该看到什么

```text
演示工作区（虚拟组）
├─ 文档（文件夹）                    description: docs
├─ 项目（虚拟组）
│  ├─ 前端（文件夹）                 description: projects/frontend
│  │  ├─ 组件（文件夹）              description: projects/frontend/components
│  │  └─ 归档（虚拟组）
│  └─ 后端（文件夹）                 description: projects/backend
│     └─ 接口（虚拟组）
└─ 兄弟素材（相对路径）              description: ../R2-toc
```

- **虚拟组**图标是 `folder-library`，单击提示「虚拟分组不对应真实文件夹，不能浏览。」；
- **文件夹**图标是 `folder`，单击在**子树面板**打开；右键有「浏览文件夹」内联图标；
- 路径正常时 description 显示工作区相对路径；异常时显示 `⚠ 文件夹不存在` / `⚠ 不是文件夹` / `⚠ 路径无法解析`，图标变警告色。

## 拖拽 / 移动示例

| 操作 | 预期 |
|---|---|
| 把「组件」拖到「归档（虚拟组）」上 | 「组件」成为「归档」的子节点，并立即写回 JSON |
| 把「归档（虚拟组）」拖到根节点 / 空白处 | 移到资源树最外层 |
| 把「项目（虚拟组）」拖到它自己的子节点「前端」上 | 拒绝移动并提示「没有可移动的节点（目标可能位于节点自身内部）。」 |
| 从资源管理器把 `projects/backend` 拖进视图 | 新增一个文件夹节点；拖到「项目（虚拟组）」上则成为其子节点 |
| 把多个节点一起拖到某个组 | 多选移动；落在自身 / 后代上的节点会被跳过 |
| 右键 → **移动到…** | 选择「根目录」或任意组 / 文件夹作为目标 |
| 右键 → **上移 / 下移** | 在同一父级内调整顺序 |
| 右键 → **重命名** | 只改树里的显示名，不重命名磁盘目录 |
| 右键 → **删除** | 确认后从树里删除（含子树），**不删除磁盘文件** |

> 拖拽从资源管理器进入时，非文件夹条目会被跳过并提示；虚拟组没有真实路径，只用于命名与归类。

## 已知边界（这些「不工作」是设计如此）

| 现象 | 原因 |
|---|---|
| 虚拟组下方没有磁盘目录 | `group` 节点没有 `path`，只用于命名与归类 |
| 换成 `demo` 工作区后 `../R2-toc` 和 `${workspaceFolder}/docs` 失效 | 相对路径与 `${workspaceFolder}` 都按**第一个工作区**解析；换工作区后自然指向别处 |
| 工作区外绝对路径换机器后失效 | 工作区外没有占位符锚点，只能存绝对路径 |
| 外部改完 JSON 视图没变 | 没有文件监听，必须点刷新 |
| 外部编辑与视图编辑同时进行会互相覆盖 | 没有冲突检测，最后写入者获胜 |
| 多选文件夹右键「添加到自定义资源管理」只加了一个 | 该入口一次只接受一个文件夹；需要多个时用拖拽或标题栏「添加文件夹」 |
| 删除节点后磁盘目录还在 | 资源树只组织视图，从不移动 / 删除磁盘文件 |
