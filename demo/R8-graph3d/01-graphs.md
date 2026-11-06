# R8-01 3D 图元素总览

> **验证点**：Markdown 里的 ASCII 树与多种 Mermaid 图都能被「3D 可视化浏览」收集成图元素，
> 下拉框名称按「标题 / title > 最近 Markdown 标题 > 第一个节点 > 文件名」生成。
>
> **怎么验**：
> 1. 在资源管理器里右键本文件 → **3D 可视化浏览**；
> 2. 左下拉应能看到 17 个左右的图元素，名称形如「1. ASCII 目录树（围栏 text） · ASCII 树」；
> 3. 逐个选择，确认 3D 场景里有节点与连线；本文件第 14 节是**未支持图种**，会显示「通用兜底」说明；
> 4. 第 16 节的树写在 ` ```js ` 围栏里，**不应**出现在下拉框中（不是图元素）。

## 1. ASCII 目录树（围栏 text）

```text
wispkit
├── src
│   ├── extension.ts
│   ├── graph3dProvider.ts
│   └── graph3d
│       ├── ascii.ts
│       ├── mermaid.ts
│       ├── markdownElements.ts
│       ├── merge.ts
│       └── layout.ts
├── media
│   ├── graph3d.js
│   └── graph3d.css
└── docs
    └── index.md
```

## 2. flowchart（frontmatter title）

```mermaid
---
title: 构建流水线
---
flowchart LR
  A[读取 Markdown] --> B{有图元素?}
  B -->|有| C[3D 面板]
  B -->|没有| D[提示插入 Mermaid / ASCII 树]
  C --> E[旋转 / 平移 / 缩放]
```

## 3. sequenceDiagram

```mermaid
sequenceDiagram
  participant U as 用户
  participant H as 扩展宿主
  participant W as webview
  U->>H: 右键 .md → 3D 可视化浏览
  H->>H: extractGraphElements(text)
  H-->>W: payload（JSON）
  W->>W: layoutGraph + three.js
  W-->>U: 可旋转的 3D 场景
```

## 4. classDiagram

```mermaid
classDiagram
  class GraphElement {
    +string id
    +string name
    +GraphNode[] nodes
    +GraphEdge[] edges
  }
  class GraphNode {
    +string id
    +string label
  }
  class GraphEdge {
    +string source
    +string target
  }
  GraphElement --> GraphNode
  GraphElement --> GraphEdge
```

## 5. stateDiagram-v2

```mermaid
stateDiagram-v2
  [*] --> 未选中
  未选中 --> 左侧: 左下拉选择
  未选中 --> 右侧: 右下拉选择
  左侧 --> 合并: 再选右侧并点「合并左右」
  右侧 --> 合并: 再选左侧并点「合并左右」
  合并 --> 未选中: Esc / 取消合并
```

## 6. erDiagram

```mermaid
erDiagram
  GRAPH_ELEMENT ||--o{ GRAPH_NODE : contains
  GRAPH_ELEMENT ||--o{ GRAPH_EDGE : contains
  GRAPH_ELEMENT {
    string id
    string name
  }
  GRAPH_NODE {
    string id
    string label
  }
  GRAPH_EDGE {
    string source
    string target
  }
```

## 7. mindmap

```mermaid
mindmap
  root((Wispkit 3D))
    解析
      ASCII 树
      Mermaid 子集
    布局
      树
      分层
      力导向
    交互
      左右对比
      同名节点合并
```

## 8. gitGraph

```mermaid
gitGraph
  commit id: "init"
  branch feat/3d
  commit id: "parse"
  commit id: "layout"
  checkout main
  merge feat/3d
  commit id: "docs"
```

## 9. journey

```mermaid
journey
  title 打开 3D 面板
  section 入口
    右键 Markdown: 5: 用户
    点击 3D 可视化浏览: 5: 用户
  section 浏览
    选择左右图: 5: 用户
    旋转缩放: 4: 用户
    合并同名节点: 4: 用户
```

## 10. gantt

```mermaid
gantt
  title 3D 可视化里程碑
  dateFormat YYYY-MM-DD
  section 解析
    ASCII 树: done, 2026-10-20, 2d
    Mermaid 子集: done, 2026-10-22, 3d
  section 前端
    布局与相机: done, 2026-10-24, 2d
    文档与 demo: active, 2026-10-26, 1d
```

## 11. timeline

```mermaid
timeline
  title 3D 功能时间线
  section 设计
    2026-10-20 : 图元素模型
    2026-10-21 : 布局策略
  section 交付
    2026-10-24 : 面板与手势
    2026-10-26 : 文档与 demo
```

## 12. pie

```mermaid
pie title 3D 代码构成（示意）
  "Mermaid 解析" : 30
  "ASCII 树" : 15
  "布局" : 25
  "前端渲染" : 30
```

## 13. quadrantChart

```mermaid
quadrantChart
  title 图种支持度
  x-axis 解析成本低 --> 解析成本高
  y-axis 用得少 --> 用得多
  quadrant-1 优先支持
  quadrant-2 值得投入
  quadrant-3 兜底即可
  quadrant-4 观察
  flowchart: [0.25, 0.9]
  sequenceDiagram: [0.35, 0.75]
  mindmap: [0.6, 0.55]
  requirementDiagram: [0.85, 0.2]
```

## 14. requirementDiagram（未支持图种，走通用兜底）

```mermaid
requirementDiagram
  requirement 可旋转 {
    id: 1
    text: 3D 场景必须能旋转
    risk: medium
    verifymethod: test
  }
  element 3D面板 {
    type: ui
  }
  3D面板 - satisfies -> 可旋转
```

## 15. 正文裸 ASCII 树（无围栏）

下面这棵树不在代码围栏里，靠「至少两行带标签连接线」被识别：

wispkit
├── 解析
│   ├── ascii.ts
│   └── mermaid.ts
├── 布局
│   └── layout.ts
└── 渲染
    └── graph3d.js

以上树在 3D 下拉框里应出现。

## 16. 非 ASCII 围栏里的树不会被收集（示例）

```js
// 这段文字长得像树，但语言是 js，不是图元素
wispkit
├── src
└── media
```

## 17. 同一个 Markdown 标题下两个 Mermaid 图：同名追加 (2)

```mermaid
flowchart LR
  A[同一个标题] --> B[图一]
```

```mermaid
flowchart LR
  A[同一个标题] --> B[图二]
```

下拉框里这两项应显示为「… · 流程图」和「… · 流程图 (2)」。

## 预期结果

| 检查项 | 期望 |
|---|---|
| 图元素数量 | 第 1–15 节 + 第 17 节的两张图（第 16 节不算），共约 **17** 个 |
| 第 2 节名称 | 使用 frontmatter `title`，显示「构建流水线 · 流程图」 |
| 第 14 节统计 | 有节点 / 边，并带「通用兜底解析（按行串成链）」说明 |
| 第 15 节 | 出现在下拉框里，名称为「… · ASCII 树」 |
| 第 16 节 | **不出现**在下拉框里 |
| 第 17 节 | 两个名称仅差末尾的 `(2)` |
| 任意图 | 左键拖动旋转、右键拖动平移、滚轮缩放；「重置视角」复位 |
