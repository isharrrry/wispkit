# M1 Task 0 —— 可行性冒烟记录（实机 1.137.0）

**验证平台**：`D:\app\VSCodeEXE`（安装版，`ProductVersion=1.137.0`，Electron 42.10.0）
**主程序目录**：`D:\app\VSCodeEXE\645f29cc31\resources\app`（由 `bin\code.cmd` 证实：它显式指向 `..\645f29cc31\resources\app\out\cli.js`，随机目录名是 1.137 安装版的固定布局，不是更新残留）
**用户数据目录**：`%APPDATA%\Code`（非 portable）；已装扩展仅 1 个：`ms-ceintl.vscode-language-pack-zh-hans`
**内置扩展数**：97

---

## ① `markdown.api.render` 存在性与签名 —— 已核实

`extensions\markdown-language-features\dist\extension.js`（2,024,039 B）偏移 **1895153**：

```js
var kb=class{id="markdown.api.render";#e;constructor(t){this.#e=t}async execute(t){return(await this.#e.render(t)).html}}
```

- 结论：命令**存在**，`execute(text)` → 返回 `(await engine.render(text)).html`，即**返回 HTML 字符串**。
- 它**不在** `contributes.commands` 中（按 `markdown.api*` 过滤 `contributes.commands` 为空），只在 `activationEvents`：`onCommand:markdown.api.render`、`onCommand:markdown.api.reloadPlugins` → **隐藏命令：可调用，但不是官方承诺的公开 API**。
- **行为未核实**（相对图片 URL 形态、是否应用 `markdown.markdownItPlugins`）→ 由 Task 2 实机 selftest 判定。

## ② `WebviewOptions.enableCommandUris` —— 待编译核实

用 `@types/vscode@1.71.0` 编译通过即为门禁（`package.json` 已锁该版本）。

## ③ 优先级竞争 —— 基线已核实，胜出关系待实测

`extensions` 目录实测（1.137.0）：

| 扩展 | viewType | priority | 备注 |
|---|---|---|---|
| markdown-language-features | `vscode.markdown.preview.editor` | `{diffEditor:"option", textEditor:"option"}` | |
| markdown-language-features | `vscode.markdown.editor` | `{diffEditor:"explicit", textEditor:"option"}` | **1.137 有新版 Markdown 编辑器**（plan §2 中"1.71.2 只有一个"的记录在此版本不成立） |
| media-preview | `imagePreview.previewEditor` | `"builtin"` | 另有 `vscode.audioPreview` / `vscode.videoPreview` 同为 builtin |
| simple-browser | **无 customEditors** | — | `activationEvents` = `onCommand:simpleBrowser.api.open` / `onWebviewPanel:simpleBrowser.view` → **R5 无法接管 Simple Browser，只能另起标签页**（与 plan §2 一致） |

→ 我们声明 `priority:"default"` 是否胜出两个 `option` 与一个 `builtin`：Task 1 装 VSIX 后实测。

## ④ 扩展点的**真实使用者**（R1 的验证对象，无需自造 fixture）—— 已核实

`extensions\mermaid-markdown-features\package.json` 的 `contributes`（**扁平点号键**）：

```json
"markdown.previewScripts": [ { "path": "./markdown-preview-out/index.js", "type": "module" } ],
"markdown.markdownItPlugins": true
```

`extensions\markdown-math\package.json`：

```json
"markdown.markdownItPlugins": true,
"markdown.previewStyles": [ "./notebook-out/katex.min.css", "./preview-styles/index.css" ]
```

- **关键**：贡献键是**扁平点号键** `"markdown.previewScripts"`，不是嵌套 `"markdown": {...}`；内置聚合代码读的也是 `contributes['markdown.previewScripts']`（`markdownExtensions.ts:153`）、`contributes['markdown.markdownItPlugins']`（`:138`）。
- 两者的 `activationEvents` 里没有 markdown 相关项 → 由贡献点隐式激活。
- 内置扩展**自身不贡献**（`markdown-language-features` 无 markdown.* 键）→ 我们遍历 `extensions.all` 聚合是本机制的**唯一正确用法**。

## ⑤ mermaid 前端契约 —— 已核实（R1 + R3 的接缝）

`mermaid-markdown-features\markdown-preview-out\index.js`（26,412,684 B）：

```js
window.addEventListener("vscode.markdown.updateContent", init3);
init3();
```

- 事件挂在 **`window`**（不是 `document`）→ 我们更新内容后必须 `window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'))`。
- 脚本加载时**立即自执行一次** `init3()` → 首次加载即渲染。
- 它认的选择器是 **`.mermaid`**（`querySelectorAll(".mermaid")`、`querySelectorAll(".mermaid > svg")`）；`language-mermaid` 出现 **0 次**。
- → 推论：```mermaid fence 由 `markdown.markdownItPlugins`（渲染期）转成 `<div class="mermaid">`，previewScripts（前端）再把该 div 渲染成 svg 并挂 pan/zoom。**这是 Task 2 必须同时验证 `api.render` 会应用 markdownItPlugins 的原因**。
- 它自带 pan/zoom，且受 `markdown-mermaid.mouseNavigation.enabled`（enum `always|alt|never`，**默认 `alt`**）控制 → R3 的"默认"= 把该默认值抬成 `always`（见 plan D2 的修订）。

## ⑥ 注入与 CSP 的内置实现（照抄基准）

`markdown-language-features\src\preview\documentRenderer.ts`：

```ts
// :249 脚本注入
`<script async${type} src="${asWebviewUri(script.resource)}" nonce="${nonce}" charset="UTF-8"></script>`
// :275 Strict 级 CSP
`default-src 'none'; img-src 'self' ${rule} https: data:; media-src 'self' ${rule} https: data:; script-src 'nonce-${nonce}'; style-src 'self' ${rule} 'unsafe-inline' https: data:; font-src 'self' ${rule} https: data:;`
// （${rule} = cspSource.split(';')[0]；注意 script-src **只**有 nonce，不含 ${rule}）
```

```ts
// :237 样式注入（link 不带 nonce）
`<link rel="stylesheet" type="text/css" href="${asWebviewUri(resource)}">`
```

---

## 对 plan 的修订（原 plan 以 1.71.2 为基线，现改为 1.137.0 实机）

1. **D2 由"依赖宿主 mermaid 扩展走 previewScripts"升级为确证**：内置 `mermaid-markdown-features` 就是该扩展点的真实使用者 → 无需自造 fixture，R1 有了官方级验证对象。
2. **R3 实现方式改为 `contributes.configurationDefaults`**：把 `markdown-mermaid.mouseNavigation.enabled` 的默认从 `alt` 抬到 `always`（declarative、零冲突、同时改善内置预览），不再自 bundle mermaid。
3. **R5 前端 0 行**：webview 外壳已注入点击上报（`pre/main.js` 的 `did-click-link`），链接改写 + `enableCommandUris:true` 即通 → 原计划的 `media/html.js` 取消。
4. **1.137 有新版 Markdown 编辑器**（`vscode.markdown.editor`，option）→ 保留"我们自己实现编辑器"的必要性论证在 Task 8 的实测中给出。
