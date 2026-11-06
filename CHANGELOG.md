# Changelog

All notable changes to this extension are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at 0.2.14, the first version published under the current publisher
ID. Earlier builds were local only, so there is no released history to reconstruct; the
entries below describe what the extension contains, not what changed since an earlier
public release.

## [Unreleased]

### Added

- **Windows shortcut (`.lnk`) and executable (`.exe`) property pages** — two `option`-priority
  custom editors that inspect a file instead of launching it. The shortcut page reports the
  target, working directory, arguments, icon location, volume label, creation machine and flags,
  and on Windows lets the target, working directory, arguments and comment be edited — only the
  changed fields are written back, so the icon and hotkey survive. The executable page reports
  the PE format, architecture, subsystem, DLL and .NET flags, entry-point RVA, image base,
  sections and version resources.
- **Four settings** for the two kinds: `wispkit.shellLink.openBehavior` (`system` / `internal` /
  `ask`), `wispkit.shellLink.folderTarget` (`subtree` / `system`), `wispkit.shellLink.allowEdit`
  and `wispkit.executable.openBehavior` (`system` / `viewer` / `ask`), plus six context-menu
  commands on the Explorer row of the two file types.
- Starting an executable from Wispkit pins the working directory to the executable's own
  directory; starting a shortcut leaves the start-in directory recorded inside it untouched.
- **Real file icons in the subtree list** — `.lnk` and `.exe` rows show the icon embedded in the
  file itself (on Windows through the shell association Explorer uses, so a shortcut shows the
  program it points at); other file kinds and other platforms keep falling back to the icon theme.
- **Type-ahead in the subtree list** — typing a letter or a digit jumps to the first name starting
  with it, pressing the same character again walks down and wraps around, and Chinese names match
  the text the input method commits. The new `wispkit.subtree.typeAhead` setting turns it off.
- **System terminal from the subtree panel** — "System terminal" in the action area and the
  right-click menu opens a submenu whose entries come from the platform (cmd, PowerShell, both
  with an elevated variant on Windows; Terminal.app on macOS; the desktop terminal on Linux).
  The window starts in the selected folder, or in the selected file's own folder, and is
  independent of the editor.
- **Open with the default application** — a subtree action that hands the selected files to the
  application registered with the operating system, the same thing double-clicking does. It is
  offered for files only; folders keep using "Open folder in new window".

## [0.2.15] - 2026-11-06

### Fixed

- **Right-click menu scrolling** in the subtree browser and compare browser: the menu is
  now scrollable with the wheel and its scrollbar, and scrolling inside it no longer
  closes the menu. Clicking or dragging the menu's scrollbar no longer dismisses it
  either. Reaching the top/bottom of the menu no longer chains the scroll to the tree
  behind it, and long menus are capped to the viewport height in every webview.

## [0.2.14] - 2026-11-06

### Added

- **Seven custom editors**, none of which patch VS Code: Markdown, Mermaid, image,
  video, HTML, XAML and read-only text. Markdown, Mermaid, image, video, HTML and XAML
  take over their file types by default; read-only text is opt-in through
  *Reopen Editor With…*.
- **Markdown browsing**: tree navigation, multi-step toolbar zoom (50%–300%) with
  Ctrl+wheel, Ctrl+F find with highlighting and jump-to-match, media context menu
  (save as / copy path / copy source), in-place drawio block editing, in-place paragraph
  editing, and virtualisation for large documents (verified on a 400 KB file of diagrams
  and tables).
- **3D graph browsing for Markdown and Mermaid**: right-click a `.md` or `.mmd` file to
  browse its topology, pick one graph per side, rotate / pan / zoom, and merge graphs
  through same-name nodes. Edge names toggle on demand; hovering a node reads its
  comment; a node named exactly `void` renders no bubble and its flows become dangling
  arrows; a node named `[text](image)` renders the image on the bubble when the path
  resolves. Layouts are mutually exclusive, so two graphs push their core nodes to
  opposite ends with fusion nodes between them.
- **Mermaid file preview**: double-click `.mmd` / `.mermaid` to render the diagram.
- **Image browsing** for PNG / JPG / GIF / BMP / ICO / WebP / AVIF / APNG / SVG and more,
  with cursor-anchored wheel zoom, right-button drag panning, double-click fit / 100%,
  and SVG re-rendering at the new layout size. HEIF / TIFF / JXL report the missing
  decoder and offer one-click hand-off to the system default app.
- **Video playback** in a native `<video>` element (MP4 / WebM / MOV / MKV / AVI / WMV /
  FLV / RMVB…), with the same hand-off fallback for unsupported containers and codecs.
- **In-editor link routing** for Markdown and HTML: relative paths resolve against the
  document, and `vscode://file/<path>:<line>` links open in the current window at that
  line instead of being thrown at the system browser.
- **XAML view** with source and render side by side, pan and zoom on the render, and
  edits saved back to the file. The renderer ships as a framework-dependent .NET 10
  Windows Desktop binary inside the VSIX.
- **Read-only mode** that reads the first N bytes, builds no `TextDocument` and never
  loads the whole file; a floating button switches to the native editor.
- **Explorer subtree panel** with configurable columns (size / time / type / owner…), an
  action area and custom tools.
- **Custom resource management view** in the Activity Bar: virtual groups and folders at
  arbitrary depth, drag and drop, import / export, and direct JSON editing, persisted to
  `.WispkitView/resource-tree.json` inside the workspace.

### Security

- Markdown and XAML views reuse the built-in preview's Strict CSP (`nonce` +
  `cspSource`, no `unsafe-inline`), so third-party preview scripts written against that
  policy keep working.
- The HTML view uses a relaxed CSP because browsing HTML requires the page's own scripts
  to run; the risk level is comparable to the built-in Simple Browser.
