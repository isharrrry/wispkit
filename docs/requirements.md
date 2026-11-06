---
type: Specification
title: Requirements and acceptance criteria
description: The authoritative requirement contract of Wispkit — every delivered capability by requirement number, its acceptance criteria, and the change protocol every other document follows
tags: [requirements, specification, acceptance]
status: stable
---

# Requirements and acceptance criteria

**English** | [中文](requirements.zh-CN.md) | [Español](requirements.es.md)

> This document is Wispkit's requirement contract: every delivered capability under a stable requirement number, the acceptance criteria it is judged by, and the change protocol every other document follows.

## Status of this document

Wispkit is a browsing-enhancement extension for Visual Studio Code. This file states **what the extension shall do**, independent of how any particular release does it.

- **This file is the authoritative statement of requirements.** Where another document contradicts it, this file wins and the other document is defective.
- [Architecture](architecture.md), [Views and interaction](views-and-interaction.md), [Configuration](configuration.md) and [Build and verify](build-and-verify.md) are **implementation notes**. They describe how a capability is realised and how to reproduce a measurement. They never extend or narrow what is promised here.
- **Anything not listed here is not a commitment.** A behaviour that exists without a requirement number is an implementation detail and may change without notice.
- **Every known failure and every unverified item has exactly one home in [Known limitations](limitations.md) and one row in [§6 Deferred and excluded](#6-deferred-and-excluded).** The two must not contradict each other; a contradiction is a documentation defect, not a nuance.

## Reading conventions

### Normative keywords

| Keyword | Meaning |
|---|---|
| **SHALL** / **MUST** | An absolute requirement. A release that violates it is defective, not "approximately right". |
| **SHALL NOT** / **MUST NOT** | An absolute prohibition. |
| **MAY** | Genuinely optional; either choice is conforming. |
| **WHEN … THEN …** | The mandatory shape of every acceptance criterion: a triggering situation, then an externally observable outcome. |

### Requirement and criterion numbering

| Identifier | Meaning |
|---|---|
| `R<n>` | One requirement. Numbers are allocated **in the order capabilities were commissioned** and are never reused. |
| `AC-R<n>.<m>` | The *m*-th acceptance criterion of requirement *n*. A requirement with no criterion is not a requirement. |
| `demo/R<n>-*/` | The acceptance fixture set for requirement *n*. That mapping is part of the contract: renaming or deleting a fixture directory breaks traceability. |

Three numbering facts are load-bearing and must survive any later edit:

1. **`R7` is retired and must not be reused.** It was originally allocated to two capabilities commissioned together — the global read-only mode and the Explorer subtree panel — which were later split apart. Both eventually received their own numbers (`R10` and `R11`); the shared number was vacated rather than reassigned, so that no historical reference silently changes meaning.
2. **`R12` is not a capability of its own.** It is the fixture set produced for the XAML view after its renderer was replaced, and it is recorded under `R6`. Both `demo/R6-xaml/` and `demo/R12-xaml/` are legitimate acceptance fixtures for `R6`; neither may be deleted on the grounds that "the other one already covers it".
3. **`R9` covers a view, not a fixture directory only.** Its live storage file is created on first edit, so a fresh workspace legitimately shows an empty tree before `demo/R9-resource-tree/` is loaded.

## 1. Product intent

1. **The extension SHALL enhance browsing without modifying the host.** It MUST NOT patch, replace or write into the Visual Studio Code installation, and MUST NOT ship a modified asset of a built-in extension. Every capability is delivered through the public extension surface and survives a host upgrade without re-patching.
2. **The host SHALL own paths; the webview SHALL own interaction.** A resource URL inside a webview MUST be treated as opaque and MUST NOT be reverse-mapped into a filesystem path. Whenever the front end needs a real path or a source fragment, it SHALL report a position, and the host SHALL re-read the path from the original document.
3. **Rendering SHALL go through the host's own pipeline.** Markdown SHALL be rendered by the host's built-in Markdown renderer so that every third-party plugin contributed by other extensions keeps working. The extension MUST NOT substitute a private Markdown implementation for the default path.
4. **"Read-only" SHALL mean "not loaded", not "editing disabled".** The read-only mode exists to avoid the cost of loading a file, so it MUST avoid materialising the whole document; capping the loaded window is the requirement, not an optimisation.
5. **A capability MAY be judged only by externally observable results.** An acceptance criterion SHALL describe what a user or an automated observer can see after an action, never that a rule, setting or message exists.

## 2. Scope and non-goals

### In scope

| Area | Delivered by |
|---|---|
| Markdown browsing: directory navigation, body zoom, in-document find, media context menu, in-place drawio editing, in-place paragraph editing, large-document performance | `R1`, `R2`, `R15`, `R16`, `R17` |
| Diagram browsing: Mermaid zoom in Markdown, standalone Mermaid file view, 3D topology browsing | `R3`, `R8`, `R13` |
| Media browsing: images with wheel zoom and button-drag pan, video playback with a system-player fallback | `R4`, `R14` |
| Web content: HTML view with internal link routing | `R5` |
| XAML source and render side by side | `R6` |
| Read-only text browsing with an unlock path | `R10` |
| File organisation: custom resource tree in the Activity Bar, Explorer subtree panel | `R9`, `R11` |
| Localisation of the extension's own surface | `R18` |
| Windows shortcut and executable property pages | `R19` |

### Out of scope

| Not delivered | Why |
|---|---|
| Taking over the host's Simple Browser page | It is created by a command as a webview panel and never enters the custom-editor competition; taking it over is not expressible through the public surface |
| Changing any built-in extension's behaviour or assets | Violates intent 1; a built-in extension is only ever *consumed*, never modified |
| Editor ↔ preview scroll synchronisation | Requires a source-map protocol the preview does not produce; directory navigation deliberately does not depend on it |
| A general source-map layer between rendered output and source lines | The only source line consumed is the one needed to locate a paragraph; a full mapping is a different feature with its own accuracy budget |
| Bundling large third-party decoders for images and video | A codec such as HEIF costs megabytes and contradicts the "no large dependency" rule; those formats get an explicit hand-off instead |
| A 2D fallback for the 3D scene | The 3D panel is a topology instrument, not a diagram renderer; a 2D projection would silently promise a different product |
| Re-implementing a diagram library's renderer for visual parity | The 3D view consumes topology only; pixel parity with the diagram library's themes is explicitly not promised |
| Pre-loading cross-file resource dictionaries when rendering XAML | Requires resolving an application's resource graph, which is application-specific and unbounded |

## 3. Requirements

### R1  Third-party Markdown preview scripts run under a strict CSP

**Requirement.** The Markdown view SHALL execute every script and apply every stylesheet contributed by other installed extensions through the host's Markdown preview contribution points. The view MUST use a strict content-security policy: scripts SHALL be admitted only by nonce, and inline script MUST NOT be admitted by policy relaxation. When the document changes, the extension SHALL notify the contributed scripts so they can re-render.

**Rationale.** Diagram rendering, math typesetting and syntax colouring in the Markdown ecosystem arrive as contributed preview scripts. A private renderer would silently drop them, which is why intent 3 makes the host pipeline mandatory. Reusing the host's own policy means a third-party script written against the built-in preview works here unchanged.

**Acceptance criteria.**

- **AC-R1.1** — **WHEN** an installed extension contributes preview scripts or styles, **THEN** opening a Markdown document shows their rendered output (diagrams, formulas, highlighting) without any per-extension configuration.
- **AC-R1.2** — **WHEN** the view has finished rendering, **THEN** the count of content-security-policy violations is zero.
- **AC-R1.3** — **WHEN** the document text changes, **THEN** the contributed scripts re-run and their output reflects the new text.
- **AC-R1.4** — **WHEN** the contributing extension is uninstalled and the document is reopened, **THEN** the view still renders and reports no error.
- **AC-R1.5** — **WHEN** a relative image reference exists in the document, **THEN** it loads from the document's own directory rather than from the extension's install directory.

**Evidence.** [Views and interaction → Markdown view](views-and-interaction.md#markdown-view-wispkitmarkdown); fixtures in `demo/R1-injection/`; measured in [Build and verify](build-and-verify.md#real-machine-self-test-extension-toolsselftest).

### R2  Directory navigation follows the document

**Requirement.** The Markdown view SHALL present a sidebar listing every heading of the document, SHALL highlight the section currently in view while the body scrolls, and SHALL jump to a heading when its entry is activated. The sidebar width SHALL be adjustable and resettable, and the sidebar SHALL be removable in one action.

**Rationale.** A long document is navigated by its structure. Highlighting is derived from rendered geometry rather than from a source map, which is what keeps this capability independent of scroll synchronisation.

**Acceptance criteria.**

- **AC-R2.1** — **WHEN** a document containing headings is opened, **THEN** the number of sidebar entries equals the number of headings the document actually contains.
- **AC-R2.2** — **WHEN** the body is scrolled to a section, **THEN** that section's entry is shown as current, with no entry left stale.
- **AC-R2.3** — **WHEN** an entry is activated, **THEN** the corresponding heading lands at the top of the viewport within a tolerance of one line height.
- **AC-R2.4** — **WHEN** the splitter is dragged and then double-clicked, **THEN** the sidebar returns to its default width.
- **AC-R2.5** — **WHEN** the sidebar is disabled through configuration, **THEN** the whole sidebar is absent and the body occupies the full width.
- **AC-R2.6** — **WHEN** the document is edited so that headings are added or removed, **THEN** the sidebar is rebuilt and still satisfies AC-R2.1.

**Evidence.** [Views and interaction → Table of contents](views-and-interaction.md#table-of-contents); fixtures in `demo/R2-toc/`.

### R3  Mermaid diagrams in Markdown zoom and pan by default

**Requirement.** The Markdown view SHALL let a reader enlarge and pan a Mermaid diagram **without holding a modifier key**, and SHALL offer a full-window view for close inspection. Enlargement SHALL remain available after the document is edited and the diagram re-rendered.

**Rationale.** A diagram in a document column is frequently unreadable at its laid-out size, and requiring a modifier key makes the capability effectively undiscoverable. The capability belongs to the reader of the document, who may have no diagram extension configured.

**Acceptance criteria.**

- **AC-R3.1** — **WHEN** a diagram is displayed and the pointer is over it, **THEN** the wheel changes its scale with no modifier key held.
- **AC-R3.2** — **WHEN** a diagram is enlarged, **THEN** dragging pans it and a reset gesture returns it to its original scale.
- **AC-R3.3** — **WHEN** the document is edited and the diagram re-rendered, **THEN** enlargement and panning still work on the new output.
- **AC-R3.4** — **WHEN** the enlarged view is open, **THEN** closing it restores the document exactly as it was, without altering the diagram in the document.
- **AC-R3.5** — **WHEN** the diagram is enlarged in the full-window view, **THEN** its colours match the colours it had in the document column.

**Evidence.** [Views and interaction → Media context menu](views-and-interaction.md#media-context-menu); fixtures in `demo/R3-mermaid/`; the configuration default that removes the modifier requirement is documented in [Configuration](configuration.md#configurationdefaults-mermaid-zooms-out-of-the-box).

### R4  Images zoom on the wheel and pan by button drag

**Requirement.** The image view SHALL zoom on a plain wheel gesture, anchored at the pointer, SHALL pan while a drag button is held, and SHALL toggle between fitting the window and 100% on double-click. Zooming SHALL NOT blur a raster image beyond its source resolution, and SHALL re-render a vector image at the new layout size. For formats the host runtime cannot decode, the view SHALL state the reason and offer a hand-off rather than show a blank page.

**Rationale.** Browsing an image is a comparison task: the reader wants to see detail without losing the place. Anchoring at the pointer is what makes repeated wheel gestures converge on the point of interest instead of drifting.

**Acceptance criteria.**

- **AC-R4.1** — **WHEN** the pointer is over the image and the wheel turns with no modifier held, **THEN** the image scales about the pointer and the view centre does not jump.
- **AC-R4.2** — **WHEN** the configured drag button is held and the pointer moves, **THEN** the image pans; releasing the button stops the pan.
- **AC-R4.3** — **WHEN** the image is double-clicked, **THEN** it toggles between fit-to-window and 100%.
- **AC-R4.4** — **WHEN** a raster image is enlarged past three times its fitted size, **THEN** it is rendered with nearest-neighbour scaling so that pixels stay legible.
- **AC-R4.5** — **WHEN** a vector image is enlarged, **THEN** its layout size changes rather than only its transform, so edges stay sharp.
- **AC-R4.6** — **WHEN** a file in a selected but undecodable format is opened, **THEN** the page names the reason and offers both a hand-off to the system default application and a copy-path action.
- **AC-R4.7** — **WHEN** the zoom configuration is disabled, **THEN** the wheel no longer zooms and a modifier becomes required again.

**Evidence.** [Views and interaction → Image view](views-and-interaction.md#image-view-wispkitimage); fixtures in `demo/R4-image/`; probe results in [Build and verify](build-and-verify.md).

### R5  Links inside rendered content open in the host window

**Requirement.** Both the Markdown view and the HTML view SHALL route activation of a link: a relative target SHALL resolve against the document's own directory, a target that addresses a file inside the editor with a line number SHALL open **in the current window** at that line, an in-document anchor SHALL scroll the document, and a target the host handles itself (web, mail, an already supported scheme) SHALL be left to the host. A link whose default activation the page itself already prevented SHALL NOT be taken over.

**Rationale.** Documentation routinely cross-references source files by path and line. Throwing such a link at the system browser loses the position and interrupts the reading context.

**Acceptance criteria.**

- **AC-R5.1** — **WHEN** a relative link is activated, **THEN** the target opens resolved against the document's directory, not against the extension install directory.
- **AC-R5.2** — **WHEN** a link addressing a file with a line number is activated, **THEN** the file opens in the current window with the caret on that line — not in a new window and not in the system browser.
- **AC-R5.3** — **WHEN** an in-document anchor is activated, **THEN** the document scrolls to it without a page reload.
- **AC-R5.4** — **WHEN** a web or mail link is activated, **THEN** the host handles it by its own policy.
- **AC-R5.5** — **WHEN** a page prevents a link's default activation itself, **THEN** the extension does not reopen it.
- **AC-R5.6** — **WHEN** the page's own script is blocked by its content-security policy, **THEN** the two rewritten link forms still navigate.

**Evidence.** [Views and interaction → HTML view](views-and-interaction.md#html-view-wispkithtml); fixtures in `demo/R5-jump/`.

### R6  XAML source and rendered result side by side

**Requirement.** The XAML view SHALL show the source of a `.xaml` file next to a rendered image of it, SHALL let the source be edited and re-rendered from the current text without an intermediate save, and SHALL let the render be zoomed, panned and viewed full-window. Saving SHALL write back to the same file. The rendered result SHALL be presented as a static snapshot, and the view SHALL state the reason when rendering fails.

**Rationale.** Reading a layout definition without seeing its result is guesswork; editing a layout while switching windows to see the effect is slow. The capability is deliberately a snapshot: binding against live data and running event handlers would require hosting the application, which contradicts intent 1.

**Acceptance criteria.**

- **AC-R6.1** — **WHEN** a `.xaml` file is opened in this view, **THEN** the source is shown beside a rendered image of it.
- **AC-R6.2** — **WHEN** the source is edited and re-render is requested, **THEN** the new image reflects the edited text before the file is saved.
- **AC-R6.3** — **WHEN** the source is saved, **THEN** the file on disk matches the edited text.
- **AC-R6.4** — **WHEN** the render is displayed, **THEN** the wheel zooms, a button drag pans, and a full-window view is available.
- **AC-R6.5** — **WHEN** rendering fails, **THEN** the page states the failure and its common causes instead of showing a blank area.
- **AC-R6.6** — **WHEN** the same `.xaml` is rendered twice with unchanged text, **THEN** both renders are non-blank and visually equivalent.
- **AC-R6.7** — **WHEN** the root element is a type that cannot be instantiated in a snapshot, **THEN** the view still renders the layout by hosting it on the base type, or reports why it could not.

**Evidence.** Fixtures in `demo/R6-xaml/` (first generation) and `demo/R12-xaml/` (second generation, with recorded render artefacts); renderer contract and measured coverage in [the renderer notes](../tools/xaml-render/README.md); the snapshot boundary is [Known limitations](limitations.md#6-xaml-rendering-is-a-static-snapshot).

### R8  3D topology browsing of Markdown and Mermaid graphs

**Requirement.** The extension SHALL open a 3D panel that renders the topology of graph elements found in a Markdown document or a Mermaid file, SHALL let two elements be displayed side by side and merged through same-name nodes, and SHALL provide camera, layout and spacing controls. The panel SHALL indicate when it merges, how many nodes it merged, and which flows terminate at a placeholder.

**Rationale.** A document that accumulates diagram versions is compared by structure, not by styling: which nodes are shared, which are unique. A side-by-side 2D reading forces the reader to diff by eye.

**Acceptance criteria.**

- **AC-R8.1** — **WHEN** the 3D entry is invoked on a Markdown file, **THEN** the panel opens listing every graph element in that document by a name derived from the document, not by a file offset.
- **AC-R8.2** — **WHEN** the same file is asked for again while the panel is open, **THEN** the existing panel is revealed and no second panel is created.
- **AC-R8.3** — **WHEN** two elements are selected, **THEN** they are displayed side by side with a draggable divider constrained to a stated range and resettable by double-click.
- **AC-R8.4** — **WHEN** merge is requested, **THEN** nodes with equal names across the two sides become one node, duplicate flows are collapsed, and the panel states the number merged.
- **AC-R8.5** — **WHEN** the two elements share no node name, **THEN** merge still succeeds, reports zero merged nodes, and keeps the two sides visually distinct.
- **AC-R8.6** — **WHEN** the pointer drags with the primary button, **THEN** the camera rotates; with the secondary button it pans; the wheel zooms.
- **AC-R8.7** — **WHEN** a node's label is a placeholder marking an absent counterpart, **THEN** it is not drawn as a bubble and its flows become dangling edges whose arrow direction is preserved.
- **AC-R8.8** — **WHEN** a document exceeds the stated element or node cap, **THEN** the excess is truncated and the truncation is reported rather than silently applied.
- **AC-R8.9** — **WHEN** the runtime cannot provide a 3D context, **THEN** the panel states the failure instead of degrading to a 2D rendering.

**Evidence.** [Views and interaction → 3D graph browsing](views-and-interaction.md#3d-graph-browsing-wispkitgraph3d); fixtures in `demo/R8-graph3d/`; probe results in [Build and verify](build-and-verify.md#3d-bundle-and-end-to-end-probes).

### R9  Custom resource management in the Activity Bar

**Requirement.** The extension SHALL provide a view in the Activity Bar in which the user organises frequently used folders into a tree of virtual groups and folders of arbitrary depth. The tree SHALL be persisted as a JSON document inside the workspace, SHALL be editable both through the view and as a file, and every mutation SHALL be written immediately and atomically. Renaming, moving and deleting SHALL affect only the tree, never the filesystem.

**Rationale.** Frequently used folders are scattered across a workspace; reaching one costs a click path every time. Organising them is an annotation of the workspace, not a filesystem operation, so the tree must never move a file as a side effect.

**Acceptance criteria.**

- **AC-R9.1** — **WHEN** no workspace folder is open, **THEN** the view states that a workspace is required and names where the tree would be stored.
- **AC-R9.2** — **WHEN** the tree is empty, **THEN** the view offers the actions that create content and states that no file is moved or deleted.
- **AC-R9.3** — **WHEN** nodes are added, renamed, moved or deleted, **THEN** the stored document reflects the new structure immediately, and no file or directory on disk is renamed, moved or deleted.
- **AC-R9.4** — **WHEN** a folder node's stored path cannot be resolved, **THEN** the node shows a specific warning state distinguishing missing, not-a-folder and unresolvable-placeholder, and the rest of the tree stays usable.
- **AC-R9.5** — **WHEN** a move would place a node inside its own descendant, **THEN** the move is refused with an explanation.
- **AC-R9.6** — **WHEN** the stored document is edited externally and a refresh is requested, **THEN** the tree reloads; **WHEN** the document is invalid, **THEN** the current tree is kept and the file is not overwritten.
- **AC-R9.7** — **WHEN** a write is interrupted, **THEN** the previously stored document is still intact.
- **AC-R9.8** — **WHEN** the tree exceeds the stated node, child or depth cap, **THEN** the excess is truncated on load and the truncation is reported.
- **AC-R9.9** — **WHEN** a virtual group is activated, **THEN** the view explains that a group has no disk counterpart instead of doing nothing.

**Evidence.** [Views and interaction → Custom resource management](views-and-interaction.md#custom-resource-management-wispkitresourcetree); fixtures in `demo/R9-resource-tree/`; probe results in [Build and verify](build-and-verify.md#resource-tree-tests-and-packaging-check).

### R10  Global read-only mode that avoids loading the document

**Requirement.** The extension SHALL provide a status-bar control that switches the editor into a global read-only mode. In that mode, a text file of a configured type SHALL be shown as a read-only preview that loads only a bounded window of the file, SHALL offer an explicit action that reopens that file in an editable editor, and SHALL state when the content shown is truncated. The mode SHALL NOT apply to the browsing views the extension itself owns.

**Rationale.** Reading a large file to inspect its head should not cost the memory of loading the whole file, and should not risk an accidental modification. Both goals require that the document not be materialised, which is why truncated content is a requirement rather than a defect.

**Acceptance criteria.**

- **AC-R10.1** — **WHEN** the read-only control is switched on and a configured file type is opened, **THEN** it opens as a read-only preview rather than in a text editor.
- **AC-R10.2** — **WHEN** a file larger than the configured byte limit is opened in that mode, **THEN** the preview states that only an initial portion was loaded and how much the file holds.
- **AC-R10.3** — **WHEN** the configured line limit is reached, **THEN** the preview stops at that line and says so, and the remainder is not displayed.
- **AC-R10.4** — **WHEN** the unlock action is used, **THEN** that file opens in an editable editor and the read-only preview for it is closed.
- **AC-R10.5** — **WHEN** the mode is switched off, **THEN** subsequent files open in their normal editor.
- **AC-R10.6** — **WHEN** a file type belonging to one of the extension's own browsing views is opened in read-only mode, **THEN** it opens in that browsing view unchanged, without truncation.
- **AC-R10.7** — **WHEN** the application starts and the mode is configured to be on by default, **THEN** the control reflects the active state without the user toggling it.

**Evidence.** [Views and interaction → Read-only text view](views-and-interaction.md#read-only-text-view-wispkittext); fixtures in `demo/R10-readonly/`; probes in [Build and verify](build-and-verify.md).

### R11  Explorer subtree panel and folder entry points

**Requirement.** The extension SHALL provide, on a folder row of the Explorer, an entry point that opens a subtree panel for that folder, and a second entry point that opens a folder's declared showcase entry. The subtree panel SHALL display configurable columns, SHALL load a directory level only when it is expanded, SHALL offer file operations and user-defined tools on the selection, and SHALL accept drag and drop in both directions. Repeating the same request for the same folder SHALL reuse the existing panel.

**Rationale.** The Explorer presents one column of names; reviewing sizes, times or types means leaving it. A temporary panel that follows the selection preserves the browsing context instead of competing with it, which is why it is a panel and not another permanent view.

**Acceptance criteria.**

- **AC-R11.1** — **WHEN** a folder row is inspected, **THEN** both entry points are offered and are absent on non-folder rows.
- **AC-R11.2** — **WHEN** the same folder's panel is requested twice, **THEN** the existing panel is revealed rather than duplicated.
- **AC-R11.3** — **WHEN** a level is collapsed and later expanded, **THEN** that level is read at expansion time.
- **AC-R11.4** — **WHEN** the column configuration is changed, **THEN** the panel shows the configured columns in the configured order, ignoring invalid entries instead of failing.
- **AC-R11.5** — **WHEN** a column's underlying value is not exposed by the host, **THEN** the column displays an explicit placeholder rather than a fabricated value.
- **AC-R11.6** — **WHEN** a user-defined tool is executed, **THEN** its declared placeholders are substituted and it runs in the declared execution mode; an unknown placeholder SHALL be left verbatim rather than silently emptied.
- **AC-R11.7** — **WHEN** a host command offered in the action area is unavailable, **THEN** a warning names the missing command instead of failing silently.
- **AC-R11.8** — **WHEN** files are dropped from the operating system or dragged between two subtree panels, **THEN** the resulting file operations are performed and their outcome is reported.
- **AC-R11.9** — **WHEN** a directory contains more entries than the stated cap, **THEN** the excess is truncated and the truncation is stated in the panel.
- **AC-R11.10** — **WHEN** a printable character is typed while the panel has focus, **THEN** the selection moves to the first visible entry whose name starts with the typed prefix, pressing the same character again continues down the list and wraps around, and turning the switch off stops the behaviour entirely.
- **AC-R11.11** — **WHEN** a visible row is a Windows shortcut or executable, **THEN** the row shows the icon embedded in the file wherever the platform provides one, and falls back to the icon theme otherwise.

**Evidence.** [Views and interaction → Subtree panel](views-and-interaction.md#subtree-panel-wispkitsubtree); fixtures in `demo/R11-subtree/`; probe results in [Build and verify](build-and-verify.md).

### R13  Standalone Mermaid file view

**Requirement.** A standalone Mermaid file SHALL open in a view that renders its diagram, and SHALL offer a source entry, a refresh action and an entry into 3D browsing. When the host provides no Mermaid rendering script, the view SHALL degrade to showing the source with an explanation rather than an empty page.

**Rationale.** A diagram source file is otherwise only text. Reusing the host's Mermaid script keeps one rendering behaviour across the product instead of two that drift.

**Acceptance criteria.**

- **AC-R13.1** — **WHEN** a Mermaid file is opened in this view, **THEN** its diagram is rendered and a status line reports the diagram kind and its node and edge counts.
- **AC-R13.2** — **WHEN** the source entry is used, **THEN** the same file opens in an ordinary text editor beside the view.
- **AC-R13.3** — **WHEN** refresh is used after the file changes, **THEN** the diagram reflects the new source.
- **AC-R13.4** — **WHEN** the 3D entry is used, **THEN** the 3D panel opens for this file and reports the same element counts.
- **AC-R13.5** — **WHEN** no Mermaid rendering script is available, **THEN** the view shows the source with an explanation and keeps its toolbar actions working.

**Evidence.** [Views and interaction → Mermaid file view](views-and-interaction.md#mermaid-file-view-wispkitmermaid); fixture `demo/R8-graph3d/04-standalone.mmd`; measured in [Build and verify](build-and-verify.md).

### R14  Video playback inside the editor

**Requirement.** Common video containers SHALL open in a view that plays them through the host's own media element, without bundling a player. The view SHALL offer a hand-off to the system player and a copy-path action, SHALL report a format it cannot play instead of showing a silent black area, and SHALL stop playback when the view is left.

**Rationale.** Opening a video should not require leaving the editor. Playback capability belongs to the runtime; promising more than the runtime decodes would be a promise the product cannot keep, which is why the fallback is part of the requirement.

**Acceptance criteria.**

- **AC-R14.1** — **WHEN** a supported video file is opened in this view, **THEN** it plays with the runtime's native controls and its duration is reported when known.
- **AC-R14.2** — **WHEN** the runtime cannot play the file's codec or container, **THEN** the page states the reason and offers the system-player hand-off instead of a blank frame.
- **AC-R14.3** — **WHEN** the copy-path action is used, **THEN** the absolute path reaches the clipboard.
- **AC-R14.4** — **WHEN** the user switches to another tab, **THEN** playback stops.
- **AC-R14.5** — **WHEN** a file extension that is also a programming language's source extension is considered, **THEN** it is not claimed by the video view.

**Evidence.** [Views and interaction → Video view](views-and-interaction.md#video-view-wispkitvideo); probe results in [Build and verify](build-and-verify.md).

### R15  In-place paragraph editing in the Markdown view

**Requirement.** The Markdown view SHALL offer an edit mode in which activating a rendered paragraph turns **that paragraph** into an edit box in place, while the rest of the document stays rendered. The edit box SHALL hold that paragraph's source verbatim, SHALL express a paragraph break distinctly from a soft line break, SHALL support commit and discard of the current paragraph, and SHALL save through the host's normal editing path so the change is undoable.

**Rationale.** A split-pane editor forces the reader to correlate two views; editing the paragraph where it is read keeps the document as the object of attention. Capping the scope to one paragraph is what makes the mode cheap enough to keep as a switch rather than a second editor.

**Acceptance criteria.**

- **AC-R15.1** — **WHEN** edit mode is on and a paragraph is activated, **THEN** that paragraph becomes an editable box holding its source verbatim, and other paragraphs remain rendered.
- **AC-R15.2** — **WHEN** a newline is entered inside the box, **THEN** it produces a paragraph break; **WHEN** a modified newline is entered, **THEN** it produces a soft break that does not split the paragraph.
- **AC-R15.3** — **WHEN** the current paragraph is committed, **THEN** the change is written to the document and saved immediately.
- **AC-R15.4** — **WHEN** the discard action is used, **THEN** that paragraph's changes are dropped and the rendered form is restored.
- **AC-R15.5** — **WHEN** the document is saved while a paragraph is being edited, **THEN** the pending text is committed first.
- **AC-R15.6** — **WHEN** an edit is committed, **THEN** the change is undoable through the host's normal undo.
- **AC-R15.7** — **WHEN** edit mode is off, **THEN** no source text is loaded for the purpose of editing.

**Evidence.** [Views and interaction → Edit mode](views-and-interaction.md#edit-mode-in-place-paragraph-editing); the boundary of the line inference is [Known limitations](limitations.md#8-edit-mode-has-no-syntax-highlighting).

### R16  In-document find in the Markdown view

**Requirement.** The Markdown view SHALL provide a find bar that highlights every match in the document body, reports the current match position and the total, jumps between matches in both directions, supports case sensitivity, and clears its highlighting on close. When text is selected in the body, opening the find bar SHALL pre-fill the query with it. Searching SHALL NOT enter diagram, drawing or vector-graphic regions.

**Rationale.** A reader looking for a term inside a long rendered document needs to see all occurrences at once, not one at a time; entering diagram regions would produce matches the reader cannot act on and ranges the third-party renderer can invalidate.

**Acceptance criteria.**

- **AC-R16.1** — **WHEN** a query is typed, **THEN** every match in the body is highlighted and the count of matches is shown.
- **AC-R16.2** — **WHEN** the next or previous action is used, **THEN** the current match advances or recedes and its position is reported.
- **AC-R16.3** — **WHEN** case sensitivity is toggled, **THEN** the match set is recomputed accordingly.
- **AC-R16.4** — **WHEN** the find bar is closed, **THEN** all highlighting is removed and the document is otherwise unchanged.
- **AC-R16.5** — **WHEN** the find bar opens while body text is selected, **THEN** the query is pre-filled with that text.
- **AC-R16.6** — **WHEN** a query occurs inside a diagram or vector graphic, **THEN** it is not reported as a body match.
- **AC-R16.7** — **WHEN** matches are highlighted, **THEN** the document's own content is not rewritten in order to mark them.

**Evidence.** [Views and interaction → Body zoom and find](views-and-interaction.md#body-zoom-and-find); measured in [Build and verify](build-and-verify.md) and [the README measurement table](../README.md#measured-behaviour).

### R17  Body zoom in the Markdown view

**Requirement.** The Markdown view SHALL offer stepless-enough body zoom through both a toolbar control and keyboard gestures, SHALL apply zoom to the document body only, SHALL keep the toolbar and the directory sidebar at their own size, and SHALL remember the step per document.

**Rationale.** Rendered output is read at whatever size suits the reader; zooming the whole window instead would grow the controls the reader needs to stay constant.

**Acceptance criteria.**

- **AC-R17.1** — **WHEN** the toolbar zoom control is used, **THEN** the body scale changes through a fixed set of steps between a stated minimum and maximum.
- **AC-R17.2** — **WHEN** the reset gesture is used, **THEN** the body returns to its default scale.
- **AC-R17.3** — **WHEN** the body is zoomed, **THEN** the toolbar and the directory sidebar keep their own size.
- **AC-R17.4** — **WHEN** the document is closed and reopened, **THEN** its last zoom step is restored.
- **AC-R17.5** — **WHEN** the body is zoomed, **THEN** diagrams and drawings inside it are not scaled twice.

**Evidence.** [Views and interaction → Body zoom and find](views-and-interaction.md#body-zoom-and-find); the configuration value is documented in [Configuration](configuration.md#wispkitzoomwheelstep).

### R18  The extension's own surface is localised

**Requirement.** Every user-visible string the extension itself owns — command titles, view names, setting descriptions — SHALL be supplied through the host's localisation mechanism, and the extension SHALL ship at least the same language set that its documentation ships. A string without a translation SHALL fall back to the default language rather than display a key.

**Rationale.** The extension's own commands and settings appear in the host's palette and settings page, next to fully localised built-in features. Shipping only one language there makes the product look unfinished regardless of how well its views behave.

**Acceptance criteria.**

- **AC-R18.1** — **WHEN** the host runs with a UI language the extension ships, **THEN** its command titles, view names and setting descriptions appear in that language.
- **AC-R18.2** — **WHEN** the host runs with a language the extension does not ship, **THEN** the default-language strings appear and no untranslated key is shown.
- **AC-R18.3** — **WHEN** a new command, view or setting is added, **THEN** it is added to every shipped language bundle in the same change.

**Evidence.** [Configuration](configuration.md); the measurement gap is [Known limitations](limitations.md) unverified item 5.

### R19  Windows shortcuts and executables get property pages instead of a blind launch

**Requirement.** The extension SHALL provide a custom editor for `.lnk` shortcuts that reports the shortcut's target path, working directory, start-in arguments, icon location, volume label, creation machine and flags, and a custom editor for `.exe` files that reports the PE structure: the format (`PE32` or `PE32+`), architecture, subsystem, whether the image is a DLL, whether it carries a .NET assembly, the entry-point RVA, the image base, the section table and the version resources. Both SHALL be registered as `option` editors, so neither takes over the default open handler. Opening either kind of file SHALL follow its configured behaviour: hand it to the system, open it inside Wispkit, or ask first. On Windows the shortcut page SHALL permit editing the target path, working directory, arguments and comment, and a save SHALL write back only the fields the user changed. An executable started from Wispkit SHALL use its own directory as the working directory; a shortcut started from Wispkit SHALL NOT have its recorded working directory overridden.

**Rationale.** These are the two file kinds a reader most often needs to *inspect* and least often wants to *run*: clicking a shortcut with a misleading icon should not launch a program, and finding out whether an executable is 32- or 64-bit should not require starting it. Registering both as `option` editors leaves the double-click behaviour the system already had intact while the property page stays one *Reopen Editor With…* away. The working-directory asymmetry is deliberate rather than an oversight: a shortcut records its own start-in directory, so substituting another one would quietly change what the shortcut does, whereas an executable records none and the directory it lives in is the only defensible default.

**Acceptance criteria.**

- **AC-R19.1** — **WHEN** a `.lnk` file is opened in this view, **THEN** its target path, working directory, arguments, icon location, volume label, creation machine and flags are shown.
- **AC-R19.2** — **WHEN** a `.exe` file is opened in this view, **THEN** the format, architecture, subsystem, DLL flag, .NET flag, entry-point RVA, image base, sections and version resources are shown.
- **AC-R19.3** — **WHEN** either file kind is opened without the user choosing a view, **THEN** the system's own behaviour applies, because both editors are registered as `option`.
- **AC-R19.4** — **WHEN** the open behaviour is set to open inside Wispkit, **THEN** a shortcut's target opens in Wispkit and an executable's property page opens; **WHEN** it is set to hand off to the system, **THEN** the system opens the file.
- **AC-R19.5** — **WHEN** the open behaviour is set to ask, **THEN** the choice is offered before anything is opened.
- **AC-R19.6** — **WHEN** a shortcut's target is a folder and the folder setting is the internal one, **THEN** the folder opens in the subtree panel; **WHEN** the setting is the system one, **THEN** the system file manager opens it.
- **AC-R19.7** — **WHEN** a shortcut field is edited and saved, **THEN** only the edited fields are written and the rest of the shortcut, including its icon and hotkey, is preserved.
- **AC-R19.8** — **WHEN** shortcut editing is disabled by configuration, **THEN** the page shows no edit form and remains readable.
- **AC-R19.9** — **WHEN** an executable is started from Wispkit, **THEN** its working directory is the directory that holds the executable.
- **AC-R19.10** — **WHEN** a shortcut is started from Wispkit, **THEN** the working directory recorded inside the shortcut is used unchanged.
- **AC-R19.11** — **WHEN** either page is asked to parse a file beyond the stated size cap, **THEN** it states the reason instead of showing an empty page.

**Evidence.** [Views and interaction → Shell shortcut view](views-and-interaction.md#shell-shortcut-view-wispkitshelllink) and [Executable view](views-and-interaction.md#executable-view-wispkitexecutable); the four settings are in [Configuration → Windows shortcut and executable](configuration.md#windows-shortcut-and-executable); unit cases in `src/test/shellLink*.test.ts` and `src/test/peParse.test.ts`. No `demo/R19-*/` fixture set exists yet, so this requirement is currently judged by unit cases and manifest inspection only.

## 4. Cross-cutting constraints

These apply to every requirement above and are not repeated under each one.

### C1  Content security

- **C1.1** — A view that renders Markdown or XAML SHALL use a strict policy: script only by nonce, resources only from the view's own source, no inline script by policy relaxation.
- **C1.2** — A view that renders arbitrary HTML **MAY** use a relaxed policy, because a page's own scripts are the content. That relaxation SHALL be documented in [Safety](../README.md#safety) and [Known limitations](limitations.md#3-the-html-view-uses-a-relaxed-csp).
- **C1.3** — Every file a view is allowed to read as a resource SHALL be declared, and the declaration SHALL include the document's own directory whenever the document can reference sibling assets.
- **C1.4** — An action that writes to disk SHALL write only to a target the user explicitly chose or to the file the user is editing.

### C2  Host and front-end boundary

- **C2.1** — A resource URL inside a webview SHALL be treated as opaque. The front end SHALL NOT attempt to derive a filesystem path from it.
- **C2.2** — When the front end needs to identify a resource, it SHALL report a position (index plus kind) and the host SHALL re-read the original document.
- **C2.3** — Every message between the two sides SHALL be a named message with a stated payload; an unnamed or ad-hoc payload is non-conforming.
- **C2.4** — Logic that both sides share SHALL NOT depend on the host API, so that it remains testable outside a running editor.

### C3  Read-only semantics

- **C3.1** — The read-only mode SHALL cap the loaded window by both a byte limit and a line limit, and SHALL state the truncation to the reader.
- **C3.2** — The read-only mode SHALL NOT apply to the extension's own browsing views; truncating a document that is rendered would produce a broken rendering rather than a smaller one.
- **C3.3** — A file presented read-only SHALL have an explicit route back to an editable editor; a mode with no exit would be a trap.

### C4  Performance and scale

| Limit | Value | Where it applies |
|---|---|---|
| Graph elements per document | 200 | 3D browsing |
| Nodes per graph | 600 | 3D browsing |
| Resource-tree nodes / children per level / depth | 2000 / 200 / 12 | `R9` |
| Entries shown per directory level | 2000 | `R11` |
| Read-only loaded window | 65536 bytes / 800 lines by default, both configurable | `R10` |
| Body virtualisation thresholds | about 4000 elements, or 40 tables / code blocks / diagrams, or 180000 plain-text characters | `R2`, `R16`, `R17` |

- **C4.1** — Every cap SHALL be reported when it is hit; silent truncation is non-conforming.
- **C4.2** — A block that contains a diagram SHALL keep real layout even while the rest of the body is virtualised, because a skipped diagram cannot report its own size.

### C5  Portability

- **C5.1** — The extension SHALL declare `^1.71.0` as its minimum host version and SHALL NOT use any host API introduced after that version.
- **C5.2** — The extension itself SHALL be platform-neutral. The only platform-bound part is the XAML renderer, which requires the Windows desktop runtime and SHALL be declared as a prerequisite.
- **C5.3** — The XAML renderer SHALL be shipped framework-dependent, not self-contained: the package is not permitted to carry a runtime.

### C6  Observability

- **C6.1** — A failure caused by the user's input or environment SHALL be reported with its cause; a silent no-op is non-conforming.
- **C6.2** — A test assertion SHALL bite an externally observable result. An assertion that only proves a rule or a message exists does not satisfy the requirement it claims to cover.
- **C6.3** — A measured number quoted in any document SHALL be reproducible by a stated command; a number without a command is an estimate and SHALL be labelled as one.

## 5. Verification map

| Capability | Requirement | Evidence type | Source of the measured number |
|---|---|---|---|
| Third-party preview script injection | `R1` | unit cases + real-machine probe | [Build and verify → Test layout](build-and-verify.md#test-layout) (`contributions` cases); `demo/R1-injection/` |
| Directory navigation | `R2` | unit cases | [Build and verify](build-and-verify.md#test-layout) (`toc` cases); `demo/R2-toc/` |
| Mermaid zoom in Markdown | `R3` | unit cases + real-machine probe | [Views and interaction](views-and-interaction.md#media-context-menu); `demo/R3-mermaid/` |
| Image zoom and pan | `R4` | unit cases + CDP probe | [Build and verify](build-and-verify.md); `demo/R4-image/`; [README measurement table](../README.md#measured-behaviour) |
| Link routing | `R5` | unit cases | [Build and verify](build-and-verify.md#test-layout) (`linkTarget`, `linkRewrite`, `linkRouter` cases); `demo/R5-jump/` |
| XAML source and render | `R6` | renderer contract + recorded artefacts + real-machine probe | [the renderer notes](../tools/xaml-render/README.md); `demo/R6-xaml/`, `demo/R12-xaml/` |
| 3D topology browsing | `R8` | CDP probes over a packaged install | [Build and verify → 3D bundle and end-to-end probes](build-and-verify.md#3d-bundle-and-end-to-end-probes); `demo/R8-graph3d/` |
| Custom resource management | `R9` | unit cases + three probe suites | [Build and verify → Resource-tree tests](build-and-verify.md#resource-tree-tests-and-packaging-check); `demo/R9-resource-tree/` |
| Read-only mode | `R10` | unit cases + real-machine probe | [Build and verify](build-and-verify.md#test-layout); `demo/R10-readonly/` |
| Subtree panel | `R11` | unit cases + probe | [Build and verify](build-and-verify.md#test-layout); `demo/R11-subtree/` |
| Mermaid file view | `R13` | unit cases + real-machine probe | [README measurement table](../README.md#measured-behaviour); `demo/R8-graph3d/04-standalone.mmd` |
| Video playback | `R14` | CDP probe | [README measurement table](../README.md#measured-behaviour) |
| Paragraph editing | `R15` | unit cases + real-machine probe | [Build and verify](build-and-verify.md#test-layout); [README measurement table](../README.md#measured-behaviour) |
| In-document find | `R16` | CDP probe | [README measurement table](../README.md#measured-behaviour) |
| Body zoom | `R17` | CDP probe | [README measurement table](../README.md#measured-behaviour) |
| Localisation | `R18` | manifest inspection | [Configuration](configuration.md); unverified item 5 in [Known limitations](limitations.md) |
| Shortcut and executable property pages | `R19` | unit cases + manifest inspection | [Views and interaction → Shell shortcut view](views-and-interaction.md#shell-shortcut-view-wispkitshelllink) and [Executable view](views-and-interaction.md#executable-view-wispkitexecutable); settings in [Configuration → Windows shortcut and executable](configuration.md#windows-shortcut-and-executable); `src/test/shellLink*.test.ts`, `src/test/peParse.test.ts` |

**Measured directly while writing this document:** 70 test files / **1149** passing cases (`npm test`), 8 web-view bundles, one 3D bundle of about 603 KB, 19 settings, 9 custom editors, 2 contributed views, 61 default read-only glob patterns, **173** packaged content entries (`vsce ls`; `wispkit-0.2.15.vsix` holds 175 archive entries at about 1.73 MB).

**The documents that carry these figures were brought to them in the same change that added this file.** [README](../README.md#build-and-measured-environment), [Build and verify](build-and-verify.md#test-layout), [Architecture](architecture.md#scale) and the [index](index.md) now state the same totals. The baseline is recorded here once so that the requirement contract says what "measured" means; the other documents are not allowed to disagree with it.

## 6. Deferred and excluded

Every row below has a matching item in [Known limitations](limitations.md). Where the two differ, this table wins on **intent** and the limitations page wins on **detail**.

| Item | Status | Why it is not promised | Precondition for revisiting |
|---|---|---|---|
| Editor ↔ preview scroll synchronisation | Not delivered | Needs a source-map protocol the preview does not emit; directory navigation does not depend on it (limitations 1) | A stable source-map contract from the host |
| Taking over the host's Simple Browser | Impossible through the public surface | It is a command-created panel and never enters custom-editor competition (limitations 2) | A host mechanism to claim an existing panel |
| HTML rendered under a relaxed policy | Delivered, with a warning | Browsing HTML inherently requires the page's own scripts (limitations 3) | Not applicable: relaxation is the only workable policy |
| Six view types taking over the default open handler | Deliberate | Browsing views are meant to be what a double-click lands in (limitations 4) | A user switching associations explicitly |
| Default Mermaid zoom depends on the host's diagram extension | Deliberate dependency | The extension raises a contributed default rather than shipping a second renderer (limitations 5) | Bundling a renderer, at a size cost the project rejects |
| XAML rendered as a static snapshot | Deliberate | Binding against live data and running handlers would require hosting the application (limitations 6) | Never, under intent 1 |
| XAML root types must already be compiled | Environment-dependent | A type that exists only in source cannot be hosted (limitations 7) | The project being compiled first |
| Edit box has no syntax highlighting | Deliberate trade | A plain text surface guarantees character-for-character agreement with the source (limitations 8) | An embeddable editor that can guarantee the same agreement |
| Read-only mode skips the extension's own browsing views | Deliberate | Truncating a rendered document produces a broken rendering (limitations 9) | Not applicable |
| Read-only mode replaces the tab once when switching editors | Known behaviour | The mode rewrites associations, so one replacement happens at the switch (limitations 10) | A host API that opens a document directly in a chosen editor without a reload |
| `atime` and permission bits always show a placeholder | Host limitation | The host's file metadata does not expose them (limitations 11) | A host API exposing them |
| Font-based icon themes do not fall back | Known behaviour | Only vector-based icon definitions are parsed (limitations 12) | Parsing font glyph mappings |
| Built-in Explorer commands are a hand-maintained list | Known behaviour | The host exposes no enumerable list (limitations 13) | A host API enumerating its own commands with arguments |
| Subtree file operations are in-house | Deliberate | Reusing the host's own operations is not exposed for reuse (limitations 14) | Not applicable |
| 3D parses topology, not the diagram library's rendering | Deliberate | 2D vector output cannot become a rotatable scene; topology is what 3D needs (limitations 15) | A topology-preserving 3D emitter |
| Bare ASCII tree recognition is conservative | Deliberate | Guessing too much would invent graphs the reader never wrote (limitations 16) | A disambiguation affordance in the panel |
| 3D element and node caps | Deliberate | Bounded cost of layout and rendering (limitations 17, C4) | Measured large-graph performance work |
| 3D scene requires a 3D context | Environment-dependent | A 2D projection would promise a different product (limitations 18) | Not applicable |
| Virtual groups have no disk counterpart | By design | A group names and groups; it is not a directory (limitations 19) | Not applicable |
| Absolute paths outside the workspace do not travel | Known behaviour | There is no placeholder anchor outside the workspace (limitations 20) | A portable anchor scheme |
| External concurrent edits: last writer wins | Known behaviour | Conflict detection was added before writing, but a window remains (limitations 21) | A locking protocol in the storage format |
| Symlink, permission and multi-root boundaries | Partly verified | Verified on a real machine for the cases listed; remote filesystems are not (limitations 22) | A remote-filesystem environment |
| Resource-tree size caps | Deliberate | Bounded read and render cost (limitations 23) | Not applicable |
| Standalone Mermaid preview depends on the host's diagram extension | Deliberate | Reuses one rendering behaviour instead of two (limitations 24) | Not applicable |
| One Mermaid file is one diagram | By design | A file is a document, one scene per file (limitations 25) | A multi-scene file format |
| 3D browsing of Mermaid files shares the parser limits | Known behaviour | Same parser, same coverage (limitations 26) | Parser coverage work |
| HEIF / HEIC / TIFF / JXL and several video containers | Deliberate | A decoder costs megabytes; the fallback is explicit instead (limitations 27) | A runtime that ships the decoder |
| Multi-language editing fonts and pixel-level appearance | Not verified | Several changes were verified by value rather than by comparing rendered pixels (unverified 1) | Side-by-side rendered comparison |
| Paragraph boundary precision on nested structures | Not verified | The end line is inferred from block starts; nesting is the least precise case (unverified 2) | Real-machine check per nesting kind |
| A shortcut's folder target lands only in the subtree panel | Deliberate | The compare browser does not accept an initial directory, so the subtree panel is the only internal landing (limitations 28) | A compare browser that accepts an initial directory |
| `.dll` files have no property page | Deliberate | Only `*.exe` is registered; the parser is valid for DLLs but no selector claims them (limitations 29) | Registering a `.dll` selector |
| Shortcut editing is Windows-only | Platform-bound | The writable route is the Windows scripting host's shortcut object, which exists only there (limitations 30) | A cross-platform shortcut writer |
| A shortcut that stores only a target IDList cannot open internally | Host limitation | No readable absolute path exists, so the system is the only route (limitations 31) | Not applicable |
| Documents above the 256 MB cap are refused | Deliberate | Parsing an unbounded file in the extension host would stall the UI (limitations 32) | A streaming parse with a stated budget |
| Shortcut parsing on macOS and Linux | Partly supported | Byte-level parsing works; system open and editing do not apply (limitations 33) | Not applicable |
| Whole workspace write path, contributed Explorer commands, localisation pickup | Not verified | Unit-tested, never clicked in the real product (unverified 3, 4, 5) | Real-machine exercise |
| Timing of the read-only tab replacement on slow disks, large files and preview tabs | Not verified | The replacement path is exercised, but not under those conditions (unverified 6) | Enable preview tabs once, disable them once, and time both |
| Very large directories and network paths | Not verified | No such environment was exercised (unverified 7, 14) | A large-share environment |
| Icon-theme language bridge coverage | Not verified | The extension-to-language table was not compared item by item (unverified 8) | Exhaustive comparison |
| 3D performance with large graphs, and visual correctness of less-common diagram kinds | Not verified | Unit-tested layouts; real-machine samples were small (unverified 9, 10, 11) | Large-graph measurement |

### Documentation inconsistencies found while writing this file

These are defects in the existing set, listed so that they are not silently normalised. The VSIX size discrepancy originally listed here was resolved in the same change that added this file; the two below remain open.

1. **`demo/R6-xaml/` describes a superseded rendering route** — its fixture notes say the renderer walks a text-parsing route, while [Views and interaction](views-and-interaction.md#render-call-chain) and [the renderer notes](../tools/xaml-render/README.md) describe hosting on a compiled assembly first and falling back to that route only when no root type can be hosted. The fixtures themselves remain valid; only their explanatory paragraph is stale.
2. **`demo/R6-xaml/` states the XAML view does not claim the default open handler** — it is now `default`, as recorded in [Views and interaction](views-and-interaction.md#xaml-view-wispkitxaml) and confirmed by the manifest. The instruction to use *Reopen Editor With…* still works but is no longer the only route.

## 7. Change protocol

| If you change… | You must also update… | Because |
|---|---|---|
| Any user-visible behaviour | The `R`/`AC` entry in this file | Requirements precede implementation; a document that trails behaviour is a defect (C6) |
| Any view's interaction or gesture | [Views and interaction](views-and-interaction.md) and the matching `demo/R<n>-*/` fixture | A criterion must be replayable by whoever reads the document next |
| Any setting-key name, default or range | [Configuration](configuration.md) and every shipped language bundle | A setting key is an external contract; a renamed key silently breaks users' settings |
| Any test count, package size or measured result | [Build and verify](build-and-verify.md) | Numbers must come from a command that was actually run (C6.3) |
| Any document | The Chinese and Spanish variants, **in the same change** | A single-language document is a defect; the three variants are translations, not summaries |
| A new view or capability | Allocate an `R` number here **first**, then build it | The number is the requirement's identity; allocating it afterwards makes the fixture mapping retroactive and ambiguous |
| A retired requirement | Record the retirement here and leave the number vacated | Reusing a number silently changes what old references mean (`R7`) |
| A new acceptance fixture | Name it `demo/R<n>-*/` for its requirement, or record the exception here (`R12`) | The number-to-fixture mapping is part of the contract |
| The README topic table | The documentation index topic table, and vice versa | Two tables listing the same topics must not diverge |
| A failure that will not be fixed | [Known limitations](limitations.md) **and** [§6](#6-deferred-and-excluded) of this file | Every failure has one home and one cross-reference |

## 8. Change log of this document

- **Created** by consolidating material that previously lived in four places: the original commissioning record's requirement restatement, acceptance list and honesty list; [Views and interaction](views-and-interaction.md); [Configuration](configuration.md); [Known limitations](limitations.md).
- **Requirement numbering** follows the commissioning order (`R1`–`R6`, `R8`–`R12`) and extends it for capabilities delivered later without a number (`R13`–`R18`). `R7` is recorded as retired rather than reassigned; `R12` is recorded as a second fixture set for `R6`, not as a separate capability.
- **Acceptance criteria** were written fresh as `WHEN … THEN …` statements. Where a delivered capability had no prior criterion, the observable behaviour was taken from [Views and interaction](views-and-interaction.md) and restated without implementation detail.
- **Deferred rows** were reconciled against all 27 limitations items and the 16 unverified rows at the time of writing; three documentation inconsistencies found during that reconciliation are listed in [§6](#documentation-inconsistencies-found-while-writing-this-file).
- **The number discrepancies** recorded in [§5](#5-verification-map) are stated rather than corrected, because correcting them belongs to the documents that own those numbers.
- **`R19` was allocated in this change** for the Windows shortcut and executable property pages, which had been delivered without a requirement number. It reuses the existing `option`-priority shape of `R10` rather than claiming a default open handler, and its fixture set is still empty, which is recorded in its evidence line instead of being implied.
