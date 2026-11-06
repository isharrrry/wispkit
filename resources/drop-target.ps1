param()
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WispDropTarget {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
}
"@

$point = New-Object WispDropTarget+POINT
[void][WispDropTarget]::GetCursorPos([ref]$point)
$child = [WispDropTarget]::WindowFromPoint($point)
$root = [WispDropTarget]::GetAncestor($child, 2)
$ownerPid = 0
[void][WispDropTarget]::GetWindowThreadProcessId($root, [ref]$ownerPid)

$result = @{ ok = $false; reason = 'not-explorer'; title = '' }
if ($ownerPid -ne 0) {
  $process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'explorer') {
    $titleBuilder = New-Object System.Text.StringBuilder 512
    [void][WispDropTarget]::GetWindowText($root, $titleBuilder, 512)
    $classBuilder = New-Object System.Text.StringBuilder 256
    [void][WispDropTarget]::GetClassName($root, $classBuilder, 256)
    $title = $titleBuilder.ToString()
    $class = $classBuilder.ToString()

    $folder = $null
    try {
      $shell = New-Object -ComObject Shell.Application
      foreach ($window in $shell.Windows()) {
        try {
          if ([int64]$window.HWND -eq [int64]$root) {
            $folder = [string]$window.Document.Folder.Self.Path
            break
          }
        } catch {
          # Some windows have no Document; skip them.
        }
      }
    } catch {
      # Fall back to the desktop when Shell.Application is unavailable.
    }

    if (-not $folder -and ($class -match 'Progman|WorkerW|SHELLDLL_DefView' -or $title -eq 'Program Manager')) {
      $folder = [Environment]::GetFolderPath('Desktop')
    }

    if ($folder) {
      if (Test-Path -LiteralPath $folder -PathType Container) {
        $result = @{ ok = $true; folder = $folder; title = $title }
      } else {
        $result = @{ ok = $false; reason = 'not-folder'; title = $title }
      }
    }
  }
}

$result | ConvertTo-Json -Compress
