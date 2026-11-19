# Miami Browser over Chihua on a real Windows: the same program (uninstall key, folder, exe), its own name,
# icon, shortcuts and default theme; installing Chihua again brings the Chihua line back.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$res = Join-Path $PWD "results"
New-Item -ItemType Directory -Force $res | Out-Null
$fail = @()
function Note($m) { Write-Host $m; Add-Content -Encoding utf8 (Join-Path $res "miami.txt") $m }
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
      if ($p.DisplayName -match 'Chihua|Miami') { $out += [pscustomobject]@{ Key = $_.PSChildName; Name = $p.DisplayName; Icon = $p.DisplayIcon } }
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
$miami = Get-ChildItem installer -Filter 'Miami_Browser*.exe' | Select-Object -First 1
if (-not $miami) { throw 'Miami installer is missing from the artifact' }
Note "installer: $($miami.Name)"
Start-Process $miami.FullName -ArgumentList '/S' -Wait

$after = Find-App
Check 'same exe and folder' ($after -and $after.FullName -eq $before.FullName) "$($after.FullName)"
$dir = $before.DirectoryName
$brand = Join-Path $dir 'brand.json'
Check 'brand.json next to the exe' (Test-Path $brand)
if (Test-Path $brand) {
  $b = Get-Content $brand -Raw | ConvertFrom-Json
  Check 'brand.json: line vice, theme vice-night' ($b.brand -eq 'vice' -and $b.theme -eq 'vice-night') (Get-Content $brand -Raw)
}
Check 'miami.ico installed' (Test-Path (Join-Path $dir 'miami.ico'))
$entries = @(Uninstall-Entries)
Note ("uninstall entries: " + (($entries | ForEach-Object { "$($_.Key)=$($_.Name)" }) -join '; '))
Check 'one uninstall entry, key Chihua, name Miami Browser' ($entries.Count -eq 1 -and $entries[0].Key -eq 'Chihua' -and $entries[0].Name -eq 'Miami Browser')
Check 'Start menu: Miami Browser shortcut' (Has-Lnk 'Miami Browser')
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
Check 'window title Miami Browser' ($title -eq 'Miami Browser') "'$title'"
Start-Sleep 8
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bnd = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bnd.Width,$bnd.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($bnd.Location,[System.Drawing.Point]::Empty,$bnd.Size)
$bmp.Save((Join-Path $res 'miami.png'))
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Get-Process | Where-Object { $_.Path -eq $after.FullName } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# back to the Cloud line: Chihua over Miami
$chihua = Get-ChildItem installer -Filter 'Chihua*.exe' | Select-Object -First 1
Start-Process $chihua.FullName -ArgumentList '/S' -Wait
Check 'Chihua again: brand.json removed' (-not (Test-Path $brand))
$entries = @(Uninstall-Entries)
Check 'Chihua again: entry named Chihua' ($entries.Count -eq 1 -and $entries[0].Name -eq 'Chihua') (($entries | ForEach-Object { $_.Name }) -join '; ')
Check 'Chihua again: no Miami Browser shortcut' (-not (Has-Lnk 'Miami Browser'))

if ($fail.Count) { throw "Miami check failed: $($fail -join ', ')" }
Note 'Miami Browser: all good'
