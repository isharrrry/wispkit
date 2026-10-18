#requires -Version 5
# 本文件必须保存为 **UTF-8 with BOM**。
# 原因：Windows PowerShell 5.1 会把「无 BOM 的 UTF-8」按系统 ANSI（中文环境下是 GBK）读取，
# 注释里的全角字符会吃掉换行，导致相邻代码被并进注释、报出莫名其妙的 UnexpectedToken。
<#
  生成 R4（图片缩放/平移）验证素材。
  只依赖 System.Drawing，可重复运行（同参数产出同内容）。
  用法： pwsh -File gen-images.ps1 [-OutDir <目录>]
  产物： assets/images/ 下的 png/jpg/bmp/gif/ico/svg
  webp/avif 由 gen-webp-avif.mjs 另行转换（本机无系统编码器）。
#>
param(
	[string]$OutDir = (Join-Path $PSScriptRoot '..\assets\images')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$written = [System.Collections.Generic.List[string]]::new()

function New-Canvas([int]$Width, [int]$Height, [System.Drawing.Color]$Background) {
	$bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.Clear($Background)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
	$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
	return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Add-Marker([System.Drawing.Graphics]$Graphics, [int]$Width, [int]$Height) {
	# 中心红十字 + 四角色块：用来确认"缩放锚点在光标""平移方向没反"
	$cross = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(210, 20, 20), 6)
	$cx = [int]($Width / 2); $cy = [int]($Height / 2)
	$arm = [Math]::Max(40, [int]([Math]::Min($Width, $Height) / 12))
	$Graphics.DrawLine($cross, $cx - $arm, $cy, $cx + $arm, $cy)
	$Graphics.DrawLine($cross, $cx, $cy - $arm, $cx, $cy + $arm)
	$Graphics.DrawEllipse($cross, $cx - $arm, $cy - $arm, $arm * 2, $arm * 2)

	$corners = @(
		@{ X = 0; Y = 0; Color = [System.Drawing.Color]::FromArgb(0, 120, 215) },
		@{ X = $Width - 80; Y = 0; Color = [System.Drawing.Color]::FromArgb(16, 137, 62) },
		@{ X = 0; Y = $Height - 80; Color = [System.Drawing.Color]::FromArgb(202, 80, 16) },
		@{ X = $Width - 80; Y = $Height - 80; Color = [System.Drawing.Color]::FromArgb(136, 23, 152) }
	)
	foreach ($corner in $corners) {
		$brush = [System.Drawing.SolidBrush]::new($corner.Color)
		$Graphics.FillRectangle($brush, $corner.X, $corner.Y, 80, 80)
		$brush.Dispose()
	}
	$cross.Dispose()
}

function Add-Grid([System.Drawing.Graphics]$Graphics, [int]$Width, [int]$Height, [int]$Step, [int]$LabelEvery) {
	$minor = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(228, 228, 228), 1)
	$major = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(168, 168, 168), 2)
	$label = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(88, 88, 88))
	$font = [System.Drawing.Font]::new('Consolas', 20)

	for ($x = 0; $x -le $Width; $x += $Step) {
		$pen = if ($x % ($Step * 5) -eq 0) { $major } else { $minor }
		$Graphics.DrawLine($pen, $x, 0, $x, $Height)
	}
	for ($y = 0; $y -le $Height; $y += $Step) {
		$pen = if ($y % ($Step * 5) -eq 0) { $major } else { $minor }
		$Graphics.DrawLine($pen, 0, $y, $Width, $y)
	}
	for ($x = 0; $x -le $Width - $LabelEvery; $x += $LabelEvery) {
		for ($y = 0; $y -le $Height - 30; $y += $LabelEvery) {
			$Graphics.DrawString("$x,$y", $font, $label, [single]($x + 6), [single]($y + 6))
		}
	}

	$minor.Dispose(); $major.Dispose(); $label.Dispose(); $font.Dispose()
}

function Save-Image($Bitmap, [string]$FileName, $Format) {
	$path = Join-Path $OutDir $FileName
	$Bitmap.Save($path, $Format)
	$written.Add($FileName)
	return $path
}

# ---------------------------------------------------------------- 网格大图（PNG / JPEG）
foreach ($spec in @(
		@{ Name = 'grid-4000x3000.png'; Format = [System.Drawing.Imaging.ImageFormat]::Png },
		@{ Name = 'grid-4000x3000.jpg'; Format = [System.Drawing.Imaging.ImageFormat]::Jpeg }
	)) {
	$canvas = New-Canvas 4000 3000 ([System.Drawing.Color]::White)
	Add-Grid $canvas.Graphics 4000 3000 100 500
	Add-Marker $canvas.Graphics 4000 3000
	$canvas.Graphics.Dispose()

	if ($spec.Format -eq [System.Drawing.Imaging.ImageFormat]::Jpeg) {
		$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
		$parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
		$parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [int64]85)
		$canvas.Bitmap.Save((Join-Path $OutDir $spec.Name), $codec, $parameters)
		$written.Add($spec.Name)
		$parameters.Dispose()
	} else {
		Save-Image $canvas.Bitmap $spec.Name $spec.Format | Out-Null
	}
	$canvas.Bitmap.Dispose()
}

# ---------------------------------------------------------------- 极高 / 极宽（验证 fit 取 min）
$tall = New-Canvas 600 4000 ([System.Drawing.Color]::White)
for ($y = 0; $y -lt 4000; $y += 50) {
	$shade = 235 - (($y / 50) % 2) * 25
	$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($shade, $shade, 255))
	$tall.Graphics.FillRectangle($brush, 0, $y, 600, 25)
	$brush.Dispose()
}
$tallLabel = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 30, 30))
$tallFont = [System.Drawing.Font]::new('Consolas', 22)
for ($y = 200; $y -lt 4000; $y += 200) {
	$tall.Graphics.DrawString("y=$y", $tallFont, $tallLabel, [single]20, [single]($y + 4))
}
Add-Marker $tall.Graphics 600 4000
$tall.Graphics.Dispose()
Save-Image $tall.Bitmap 'tall-600x4000.png' ([System.Drawing.Imaging.ImageFormat]::Png) | Out-Null
$tall.Bitmap.Dispose(); $tallLabel.Dispose(); $tallFont.Dispose()

$wide = New-Canvas 4000 600 ([System.Drawing.Color]::White)
for ($x = 0; $x -lt 4000; $x += 50) {
	$shade = 235 - (($x / 50) % 2) * 25
	$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, $shade, $shade))
	$wide.Graphics.FillRectangle($brush, $x, 0, 25, 600)
	$brush.Dispose()
}
$wideLabel = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 30, 30))
$wideFont = [System.Drawing.Font]::new('Consolas', 22)
for ($x = 200; $x -lt 4000; $x += 200) {
	$wide.Graphics.DrawString("x=$x", $wideFont, $wideLabel, [single]$x, [single]20)
}
Add-Marker $wide.Graphics 4000 600
$wide.Graphics.Dispose()
Save-Image $wide.Bitmap 'wide-4000x600.png' ([System.Drawing.Imaging.ImageFormat]::Png) | Out-Null
$wide.Bitmap.Dispose(); $wideLabel.Dispose(); $wideFont.Dispose()

# ---------------------------------------------------------------- 极小图（验证 fit 不放大超过 100%）
$tiny = New-Canvas 16 16 ([System.Drawing.Color]::White)
$palette = @(
	[System.Drawing.Color]::FromArgb(220, 40, 40), [System.Drawing.Color]::FromArgb(40, 160, 70),
	[System.Drawing.Color]::FromArgb(40, 90, 220), [System.Drawing.Color]::FromArgb(240, 200, 40)
)
for ($i = 0; $i -lt 4; $i++) {
	$brush = [System.Drawing.SolidBrush]::new($palette[$i])
	$tiny.Graphics.FillRectangle($brush, ($i % 2) * 8, [int]($i / 2) * 8, 8, 8)
	$brush.Dispose()
}
$tiny.Graphics.Dispose()
Save-Image $tiny.Bitmap 'tiny-16x16.png' ([System.Drawing.Imaging.ImageFormat]::Png) | Out-Null
$tiny.Bitmap.Dispose()

# ---------------------------------------------------------------- 棋盘小图（放大 >=300% 应触发 pixelated）
$checker = New-Canvas 64 64 ([System.Drawing.Color]::White)
$dark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(20, 20, 20))
for ($y = 0; $y -lt 64; $y += 8) {
	for ($x = 0; $x -lt 64; $x += 8) {
		if ((($x / 8) + ($y / 8)) % 2 -eq 0) { $checker.Graphics.FillRectangle($dark, $x, $y, 8, 8) }
	}
}
$checker.Graphics.Dispose()
Save-Image $checker.Bitmap 'checker-64x64.png' ([System.Drawing.Imaging.ImageFormat]::Png) | Out-Null
$checker.Bitmap.Dispose(); $dark.Dispose()

# ---------------------------------------------------------------- 透明通道
$alpha = New-Canvas 512 512 ([System.Drawing.Color]::Transparent)
$opaque = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 210, 30, 30))
$semi = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(110, 30, 90, 210))
$alpha.Graphics.FillEllipse($opaque, 40, 60, 240, 240)
$alpha.Graphics.FillRectangle($semi, 230, 230, 230, 230)
$alphaPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 0, 0, 0), 4)
$alpha.Graphics.DrawRectangle($alphaPen, 2, 2, 507, 507)
$alpha.Graphics.DrawString('alpha', [System.Drawing.Font]::new('Consolas', 40, [System.Drawing.FontStyle]::Bold), $opaque, [single]20, [single]440)
$alpha.Graphics.Dispose()
Save-Image $alpha.Bitmap 'alpha-512x512.png' ([System.Drawing.Imaging.ImageFormat]::Png) | Out-Null
$alpha.Bitmap.Dispose(); $opaque.Dispose(); $semi.Dispose(); $alphaPen.Dispose()

# ---------------------------------------------------------------- BMP
$bmp = New-Canvas 800 600 ([System.Drawing.Color]::White)
$bands = @(
	[System.Drawing.Color]::FromArgb(0, 120, 215), [System.Drawing.Color]::FromArgb(16, 137, 62),
	[System.Drawing.Color]::FromArgb(202, 80, 16)
)
for ($i = 0; $i -lt 3; $i++) {
	$brush = [System.Drawing.SolidBrush]::new($bands[$i])
	$bmp.Graphics.FillRectangle($brush, 0, $i * 200, 800, 200)
	$brush.Dispose()
}
$bmpText = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$bmp.Graphics.DrawString('BMP 800x600', [System.Drawing.Font]::new('Consolas', 48, [System.Drawing.FontStyle]::Bold), $bmpText, [single]30, [single]60)
$bmp.Graphics.Dispose()
Save-Image $bmp.Bitmap 'flat-800x600.bmp' ([System.Drawing.Imaging.ImageFormat]::Bmp) | Out-Null
$bmp.Bitmap.Dispose(); $bmpText.Dispose()

# ---------------------------------------------------------------- GIF（单帧）
$gif = New-Canvas 320 240 ([System.Drawing.Color]::FromArgb(245, 245, 245))
$gifPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(0, 120, 215), 6)
$gif.Graphics.DrawRectangle($gifPen, 10, 10, 300, 220)
$gif.Graphics.DrawLine($gifPen, 10, 10, 310, 230)
$gif.Graphics.DrawLine($gifPen, 310, 10, 10, 230)
$gif.Graphics.DrawString('GIF 320x240', [System.Drawing.Font]::new('Consolas', 26, [System.Drawing.FontStyle]::Bold), [System.Drawing.Brushes]::Black, [single]70, [single]100)
$gif.Graphics.Dispose()
Save-Image $gif.Bitmap 'solid-320x240.gif' ([System.Drawing.Imaging.ImageFormat]::Gif) | Out-Null
$gif.Bitmap.Dispose(); $gifPen.Dispose()

# ---------------------------------------------------------------- ICO（64x64，经句柄转换）
$icoSource = New-Canvas 64 64 ([System.Drawing.Color]::White)
$icoBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(136, 23, 152))
$icoSource.Graphics.FillEllipse($icoBrush, 4, 4, 56, 56)
$icoSource.Graphics.DrawString('W', [System.Drawing.Font]::new('Consolas', 30, [System.Drawing.FontStyle]::Bold), [System.Drawing.Brushes]::White, [single]14, [single]12)
$icoSource.Graphics.Dispose()
$handle = $icoSource.Bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$iconPath = Join-Path $OutDir 'icon-64x64.ico'
$stream = [System.IO.File]::Create($iconPath)
$icon.Save($stream)
$stream.Close()
$written.Add('icon-64x64.ico')
$icon.Dispose()
$icoSource.Bitmap.Dispose(); $icoBrush.Dispose()

# ---------------------------------------------------------------- 汇总
"写到 $OutDir ："
foreach ($name in $written) {
	$file = Get-Item (Join-Path $OutDir $name)
	"  {0,-24} {1,10:N0} B" -f $file.Name, $file.Length
}
