---
type: Guide
title: 文档索引
description: Wispkit 文档体系的主题表、入口与写作纪律
tags: [documentation, index]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Wispkit 文档

[English](index.md) | **中文** | [Español](index.es.md)

> 返回[仓库 README](../README.zh-CN.md)。下列每篇都有三语版本。

## 主题

| 主题 | 语言版本 | 覆盖内容 |
|---|---|---|
| 架构 | [English](architecture.md) · [中文](architecture.zh-CN.md) · [Español](architecture.es.md) | 三层（扩展宿主 / webview / 共享前端）、每个模块的职责、一次完整数据流，以及选择自定义编辑器的设计理由 |
| 视图与交互 | [English](views-and-interaction.md) · [中文](views-and-interaction.zh-CN.md) · [Español](views-and-interaction.es.md) | 5 个自定义编辑器与子树面板：viewType、界面组成、手势与快捷键、消息契约 |
| 配置参考 | [English](configuration.md) · [中文](configuration.zh-CN.md) · [Español](configuration.es.md) | 13 个配置项的字段级参考、`.WispkitView/Wispkit.json`、工具占位符与四种执行模式 |
| 构建与验证 | [English](build-and-verify.md) · [中文](build-and-verify.zh-CN.md) · [Español](build-and-verify.es.md) | 环境要求、四条 npm 命令、测试构成（477 用例）、真机探针、打包与安装 |
| 已知限制 | [English](limitations.md) · [中文](limitations.zh-CN.md) · [Español](limitations.es.md) | 扩展做不到的事、每条限制的成因，以及从未验证过的项 |
| 开发过程与踩坑 | [中文](development-notes.zh-CN.md)（仅中文） | 先冒烟再写代码的开发节奏，以及八类真实踩坑的**现象 / 根因 / 做法**——webview 与 CSP、VS Code API 边界、XAML 渲染、打包分发、探针测试、Windows 工具链、并行协作 |

## 从哪开始

| 你想…… | 去这里 |
|---|---|
| 装上试试主要功能 | [README → 快速开始](../README.zh-CN.md#快速开始) |
| 搞清为什么有 5 个自定义编辑器 | [架构 → 分层](architecture.zh-CN.md#分层) |
| 新增一个视图或改一个手势 | [视图与交互](views-and-interaction.zh-CN.md) |
| 改一个配置项或加自定义工具 | [配置参考](configuration.zh-CN.md) |
| 构建、跑测试、复现实测结果 | [构建与验证](build-and-verify.zh-CN.md) |
| 依赖某个行为之前先确认它到底支持不支持 | [已知限制](limitations.zh-CN.md) |

## 关于这些文档

1. **数字来自真实运行，可复算。** 测试数量、VSIX 体积与实测结果都能用[构建与验证](build-and-verify.zh-CN.md)里的命令复现。
2. **三语同一次修改同步更新。** 任何主题的改动都在同一处应用于英文、中文、西班牙语三个文件；语言变体是忠实翻译，不是摘要。
3. **未验证项显式标注。** 没有在真实 VS Code 里跑过的内容，在[已知限制](limitations.zh-CN.md)里明确标出，而不当作设计保证陈述。
