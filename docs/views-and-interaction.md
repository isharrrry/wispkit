---
type: Guide
title: Views and interaction
description: UI composition, gestures, shortcuts and message contracts of the nine custom editors, the custom resource tree, the subtree panel and the 3D visualization panel
tags: [views, interaction, webview, gestures]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
---

# Views and interaction

**English** | [中文](views-and-interaction.zh-CN.md) | [Español](views-and-interaction.es.md)

## Overview

| View | viewType | How it opens | Priority |
|---|---|---|---|
| Markdown browsing | `wispkit.markdown` | double-click `.md` / `.markdown` | `default` (takes over) |
| Image browsing | `wispkit.image` | double-click `.png` `.jpg` `.jpe` `.jpeg` `.jfif` `.bmp` `.gif` `.ico` `.webp` `.avif` `.apng` `.svg` `.heic` `.heif` `.tif` `.tiff` `.jxl` | `default` (takes over) |
| Video browsing | `wispkit.video` | double-click `.mp4` `.m4v` `.mov` `.webm` `.ogv` `.mkv` `.avi` `.wmv` `.flv` `.mpg` `.mpeg` `.m2ts` `.3gp` `.3g2` `.rm` `.rmvb` | `default` (takes over) |
| HTML browsing | `wispkit.html` | double-click `.html` / `.htm`; *Reopen Editor With…* / `wispkit.openWith` | `default` (takes over) |
| XAML browsing | `wispkit.xaml` | double-click `.xaml` | `default` (takes over) |
| Read-only text | `wispkit.text` | automatic once global read-only mode is on | `option` (driven by associations) |
| Windows shortcut | `wispkit.shellLink` | *Reopen Editor With…* / `wispkit.openWith`; also opened by `wispkit.shellLink.openBehavior` | `option` (explicit switch) |
| Executable | `wispkit.executable` | *Reopen Editor With…* / `wispkit.openWith`; also opened by `wispkit.executable.openBehavior` | `option` (explicit switch) |
| Custom resource management | `wispkit.resourceTree` (TreeView) | Wispkit icon in the Activity Bar → "Custom resource management" | not an editor |
| Subtree panel | `wispkit.subtree` (webviewPanel) | icon on the right of an Explorer folder row / command | not an editor |
| Mermaid browsing | `wispkit.mermaid` | double-click `.mmd` / `.mermaid` | `default` (takes over) |
| 3D visualization browsing | `wispkit.graph3d` (webviewPanel) | right-click `.md` / `.markdown` / `.mmd` / `.mermaid` in the Explorer → "3D visualization browsing"; or the command palette | not an editor |

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

Toolbar icons are an inline SVG sprite: each icon carries `width` / `height` attributes as a fallback, and a minimal set of critical styles is inlined before the external stylesheets. Opening a Markdown file therefore never flashes "huge icons that then jump back to normal".

### Table of contents

- The tree is built from `h1..h6` **inside the webview** and does **not** depend on `data-line` source mapping — therefore no editor↔preview scroll-sync protocol is needed.
- The current section is highlighted while scrolling; clicking an entry jumps to it and focuses it.
- The pane width is draggable and **double-clicking the splitter resets it**; it can be collapsed in one click (the body then takes the full width).
- All six heading levels the Markdown spec supports (`h1..h6`) are listed by default; `wispkit.toc.depth` narrows that (default 6) and `wispkit.toc.enabled` turns the whole pane off.

### Body zoom and find

- The toolbar offers `− / percentage / +` controls with 13 fixed steps (50%–300%, including 100%); clicking the percentage resets to 100%. `Ctrl+-` / `Ctrl+=` / `Ctrl+0` and `Ctrl+wheel` are equivalent. Zoom applies to the body layer only — the TOC and toolbar do not grow — and the step is remembered per document. Zoom also compensates the size measurements of mermaid / drawio: they write `getBoundingClientRect()` results back into CSS pixels, and without compensation an ancestor `zoom` would scale them twice.
- `Ctrl+F` opens a find bar in the top-right corner: typing highlights every match and shows `current/total`; `Enter` / `Shift+Enter` and `F3` / `Shift+F3` jump between matches, `Aa` toggles case sensitivity, and `Esc` closes the bar and clears the highlight. If text was selected in the body, `Ctrl+F` pre-fills it.
- Modern engines register `Range`s through the CSS Custom Highlight API and **do not touch the DOM**; older engines without that API fall back to wrapping single-node matches in `<mark>`. Search never enters mermaid / drawio blocks or SVG, so ranges cannot be invalidated by third-party async replacement.

### Large-document performance

When the body has roughly 4000 elements, or 40 tables / code blocks / diagrams, or more than 180,000 plain-text characters, the body layer switches to virtualization: off-screen top-level blocks are skipped for layout and paint with `content-visibility: auto`. **Diagram blocks are the exception** — the mermaid extension measures the SVG after rendering to set the container height, and skipping their layout would measure 0×0, so any top-level block containing svg / mermaid / drawio always keeps real layout (CSS class `wispkit-virtualize-keep`), while other tables, code blocks and paragraphs are still skipped. TOC scroll highlighting caches heading positions and binary-searches them, re-measuring only when the width, the rendered body, or `scrollHeight` changes; jumping far from the TOC corrects the position frame by frame until three consecutive frames stay within 1 px (at most 1.2 s; the correction is cancelled as soon as the user scrolls or clicks the body). Virtualization is temporarily disabled while the find bar is open so every `Range` has layout and can be highlighted and scrolled to accurately; it is restored when the bar closes.

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

### Three-state theme (light / follow theme / dark)

The right side of the toolbar is a three-segment icon button group: light on the left, **follow theme** in the middle, dark on the right; the middle one is selected by default.

- **Follow theme** forces no colours at all and keeps reading the variables of the current VS Code colour theme; when VS Code switches between light and dark, the body and diagrams follow.
- **Light / dark** force only the **Markdown browser** appearance (a `wispkit-theme-*` class on `<html>` plus `!important` overrides of the `--vscode-*` variables). The VS Code theme itself and the image / HTML / XAML views are untouched. The palette is VS Code's default Light+ / Dark+; "forced" means *not* following, so a custom colour theme's palette is deliberately not carried over.
- The state is **global**: switching in one Markdown tab immediately updates every open Markdown view; new views inherit it from `globalState` (`wispkit.markdown.themeMode`), so it survives a VS Code restart. It is **not** a property of the current md document.
- Forced modes also rewrite the `body` classes `vscode-light` / `vscode-dark` so the border rules in the built-in `markdown.css` and the diagram palette of the mermaid preview extension stay on the same side; switching back to "follow theme" restores the host's real kind.

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
| `wispkit.openLink` | `href` (the **raw attribute value** of the `<a>`, not the browser-resolved absolute URL) | none (the host resolves it against the document directory and opens it) |
| `wispkit.setTheme` | `mode` (`light` / `auto` / `dark`) | after writing `globalState`, the host broadcasts `wispkit.theme { mode }` to **all** Markdown views |

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

### Format coverage

- **Decoded directly by the runtime**: PNG / JPG / JPEG / JFIF / BMP / GIF / ICO / WebP / AVIF / APNG / **SVG**.
- **SVG uses vector scaling**: instead of `transform: scale()`, the `<img>` layout width/height changes (panzoom's `scaleMode: 'box'`), so the browser redraws it as a vector at every zoom level; the status hint marks it as a vector image.
- **Formats without a runtime decoder**: HEIF / HEIC / TIFF / JXL. Chromium ships no decoder for them, and adding libheif or similar WASM decoders would mean several MB, which this extension deliberately avoids. These files are still taken over by the image view, but the page shows the **reason** and offers two buttons:
  - "Open with system default app" — hands the file to the OS (on Windows, Photos can read HEIF once the HEIF extension is installed);
  - "Copy path" — copies the absolute path so you can transcode it or open another tool.
- Corrupt files and files whose extension does not match their content land in the same fallback panel instead of a blank page.

## Video view (`wispkit.video`)

| Action | Behaviour |
|---|---|
| Double-click a common video | Opens the video view and plays it through Chromium's native `<video controls>`; no bundled player, no third-party library |
| Play / pause / seek / volume / fullscreen | All delegated to the native controls; double-clicking the picture toggles fullscreen |
| "Open in system player" in the top-right corner | Hands the file to the OS default player (`vscode.env.openExternal`) |
| "Copy path" in the top-right corner | Copies the absolute path to the clipboard |
| Switching to another tab | Pauses automatically so audio does not continue in the background |

- **Playback depends on the runtime codecs**: H.264 / AAC MP4 and VP8 / VP9 WebM usually play directly; MKV / AVI / WMV / FLV / RMVB and similar containers usually only get the fallback. When `<video>` reports `MEDIA_ERR_SRC_NOT_SUPPORTED`, the page shows the reason and the "open in system player" hint instead of a silent black rectangle.
- The status bar shows "format · resolution · duration"; unknown durations (streamed files) show "unknown duration".
- **`.ts` / `.mts` are deliberately not registered**: they are TypeScript source extensions, and registering them as video would hijack every TypeScript file; MPEG-TS is covered only through `.m2ts`.
- The CSP allows `media-src ${cspSource}` for webview resources while scripts still require a nonce; videos load directly through `asWebviewUri` — no copying and no transcoding.

## HTML view (`wispkit.html`)

- Uses a **relaxed CSP**: inline scripts and http(s) resources are allowed — browsing HTML inherently needs the page's own scripts to run.
- Rewrites `href="vscode://file/<path>[:<line>]"` into `command:vscode.open?<args>` and enables `enableCommandUris` on the webview; unrewritten `vscode://` links are also on the host allow-list. This is the **script-free fallback**: if the page's own CSP blocks the injected script, these two kinds of links still work.
- Injects `media/dist/html.js` (`<script defer>`) as a **link router**: it intercepts `<a>` clicks in the `document` bubble phase and sends the raw `href` back to the extension via `wispkit.openLink`. Relative links no longer get resolved by `<base>` into a webview resource URL and handed to the system browser; `#anchor`, `command:` and schemes the shell already supports (`http(s)` / `mailto` / non-file `vscode:`) are left alone.
- The page's own click handlers run first; a link whose default was already prevented (common in SPAs) is not taken over.

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

## Mermaid file view (`wispkit.mermaid`)

Double-click a `.mmd` / `.mermaid` file. The host hands the whole source to VS Code's built-in Mermaid preview script; the page is just one toolbar plus the diagram:

- the badge shows the diagram kind and node / edge counts (same parser as the 3D panel, `src/graph3d/mermaid.ts`);
- **3D visualization browsing** hands the diagram to `wispkit.graph3d`; the dropdown contains a single entry `1. title · kind · N nodes / M edges`;
- **Source** opens the same file in an ordinary text editor beside the preview;
- **Refresh** re-reads the file and re-renders; text changes in an editor are applied in place after a 300 ms debounce.

The diagram is **horizontally centred** by the built-in script (the same rendering pipeline as a Mermaid diagram in the Markdown preview): the page only lets `.mermaid-wrapper` span the full row and adds no flex centring of its own — otherwise the `transform` that the built-in script sets to `(container width − SVG width) / 2` would be applied twice and the diagram would sit to the right.

When no Mermaid preview script is available (for example on an older VS Code), the view degrades to source mode: toolbar, 3D entry and status badge stay the same, the body becomes a `<pre>`, and a banner explains why.

Message contract: webview → host `wispkit.mmd.refresh` / `wispkit.mmd.openSource` / `wispkit.mmd.open3d`; host → webview only `wispkit.mmd.update { source, status, hint? }`. On update the front end rewrites the `.mermaid` container's textContent and dispatches `vscode.markdown.updateContent`, which the built-in script listens to.

## Read-only text view (`wispkit.text`)

- Once global read-only mode is on, `.ts` / `.json` / `.txt` / `.log` and others (decided by `wispkit.readonly.extensions`) open as a read-only preview.
- Only the **first N bytes of the file** are read (`wispkit.readonly.previewBytes`, default 64 KB), then truncated by line (`wispkit.readonly.previewLines`, default 800).
- The page has line numbers and an **in-house generic syntax highlighter** (comment / string / number / keyword level, not TextMate-accurate colouring).
- A floating "unlock editing" button at the bottom right opens the file in the native editor (editable) and lets that file through for the rest of the session.
- The browsing views Wispkit already owns (Markdown / HTML / XAML / images) **are not affected by read-only mode** — they are browsing views already, and truncating Markdown would render a broken result.

## Shell shortcut view (`wispkit.shellLink`)

A Windows `.lnk` file is a small binary that records what a shortcut points at. This view parses it and reports the target path, the working directory, the start-in arguments, the icon location, the volume label, the machine that created it and the flag bits — without launching anything. It is registered as an `option` editor, so double-clicking a shortcut still runs it; the property page is reached through *Reopen Editor With…* or `wispkit.openWith`.

**What opening a `.lnk` does** is decided by `wispkit.shellLink.openBehavior`:

| Value | Behaviour |
|---|---|
| `system` (default) | hand the shortcut to Windows — the same thing a double-click in Explorer does |
| `internal` | open the target inside Wispkit: a folder goes to the subtree panel, a file opens in its matching view |
| `ask` | ask every time which of the two to do |

When the behaviour is `internal` and the target looks like a folder, `wispkit.shellLink.folderTarget` decides where it lands: `subtree` (default) opens the subtree panel for that folder, `system` hands it to the system file manager.

**Editing** (Windows only) rewrites the target path, the working directory, the arguments and the comment through the Windows scripting host's shortcut object: the existing shortcut is loaded first and only the fields the user actually changed are saved, so the icon, the hotkey and everything else in the file stay as they were. Setting `wispkit.shellLink.allowEdit` to `false` hides the form and leaves the page read-only.

**Working directory.** Starting a shortcut does **not** override the start-in directory stored inside it. That is what a double-click does, and wrapping the launch in another directory would quietly change what the shortcut means.

## Executable view (`wispkit.executable`)

A `.exe` file opened here shows its PE structure: the format (`PE32` or `PE32+`), the architecture, the subsystem, whether the image is a DLL, whether it carries a .NET assembly, the entry-point RVA, the image base, the section table and the version resources. It is an `option` editor as well, so `.exe` files still launch on double-click.

`wispkit.executable.openBehavior` decides what "open" means:

| Value | Behaviour |
|---|---|
| `system` (default) | start the executable |
| `viewer` | open this property page |
| `ask` | ask first |

**Working directory.** An executable started from Wispkit runs with **its own directory** as the working directory (`Start-Process -WorkingDirectory` on the host side), so a program that looks for files next to itself finds them. A shortcut is the opposite case — see the previous section.

**Commands.** Six context-menu commands are contributed on the Explorer row of these two file types, each on the kind it applies to: `wispkit.openDefault` (open the configured way), `wispkit.shellLink.openSystem`, `wispkit.shellLink.openTarget`, `wispkit.shellLink.openViewer`, `wispkit.executable.openSystem` and `wispkit.executable.openViewer`.

## Custom resource management (`wispkit.resourceTree`)

### Entry and UI

The **Wispkit** icon in the Activity Bar (`media/wispkit-activity.svg`) opens the "Custom resource management" view. It is a native `TreeView` (not a webview), so its appearance, expand/collapse, drag and drop and context menus all follow the current VS Code theme.

- **No workspace**: the view body says "open a workspace folder first; the resource tree is stored in the first workspace's `.WispkitView/resource-tree.json`".
- **Empty tree**: the welcome page offers "New virtual group" and "Add folder" and states that no disk file is moved or deleted.
- **View description**: the right of the title shows the workspace-relative path of the current storage file; outside the workspace or in a non-`file` workspace it shows the absolute path / URI.
- **Configuration error / read failure**: the view body keeps a diagnostic (unresolvable placeholder, invalid JSON, path is a directory…) and the current tree is left untouched.

### Two kinds of nodes: virtual group vs folder

| Node | Icon | On disk | Notes |
|---|---|---|---|
| Virtual group (`group`) | `folder-library` | **no disk folder at all** | naming and grouping only; may contain groups or folders; clicking says it cannot be browsed |
| Folder (`folder`) | `folder`; `warning` when broken | a real directory, `path` holds an absolute path or a workspace placeholder | clicking opens it in the subtree panel; may contain children |

- **Both kinds can have children**, so "arbitrary depth" is expressed by one rule set. Default caps: 2000 nodes in total, 200 children per level, depth 12.
- A folder's `description` shows the workspace-relative path (an absolute path for folders outside the workspace); when the path is missing / points to a file / cannot resolve a placeholder it shows `⚠ Folder not found` / `⚠ Not a folder` / `⚠ Path cannot be resolved` and the icon turns into a warning.
- Rename, move and delete act on this tree only: **no disk file is renamed, moved or deleted**.

### View title commands

| Command | Location | Behaviour |
|---|---|---|
| New virtual group | title bar | creates a group at the root or under the selected node |
| Add folder | title bar | opens the system folder picker; multi-select is allowed and each folder becomes a node; non-directory entries are skipped with a notice |
| Refresh | title bar | re-reads the JSON; on invalid JSON / read failure the current tree is kept and a message is shown, the file is never overwritten |
| Import resource tree… | title overflow menu | picks a JSON file and **replaces the whole tree** after confirmation; an invalid file is rejected before the confirmation dialog |
| Export resource tree… | title overflow menu | writes the current tree to a JSON file you choose |
| Open resource tree JSON | title overflow menu | opens the current storage file; when it does not exist the current tree is written first (an empty tree on first use) |

### Item context commands

| Command | Applies to | Behaviour |
|---|---|---|
| Browse folder | folder (inline icon on hover / context menu) | opens that directory in the subtree panel |
| Copy path | folder (context menu) | copies the folder's absolute path to the system clipboard; placeholders are resolved but the directory does not have to exist (offline network shares can be copied too) |
| Open in integrated terminal | folder (inline icon / context menu) | opens the directory in the VS Code integrated terminal; the tab uses the display name / alias |
| Open in system terminal | folder (context-menu submenu) | opens a system terminal window outside VS Code. Windows: Command Prompt (cmd), PowerShell, Command Prompt (Administrator), PowerShell (Administrator); macOS: Terminal.app; Linux: falls back through gnome-terminal → konsole → xfce4-terminal → xterm. Administrator entries trigger a UAC prompt |
| Open in VS Code | folder (context menu) | opens the directory as a workspace in a **new window**, keeping the current one |
| Open in system file manager | folder (context menu) | hands the directory to the operating system (File Explorer on Windows) |
| New virtual group / Add folder | group or folder | creates a child node under it |
| Rename | group or folder | changes the display name in the tree only, never the disk directory |
| Move to… | group or folder | quick-picks a target group / folder (including "Root"); moving into itself or a descendant is rejected |
| Move up / Move down | group or folder | reorders siblings |
| Delete | group or folder | removes it (with its subtree) from the tree after confirmation; **does not delete disk files** |

Right-clicking a **folder** in the Explorer also offers "Add to custom resource management", which adds it at the root. A single selection asks for a display name; a multi-selection adds every folder in one batch using its folder name (no per-folder prompt), skips files and other non-directory entries with a summary notice, and adds the same path only once per batch.

### Drag and drop

| Source → target | Behaviour |
|---|---|
| Item in the view → group / folder | moves the node (multi-selection supported); nodes whose target lies inside themselves or a descendant are not moved |
| Item in the view → empty area | moves it to the root |
| Explorer folder → group / folder / empty area | adds it as a folder node; dropping onto a container makes it a child; non-directory entries are skipped with a notice |

Internal drags use a private MIME (`application/vnd.code.tree.wispkit.resourcetree`) and external drops use `text/uri-list`; the host re-validates node types and cycles at the drop target, and an illegal move leaves the tree unchanged.

### Storage and refresh

- The default location is the **first workspace folder**'s `.WispkitView/resource-tree.json`; `wispkit.resourceTree.file` can move it (relative to the first workspace, with `${workspaceFolder}` / `${workspaceFolder:name}` / `${workspaceFolder:index}` and absolute paths supported).
- The file is plain JSON: `{ "version": 1, "roots": [...] }`. Every add / rename / move / delete writes it back automatically, using a "temporary sibling file + rename" write.
- **External edits do not appear automatically**: the extension does not watch this file, so after editing the JSON click Refresh in the view title. Refresh preserves expansion / selection as far as possible.
- Invalid JSON, a directory or a permission error: the refresh fails with a reason and both the current tree and the file stay unchanged; changing `wispkit.resourceTree.file` reloads the new file automatically.

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
- **File icons**: `.lnk` and `.exe` rows show the icon embedded in the file itself — on Windows through the same shell association Explorer draws icons with, so a shortcut shows the icon of the program it points at rather than a generic link glyph. Everything else falls back to the user's icon theme, then to the built-in sprites; when the real icon cannot be read the theme icon is used, never a placeholder.
- **Type-ahead**: press a letter or a digit to jump to the first entry starting with it; pressing the same character again walks down the list and wraps around. Latin letters, digits and Chinese names all match by plain prefix — Chinese uses the text the input method commits, and no pinyin table is involved. Set `wispkit.subtree.typeAhead` to `false` to turn it off.
- **Sorting**: click a header to sort by that column; the pure logic lives in `src/subtree/sort.ts`.

### The three kinds of actions in the action area

| Kind | Source | Notes |
|---|---|---|
| File operations (native) | built into Wispkit | cut / copy / paste / rename / delete / new file / new folder / compare, plus **system terminal** and **open with the default application**. **It has to be in-house**: the built-in `filesExplorer.*` commands do not accept external URIs |
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

**Open in terminal** (`openInTerminal`) and **System terminal** look alike and are deliberately different: the first writes into a terminal the editor owns, the second starts a window of its own that keeps running after the editor closes. Its submenu only lists the terminal kinds the current platform actually provides — cmd and PowerShell, each with an elevated variant on Windows; Terminal.app on macOS; the desktop terminal on Linux — and the window starts in the selected folder, or in the selected file's own folder.

**Open with the default application** (`vscode.open`) hands the selection to the application the operating system registered for it, which is what double-clicking does. It stays greyed out whenever the selection contains a folder: opening a folder that way would produce another window, and "Open folder in new window" already covers that.

### Message contract

| Front end → host | Notes |
|---|---|
| `wispkit.subtree.read` | read one directory level (lazy loading) |
| `wispkit.subtree.sort` | sort by column |
| `wispkit.subtree.command` | run an extension or built-in command |
| `wispkit.subtree.fileAction` | file operation, branches `cut` / `copy` / `paste` / `rename` / `delete` / `newFile` / `newFolder` / `compare` |
| `wispkit.subtree.systemTerminal` | start a system terminal: `kind` names the platform terminal (e.g. `windows-powershell-admin`), `paths` carries the selection |
| `wispkit.subtree.tool` | run a custom tool |
| `wispkit.subtree.open` | open or reveal an entry |
| `wispkit.subtree.drop` | raw dropped resources (`targetDir` + file bytes + strings); the host asks and writes. `internalDrag` + `moveRequested` mean "dragged inside the subtree with Ctrl/Cmd held", so the host skips the copy/move prompt and moves directly |

### Drag and drop

- **Drop in**: drag files/folders from the Explorer, text, HTML, images or links onto the tree or a folder row.
  - When a source path can be resolved (`text/uri-list` or an absolute path in `text/plain`) you are asked **copy / move**; a name clash asks **overwrite / auto-rename / cancel**. Move tries `workspace.fs.rename` first and falls back to copy + delete-to-trash across volumes.
  - A `File` dropped directly from the OS has content but no source path, so only copy can be completed; the "move" choice explains that limitation.
  - Text / HTML / image data URLs / links are treated as **other resources**: pick a **storage type** (all supported types of that resource are listed, e.g. `.txt` / `.md` / `.url`) and enter a **file name**. The default name is the first meaningful text of the content (HTML `<title>`, URL path segment or host, first line of text); when nothing meaningful can be extracted the field stays empty instead of inventing a name.
- **Ctrl-drag inside the tree = move**: hold **Ctrl** (**Cmd** on macOS) while dragging a row — within one panel or between two side-by-side subtree panels — to move it without the copy/move prompt. Both the dragstart and drop key states are considered, so pressing Ctrl before dragging and releasing it before the drop still counts; the target highlight turns from copy blue to move green. Name clashes still ask **overwrite / auto-rename / cancel**. **OS drags are excluded**: Ctrl means copy in Windows Explorer, and interpreting it as move would delete the source.
- **Drag out**: dragging uses Pointer Events and never HTML5 native drag — inside a VS Code webview, `draggable=true` enters the native OLE drag loop and freezes the main process (always reproducible when dropping on the system Explorer). Dropping inside the tree copies / Ctrl-moves; releasing outside the webview resolves the Explorer window under the cursor and copies / moves the entries into its current folder (Ctrl = move, multi-selection included). If the cursor is not over an Explorer window, the files are put on the Windows clipboard for `Ctrl+V` in Explorer.
- **No Shift needed when dragging files in from the OS**: VS Code's webview normally hands "all files" drags to the editor and temporarily sets the iframe to `pointer-events: none`, so previously only a Shift-drag reached the page. The front end now intercepts pure-file drags in the **capture phase** at `document`: `dragenter` calls `preventDefault()` (the pre script returns early on `defaultPrevented` and no longer asks the host to disable the iframe) and `stopPropagation()` keeps dragover / drop away from the window-level forwarding logic. Files can be dropped straight into the tree; OS drops still have no source path, so only copy can be completed.

## 3D graph browsing (`wispkit.graph3d`)

### How it opens

| Entry | Behaviour |
|---|---|
| Right-click `.md` / `.markdown` / `.mmd` / `.mermaid` in the Explorer → **3D visualization browsing** | the item appears only for those extensions; opens the current file (a `.mmd` / `.mermaid` file parses as one graph) |
| Command palette → `Wispkit: 3D visualization browsing` | prefers the active Markdown editor / tab; when the active file is not Markdown / Mermaid it says only those extensions are supported; with no active file it asks you to right-click or open a Markdown / Mermaid file first |

**The same file reuses the same panel**: running the command again only reveals the existing panel instead of stacking new tabs. This panel is a `webviewPanel` (not a custom editor), so it does not compete for the open handler.

### Composition

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Left graph [select]  Right graph [select] │ Merge  Reset view  Refresh │ Layout [select]  Spacing [slider] 1.00× [x] Show flow names  Status │
├───────────────────────────────────┬──────────────────────────────────────────┤
│ Left: name + N nodes · M edges     │ Right: name + N nodes · M edges          │
│        3D scene                    │        3D scene                          │
│  left-drag rotate · right-drag pan · wheel zoom · hover a node for comments    │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

- **Left / right selects**: each option reads `index. name · N nodes / M edges`, plus "(none)". Initially the left side selects the first graph element and the right side selects nothing; with only one side selected that side fills the whole panel.
- **Merge left/right**: enabled only when both sides are selected. After merging, the two panes and the splitter hide and only the "merged view" remains; the button becomes "Cancel merge".
- **Reset view**: returns the camera to a direction and distance that show the whole graph.
- **Refresh**: re-reads and re-parses the current file. Existing left/right selections are restored by id, then name; a deliberate "(none)" stays as-is; when the document goes from no graph elements to some, the first one is selected automatically. The refresh button re-enables after 8 seconds so a lost request cannot leave it disabled forever.
- **Layout**: the dropdown offers Auto (by topology), Compact layered, Mutex · Compact layered, Louvain shell FR-3D, Radial tree, Layered rings, 3D force-directed and Mutex · 3D force-directed; switching re-layouts immediately. In the merged view the two mutex algorithms push each graph's core node to opposite ends of the layout and keep same-name fusion nodes between them (when one graph is a subset of the other, the fusion nodes stay put and the other side's exclusive nodes are pushed outwards); the status line names both cores. Without a merge (single graph) they fall back to the corresponding base algorithm.
- **Spacing**: 0.25×–3×; the graph re-layouts about 90 ms after the slider stops. The camera distance scales with the new bounding radius, so the graph does not fly out of the viewport.
- **Show flow names**: checked by default. When checked, each edge shows its label above the midpoint (the same Sprite text as node bubbles); a dangling edge moves its label towards the dangling end so a long name does not cover the real node's bubble text. Unchecking hides them instantly without re-layout. The left, right and merged views stay in sync.
- **`void` dangling placeholders**: when a Mermaid node label is exactly `void` (surrounding whitespace and case ignored — for example Drawcode's module-interconnect export uses it for "the other side was not created"), no bubble is drawn; every flow attached to it becomes a **dangling edge** reaching from the real node into empty space. Directions avoid existing edges and nearby bubbles, multiple dangling edges around one node spread by angle, and lengths stay near the normal edge gap; arrows keep their original source → target direction (`void → node` points at the real node, `node → void` points into empty space). Dropdown and status node counts exclude `void`; edge counts still include dangling edges and the status line appends "N dangling". Isolated `void` nodes or nodes connected only to other `void` nodes stay visible; `void` in ASCII trees is left untouched.
- **Hover comment tooltip**: when the pointer is over the bubble area of a node that has a comment, a tooltip next to the cursor shows the node name and the comment; it hides when the pointer leaves the bubble, when dragging starts, or when zooming. Nodes without a comment do not show a tooltip.
- **Long names stay complete**: when a name is long and has no manual line breaks, spaces, slashes, backslashes and hyphens are first turned into line breaks; the text is then wrapped to the bubble's available width according to its aspect ratio. **No character of the main text is dropped** — if the texture exceeds 2048 px, only the font size shrinks. The text block is scaled to the rectangle inscribed in the sphere, so all four corners stay inside the bubble outline.
- **Image bubbles**: when a node name is a Markdown link `[text](image path)` (Markdown image syntax `![text](path)` also works) whose target exists and is a parseable image (png / jpg / jpeg / jpe / gif / webp / bmp / ico / avif, up to 16 MB), the bubble shows the **image instead of text**. The image keeps its original aspect ratio and is scaled so its four corners lie exactly on the bubble sphere; it always faces the camera. If the file is missing, the extension is not an image, the file header is unrecognised, or the frontend fails to decode it, the node falls back to text automatically. Relative paths resolve against the current Markdown / Mermaid file; Windows absolute paths (drive letter / UNC) and `file:` URIs are supported.
- **Splitter**: appears when both sides are selected; dragging adjusts the ratio and clamps it to **15%–85%**; **double-click resets to 50% / 50%**.
- **Status bar**: parse results, how many same-name nodes were merged, refresh and error messages; errors use the error colour.
- Every 3D scene shows a hint at the bottom; without WebGL the scene shows an error overlay instead of a blank area.

### Gestures

| Gesture | Behaviour |
|---|---|
| Left-drag | Rotate the view (with damping) |
| Right-drag | Pan the view; the browser context menu on the canvas is suppressed |
| Wheel | Zoom in / out |
| Hover a node bubble | If the node has a comment, show a comment tooltip next to the cursor; hidden while dragging / zooming |
| Touch: one finger / two fingers | one finger rotates; two fingers zoom + pan |
| `Esc` | While merged, cancels the merge and returns to the two panes |
| Drag / double-click the splitter | Adjust / reset the left-right ratio (see above) |

### Graph element naming rules

- Exactly two kinds of elements are collected: **Mermaid** in fenced code blocks (```` ```mermaid ````), and **ASCII / tab-drawn trees** in fences or in the body text. A standalone Mermaid file (`.mmd` / `.mermaid`) parses as one element named after its `title`, or else its file name.
- Name priority: the Mermaid `title` (frontmatter or `title` directive) > **the nearest Markdown heading** (`#`..`######`; headings inside fences do not count) > the first non-empty node label in the graph > the file name as fallback.
- The kind is appended to the name, e.g. `Build pipeline · Flowchart`, `src · ASCII tree`, `Login sequence · Sequence`; an unknown Mermaid kind shows `Mermaid diagram`.
- **Duplicate names automatically get `(2)`, `(3)`**, so the drop-down can always tell them apart.
- The panel title reads `3D: file name (N)`, where N is the number of graph elements; each drop-down option also carries its node / edge counts.

### Entry comments

Comments are attached to nodes and shown in a tooltip when hovering a bubble; they never leak into node labels and do not participate in same-name comparison.

- **ASCII / tab-drawn trees**:
  - Trailing comments: `├── src   # source directory`, `└── main.ts   // entry`. The marker must be preceded by whitespace, so `#` in labels such as `C#` or `F#` is not split.
  - Whole-line comments: `│   # a note` (with an optional tree prefix), attached to the most recent node.
  - Wrapped comments: when a continuation line does not repeat `#`, it joins the comment only if its indentation column is **≥ the comment's starting column**; otherwise it is still treated as a wrapped label.
  - Consecutive comment lines are joined with `\n`; each node keeps at most 12 lines / 1200 characters.
- **Mermaid**: a whole-line `%% comment` attaches to nodes **created on the next line**; a trailing `%% comment` belongs to nodes created on the same line; consecutive whole-line comments are joined. Directives such as `%%{init: …}%%` are not comments. When a line creates several nodes (for example `A --> B`), all of them receive the comment.
- **Merged view**: when same-name nodes merge, comments are de-duplicated by line and combined, so the tooltip shows both sides.

### Same-name node merge rules

- **Only nodes across the left and right elements are merged**; nodes with the same name inside one graph are not merged, so ordinary repeated nodes are not mistaken for one entity.
- Name comparison: `trim`, collapse runs of whitespace to one space, strip surrounding quotes / backticks, case-insensitive; Chinese is unaffected by case.
- The left node (id and label) is kept; the `detail` of a right-side match is de-duplicated and appended (at most 24 entries), and `comment` lines are de-duplicated and combined. Unmatched right-side nodes get a new id with an `r:` prefix; right-side group ids are remapped the same way to avoid collisions.
- All edges are kept: left edges as-is, right edges with remapped endpoints; edges with identical `source + target + label + dashed` are de-duplicated, so the two graphs become one connected whole through the shared nodes.
- When there are no same-name nodes, both graphs still sit in the same 3D scene but remain independent; the status bar and statistics report the actual merge count (including 0) explicitly.
- The merged view's statistics line carries `merged N same-name nodes…` or `no same-name nodes on either side…`.

### Message contract

| Front end → host | Payload | Host replies |
|---|---|---|
| `wispkit.graph3d.refresh` | none | `wispkit.graph3d.elements { elements, message }`; on failure `wispkit.graph3d.error { message }` |

## Shared interaction components

| File | Used by | Responsibility |
|---|---|---|
| `media/shared/panzoom.js` | image view, Markdown modal, XAML render | wheel zoom (cursor anchor) + drag pan + double-click fit |
| `media/shared/lightbox.js` | Markdown modal | full-screen backdrop, `Esc` to close |
| `media/shared/toc.js` | Markdown view | build the tree, highlight the current section, collapse |
| `media/shared/contextmenu.js` | Markdown / subtree | menu positioning, hit testing, closing |
| `media/shared/paragraph.js` | Markdown edit mode | paragraph ↔ source-line mapping and slicing |
