---
type: Guide
title: Known limitations and unverified items
description: What Wispkit cannot do, why each limit exists, and what has never been verified on a real machine
tags: [limitations, unverified, honesty]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
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

### 4. Markdown / images / XAML take over the default open handler

- **Symptom**: after installing, double-clicking `.md`, an image or `.xaml` lands in the Wispkit view instead of the built-in editor.
- **Cause**: those three views are `priority: default` in `package.json` (required for "double-click opens it").
- **Workaround**: right-click the file → *Reopen Editor With…* and pick the built-in editor; or pin it through `workbench.editorAssociations`.
- **Note**: **HTML and read-only text are `option` priority** and do not compete by default; switch to them explicitly when needed.

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

- **Symptom**: Markdown / HTML / XAML / images still open as usual in read-only mode.
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

> Item 9 was closed in this documentation pass: the links and anchors across the three language versions are checked automatically by `node tools/docs-check.mjs`, and only **0 problems** counts as passing.

## 3. How to use this list

- **Before relying on a behaviour**, confirm it is not in the "unverified" section above.
- **When reporting a bug**, if it falls in one of those rows, it may be a known blind spot rather than a new problem.
- This document lists only "currently impossible / not verified", never "planned" — plans live in the board or the commit history.
