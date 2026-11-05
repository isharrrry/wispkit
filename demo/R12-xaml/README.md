# R12 —— XAML 源码 + 渲染演示数据

四个**纯 WPF** 的 `.xaml`，都**实际跑过渲染器并成功出图**（不是"写完就宣称成功"）。
`rendered/` 里就是这四份的实跑产物，可以直接对照。

## 怎么打开

在 VS Code 里右键任一 `.xaml` → **Reopen Editor With…** → **Wispkit XAML**。
左侧是可编辑的源码（带行号），右侧是渲染结果（滚轮缩放、按住右键平移、双击复位、可全屏放大）。

## 四个文件与真实渲染结果

| 文件 | 覆盖点 | 预期效果 | 实测结果 |
| --- | --- | --- | --- |
| `01-minimal.xaml` | `Window` 根 + 单个 `TextBlock` + 中文字体 | 米色背景上一行居中中文标题 | **ok=true** · 420×200 · `mode=rootObjectInstance` · 7272 B |
| `02-form-layout.xaml` | `Grid` 两列布局、`TextBox` / `ComboBox` / `RadioButton` / `Slider` / `CheckBox` / 多行 `TextBox`、底部按钮条、两种按钮配色 | 完整表单：蓝色标题栏、五个字段、65% 滑块、三态复选、备注换行 | **ok=true** · 560×400 · `mode=rootObjectInstance` · 17663 B |
| `03-data-list.xaml` | `TabControl` 两个页签、`ListBox` + 内联 `ListBoxItem` 做四列表格、等宽字体日志、`ScrollViewer` | 「设备清单」页签里四列对齐的 5 行设备表 + 「日志」页签里的等宽彩色日志 | **ok=true** · 640×420 · `mode=parse` · 11291 B |
| `04-dashboard.xaml` | `Grid.Resources` 内联具名/隐式 `Style`、`LinearGradientBrush`、`Border` 圆角卡片、`ProgressBar`、`GroupBox`、`Expander`、`Slider`、`StatusBar`、`Ellipse` 指示灯 | 深色仪表盘：渐变标题栏 + 三张指标卡 + 采样设置 + 底部状态栏 | **ok=true** · 700×460 · `mode=rootObjectInstance` · 29044 B |

四张图都逐张目视核对过：控件、中文、颜色、进度条/滑块位置都渲染正确，不是白图。

## 怎么自己复现

```powershell
$exe = "D:\AllData\AIDATA\techsearch\Wispkit\tools\xaml-render\bin\Release\net10.0-windows\XamlRender.exe"
& $exe render .\04-dashboard.xaml .\out.png --json
```

`--json` 的**最后一行**是结果对象，成功时形如：

```json
{"ok":true,"png":"...","width":700,"height":460,"root":"Grid","mode":"rootObjectInstance","ms":599}
```

渲染器契约：`<renderer> render <in.xaml> <out.png> [--assembly <dll>]… [--json]`。

## 三个真实踩到的坑（写演示数据时验证出来的）

1. **`Grid` / `StackPanel` 没有 `FontFamily`、`FontSize`** —— 它们不是 `Control`。
   直接写 `FontFamily="…"` 会渲染失败：`无法设置未知成员"System.Windows.Controls.Grid.FontFamily"`。
   要给整片中文换字体，用 `Resources` 里的**隐式样式**：`<Style TargetType="TextBlock"><Setter Property="FontFamily" …/></Style>`。
   （`Window` / `TabControl` 是 `Control`，可以直接设。）
2. **`ListBoxItem` 不会撑满宽度** —— 里面 `Grid` 的 `Width="*"` 列无从计算，四列会挤成一串文字。
   修法：`ListBox` 加 `HorizontalContentAlignment="Stretch"`，并给内层 `Grid` 一个显式宽度。
3. **`ListView` + `GridView` 不要用** —— `GridView` 列头初始化会让 WPF 往 `%TEMP%\WPF\` 写临时文件，受限环境下直接渲染失败。本目录用 `TabControl` + `ListBox` 规避。

## 这些文件刻意不包含

`x:Class`、事件处理器（`Click=` 等）、`xmlns:local` / 自定义控件、跨文件 `StaticResource`、`Application` 根、`ResourceDictionary` 根 ——
这些都会让渲染失败（`x:Class` 指向的类型必须已编译进程序集时才另说）。演示数据只在**标准控件 + 同文件内联资源**的范围内选材。
