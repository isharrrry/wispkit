# R5-03 Markdown 里的跳转链接

> **当前行为（2026-10-26 起）**：Markdown 与 HTML 两个视图走同一套链接路由 ——
> 前端截住 `<a>` 点击，把**原始 href** 送回扩展，由扩展相对当前文档解析后
> 在当前窗口打开。相对链接不会再被 `<base>` 解析成 webview 资源 URL 而跳系统浏览器。

## 1. 相对链接（本次修复的主项）

- [相对链接到 targets/target-simple.md](targets/target-simple.md)
- [带行号的相对链接（第 7 行）](targets/target-simple.md#L7)
- [中文 + 空格文件名](targets/目标 中文空格.md)
- [深目录](targets/deep/nested/target-deep.md)

**期望**：都在**当前窗口**打开目标 Markdown（由默认编辑器接管，通常是 Wispkit Markdown），
`#L7` 这一条会把光标定位到第 7 行。

## 2. `vscode://file/` 链接（Markdown 语法）

- [跳到 target-simple.md 第 7 行](vscode://file/D:/AllData/AIDATA/techsearch/Wispkit/demo/R5-jump/targets/target-simple.md:7)
- [打开 target-simple.md（不带行号）](vscode://file/D:/AllData/AIDATA/techsearch/Wispkit/demo/R5-jump/targets/target-simple.md)
- [跳到「目标 中文空格.md」第 9 行](vscode://file/D:/AllData/AIDATA/techsearch/Wispkit/demo/R5-jump/targets/%E7%9B%AE%E6%A0%87%20%E4%B8%AD%E6%96%87%E7%A9%BA%E6%A0%BC.md:9)

**期望**：不再绕系统协议处理器（不会另起窗口）；由扩展解析后在本窗口打开。

## 3. 外部链接（预期：交给系统浏览器）

[VS Code 官网](https://code.visualstudio.com) —— 与 VS Code 内置预览一致。

## 4. 锚点链接（预期：页内滚动）

[跳到本文末尾](#末尾) —— 期望页内滚动。

---

## 实现要点

- 页面仍需要 `<base href="<webview 资源 URL>">` 才能加载相对图片 / 样式；
  因此**相对链接的 `anchor.href` 一定不是文件路径**，只能读原始 `getAttribute('href')`。
- 点击在 `document` 的冒泡阶段拦截：页面自己的脚本先跑（`preventDefault()` 后不抢），
  再 `stopPropagation()`，避免 webview 外壳按 `https:` 把它交给系统浏览器。
- `#锚点` 与 `command:` 不拦：前者交给浏览器 / 目录定位，后者由宿主的
  `enableCommandUris` 执行（drawio 的"编辑"按钮依赖它）。

## 末尾

本文末尾到了。
