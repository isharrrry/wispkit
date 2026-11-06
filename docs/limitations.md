---
type: Guide
title: Known limitations and unverified items
description: What Wispkit cannot do, why each limit exists (including 3D diagram coverage, ASCII tree boundaries, large-graph caps and the resource tree's disk / concurrency / multi-root boundaries), and what has never been verified on a real machine
tags: [limitations, unverified, honesty]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
---

# Known limitations and unverified items

**English** | [中文](limitations.zh-CN.md) | [Español](limitations.es.md)

This page lists only "cannot do" and "not verified". **Unverified does not mean known-broken** — the two are separated below.

## 1. Capability limits

### 1. No editor↔preview scroll sync

- **Symptom**: scrolling in the Markdown source does not move the preview, and vice versa.
- **Cause**: the table of contents is built from `h1..h6` **inside the webview** and does **not** rely on `data-line` source mapping. Scroll sync needs the whole `data-line`/`code-line` protocol, i.e. a re-implementation of the built-in preview's sync machinery.
- **Workaround**: the TOC highlighting and jumping do not depend on it; clicking a TOC entry still jumps accurately.
- **How to confirm**: there is no scroll-sync module under `src/markdown/`.

### 2. Simple Browser cannot be taken over

- **Symptom**: when an HTML file is opened in Simple Browser, Wispkit's `vscode://file/` navigation does not apply.
- **Cause**: Simple Browser is a `webviewPanel` created by a command (`onWebviewPanel:simpleBrowser.view`); it **never enters the customEditors competition**, so there is no entry point for an extension to take it over.
- **Workaround**: open the same file with Wispkit's own HTML view.

### 3. The HTML view uses a relaxed CSP

- **Symptom**: the HTML view allows inline scripts and http(s) resources, a lower security level than the Strict policy of the Markdown/XAML views.
- **Cause**: browsing HTML inherently requires the page's own scripts to run; tightening the CSP breaks most real pages. The risk level is comparable to the built-in Simple Browser.
- **Workaround**: **never open HTML of untrusted origin with the HTML view.**

### 4. Markdown / Mermaid / images / videos / HTML / XAML take over the default open handler

- **Symptom**: after installing, double-clicking `.md`, `.mmd` / `.mermaid`, an image, a video, `.html` or `.xaml` lands in the Wispkit view instead of the built-in editor / browser.
- **Cause**: those six views are `priority: default` in `package.json` (required for "double-click opens it"; HTML also has to take over by default, otherwise links do nothing in the built-in text editor).
- **Workaround**: right-click the file → *Reopen Editor With…* and pick the built-in editor; or pin it through `workbench.editorAssociations`.
- **Note**: **only read-only text is `option` priority**; it does not compete by default and is driven by `workbench.editorAssociations`.
- **After upgrading**: a newly installed version only takes effect after **Reload Window** — the extension host starts when the window loads, so without a reload the old version keeps running. Even after a reload, **tabs that are already open keep their original editor type**: an SVG opened by the built-in preview before the upgrade must be closed and reopened (or use right-click → *Reopen Editor With…* → **Wispkit Image**) to land in the new view.

### 5. Default mermaid zoom depends on the built-in extension

- **Symptom**: `contributes.configurationDefaults` raises `markdown-mermaid.mouseNavigation.enabled` to `always` so mermaid diagrams zoom by default.
- **Cause**: that default only matters when `mermaid-markdown-features` (shipped with VS Code) is installed; without it the key is simply unregistered and harmless. When the user has explicitly changed the setting, the user value wins.

### 6. XAML rendering is a static snapshot

- **Symptom**: the rendered image has layout only — no data, no interaction.
- **Cause**: the renderer builds the control tree with an XAML parser in a separate process and then renders it off-screen to a PNG — **no DataContext, no event handlers, no message loop**.
- **Consequences**: `{Binding}` renders empty; `BlazorWebView` renders blank (**the latter is correct behaviour**: the UI lives in Razor, XAML keeps only the host control); `App.xaml` cannot be rendered (the `Application` root can have only one instance per process, and it is not a visual view to begin with).
- **Fit**: good for layout, not for runtime state.

### 7. Types referenced by `x:Class` must already be compiled

- **Symptom**: when the project has never been built (no `bin/(Release|Debug)/<tfm>/*.dll`), XAML with `x:Class` fails to render.
- **Cause**: the renderer prefers the "load the compiled assembly + `RootObjectInstance`" route, which requires the root type to exist; only without `x:Class` does it fall back to `XamlReader.Parse`.
- **Workaround**: `dotnet build` the target project first.

### 8. Edit mode has no syntax highlighting

- **Symptom**: the Markdown paragraph edit box is a plain `<textarea>`, and the XAML source area has only the in-house lightweight highlighter.
- **Cause**: what is bought is **pixel-level alignment** with the line-number gutter and zero third-party dependencies (an in-house highlighter must keep the output byte-identical to the input, or the caret drifts).
- **Workaround**: use *Reopen Editor With…* to switch to the native VS Code editor when highlighting is needed.

### 9. Read-only mode does not apply to Wispkit's own browsing views

- **Symptom**: Markdown / HTML / XAML / images / videos still open as usual in read-only mode.
- **Cause**: they are browsing views to begin with (they write no files), and **truncating Markdown would render a broken result**.
- **Exception**: the source pane of the XAML view remains editable — this will tighten together with read-only mode in the future.

### 10. Read-only mode replaces the tab once when changing editors

- **Symptom**: after enabling read-only mode, opening a text file shows "the native editor tab closes and the read-only preview takes its place".
- **Cause**: the interception happens after the file has already been opened by the native editor (`onDidOpenTextDocument` timing); it cannot be replaced before it opens.
- **Exception**: files opened by peek / diff / in the background are not intercepted.

### 11. `atime` and POSIX permission bits in the subtree view are always `-`

- **Cause**: VS Code's `FileStat` does not expose them, so the extension cannot obtain them.
- **Workaround**: none (unless calling `fs.stat` directly, which would bypass `workspace.fs`'s remote support).

### 12. Font-based icon themes do not fall back

- **Symptom**: with a **font-based** icon theme (one that defines `fonts`), such as Seti, the subtree icons differ from the Explorer.
- **Cause**: `parseIconTheme` only parses SVG-shaped themes (`iconDefinitions` pointing at svg files); a font theme fails as a whole and falls back to the self-drawn sprite.
- **Workaround**: switch to an SVG-shaped theme (such as the modern icons theme used for verification).

### 13. The built-in Explorer command whitelist was not verified one by one

- **Symptom**: the built-in commands in the action area (`revealInExplorer`, `copyFilePath`, …) were not clicked one by one on a real machine.
- **Cause**: VS Code's built-in Explorer commands have **no enumerable list** (they are not in any extension's `contributes`), so they can only be listed by hand.
- **Protection**: every call is validated with `commands.getCommands(true)` first, and a missing command produces a message — **never silence**; an argument type mismatch throws immediately with the reason shown.

### 14. Subtree file operations are in-house, not built-in commands

- **Cause**: the built-in `filesExplorer.rename` / `explorer.newFile` / `filesExplorer.paste` do not accept external URIs and cannot act on the row selected in the panel, so cut/copy/paste/rename/delete/new/compare are all in-house (`src/subtree/fileActions.ts`).
- **Implication**: the behaviour details of these operations (conflict prompt, recycle bin, recursive copy) are decided by Wispkit and are not guaranteed to match the Explorer character for character.

### 15. 3D visualization parses topology, not the Mermaid rendering

- **Symptom**: the nodes, edges and groups in the 3D panel come from Wispkit's own lightweight parser, not from the SVG Mermaid renders; themes, colours, precise line styles, `classDef`, `style`, `click`, `accTitle` / `accDescr` are not reflected in 3D. Entry comments are recognised and attached to nodes (trailing / whole-line comments in ASCII trees, `%%` comments in Mermaid), but they are shown only as plain text in a hover tooltip — not at the comment's original position or layout.
- **Supported diagram types**: `flowchart` / `graph` (including `-elk`), `sequenceDiagram`, `classDiagram`, `stateDiagram` / `stateDiagram-v2`, `erDiagram`, `mindmap`, `gitGraph`, `journey`, `gantt`, `timeline`, `pie`, `quadrantChart`. These are normalised into nodes / edges / groups according to their semantics before layout.
- **Unsupported types**: `requirementDiagram`, `C4Context`, `sankey-beta`, `block-beta`, `architecture-beta`, `packet-beta`, `xychart-beta` and unrecognised Mermaid content use a **generic fallback**: content lines are chained in reading order and the statistics line says "generic fallback parser (chained by line)"; semantics (hierarchy, flow, coordinates) are lost.
- **Syntax errors**: the parser keeps as many recognised nodes / edges as possible and explains the problem in `note`; the whole panel never crashes.
- **Workaround**: when you need the exact Mermaid look, read the Markdown view itself; 3D is for structure.

### 16. Bare ASCII tree recognition is conservative

- **Supported**: trees inside fences whose language is `""` / `text` / `txt` / `plain` / `plaintext` / `ascii` / `tree` / `log` / `none`; and body-text trees that have at least two **labelled connector lines**.
- **Connectors**: Unicode `├──` / `└──` / `│` and friends (1–8 dashes), or ASCII `|--` / `+--` / `` `-- `` / `\--` (2–8 dashes). A single connector line is not a tree; pure frames / table borders (`+---+`, `┌── x ──┐`) are excluded.
- **Bare body-tree boundaries**: body lines must not be Markdown structures (ATX headings, blockquotes, lists, tables, HTML, rules, link reference definitions); a blank line ends the block; indented lines without a connector are merged into the previous node label (wrapped text); a second root at column 0 is only absorbed when the next line is another connector; the indent depth is capped at 30.
- **Not recognised**: hierarchy expressed only with spaces and no connectors; fragments with a single connector; trees inside non-ASCII fences such as ` ```js `; Mermaid written inside a non-`mermaid` fence.
- **Truncation**: one ASCII tree stops at 600 nodes (no extra notice is added; see the next item).

### 17. 3D element and node caps, and large-graph performance

| Cap | Value | Behaviour |
|---|---:|---|
| Graph elements per Markdown file | **200** | extra elements are simply not collected (silent truncation) |
| Nodes per Mermaid diagram | **600** | truncated to the first 600, with a "node count exceeds 600…" note next to the statistics |
| Nodes per ASCII tree | **600** | stops adding nodes at the cap (the ASCII parser adds no truncation note) |

- **Layout cost**: tree / layered layouts are close to linear, but cyclic class / ER graphs use the **deterministic force-directed** layout, whose distance computation is O(n²) (up to 170 iterations + 36 overlap-removal passes). Every node creates a Canvas texture sprite and every edge creates a TubeGeometry plus arrow cone. With hundreds of nodes, layout time and GPU memory grow noticeably.
- **Measured boundary**: unit tests cover the 600-node truncation and layout determinism; the real-machine 3D end-to-end samples only had 3–8 nodes (see [build and verify](build-and-verify.md#3d-bundle-and-end-to-end-probes)), and **no stress test has been run on a real document with 200 elements / 600 nodes**.
- **Workaround**: split very large documents into several smaller graphs and view them one at a time; increasing the spacing reduces text overlap but does not reduce the node count.

### 18. The 3D scene needs WebGL

- **Symptom**: when the host / GPU driver disables WebGL, the 3D scene cannot be created and the panel shows a "cannot create a WebGL context: …" error overlay.
- **Cause**: three.js's `WebGLRenderer` requires a real WebGL context; there is no 2D or SVG fallback.
- **Workaround**: enable hardware acceleration or use a machine with WebGL support; when you only need the structure, read the Mermaid / ASCII tree in the Markdown view.

### 19. Virtual groups have no disk counterpart

- **Symptom**: a virtual group (`group`) looks like a folder in the tree, but clicking it says "a virtual group does not map to a real folder and cannot be browsed"; it can still hold folders or child groups.
- **Cause**: a `group` node has only `id` / `name` / `children` and no `path` (`src/resourceTree/model.ts`). It is purely a naming / grouping container inside the tree.
- **Implication**: renaming, moving or deleting a virtual group only changes the JSON; the delete dialog states explicitly that no disk file will be deleted. Use "Add folder" when you need a real directory.

### 20. Absolute paths outside the workspace break on another machine / workspace

- **Symptom**: folders outside the workspace are stored as POSIX-style absolute paths (for example `D:/shared/docs`). After changing machines, drive letters or moving the directory, those rows show `⚠ Folder not found` and clicking reports that the path does not exist.
- **Cause**: `paths.ts` only uses the `${workspaceFolder}` placeholder for paths **inside a workspace**; outside there is no portable anchor, so an absolute path is the only option.
- **Boundaries**: `${workspaceFolder}` always means the **first** workspace; `${workspaceFolder:name}` / `${workspaceFolder:index}` fail to resolve when that root is absent (`⚠ Path cannot be resolved`) instead of silently pointing elsewhere. A relative path without a placeholder resolves against the first workspace.
- **Workaround**: keep directories inside the workspace so the extension can store placeholders; for a tree shared across machines, put the directories inside the workspace or bulk-edit the paths after importing.

### 21. External concurrent edits and overwrite risk

- **Symptom**: editing `resource-tree.json` directly in VS Code does not update the view; if an external editor still has unsaved changes while the extension performs an add / rename / move / delete, the extension rewrites the whole file from its in-memory tree.
- **Cause**: there is no `FileSystemWatcher`; every change serialises the in-memory tree wholesale. The "temporary sibling file + rename" write guarantees **no half-written file**, but there is no merge and no cross-process lock.
- **Verified last-writer-wins** (2026-10-26, VS Code 1.137.0, Windows 11; 17/17 probe steps under `.selftest/e2e-resource-tree-concurrency/`):
  - **External unsaved buffer + extension write → external save** (real VS Code text-editor buffer): the extension's add landed on disk while the buffer stayed dirty. Saving the buffer made VS Code report `Failed to save ... The content of the file is newer`; after clicking **Overwrite**, the external buffer replaced the file. Refresh then showed the external version and the extension's change was **lost**. A pre-write check cannot prevent this direction, because the loss happens when the external editor saves later.
  - **Extension write → external overwrite → Refresh**: Refresh reads the external version and drops the extension's previous in-memory state (the external file wins on read).
  - **Direct `storage.writeStore`**: no conflict check at all; an external saved tree was replaced byte-for-byte by the store passed in. The protection below only exists in `ResourceTreeProvider.commit`.
- **Low-cost hardening (implemented)**: before every write, `commit` re-reads the file and canonically compares it with the text the extension last loaded / wrote (`classifyExternalChange` in `storageCore.ts`; formatting / BOM differences do not count). On `modified` / `created` / `deleted` / unparseable JSON it shows a **non-modal warning** with **Overwrite external changes** / **Cancel**:
  - **Cancel** (or dismissing the notification): nothing is written; the in-memory tree and the external file both stay unchanged.
  - **Overwrite external changes**: the write proceeds — the external saved change is still lost. This is an explicit choice, not a merge.
- **Remaining limits**: the check is read-before-write (TOCTOU); an external save that lands between the check and the rename can still be overwritten. There is still no file watcher, no merge and no cross-process lock; the external-unsaved direction in the first bullet remains unpreventable. `writeStore` / export paths do not run the check.
- **Invalid JSON**: saving invalid JSON externally and clicking Refresh keeps the current tree, does not overwrite the file and does not crash; the warning says "current tree kept, the file will not be overwritten". A later extension edit is treated as an external change and requires the same confirmation.
- **Kill between writes**: after write 1 completed and the extension host was force-killed before write 2, the file stayed byte-identical (md5 unchanged) with **no `.tmp-*` leftovers**; the host restarted and the tree showed the write-1 content. A kill **during** the temp-file write / rename was not captured (the window is very short; see item 23 about leftover `.tmp-*`).
- **Workaround**: click Refresh before and after external edits; do not edit the tree in the view while the file is open externally; when the warning appears, compare before choosing Overwrite; avoid concurrent writes when several people share one JSON.

### 22. Symlinks, missing permissions and multi-root boundaries

- **Symlinks**: folder state is checked asynchronously with `workspace.fs.stat`, which **follows links** (verified on a real machine on 2026-10-26 with VS Code 1.137.0 on Windows 11; probes and screenshots under `.selftest/e2e-resource-tree-symlink/`). A link to a directory is treated as a directory (`SymbolicLink | Directory`); a link to a file is treated as a file, so a folder node shows `⚠ Not a folder`; a **broken link** makes stat succeed with only the `SymbolicLink` bit set (the target is gone) and is now shown as `⚠ Link broken`, with the tooltip "⚠ link target does not exist, cannot open" and the click message "Link broken (target does not exist): <path>", instead of the old misleading "Not a folder". The tree stores the link path itself and does not resolve it to the target; after restoring the target, Refresh restores the directory / file state.
- **Missing permissions**: on local NTFS, even when a directory ACL denies Read to the current user, `workspace.fs.stat` still reads the attributes and returns a directory — the tree shows it as an ordinary folder, so it is **not confused with "missing", but it also cannot warn in advance**. The failure appears only when reading the directory contents: the subtree panel shows "Cannot read: …" for a normal user token. This test machine ran as Administrator with `SeBackupPrivilege` enabled, which also allowed directory enumeration, so the EACCES path could not be reproduced here (recorded as such in `priv-check.txt`). If a file-system provider throws `NoPermissions` during stat, the current implementation still shows `⚠ Folder not found`: **at the stat layer "no permission" and "missing" remain indistinguishable**; concrete errors appear only when opening the subtree or reading / writing the storage file.
- **Multi-root workspaces** (verified on a real machine on 2026-10-26 with VS Code 1.137.0 on Windows 11; probes under `.selftest/e2e-resource-tree-multiroot/`): storage defaults to the **first** root; `${workspaceFolder:name}` / `${workspaceFolder:index}` can target other roots; there is no cross-root "move" semantics (a move only changes the JSON structure, never the disk directory). `${workspaceFolder}` follows the first root, name / index placeholders resolve to the second root, and a missing name / index shows `⚠ path cannot be resolved` (raw placeholder in the tooltip, warning on click). Adding a folder from the Explorer context menu stores `${workspaceFolder:<name>}` rather than an absolute path. After removing the first root, VS Code restarts the extension host (platform behaviour, not a crash); the default storage switches to the new first root, the old file is left untouched, `${workspaceFolder}` now points at the new first root (existing nodes can become `⚠ folder does not exist`), index placeholders stop resolving, and the tree keeps working. There is no separate toast for that switch — the view title shows the storage path, prefixed with the root name while the workspace has more than one root.
- **Adding from the Explorer**: the `explorer/context` entry supports multi-selection. With several items, folders are added in one batch using their folder name as the display name (no per-folder name prompt); files and other non-directory entries are skipped with a summary notice; the same real path is added only once per batch, while duplicates across batches are still allowed. Dragging a multi-selection adds every folder the same way.

### 23. Resource-tree size caps and folder-state cache

- **Caps**: 2000 nodes in total, 200 children per level, depth 12, 120 characters per name. Nodes beyond the caps are truncated on read with a warning; interactive creation at the limit only says "node or depth limit reached".
- **Folder state**: states are checked asynchronously with `workspace.fs.stat` and cached as `directory` / `file` / `missing` / `broken-link` (30 s TTL, at most 2000 entries, 8 concurrent stats). Reload / Refresh / add / rename / move / delete / `wispkit.resourceTree.file` changes / workspace-folder changes rebuild or prune the cache, and `getTreeItem` only reads it — there is no synchronous `fs.statSync` left on that path. A cache miss renders as an unknown state (plain folder icon, "checking…" tooltip) and is fetched in the background; an expired entry keeps showing its last value until the background check returns. Without a file watcher, an external change can take up to the 30 s TTL (or a manual Refresh) to appear.
- **Cost**: local benchmark (2000 nodes / 1000 subdirectories, probe: `.selftest/resource-tree-cache/bench.mjs`): 1000 synchronous stats ≈ **23–26 ms** of blocking work on the extension-host thread; after the 8-way asynchronous prefetch, 2000 `getTreeItem`-equivalent lookups take ≈ **2.8–3.8 ms** with **0** synchronous stats. In a real VS Code instance with the same 2000-node / 1000-subdirectory tree, expanding a 199-child group took ≈ **55 ms** and a manual Refresh (awaiting all 1989 folder stats) ≈ **0.7–0.9 s**; the refresh wait is asynchronous and does not block the UI. Network-drive behaviour remains untested (see unverified item 14).
- **Temporary files**: killing the process mid-write can leave `.tmp-*` files in the same directory; old files are unaffected, but the leftovers are not cleaned up automatically.

### 24. The 2D preview of `.mmd` depends on the built-in Mermaid preview extension

- **Symptom**: on a VS Code that ships Mermaid preview scripts (the built-in `mermaid-markdown-features`, 1.104+), a `.mmd` file renders as a diagram; without it the view degrades to source mode.
- **Cause**: Wispkit does not bundle its own Mermaid renderer; it uses the same `markdown.previewScripts` contribution pipeline as the Markdown view.
- **Workaround**: upgrade VS Code or install an extension that provides Mermaid preview; 3D browsing is unaffected (it uses Wispkit's own topology parser).

### 25. One `.mmd` file is treated as one diagram

- **Symptom**: multiple Mermaid diagrams in one file (for example joined with blank lines or `---`) are not split into multiple graph elements; the whole source goes through one parse.
- **Cause**: the established convention for `.mmd` is one diagram per file; multiple graph elements are a Markdown concept.
- **Workaround**: put multiple diagrams in Markdown fences, or use two files side by side for comparison.

### 26. 3D browsing of `.mmd` shares the Mermaid parser limits

- **Symptom**: in 3D, `.mmd` still gets the 12 supported kinds plus the generic fallback, at most 600 nodes per graph, and line-chaining for unknown kinds.
- **Cause**: `wispkit.graph3d` uses the same `src/graph3d/mermaid.ts` for both inputs; there is no separate Mermaid-file parser.
- **Workaround**: same as items 15 and 17.

### 27. HEIF / HEIC and several video containers cannot be decoded in place

- **Symptom**: HEIC / HEIF, TIFF and JXL images show "cannot display" in the image view; MKV / AVI / WMV / FLV / RMVB and similar videos usually only get the "open in system player" fallback.
- **Cause**: decoding is entirely delegated to the Chromium runtime inside VS Code. HEIF needs libheif (a WASM build is several MB); TIFF / JXL and most video containers have no decoder in Chromium. Following the "do not implement if it needs a large dependency" rule, Wispkit bundles none of them and does not call Windows-specific codecs.
- **Exception**: formats whose codecs ship with the runtime — MP4 (H.264 / AAC), WebM (VP8 / VP9) — really play; an extension such as `.mkv` only means "Wispkit picked it up", and actual playback depends on the real container and codec inside.
- **Workaround**: open it in the system player, or transcode it to MP4 (H.264 / AAC).
- **Verified**: on real VS Code 1.137.0 / Electron 42: WebP, AVIF and SVG decode; the HEIC fallback panel appears; MP4 playback advances `currentTime`; a corrupt MKV shows the error-code-4 fallback (`.selftest/e2e-media/probe-media.mjs`, 17/17).

### 28. A shortcut's folder target lands only in the subtree panel

- **Symptom**: with `wispkit.shellLink.openBehavior` set to `internal`, a shortcut pointing at a folder opens the subtree panel; there is no way to open that same folder in the compare browser.
- **Cause**: the compare browser does not accept an initial directory, so the subtree panel is the only internal landing point.
- **Workaround**: open the compare browser and navigate to the folder yourself, or set the behaviour back to `system`.

### 29. `.dll` files have no property page

- **Symptom**: a `.dll` offers no "open as executable" route; only `.exe` is claimed.
- **Cause**: only `*.exe` is registered as a selector. The PE parser is valid for DLLs and reports the DLL flag, but no selector claims the extension.
- **Workaround**: use an external PE viewer, or copy the file with an `.exe` extension.

### 30. Shortcut editing is Windows-only

- **Symptom**: on macOS and Linux the shortcut page shows the parsed fields but no edit form.
- **Cause**: writing a `.lnk` goes through the Windows scripting host's shortcut object; the extension ships no cross-platform equivalent.
- **Workaround**: edit the shortcut on Windows.

### 31. A shortcut that stores only a target IDList cannot be opened internally

- **Symptom**: with the behaviour set to `internal`, such a shortcut falls back to handing the file to the system instead of opening the target.
- **Cause**: the file records a shell item list rather than a readable absolute path, so there is no path that could be opened safely.
- **Workaround**: use the system route.

### 32. Files above the 256 MB cap are refused

- **Symptom**: opening a shortcut or an executable larger than the cap reports the size and does not parse it.
- **Cause**: parsing an unbounded file in the extension host would stall the UI.
- **Workaround**: use an external PE or shortcut tool.

### 33. Shortcut parsing is cross-platform, but opening and editing are not

- **Symptom**: on macOS and Linux the `.lnk` fields are readable, while the system open route and the edit form are not available.
- **Cause**: parsing is byte-level and platform-independent; opening and writing are platform-bound.
- **Workaround**: open the shortcut through the system on those platforms.

### 34. Real file icons are Windows-only

- **Symptom**: on macOS and Linux, `.lnk` and `.exe` rows show the icon theme's generic icon instead of the one embedded in the file.
- **Cause**: the icon is taken through the Windows shell association (`ExtractAssociatedIcon`); other platforms have no equivalent, and decoding PE resources by hand just to draw a 16 px icon is not worth the code.
- **Workaround**: rely on the icon theme there — parsing, opening and everything else still works.

## 2. Unverified items

The following have **not been verified in a real VS Code**. That does not mean they cannot work — there is simply no evidence.

| # | Unverified | Why it is worth doubting | How to verify |
|---|---|---|---|
| 1 | **Pixel-level appearance** | several changes only verified "the parsed SVG/rule value is correct" without a rendered screenshot comparison | open the real files and compare by eye |
| 2 | **Paragraph boundaries on the real engine** | paragraph editing infers the end line from `data-line` (the paragraph's first line) as "the start line of the next block minus one"; nested structures (list items, blockquotes, inside code blocks) may be imprecise | open a document with nested lists/quotes/code blocks, open each paragraph for editing, and check that the sliced source is complete |
| 3 | **The whole `workspace.fs` write path** | rename-conflict wording, the fallback when `useTrash` is unavailable, recursive directory copy, error paths on read-only file systems — all unit-tested, never clicked in the real product | perform each operation in a real workspace and watch the messages |
| 4 | **Actual execution of extension-contributed `explorer/context` commands** | collecting the command ids is reliable, but "whether the argument types match when executed" was not tried one by one | select a file and click each extension command |
| 5 | **`package.nls.json` read by a real VS Code** | whether the localisation of command titles and setting descriptions is picked up correctly | use a non-English UI and check the command palette and the settings page |
| 6 | **Timing of the read-only tab replacement** | how "open natively first, then replace" behaves on slow disks, large files and `preview` tabs | try once with `workbench.editor.enablePreview` on and once off |
| 7 | **Lazy loading in very large directories** | reading and rendering a single level with tens of thousands of entries, deep nesting, network paths | open the subtree panel on `node_modules` or a large directory |
| 8 | **Coverage of the icon-theme language bridge** | the 349 "extension → language id" entries come from `contributes.languages` of the installed extensions and were not compared one by one with VS Code's complete built-in language table; uncovered extensions fall back to the `file` icon | switch a few themes and check that files of different extensions all get the right icon |
| 9 | **3D large-graph performance** | unit tests only cover the 600-node truncation and layout determinism; force-directed layout is O(n²), every node has a Canvas texture and every edge a TubeGeometry, and the real-machine samples had only 3–8 nodes | take a Markdown with 200 elements / a 600-node graph and record open, layout and rotate times plus memory |
| 10 | **Visual correctness of non-ASCII-tree / flowchart / sequence kinds in the real-machine 3D view** | the 12 Mermaid parsers and layouts are unit-tested only; the 1/2 real-machine acceptance looked at ASCII trees, flowchart and sequence only | open class / state / er / mindmap / gitGraph / journey / gantt / timeline / pie / quadrant and a generic fallback graph one by one in the real 3D panel and check that nodes and edges are readable |
| 11 | **Readability of the merged 3D view with complex groups / many edges** | merging has unit tests, but group remapping, edge crossings and text occlusion were not assessed on a real machine | prepare two large graphs with 50+ nodes each, many same-name nodes and groups, merge them, and inspect by eye |
| 12 | **Real-machine behaviour of multi-root workspaces** — ✅ verified (2026-10-26, VS Code 1.137.0, Windows 11) | verified with two roots: default storage and `${workspaceFolder}` follow the first root; `${workspaceFolder:ws-b}` / `${workspaceFolder:1}` resolve to the second root; missing names / indexes show `⚠ path cannot be resolved` with tooltip and click warnings; Explorer context-menu add on the second root stores a placeholder; removing the first root switches the default storage to the new first root (old file untouched), re-resolves `${workspaceFolder}` to the new first root, invalidates index placeholders, and does not crash. Evidence: `.selftest/e2e-resource-tree-multiroot/probe-multiroot*.mjs` and screenshots `mr-01…mr-14` | closed — no further verification needed |
| 13 | **Atomic rename on remote / virtual file systems** | `workspace.fs.rename(overwrite)` may be unsupported by some providers; the current policy is "fail loudly, keep the old file", with no copy+fsync fallback. **Local check (2026-10-26, VS Code 1.137.0)**: the Remote-SSH extension is not installed and no SSH host is available, the WSL optional feature is disabled, Docker / Dev Containers are not installed, and Remote Tunnels has no account — none of the four providers is available. Only an SMB loopback share (`\\localhost\ShareData` → `Z:`, still the `file` provider) was verified: `rename(overwrite:true)` works, `overwrite:false` throws `FileExists`; a 1500-node / 161 KB write took 24–30 ms, the same-directory `.tmp-*` was visible during the write and no leftovers remained; with the target locked by an external process the write failed with `EBUSY ... unlink '<target>'`, the old file stayed byte-identical and the temp file was cleaned up, and the same command succeeded after unlock. **SSH / WSL / Containers / Tunnels and cross-host / non-Windows file systems remain unverified** | edit and save the resource tree over SSH / WSL / Remote Containers and watch for errors |
| 14 | **stat performance on network drives / very large trees** | the per-row synchronous `fs.statSync` is gone and the local 2000-node / 1000-subdirectory benchmark passes (see item 23), but network shares, high latency and provider-specific `workspace.fs` implementations are still untested; external changes can also lag up to the 30 s TTL | point the tree at a network share or a directory with thousands of subdirectories and record first-expand / refresh times and UI responsiveness |
| 15 | **Conflict timing of external concurrent edits** — ✅ verified (2026-10-26, VS Code 1.137.0, Windows 11) | constructed with a real VS Code text-editor buffer and an external writer: external unsaved buffer + extension write → external save → Refresh loses the extension write (VS Code asks overwrite / compare first); extension write → external overwrite → Refresh reads the external version; invalid JSON + Refresh keeps the tree, leaves the file untouched and does not crash; force-killing the extension host between two writes leaves the file intact with no `.tmp-*`. A pre-write canonical comparison with a non-modal Overwrite / Cancel warning was added; Cancel keeps both sides, Overwrite is still last-writer-wins, and the check has a TOCTOU window. Evidence: `.selftest/e2e-resource-tree-concurrency/probe-concurrency.mjs` (17/17), screenshots `cc-01…cc-11` | closed — the remaining mid-write kill window is tracked in item 23 |
| 16 | **Display of symlinks / permission-denied paths** — ✅ verified (2026-10-26, VS Code 1.137.0, Windows 11) | directory symlinks, file symlinks, broken links (directory / file), a read-only directory and an ACL-denied directory were constructed: a directory symlink is treated as a directory, a file symlink shows `⚠ Not a folder`, broken links now show `⚠ Link broken` with an explicit click message; the read-only directory is unchanged; the ACL-denied directory still stats successfully on local NTFS, so the tree shows it as an ordinary folder (not confused with "missing", but no warning). EACCES could not be reproduced on this machine because it ran as Administrator with `SeBackupPrivilege`. Evidence: `.selftest/e2e-resource-tree-symlink/probe-symlink-{before,after}.mjs` and `sym-*.png` | closed, no further verification needed |
| 17 | **The shortcut and executable property pages in a real VS Code window** | the parse, the open policy, the edit rewrite and the PE reader all have unit cases, but no page has been opened in a running window, and the editable route calls the Windows scripting host, which no unit test can execute | open a real `.lnk` and a real `.exe` in this view, change one field and save, then reopen the shortcut and confirm the change landed and the icon and hotkey survived |
| 18 | **The subtree submenu and the system-terminal launch in a real VS Code window** | the two-level menu rendering and the `wispkit.subtree.systemTerminal` contract have unit cases, but neither a submenu nor an actually spawned terminal window has been seen in a running product | right-click a folder in the subtree panel, expand "System terminal", pick cmd, and confirm a window opens in that folder; repeat on a file and confirm it lands in the file's own folder |

> Item 13's local check was completed on 2026-10-26; probes and screenshots are under `.selftest/e2e-resource-tree-remote/` (`probe-remote.mjs`, `probe-ui-only.mjs`, `rem-01…rem-03`). None of the four named providers is available on this machine, so the item **stays unverified**; only evidence from the `file` provider over an SMB loopback share was obtained, and the share and VS Code run on the same Windows host, so it does not represent a cross-host / Linux file system. Side observation: with the target locked, `workspace.fs.rename(overwrite:true)` failed with `EBUSY ... unlink '<target>'`, i.e. the path performs an unlink of the target; if the unlink succeeds and the following rename fails (e.g. the process is killed), the old file may already be gone and only the `.tmp-*` remains. There is still no copy+fsync fallback.

> Item 9 was closed in this documentation pass: the links and anchors across the three language versions are checked automatically by `node tools/docs-check.mjs`, and only **0 problems** counts as passing.

> Item 12 was closed on 2026-10-26: multi-root behaviour was verified on a real machine (probes and screenshots under `.selftest/e2e-resource-tree-multiroot/`). The row is kept only to preserve the numbering of the following items.

> **3D panel verification already done**: entry points (context menu / command palette), re-opening only reveals, title counts, left/right selects with 15%–85% split panes, merge / `Esc`, spacing slider, refresh, reset view, left-drag rotate / right-drag pan / wheel zoom, window resizing, and a packaged-VSIX re-check all passed on VS Code 1.137.0 (probes under `.selftest/e2e-graph3d/`, 2026-10-26). The table above lists only what is still unverified.

## 3. How to use this list

- **Before relying on a behaviour**, confirm it is not in the "unverified" section above.
- **When reporting a bug**, if it falls in one of those rows, it may be a known blind spot rather than a new problem.
- This document lists only "currently impossible / not verified", never "planned" — plans live in the board or the commit history.
