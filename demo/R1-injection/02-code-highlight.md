# R1-02 高亮样式覆盖面

> **验证点**：`markdown.previewStyles` 注入的 `highlight.css` 对所有语言都生效，
> 而不是只有个别语言有效。
> **判据**：每段代码块里，**关键字/字符串/注释至少有两种不同颜色**。

## JavaScript

```javascript
// 注释应为灰色系
export function createPanZoom(viewport, target, options = {}) {
	const step = options.wheelStep ?? 1.1;
	return { step, label: `zoom x${step}` };
}
```

## TypeScript

```typescript
interface MarkdownContributions {
	readonly scripts: readonly ResolvedPreviewScript[];
	readonly styles: readonly ResolvedPreviewStyle[];
}
```

## JSON

```json
{ "wispkit.toc.depth": 3, "wispkit.image.dragButton": "right", "enabled": true }
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "install $1" | tee /tmp/wispkit.log
```

## PowerShell

```powershell
$scripts = Get-Content .\package.json | ConvertFrom-Json
Write-Host "scripts: $($scripts.Count)" -ForegroundColor Green
```

## YAML

```yaml
name: wispkit
steps:
  - run: npm test
    env:
      CI: "true"
```

## HTML

```html
<a href="vscode://file/D:/demo.md:7">jump</a>
```

## Diff（看有没有增删配色）

```diff
- const isScrollWheelKeyPressed = ctrlPressed;
- if (!isScrollWheelKeyPressed && !e.ctrlKey) return;
+ if (!wheelZoomEnabled) return;
```

**期望**：`-` 行偏红、`+` 行偏绿。

## Markdown 里的源码块（不该被二次解析）

```markdown
# 这不是标题
**这不是粗体**
```

**期望**：原样显示星号和井号，不是渲染成标题/粗体。

## 无语言标注

```
没有任何语言标注的代码块
	const x = 1;
```

**期望**：等宽字体、无高亮，但**不应**报错。
