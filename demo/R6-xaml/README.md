# R6-xaml —— Wispkit XAML 视图示例

这 4 个 `.xaml` 是给 **Wispkit XAML 视图**（源码 + 渲染并排）准备的示例数据。

## 怎么打开

`.xaml` 默认仍由 VS Code 的文本编辑器打开（Wispkit XAML 是 `option` 优先级，不抢默认）。任选一种：

| 方式 | 操作 |
|---|---|
| 编辑器切换 | 在已打开的 `.xaml` 上右键 → **Reopen Editor With…** → **Wispkit XAML（源码 + 渲染）** |
| 命令面板 | `Ctrl+Shift+P` → `Wispkit: Open with Wispkit`（光标要在 `.xaml` 文件里） |

打开后：左侧是**可编辑**的源码（带行号栏），右侧是渲染结果。

## 这四个文件

| 文件 | 内容 | 看什么 |
|---|---|---|
| `01-controls-showcase.xaml` | 标准控件全家桶（按钮 / 复选框 / 单选框 / 下拉 / 文本框 / 滑块 / 进度条 / 状态栏） | 中文字形、控件外观、`Window` 根渲染 |
| `02-grid-layout.xaml` | Grid 行列、星号宽度、Border 嵌套、UniformGrid | 布局是否按比例展开、留白是否合理 |
| `03-data-display.xaml` | ListBox / ListView + GridView / GroupBox / ProgressBar | 列表、表格列、分组框的静态呈现 |
| `04-styles-and-shapes.xaml` | 同文件 Style、`StaticResource` 渐变、Canvas + Rectangle / Ellipse / Path / Line | 样式与图形是否生效、加粗与斜体字形 |

## 在视图里能做什么

- **编辑**：左侧就是文本域，改完点「**重新渲染**」直接用**当前文本**出图，不必先存盘。`Tab` 插入 4 个空格，`Ctrl+S` 保存。
- **保存**：「保存」按钮把内容写回磁盘文件，成功/失败显示在右上角状态栏。
- **缩放**：右侧滚轮缩放、按住**右键**拖动平移、双击复位；「放大查看」开全屏模态框，「适应窗口」复位缩放。
- **行号**：行号栏与文本域共用同一套字体度量与固定行高（13px / 20px），滚动时同步。

## 为什么这些示例一定能渲染出来

渲染器走的是 WPF 自己的 `XamlReader`。下面这些会让真实项目的 XAML 渲染失败，所以示例里**故意都不用**：

- `x:Class`（指向没有编译进程序集的类型）
- 事件处理器（`Click="..."` 这类）
- 自定义控件、`clr-namespace` / `assembly=` 限定
- **跨文件**的 `StaticResource`（资源字典在另一个 xaml 里）

`04-styles-and-shapes.xaml` 确实用了 `StaticResource`，但资源就定义在**同一个文件**里，所以没问题。

## 已验证的渲染结果

四个示例都用扩展自带的渲染器实跑过（`XamlRender.exe render <xaml> <png> --json`），全部 `ok:true`，`check` 也都判非空白：

| 文件 | 尺寸 | 唯一色 | 非白像素 |
|---|---|---|---|
| `01-controls-showcase.xaml` | 560×430 | 209 | 14.3% |
| `02-grid-layout.xaml` | 600×380 | 80 | 34.0% |
| `03-data-display.xaml` | 620×400 | 228 | 26.7% |
| `04-styles-and-shapes.xaml` | 560×400 | 576 | 19.5% |

### 一条踩到的坑：别在示例里用 `ListView` + `GridView`

`03-data-display.xaml` 最开始右列用的是 `ListView` + `GridView`，渲染直接失败：

```
Access to the path 'C:\Users\PC\AppData\Local\Temp\WPF\<随机名>' is denied.
```

`GridView` 的列头初始化会让 WPF 往 `%TEMP%\WPF\` 写临时文件；在**受限环境**（沙箱、受控文件夹访问等）下这一步被拒，整个渲染就挂。换成 `TabControl` 后一切正常。真实桌面一般没这个限制 —— 但如果哪天渲染莫名失败、且错误里出现 `%TEMP%\WPF`，就是这条。

## 边界

渲染结果是**静态快照**：没有 DataContext、不跑事件处理器、不启动消息循环。适合看排版与样式，不能反映运行态（数据绑定出来会是空的）。
