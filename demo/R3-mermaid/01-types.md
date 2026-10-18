# R3-01 Mermaid 图类型覆盖

> **验证点**：Mermaid 图能渲染，且**默认就能缩放/平移**（不用按 Alt）。
> **怎么验放大**：
> 1. 在任意一张图上**直接滚轮** → 应该放大/缩小（这是 R3 的核心，旧行为是要按 Alt）
> 2. 在图上**按住左键拖动** → 应该平移
> 3. 鼠标移出图再滚 → 页面滚动（图不该吃掉页面的滚轮）
>
> **这一条是"配置默认值"而不是代码**：Wispkit 通过 `configurationDefaults` 把
> `markdown-mermaid.mouseNavigation.enabled` 抬成 `always`。
> **前提**：你没有**手动**设过这一项。如果你之前显式设成过 `false` 或 `ctrlCmd`，
> 用户设置优先级更高、会盖掉我们的默认值 —— 这时请手动改回 `always`。

## 1. flowchart（最常用）

```mermaid
flowchart TD
  A[打开 .md] --> B{是不是 Wispkit 视图?}
  B -->|是| C[注入贡献脚本 + nonce]
  B -->|否| D[内置预览]
  C --> E[渲染 mermaid svg]
  E --> F[可滚轮缩放]
```

## 2. sequenceDiagram

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant W as Wispkit
  participant E as 内置引擎
  U->>W: 编辑并保存
  W->>E: markdown.api.render(text)
  E-->>W: html
  W->>W: 派发 updateContent
  W-->>U: 重渲染 + 目录重建
```

## 3. classDiagram

```mermaid
classDiagram
  class MarkdownEditorProvider {
    +resolveCustomTextEditor(document, panel)
    -buildPage(webview, document, bodyHtml)
  }
  class Toc {
    +rebuild()
    +setConfig(next)
    +headingCount
  }
  MarkdownEditorProvider --> Toc : 页面里加载
```

## 4. stateDiagram-v2

```mermaid
stateDiagram-v2
  [*] --> 未打开
  未打开 --> 渲染中: 打开标签页
  渲染中 --> 已渲染: html 就绪
  已渲染 --> 已渲染: 编辑（200ms 防抖）
  已渲染 --> [*]: 关闭
```

## 5. erDiagram

```mermaid
erDiagram
  EXTENSION ||--o{ PREVIEW_SCRIPT : contributes
  EXTENSION ||--o{ PREVIEW_STYLE : contributes
  EXTENSION {
    string extensionUri
    string packageJson
  }
  PREVIEW_SCRIPT {
    string path
    string type
  }
```

## 6. journey

```mermaid
journey
  title 打开一个 Markdown 文件
  section 打开
    双击文件: 5: 用户
    渲染完成: 4: Wispkit
  section 阅读
    看目录: 5: 用户
    点条目跳转: 5: 用户
```

## 7. gantt

```mermaid
gantt
  title Wispkit M1 里程碑
  dateFormat YYYY-MM-DD
  section 扩展点
    聚合贡献脚本: done, 2026-10-01, 3d
    nonce 与 CSP: done, 2026-10-04, 2d
  section 交互
    目录导航: done, 2026-10-06, 3d
    图片缩放平移: done, 2026-10-09, 2d
```

## 8. pie

```mermaid
pie title 代码行数占比（示意）
  "Markdown 视图" : 45
  "图片视图" : 20
  "HTML 视图" : 15
  "工具与测试" : 20
```

## 9. gitGraph

```mermaid
gitGraph
  commit id: "init"
  branch feat/virtual-interface
  commit id: "m1-plan"
  commit id: "m1-impl"
  checkout main
  merge feat/virtual-interface
```

## 能力边界（不算失败）

| 图类型 | 说明 |
|---|---|
| `mindmap` / `timeline` / `quadrantChart` / `sankey-beta` | 只有较新的 Mermaid 才有。**内置扩展带的是哪个版本决定了有没有**——如果渲染成"语法错误"块，记下来即可，不是 Wispkit 的问题 |
| 语法错误图 | 见 `03-edge.md` |
