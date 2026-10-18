# XAML → PNG 渲染 spike 结论（已归档）

> 这是 Wispkit「XAML 源码 + 渲染并排」功能**动工前的可行性探针**结论。探针代码（`Wispkit-xaml-spike/`）已删除，只留本文。
> 保留它的理由：**记清哪条路走过、为什么不通、官方指引在哪** —— 避免以后又有人（包括 AI）从头用 `XamlReader.Parse` 硬啃一遍。
>
> - 探针版本：`dotnet 10.0.203` / `Microsoft.WindowsDesktop.App 10.0.7` / 无 NuGet 包、无网络
> - 探针做法：`File.ReadAllText` → `XamlReader.Parse` → （`Window` 则取 `Content`）→ `Measure/Arrange/UpdateLayout` → `RenderTargetBitmap`(96dpi, Pbgra32) → 合成白底 → `PngBitmapEncoder`
> - 判定「不是空白」：字节数 + 非白像素占比 + 唯一色数三项
> - 失败如实上抛（`FAIL <异常类型> :: <首行>`），**没有伪造 `x:Class` 类型、没有反射塞桩**

## 一句话结论

**只用 `XamlReader.Parse` 的单文件渲染路径，在真实项目文件上覆盖率是 0/17；只有自造的、不含自定义类型与 `x:Class` 的 XAML 能渲染（5/5）。**

## 一、自建样本：5/5 成功

| 样本覆盖点 | 结果 |
|---|---|
| 纯标准控件（Grid/StackPanel/Button/TextBlock） | OK 234 ms · 420×200 / 4029 B · nonWhite=100% |
| `UserControl.Resources` 内联 Style + SolidColorBrush 被引用 | OK 233 ms · 420×200 / 5105 B · nonWhite=5.03% |
| 无 DataContext 的 `{Binding}` + `{StaticResource}` | OK 243 ms · 420×200 / 2553 B · nonWhite=0.84% |
| `ControlTemplate` + `Trigger` + `DataTrigger` | OK 261 ms · 460×240 / 5627 B · nonWhite=4.75% |
| TabControl/DataGrid/ListBox/Slider/ProgressBar/ComboBox/Expander/GroupBox/StatusBar/中文 | OK 394 ms · 640×380 / 13251 B · nonWhite=38.40%（**目视核对正确**） |

无 DataContext 的 `{Binding}` **不抛异常**，只是渲染成空文本。单文件 230–430 ms。

## 二、真实文件：0/17

分母 17（`NewsBoard.Wpf` / `NewsBoard.Maui` / `RT` 下多个 WPF 项目，含用户管理、Theme、Generic 等真实形态）。

| 根因分类 | 个数 | 占比 | 典型异常首行 |
|---|---|---|---|
| `x:Class` 引用未编译类型 | 7 | 41% | `Specified class name 'X' doesn't match actual root instance type 'System.Windows.Window'` |
| 自定义控件类型未知（`clr-namespace`） | 3 | 18% | `Cannot create unknown type '{clr-namespace:...;assembly=...}WorkSpaceTreeView'` |
| MAUI / WinUI 类型未知 | 3 | 18% | `Cannot create unknown type '{http://schemas.microsoft.com/dotnet/2021/maui}Application'` |
| `Application` 根构造失败 | 1 | 6% | `The invocation of the constructor on type 'System.Windows.Application' ... threw` |
| `StaticResource` 解析失败（资源在别的文件） | 1 | 6% | `Provide value on 'System.Windows.StaticResourceExtension' threw` |
| **解析成功但根不可视**（根是 `ResourceDictionary`） | 2 | 12% | `根对象是 System.Windows.ResourceDictionary，不是 FrameworkElement` |

即**真正解析失败 15/17**，另 2/17 是「解析成功但没有可视内容」—— 两类要用不同策略，不是同一类失败。

## 三、文本预处理收益：零（0/10 → 0/10）

1. 删根元素 `x:Class` → 仍 0 成功，**障碍下移一层**：事件处理器无法绑定（2）+ 自定义类型未知（5）+ Application/MAUI（3）。
2. 再删 46 个常见事件属性 → 6 个样本仍 0 成功，障碍**全部**收敛到「自定义类型未知」（`BlazorWebView`/`DockGridView`/`WorkSpaceTreeView`/`AxControlBase`/`TextFileEditView`）。

**结论**：文本预处理能一层层剥掉 `x:Class`→事件处理器，但**剥不掉 `clr-namespace:...;assembly=...`** —— 那需要目标程序集本身。**预处理到此为止。**

## 四、能 / 不能

**能**：纯标准 WPF 控件的完整布局与美化（TabControl/DataGrid/ListBox/Slider/ProgressBar/ComboBox/Expander/GroupBox/StatusBar/中文字体）；同文件内联 `Style`/`ControlTemplate`/`Trigger`/`DataTrigger`/`SolidColorBrush`；`Window` 根（降级渲染 `Content`）；无 DataContext 的 `{Binding}`。

**不能**：`x:Class` 指向的任何类型、事件处理器、`xmlns:local` 自定义控件、跨文件资源、`App.xaml` 全局资源（本进程无真正 `Application` 资源上下文）、`ResourceDictionary` 根、MAUI/WinUI XAML（不同运行时）。

## 五、官方出路（异常原文自己给的，不是猜的）

> `Remove the Class directive or provide an instance via XamlObjectWriterSettings.RootObjectInstance.`

即「先 `new` 出目标类型实例，再让 XAML 往它上面填内容」—— 需要 `XamlXmlReader` + `XamlObjectWriter` 并**加载目标程序集**。这是覆盖真实 WPF 项目文件的唯一路径，**代价是必须先编译目标项目**。

## 六、与最终实现的关系（两条路交接）

| 阶段 | 路线 | 同一批 17 个真实文件的成绩 |
|---|---|---|
| 本探针 | `XamlReader.Parse` 单文件 | **0/17**（本文） |
| 后续 | 加载程序集 + `RootObjectInstance` | **4/17 渲染成功，非空白仅 1**（详见 `tools/xaml-render/results-real.md`） |
| 最终 | 换 `Common.Resources` 控件场景复验 | **6/6 成功**（`Work`/`WorkStartButton`/… 渲染出 ▶⏸⏹ 按钮组） |

最终实现位置：`src/xaml/renderer.ts` 用 `execFile` 调用 `tools/xaml-render` 的 exe。
**要注意**：即便打通，XAML 渲染也只是**静态快照** —— 无绑定数据、事件不触发、`BlazorWebView` 还需 WebView2 运行时。适合看排版，不适合看运行态。

## 七、踩到的三个本机坑（会影响后续同类脚本）

1. **PowerShell 5.1 按 GBK 解码无 BOM 的 UTF-8 `.ps1`**：脚本里的中文路径（`70_产品与研发`、`用户管理View.xaml`）变乱码导致 `Test-Path` 失败（表现为 `MISSING`），严重时直接解析报错。→ 脚本一律补 UTF-8 BOM。
2. **`Microsoft.NET.Sdk` 默认把所有 `**/*.xaml` 当 `Page` 编译**：把真实 XAML 复制进项目目录后 `dotnet build` 报 MC3074/MC6024。→ csproj 设 `EnableDefaultPageItems=false`。
3. **`<InvariantGlobalization>true</InvariantGlobalization>` 会让 `DataGrid` 之类抛** `Cannot find non-neutral culture related to 'en-us'`。→ 移除该属性。

## 八、未能确认（探针边界）

1. 加载目标程序集后的**全量**覆盖率 —— 探针未引用任何 NuGet 包，未测。
2. 创建真正的 `Application` 实例并初始化资源上下文后，`App.xaml` 能否解析 —— 未测。
3. 第 2 层预处理的事件名清单（46 个）是否穷尽 —— 未测。
4. 两个 `ResourceDictionary` 根文件「套宿主控件再渲染」能否出图 —— 未做实验。
