---
type: Guide
title: 构建与验证
description: 环境、四条 npm 命令、测试构成、真机自检扩展与打包安装
tags: [build, test, verification, packaging]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# 构建与验证

[English](build-and-verify.md) | **中文** | [Español](build-and-verify.es.md)

## 环境

| 项 | 要求 |
|---|---|
| Node.js / npm | 用于 tsc、esbuild、mocha、vsce |
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
| `compile` | 两段：`tsc -p ./` 把 `src` 编到 `out`；`node esbuild.mjs` 打 **4 个 webview bundle**（`markdown` / `image` / `xaml` / `readonly`），格式 `iife`、`platform: browser`、`target: es2020`、不压缩、无 sourcemap |
| `lint` | `eslint src`，配置在 `eslint.config.mjs`（typescript-eslint 9） |
| `test` | 先跑 `compile`（测试跑在 `out/`），再 `mocha "out/test/**/*.test.js"`。**纯 Node 环境，不启动 VS Code** |
| `package` | `vsce package`，产物 `wispkit-<version>.vsix` |

**一个容易踩的点**：`media/subtree.js` **不过 esbuild**。页面用 `<script type="module" src="...subtree.js" nonce=...>` 直接引用源文件；其余 4 个前端文件引的是 `media/dist/*.js`。所以改 `subtree.js` 不需要 `npm run compile`，但改另外 4 个必须重新 compile 才会进 `media/dist/`。

## 测试体系

- 框架：**mocha** + **jsdom**（`@types/jsdom`、`jsdom` 均在 devDependencies）。
- 位置：`src/test/*.test.ts` → 编译成 `out/test/*.test.js`。
- 特点：**纯逻辑测试，不启动 VS Code 实例**。凡是涉及 `vscode` API 的部分都被隔离在 `*Provider.ts` 里，纯逻辑放独立文件（不 import `vscode`），因此可以直接单测。
- 当前：**20 个测试文件 / 477 个用例**。

### 用例分布

| 测试文件 | 用例 | 覆盖 |
|---|---:|---|
| `markdownPage.test.ts` | 91 | Markdown 页面 HTML、CSP、排版变量、编辑模式、保存链路 |
| `readonlyHighlight.test.ts` | 49 | 只读视图的通用语法高亮（60+ 扩展名的语言分组与配色） |
| `subtreeCore.test.ts` | 48 | 列定义与格式化、排序、配置解析、`Wispkit.json`、占位符替换 |
| `xamlPage.test.ts` | 40 | XAML 页面结构、高亮叠层、分区 |
| `subtreePage.test.ts` | 37 | 子树面板 HTML、列宽变量、图标渲染 |
| `toc.test.ts` | 24 | 目录树构建、层级、跟随高亮 |
| `xamlHighlight.test.ts` | 22 | XAML / XAML.cs 高亮（可见字符逐字不变） |
| `mediaParse.test.ts` | 20 | 媒体索引 → 原文位置的映射 |
| `readonly.test.ts` | 15 | 只读模式状态与页面 |
| `lightbox.test.ts` | 14 | 全屏模态框 |
| `readonlyAssociations.test.ts` | 14 | `editorAssociations` 的规划与应用 |
| `subtreeIconTheme.test.ts` | 14 | 图标主题四级查找与语言图标合并 |
| `xamlRenderer.test.ts` | 14 | 渲染器进程调用契约 |
| `panzoom.test.ts` | 13 | 缩放/平移数学 |
| `xamlDefects.test.ts` | 13 | 三个已修 XAML 缺陷的防回归 |
| `contextmenu.test.ts` | 12 | 右键菜单定位与命中 |
| `contributions.test.ts` | 12 | 第三方 `markdown.previewScripts` 聚合 |
| `linkRewrite.test.ts` | 12 | `vscode://file/` → `command:` 改写 |
| `htmlPage.test.ts` | 9 | HTML 页面包装与宽松 CSP |
| `render.test.ts` | 4 | 渲染管线入口 |

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

> **不要省掉脚本里的 `--baseContentUrl . --baseImagesUrl .`**：三语 README 引入了 `README.zh-CN.md`、`docs/architecture.md` 这类**相对链接**，而本仓库 `package.json` 没有 `repository` 字段。缺这两个参数时 `vsce` 直接报
> `Couldn't detect the repository ... The link 'README.zh-CN.md' will be broken` 并**中止打包**（`--allow-missing-repository` 不足以绕过）。
> 加 `.` 之后 vsce 会把相对链接按原样保留，本地打开扩展详情页仍可点。

`.vscodeignore` 排除了这些（直接影响 vsix 内容）：

| 排除项 | 原因 |
|---|---|
| `src/**`、`out/test/**`、`**/*.map` | 源码与测试不进包（运行时只用 `out/`） |
| `.vscode/**`、`.claude/**`、`tools/selftest/**`、`.selftest/**` | 开发期资产 |
| `eslint.config.mjs`、`esbuild.mjs`、`tsconfig.json`、`*.vsix` | 构建配置 |
| `tools/xaml-render/{obj,bin/Debug,publish,samples,out}/**`、`*.ps1`、`*.md`、`Program.cs`、`*.csproj` | 只保留渲染器的 Release 产物 |
| `demo/**` | 演示数据（约 5 MB）不进包 |
| `panzoom.bak`、`contrib.bak` | 历史备份 |

当前产物：**94 条目 / 约 1.1 MB**（比只有代码时多 26 个条目：`docs/` 19 篇 + 5 张界面截图 + `README.zh-CN.md` + `README.es.md`；文档增加会同步变）。

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
