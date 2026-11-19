# Chihua на настоящей Windows: модули сервисов открываются внутри окна (дочерний WebView, без новых окон),
# окно переживает «свернуть → развернуть». Снимки и итог — в папке results.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$res = Join-Path $PWD "results"
New-Item -ItemType Directory -Force $res | Out-Null
$fail = @()
function Note($m) { Write-Host $m; Add-Content -Encoding utf8 (Join-Path $res "modules.txt") $m }

$exe = Get-ChildItem "$env:LOCALAPPDATA","$env:ProgramFiles" -Recurse -Filter 'chihuabrowser.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { $exe = Get-ChildItem "$env:LOCALAPPDATA","$env:ProgramFiles" -Recurse -Include 'Chihua*.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'uninstall|proxy|tunnel' } | Select-Object -First 1 }
if (-not $exe) { throw 'installed app not found' }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
  public static int Hosts(IntPtr parent, bool visibleOnly) {
    int n = 0;
    EnumChildWindows(parent, (h, l) => {
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() == "Chrome_RenderWidgetHostHWND" && (!visibleOnly || IsWindowVisible(h))) n++;
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
"@
function Shot([IntPtr]$hwnd, [string]$label) {
    $r = New-Object W+RECT; [W]::GetWindowRect($hwnd, [ref]$r) | Out-Null
    $w = $r.R - $r.L; $hh = $r.B - $r.T
    if ($w -lt 50 -or $hh -lt 50) { Note "${label}: окно ${w}x${hh}"; return }
    $bmp = New-Object System.Drawing.Bitmap($w, $hh); $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
    [W]::PrintWindow($hwnd, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
    $bmp.Save((Join-Path $res "chihua-$label.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
function MainWin($procId) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procId)
    return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}
function Click($win, [string[]]$names) {
    foreach ($n in $names) {
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $n)
        $el = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if ($el) {
            try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $true } catch { Note "кнопка «$n»: $($_.Exception.Message)" }
        }
    }
    Note "кнопки нет: $($names -join ' / ')"
    return $false
}

$p = Start-Process $exe.FullName -PassThru
$win = $null
for ($i = 0; $i -lt 60 -and -not $win; $i++) { Start-Sleep 1; $win = MainWin $p.Id }
if (-not $win) { throw "окно Chihua не появилось" }
Start-Sleep 15
$hwnd = [IntPtr]$win.Current.NativeWindowHandle
$base = [W]::Hosts($hwnd, $true)
Note "запуск: окон WebView в главном окне $base"
Shot $hwnd "1-start"

# модуль «Кабинет»: дочерний WebView в том же окне
if (Click $win @("Кабинет", "Account")) {
    Start-Sleep 12
    $n = [W]::Hosts($hwnd, $true)
    Note "кабинет: окон WebView $n (было $base)"
    if ($n -le $base) { $fail += "модуль «Кабинет» не открылся внутри окна" }
    Shot $hwnd "2-cabinet"
} else { $fail += "в меню нет «Кабинет»" }
# «Почта» — второй модуль, кабинет прячется
if (Click $win @("Почта", "Mail")) { Start-Sleep 10; Note "почта: видимых WebView $([W]::Hosts($hwnd, $true)), всего $([W]::Hosts($hwnd, $false))"; Shot $hwnd "3-mail" }
# «Мессенджер» — модуль без веб-версии: модули прячутся
if (Click $win @("Мессенджер", "Messenger")) {
    Start-Sleep 6
    $n = [W]::Hosts($hwnd, $true)
    Note "мессенджер: видимых WebView $n"
    if ($n -gt $base) { $fail += "модуль не спрятался при переходе на «Мессенджер»" }
    Shot $hwnd "4-messenger"
}
[void](Click $win @("Кабинет", "Account")); Start-Sleep 5

# свернуть → развернуть с открытым модулем
$WM_SYSCOMMAND = 0x0112; $SC_MINIMIZE = 0xF020; $SC_RESTORE = 0xF120
for ($i = 1; $i -le 3; $i++) {
    [W]::ShowWindow($hwnd, 6) | Out-Null; Start-Sleep 3
    [W]::ShowWindow($hwnd, 9) | Out-Null; [W]::SetForegroundWindow($hwnd) | Out-Null; Start-Sleep 3
    [W]::SendMessage($hwnd, $WM_SYSCOMMAND, [IntPtr]$SC_MINIMIZE, [IntPtr]::Zero) | Out-Null; Start-Sleep 3
    [W]::SendMessage($hwnd, $WM_SYSCOMMAND, [IntPtr]$SC_RESTORE, [IntPtr]::Zero) | Out-Null; Start-Sleep 3
    if ($p.HasExited -or -not [W]::IsWindow($hwnd)) { $fail += "после «свернуть → развернуть» $i окна нет"; break }
}
Start-Sleep 2
Note "после «свернуть → развернуть»: процесс жив $(-not $p.HasExited), видимых WebView $([W]::Hosts($hwnd, $true))"
Shot $hwnd "5-restored"
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
if ($fail.Count -gt 0) { Note ("FAIL: " + ($fail -join "; ")); exit 1 }
Note "OK"
