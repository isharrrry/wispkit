---
type: Guide
title: 构建与验证
description: 环境、npm 命令、测试构成、3D bundle 与资源树真机端到端探针、自检扩展与打包安装
tags: [build, test, verification, packaging]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# 构建与验证

[English](build-and-verify.md) | **中文** | [Español](build-and-verify.es.md)

## 环境

| 项 | 要求 |
|---|---|
| Node.js / npm | **^22.22.2 / ^24.15.0 / >=26**（`jsdom@30` 接受的范围）；用于 tsc、esbuild、mocha、vsce |
| TypeScript | 5.7（`devDependencies` 固定） |
| VS Code | `engines.vscode: ^1.71.0`；实测版本 **1.137.0**（Windows） |
| .NET | 仅 XAML 视图需要：**.NET 10 Windows Desktop 运行时**（渲染器是 framework-dependent） |
| 平台 | 扩展本身跨平台；XAML 渲染器与真机自检脚本在 Windows 上验证 |

## 四条命令

```bash
npm install
npm run compile     # tsc + esbuild
npm run lint        # eslint src
npm test            # 先 compile，再 mocha
npm run package     # vsce package → wispkit-0.1.0.vsix
```

| 命令 | 实际做了什么 |
|---|---|
| `compile` | 两段：`tsc -p ./` 把 `src` 编到 `out`；`node esbuild.mjs` 打 **8 个 webview bundle**（`markdown` / `mermaid` / `html` / `image` / `video` / `xaml` / `readonly` / `graph3d`），格式 `iife`、`platform: browser`、`target: es2020`、无 sourcemap；只有 `graph3d` 开 `minify`（three.js 体积大） |
| `lint` | `eslint src`，配置在 `eslint.config.mjs`（typescript-eslint 9） |
| `test` | 先跑 `compile`（测试跑在 `out/`），再 `mocha "out/test/**/*.test.js"`。**纯 Node 环境，不启动 VS Code** |
| `package` | `vsce package`，产物 `wispkit-<version>.vsix` |

**一个容易踩的点**：`media/subtree.js` **不过 esbuild**。页面用 `<script type="module" src="...subtree.js" nonce=...>` 直接引用源文件；其余 8 个前端入口（含 `mermaid.js` / `graph3d.js`）引的是 `media/dist/*.js`。所以改 `subtree.js` 不需要 `npm run compile`，但改另外 8 个必须重新 compile 才会进 `media/dist/`。

## CI

`.github/workflows/ci.yml`（GitHub Actions）在每次 push 与 pull request 时运行，跑在 `windows-latest` 上，步骤顺序固定：

| 步骤 | 命令 |
|---|---|
| 1 | `npm ci` |
| 2 | `npm run lint` |
| 3 | `npm run compile` |
| 4 | `npm test` |

`lint` 必须排在 `test` 前面：`npm test` 自己会再跑一次 `compile`，然后跑编译产物里的测试；如果 lint 排在后面，格式错误会伪装成测试失败。安装用 `npm ci` 而不是 `npm install`，这样提交的 lockfile 才会被严格执行。

Node **22.22.2** 是支持的最低版本，CI 就固定在它上面。ESLint 9 声明 `^20.9.0`、`@vscode/vsce` 声明 `>=20`，但 `jsdom@30`（连同它的 `undici`）只接受 `^22.22.2 || ^24.15.0 || >=26`；在 Node 20 上测试会在加载 jsdom 时直接崩溃（`Cannot read properties of undefined (reading 'bind')`）。

runner 特意选 Windows：测试里有若干路径契约断言 Windows 语义（盘符、UNC、`\` 分隔符）。扩展本身跨平台，但当前测试套件在 POSIX runner 上会失败。

本地验证门禁的反证：在 `src/` 下加一个未使用的局部变量再跑 `npm run lint`，必须在 `compile` / `test` 之前以非零退出。

## 测试体系

- 框架：**mocha** + **jsdom**（`@types/jsdom`、`jsdom` 均在 devDependencies）。
- 位置：`src/test/*.test.ts` → 编译成 `out/test/*.test.js`。
- 特点：**纯逻辑测试，不启动 VS Code 实例**。凡是涉及 `vscode` API 的部分都被隔离在 `*Provider.ts` 里，纯逻辑放独立文件（不 import `vscode`），因此可以直接单测。
- 当前：**62 个测试文件 / 1059 个用例**（`npm test` 输出 `1059 passing`）。

### 用例分布

这里不再重复逐文件分布。它曾经是一张手工维护的表，后来漂到只覆盖 62 个文件里的 39 个，还有若干
过时计数——正是[测试与质量](test-and-quality.md)的记录规则要防的那种失效。需要时重新生成：

```bash
npm test && npx mocha "out/test/**/*.test.js" --reporter json
```

[测试与质量](test-and-quality.md)里的总数是契约，逐文件分布只是诊断。

### 3D bundle 与端到端探针

| 项 | 值 |
|---|---|
| 产物 | `media/dist/graph3d.js` |
| 源入口 | `media/graph3d.js`（`import * as THREE`、`OrbitControls` 与 `src/graph3d/*`） |
| 压缩 | esbuild `minify: true`，是唯一压缩的 webview bundle |
| 当前体积 | **约 603 KB**（617,043 B；three.js 占大部分，随代码变化） |
| 打包检查 | VSIX 中应同时存在 `extension/media/dist/graph3d.js`、`extension/media/graph3d.css`、`extension/out/graph3dProvider.js`、`extension/out/graph3d/*.js`；可用 `npx vsce ls \| Select-String graph3d` 核对 |

**3D 真机端到端探针**位于 `.selftest/e2e-graph3d/`（`.gitignore` 已忽略，不进 VSIX，也不进 npm 包）。它用独立 `--user-data-dir` / `--extensions-dir` 启动 VS Code 1.137.0，通过 CDP 驱动真实右键、点击与拖动：

- 探针：`probe-entry.mjs`、`probe-layout.mjs`、`probe-toolbar.mjs`、`probe-camera.mjs`、`probe-packaged.mjs`、`probe-packaged-palette.mjs`、`probe-console.mjs` 等；
- 结果：`probe-*.result.json`、`console-errors.json`；截图 `03`–`42`；逐项说明见同目录 `detail.md`；
- 覆盖：右键 / 命令面板入口、同文件重复打开只 reveal、标题计数、左右下拉、15%–85% 分栏、合并 / `Esc`、间隔滑杆、刷新、重置视角、左键旋转 / 右键平移 / 滚轮缩放、窗口自适应，以及打包 VSIX 的隔离安装复验；
- 结果：扩展宿主与 webview 均无异常，探针检查项全部通过。

### 资源管理测试与打包检查

资源管理相关的 9 个测试文件共 **94 个用例**（已包含在总数 1059 内）：

| 测试文件 | 用例 | 覆盖 |
|---|---:|---|
| `resourceTreeStorage.test.ts` | 19 | 存储位置解析、UTF-8 BOM、临时路径、原子写入成功与三条失败保护路径 |
| `resourceTreeModel.test.ts` | 16 | 节点模型、解析与清洗、序列化、id 重排、超量 / 超深截断 |
| `resourceTreeSystemTerminal.test.ts` | 12 | 各平台的「在系统终端中打开」菜单及启动计划（Windows 提权、macOS / Linux 的 argv） |
| `resourceTreeExplorerSelection.test.ts` | 11 | 资源管理器右键菜单的实参归一化，以及多选时的批量添加计划 |
| `resourceTreeFolderStateCache.test.ts` | 9 | 文件夹状态缓存：TTL、失效、LRU 上限、并发上限与请求去重 |
| `resourceTreePresentation.test.ts` | 9 | 文件夹状态、描述与提示文本、分组与文件夹的点击命令 |
| `resourceTreePaths.test.ts` | 8 | `${workspaceFolder}` / 按名称 / 按索引、工作区外的绝对路径、大小写处理 |
| `resourceTreeProviderContract.test.ts` | 5 | 文件夹状态 IO 契约：缓存式 `getTreeItem`、异步预取、已注册命令 |
| `resourceTreeTransfer.test.ts` | 5 | 导入规划、非法文件拒绝、警告汇总、导出 / 导入往返 |
| **合计** | **94** | |

真机端到端探针位于 `.selftest/e2e-resource-tree/`（`.gitignore` 已忽略，不进 VSIX）：`probe-final.mjs`（60 个记录点）、`probe-focused.mjs`（内部拖拽 / 环检测 / 子树）、`probe-persistence.mjs`（32 个记录点）。覆盖活动栏与空树提示、标题栏六个入口、资源管理器右键添加、任意层级增删改移、内部与外部拖拽、环拒绝、打开子树、虚拟组点击提示、三种异常状态、刷新状态保持、外部删除警告、配置切换、外部编辑后刷新、非法 JSON 不覆盖、导入 / 导出 / 打开 JSON、原子写失败保护，结果 0 错误；截图 01–32。多根工作区已于 2026-10-26 完成真机验证（探针位于 `.selftest/e2e-resource-tree-multiroot/`，见限制第 12 条）；剩余已知未覆盖：Session 0 下原生文件选择器用扩展宿主 API 桩验证（命令链路与写盘仍走真实代码）。

**打包检查**：VSIX 里应包含 `extension/out/resourceTreeProvider.js` 与 `extension/out/resourceTree/{model,paths,storage,storageCore,transfer,presentation}.js`；`extension/package.json` 里能看到 `wispkit.resourceTree` 视图、13 个 `wispkit.resourceTree.*` 命令与 `onView:wispkit.resourceTree` 激活事件。资源管理是原生 TreeView，**没有**前端 bundle / media 资源。可用：

```powershell
npx vsce ls | Select-String resourceTree
```

核对。`demo/**` 仍被 `.vscodeignore` 排除，`demo/R9-resource-tree` 的示例不随扩展发布。

## 真机自检扩展（`tools/selftest`）

`tools/selftest` 不是脚本目录，而是一个**临时的自检扩展**（`wispkit-selftest`，`private: true`，**不随 VSIX 发布**）：

- `activationEvents: ["*"]`，激活后自动跑探针。
- **渲染检查**：直接调 `markdown.api.render`，断言返回类型、长度、是否含 `class="mermaid"` / `class="mxgraph"` / `command:` 链接。
- **页面探针**：对 `wispkit.markdown` / `wispkit.image` / `wispkit.html` 三个视图，把一段带 nonce 的 `<script>` 注入 `</head>`，在 `load` 后延迟若干毫秒回传结果（布局探针、主题探针）。
- **可配置**：环境变量 `WISPKIT_SELFTEST_FIXTURE` / `WISPKIT_SELFTEST_IMAGE` / `WISPKIT_SELFTEST_HTML` 指定三个视图的素材，`WISPKIT_SELFTEST_PROBE_MS` 控制等待时间（默认 10000 ms，给 mermaid/drawio 大图留时间）；`WISPKIT_SELFTEST_XAML` 与 `WISPKIT_SELFTEST_WS` 指定 XAML 探针的源文件与工作目录，`WISPKIT_SELFTEST_DEMO`（配 `WISPKIT_SELFTEST_DEMO_LIST`）对素材目录逐份做「渲染 + 页面探针」，`WISPKIT_SELFTEST_OUT` 指定结果落盘位置。

它解决的是单元测试的盲区：**webview 里的真实渲染、CSP 是否放行、第三方脚本是否真的跑起来**。`.vscodeignore` 已排除 `tools/selftest/**`。

## XAML 渲染器（`tools/xaml-render`）

独立的 .NET 项目，产物随 VSIX 分发：

```powershell
cd tools\xaml-render
dotnet build -c Release
```

- **framework-dependent**（几百 KB），运行时需要 .NET 10 Windows Desktop。
- 扩展与它之间是**进程边界**，契约冻结为：
  ```text
  <renderer> render <in.xaml> <out.png> [--assembly <dll>]...
  ```
- 渲染策略与覆盖率详见 [xaml-render/README.md](../tools/xaml-render/README.md) 与 [results-real.md](../tools/xaml-render/results-real.md)。
- 改了渲染器必须重新 `dotnet build -c Release` 再打包，否则 VSIX 里仍是旧产物。

## 打包与安装

```bash
npm run package
```

> **打包脚本用 Gitee 的绝对地址重写相对链接**：三语 README 引入了 `README.zh-CN.md`、`docs/architecture.md` 这类**相对链接**；`package.json` 的 `repository` 已指向 Gitee，脚本又显式传了 `--baseContentUrl https://gitee.com/the50w/wispkit/blob/master --baseImagesUrl https://gitee.com/the50w/wispkit/raw/master`，确保扩展详情页里的这些链接可点。改仓库地址时这两个参数要一起改。

`.vscodeignore` 排除了这些（直接影响 vsix 内容）：

| 排除项 | 原因 |
|---|---|
| `src/**`、`out/test/**`、`**/*.map` | 源码与测试不进包（运行时只用 `out/`） |
| `.vscode/**`、`.claude/**`、`tools/selftest/**`、`.selftest/**` | 开发期资产 |
| `eslint.config.mjs`、`esbuild.mjs`、`tsconfig.json`、`*.vsix` | 构建配置 |
| `tools/xaml-render/{obj,bin/Debug,publish,samples,out}/**`、`*.ps1`、`*.md`、`Program.cs`、`*.csproj` | 只保留渲染器的 Release 产物 |
| `demo/**` | 演示数据（约 5 MB）不进包 |
| `panzoom.bak`、`contrib.bak` | 历史备份 |

当前产物：**170 个内容条目 / 172 个归档条目，约 1.71 MB**（`docs/` 共 25 篇 Markdown，再加三语 README；文档增加会同步变）。

安装到本机：

```powershell
& "D:\app\VSCodeEXE\bin\code.cmd" --install-extension .\wispkit-0.1.0.vsix --force
```

安装后**需要重载窗口**（或重开 VS Code）才会生效。验证安装是否真的更新了，不要只看时间戳 —— 直接读安装目录里的文件确认改动在里面：

```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\narnat.wispkit-0.1.0"
Select-String -Path "$ext\media\markdown.css" -Pattern 'overflow: clip' -Quiet
```

## 验证纪律

1. **改前端必须跑 `lint` + `test`**；只改 CSS 类规则时注意 esbuild 产物同步（`media/dist/`）。
2. **断言要咬结果，不是咬"规则存在"**。仓库有过真实教训：断言"某条 CSS 规则写进了文件"却漏掉真实渲染 bug；后来改为断言"点完之后场景里发生了什么"（例：`点「保存」按钮真的把改动发出去`、`滑块上下余量必须相等`）。
3. **动 webview 相关改动，尽量走真机自检**（`tools/selftest`）而不是只跑 jsdom —— jsdom 不执行 CSP，也不加载第三方脚本。
4. **安装后读文件验证**，不要只看 `vsce package` 是否成功。
5. **3D 改动同时看 bundle 与探针**：改 `media/graph3d.js` / `src/graph3d/*` 后重新 `npm run compile`，确认 `media/dist/graph3d.js` 已更新，再用 `.selftest/e2e-graph3d/` 的探针复验入口、分栏、合并与相机。
