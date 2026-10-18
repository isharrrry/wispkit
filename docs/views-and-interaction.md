---
type: Guide
title: Views and interaction
description: UI composition, gestures, shortcuts and message contracts of the five custom editors and the subtree panel
tags: [views, interaction, webview, gestures]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Views and interaction

**English** | [中文](views-and-interaction.zh-CN.md) | [Español](views-and-interaction.es.md)

## Overview

| View | viewType | How it opens | Priority |
|---|---|---|---|
| Markdown browsing | `wispkit.markdown` | double-click `.md` / `.markdown` | `default` (takes over) |
| Image browsing | `wispkit.image` | double-click `.png` `.jpg` `.jpe` `.jpeg` `.bmp` `.gif` `.ico` `.webp` `.avif` | `default` (takes over) |
| HTML browsing | `wispkit.html` | *Reopen Editor With…* / `wispkit.openWith` | `option` (does not compete) |
| XAML browsing | `wispkit.xaml` | double-click `.xaml` | `default` (takes over) |
| Read-only text | `wispkit.text` | automatic once global read-only mode is on | `option` (driven by associations) |
| Subtree panel | `wispkit.subtree` (webviewPanel) | icon on the right of an Explorer folder row / command | not an editor |

The `wispkit.openWith` command picks a view by extension (`viewTypeFor` in `src/extension.ts`); when nothing matches it shows "Wispkit has no view for this file type".

## Markdown view (`wispkit.markdown`)

### Composition

```text
┌──────────┬───────────────────────────────────────────────┐
│ TOC      │ Body (same typography as the built-in preview)│
│ h1..h6   │                                               │
│ (resiz-  │ code blocks / tables / mermaid / drawio /     │
│  able,   │ images                                        │
│  collap- │                                               │
│  sible)  │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### Table of contents

- The tree is built from `h1..h6` **inside the webview** and does **not** depend on `data-line` source mapping — therefore no editor↔preview scroll-sync protocol is needed.
- The current section is highlighted while scrolling; clicking an entry jumps to it and focuses it.
- The pane width is draggable and **double-clicking the splitter resets it**; it can be collapsed in one click (the body then takes the full width).
- The depth listed is bounded by `wispkit.toc.depth` (default 3) and the whole pane can be turned off with `wispkit.toc.enabled`.

### Media context menu

| Right-clicked object | Menu items | What happens on click |
|---|---|---|
| Ordinary image | Zoom in / Save as… / Copy path / Copy Markdown text | Save as goes through the system save dialog; copy path takes the absolute path; copy Markdown text takes the `![alt](src)` from the source |
| mermaid diagram | Zoom in / Save as SVG… / Copy source | Copy source takes the text inside the ` ```mermaid ` fence |
| drawio diagram | Zoom in / **Open in Draw.io editor** / Save as SVG… / Copy source | see the next section |

"Zoom in" is a **modal that fills the main window**, supporting wheel zoom and right-button drag pan (the same panzoom implementation as the image view); `Esc` or clicking the backdrop closes it.

The front end reports only `{ action, kind, index, alt?, src? }`; **the real path and the source are fetched by the host from the original Markdown** (`src/media/parse.ts`, pure functions, 20 unit tests). Images additionally cross-check with `alt`, so an off-by-one index can still be recovered.

### drawio in-place editing

The drawio extension 1.17.0 has already handed editing to the new Markdown editor (`markdown.codeBlockEditorProviders`); the custom editor has no such host, so Wispkit wires it itself:

1. locate the code block from the index reported by the front end and extract the XML content;
2. write it to a temporary `.drawio` file;
3. open it with `vscode.openWith(..., 'hediet.vscode-drawio-text')`;
4. on save, **re-locate by content** and write back — even if the document was edited elsewhere in the meantime, the replacement never lands in the wrong place.

### Edit mode (in-place paragraph editing)

The "Edit" control in the toolbar is a sliding switch (`role="switch"`, whose state is expressed **only** by `aria-checked`). Once on, **clicking any paragraph in the body** turns that paragraph into a `<textarea>` in place, while the other paragraphs stay rendered — no split pane, no second editor.

| Action | Behaviour |
|---|---|
| Single click on a paragraph | That paragraph becomes an edit box in place, holding the Markdown source of that paragraph (verbatim, no separator blank lines added) |
| `Enter` | Inserts a blank line (`\n\n`) — a single newline is only a soft break in CommonMark, so the blank line is what actually splits the paragraph |
| `Shift+Enter` | Soft break inside the paragraph, stays in the same paragraph |
| `Ctrl+Enter` (`Cmd+Enter` on macOS) | Commits the current paragraph: writes back the whole source and saves immediately |
| `Esc` | Discards the changes of the current paragraph |
| `Ctrl+S` (`Cmd+S` on macOS) | Saves the whole document; an uncommitted edit box is committed first |

The mapping is based on the `data-line` (start line) the built-in engine attaches to every block-level token. The end line of a paragraph is inferred as **the start line of the next block minus one**, with the total source line count as the fallback for the last paragraph; intervals are half-open `[start, end)`. This layer is pure functions (`media/shared/paragraph.js`) with unit tests — nested structures (list items, blockquotes, inside code blocks) are the least precise part of this scheme.

Saving goes through a `WorkspaceEdit` that replaces the whole document and lands on the normal undo stack. The full source is requested from the host **only when entering edit mode** (`wispkit.requestSource`), so pure preview never carries that cost.

### Message contract

| Front end → host | Payload | Host replies |
|---|---|---|
| `wispkit.requestSource` | none | the source text |
| `wispkit.render` | `requestId`, `text` | `{ requestId, html }` (the host keeps the branch; after a paragraph commit the re-render comes from `onDidChangeTextDocument`, the front end no longer sends it) |
| `wispkit.save` | `requestId`, `text` | `wispkit.saveResult { requestId, ok }` |
| `wispkit.media` | `action`, `kind` (`image`/`mermaid`/`drawio`), `index`, `alt?`, `src?`, `data?` | none (the host executes it itself) |

### Typography

The font family, size and line height of the built-in `markdown.css` read the variables `--markdown-font-family` / `--markdown-font-size` / `--markdown-line-height`. Wispkit feeds the `markdown.preview.*` settings into them, so the body matches the built-in preview character for character.

The conversion copies the built-in one (`documentRenderer.ts:211-213`): `fontSize` is suffixed with `px`, while `lineHeight` is **emitted as-is** (a number means a multiple of the font size; the built-in default is 1.6). Suffixing `lineHeight` with `px` makes the line height `1.6px`, and the body, code blocks and table of contents all overlap — that is a pit this project actually hit, and `src/test/markdownPage.test.ts` carries a regression assertion for it. Do **not** write the `font` shorthand on `body`: it would override those three variables.

## Image view (`wispkit.image`)

| Gesture | Behaviour |
|---|---|
| Wheel | Zooms directly (no Ctrl), anchored at the **cursor position**, so the view centre does not jump; with `wispkit.image.wheelZoom=false` it falls back to "Ctrl required" |
| Hold `wispkit.image.dragButton` (right button by default) and drag | Pans |
| Double-click | Toggles between "fit to window" and "100%" |
| Zoom ≥ 3× | Rendering switches to `pixelated` so it does not blur into a smear |

The zoom step comes from `wispkit.zoom.wheelStep` (default 1.1); the same panzoom is also used by the Markdown modal and the XAML render.

## HTML view (`wispkit.html`)

- Uses a **relaxed CSP**: inline scripts and http(s) resources are allowed — browsing HTML inherently needs the page's own scripts to run.
- Rewrites `href="vscode://file/<path>[:<line>]"` into `command:vscode.open?<args>` and enables `enableCommandUris` on the webview. **The front end contains no script at all**: the click is reported by the webview shell, and the rewritten link opens in the current window without going through the system protocol handler.
- Unrewritten `vscode://` links are also on the host allow-list, so both paths work.

## XAML view (`wispkit.xaml`)

### UI

Source pane on the left (editable) and the rendered image on the right, with a draggable splitter in between. The source pane can be hidden (`wispkit.xaml.codeVisible`) and its width is controlled by `wispkit.xaml.codeWidth` (default 460 px).

- The source area has an **in-house lightweight highlighter**: the highlight layer is stacked under a `<textarea>` whose text is transparent so only the caret shows, therefore the output must be **byte-identical** to the input (one missing or extra character and the caret drifts).
- The rendered image supports wheel zoom and drag pan; clicking it opens a full-screen modal.
- After editing, saving writes back to the original `.xaml` file.

### Render call chain

1. Search **upwards level by level** from the directory of the `.xaml` for `bin/(Release|Debug)/<tfm>/*.dll`;
2. call the external .NET process; the contract is frozen as `<renderer> render <in.xaml> <out.png> [--assembly <dll>]...`;
3. the renderer tries root types in order — `--class` (not passed by this extension) → the XAML's `x:Class` → **the WPF base class of the root element** (`<Window>` → `System.Windows.Window`, `<UserControl>` → …); each candidate is paired with two text variants ("as-is" and "with `x:Class` and event handlers stripped"), then `XamlObjectWriterSettings.RootObjectInstance` lets the XAML fill that instance (`mode=rootObjectInstance`). Real window constructors usually depend on DI or App singletons and cannot be `new`-ed, so **base-class hosting is the main path**; only when every candidate fails does it fall back to `XamlReader.Parse` (`mode=parse`);
4. the resulting PNG is sent back to the page.

When rendering fails, the page shows an error panel with common causes instead of a blank screen.

## Read-only text view (`wispkit.text`)

- Once global read-only mode is on, `.ts` / `.json` / `.txt` / `.log` and others (decided by `wispkit.readonly.extensions`) open as a read-only preview.
- Only the **first N bytes of the file** are read (`wispkit.readonly.previewBytes`, default 64 KB), then truncated by line (`wispkit.readonly.previewLines`, default 800).
- The page has line numbers and an **in-house generic syntax highlighter** (comment / string / number / keyword level, not TextMate-accurate colouring).
- A floating "unlock editing" button at the bottom right opens the file in the native editor (editable) and lets that file through for the rest of the session.
- The browsing views Wispkit already owns (Markdown / HTML / XAML / images) **are not affected by read-only mode** — they are browsing views already, and truncating Markdown would render a broken result.

## Subtree panel (`wispkit.subtree`)

### How it opens

Each **folder row** in the Explorer has two icons on its right: "Show" on the left (`wispkit.wispkitView.open`) and "Browse subtree" on the right (`wispkit.subtree.open`). Both commands appear only when the row is a folder, and neither appears in the command palette.

**The same folder reuses the same panel**: clicking again only reveals the existing panel instead of opening a pile of them.

### UI

```text
┌────────────────────────────────────────────────────────┐
│ Header: Name | Size | Type | Modified | Created | Owner│
├────────────────────────────────────────────────────────┤
│ ▸ FolderA                                              │
│   ▸ FolderB                                            │
│     file.txt                                           │
├────────────────────────────────────────────────────────┤
│ Action area (right): file ops (cut/copy/paste/rename/  │
│            delete/new/compare)                         │
│            extension commands (with source badge) ·    │
│            custom tools                                │
└────────────────────────────────────────────────────────┘
```

- **Lazy loading**: a level is read only when it is expanded; the whole tree is never walked at once.
- **Configurable columns**: rendered strictly in the order of `wispkit.subtree.columns`; header and data rows share the `--wispkit-col-*` variables so they stay aligned. Unavailable properties show `-` instead of crashing (`atime` and POSIX permission bits are always `-`).
- **Sorting**: click a header to sort by that column; the pure logic lives in `src/subtree/sort.ts`.

### The three kinds of actions in the action area

| Kind | Source | Notes |
|---|---|---|
| File operations (native) | built into Wispkit | cut / copy / paste / rename / delete / new file / new folder / compare. **It has to be in-house**: the built-in `filesExplorer.*` commands do not accept external URIs |
| Extension-contributed commands | collected automatically | walks `contributes.menus['explorer/context']` of the installed extensions and checks the command exists before running it |
| Built-in whitelist | listed by hand | validated with `commands.getCommands(true)` before running; if missing it says so instead of staying silent |
| Custom tools | `wispkit.subtree.tools` | supports `${file}` `${dir}` `${name}` `${workspaceFolder}`; four execution modes below |

| `shell` | Behaviour |
|---|---|
| `silent` | runs in the background, no window |
| `currentTerminal` | writes into the active terminal |
| `newTerminal` | creates a terminal and writes into it |
| `external` | starts a system terminal window as a detached process |

**The target is the row selected in the panel, not the row selected in the Explorer** — every button in the action area acts on the row currently selected in the subtree panel.

### Message contract

| Front end → host | Notes |
|---|---|
| `wispkit.subtree.read` | read one directory level (lazy loading) |
| `wispkit.subtree.sort` | sort by column |
| `wispkit.subtree.command` | run an extension or built-in command |
| `wispkit.subtree.fileAction` | file operation, branches `cut` / `copy` / `paste` / `rename` / `delete` / `newFile` / `newFolder` / `compare` |
| `wispkit.subtree.tool` | run a custom tool |
| `wispkit.subtree.open` | open or reveal an entry |

## Shared interaction components

| File | Used by | Responsibility |
|---|---|---|
| `media/shared/panzoom.js` | image view, Markdown modal, XAML render | wheel zoom (cursor anchor) + drag pan + double-click fit |
| `media/shared/lightbox.js` | Markdown modal | full-screen backdrop, `Esc` to close |
| `media/shared/toc.js` | Markdown view | build the tree, highlight the current section, collapse |
| `media/shared/contextmenu.js` | Markdown / subtree | menu positioning, hit testing, closing |
| `media/shared/paragraph.js` | Markdown edit mode | paragraph ↔ source-line mapping and slicing |
