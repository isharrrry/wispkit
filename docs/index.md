---
type: Guide
title: Documentation index
description: Topic map, entry points and writing rules for the Wispkit documentation set
tags: [documentation, index]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Wispkit documentation

**English** | [中文](index.zh-CN.md) | [Español](index.es.md)

> Back to the [repository README](../README.md). Every topic below exists in three languages.

## Topics

| Topic | Language versions | What it covers |
|---|---|---|
| Requirements and acceptance criteria | [English](requirements.md) · [中文](requirements.zh-CN.md) · [Español](requirements.es.md) | The authoritative contract: every delivered capability under an `R` number, its acceptance criteria in WHEN/THEN form, the cross-cutting constraints, the deferred list, and the change protocol every other document follows |
| Test and quality constraints | [English](test-and-quality.md) · [中文](test-and-quality.zh-CN.md) · [Español](test-and-quality.es.md) | Quality objectives that are not negotiable, what each test level can and cannot see, which evidence is accepted, the entry and exit criteria of the gate, recorded measurements, defect grading and residual risk |
| Architecture | [English](architecture.md) · [中文](architecture.zh-CN.md) · [Español](architecture.es.md) | Three layers (extension host / webview / shared front-end), the responsibility of every module, one complete data flow, the 3D host/webview split, and the design reasons behind the custom-editor choice |
| Views and interaction | [English](views-and-interaction.md) · [中文](views-and-interaction.zh-CN.md) · [Español](views-and-interaction.es.md) | The seven custom editors, custom resource management, the subtree panel and the 3D visualization panel: view types, UI composition, gestures and shortcuts, message contracts |
| 3D visualization | [English](views-and-interaction.md#3d-graph-browsing-wispkitgraph3d) · [中文](views-and-interaction.zh-CN.md#3d-可视化浏览wispkitgraph3d) · [Español](views-and-interaction.es.md#navegación-3d-de-gráficos-wispkitgraph3d) | Right-click a Markdown file to open the 3D panel: left/right comparison, same-name node merging, camera gestures and graph-element naming rules |
| Custom resource management | [English](views-and-interaction.md#custom-resource-management-wispkitresourcetree) · [中文](views-and-interaction.zh-CN.md#自定义资源管理wispkitresourcetree) · [Español](views-and-interaction.es.md#gestión-de-recursos-personalizada-wispkitresourcetree) | Activity Bar view: virtual group vs folder, arbitrary depth, view-title / item-context commands, internal and external drag and drop, click-to-open subtree, JSON storage and refresh |
| Configuration | [English](configuration.md) · [中文](configuration.zh-CN.md) · [Español](configuration.es.md) | Field-level reference for all fourteen settings, `.WispkitView/Wispkit.json`, tool placeholders and execution modes |
| Build and verify | [English](build-and-verify.md) · [中文](build-and-verify.zh-CN.md) · [Español](build-and-verify.es.md) | Environment, the npm commands, the test layout (1059 cases / 62 files), the 3D bundle and resource-tree real-machine probes, packaging and installation |
| Known limitations | [English](limitations.md) · [中文](limitations.zh-CN.md) · [Español](limitations.es.md) | What the extension cannot do, why each limit exists (including 3D diagram coverage, ASCII tree boundaries, the 200 / 600 caps and the resource tree's disk / concurrency / multi-root boundaries), and what has never been verified |
| Development notes | [中文](development-notes.zh-CN.md) (Chinese only) | How the extension was built step by step — smoke first, pure logic next — and every pitfall that was actually hit, with symptom, root cause and fix |

## Where to start

| You want to… | Go to |
|---|---|
| Check what is actually promised and how it is judged | [Requirements and acceptance criteria](requirements.md) |
| Know whether a change is good enough, and the gate it must pass | [Test and quality constraints](test-and-quality.md) |
| Install it and try the main features | [README → Quick start](../README.md#quick-start) |
| Understand why there are seven custom editors | [Architecture → Layers](architecture.md#layers) |
| Add a new view or change a gesture | [Views and interaction](views-and-interaction.md) |
| Compare or merge Mermaid / ASCII trees from a Markdown file in 3D | [Views and interaction → 3D graph browsing](views-and-interaction.md#3d-graph-browsing-wispkitgraph3d) |
| Organise frequently used folders into a resource tree of your own | [Views and interaction → Custom resource management](views-and-interaction.md#custom-resource-management-wispkitresourcetree) |
| Change a setting or add a custom tool | [Configuration](configuration.md) |
| Build, run the tests, or reproduce a measurement | [Build and verify](build-and-verify.md) |
| Check whether something is supported before relying on it | [Known limitations](limitations.md) |
| Change a behaviour and find out what else has to move with it | [Requirements → Change protocol](requirements.md#7-change-protocol) |

## About these documents

1. **The requirements page is the authority; every other topic is its expansion.** [Requirements and acceptance criteria](requirements.md) states what the extension shall do. Architecture, views and interaction, configuration and build notes explain how a capability is realised and how to reproduce a measurement; where one of them contradicts the requirements page, the requirements page wins and that document is defective.
2. **Numbers come from real runs and can be recomputed.** The test count, VSIX size and measured results are reproducible with the commands in [Build and verify](build-and-verify.md).
3. **All three languages change together.** Any edit to a topic is applied to the English, Chinese and Spanish file in the same change; the language variants are faithful translations, not summaries.
4. **Unverified items are labelled as such.** Anything that was not exercised in a real VS Code is marked explicitly in [Known limitations](limitations.md) instead of being presented as a design guarantee.
