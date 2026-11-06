---
type: Guide
title: Build and verify
description: Environment, the npm commands, test layout, the 3D bundle and resource-tree end-to-end probes, the real-machine self-test extension, packaging and installation
tags: [build, test, verification, packaging]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
---

# Build and verify

**English** | [中文](build-and-verify.zh-CN.md) | [Español](build-and-verify.es.md)

## Environment

| Item | Requirement |
|---|---|
| Node.js / npm | **^22.22.2 / ^24.15.0 / >=26** (the range accepted by `jsdom@30`); used by tsc, esbuild, mocha and vsce |
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
npm run package     # vsce package → wispkit-0.2.15.vsix
```

| Command | What it actually does |
|---|---|
| `compile` | two stages: `tsc -p ./` compiles `src` into `out`; `node esbuild.mjs` bundles **8 webview bundles** (`markdown` / `mermaid` / `html` / `image` / `video` / `xaml` / `readonly` / `graph3d`), format `iife`, `platform: browser`, `target: es2020`, no sourcemaps; only `graph3d` enables `minify` (three.js is large) |
| `lint` | `eslint src`, configured in `eslint.config.mjs` (typescript-eslint 9) |
| `test` | runs `compile` first (the tests run from `out/`), then `mocha "out/test/**/*.test.js"`. **Plain Node, no VS Code instance** |
| `package` | `vsce package`, producing `wispkit-<version>.vsix` |

**An easy pitfall**: `media/subtree.js` **is not bundled by esbuild**. The page references the source file directly with `<script type="module" src="...subtree.js" nonce=...>`; the other 8 front-end entries (including `mermaid.js` / `graph3d.js`) reference `media/dist/*.js`. So editing `subtree.js` does not require `npm run compile`, but editing any of the other 8 does — otherwise `media/dist/` keeps the old copy.

## CI

`.github/workflows/ci.yml` (GitHub Actions) runs for every push and pull request on `windows-latest`, with the steps in this fixed order:

| Step | Command |
|---|---|
| 1 | `npm ci` |
| 2 | `npm run lint` |
| 3 | `npm run compile` |
| 4 | `npm test` |

`lint` must stay before `test`: `npm test` runs `compile` again and then the compiled tests, so a lint error discovered after the test step looks like a test failure. `npm ci` is used instead of `npm install` so the committed lockfile is enforced.

Node **22.22.2** is the lowest supported version, and the CI pins exactly that. ESLint 9 declares `^20.9.0` and `@vscode/vsce` declares `>=20`, but `jsdom@30` (and its `undici`) accepts only `^22.22.2 || ^24.15.0 || >=26`; on Node 20 the test run dies while loading jsdom (`Cannot read properties of undefined (reading 'bind')`).

The runner is Windows on purpose: several test contracts assert Windows path semantics (drive letters, UNC paths, `\` separators). A POSIX runner currently fails them even though the extension itself is cross-platform.

To check the gate's negative path locally: add an unused local variable under `src/` and run `npm run lint` — it must exit non-zero before `compile` / `test` run.

## Test layout

- Framework: **mocha** + **jsdom** (both in devDependencies).
- Location: `src/test/*.test.ts` → compiled to `out/test/*.test.js`.
- Character: **pure logic tests, no VS Code instance started**. Everything that touches the `vscode` API is isolated in `*Provider.ts`, while pure logic lives in separate files (that do not import `vscode`) and can therefore be unit-tested directly.
- Current: **70 test files / 1149 cases** (`npm test` prints `1149 passing`).

### Cases per file

The per-file split is not duplicated here. It used to be a hand-maintained table and had drifted to
39 of 62 files with several stale counts — exactly the failure that the recording rules in
[Test and quality](test-and-quality.md) exist to prevent. Regenerate it when you need it:

```bash
npm test && npx mocha "out/test/**/*.test.js" --reporter json
```

The totals in [Test and quality](test-and-quality.md) are the contract; the per-file split is a
diagnostic.

### 3D bundle and end-to-end probes

| Item | Value |
|---|---|
| Output | `media/dist/graph3d.js` |
| Source entry | `media/graph3d.js` (`import * as THREE`, `OrbitControls` and `src/graph3d/*`) |
| Minification | esbuild `minify: true`; the only minified webview bundle |
| Current size | **about 603 KB** (617,043 B; three.js dominates and the size changes with the code) |
| Packaging check | the VSIX should contain `extension/media/dist/graph3d.js`, `extension/media/graph3d.css`, `extension/out/graph3dProvider.js` and `extension/out/graph3d/*.js`; verify with `npx vsce ls \| Select-String graph3d` |

The **3D real-machine end-to-end probes** live in `.selftest/e2e-graph3d/` (ignored by `.gitignore`, not shipped in the VSIX or the npm package). They start VS Code 1.137.0 with isolated `--user-data-dir` / `--extensions-dir` and drive real right-clicks, clicks and drags over CDP:

- Probes: `probe-entry.mjs`, `probe-layout.mjs`, `probe-toolbar.mjs`, `probe-camera.mjs`, `probe-packaged.mjs`, `probe-packaged-palette.mjs`, `probe-console.mjs`, and others;
- Results: `probe-*.result.json`, `console-errors.json`; screenshots `03`–`42`; the item-by-item write-up is `detail.md` in the same directory;
- Coverage: context-menu / command-palette entry, re-opening the same file only reveals, title count, left/right selects, 15%–85% split panes, merge / `Esc`, spacing slider, refresh, reset view, left-drag rotate / right-drag pan / wheel zoom, window resizing, and an isolated install of the packaged VSIX;
- Result: no extension-host or webview exceptions; every probe check passed.

### Resource-tree tests and packaging check

The nine resource-tree test files hold **94 cases** in total (already included in the 1149):

| Test file | Cases | Covers |
|---|---:|---|
| `resourceTreeStorage.test.ts` | 19 | storage location resolution, UTF-8 BOM, temporary paths, atomic-write success and three failure-protection paths |
| `resourceTreeModel.test.ts` | 16 | node model, parsing / sanitising, serialisation, id reassignment, over-limit / over-depth truncation |
| `resourceTreeSystemTerminal.test.ts` | 12 | the "open in system terminal" menu per platform and its launch plan (Windows elevation, macOS / Linux argv) |
| `resourceTreeExplorerSelection.test.ts` | 11 | command-argument normalisation for the Explorer context menu and the batch add plan for a multi-selection |
| `resourceTreeFolderStateCache.test.ts` | 9 | folder state cache: TTL, invalidation, LRU cap, concurrency limit and request de-duplication |
| `resourceTreePresentation.test.ts` | 9 | folder state, description / tooltip text, group and folder click commands |
| `resourceTreePaths.test.ts` | 8 | `${workspaceFolder}` / by name / by index, absolute paths outside the workspace, case handling |
| `resourceTreeProviderContract.test.ts` | 5 | the folder-state IO contract: cached `getTreeItem`, async prefetch, registered commands |
| `resourceTreeTransfer.test.ts` | 5 | import planning, invalid-file rejection, warning summary, export / import round-trip |
| **Total** | **94** | |

The real-machine end-to-end probes live in `.selftest/e2e-resource-tree/` (ignored by `.gitignore`, not shipped in the VSIX): `probe-final.mjs` (60 checkpoints), `probe-focused.mjs` (internal drag / cycle detection / subtree) and `probe-persistence.mjs` (32 checkpoints). They cover the Activity Bar and empty-tree hints, the six title-bar entries, adding from the Explorer context menu, arbitrary-depth add/rename/move/delete, internal and external drag and drop, cycle rejection, opening the subtree panel, the virtual-group click message, the three warning states, refresh state preservation, external-deletion warnings, configuration switching, refresh after an external edit, invalid JSON not being overwritten, import / export / open JSON, and atomic-write failure protection, with 0 errors; screenshots 01–32. Multi-root workspaces were verified on a real machine on 2026-10-26 (probes under `.selftest/e2e-resource-tree-multiroot/`; see limitations item 12). Remaining known gap: under Session 0 the native file pickers were verified with extension-host API stubs (the command path and disk writes still use the real code).

**Packaging check**: the VSIX should contain `extension/out/resourceTreeProvider.js` and `extension/out/resourceTree/{model,paths,storage,storageCore,transfer,presentation}.js`; `extension/package.json` should show the `wispkit.resourceTree` view, the 13 `wispkit.resourceTree.*` commands and the `onView:wispkit.resourceTree` activation event. Resource management is a native TreeView and has **no** front-end bundle / media assets. Verify with:

```powershell
npx vsce ls | Select-String resourceTree
```

`demo/**` is still excluded by `.vscodeignore`, so the `demo/R9-resource-tree` fixtures are not shipped with the extension.

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

> **The package script rewrites relative links to absolute Gitee URLs**: the trilingual READMEs introduce **relative links** such as `README.zh-CN.md` and `docs/architecture.md`; `package.json` already points `repository` at Gitee, and the script explicitly passes `--baseContentUrl https://gitee.com/the50w/wispkit/blob/master --baseImagesUrl https://gitee.com/the50w/wispkit/raw/master`, so those links stay clickable on the extension details page. Change both flags together if the repository moves.

`.vscodeignore` excludes the following (which directly determines the VSIX contents):

| Excluded | Reason |
|---|---|
| `src/**`, `out/test/**`, `**/*.map` | sources and tests do not go into the package (runtime only needs `out/`) |
| `.vscode/**`, `.claude/**`, `tools/selftest/**`, `.selftest/**` | development-time assets |
| `eslint.config.mjs`, `esbuild.mjs`, `tsconfig.json`, `*.vsix` | build configuration |
| `tools/xaml-render/{obj,bin/Debug,publish,samples,out}/**`, `*.ps1`, `*.md`, `Program.cs`, `*.csproj` | only the Release output of the renderer is kept |
| `demo/**` | demo data (about 5 MB) does not go into the package |
| `panzoom.bak`, `contrib.bak` | historical backups |

Current output: **173 content entries / 175 archive entries, about 1.73 MB** (`docs/` holds 25 Markdown documents alongside the three READMEs; the count grows as documentation is added).

Installing locally:

```powershell
code --install-extension .\wispkit-0.2.15.vsix --force
```

After installing you **must reload the window** (or restart VS Code) for it to take effect. To verify the installation really updated, do not trust timestamps alone — read the installed files and confirm the change is inside:

```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\harrrry.wispkit-0.2.15"
Select-String -Path "$ext\media\markdown.css" -Pattern 'overflow: clip' -Quiet
```

## Verification discipline

1. **Run `lint` + `test` for any front-end change**; when only CSS class rules change, watch that the esbuild output stays in sync (`media/dist/`).
2. **Assertions must bite the result, not "the rule exists"**. The repo has a real lesson here: an assertion that "a CSS rule was written into the file" passed while the actual rendering bug slipped through; later assertions were changed to "what happened in the scene after the click" (for example `clicking Save really sends the change`, `the slider's top and bottom margins must be equal`).
3. **Prefer the real-machine self-test** (`tools/selftest`) for webview-related changes instead of only running jsdom — jsdom neither executes CSP nor loads third-party scripts.
4. **After installing, read the files to verify**, do not rely on `vsce package` succeeding.
5. **Watch both the bundle and the probes for 3D changes**: after editing `media/graph3d.js` / `src/graph3d/*`, re-run `npm run compile`, confirm `media/dist/graph3d.js` was updated, then re-run the `.selftest/e2e-graph3d/` probes for entry, split panes, merge and camera.
