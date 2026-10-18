# R3-02 大图：验证缩放与平移真的可用

> **验证点**：图比视口大得多时，缩小能看全貌、放大能看细节、拖动能看到边界外的部分。
> **判据（按顺序做）**：
> 1. 打开本文件 → 两张图都应**完整可见**（自动适配）
> 2. 在宽图上**直接滚轮放大** 5 格 → 中间的节点变大；**放大时鼠标指哪就放大哪**（以光标为锚点，不是以中心）
> 3. 放大后**按住左键拖动** → 能看到原本在视口外的节点
> 4. 一直放大到很大 → 线条仍然锐利（SVG 不失真）

## 宽图（横向 12 个节点）

```mermaid
flowchart LR
  N01[节点 01] --> N02[节点 02] --> N03[节点 03] --> N04[节点 04]
  N04 --> N05[节点 05] --> N06[节点 06] --> N07[节点 07] --> N08[节点 08]
  N08 --> N09[节点 09] --> N10[节点 10] --> N11[节点 11] --> N12[节点 12]
  N01 --> N12
```

## 高图（纵向 16 层）

```mermaid
flowchart TD
  L01[第 01 层] --> L02[第 02 层] --> L03[第 03 层] --> L04[第 04 层]
  L04 --> L05[第 05 层] --> L06[第 06 层] --> L07[第 07 层] --> L08[第 08 层]
  L08 --> L09[第 09 层] --> L10[第 10 层] --> L11[第 11 层] --> L12[第 12 层]
  L12 --> L13[第 13 层] --> L14[第 14 层] --> L15[第 15 层] --> L16[第 16 层]
```

## 密集图（节点多 + 标签长，最容易暴露"适配算错"）

```mermaid
flowchart TD
  A[收集扩展列表<br/>vscode.extensions.all] --> B[读 contributes<br/>markdown.previewScripts]
  A --> C[读 contributes<br/>markdown.previewStyles]
  B --> D[拼成 webview.asWebviewUri]
  C --> E[拼成 link rel=stylesheet]
  D --> F[加 nonce 属性]
  F --> G[写进 script-src 'nonce-...']
  E --> H[style-src 里放行 cspSource]
  G --> I[页面加载时脚本执行]
  H --> J[样式生效]
  I --> K[div.mermaid 变 svg]
  J --> K
```

## 如果放大不工作，先查这三处

1. 设置里搜 `markdown-mermaid.mouseNavigation.enabled` —— 必须是 `always`；
   如果是 `ctrlCmd` 或 `false`，说明**你之前手动设过**，用户设置盖掉了 Wispkit 的默认值。
2. 是不是**没重启窗口**：装完扩展要 `Developer: Reload Window`。
3. 图本身是不是太窄：一张只有 2 个节点的图，适配后本来就是 100%，放大才看得出变化。
