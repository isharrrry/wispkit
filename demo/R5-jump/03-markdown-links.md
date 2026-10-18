# R5-03 Markdown 里的跳转链接（同插件内的行为差异）

> **这一份要说明一个真实差异，先看结论再动手。**
>
> | 视图 | 是否改写 `vscode://file/…` | 是否有 `enableCommandUris` |
> |---|---|---|
> | **HTML 视图**（`01-basic.html`） | **是** → `command:vscode.open?…` | **是** |
> | **Markdown 视图**（本文件） | **否**（改写只在 HTML 视图做） | **否** |
>
> 所以下面的链接在 Markdown 视图里点，走的是**宿主白名单里的 `vscode:`** 这条路
> （会绕经系统协议处理器，可能另起一个窗口），而**不是**"当前窗口 + 精确行号"。

## 1. `vscode://file/` 链接（Markdown 语法）

- [跳到 target-simple.md 第 7 行](vscode://file/D:/AllData/AIDATA/techsearch/Wispkit/demo/R5-jump/targets/target-simple.md:7)
- [打开 target-simple.md（不带行号）](vscode://file/D:/AllData/AIDATA/techsearch/Wispkit/demo/R5-jump/targets/target-simple.md)
- [跳到「目标 中文空格.md」第 9 行](vscode://file/D:/AllData/AIDATA/techsearch/Wispkit/demo/R5-jump/targets/%E7%9B%AE%E6%A0%87%20%E4%B8%AD%E6%96%87%E7%A9%BA%E6%A0%BC.md:9)

**观察点**（请记录实际表现）：
1. 能不能点开？
2. 是在**当前窗口**打开，还是**另起了一个窗口**？
3. 行号定位生效了吗？

## 2. `command:` 链接（预期：点不动）

[command:vscode.open 打开文件](command:vscode.open?%5B%22file%3A%2F%2F%2FD%3A%2FAllData%2FAIDATA%2Ftechsearch%2FWispkit%2Fdemo%2FR5-jump%2Ftargets%2Ftarget-simple.md%22%5D)

**预期**：在 Markdown 视图里**点不动**（没有 `enableCommandUris`）。
同样这条链接放到 `R5-jump/02-edge.html` 里就能点 —— 这就是两个视图的差别。

## 3. 相对路径链接（预期：点不动）

[相对链接到 targets/target-simple.md](targets/target-simple.md)

**预期**：Markdown 渲染出的 `<a href="targets/…">` 会相对 `<base href>` 解析成 `vscode-webview://…`，
该 scheme 不在白名单 → 点不动。**属于已知限制**。









## 4. 外部链接（预期：正常）

[VS Code 官网](https://code.visualstudio.com) —— 期望交给系统浏览器打开。

## 5. 锚点链接（预期：正常）

[跳到本文末尾](#末尾) —— 期望页内滚动。

---

## 为什么会有这个差异 / 要不要统一

- **HTML 视图**是本插件**自己造的页面**，我们完全控制它的 `<a>` 落点，所以可以改写、也敢开 `enableCommandUris`。
- **Markdown 视图**的内容是 `markdown.api.render` 的**输出**，作者可能来自第三方文档；在这里开
  `enableCommandUris` 等于允许**文档内容触发任意 VS Code 命令**——对"打开外部下载的 md"是不小的风险面。
- 所以当前设计是**故意不对称**的。

如果你希望 Markdown 视图也走"当前窗口 + 精确行号"，可选做法（按代价从小到大）：

| 方案 | 改动 | 代价 |
|---|---|---|
| A. 在 Markdown 视图里也改写 `vscode://file/…`，但**不开** `enableCommandUris` | 复用现成的 `rewriteVscodeFileLinksInHtml`，前端 0 行 | `command:` 仍被拒 → **改写完反而点不动**，所以方案 A 实际无效 |
| B. 改写 + 开 `enableCommandUris` | 同上 + 一个布尔 | 语义与 HTML 视图一致；**代价是打开了命令执行面** |
| C. 只改写、改写成 `vscode://file/…` 之外的**受控**形式（例如自定义 webview 消息，点击后由扩展调 `vscode.open`） | 前端要拦 `click`、定消息契约 | 最安全，但要写消息路由（约 30 行） |

**我的建议**：先按现在这样用（HTML 视图精确跳转、Markdown 视图走系统协议），等你实测完
把第 1 组的三条观察结果告诉我，再决定要不要上 C。

## 末尾

本文末尾到了。
