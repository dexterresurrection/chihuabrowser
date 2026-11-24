# Vice Antidetect (product miami, ex Miami Browser) over Chihua on a real Windows: the same program (uninstall key,
# folder, exe), its own name, icon, shortcuts and default theme; shortcuts of the old name Miami Browser are replaced;
# installing Chihua again brings the Chihua line back.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$res = Join-Path $PWD "results"
New-Item -ItemType Directory -Force $res | Out-Null
$fail = @()
function Note($m) { Write-Host $m; Add-Content -Encoding utf8 (Join-Path $res "antidetect.txt") $m }
function Check($name, $ok, $extra = "") { if ($ok) { Note "ok   $name $extra" } else { Note "FAIL $name $extra"; $script:fail += $name } }

function Find-App {
  $e = Get-ChildItem "$env:LOCALAPPDATA","$env:ProgramFiles" -Recurse -Filter 'chihuabrowser.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $e) { $e = Get-ChildItem "$env:LOCALAPPDATA","$env:ProgramFiles" -Recurse -Include 'Chihua*.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'uninstall|proxy|tunnel' } | Select-Object -First 1 }
  return $e
}
function Uninstall-Entries {
  $roots = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  $out = @()
  foreach ($r in $roots) {
    Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($p.DisplayName -match 'Chihua|Miami|Vice Antidetect') { $out += [pscustomobject]@{ Key = $_.PSChildName; Name = $p.DisplayName; Icon = $p.DisplayIcon } }
    }
  }
  return $out
}
$sm = [Environment]::GetFolderPath('Programs')
$smAll = [Environment]::GetFolderPath('CommonPrograms')
function Has-Lnk($name) { (Test-Path (Join-Path $sm "$name.lnk")) -or (Test-Path (Join-Path $smAll "$name.lnk")) }

$before = Find-App
if (-not $before) { throw 'Chihua is not installed (the previous step installs it)' }
Get-Process | Where-Object { $_.Path -eq $before.FullName } | Stop-Process -Force -ErrorAction SilentlyContinue
$vice = Get-ChildItem installer -Filter 'Vice_Antidetect*.exe' | Select-Object -First 1
if (-not $vice) { throw 'Vice Antidetect installer is missing from the artifact' }
Note "installer: $($vice.Name)"
$vi = (Get-Item $vice.FullName).VersionInfo
Check 'installer ProductName Vice Antidetect' ($vi.ProductName -eq 'Vice Antidetect') "'$($vi.ProductName)'"
# shortcuts left by an earlier Miami Browser install (the old name of the same line)
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
foreach ($d in @($sm, $desk)) { $l = $ws.CreateShortcut((Join-Path $d 'Miami Browser.lnk')); $l.TargetPath = $before.FullName; $l.Save() }
Start-Process $vice.FullName -ArgumentList '/S' -Wait

$after = Find-App
Check 'same exe and folder' ($after -and $after.FullName -eq $before.FullName) "$($after.FullName)"
$dir = $before.DirectoryName
$brand = Join-Path $dir 'brand.json'
Check 'brand.json next to the exe' (Test-Path $brand)
if (Test-Path $brand) {
  $b = Get-Content $brand -Raw | ConvertFrom-Json
  Check 'brand.json: line vice, name Vice Antidetect, theme vice-night' ($b.brand -eq 'vice' -and $b.name -eq 'Vice Antidetect' -and $b.theme -eq 'vice-night') (Get-Content $brand -Raw)
}
Check 'miami.ico installed' (Test-Path (Join-Path $dir 'miami.ico'))
$entries = @(Uninstall-Entries)
Note ("uninstall entries: " + (($entries | ForEach-Object { "$($_.Key)=$($_.Name)" }) -join '; '))
Check 'one uninstall entry, key Chihua, name Vice Antidetect' ($entries.Count -eq 1 -and $entries[0].Key -eq 'Chihua' -and $entries[0].Name -eq 'Vice Antidetect')
Check 'Start menu: Vice Antidetect shortcut' (Has-Lnk 'Vice Antidetect')
Check 'old name: no Miami Browser shortcut in the Start menu' (-not (Has-Lnk 'Miami Browser'))
Check 'old name: desktop Miami Browser.lnk replaced by Vice Antidetect.lnk' ((-not (Test-Path (Join-Path $desk 'Miami Browser.lnk'))) -and (Test-Path (Join-Path $desk 'Vice Antidetect.lnk')))
Check 'Start menu: no Chihua shortcut' (-not (Has-Lnk 'Chihua'))

$p = Start-Process $after.FullName -PassThru
$title = ''
for ($i = 0; $i -lt 30 -and -not $title; $i++) {
  Start-Sleep 2
  $p.Refresh()
  if ($p.HasExited) { break }
  $title = $p.MainWindowTitle
}
Check 'app runs' (-not $p.HasExited)
Check 'window title Vice Antidetect' ($title -eq 'Vice Antidetect') "'$title'"
Start-Sleep 8
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bnd = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bnd.Width,$bnd.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($bnd.Location,[System.Drawing.Point]::Empty,$bnd.Size)
$bmp.Save((Join-Path $res 'antidetect.png'))
# taskbar: the button is drawn with the window's big icon (ICON_BIG); it must be the line's icon, not the one of the exe
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, int m, IntPtr w, IntPtr l);
}
'@
function Icon-Hash($ic) {
  if (-not $ic) { return '' }
  $b = $ic.ToBitmap(); $ms = New-Object System.IO.MemoryStream
  (New-Object System.Drawing.Bitmap $b, 32, 32).Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
  return [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($ms.ToArray())).Substring(0, 17)
}
$hb = [W]::SendMessageW($p.MainWindowHandle, 0x7F, [IntPtr]1, [IntPtr]0)
Check 'taskbar: the window has a big icon' ($hb -ne [IntPtr]::Zero)
if ($hb -ne [IntPtr]::Zero) {
  $big = [System.Drawing.Icon]::FromHandle($hb)
  $big.ToBitmap().Save((Join-Path $res 'antidetect-taskbar-icon.png'))
  $exeIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($after.FullName)
  $lineIcon = New-Object System.Drawing.Icon (Join-Path $dir 'miami.ico'), $big.Width, $big.Height
  Check 'taskbar: big icon is not the exe icon' ((Icon-Hash $big) -ne (Icon-Hash $exeIcon))
  Check 'taskbar: big icon is the Vice Antidetect icon' ((Icon-Hash $big) -eq (Icon-Hash $lineIcon)) "$($big.Width) px"
}
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Get-Process | Where-Object { $_.Path -eq $after.FullName } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# update inside the program: a download list served here says 9.9.9; the program must take the installer of its own line,
# check SHA-256 and keep it for "Restart"; the installer itself must start the program again (/R)
$sha = (Get-FileHash $vice.FullName -Algorithm SHA256).Hash.ToLower()
$srv = Join-Path $env:RUNNER_TEMP 'upd'; New-Item -ItemType Directory -Force $srv | Out-Null
Copy-Item $vice.FullName (Join-Path $srv 'ViceAntidetect-Setup-9.9.9.exe') -Force
$list = @{ products = @{
  miami = @{ version = '9.9.9'; files = @(@{ name = 'ViceAntidetect-Setup-9.9.9.exe'; sha256 = $sha
    github = 'http://127.0.0.1:8799/missing.exe'; server = 'http://127.0.0.1:8799/ViceAntidetect-Setup-9.9.9.exe' }) }
  chihua = @{ version = '9.9.9'; files = @(@{ name = 'wrong.exe'; sha256 = $sha; github = 'http://127.0.0.1:8799/wrong.exe' }) } } }
$list | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8NoBOM (Join-Path $srv 'list.json')
$web = Start-Process python -ArgumentList '-m','http.server','8799','--bind','127.0.0.1','--directory',$srv -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $res 'update-server.txt')
Start-Sleep 3
$upd = Join-Path $env:TEMP 'chihua_app_update'
Remove-Item $upd -Recurse -Force -ErrorAction SilentlyContinue
$env:CHIHUA_UPDATE_LIST = 'http://127.0.0.1:8799/list.json'
$p = Start-Process $after.FullName -PassThru
$got = Join-Path $upd 'ViceAntidetect-Setup-9.9.9.exe'
$name1 = Join-Path $upd 'missing.exe'   # the file is named after the first link of the list
for ($i = 0; $i -lt 60 -and -not ((Test-Path $got) -or (Test-Path $name1)); $i++) { Start-Sleep 2 }
$file = if (Test-Path $got) { $got } else { $name1 }
Check 'update: downloaded from the second mirror' (Test-Path $file) $file
if (Test-Path $file) { Check 'update: SHA-256 matches' ((Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -eq $sha) }
Remove-Item Env:CHIHUA_UPDATE_LIST
Start-Sleep 5
$old = $p.Id
if (Test-Path $file) {
  # not -Wait: it would wait for the program the installer starts as well
  $ip = Start-Process $file -ArgumentList '/S','/UPDATE','/R' -PassThru
  Check 'update: the installer finished' ($ip.WaitForExit(180000))
  $new = $null
  for ($i = 0; $i -lt 20 -and -not $new; $i++) { Start-Sleep 2; $new = Get-Process | Where-Object { $_.Path -eq $after.FullName -and $_.Id -ne $old } | Select-Object -First 1 }
  Check 'update: the installer starts the program again' ($null -ne $new)
}
Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
Get-Process | Where-Object { $_.Path -eq $after.FullName } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# back to the Cloud line: Chihua over Vice Antidetect
$chihua = Get-ChildItem installer -Filter 'Chihua*.exe' | Select-Object -First 1
Start-Process $chihua.FullName -ArgumentList '/S' -Wait
Check 'Chihua again: brand.json removed' (-not (Test-Path $brand))
$entries = @(Uninstall-Entries)
Check 'Chihua again: entry named Chihua' ($entries.Count -eq 1 -and $entries[0].Name -eq 'Chihua') (($entries | ForEach-Object { $_.Name }) -join '; ')
Check 'Chihua again: no Vice Antidetect shortcut' (-not (Has-Lnk 'Vice Antidetect'))
Check 'Chihua again: no Vice Antidetect desktop shortcut' (-not (Test-Path (Join-Path $desk 'Vice Antidetect.lnk')))

if ($fail.Count) { throw "Vice Antidetect check failed: $($fail -join ', ')" }
Note 'Vice Antidetect: all good'
