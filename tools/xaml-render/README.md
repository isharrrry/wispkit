# XamlRender —— WPF XAML → PNG 渲染器（路线①）

把 WPF `.xaml` 渲染成 PNG，供 VS Code 扩展做「一屏同时看代码与渲染效果」。

与早期探针（`XamlReader.Parse` 单文件路线，结论见
[`.claude/plans/xaml-render-spike-结论.md`](../.claude/plans/xaml-render-spike-结论.md)，探针代码已删）的关键差别：**先加载目标项目的已编译程序集，再用
`XamlObjectWriterSettings.RootObjectInstance` 让 XAML 往真实的根类型实例上填内容**，
而不是拿 `XamlReader.Parse` 硬啃文本。这样 `x:Class`、`clr-namespace:...` 的自定义控件
才有机会被解析出来 —— 那正是 spike 里 17 个真实文件全灭的原因。

---

## 一、构建与 publish

```powershell
cd D:\AllData\AIDATA\techsearch\Wispkit\tools\xaml-render

# 构建（开发用）
dotnet build XamlRender.csproj -c Release

# 发布（宿主扩展用的就是这一份）
dotnet publish XamlRender.csproj -c Release --no-self-contained -o publish
```

产物（**framework-dependent**，不是 self-contained、不是单文件 —— 体积必须小到能进 VSIX）：

| 文件 | 字节 | 说明 |
|---|---|---|
| `publish\XamlRender.dll` | 25600 | 主程序 |
| `publish\XamlRender.exe` | 162304 | apphost（可直接双击/直接调用） |
| `publish\XamlRender.deps.json` | 424 | |
| `publish\XamlRender.runtimeconfig.json` | 519 | 需要 `Microsoft.WindowsDesktop.App` |
| `publish\XamlRender.pdb` | 17340 | 可删（发布时加 `-p:DebugType=none`） |

绝对路径：
- 主程序：`D:\AllData\AIDATA\techsearch\Wispkit\tools\xaml-render\publish\XamlRender.dll`
- 可执行：`D:\AllData\AIDATA\techsearch\Wispkit\tools\xaml-render\publish\XamlRender.exe`

**运行时前置**：本机需有 .NET 10 运行时与 `Microsoft.WindowsDesktop.App`（WPF）。
调用方式二选一：`dotnet …\publish\XamlRender.dll …` 或直接 `…\publish\XamlRender.exe …`。

构建环境（实测）：`dotnet SDK 10.0.203` + `Microsoft.WindowsDesktop.App 10.0.7`，Windows。
**`InvariantGlobalization` 不能设 true** —— `DataGrid` 之类会抛 `Cannot find non-neutral culture related to 'en-us'`。
`EnableDefaultPageItems=false` 也是必须的：本目录会放真实 XAML 素材，默认的 Page glob 会去编译它们并报 MC3074/MC6024。

---

## 二、CLI（宿主侧已按此冻结）

```
XamlRender render <in.xaml> <out.png> [--assembly <dll>]... [--width N] [--height N] [--class <FullTypeName>] [--json]
XamlRender check <in.png>
```

- stdout **最后一行**永远是单行 JSON：
  - 成功：`{"ok":true,"png":"…","width":1280,"height":800,"root":"Grid","mode":"rootObjectInstance","ms":478,"note":null}`
  - 失败：`{"ok":false,"error":"…","errorType":"XamlParseException","ms":12,"note":null}`
- 退出码：成功 `0` / 渲染失败 `1` / 参数错 `2`
- 不带 `--json` 时输出人类可读行（`OK 800x450 root=Grid mode=rootObjectInstance bytes=5129 ms=590`）
- `mode` ∈ `rootObjectInstance` | `parse`
- **`note` 是本实现额外附加的字段**（说明「用了哪个类型承载」「是否剥掉了 x:Class / 事件处理器」），宿主不认可以忽略
- `--assembly` 可重复；它所在目录会挂进程序集解析链（`AssemblyLoadContext.Default.Resolving`），依赖 dll 放在同一目录即可
- `check`：字节数 `<2048` 或 非白像素 `<0.1%` 或 唯一色 `<3` → 判 `BLANK`，退出码 1

示例：

```powershell
$exe = 'D:\AllData\AIDATA\techsearch\Wispkit\tools\xaml-render\publish\XamlRender.exe'
& $exe render D:\path\MainWindow.xaml out.png `
    --assembly D:\path\bin\Debug\net10.0-windows\MyApp.Wpf.dll --json
& $exe check out.png
```

### 根类型的挑选顺序

1. `--class` 显式指定（**找不到就报 `TypeNotFound`，不静默回退**）
2. XAML 的 `x:Class`
3. **根元素对应的 WPF 基类**（`<Window>`→`System.Windows.Window`、`<UserControl>`→…）

第 3 条是真实项目的主力：x:Class 类型能解析到，但它的构造函数依赖 DI 容器 / App 单例，
根本 new 不出来；用基类承载 XAML 内容照样能渲染出正确界面（见下文「关键实现要点」）。
每个候选类型都会配两种文本变体试：**原样** 与 **去掉 x:Class + 事件处理器**。

---

## 三、实测覆盖率

素材 = spike 的**同一批 17 个真实 XAML**（清单见 `run-real.ps1`），判定 = `render` 成功 **且** `check` 判非空白。

| | spike（`XamlReader.Parse`） | 本工具（路线①） |
|---|---|---|
| 渲染成功 | **0 / 17** | **4 / 17** |
| 渲染成功且非空白 | **0 / 17** | **1 / 17** |

复现：`pwsh -File run-real.ps1`（结果落在 `results-real.md`）。

### 成功的 4 个

| # | 文件 | 承载类型 | note | check |
|---|---|---|---|---|
| 01 | `NewsBoard\.wt\sa1\…\NewsBoard.Wpf\MainWindow.xaml` | 根元素 `<Window>` | 去掉 x:Class / 事件处理器 | BLANK 1280×800 |
| 03 | `NewsBoard\src\NewsBoard.Wpf\MainWindow.xaml` | 根元素 `<Window>` | 同上 | BLANK 1280×800 |
| 06 | `RT\…\IOInterface.WPF\TextFileEditWin.xaml` | 根元素 `<Window>` | 同上 | **OK 800×450 colors=94 nonWhite=12.68%** |
| 16 | `RT\…\IOInterface.WPF\CANMM\使能.xaml` | 根元素 `<UserControl>` | 原样 | BLANK 1×1 |

**那 3 张 BLANK 不是渲染失败，是内容本来就看不见**：

- #01 / #03 的内容是 `<blazor:BlazorWebView>` —— 需要 WebView2 运行时 + Blazor 组件初始化，
  静态快照里必然空白（spike 也预告了这点）。
- #16 源文件内容就是 `<Grid />` 一个空壳，渲染成 1×1 是正确的。

### 失败的 13 个 —— 按根因分类

| 分类 | 个数 | 素材 | 典型错误首行 |
|---|---|---|---|
| 自定义控件类型未知（**目标项目未编译**） | 3 | 07、10、14 | `无法创建未知类型"{clr-namespace:…;assembly=Common.Resources}WorkSpaceTreeView"` |
| 跨文件资源 | 2 | 11、12 | `在"System.Windows.StaticResourceExtension"上提供值时引发了异常`（资源在别的 XAML 文件里） |
| `ResourceDictionary` 根（非 FrameworkElement） | 2 | 13、15 | 根对象是 `System.Windows.ResourceDictionary`，没有可视内容 |
| MAUI XAML（不是 WPF 运行时） | 3 | 04、05、17 | `无法创建未知类型"{http://schemas.microsoft.com/dotnet/2021/maui}Application"` |
| `Application` 根 / 无可视内容 | 1 | 02 | `App.xaml` 的根不是 `FrameworkElement` |
| `{Binding}` 求值失败（无 DataContext） | 1 | 09 | `在"System.Windows.Data.Binding"上提供值时引发了异常` |

**关于程序集**：素材对应的项目里，`NewsBoard.Wpf` 和 `Common.Resources` 原本就有编译产物；
`IOInterface.WPF` 与 `DashGUI` 是本轮用 `dotnet build` 现场编出来的（**只 build，没改一行源码**）。
`RT\Test\UITest` 编译失败，原因与本次无关：`NU1605 检测到包降级: NPOI 从 2.7.0 降级到 2.6.2`
—— 项目自身预先存在的依赖冲突，修它需要改源码或包版本，超出授权范围。

### mode 分布与耗时

- 4 个成功项 **全部** 是 `mode=rootObjectInstance`（没有落到 `parse`）
- 单文件耗时 270–1200 ms（首次加载程序集的那次偏慢：`#06` 1159 ms → 后续 590 ms）
- 输出尺寸：`--width/--height` 优先 → 根的 Width/Height → `DesiredSize`，向下取整并保证 ≥1

---

## 四、目视结论（人工核对，不是只看数字）

两张都已用图像查看确认是**真界面**，不是乱码或纯白：

1. `out\real\06.png`（800×450，真实项目 `TextFileEditWin.xaml`）
   —— 顶部「打开 / 保存 / 另存为」工具栏（带图标与下拉箭头）、左侧行号栏（显示 `1`）、
   页边距虚线、右侧与底部滚动条。**与「文本文件编辑窗口」的预期完全一致。**
2. `out\quality-controls.png`（640×380，复杂控件样本）
   —— TabControl 两个页签、CheckBox、RadioButton、Slider、ProgressBar（绿色填充）、
   ComboBox、Expander、ListBox、DataGrid 表头「名 / 值」、GroupBox、StatusBar「就绪」，
   **中文全部正确渲染**。

---

## 五、关键实现要点（全是实测踩出来的，照抄能省很多时间）

1. **`XamlNodeType.None` 节点必须跳过**。
   `while (reader.Read()) writer.WriteNode(reader);` 这种教科书写法会失败：
   None 节点（文档边界）交给 writer 会让它的对象栈错位，报
   `XamlObjectWriterException: XAML 节点流: EndObject 前面缺少 CurrentObject`。
   加一句 `if (reader.NodeType == XamlNodeType.None) continue;` 即可。

2. **`LocalAssembly` 必须指向 XAML 的 `x:Class` 所在程序集**，不是承载实例的类型所在程序集。
   否则 `xmlns:local="clr-namespace:IFIOGUI"`（没有 `assembly=` 限定）会被解析到
   `PresentationFramework` 里去，报
   `无法创建未知类型"{clr-namespace:IFIOGUI;assembly=PresentationFramework, Version=10.0.0.0…}"`。
   **这一条把 `#06` 从 FAIL 变成 OK**，是覆盖率提升的最大单点。

3. **`RootObjectInstance` 与 `x:Class` 天然冲突**。
   当实例类型与 `x:Class` 声明的类名不一致时，writer 直接报
   `指令"…x:Class"必须是字符串类型的值`。所以「基类承载」这条路**必须**把 `x:Class` 去掉。

4. **`RuntimeHelpers.GetUninitializedObject` 这条路走不通**（试过，已放弃）。
   跳过构造函数造出来的 `DependencyObject` 内部状态是坏的 —— `Title` 这类依赖属性一设就崩，
   表现为同一个 `EndObject 前面缺少 CurrentObject`。**没有任何降级空间**。

5. **真实 WPF 窗口的构造函数普遍依赖 DI / App 单例**。
   实测 `NewsBoard.Wpf.MainWindow()` 里 `App.Services.GetService<ConfigStore>()` 抛
   `ArgumentNullException(provider)`。既然第 4 条堵死了「跳过构造」，就只能用**基类承载**：
   内容照样填得进去，只是 code-behind 的事件处理器接不上（所以配一个「剥掉事件属性」的文本变体）。

6. **异常链要展开**。构造函数里的失败几乎总被 `TargetInvocationException` 包着，
   只看最外层等于没看 —— `DescribeException` 会把 InnerException 一路串起来。

---

## 六、未完成与不确定

1. **没有做「跨文件资源预加载」**：`#11`/`#12` 的 `StaticResource` / `DynamicResource`
   指向别的 XAML 文件里的资源字典。出路是按 `App.xaml` / `Themes\*.xaml` 预加载资源字典，
   本工具没做。
2. **没有做「`ResourceDictionary` 根套宿主控件渲染」**：`#13`/`#15` 解析成功但没有可视内容。
   理论上可以塞进一个 `ContentControl.Resources` 再渲染，但它们是主题资源字典，
   渲染出来多半是空的 —— 投入产出比低，未做。
3. **事件处理器接不上**：只有「x:Class 类型构造成功」时才可能绑上（实例上有那些方法）。
   真实项目因第 5 条构造不出来，所以一律走「剥掉事件属性」。
4. **BlazorWebView 类内容必然是空白**：需要 WebView2 运行时 + 组件初始化，
   静态快照做不到（不是本工具的缺陷）。
5. **`UITest` 无法编译**：项目自身有 `NU1605` 包降级冲突，未修（不允许改源码）。
   因此 `#10` 的「自定义控件 `WorkSpaceTreeView`」这条路没有被真正验证过 ——
   它到底能不能渲染，**未确认**。
6. **`--class` 指向的程序集必须在 `--assembly` 里或已加载**：
   否则报 `TypeNotFound`。CLI 不做自动探测项目 bin 目录（宿主扩展应自己找到正确的 dll）。
7. **`run-real.ps1` 是 UTF-8 无 BOM 时会被 Windows PowerShell 按 GBK 读成乱码**
   （表现为 `Unexpected token`）。用 `pwsh`（PowerShell 7）跑，或先给脚本补 BOM。
