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
| 需求与验收判据 | [English](requirements.md) · [中文](requirements.zh-CN.md) · [Español](requirements.es.md) | 权威契约：每一项已交付能力对应的 `R` 编号、WHEN/THEN 形式的验收判据、横切约束、缓期清单，以及所有其余文档必须遵守的变更协议 |
| 测试与质量约束 | [English](test-and-quality.md) · [中文](test-and-quality.zh-CN.md) · [Español](test-and-quality.es.md) | 不可让渡的质量目标、每级测试能看见与看不见什么、采信哪类证据、门禁的准入与准出、实测记录、缺陷分级与残余风险 |
| 架构 | [English](architecture.md) · [中文](architecture.zh-CN.md) · [Español](architecture.es.md) | 三层（扩展宿主 / webview / 共享前端）、每个模块的职责、一次完整数据流、3D 的宿主/前端分工，以及选择自定义编辑器的设计理由 |
| 视图与交互 | [English](views-and-interaction.md) · [中文](views-and-interaction.zh-CN.md) · [Español](views-and-interaction.es.md) | 7 个自定义编辑器、自定义资源管理、子树面板与 3D 可视化面板：viewType、界面组成、手势与快捷键、消息契约 |
| 3D 可视化浏览 | [English](views-and-interaction.md#3d-graph-browsing-wispkitgraph3d) · [中文](views-and-interaction.zh-CN.md#3d-可视化浏览wispkitgraph3d) · [Español](views-and-interaction.es.md#navegación-3d-de-gráficos-wispkitgraph3d) | 右键 Markdown 打开 3D 面板：左右对比、同名节点合并、视角手势、图元素命名规则 |
| 自定义资源管理 | [English](views-and-interaction.md#custom-resource-management-wispkitresourcetree) · [中文](views-and-interaction.zh-CN.md#自定义资源管理wispkitresourcetree) · [Español](views-and-interaction.es.md#gestión-de-recursos-personalizada-wispkitresourcetree) | 活动栏视图：虚拟组 vs 文件夹、任意层级、视图标题 / 条目右键命令、内部与外部拖拽、单击文件夹打开子树、JSON 存储与刷新 |
| 配置参考 | [English](configuration.md) · [中文](configuration.zh-CN.md) · [Español](configuration.es.md) | 14 个配置项的字段级参考、`.WispkitView/Wispkit.json`、工具占位符与四种执行模式 |
| 构建与验证 | [English](build-and-verify.md) · [中文](build-and-verify.zh-CN.md) · [Español](build-and-verify.es.md) | 环境要求、npm 命令、测试构成（1059 用例 / 62 个文件）、3D bundle 与资源树真机探针、打包与安装 |
| 已知限制 | [English](limitations.md) · [中文](limitations.zh-CN.md) · [Español](limitations.es.md) | 扩展做不到的事、每条限制的成因（含 3D 图种覆盖、ASCII 树边界与 200 / 600 上限、资源树的磁盘 / 并发 / 多根边界），以及从未验证过的项 |
| 开发过程与踩坑 | [中文](development-notes.zh-CN.md)（仅中文） | 先冒烟再写代码的开发节奏，以及八类真实踩坑的**现象 / 根因 / 做法**——webview 与 CSP、VS Code API 边界、XAML 渲染、打包分发、探针测试、Windows 工具链、并行协作 |

## 从哪开始

| 你想…… | 去这里 |
|---|---|
| 确认扩展到底承诺了什么、按什么判定 | [需求与验收判据](requirements.zh-CN.md) |
| 判断一次改动是否够好、必须过哪道门 | [测试与质量约束](test-and-quality.zh-CN.md) |
| 装上试试主要功能 | [README → 快速开始](../README.zh-CN.md#快速开始) |
| 搞清为什么有 7 个自定义编辑器 | [架构 → 分层](architecture.zh-CN.md#分层) |
| 新增一个视图或改一个手势 | [视图与交互](views-and-interaction.zh-CN.md) |
| 把 Markdown 里的 Mermaid / ASCII 树左右对比或合并着看 | [视图与交互 → 3D 可视化浏览](views-and-interaction.zh-CN.md#3d-可视化浏览wispkitgraph3d) |
| 把常用文件夹组织成一个自己的资源树 | [视图与交互 → 自定义资源管理](views-and-interaction.zh-CN.md#自定义资源管理wispkitresourcetree) |
| 改一个配置项或加自定义工具 | [配置参考](configuration.zh-CN.md) |
| 构建、跑测试、复现实测结果 | [构建与验证](build-and-verify.zh-CN.md) |
| 依赖某个行为之前先确认它到底支持不支持 | [已知限制](limitations.zh-CN.md) |
| 改一处行为，并搞清还有哪些东西必须跟着一起改 | [需求与验收判据 → 变更协议](requirements.zh-CN.md#7-变更协议) |

## 关于这些文档

1. **需求页是权威，其余主题都是它的展开。** [需求与验收判据](requirements.zh-CN.md)陈述扩展应当做什么。架构、视图与交互、配置参考与构建说明负责解释一项能力如何实现、一个数字如何复现；其中任何一份与需求页冲突时，以需求页为准，那份文档即为缺陷。
2. **数字来自真实运行，可复算。** 测试数量、VSIX 体积与实测结果都能用[构建与验证](build-and-verify.zh-CN.md)里的命令复现。
3. **三语同一次修改同步更新。** 任何主题的改动都在同一处应用于英文、中文、西班牙语三个文件；语言变体是忠实翻译，不是摘要。
4. **未验证项显式标注。** 没有在真实 VS Code 里跑过的内容，在[已知限制](limitations.zh-CN.md)里明确标出，而不当作设计保证陈述。
