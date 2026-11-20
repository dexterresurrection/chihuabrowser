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
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
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
