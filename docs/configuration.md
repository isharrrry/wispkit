---
type: Guide
title: Configuration
description: Field-level reference for every setting, plus Wispkit.json, custom tools and execution modes
tags: [configuration, settings, reference]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Configuration

**English** | [中文](configuration.zh-CN.md) | [Español](configuration.es.md)

Every setting is defined under `contributes.configuration` in `package.json`; there are **13** of them.

## Overview

| Key | Type | Default | Applies to | When to change it | Side effects |
|---|---|---|---|---|---|
| `wispkit.toc.enabled` | boolean | `true` | Markdown view | the body is wide enough and you only want the content | the whole sidebar is not rendered and TOC jumping goes with it |
| `wispkit.toc.depth` | number (1–6) | `3` | Markdown view | a deep document hierarchy and fast section jumps | at 6 the sidebar becomes very crowded |
| `wispkit.zoom.wheelStep` | number (1.01–3) | `1.1` | image / modal / XAML render | one wheel notch jumps too far | all three places change together; 1.01 is almost imperceptible |
| `wispkit.image.wheelZoom` | boolean | `true` | image view | you want the wheel to scroll through the image quickly | once off, zooming requires holding Ctrl again |
| `wispkit.image.dragButton` | `right` \| `middle` \| `left` | `right` | image view | the right button is taken by a system gesture | `left` fights the system drag/selection; not recommended |
| `wispkit.xaml.codeVisible` | boolean | `true` | XAML view | you only want the render, not a source pane taking space | the source pane disappears and only the centred render remains |
| `wispkit.xaml.codeWidth` | number (≥160) | `460` | XAML view | a deep control tree or very long source lines | squeezes the render area in narrow windows; the dragged value wins |
| `wispkit.readonly.default` | boolean | `false` | global read-only mode | you only browse and do not want to edit files by accident | rewrites `workbench.editorAssociations`, removed again when turned off |
| `wispkit.readonly.previewBytes` | number (≥1024) | `65536` | global read-only mode | large files, opening should be faster | the rest is **not loaded** (not collapsed) |
| `wispkit.readonly.previewLines` | number (≥50) | `800` | global read-only mode | you only want the first N lines | the rest is not displayed, with a truncation notice at the end |
| `wispkit.readonly.extensions` | string[] | 61 glob patterns | global read-only mode | only specific types should be read-only | any change rewrites the associations; **do not** add `.md`/`.html`/`.xaml`/images |
| `wispkit.subtree.columns` | string[] (9 enum values) | `name,size,type,mtime,ctime,owner` | subtree panel | you want to review a directory by modified time or size | invalid values filtered, duplicates removed, empty falls back to the default |
| `wispkit.subtree.tools` | object[] | `[]` | subtree panel | you want to hang frequently used external commands on the right of the panel | arguments are not shell-escaped; `external` really opens a window |

## Table of contents

### `wispkit.toc.enabled`

- Type `boolean`, default `true`.
- When `false` the whole TOC sidebar is not rendered and the body takes the full width.
- Affects the Markdown view only; changes take effect immediately (reopen the view or reload with a command).

### `wispkit.toc.depth`

- Type `number`, default `3`, range 1–6.
- Determines how deep the TOC tree goes. At 6 every heading enters the tree and long documents become crowded.
- Independent of the body; affects the sidebar only.

## Zoom

### `wispkit.zoom.wheelStep`

- Type `number`, default `1.1`, range 1.01–3.
- The zoom factor **per wheel notch**: `1.1` means 10% larger each notch.
- The same panzoom is shared by three places: the image view, the Markdown full-screen modal and the XAML render — changing it changes all three.

## Image view

### `wispkit.image.wheelZoom`

- Type `boolean`, default `true`.
- `true`: the wheel zooms directly, no Ctrl needed.
- `false`: falls back to "hold Ctrl to zoom" and the wheel returns to scrolling.

### `wispkit.image.dragButton`

- Type `string`, enum `right` / `middle` / `left`, default `right`.
- Which button pans the image while held down.
- Setting it to `left` conflicts with the system drag behaviour; not recommended.

## XAML view

### `wispkit.xaml.codeVisible`

- Type `boolean`, default `true`.
- Whether the source pane on the left is shown; when `false` only the rendered image remains (centred).

### `wispkit.xaml.codeWidth`

- Type `number`, default `460`, minimum `160` (pixels).
- The initial width of the source pane. It can be changed temporarily by dragging the splitter at runtime; the dragged value wins.

## Global read-only mode

### `wispkit.readonly.default`

- Type `boolean`, default `false`.
- Whether the extension starts in read-only mode. It can be toggled at runtime from the switch on the right of the status bar (`wispkit.toggleReadOnly`).

### `wispkit.readonly.previewBytes`

- Type `number`, default `65536` (64 KB), minimum `1024`.
- The **maximum number of bytes** the read-only preview loads; anything beyond is not loaded. This is the actual mechanism behind "save the rendering cost".

### `wispkit.readonly.previewLines`

- Type `number`, default `800`, minimum `50`.
- The **maximum number of lines** the read-only preview displays (a line truncation applied after the byte limit).

### `wispkit.readonly.extensions`

- Type `string[]`, default 61 glob patterns (`.txt` `.log` `.json` `.ts` `.py` `.cs` …).
- The file types read-only mode applies to. When it is on, these types are written into `workbench.editorAssociations` so that their native open handler becomes the read-only view.
- **Deliberately excludes** the browsing types Wispkit itself owns (`.md` / `.html` / `.xaml` / images) — truncating them would render a broken result.
- An empty array means read-only mode applies to no file at all.

## Subtree panel

### `wispkit.subtree.columns`

- Type `string[]`, default `["name","size","type","mtime","ctime","owner"]`.
- Enum: `name` `ext` `size` `mtime` `ctime` `atime` `owner` `mode` `type`.
- **The array order is the column order.** Invalid values are filtered out, duplicates are removed, and an empty result falls back to the default (pure logic in `src/subtree/columns.ts`, unit-tested).
- Two columns are known to be always empty: `atime` (access time) and `mode` (POSIX permission bits) — VS Code's `FileStat` does not expose them, so they display `-`.

### `wispkit.subtree.tools`

An array of custom tools, empty by default. Each item is shaped like this:

```jsonc
{
  "label": "Open in terminal",       // required, the button text
  "command": "powershell",           // required, the executable or command
  "args": ["-NoExit", "-Command", "cd '${dir}'"],  // optional
  "shell": "newTerminal"             // optional, defaults to silent
}
```

| Field | Required | Notes |
|---|---|---|
| `label` | ✅ | the button text |
| `command` | ✅ | the command to run |
| `args` | — | argument array |
| `shell` | — | `silent` / `currentTerminal` / `newTerminal` / `external` |

**The four execution modes**:

| `shell` | Behaviour | Typical use |
|---|---|---|
| `silent` (default) | runs in the background, no window, no terminal | formatting, statistics |
| `currentTerminal` | writes into the active terminal | `cd` or run a command in an existing terminal |
| `newTerminal` | creates a terminal and writes into it | tasks that need a terminal of their own |
| `external` | starts a system terminal window as a detached process | programs that need an interactive window |

**Placeholders** (substituted in `command` and `args`):

| Placeholder | Replaced with |
|---|---|
| `${file}` | the absolute path of the selected entry |
| `${dir}` | the absolute path of the selected entry's parent directory |
| `${name}` | the file name of the selected entry (with extension) |
| `${workspaceFolder}` | the absolute path of the first workspace folder |

Substitution is **plain string replacement** with no shell escaping — when a path contains spaces, add the quotes yourself in the configuration (`"cd '${dir}'"`).

## `configurationDefaults`: mermaid zooms out of the box

`package.json` contains a `contributes.configurationDefaults` block:

```json
{ "markdown-mermaid.mouseNavigation.enabled": "always" }
```

The built-in mermaid front-end script has pan/zoom, but by default it requires **holding Alt** (that setting defaults to `alt`). This extension raises the default to `always`, so mermaid diagrams zoom with the wheel and pan by drag out of the box.

Two preconditions: ① the built-in `mermaid-markdown-features` must be installed (VS Code ships it); ② when the user has explicitly changed that setting, the user value wins. When the extension is not installed this is a harmless unregistered key.

## `.WispkitView/Wispkit.json`

The "Show" icon on the left of an Explorer folder row reads this file.

**Lookup order**:

1. `<folder>/.WispkitView/Wispkit.json`
2. `<folder>/Wispkit.json`

**Schema**:

```jsonc
{
  "title": "Demo project",               // optional: panel/tab title
  "entry": ".WispkitView/index.html",    // required: entry file relative to the folder
  "openWith": "wispkit.html"             // required: viewType
}
```

**Validation**: `entry` must stay inside that folder (escaping it is rejected), and `openWith` must be a registered viewType. A missing configuration or a failed check produces a visible message, never a silent failure.

## A complete settings.json example

```jsonc
{
  // Markdown
  "wispkit.toc.enabled": true,
  "wispkit.toc.depth": 4,

  // Images and zoom
  "wispkit.zoom.wheelStep": 1.15,
  "wispkit.image.wheelZoom": true,
  "wispkit.image.dragButton": "middle",

  // XAML
  "wispkit.xaml.codeVisible": true,
  "wispkit.xaml.codeWidth": 520,

  // Read-only mode
  "wispkit.readonly.default": false,
  "wispkit.readonly.previewBytes": 32768,
  "wispkit.readonly.previewLines": 500,

  // Subtree panel
  "wispkit.subtree.columns": ["name", "size", "mtime", "owner"],
  "wispkit.subtree.tools": [
    {
      "label": "Show in Explorer",
      "command": "explorer",
      "args": ["${dir}"],
      "shell": "external"
    }
  ]
}
```
