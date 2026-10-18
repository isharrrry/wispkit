---
type: Guide
title: Architecture
description: The three layers of Wispkit, the responsibility of every module, one complete data flow and the key design trade-offs
tags: [architecture, vscode-extension, webview]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Architecture

**English** | [中文](architecture.zh-CN.md) | [Español](architecture.es.md)

## Layers

Wispkit is the standard two-part structure of a VS Code extension, plus a third part that is **pure logic shared by the host and the front end**:

```text
┌─────────────────── extension host (Node, can reach the vscode API) ─────────────────────────────┐
│ src/extension.ts        activation entry: registers 5 editors + interceptor + 2 commands        │
│ src/*Provider.ts        5 CustomEditorProviders + 1 panel + 1 command provider                  │
│ src/config.ts           reads every wispkit.* setting into a strongly typed object              │
│ src/mediaActions.ts     host side of the media context menu (save as / copy path / copy source) │
│ src/markdown/ src/html/ src/image/ src/xaml/ src/readonly/ src/subtree/ src/media/ src/util/    │
│                         one directory = one feature area, pure logic kept apart from vscode     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
              │  ① generate the HTML string + nonce/CSP   ② postMessage both ways
              ▼
┌────────────────────── webview front end (browser environment, no vscode API) ───────────────────┐
│ media/markdown.js  TOC tree, media context menu, full-screen modal, drawio bridge, edit mode    │
│ media/image.js     wheel zoom / drag pan / double-click fit                                     │
│ media/xaml.js      source highlight overlay, render panzoom, splitter                           │
│ media/readonly.js  the unlock button of the read-only preview                                   │
│ media/subtree.js   tree rendering, sorting, selection, action area, column resizing             │
│ media/shared/      panzoom · lightbox · toc · contextmenu · paragraph (reused components)       │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
              ▲  ③ the same pure logic is shared by both sides (host imports, bundler ships it)
              │
       src/util/  src/media/parse.ts  src/subtree/{columns,sort,wispkitView,fileActions}.ts
       src/readonly/highlight.ts  src/xaml/highlight.ts  src/subtree/iconTheme.ts
```

The third part is the point: these modules **deliberately do not import `vscode`**, so they can be called directly inside the extension host, unit-tested in plain Node, and bundled into the front end by esbuild. They are the best-covered files in this project.

## Extension host layer: module responsibilities

| File | Responsibility |
|---|---|
| `src/extension.ts` | Activation entry. `activate()` pushes 9 disposables at once: the `register()` of 5 editors/panels, the read-only interceptor, the subtree panel, the `wispkitView` command and the `wispkit.openWith` command. Also exports `viewTypeFor(uri)` — decides which view handles a file by extension, shared by `openWith` and the tests |
| `src/config.ts` | Reads and normalises every `wispkit.*` setting. The fields the front end needs (font size, line height, zoom step…) are cut out separately — the **whole configuration object is never handed to the webview** |
| `src/markdownProvider.ts` | The `CustomEditorProvider` of the Markdown view. Aggregates third-party `markdown.previewScripts` / `previewStyles`, feeds nonce/CSP, handles `render` / `save` / media actions / drawio messages |
| `src/mediaActions.ts` | Host side of the media context menu: `Save as…`, `Copy path`, `Copy Markdown source`, `Open in Draw.io` |
| `src/htmlProvider.ts` | The HTML view (`priority: option`): wraps the source into a page with a relaxed CSP and rewrites `vscode://file/` links |
| `src/imageProvider.ts` | The image view (`priority: default`): turns the file into a webview-loadable URI and sends it to the front end |
| `src/xamlProvider.ts` | The XAML view: reads and writes the source, calls the external renderer, sends the PNG back as a data URI or a temp file |
| `src/readonlyProvider.ts` | The read-only text view: reads the file head, truncates by line, and hands it to `readonly/page.ts` to build the highlighted HTML |
| `src/subtreeProvider.ts` | The subtree panel (a webviewPanel, not a custom editor): lazy directory reads, sorting, its own file operations, four shell execution modes. The largest host file in the repo (about 28 KB) |
| `src/wispkitViewProvider.ts` | The `wispkit.wispkitView.open` command: opens the target described by `entry` + `openWith` in `.WispkitView/Wispkit.json` |

## Feature-area directories

| Directory | File | Responsibility |
|---|---|---|
| `src/markdown/` | `contributions.ts` | Walks `vscode.extensions.all` and reads `contributes["markdown.previewScripts"]` / `["markdown.previewStyles"]` as **flat dotted keys**. That is the real VS Code contract, not a nested `markdown: { previewScripts }` |
| | `render.ts` | Calls the built-in hidden command `markdown.api.render` to turn the source into HTML, so third-party `markdownItPlugins` (mermaid, katex) apply automatically |
| | `page.ts` | Builds the HTML skeleton of the Markdown view; only the necessary fields are sent to the front end |
| `src/html/` | `page.ts` | HTML page wrapper: relaxed CSP (inline scripts and http(s) allowed) + `vscode://file/` link rewriting |
| `src/image/` | `page.ts` | The HTML and front-end configuration of the image page |
| `src/xaml/` | `page.ts` | XAML view HTML (source pane + render pane + splitter) |
| | `highlight.ts` | The in-house lightweight XAML / XAML.cs highlighter. The highlight layer is stacked under a `<textarea>`; the textarea's text is transparent so only the caret shows, therefore **the visible characters must be byte-identical to the input** |
| | `renderer.ts` | Calls the separate .NET process; the contract is frozen as `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...` |
| `src/readonly/` | `associations.ts` | Writes the **native** open handler of the text file types into `workbench.editorAssociations`, so VS Code opens them straight into `wispkit.text` |
| | `intercept.ts` | Intercepts files that were already opened by the native editor and swaps in the read-only preview (one tab replacement; see the limitations page) |
| | `state.ts` | Global read-only switch state, applying/removing the associations, the status-bar item |
| | `file.ts` | Decides which types are **not** intercepted (Markdown / HTML / XAML / images — they are already browsing views) |
| | `highlight.ts` | The generic syntax highlighter of the read-only view: zero third-party dependencies, pure functions, unit-testable |
| | `page.ts` | Read-only preview HTML (line numbers + highlighting + floating unlock button) |
| `src/subtree/` | `types.ts` | `TreeEntry` and other **primitive types** crossing into the webview (never `vscode.Uri` / `Date`) |
| | `columns.ts` | The 9 column definitions, order resolution (filter invalid, de-duplicate, fall back to defaults), cell formatting |
| | `sort.ts` | Pure sorting logic per column |
| | `config.ts` | Custom-tool configuration parsing, `${file}/${dir}/${name}/${workspaceFolder}` substitution, command-line assembly |
| | `wispkitView.ts` | `Wispkit.json` parsing, the two lookup locations, `entry` escape checks |
| | `explorerCommands.ts` | Three kinds of actions: **native** (in-house file operations), commands contributed by extensions to `explorer/context` (collected automatically), built-in whitelist commands (validated with `commands.getCommands(true)` before running) |
| | `fileActions.ts` | The **pure logic** part of the in-house file operations (cut/copy/paste/rename/delete/new/compare). They are in-house because the built-in `filesExplorer.*` commands do not accept external URIs |
| | `iconTheme.ts` | **Pure parsing** of icon themes (no `vscode` import), a four-level lookup: `fileNames → fileExtensions → languageIds → file` |
| | `iconThemeHost.ts` | Host-side file reads and URI conversion; builds the extension→language-id bridge from `contributes.languages` for `mergeLanguageIcons` |
| | `page.ts` | The subtree panel HTML; column widths travel through `--wispkit-col-*` variables shared by the header and the rows |
| `src/media/` | `parse.ts` | Source-side media location: maps "the N-th image/diagram on the page" back to that segment of the Markdown source. Pure functions |
| `src/util/` | `csp.ts` | The webview CSP text, mirroring the Strict policy of the built-in Markdown preview (`documentRenderer.ts:275`) |
| | `nonce.ts` | Base64 of 32 random bytes, used as the CSP nonce |
| | `html.ts` | `escapeHtml` / `escapeAttribute` |
| | `linkRewrite.ts` | Rewrites `vscode://file/<path>[:line]` into a `command:` link — the host's `isSupportedLink` only allows http(s), so without the rewrite nothing happens on click |

## One complete data flow: opening a `.md`

1. **VS Code decides who opens it**: `.md` matches the selector of `wispkit.markdown` in `package.json`, and `priority: default`, so it is handed to `MarkdownEditorProvider`.
2. **The host reads configuration**: `config.ts` reads `wispkit.toc.*`, `markdown.preview.*` font size / line height and so on, and cuts out the minimal set the front end needs.
3. **The host aggregates third-party contributions**: `markdown/contributions.ts` scans the `contributes` of every extension, collects the script and style lists, and merges each `extensionUri` into `localResourceRoots` (otherwise those resources cannot load inside the webview).
4. **The host renders the body**: `markdown/render.ts` runs the built-in `markdown.api.render` and gets HTML — this step is what makes the mermaid and katex `markdownItPlugins` apply.
5. **The host builds the page**: `markdown/page.ts` assembles the HTML (injected `<script nonce=...>`, `<link>`, CSP meta, the initial body); `nonce.ts` generates the random nonce.
6. **The webview loads**: `media/markdown.js` receives the body, builds the TOC tree (`shared/toc.js`), binds the media context menu (`shared/contextmenu.js` + `shared/lightbox.js`) and initialises panzoom (`shared/panzoom.js`).
7. **Third-party scripts re-render**: the front end dispatches `vscode.markdown.updateContent` on `window`; the built-in mermaid script uses it to draw `<div class="mermaid">` as an svg.
8. **User interaction → message back**: on "Copy source" the front end sends only `{ action: 'copyText', kind: 'mermaid', index: 0 }`; the host uses `media/parse.ts` to fetch the source by index and writes the clipboard.
9. **Saving (edit mode)**: the front end sends the text; the host replaces the whole document through a `WorkspaceEdit`, which lands on the normal undo stack.

## Design reasons

**Why `CustomEditorProvider` instead of a `webviewPanel`?** Because the extension has to **take over the open handler** — double-clicking `.md` must land in this view. A `webviewPanel` can only be created by a command and cannot win the open handler (Simple Browser is exactly that shape, which is why it cannot be taken over).

**Why does the media context menu report only "index + kind"?** Resource URLs inside a webview are `vscode-webview://` and **cannot be reverse-mapped to a real file path**. Since the front end cannot get the path, it reports only the position, and the host fetches the path and the source from the original text. Images additionally cross-check with `alt`, so an off-by-one index can still be recovered.

**Why go through the hidden `markdown.api.render` command?** Implementing Markdown rendering ourselves would drop third-party `markdownItPlugins` (mermaid and katex depend entirely on it). Using the built-in command means reusing the official pipeline, at the price of depending on an undocumented command.

**Why does read-only mode not create a `TextDocument`?** The goal is precisely "save the load cost". Only `CustomEditorProvider` + reading the file head directly can avoid pulling the whole file into memory; the price is losing the official syntax colouring, which is why `readonly/highlight.ts` implements a generic highlighter instead.

**Why keep pure logic in files that do not import `vscode`?** To make it testable. `src` holds 11,450 lines of TypeScript (5,730 of them tests), 20 test files and 477 cases; a large share of those cases run in plain Node without starting VS Code — which is only possible when parsing, formatting, sorting and highlighting are decoupled from `vscode`.

## Scale

| Item | Value |
|---|---|
| Extension host and pure logic | `src` totals 11,450 lines of TypeScript (5,720 excluding tests) |
| Front end | 15 hand-written files under `media` (including 5 reused components in `shared/`) |
| Tests | 20 test files / 477 cases |
| Native tool shipped with the extension | `tools/xaml-render` (.NET, framework-dependent) |
