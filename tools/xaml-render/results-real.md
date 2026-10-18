# 路线①（加载程序集 + RootObjectInstance）实测结果

- 素材：spike 的同一批 17 个真实 XAML（清单见 un-real.ps1）
- 工具：`D:\AllData\AIDATA\techsearch\Wispkit\tools\xaml-render\bin\Release\net10.0-windows\XamlRender.dll`
- 判定：`render` 成功后再过 `check`（字节数/非白像素/唯一色）才算真正出图

**渲染成功 4/17；其中非空白（check OK）1，空白 3。**

| # | 文件 | 结果 | --assembly | 尺寸 / 字节 / 耗时 | check / note |
|---|---|---|---|---|---|
| 01 | MainWindow.xaml | OK | NewsBoard.Wpf.dll | 1280x800 / 5935 B / 366 ms | BLANK 1280x800 colors=1 nonWhite=0.00% bytes=5935 / 用 根元素 <Window> 承载，并去掉了 x:Class / 事件处理器 |
| 02 | App.xaml | FAIL | NewsBoard.Wpf.dll | InvalidOperationException | 没有可用的根类型组合：x:Class NewsBoard.Wpf.App 构造失败：TargetInvocationException: Exception has been thrown by the target of an invocation. <- InvalidOperationExce… |
| 03 | MainWindow.xaml | OK | NewsBoard.Wpf.dll | 1280x800 / 5935 B / 386 ms | BLANK 1280x800 colors=1 nonWhite=0.00% bytes=5935 / 用 根元素 <Window> 承载，并去掉了 x:Class / 事件处理器 |
| 04 | App.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <Application> + 去掉 x:Class 与事件处理器：XamlObjectWriterException: 无法创建未知类型“{http://schemas.microsoft.com/dotnet/2021/maui}Application”。 |
| 05 | App.xaml | FAIL | (无) | XamlParseException | “无法创建未知类型“{using:Microsoft.Maui}MauiWinUIApplication”。”，行号为“1”，行位置为“2”。 |
| 06 | TextFileEditWin.xaml | OK | IFIOGUI.dll | 800x450 / 5129 B / 590 ms | OK 800x450 colors=94 nonWhite=12.68% bytes=5129 / 用 根元素 <Window> 承载，并去掉了 x:Class / 事件处理器 |
| 07 | WpfPlotXUserControl.xaml | FAIL | (无) | XamlParseException | “无法创建未知类型“{clr-namespace:RTSimPlus.WorkSpace.ProjectManager.Project.MonitorPanel}AxControlBase”。”，行号为“1”，行位置为“2”。 |
| 08 | white.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <ResourceDictionary> + 原样：XamlObjectWriterException: 无法创建未知类型“{clr-namespace:LiveCharts.Wpf}ColorsCollection”。 |
| 09 | ModalGridWindow.xaml | FAIL | Common.Resources.dll | InvalidOperationException | 没有可用的根类型组合：x:Class WpfApp.ModalGridWindow + 原样：XamlObjectWriterException: 在“System.Windows.Data.Binding”上提供值时引发了异常。 <- XamlParseException: 不能在“ModalGr… |
| 10 | WindowTree.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <Window> + 去掉 x:Class 与事件处理器：XamlObjectWriterException: 无法创建未知类型“{clr-namespace:Common.Resources.Tree;assembly=Common.Resources}WorkSpa… |
| 11 | 用户管理View.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <UserControl> + 去掉 x:Class 与事件处理器：XamlObjectWriterException: 在“System.Windows.DynamicResourceExtension”上提供值时引发了异常。 <- XamlParseExceptio… |
| 12 | Theme.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <ResourceDictionary> + 原样：XamlObjectWriterException: 在“System.Windows.StaticResourceExtension”上提供值时引发了异常。 <- Exception: 无法找到名为“ButtonSt… |
| 13 | WindowStyleWin7.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <ResourceDictionary>：不是 FrameworkElement（实际 System.Windows.ResourceDictionary） |
| 14 | Generic.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <ResourceDictionary> + 原样：XamlObjectWriterException: 无法从文本“local:IPTextBox”创建“Type”。 <- XamlParseException: 类型引用无法找到名为“{clr-namespace:串… |
| 15 | bold.xaml | FAIL | (无) | InvalidOperationException | 没有可用的根类型组合：根元素 <ResourceDictionary> + 原样：XamlObjectWriterException: 无法创建未知类型“{clr-namespace:System;assembly=mscorlib}Double”。 |
| 16 | 使能.xaml | OK | IFIOGUI.dll | 1x1 / 120 B / 264 ms | BLANK 1x1 colors=1 nonWhite=0.00% bytes=120 /  |
| 17 | App.xaml | FAIL | (无) | XamlParseException | “无法创建未知类型“{using:Microsoft.Maui}MauiWinUIApplication”。”，行号为“2”，行位置为“2”。 |

