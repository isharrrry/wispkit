# Wispkit

**English** | [中文](README.zh-CN.md) | [Español](README.es.md)

> Browsing enhancements for VS Code. It **never patches VS Code or modifies a single file of it** — five custom editors carry Markdown / images / HTML / XAML / read-only text, plus an Explorer subtree panel.

The extension host is plain TypeScript (`engines.vscode: ^1.71.0`), developed and verified on Windows. The XAML view ships a framework-dependent .NET renderer and needs the .NET 10 Windows Desktop runtime; the other four views have no native dependency.

## What problem it solves

| Problem | What Wispkit does |
|---|---|
| The Markdown preview is a read-only dead page | Tree navigation + media context menu + in-place drawio editing + **in-place paragraph editing** (edit the paragraph under the cursor — no split pane, no second editor) |
| Zooming an image needs Ctrl+wheel, and you cannot drag it | Plain wheel zoom anchored at the cursor + hold-right-button pan + double-click fit/100% |
| `vscode://file/<path>:<line>` links from docs do not open | Rewritten to `command:vscode.open?<args>`, opened **in the current window** at that line |
| You want to see what a WPF view actually looks like | XAML source and render **side by side**; the render pans and zooms; edits save back to the file |
| You only want to read, without loading the whole document | Global read-only mode: reads the first N bytes, **creates no `TextDocument`** |
| The Explorer shows you one column of names | Subtree panel: configurable columns (size/time/type/owner…), an action area, custom tools |

## Quick start

```bash
npm install
npm run compile     # tsc + esbuild (4 webview bundles)
npm test            # mocha, pure logic, no VS Code instance
npm run package     # produces wispkit-<version>.vsix
```

Install into your local VS Code (point the path at your own `code.cmd`):

```powershell
& "D:\app\VSCodeEXE\bin\code.cmd" --install-extension .\wispkit-0.1.0.vsix --force
```

The XAML view needs its bundled renderer built once:

```powershell
cd tools\xaml-render
dotnet build -c Release
```

## Core concepts

1. **Custom editors, not patches** — five `CustomEditorProvider`s compete for file types. Markdown, images and XAML are `priority: default` (they take over); HTML and read-only text are `option` (explicit switch). To go back to the built-in editor: *Reopen Editor With…* or `workbench.editorAssociations`.
2. **The host owns paths, the webview owns interaction** — resource URLs inside a webview are `vscode-webview://` and **cannot be reverse-mapped to a real path**. So the media context menu reports only "index + kind", and the host re-reads the path and source from the Markdown text; images get an extra `alt` cross-check. See [architecture](docs/architecture.md).
3. **Render through the built-in pipeline** — the extension calls the built-in `markdown.api.render` command, so third-party `markdown.markdownItPlugins` (mermaid, katex) apply automatically, then dispatches `vscode.markdown.updateContent` on `window` so front-end scripts re-render. See [views and interaction](docs/views-and-interaction.md).
4. **Read-only means "not loaded", not "editing disabled"** — the preview reads only the first N bytes, truncates by line, builds no `TextDocument` and never loads the whole file; a floating "unlock editing" button switches to the native editor. See [configuration](docs/configuration.md).
5. **Assertions must bite the result, not "the rule exists"** — the repo has been burned by tests that verified "a CSS rule was written" while the real bug slipped through; current tests prefer to assert what happened after the click. See [build and verify](docs/build-and-verify.md).

## Safety

- **Markdown and XAML views reuse the built-in preview's Strict CSP** (`nonce` + `cspSource`, no `unsafe-inline`), so third-party preview scripts written against that policy work unchanged.
- **The HTML view uses a relaxed CSP** (inline scripts and http(s) resources allowed) — browsing HTML inherently requires the page's own scripts to run; the risk level is comparable to the built-in Simple Browser. **Do not open untrusted HTML with it.**
- "Save as" for media and "save" for XAML only write to a **path you picked** — nothing outside the target file is touched.

## Documentation

| To learn about | Read |
|---|---|
| Layers, module responsibilities, one complete data flow | [Architecture](docs/architecture.md) |
| Interaction, gestures and message contracts of the five views and the subtree panel | [Views and interaction](docs/views-and-interaction.md) |
| Field-level reference for every setting, `Wispkit.json`, tool placeholders | [Configuration](docs/configuration.md) |
| Build, tests, real-machine probes, packaging | [Build and verify](docs/build-and-verify.md) |
| What it cannot do, what was never verified | [Known limitations](docs/limitations.md) |
| How it was built step by step, and every pitfall hit | [Development notes](docs/development-notes.zh-CN.md) (中文) |

**Documentation rule**: every topic under `docs/` exists in English, Chinese and Spanish — **any edit updates all three in the same change** (variants are faithful translations, not summaries). The single exception is `docs/development-notes.zh-CN.md`, an internal engineering log kept in Chinese only. Unverified items are labelled explicitly in [Known limitations](docs/limitations.md) instead of being presented as guarantees.

## Build and measured environment

| Item | Value |
|---|---|
| Node / npm | builds locally (`npm run compile`) |
| TypeScript | 5.7 |
| esbuild | 0.24 (4 webview bundles) |
| Tests | mocha + jsdom, **477 passing**, 20 test files |
| Lint | eslint 9, **0 errors** |
| VSIX | 94 entries / ~1.1 MB (docs, the three READMEs and the screenshots included) |
| Measured VS Code | **1.137.0** (Windows) |

## Screenshots

Captured from a real VS Code 1.137.0 Extension Development Host, using the `demo/` folder shipped in this repository.

**Markdown view** — drawio block rendering, table of contents, edit toggle and the "Wispkit Markdown" badge:

![Wispkit Markdown view: drawio block rendering, table of contents and edit toggle](docs/images/wispkit-markdown.png)

**XAML view** — highlighted source next to the rendered result; the status line reports root type, size and hosting mode:

![Wispkit XAML view: highlighted source beside the render](docs/images/wispkit-xaml.png)

**Image view** — wheel zoom by default (no Ctrl needed), right-drag to pan, ruler to check the zoom ratio:

![Wispkit image view: wheel zoom and drag to pan](docs/images/wispkit-image.png)

**Read-only text view** — only the head of the file is loaded (64 KB / 800 lines by default); "Unlock editing" switches back to the native editor:

![Wispkit read-only text view: header-only load with an unlock control](docs/images/wispkit-readonly.png)

**Subtree browser** — multiple columns (name / size / type / modified / created), draggable widths, and per-selection file actions on the right:

![Wispkit subtree browser: multi-column view with file action groups](docs/images/wispkit-subtree.png)

## Measured behaviour

Every row below ran in a real VS Code, not a design intent:

| Verification | Result |
|---|---|
| Markdown media context menu | 4 items for images / 3 for mermaid / 4 for drawio; the clipboard receives the exact source text |
| In-place drawio editing | Code block → temp file → save re-locates by content and writes back byte-identically |
| XAML rendering (real `Common.Resources` controls with `x:Class` and `Binding`) | **6/6 rendered**; `Work.xaml` visually confirmed as the "▶ ⏸ ⏹" button row |
| XAML end-to-end in the webview | 3 assemblies discovered → `ok:true` → image loaded 102×49 → 27 source lines → 0 CSP violations / 0 script errors |
| Subtree icons vs Explorer | Real-machine CDP comparison of 6 files (`.md`/`.json`/`.mjs`) — **all identical**; 3 of them were the generic `file.svg` before the fix |
| Enter inside an editable paragraph | A single Enter is padded to a blank line and renders a new paragraph; `Shift+Enter` stays a soft break |

No row is an estimate. Unverified items are listed in [Known limitations](docs/limitations.md).

## Known limitations (summary)

1. **No editor↔preview scroll sync** (no `data-line` source mapping); TOC highlighting does not depend on it.
2. **Simple Browser cannot be taken over** — it is a command-created webviewPanel and never enters customEditors competition.
3. **XAML is a static snapshot**: no DataContext, no event handlers, no message loop; `App.xaml` and `BlazorWebView` hosts have no visual content (a blank Blazor host is **correct**).
4. **The paragraph edit box has no syntax highlighting** — it is a plain `<textarea>`, trading highlighting for alignment with the text and zero dependencies.
5. **Subtree `atime` and POSIX permission bits are always `-`** — VS Code's `FileStat` does not expose them.
6. **Font-based icon themes (e.g. Seti) do not fall back** — subtree icons use a self-drawn sprite; only SVG-based themes are parsed.

All fourteen items plus the unverified list are in [Known limitations](docs/limitations.md).

## License

MIT, see [LICENSE](LICENSE).
