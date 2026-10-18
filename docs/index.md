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
| Architecture | [English](architecture.md) · [中文](architecture.zh-CN.md) · [Español](architecture.es.md) | Three layers (extension host / webview / shared front-end), the responsibility of every module, one complete data flow, and the design reasons behind the custom-editor choice |
| Views and interaction | [English](views-and-interaction.md) · [中文](views-and-interaction.zh-CN.md) · [Español](views-and-interaction.es.md) | The five custom editors plus the subtree panel: view types, UI composition, gestures and shortcuts, message contracts |
| Configuration | [English](configuration.md) · [中文](configuration.zh-CN.md) · [Español](configuration.es.md) | Field-level reference for all thirteen settings, `.WispkitView/Wispkit.json`, tool placeholders and execution modes |
| Build and verify | [English](build-and-verify.md) · [中文](build-and-verify.zh-CN.md) · [Español](build-and-verify.es.md) | Environment, the four npm commands, the test layout (477 cases), real-machine probes, packaging and installation |
| Known limitations | [English](limitations.md) · [中文](limitations.zh-CN.md) · [Español](limitations.es.md) | What the extension cannot do, why each limit exists, and what has never been verified |

## Where to start

| You want to… | Go to |
|---|---|
| Install it and try the main features | [README → Quick start](../README.md#quick-start) |
| Understand why there are five custom editors | [Architecture → Layers](architecture.md#layers) |
| Add a new view or change a gesture | [Views and interaction](views-and-interaction.md) |
| Change a setting or add a custom tool | [Configuration](configuration.md) |
| Build, run the tests, or reproduce a measurement | [Build and verify](build-and-verify.md) |
| Check whether something is supported before relying on it | [Known limitations](limitations.md) |

## About these documents

1. **Numbers come from real runs and can be recomputed.** The test count, VSIX size and measured results are reproducible with the commands in [Build and verify](build-and-verify.md).
2. **All three languages change together.** Any edit to a topic is applied to the English, Chinese and Spanish file in the same change; the language variants are faithful translations, not summaries.
3. **Unverified items are labelled as such.** Anything that was not exercised in a real VS Code is marked explicitly in [Known limitations](limitations.md) instead of being presented as a design guarantee.
