# 用 spike 的那 17 个真实 XAML 素材跑路线①（加载程序集 + RootObjectInstance）
# 用法：pwsh -File run-real.ps1
# 结果写 results-real.md；每张 PNG 都过 check 判空白
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = $PSScriptRoot
$dll = Join-Path $root 'bin\Release\net10.0-windows\XamlRender.dll'
$outDir = Join-Path $root 'out\real'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 目标项目的已编译产物（找不到就没有 --assembly，靠根元素基类承载）
$nbAsm = 'D:\AllData\AIDATA\NewsBoard\src\NewsBoard.Wpf\bin\Debug\net10.0-windows10.0.19041.0\NewsBoard.Wpf.dll'
$crAsm = 'D:\AllData\AIDATA\RT\Links-Common-Library\Common.Resources\bin\Debug\net6.0-windows\Common.Resources.dll'
# 该项目原本没有编译产物，本轮用 dotnet build 出来（只 build，未改一行源码）
$ifioAsm = 'D:\AllData\AIDATA\RT\Links-IOMap-Windows\IOInterface.WPF\bin\Debug\net6.0-windows\IFIOGUI.dll'

$samples = @(
	@{ n = '01'; xaml = 'D:\AllData\AIDATA\NewsBoard\.wt\sa1\src\NewsBoard.Wpf\MainWindow.xaml'; asm = $nbAsm },
	@{ n = '02'; xaml = 'D:\AllData\AIDATA\NewsBoard\.wt\sa1\src\NewsBoard.Wpf\App.xaml'; asm = $nbAsm },
	@{ n = '03'; xaml = 'D:\AllData\AIDATA\NewsBoard\src\NewsBoard.Wpf\MainWindow.xaml'; asm = $nbAsm },
	@{ n = '04'; xaml = 'D:\AllData\AIDATA\NewsBoard\src\NewsBoard.Maui\App.xaml'; asm = $null },
	@{ n = '05'; xaml = 'D:\AllData\AIDATA\techsearch\cue-box\Views\SOP\70_产品与研发\研发流程\简单Blazor应用开发\examples\md-reader\MdReader.Maui\Platforms\Windows\App.xaml'; asm = $null },
	@{ n = '06'; xaml = 'D:\AllData\AIDATA\RT\Links-IOMap-Windows\IOInterface.WPF\TextFileEditWin.xaml'; asm = $ifioAsm },
	@{ n = '07'; xaml = 'D:\AllData\AIDATA\RT\Links-Dashboard-Mgr\DashGUI\MonitorPanel\View\AxControl\Plot\WpfPlotXUserControl.xaml'; asm = $null },
	@{ n = '08'; xaml = 'D:\AllData\AIDATA\RT\wpf-diagram-as\Others\Live-Charts-master\WpfView\Themes\Colors\white.xaml'; asm = $null },
	@{ n = '09'; xaml = 'D:\AllData\AIDATA\RT\Links-Common-Library\Common.Resources\Main\ModalGridWindow.xaml'; asm = $crAsm },
	@{ n = '10'; xaml = 'D:\AllData\AIDATA\RT\Test\UITest\WindowTree.xaml'; asm = $null },
	@{ n = '11'; xaml = 'D:\AllData\AIDATA\RT\links-asam-xil\SimRMS\VIew\用户管理View.xaml'; asm = $null },
	@{ n = '12'; xaml = 'D:\AllData\AIDATA\RT\Test\UITest\Theme.xaml'; asm = $null },
	@{ n = '13'; xaml = 'D:\AllData\AIDATA\RT\RTSimPlus\Control\ThemeLib\Themes\WindowStyleWin7.xaml'; asm = $null },
	@{ n = '14'; xaml = 'D:\AllData\AIDATA\RT\Links-IOMap-Windows\串口激励器\Themes\Generic.xaml'; asm = $null },
	@{ n = '15'; xaml = 'D:\AllData\AIDATA\RT\wpf-diagram-as\Others\Live-Charts-master\WpfView\Themes\Weight\bold.xaml'; asm = $null },
	@{ n = '16'; xaml = 'D:\AllData\AIDATA\RT\Links-IOMap-Windows\IOInterface.WPF\CANMM\使能.xaml'; asm = $ifioAsm },
	@{ n = '17'; xaml = 'D:\AllData\AIDATA\NewsBoard\src\NewsBoard.Maui\Platforms\Windows\App.xaml'; asm = $null }
)

$rows = @()
$ok = 0
$blank = 0

foreach ($s in $samples) {
	$leaf = Split-Path $s.xaml -Leaf
	if (-not (Test-Path $s.xaml)) {
		$rows += "| $($s.n) | $leaf | MISSING | - | - | - |"
		continue
	}

	$png = Join-Path $outDir "$($s.n).png"
	$argv = @('render', $s.xaml, $png, '--json')
	$asmLabel = '(无)'
	if ($s.asm -and (Test-Path $s.asm)) {
		$argv += @('--assembly', $s.asm)
		$asmLabel = Split-Path $s.asm -Leaf
	}

	$raw = (& dotnet $dll @argv 2>$null | Select-Object -Last 1)
	$parsed = $null
	try { $parsed = $raw | ConvertFrom-Json } catch { }

	if ($null -eq $parsed) {
		$rows += "| $($s.n) | $leaf | 无法解析输出 | $asmLabel | - | $raw |"
		continue
	}

	if (-not $parsed.ok) {
		$err = ($parsed.error -replace '\|', '/')
		if ($err.Length -gt 150) { $err = $err.Substring(0, 150) + '…' }
		$rows += "| $($s.n) | $leaf | FAIL | $asmLabel | $($parsed.errorType) | $err |"
		continue
	}

	$check = (& dotnet $dll check $png 2>$null | Select-Object -Last 1)
	$checkOk = $check -like 'OK*'
	if ($checkOk) { $ok++ } else { $blank++ }
	$note = if ($parsed.note) { ($parsed.note -replace '\|', '/') } else { '' }
	$size = if (Test-Path $png) { (Get-Item $png).Length } else { 0 }
	$rows += "| $($s.n) | $leaf | OK | $asmLabel | $($parsed.width)x$($parsed.height) / $size B / $($parsed.ms) ms | $check / $note |"
}

$summary = @()
$summary += '# 路线①（加载程序集 + RootObjectInstance）实测结果'
$summary += ''
$summary += "- 素材：spike 的同一批 17 个真实 XAML（清单见 `run-real.ps1`）"
$summary += "- 工具：``$dll``"
$summary += "- 判定：``render`` 成功后再过 ``check``（字节数/非白像素/唯一色）才算真正出图"
$summary += ''
$summary += "**渲染成功 $((17 - ($rows | Where-Object { $_ -match '\| FAIL \||\| MISSING \||无法解析' }).Count))/17；其中非空白（check OK）$ok，空白 $blank。**"
$summary += ''
$summary += '| # | 文件 | 结果 | --assembly | 尺寸 / 字节 / 耗时 | check / note |'
$summary += '|---|---|---|---|---|---|'
$summary += $rows
$summary += ''

$summary -join "`n" | Set-Content -Path (Join-Path $root 'results-real.md') -Encoding utf8
Write-Host ($summary -join "`n")
Write-Host "`n=== 完成：非空白 $ok / 空白 $blank ==="
