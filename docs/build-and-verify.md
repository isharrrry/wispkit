---
type: Guide
title: Build and verify
description: Environment, the four npm commands, test layout, the real-machine self-test extension, packaging and installation
tags: [build, test, verification, packaging]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Build and verify

**English** | [中文](build-and-verify.zh-CN.md) | [Español](build-and-verify.es.md)

## Environment

| Item | Requirement |
|---|---|
| Node.js / npm | used by tsc, esbuild, mocha and vsce |
| TypeScript | 5.7 (pinned in `devDependencies`) |
| VS Code | `engines.vscode: ^1.71.0`; measured version **1.137.0** (Windows) |
| .NET | needed by the XAML view only: the **.NET 10 Windows Desktop runtime** (the renderer is framework-dependent) |
| Platform | the extension itself is cross-platform; the XAML renderer and the real-machine probes were verified on Windows |

## Four commands

```bash
npm install
npm run compile     # tsc + esbuild
npm run lint        # eslint src
npm test            # compile first, then mocha
npm run package     # vsce package → wispkit-0.1.0.vsix
```

| Command | What it actually does |
|---|---|
| `compile` | two stages: `tsc -p ./` compiles `src` into `out`; `node esbuild.mjs` bundles **4 webview bundles** (`markdown` / `image` / `xaml` / `readonly`), format `iife`, `platform: browser`, `target: es2020`, no minification, no sourcemaps |
| `lint` | `eslint src`, configured in `eslint.config.mjs` (typescript-eslint 9) |
| `test` | runs `compile` first (the tests run from `out/`), then `mocha "out/test/**/*.test.js"`. **Plain Node, no VS Code instance** |
| `package` | `vsce package`, producing `wispkit-<version>.vsix` |

**An easy pitfall**: `media/subtree.js` **is not bundled by esbuild**. The page references the source file directly with `<script type="module" src="...subtree.js" nonce=...>`; the other 4 front-end files reference `media/dist/*.js`. So editing `subtree.js` does not require `npm run compile`, but editing any of the other 4 does — otherwise `media/dist/` keeps the old copy.

## Test layout

- Framework: **mocha** + **jsdom** (both in devDependencies).
- Location: `src/test/*.test.ts` → compiled to `out/test/*.test.js`.
- Character: **pure logic tests, no VS Code instance started**. Everything that touches the `vscode` API is isolated in `*Provider.ts`, while pure logic lives in separate files (that do not import `vscode`) and can therefore be unit-tested directly.
- Current: **20 test files / 477 cases**.

### Cases per file

| Test file | Cases | Covers |
|---|---:|---|
| `markdownPage.test.ts` | 91 | Markdown page HTML, CSP, typography variables, edit mode, save path |
| `subtreeCore.test.ts` | 48 | column definitions and formatting, sorting, configuration parsing, `Wispkit.json`, placeholder substitution |
| `readonlyHighlight.test.ts` | 49 | the generic syntax highlighter of the read-only view (language grouping and colouring across the 60+ extensions) |
| `xamlPage.test.ts` | 40 | XAML page structure, highlight overlay, panes |
| `subtreePage.test.ts` | 37 | subtree panel HTML, column-width variables, icon rendering |
| `toc.test.ts` | 24 | TOC tree building, depth, highlight following |
| `xamlHighlight.test.ts` | 22 | XAML / XAML.cs highlighting (visible characters stay identical) |
| `mediaParse.test.ts` | 20 | media index → source position mapping |
| `readonly.test.ts` | 15 | read-only mode state and page |
| `lightbox.test.ts` | 14 | full-screen modal |
| `readonlyAssociations.test.ts` | 14 | planning and applying `editorAssociations` |
| `subtreeIconTheme.test.ts` | 14 | four-level icon-theme lookup and language-icon merging |
| `xamlRenderer.test.ts` | 14 | renderer process call contract |
| `panzoom.test.ts` | 13 | zoom/pan arithmetic |
| `xamlDefects.test.ts` | 13 | regression guards for three fixed XAML defects |
| `contextmenu.test.ts` | 12 | context-menu positioning and hit testing |
| `contributions.test.ts` | 12 | aggregation of third-party `markdown.previewScripts` |
| `linkRewrite.test.ts` | 12 | `vscode://file/` → `command:` rewriting |
| `htmlPage.test.ts` | 9 | HTML page wrapper and relaxed CSP |
| `render.test.ts` | 4 | render pipeline entry |

## Real-machine self-test extension (`tools/selftest`)

`tools/selftest` is not a script directory but a **temporary self-test extension** (`wispkit-selftest`, `private: true`, **not shipped in the VSIX**):

- `activationEvents: ["*"]`; it runs its probes as soon as it activates.
- **Render checks**: calls `markdown.api.render` directly and asserts the return type, the length, and whether it contains `class="mermaid"` / `class="mxgraph"` / `command:` links.
- **Page probes**: for the `wispkit.markdown` / `wispkit.image` / `wispkit.html` views it injects a `<script>` with a nonce before `</head>` and reports results a while after `load` (layout and theme probes).
- **Configurable**: the environment variables `WISPKIT_SELFTEST_FIXTURE` / `WISPKIT_SELFTEST_IMAGE` / `WISPKIT_SELFTEST_HTML` choose the fixtures, and `WISPKIT_SELFTEST_PROBE_MS` controls the wait (default 10000 ms, leaving time for large mermaid/drawio diagrams).

It covers the blind spot of unit tests: **real rendering inside the webview, whether the CSP lets things through, and whether third-party scripts actually run**. `.vscodeignore` already excludes `tools/selftest/**`.

## XAML renderer (`tools/xaml-render`)

A separate .NET project whose output ships in the VSIX:

```powershell
cd tools\xaml-render
dotnet build -c Release
```

- **framework-dependent** (a few hundred KB); needs the .NET 10 Windows Desktop runtime at run time.
- The extension and the renderer are separated by a **process boundary**; the contract is frozen as:
  ```text
  <renderer> render <in.xaml> <out.png> [--assembly <dll>]...
  ```
- The rendering strategy and coverage are documented in [xaml-render/README.md](../tools/xaml-render/README.md) and [results-real.md](../tools/xaml-render/results-real.md).
- After changing the renderer you must `dotnet build -c Release` again before packaging, otherwise the VSIX still carries the old binary.

## Packaging and installation

```bash
npm run package
```

> **Do not drop `--baseContentUrl . --baseImagesUrl .` from the package script**: the trilingual READMEs introduce **relative links** such as `README.zh-CN.md` and `docs/architecture.md`, and this repository's `package.json` has no `repository` field. Without those two flags `vsce` fails with
> `Couldn't detect the repository ... The link 'README.zh-CN.md' will be broken` and **aborts packaging** (`--allow-missing-repository` does not bypass it).
> Passing `.` keeps the relative links as they are, so they still work when the extension details page is opened locally.

`.vscodeignore` excludes the following (which directly determines the VSIX contents):

| Excluded | Reason |
|---|---|
| `src/**`, `out/test/**`, `**/*.map` | sources and tests do not go into the package (runtime only needs `out/`) |
| `.vscode/**`, `.claude/**`, `tools/selftest/**`, `.selftest/**` | development-time assets |
| `eslint.config.mjs`, `esbuild.mjs`, `tsconfig.json`, `*.vsix` | build configuration |
| `tools/xaml-render/{obj,bin/Debug,publish,samples,out}/**`, `*.ps1`, `*.md`, `Program.cs`, `*.csproj` | only the Release output of the renderer is kept |
| `demo/**` | demo data (about 5 MB) does not go into the package |
| `panzoom.bak`, `contrib.bak` | historical backups |

Current output: **94 entries / about 1.1 MB** (26 more entries than code only: 19 files under `docs/`, 5 screenshots, plus `README.zh-CN.md` and `README.es.md`; the count grows as documentation is added).

Installing locally:

```powershell
& "D:\app\VSCodeEXE\bin\code.cmd" --install-extension .\wispkit-0.1.0.vsix --force
```

After installing you **must reload the window** (or restart VS Code) for it to take effect. To verify the installation really updated, do not trust timestamps alone — read the installed files and confirm the change is inside:

```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\narnat.wispkit-0.1.0"
Select-String -Path "$ext\media\markdown.css" -Pattern 'overflow: clip' -Quiet
```

## Verification discipline

1. **Run `lint` + `test` for any front-end change**; when only CSS class rules change, watch that the esbuild output stays in sync (`media/dist/`).
2. **Assertions must bite the result, not "the rule exists"**. The repo has a real lesson here: an assertion that "a CSS rule was written into the file" passed while the actual rendering bug slipped through; later assertions were changed to "what happened in the scene after the click" (for example `clicking Save really sends the change`, `the slider's top and bottom margins must be equal`).
3. **Prefer the real-machine self-test** (`tools/selftest`) for webview-related changes instead of only running jsdom — jsdom neither executes CSP nor loads third-party scripts.
4. **After installing, read the files to verify**, do not rely on `vsce package` succeeding.
