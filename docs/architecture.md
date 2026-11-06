---
type: Guide
title: Architecture
description: The three layers of Wispkit, the responsibility of every module, one complete data flow, the host/webview split of 3D visualization, the custom resource tree layering and the key design trade-offs
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
│ src/extension.ts        activation entry: 7 editors + read-only interceptor + panels + 2 commands │
│ src/*Provider.ts        7 CustomEditorProviders + 2 webviewPanels + resource tree + command provider │
│ src/config.ts           reads every wispkit.* setting into a strongly typed object              │
│ src/mediaActions.ts     host side of the media context menu (save as / copy path / copy source) │
│ src/graph3dProvider.ts  3D panel: reads Markdown / Mermaid, extracts elements, sends the payload │
│ src/mermaidProvider.ts  .mmd view: built-in Mermaid rendering + source / 3D entries             │
│ src/mermaid/            .mmd page skeleton and status (pure logic + HTML)                       │
│ src/graph3d/            ASCII / Mermaid parsing, element extraction, merge, 3D layout (pure)    │
│ src/markdown/ src/html/ src/image/ src/xaml/ src/readonly/ src/subtree/ src/media/ src/util/    │
│                         one directory = one feature area, pure logic kept apart from vscode     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
              │  ① generate the HTML string + nonce/CSP   ② postMessage both ways
              ▼
┌────────────────────── webview front end (browser environment, no vscode API) ───────────────────┐
│ media/markdown.js  TOC tree, media context menu, full-screen modal, drawio bridge, edit mode    │
│ media/mermaid.js   .mmd toolbar: source / 3D / refresh; notifies the built-in script on update  │
│ media/image.js     wheel zoom / drag pan / double-click fit                                     │
│ media/video.js     native <video>, system-player and copy-path toolbar                          │
│ media/xaml.js      source highlight overlay, render panzoom, splitter                           │
│ media/readonly.js  the unlock button of the read-only preview                                   │
│ media/subtree.js   tree rendering, sorting, selection, action area, column resizing             │
│ media/graph3d.js   three.js 3D scene, bubbles / text sprites / edges, split panes and merging   │
│ media/shared/      panzoom · lightbox · toc · contextmenu · paragraph (reused components)       │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
              ▲  ③ the same pure logic is shared by both sides (host imports, bundler ships it)
              │
       src/util/  src/media/{parse,formats,csp}.ts  src/subtree/{columns,sort,wispkitView,fileActions}.ts
       src/readonly/highlight.ts  src/xaml/highlight.ts  src/subtree/iconTheme.ts
       src/graph3d/{ascii,mermaid,markdownElements,merge,layout,selection,types}.ts
       src/resourceTree/{model,paths,storageCore,transfer,presentation}.ts
```

The third part is the point: these modules **deliberately do not import `vscode`**, so they can be called directly inside the extension host, unit-tested in plain Node, and bundled into the front end by esbuild. They are the best-covered files in this project.

## Extension host layer: module responsibilities

| File | Responsibility |
|---|---|
| `src/extension.ts` | Activation entry. `activate()` pushes **14 disposables** at once: the `register()` of 7 custom editors, the read-only interceptor, the subtree panel, the 3D panel, the resource tree, the storage view, the `wispkitView` command and the `wispkit.openWith` command. Also exports `viewTypeFor(uri)` — decides which view handles a file by extension, shared by `openWith` and the tests |
| `src/config.ts` | Reads and normalises every `wispkit.*` setting. The fields the front end needs (font size, line height, zoom step…) are cut out separately — the **whole configuration object is never handed to the webview** |
| `src/markdownProvider.ts` | The `CustomEditorProvider` of the Markdown view. Aggregates third-party `markdown.previewScripts` / `previewStyles`, feeds nonce/CSP, handles `render` / `save` / media actions / drawio messages |
| `src/mermaidProvider.ts` | The `CustomTextEditorProvider` of the Mermaid file view (`.mmd` / `.mermaid`): hands the whole source to the built-in Mermaid preview script and handles refresh / open source / 3D; degrades to source mode without a preview script |
| `src/mediaActions.ts` | Host side of the media context menu: `Save as…`, `Copy path`, `Copy Markdown source`, `Open in Draw.io` |
| `src/htmlProvider.ts` | The HTML view (`priority: default`): wraps the source into a page with a relaxed CSP, rewrites `vscode://file/` links and injects the link router (`media/dist/html.js`) |
| `src/imageProvider.ts` | The image view (`priority: default`): turns the file into a webview-loadable URI and sends it to the front end; `wispkit.media.openExternal` and `wispkit.media.copyPath` messages back the fallback panel for formats the runtime cannot decode |
| `src/videoProvider.ts` | The video view (`priority: default`): wraps the file in a native `<video>` page with a `media-src` CSP; the same two host messages power the system-player / copy-path buttons |
| `src/xamlProvider.ts` | The XAML view: reads and writes the source, calls the external renderer, sends the PNG back as a data URI or a temp file |
| `src/readonlyProvider.ts` | The read-only text view: reads the file head, truncates by line, and hands it to `readonly/page.ts` to build the highlighted HTML |
| `src/subtreeProvider.ts` | The subtree panel (a webviewPanel, not a custom editor): lazy directory reads, sorting, its own file operations, four shell execution modes. The largest host file in the repo (about 28 KB) |
| `src/graph3dProvider.ts` | The 3D panel (`wispkit.graph3d`, a webviewPanel): reads the Markdown / Mermaid source, calls `extractElementsForSource` by extension, builds a page with strict CSP / nonce and puts the graph-element payload into a `<meta>` tag; handles `wispkit.graph3d.refresh`. Re-opening the same file only reveals the existing panel (`Graph3dPanels` keyed by URI) |
| `src/resourceTreeProvider.ts` | Custom resource management (`wispkit.resourceTree`, a TreeView, not a webview): implements `TreeDataProvider` + `TreeDragAndDropController`, registers the 13 `wispkit.resourceTree.*` commands plus configuration / workspace listeners; every change goes through the pure data layer and is then written atomically to a workspace JSON file |
| `src/wispkitViewProvider.ts` | The `wispkit.wispkitView.open` command: opens the target described by `entry` + `openWith` in `.WispkitView/Wispkit.json` |

## Feature-area directories

| Directory | File | Responsibility |
|---|---|---|
| `src/markdown/` | `contributions.ts` | Walks `vscode.extensions.all` and reads `contributes["markdown.previewScripts"]` / `["markdown.previewStyles"]` as **flat dotted keys**. That is the real VS Code contract, not a nested `markdown: { previewScripts }` |
| | `render.ts` | Calls the built-in hidden command `markdown.api.render` to turn the source into HTML, so third-party `markdownItPlugins` (mermaid, katex) apply automatically |
| | `page.ts` | Builds the HTML skeleton of the Markdown view; only the necessary fields are sent to the front end |
| `src/html/` | `page.ts` | HTML page wrapper: relaxed CSP (inline scripts and http(s) allowed) + `vscode://file/` link rewriting + link-router script injection |
| `src/image/` | `page.ts` | The HTML and front-end configuration of the image page, including the decode-failure fallback panel |
| `src/video/` | `page.ts` | The video page skeleton: native `<video>`, toolbar (system player / copy path) and the unsupported-container panel |
| `src/xaml/` | `page.ts` | XAML view HTML (source pane + render pane + splitter) |
| | `highlight.ts` | The in-house lightweight XAML / XAML.cs highlighter. The highlight layer is stacked under a `<textarea>`; the textarea's text is transparent so only the caret shows, therefore **the visible characters must be byte-identical to the input** |
| | `renderer.ts` | Calls the separate .NET process; the contract is frozen as `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...` |
| `src/readonly/` | `associations.ts` | Writes the **native** open handler of the text file types into `workbench.editorAssociations`, so VS Code opens them straight into `wispkit.text` |
| | `intercept.ts` | Intercepts files that were already opened by the native editor and swaps in the read-only preview (one tab replacement; see the limitations page) |
| | `state.ts` | Global read-only switch state, applying/removing the associations, the status-bar item |
| | `file.ts` | Decides which types are **not** intercepted (Markdown / HTML / XAML / images / videos — they are already browsing views; the regex is built from `media/formats.ts`) |
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
| `src/resourceTree/` | `model.ts` | The **pure data layer** of the resource tree (imports neither `vscode` nor `fs`): `group` / `folder` nodes, parsing and sanitising, serialisation, add/remove/move/rename, cycle detection, id and node / depth caps |
| | `paths.ts` | Stored path ↔ absolute path: `${workspaceFolder}` / `${workspaceFolder:name}` / `${workspaceFolder:index}`, absolute paths outside the workspace, Windows case normalisation |
| | `storageCore.ts` | **Pure** storage logic: configuration resolution and invalid-value diagnostics, UTF-8 BOM decoding, temporary sibling paths, `writeFileAtomically` |
| | `storage.ts` | Host adapter: maps the resolution to a `vscode.Uri` (preserving remote / virtual workspace schemes), `workspace.fs` reads and writes plus atomic writes |
| | `transfer.ts` | Import plan `planImport`: reject invalid files, summarise repair warnings, build the replacement confirmation text |
| | `presentation.ts` | TreeItem presentation contract: folder state (directory / missing / file / unresolved), description / tooltip text, click command |
| `src/graph3d/` | `types.ts` | Pure data types for graph elements / nodes / edges / groups / merge results, plus the kind labels |
| | `markdownElements.ts` | Extracts graph elements from Markdown: fences / bare ASCII trees in the body, names from titles and headings, `(2)` suffixes for duplicates, `MAX_ELEMENTS` 200 |
| | `ascii.ts` | Unicode / ASCII tree parsing: connectors, indent levels, wrapped-line merging, `MAX_NODES` 600 |
| | `mermaid.ts` | Mermaid topology subset parser: 12 diagram kinds + a generic line-chain fallback, `MAX_NODES` 600 |
| | `mermaidFile.ts` | Standalone `.mmd` / `.mermaid` files: one element per file, named after `title` then the file name |
| | `sources.ts` | Dispatches Markdown multi-element vs Mermaid single-element parsing by extension, shared by the host and tests |
| | `merge.ts` | Merges same-name nodes across the left and right elements, remaps right-side ids / groups, de-duplicates edges |
| | `layout.ts` | 3D layout: radial tree, SCC-collapsed layers, deterministic force-directed, compact layered, Louvain shell FR-3D, merged-graph mutex separation, sequence, quadrant, `void` dangling placeholders; pure functions with reproducible output |
| | `selection.ts` | Restores the left/right selections after a refresh (keeps "(none)", finds by id then name) |
| | `page.ts` | 3D page skeleton, CSP, nonce, payload `<meta>` |
| `src/mermaid/` | `page.ts` | The `.mmd` / `.mermaid` page skeleton: toolbar, status badge, diagram / source bodies |
| | `status.ts` | Reuses the `graph3d/mermaid.ts` parse result for the badge and the 3D entry (kind / nodes / edges) |
| `src/media/` | `parse.ts` | Source-side media location: maps "the N-th image/diagram on the page" back to that segment of the Markdown source. Pure functions |
| | `formats.ts` | The single source of truth for image / video extensions, `fileExtension`, vector detection and native-decode classification. Pure functions |
| | `csp.ts` | CSP text of the image and video views (`img-src` / `media-src`). Pure functions |
| | `webview.ts` | Shared host helpers: `localResourceRoots` for media files, clipboard path, and the whitelisted `openExternal` / `copyPath` message handling |
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
6. **The webview loads**: `media/markdown.js` receives the body, builds the TOC tree (`shared/toc.js`), applies the body zoom step (`shared/pagezoom.js`), wires Ctrl+F find (`shared/find.js`), binds the media context menu (`shared/contextmenu.js` + `shared/lightbox.js`) and initialises panzoom (`shared/panzoom.js`).
7. **Third-party scripts re-render**: the front end dispatches `vscode.markdown.updateContent` on `window`; the built-in mermaid script uses it to draw `<div class="mermaid">` as an svg.
8. **User interaction → message back**: on "Copy source" the front end sends only `{ action: 'copyText', kind: 'mermaid', index: 0 }`; the host uses `media/parse.ts` to fetch the source by index and writes the clipboard.
9. **Saving (edit mode)**: the front end sends the text; the host replaces the whole document through a `WorkspaceEdit`, which lands on the normal undo stack.

## The host/webview split of 3D visualization

The 3D panel is deliberately built as "the host only provides data, the front end only draws":

| Layer | Does | Does not |
|---|---|---|
| Host (`src/graph3dProvider.ts`) | reads the Markdown with `workspace.openTextDocument`; calls `extractGraphElements(text)` to get `GraphElement[]` (id, name, kind, language, start line, source, nodes, edges, groups, degradation notes); serialises `{ fileName, filePath, elements }` to JSON, HTML-escapes it and puts it into `<meta id="wispkit-3d-data" data-wispkit>` | does not touch three.js, does not lay out, does not build script strings |
| Webview (`media/graph3d.js`) | reads the payload from `<meta>`; selects / merges left and right; calls the pure `layoutGraph` for coordinates; draws bubbles, text sprites, edges and arrows with three.js + OrbitControls | does not read files, does not access the `vscode` API |

`extractGraphElements` and `layoutGraph` import neither `vscode` nor three nor the DOM, so the host and the webview share the same code and it can be unit-tested directly in mocha. Diagram parsing, ASCII tree parsing, same-name merging and layout strategy all live in that layer; the front end only handles selection, the camera and drawing.

**Bundling three.js**: `media/graph3d.js` imports `* as THREE` and `OrbitControls` directly; esbuild bundles three.js, OrbitControls and `src/graph3d/*` into `media/dist/graph3d.js`. It is the only bundle with `minify: true` (a large dependency plus hand-written code) and currently weighs about **603 KB**; the other 6 webview bundles stay unminified for easier debugging. There is no CDN or network request at runtime.

**CSP / nonce**: the page reuses the strict policy of the built-in Markdown preview (the same `src/util/csp.ts`): `default-src 'none'`; `script-src 'nonce-<random>'` (no `unsafe-inline`); `style-src` / `img-src` / `font-src` allow `cspSource`, `https:` and `data:` (styles also allow `'unsafe-inline'`). The `<script>` tag carries the same nonce, and the graph-element data lives only in an escaped `data-*` attribute — no inline script is generated. Styles arrive through the webview URI of `media/graph3d.css`.

**File structure**:

| Path | Responsibility |
|---|---|
| `src/graph3dProvider.ts` | panel lifecycle, command registration, file reads, refresh messages |
| `src/graph3d/markdownElements.ts` | extract graph elements from Markdown: fences / bare body trees, naming and de-duplication, `MAX_ELEMENTS` |
| `src/graph3d/ascii.ts` | Unicode / ASCII tree parsing |
| `src/graph3d/mermaid.ts` | Mermaid topology subset parser (all kinds + generic fallback, `MAX_NODES`) |
| `src/graph3d/merge.ts` | same-name node merge of the left and right elements |
| `src/graph3d/layout.ts` | 3D layout: tree / layered (SCC collapse) / force-directed / compact layered / Louvain / merged-graph mutex separation / sequence / quadrant |
| `src/graph3d/selection.ts` | restores the left/right selections after refresh |
| `src/graph3d/page.ts` | page skeleton, CSP, nonce, payload meta |
| `src/graph3d/types.ts` | pure data types for graph elements / nodes / edges / groups / merge results |
| `media/graph3d.js` · `.css` | front-end interaction and styles |
| `media/dist/graph3d.js` | esbuild output (including three.js) |

**One 3D data flow**:

1. The user right-clicks a `.md` in the Explorer (or runs `wispkit.graph3d.open` from the command palette).
2. The host reads the source with `workspace.openTextDocument`; `extractGraphElements` parses it into `GraphElement[]`.
3. The host creates the `wispkit.graph3d` webviewPanel, generates nonce / CSP / resource URIs and puts the payload into `<meta>`.
4. `media/graph3d.js` reads the payload and selects the first element on the left; the user may select a right element.
5. On every selection / merge / spacing change the front end calls `layoutGraph` (pure functions) for node and edge coordinates, then has three.js rebuild the scene.
6. Clicking Refresh sends `wispkit.graph3d.refresh`; the host re-reads the file and replies with `wispkit.graph3d.elements`; on failure it replies `wispkit.graph3d.error`.

## The layering of custom resource management

Resource management follows the same interaction model as drawcode's assembly tree: **`TreeDataProvider` + `TreeDragAndDropController`**, view-title / item-context commands, internal drags and drops from the Explorer. Only storage differs: drawcode keeps its tree in `workspaceState`, while Wispkit must let users edit it externally, export it, import it and reload it with Refresh, so it lives in a plain JSON file inside the workspace.

| Layer | File | Depends on | Responsibility |
|---|---|---|---|
| Host / view | `src/resourceTreeProvider.ts` | `vscode` | implements `TreeDataProvider` and `TreeDragAndDropController`; creates the `TreeView` (`showCollapseAll`); registers the 13 commands; reloads on configuration / workspace changes; commits pure-logic results as one atomic write |
| Pure data layer | `src/resourceTree/model.ts` | nothing (imports neither `vscode` nor `fs`) | node types, parsing and sanitising, serialisation, add/remove/move/rename, cycle detection, id and node / depth caps |
| Path layer | `src/resourceTree/paths.ts` | `node:path` | stored path ↔ absolute path: workspace placeholders, absolute paths outside the workspace, case normalisation |
| Pure storage logic | `src/resourceTree/storageCore.ts` | `node:path` | configuration resolution and invalid-value diagnostics, UTF-8 BOM decoding, temporary sibling paths, atomic writes |
| Storage host adapter | `src/resourceTree/storage.ts` | `vscode` | maps the resolution to a `vscode.Uri` (preserving remote / virtual workspace schemes), `workspace.fs` reads and writes plus atomic writes |
| Import / export | `src/resourceTree/transfer.ts` | `model` | `planImport`: reject invalid files, summarise repair warnings, build the replacement confirmation text |
| Folder-state cache | `src/resourceTree/folderStateCache.ts` | `node:path` | `directory` / `file` / `missing` cache with 30 s TTL, LRU cap (2000), in-flight dedupe and a concurrency-limited stat queue (8) |
| Presentation contract | `src/resourceTree/presentation.ts` | types only | folder state (including `unknown` before the async check returns), description / tooltip text, click command |

**One resource-tree data flow**:

1. `registerResourceTree` creates the `TreeView` and the `ResourceTreeProvider`, registering the `wispkit.resourceTree.*` commands, the configuration listener and the workspace-folder listener.
2. Start / refresh: `currentStorageResolution()` resolves `wispkit.resourceTree.file` with `storageCore.resolveStoragePath` (default: the first workspace's `.WispkitView/resource-tree.json`) → `readStore` calls `stat` first; a missing file yields an empty tree, while a directory / permission error / invalid JSON yields an `error`.
3. `model.parseStoreJson` parses and sanitises: unknown types, folders without `path`, duplicate ids and over-limit / too-deep nodes all become `warnings`; when there is an `error` the current tree is **not replaced** and nothing is written.
4. The `TreeView` pulls `getChildren`; `presentation` pure functions decide each item's state, description and click command. Folder states are prefetched asynchronously with `workspace.fs.stat` and cached (30 s TTL, at most 2000 entries, 8 concurrent checks); `getTreeItem` only reads the cache, so it never blocks on synchronous disk IO.
5. Add / remove / move / drag: the provider calls the pure `model` functions to obtain a **new immutable store** (the old one is untouched), then `commit` → `serializeStore` → `writeTextAtomically` (temporary sibling file + `rename`) → on success it swaps the in-memory tree and calls `fire()`; on failure the in-memory tree keeps the old value.
6. Import: `planImport` first decides whether the file can be imported and produces the warning / confirmation text; only after confirmation does the command layer call `replaceStore`. Export reuses `serializeStore` and the same atomic write.
7. External edits: there is no file watcher, so the user clicks Refresh and steps 2–4 run again; changing `wispkit.resourceTree.file` and workspace-folder changes also trigger a reload.

**Why not `workspaceState`?** The requirement is "externally editable, exportable, importable, reloadable with Refresh". `workspaceState` is private extension storage that users cannot see or edit; a plain JSON file in the workspace turns all of that into ordinary file operations while keeping drawcode's tree interaction. The price is having to handle concurrent edits, broken files and atomic writes ourselves (see [known limitations](limitations.md#19-virtual-groups-have-no-disk-counterpart)).

## Design reasons

**Why `CustomEditorProvider` instead of a `webviewPanel`?** Because the extension has to **take over the open handler** — double-clicking `.md` must land in this view. A `webviewPanel` can only be created by a command and cannot win the open handler (Simple Browser is exactly that shape, which is why it cannot be taken over).

**Why does the media context menu report only "index + kind"?** Resource URLs inside a webview are `vscode-webview://` and **cannot be reverse-mapped to a real file path**. Since the front end cannot get the path, it reports only the position, and the host fetches the path and the source from the original text. Images additionally cross-check with `alt`, so an off-by-one index can still be recovered.

**Why go through the hidden `markdown.api.render` command?** Implementing Markdown rendering ourselves would drop third-party `markdownItPlugins` (mermaid and katex depend entirely on it). Using the built-in command means reusing the official pipeline, at the price of depending on an undocumented command.

**Why does read-only mode not create a `TextDocument`?** The goal is precisely "save the load cost". Only `CustomEditorProvider` + reading the file head directly can avoid pulling the whole file into memory; the price is losing the official syntax colouring, which is why `readonly/highlight.ts` implements a generic highlighter instead.

**Why keep pure logic in files that do not import `vscode`?** To make it testable. `src` holds 39,534 lines of TypeScript (16,202 of them tests), 70 test files and 1149 cases; a large share of those cases run in plain Node without starting VS Code — which is only possible when parsing, formatting, sorting, highlighting and layout are decoupled from `vscode`.

**Why does 3D not reuse Mermaid's renderer?** Mermaid outputs 2D SVG, which cannot be turned directly into a rotatable 3D scene; 3D needs the topology (who connects to whom), not the styling. Wispkit parses only the topology and lays it out itself, trading visual parity with Mermaid themes for offline operation, zero CDN and a unit-testable layout (see [known limitations](limitations.md#15-3d-visualization-parses-topology-not-the-mermaid-rendering)).

## Scale

| Item | Value |
|---|---|
| Extension host and pure logic | `src` totals 22,816 lines of TypeScript (13,093 excluding tests) |
| Front end | 22 hand-written files under `media` (including 6 reused components in `shared/`) + 7 esbuild outputs |
| Tests | 70 test files / 1149 cases |
| Native tool shipped with the extension | `tools/xaml-render` (.NET, framework-dependent) |
