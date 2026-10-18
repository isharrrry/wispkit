using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xaml;

/// <summary>
/// 把 WPF XAML 渲染成 PNG。
///
/// 两条路径：
///   rootObjectInstance —— 先加载目标程序集、构造 x:Class 指向的根类型实例，再用
///     XamlXmlReader + XamlObjectWriter(RootObjectInstance) 让 XAML 往这个实例上填内容。
///     这是唯一能覆盖真实项目文件的路径（自定义控件、事件处理器都在编译好的程序集里）。
///   parse —— 没有根类型时的退化路径：XamlReader.Parse 直接解析文本，只对不含
///     自定义类型与 x:Class 的 XAML 有效。
/// </summary>
internal static class Program
{
	private const string Usage =
		"usage: XamlRender render <in.xaml> <out.png> [--assembly <dll>]... [--width N] [--height N] [--class <FullTypeName>] [--json]\n" +
		"       XamlRender check <in.png>";

	/// <summary>--assembly 所在目录；程序集解析按目录顺序探测。</summary>
	private static readonly List<string> ProbeDirectories = new List<string>();

	/// <summary>已显式加载的程序集，用于把 x:Class / --class 解析成 <see cref="Type"/>。</summary>
	private static readonly List<Assembly> LoadedAssemblies = new List<Assembly>();

	/// <summary>本次渲染的一条诊断说明（例如「跳过了构造函数」），附在结果里供宿主展示。</summary>
	private static string? LastNote;

	/// <summary>WPF 常见事件属性名（值写成 code-behind 方法名的那种）。</summary>
	private static readonly string[] EventPropertyNames =
	{
		"Click", "Loaded", "Unloaded", "Initialized", "StateChanged", "SizeChanged", "Closing", "Closed",
		"ContentRendered", "Activated", "Deactivated", "PreviewKeyDown", "PreviewKeyUp", "KeyDown", "KeyUp",
		"PreviewMouseDown", "PreviewMouseUp", "PreviewMouseMove", "MouseDown", "MouseUp", "MouseMove",
		"MouseWheel", "MouseEnter", "MouseLeave", "MouseDoubleClick", "MouseLeftButtonDown", "MouseLeftButtonUp",
		"MouseRightButtonDown", "MouseRightButtonUp", "GotFocus", "LostFocus", "SelectionChanged", "TextChanged",
		"Checked", "Unchecked", "ValueChanged", "Drop", "DragEnter", "DragLeave", "DragOver",
		"Expanded", "Collapsed", "DataContextChanged", "DropDownOpened", "DropDownClosed", "TextInput",
		"PreviewTextInput", "SourceInitialized", "LocationChanged", "DragDelta", "NavigationFailed",
	};

	/// <summary>
	/// XAML 根元素名 → 承载它的 WPF 类型。
	/// 真实项目的 x:Class 类型往往构造不出来（构造函数依赖 DI 容器 / App 单例），
	/// 而「跳过构造函数」造出来的 DependencyObject 内部状态是坏的（Title 这类依赖属性一设就崩）
	/// —— 实测这条退路走不通。改用这些基类类型承载 XAML 内容，渲染结果依然正确。
	/// </summary>
	private static readonly Dictionary<string, string> RootElementTypes = new Dictionary<string, string>(StringComparer.Ordinal)
	{
		["Window"] = "System.Windows.Window",
		["Page"] = "System.Windows.Controls.Page",
		["UserControl"] = "System.Windows.Controls.UserControl",
		["Application"] = "System.Windows.Application",
		["ResourceDictionary"] = "System.Windows.ResourceDictionary",
		["Grid"] = "System.Windows.Controls.Grid",
		["StackPanel"] = "System.Windows.Controls.StackPanel",
		["DockPanel"] = "System.Windows.Controls.DockPanel",
		["Canvas"] = "System.Windows.Controls.Canvas",
		["WrapPanel"] = "System.Windows.Controls.WrapPanel",
		["Border"] = "System.Windows.Controls.Border",
		["ScrollViewer"] = "System.Windows.Controls.ScrollViewer",
		["ContentControl"] = "System.Windows.Controls.ContentControl",
		["ItemsControl"] = "System.Windows.Controls.ItemsControl",
		["Control"] = "System.Windows.Controls.Control",
		["HeaderedContentControl"] = "System.Windows.Controls.HeaderedContentControl",
		["Viewbox"] = "System.Windows.Controls.Viewbox",
	};

	[STAThread]
	private static int Main(string[] args)
	{
		Console.OutputEncoding = Encoding.UTF8;

		if (args.Length == 0)
		{
			return UsageError(Usage, json: false);
		}

		if (string.Equals(args[0], "check", StringComparison.OrdinalIgnoreCase))
		{
			return args.Length >= 2 ? Check(args[1]) : UsageError("check needs <in.png>", json: false);
		}

		if (string.Equals(args[0], "render", StringComparison.OrdinalIgnoreCase))
		{
			return Render(args);
		}

		return UsageError($"unknown command '{args[0]}'\n{Usage}", json: false);
	}

	private static int Render(string[] args)
	{
		string? inPath = null;
		string? outPath = null;
		string? className = null;
		var assemblyPaths = new List<string>();
		var width = double.NaN;
		var height = double.NaN;
		var json = false;

		for (var i = 1; i < args.Length; i++)
		{
			switch (args[i])
			{
				case "--json":
					json = true;
					break;
				case "--assembly":
					assemblyPaths.Add(RequireValue(args, ref i, "--assembly"));
					break;
				case "--class":
					className = RequireValue(args, ref i, "--class");
					break;
				case "--width":
					width = ParseSize(RequireValue(args, ref i, "--width"));
					if (double.IsNaN(width))
					{
						return UsageError("--width 需要一个正数", json);
					}
					break;
				case "--height":
					height = ParseSize(RequireValue(args, ref i, "--height"));
					if (double.IsNaN(height))
					{
						return UsageError("--height 需要一个正数", json);
					}
					break;
				default:
					if (args[i].StartsWith("--", StringComparison.Ordinal))
					{
						return UsageError($"unknown option '{args[i]}'", json);
					}
					if (inPath == null)
					{
						inPath = args[i];
					}
					else if (outPath == null)
					{
						outPath = args[i];
					}
					else
					{
						return UsageError($"unexpected argument '{args[i]}'", json);
					}
					break;
			}
		}

		if (inPath == null || outPath == null)
		{
			return UsageError("render 需要 <in.xaml> 与 <out.png> 两个位置参数", json);
		}

		var stopwatch = Stopwatch.StartNew();
		var mode = "parse";

		try
		{
			// 资源查找（DynamicResource / 系统资源键）需要一个 Application 实例，但绝不 Run 它
			_ = new Application();

			LoadAssemblies(assemblyPaths);

			var fullIn = Path.GetFullPath(inPath);
			if (!File.Exists(fullIn))
			{
				return UsageError($"找不到输入文件：{fullIn}", json);
			}

			var text = File.ReadAllText(fullIn);
			var candidates = CollectRootTypeCandidates(text, className);
			if (className != null && candidates.Count == 0)
			{
				// 显式指定的类型必须能找到（x:Class 找不到则退回 parse，与仅有 XamlReader 的行为一致）
				return FailReport(json, stopwatch, mode,
					$"找不到类型 '{className}'（用 --assembly 指定它所在的 dll）", "TypeNotFound", human: null);
			}

			FrameworkElement element;
			var viaWpfReader = TryParseWithWpfReader(text, CandidateAssemblyNames(text, assemblyPaths));

			if (viaWpfReader != null)
			{
				mode = "parse";
				element = viaWpfReader;
			}
			else if (candidates.Count > 0)
			{
				mode = "rootObjectInstance";
				element = CreateViaObjectWriter(text, candidates);
			}
			else
			{
				var parsed = System.Windows.Markup.XamlReader.Parse(text);
				if (parsed is not FrameworkElement frameworkElement)
				{
					return FailReport(json, stopwatch, mode,
						$"根对象是 {parsed?.GetType().FullName ?? "null"}，不是 FrameworkElement",
						"NotAFrameworkElement", human: null);
				}
				element = frameworkElement;
			}

			// Window 自己必须是视觉树根，不能直接 Measure/Arrange —— 渲染它的 Content
			if (element is Window window)
			{
				if (double.IsNaN(width) && !double.IsNaN(window.Width) && window.Width > 0)
				{
					width = window.Width;
				}
				if (double.IsNaN(height) && !double.IsNaN(window.Height) && window.Height > 0)
				{
					height = window.Height;
				}

				var content = window.Content as FrameworkElement;
				if (content == null)
				{
					return FailReport(json, stopwatch, mode,
						"Window.Content 为空或不是 FrameworkElement（Show 之前没有可渲染的视觉子树）",
						"EmptyWindowContent", human: null);
				}
				element = content;
			}

			var (finalWidth, finalHeight) = Layout(element, width, height);
			var bitmap = Render(element, finalWidth, finalHeight);

			var fullOut = Path.GetFullPath(outPath);
			var directory = Path.GetDirectoryName(fullOut);
			if (!string.IsNullOrEmpty(directory))
			{
				Directory.CreateDirectory(directory);
			}

			var encoder = new PngBitmapEncoder();
			encoder.Frames.Add(BitmapFrame.Create(bitmap));
			using (var stream = File.Create(fullOut))
			{
				encoder.Save(stream);
			}

			stopwatch.Stop();
			var payload = new Dictionary<string, object?>
			{
				["ok"] = true,
				["png"] = fullOut,
				["width"] = (int)finalWidth,
				["height"] = (int)finalHeight,
				["root"] = element.GetType().Name,
				["mode"] = mode,
				["ms"] = stopwatch.ElapsedMilliseconds,
				["note"] = LastNote,
			};
			var human = $"OK {finalWidth:0}x{finalHeight:0} root={element.GetType().Name} mode={mode} bytes={new FileInfo(fullOut).Length} ms={stopwatch.ElapsedMilliseconds}";
			return Emit(json, payload, human, 0);
		}
		catch (Exception ex)
		{
			// 事件处理器绑不上是最常见的一类「目标程序集已加载但 code-behind 不匹配」
			var isEventHandler = LooksLikeEventHandlerError(ex);
			var error = isEventHandler
				? $"事件处理器无法绑定：{FirstLine(ex.Message)}"
				: FirstLine(ex.Message);
			return FailReport(json, stopwatch, mode, error, isEventHandler ? "EventHandlerBinding" : ex.GetType().Name, human: null);
		}
	}

	/// <summary>
	/// 挑出可用于 RootObjectInstance 的根类型，按优先级：
	/// `--class`（显式指定就只用它）→ XAML 的 `x:Class` → 根元素对应的 WPF 基类。
	///
	/// 第三条是真实项目的主力：x:Class 类型能解析到，但它的构造函数依赖 DI 容器 / App 单例，
	/// 根本 new 不出来（实测 NewsBoard 的 MainWindow 抛 ArgumentNullException(provider)）；
	/// 用基类承载 XAML 内容一样能渲染出正确的界面。
	/// </summary>
	private static List<(string Label, Type Type)> CollectRootTypeCandidates(string text, string? className)
	{
		var candidates = new List<(string Label, Type Type)>();

		if (className != null)
		{
			var explicitType = ResolveType(className);
			if (explicitType != null)
			{
				candidates.Add(($"--class {className}", explicitType));
			}
			return candidates;
		}

		var classAttribute = ExtractClassAttribute(text);
		if (classAttribute != null)
		{
			var declared = ResolveType(classAttribute);
			if (declared != null)
			{
				candidates.Add(($"x:Class {classAttribute}", declared));
			}
		}

		var elementName = ExtractRootElementName(text);
		if (elementName != null && RootElementTypes.TryGetValue(elementName, out var mapped))
		{
			var elementType = ResolveType(mapped);
			if (elementType != null && candidates.All(candidate => candidate.Type != elementType))
			{
				candidates.Add(($"根元素 <{elementName}>", elementType));
			}
		}

		return candidates;
	}

	/// <summary>取 XAML 里第一个真正的元素标签名（自动跳过 XML 声明、注释、DOCTYPE）。</summary>
	private static string? ExtractRootElementName(string xaml)
	{
		var match = Regex.Match(xaml, "<\\s*([A-Za-z_][\\w\\-]*(?::[\\w\\-]+)?)[\\s/>]", RegexOptions.Multiline);
		if (!match.Success)
		{
			return null;
		}
		var name = match.Groups[1].Value;
		var colon = name.IndexOf(':');
		return colon >= 0 ? name.Substring(colon + 1) : name;
	}

	/// <summary>删掉值为 code-behind 方法名的事件属性 —— 基类实例上没有那些方法，留着必然绑不上。</summary>
	private static string StripEventHandlers(string xaml)
	{
		var pattern = "\\s+(?:" + string.Join("|", EventPropertyNames) + ")=\"[^\"]*\"";
		return Regex.Replace(xaml, pattern, string.Empty);
	}

	/// <summary>
	/// 路线①：先造实例，再让 XAML 往实例上填内容。
	///
	/// 候选类型 × 文本变体逐个试：类型构造不出来就跳过（真实项目的 DI 构造函数），
	/// 事件处理器绑不上就用「剥掉事件属性」的变体。
	/// </summary>
	private static FrameworkElement CreateViaObjectWriter(string text, List<(string Label, Type Type)> candidates)
	{
		var stripped = StripEventHandlers(RemoveClassDirective(text));
		var hasClassDirective = !string.Equals(stripped, text, StringComparison.Ordinal);

		// XAML 里 x:Class 指向的程序集才是「本地程序集」：没有 assembly= 限定的 clr-namespace 靠它解析
		var declaredClass = ExtractClassAttribute(text);
		var localAssembly = (declaredClass != null ? ResolveType(declaredClass)?.Assembly : null)
			?? LoadedAssemblies.FirstOrDefault();

		var notes = new List<string>();

		foreach (var (typeLabel, type) in candidates)
		{
			// 基类实例的类型名与 XAML 的 x:Class 对不上，writer 会把 Class 指令判成非法值
			// （「指令 Class 必须是字符串类型的值」）—— 这种组合不必再试「原样」。
			var fromRootElement = typeLabel.StartsWith("根元素", StringComparison.Ordinal);
			var variants = !hasClassDirective
				? new List<(string Label, string Text)> { ("原样", text) }
				: fromRootElement
					? new List<(string Label, string Text)> { ("去掉 x:Class 与事件处理器", stripped) }
					: new List<(string Label, string Text)> { ("原样", text), ("去掉 x:Class 与事件处理器", stripped) };

			foreach (var (variantLabel, variantText) in variants)
			{
				object? instance;
				try
				{
					// 一个进程只能有一个 Application —— Main 里已经建了一个，这里必须复用
					instance = type == typeof(Application)
						? (object?)(Application.Current ?? Activator.CreateInstance(type))
						: Activator.CreateInstance(type);
				}
				catch (Exception ex)
				{
					// 该类型构造不出来：换下一个候选类型（同一类型换个文本也救不回来）
					notes.Add($"{typeLabel} 构造失败：{DescribeException(ex)}");
					break;
				}

				if (instance == null)
				{
					notes.Add($"{typeLabel} 构造返回 null");
					break;
				}

				try
				{
					Fill(instance, variantText, localAssembly);
				}
				catch (Exception ex)
				{
					notes.Add($"{typeLabel} + {variantLabel}：{DescribeException(ex)}");
					Console.Error.WriteLine($"[xaml-render] {typeLabel} + {variantLabel} 失败：{DescribeException(ex)}");
					continue;
				}

				if (instance is not FrameworkElement frameworkElement)
				{
					notes.Add($"{typeLabel}：不是 FrameworkElement（实际 {instance.GetType().FullName}）");
					continue;
				}

				LastNote = string.Equals(variantText, text, StringComparison.Ordinal)
					? (typeLabel.StartsWith("根元素", StringComparison.Ordinal) ? $"用 {typeLabel} 承载 XAML 内容" : null)
					: $"用 {typeLabel} 承载，并去掉了 x:Class / 事件处理器";
				return frameworkElement;
			}
		}

		throw new InvalidOperationException($"没有可用的根类型组合：{string.Join(" | ", notes)}");
	}

	/// <summary>
	/// 把省略了 `assembly=` 的 clr-namespace 补成显式程序集。
	/// XAML 里 `xmlns:local="clr-namespace:X.Y"` 依赖 ParserContext.Assembly（internal，外部进程拿不到）
	/// 来定位程序集；不补全时类型解析会落到渲染器自己身上，报「无法创建未知类型」。
	/// </summary>
	private static string ExpandClrNamespaces(string xaml, string? localAssemblyName)
	{
		if (string.IsNullOrEmpty(localAssemblyName))
		{
			return xaml;
		}

		return System.Text.RegularExpressions.Regex.Replace(
			xaml,
			"clr-namespace:([^;\"'\\s>]+)(?=\")",
			match => $"clr-namespace:{match.Groups[1].Value};assembly={localAssemblyName}");
	}

	/// <summary>
	/// 优先用 WPF 自己的解析器，而不是 System.Xaml 的 XamlObjectWriter：后者把依赖属性当普通
	/// CLR 属性处理，遇到 `Binding` / `Command` 这类 DP 赋值必然失败（实测报「只能在
	/// DependencyObject 的 DependencyProperty 上设置 Binding」）。x:Class 与事件处理器在外部
	/// 渲染时无法与 code-behind 匹配，逐个变体退化。
	/// </summary>
	/// <summary>
	/// 补全 clr-namespace 时该用哪个程序集名。**不能盲取 --assembly 的第一个**：
	/// 调用方常常把整个输出目录的 dll 都传进来，第一个未必是 x:Class 所在的程序集，
	/// 猜错就会把 `clr-namespace:X` 指到别的程序集上、类型解析失败。
	/// 先用 x:Class 在已加载程序集里反查，命中的排最前，其余作为后备。
	/// </summary>
	private static IReadOnlyList<string> CandidateAssemblyNames(string xaml, IReadOnlyList<string> assemblyPaths)
	{
		var names = new List<string>();
		var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		var className = ExtractClassAttribute(xaml);

		if (!string.IsNullOrEmpty(className))
		{
			foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
			{
				if (assembly.IsDynamic)
				{
					continue;
				}

				var name = assembly.GetName().Name;
				if (string.IsNullOrEmpty(name) || seen.Contains(name))
				{
					continue;
				}

				try
				{
					if (assembly.GetType(className) != null)
					{
						seen.Add(name);
						names.Add(name);
					}
				}
				catch
				{
					// 反射失败的候选直接跳过
				}
			}
		}

		foreach (var assemblyPath in assemblyPaths)
		{
			var name = Path.GetFileNameWithoutExtension(assemblyPath);
			if (!string.IsNullOrEmpty(name) && seen.Add(name))
			{
				names.Add(name);
			}
		}

		return names;
	}

	private static FrameworkElement? TryParseWithWpfReader(string xaml, IEnumerable<string> assemblyNames)
	{
		var names = assemblyNames.ToArray();
		var withoutClass = RemoveClassDirective(xaml);
		var variants = new[]
		{
			xaml,
			withoutClass,
			StripEventHandlers(withoutClass),
		};

		foreach (var variant in variants)
		{
			foreach (var assemblyName in names)
			{
				try
				{
					if (System.Windows.Markup.XamlReader.Parse(ExpandClrNamespaces(variant, assemblyName)) is FrameworkElement element)
					{
						return element;
					}
				}
				catch
				{
					// 换下一个变体 / 程序集
				}
			}
		}

		return null;
	}

	private static void Fill(object instance, string xamlText, Assembly? localAssembly)
	{
		// schema context 必须知道**已加载的程序集**（尤其是 WPF 那三件套），否则 WPF 的依赖属性会被
		// 当成普通 CLR 属性处理，填内容时报「只能在 DependencyObject 的 DependencyProperty 上设置 Binding」。
		var schemaContext = new XamlSchemaContext(
			AppDomain.CurrentDomain.GetAssemblies().Where(assembly => !assembly.IsDynamic).ToArray());
		var settings = new XamlObjectWriterSettings { RootObjectInstance = instance };
		// LocalAssembly 决定「没有 assembly= 限定」的 clr-namespace 前缀解析到哪个程序集。
		// 必须指向 XAML 声明的那套程序集（x:Class 所在的那个），而不是承载实例的类型所在程序集 ——
		// 否则 `xmlns:local="clr-namespace:IFIOGUI"` 会被解析到 PresentationFramework 里去
		// （实测报错：无法创建未知类型 "{clr-namespace:IFIOGUI;assembly=PresentationFramework, Version=10.0.0.0…}"）。
		var readerSettings = new XamlXmlReaderSettings();
		if (localAssembly != null)
		{
			readerSettings.LocalAssembly = localAssembly;
		}
		var dumpNodes = Environment.GetEnvironmentVariable("XAMLRENDER_DUMP_NODES") == "1";

		using var stringReader = new StringReader(xamlText);
		using var xmlReader = System.Xml.XmlReader.Create(stringReader);
		using var reader = new XamlXmlReader(xmlReader, schemaContext, readerSettings);
		using var writer = new XamlObjectWriter(reader.SchemaContext, settings);

		var trace = dumpNodes ? new List<string>() : null;
		var node = 0;
		while (reader.Read())
		{
			if (trace != null)
			{
				trace.Add($"[{node}] {reader.NodeType} type={reader.Type?.Name} member={reader.Member?.Name}");
				if (trace.Count > 60)
				{
					trace.RemoveAt(0);
				}
			}
			node++;

			// None 节点（文档边界）不能直接交给 writer —— 它的对象栈会错位，
			// 表现就是「EndObject 前面缺少 CurrentObject」。
			if (reader.NodeType == XamlNodeType.None)
			{
				continue;
			}

			try
			{
				writer.WriteNode(reader);
			}
			catch (Exception ex)
			{
				if (trace != null)
				{
					Console.Error.WriteLine($"[xaml-render] 在第 {node} 个节点失败（{ex.GetType().Name}），此前节点序列：");
					foreach (var line in trace)
					{
						Console.Error.WriteLine("    " + line);
					}
				}
				throw;
			}
		}
		writer.Close();
	}

	private static string RemoveClassDirective(string xaml)
	{
		return Regex.Replace(xaml, "\\s+x:Class\\s*=\\s*[\"'][^\"']*[\"']", string.Empty);
	}

	/// <summary>
	/// --assembly 的目录全部挂进解析链，再逐个加载主程序集：
	/// 依赖 dll 加载失败是最常见的坑，必须先把目录准备好再加载入口程序集。
	/// </summary>
	private static void LoadAssemblies(IReadOnlyList<string> assemblyPaths)
	{
		if (assemblyPaths.Count == 0)
		{
			return;
		}

		foreach (var path in assemblyPaths)
		{
			var full = Path.GetFullPath(path);
			if (!File.Exists(full))
			{
				throw new FileNotFoundException($"找不到程序集：{full}");
			}
			var directory = Path.GetDirectoryName(full);
			if (!string.IsNullOrEmpty(directory) && !ProbeDirectories.Contains(directory, StringComparer.OrdinalIgnoreCase))
			{
				ProbeDirectories.Add(directory);
			}
		}

		AssemblyLoadContext.Default.Resolving += (context, name) =>
		{
			var fileName = name.Name + ".dll";
			foreach (var directory in ProbeDirectories)
			{
				var candidate = Path.Combine(directory, fileName);
				if (File.Exists(candidate))
				{
					try
					{
						return context.LoadFromAssemblyPath(candidate);
					}
					catch
					{
						// 换下一个目录继续试
					}
				}
			}
			return null;
		};

		foreach (var path in assemblyPaths)
		{
			LoadedAssemblies.Add(AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.GetFullPath(path)));
		}
	}

	/// <summary>支持 "Ns.Type" 与 "Ns.Type, Assembly" 两种写法。</summary>
	private static Type? ResolveType(string typeName)
	{
		var name = typeName.Trim();
		if (name.Length == 0)
		{
			return null;
		}

		var bare = name;
		var comma = name.IndexOf(',');
		if (comma > 0)
		{
			bare = name.Substring(0, comma).Trim();
		}

		// 1) 显式 --assembly 加载进来的
		foreach (var assembly in LoadedAssemblies)
		{
			var type = assembly.GetType(bare, throwOnError: false);
			if (type != null)
			{
				return type;
			}
		}

		// 2) 进程里已经加载的（PresentationFramework / PresentationCore 等）——
		//    --class 指向 WPF 自带类型时靠这条
		foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
		{
			try
			{
				var type = assembly.GetType(bare, throwOnError: false);
				if (type != null)
				{
					return type;
				}
			}
			catch
			{
				// 动态程序集之类：跳过
			}
		}

		// 3) 带 assembly 限定时交给运行时解析
		return Type.GetType(name, throwOnError: false);
	}

	private static string? ExtractClassAttribute(string xaml)
	{
		var match = Regex.Match(xaml, "x:Class\\s*=\\s*[\"']([^\"']+)[\"']");
		return match.Success ? match.Groups[1].Value : null;
	}

	private static bool LooksLikeEventHandlerError(Exception ex)
	{
		for (var current = ex; current != null; current = current.InnerException)
		{
			var message = current.Message ?? string.Empty;
			if (message.Contains("Failed to create a", StringComparison.Ordinal)
				&& message.Contains("from the text", StringComparison.Ordinal))
			{
				return true;
			}
		}
		return false;
	}

	private static string RequireValue(string[] args, ref int index, string option)
	{
		if (index + 1 >= args.Length)
		{
			throw new ArgumentException($"{option} 缺少取值");
		}
		return args[++index];
	}

	private static double ParseSize(string value)
	{
		return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
			? parsed
			: double.NaN;
	}

	private static (double Width, double Height) Layout(FrameworkElement element, double width, double height)
	{
		var probeWidth = double.IsNaN(width) ? 1280 : width;
		var probeHeight = double.IsNaN(height) ? 800 : height;

		element.Measure(new Size(probeWidth, probeHeight));
		var desired = element.DesiredSize;

		var finalWidth = double.IsNaN(width) ? desired.Width : width;
		var finalHeight = double.IsNaN(height) ? desired.Height : height;

		// 完全没内容的元素 DesiredSize 可能是 0 —— 给一个能落盘的尺寸
		finalWidth = double.IsFinite(finalWidth) && finalWidth >= 1 ? Math.Floor(finalWidth) : 1;
		finalHeight = double.IsFinite(finalHeight) && finalHeight >= 1 ? Math.Floor(finalHeight) : 1;

		element.Arrange(new Rect(0, 0, finalWidth, finalHeight));
		element.UpdateLayout();
		return (finalWidth, finalHeight);
	}

	private static RenderTargetBitmap Render(FrameworkElement element, double width, double height)
	{
		var content = new RenderTargetBitmap((int)width, (int)height, 96, 96, PixelFormats.Pbgra32);
		content.Render(element);

		// WPF 背景默认透明，直接存 PNG 会看不清 —— 合成到白底（不改布局，只是加一层底）
		var visual = new DrawingVisual();
		using (var context = visual.RenderOpen())
		{
			context.DrawRectangle(Brushes.White, null, new Rect(0, 0, width, height));
			context.DrawImage(content, new Rect(0, 0, width, height));
		}

		var composited = new RenderTargetBitmap((int)width, (int)height, 96, 96, PixelFormats.Pbgra32);
		composited.Render(visual);
		return composited;
	}

	/// <summary>判定 PNG 不是空白：字节数、非白像素占比、唯一色数量三个条件都要过。</summary>
	private static int Check(string path)
	{
		var fullPath = Path.GetFullPath(path);
		try
		{
			using var stream = File.OpenRead(fullPath);
			var decoder = new PngBitmapDecoder(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
			var converted = new FormatConvertedBitmap(decoder.Frames[0], PixelFormats.Bgra32, null, 0);
			var stride = converted.PixelWidth * 4;
			var pixels = new byte[stride * converted.PixelHeight];
			converted.CopyPixels(pixels, stride, 0);

			var colors = new HashSet<int>();
			long nonWhite = 0;
			for (var i = 0; i + 3 < pixels.Length; i += 4)
			{
				var value = pixels[i] | (pixels[i + 1] << 8) | (pixels[i + 2] << 16);
				if (colors.Count < 8192)
				{
					colors.Add(value);
				}
				if (value != 0xFFFFFF)
				{
					nonWhite++;
				}
			}

			var total = (long)converted.PixelWidth * converted.PixelHeight;
			var ratio = total == 0 ? 0d : (double)nonWhite / total;
			var bytes = new FileInfo(fullPath).Length;
			var blank = bytes < 2048 || ratio < 0.001 || colors.Count < 3;
			Console.WriteLine($"{(blank ? "BLANK" : "OK")} {converted.PixelWidth}x{converted.PixelHeight} colors={colors.Count} nonWhite={ratio:P2} bytes={bytes}");
			return blank ? 1 : 0;
		}
		catch (Exception ex)
		{
			Console.WriteLine($"FAIL {ex.GetType().Name} :: {FirstLine(ex.Message)}");
			return 1;
		}
	}

	private static int UsageError(string message, bool json)
	{
		Console.Error.WriteLine(message);
		var payload = new Dictionary<string, object?>
		{
			["ok"] = false,
			["error"] = FirstLine(message),
			["errorType"] = "UsageError",
			["ms"] = 0,
		};
		return Emit(json, payload, $"FAIL UsageError :: {FirstLine(message)}", 2);
	}

	private static int FailReport(bool json, Stopwatch stopwatch, string mode, string error, string errorType, string? human)
	{
		stopwatch.Stop();
		var payload = new Dictionary<string, object?>
		{
			["ok"] = false,
			["error"] = error,
			["errorType"] = errorType,
			["mode"] = mode,
			["ms"] = stopwatch.ElapsedMilliseconds,
			["note"] = LastNote,
		};
		return Emit(json, payload, human ?? $"FAIL {errorType} mode={mode} ms={stopwatch.ElapsedMilliseconds} :: {error}", 1);
	}

	/// <summary>stdout 的最后一行必须是一行 JSON（成功与失败都一样）。</summary>
	private static int Emit(bool json, Dictionary<string, object?> payload, string humanLine, int exitCode)
	{
		if (json)
		{
			Console.WriteLine(JsonSerializer.Serialize(payload));
		}
		else
		{
			Console.WriteLine(humanLine);
		}
		return exitCode;
	}

	/// <summary>
	/// 异常链一路展开 —— 构造函数里的失败几乎总被 TargetInvocationException 包着，
	/// 只看最外层等于没看。
	/// </summary>
	private static string DescribeException(Exception ex)
	{
		var parts = new List<string>();
		for (var current = ex; current != null; current = current.InnerException)
		{
			parts.Add($"{current.GetType().Name}: {FirstLine(current.Message)}");
			if (parts.Count >= 6)
			{
				break;
			}
		}
		return string.Join(" <- ", parts);
	}

	private static string FirstLine(string? message)
	{
		var text = (message ?? string.Empty).Replace("\r\n", "\n");
		var line = text.Split('\n')[0].Trim();
		return line.Length == 0 ? "（无消息）" : line;
	}
}
