# Cloud Gram / Vice Gram on a real Windows (GitHub runner), from the installers in setup-url.txt / vice-url.txt:
#  1. Cloud installer /S: files, brand.json (cloud), Start menu shortcut;
#  2. Telegram blocked for CloudGram.exe by Windows Firewall (as from Russia), our test bypass server (VLESS + Reality)
#     on the runner, gram.json with Telegram Desktop's public development keys and that server;
#  3. CloudGram.exe: direct attempt fails → bypass turns on by itself → connected through xray; screenshot;
#  4. Vice installer over it: own folder, brand vice, Cloud removed, window title «Vice Gram», connects too.
$ErrorActionPreference = 'Continue'
$R = "$PWD\results"; New-Item -ItemType Directory -Force $R | Out-Null
$SUM = "$R\summary.txt"; '' | Out-File $SUM -Encoding utf8
$script:fails = 0
function ok($t)   { "OK   $t" | Tee-Object -FilePath $SUM -Append }
function bad($t)  { "FAIL $t" | Tee-Object -FilePath $SUM -Append; $script:fails++ }
function note($t) { "--   $t" | Tee-Object -FilePath $SUM -Append }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function shot($name) {
  try {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save("$R\$name.png"); $g.Dispose(); $bmp.Dispose()
  } catch { note "screenshot ${name}: $_" }
}
function fetch($urlFile, $shaFile, $out) {
  $u = (Get-Content $urlFile -First 1).Trim(); $s = (Get-Content $shaFile -First 1).Trim()
  Invoke-WebRequest $u -OutFile $out -UseBasicParsing
  if ((Get-FileHash $out -Algorithm SHA256).Hash.ToLower() -ne $s) { bad "sha256 of $out"; return $false }
  return $true
}

# ---------- test bypass server under its own exe path (not blocked)
New-Item -ItemType Directory -Force C:\xrsrv | Out-Null
Invoke-WebRequest "https://github.com/XTLS/Xray-core/releases/download/v26.11.9/Xray-windows-64.zip" -OutFile C:\xrsrv\x.zip -UseBasicParsing
Expand-Archive C:\xrsrv\x.zip C:\xrsrv -Force
$keys = & C:\xrsrv\xray.exe x25519
$priv = (($keys | Select-String 'PrivateKey') -split ': ')[1].Trim()
$pub = (($keys | Select-String 'Password|PublicKey' | Select-Object -First 1) -split ': ')[1].Trim()
$uuid = (& C:\xrsrv\xray.exe uuid).Trim()
$sid = -join ((1..8) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
@"
{"log":{"loglevel":"warning","access":"C:/xrsrv/access.log"},
 "inbounds":[{"listen":"127.0.0.1","port":7443,"protocol":"vless","settings":{"clients":[{"id":"$uuid","flow":"xtls-rprx-vision"}],"decryption":"none"},
   "streamSettings":{"network":"tcp","security":"reality","realitySettings":{"dest":"www.microsoft.com:443","serverNames":["www.microsoft.com"],"privateKey":"$priv","shortIds":["$sid"]}}}],
 "outbounds":[{"protocol":"freedom"}]}
"@ | Out-File C:\xrsrv\server.json -Encoding ascii
Start-Process C:\xrsrv\xray.exe -ArgumentList 'run','-c','C:\xrsrv\server.json' -WindowStyle Hidden
Start-Sleep 2
$outb = "{`"protocol`":`"vless`",`"settings`":{`"vnext`":[{`"address`":`"127.0.0.1`",`"port`":7443,`"users`":[{`"id`":`"$uuid`",`"flow`":`"xtls-rprx-vision`",`"encryption`":`"none`"}]}]},`"streamSettings`":{`"network`":`"tcp`",`"security`":`"reality`",`"realitySettings`":{`"serverName`":`"www.microsoft.com`",`"fingerprint`":`"chrome`",`"publicKey`":`"$pub`",`"shortId`":`"$sid`"}}}"
# Telegram Desktop's public development keys (TDESKTOP_API_TEST) — CI only, never in a published build
$gram = "{`"api_id`":17349,`"api_hash`":`"344583e45741c457fe1862106095a5eb`",`"version`":`"0.1.0`",`"bypass`":{`"mode`":`"auto`",`"xray`":[$outb],`"mtproto`":[]}}"
$tgNets = '149.154.160.0/20','91.108.4.0/22','91.108.8.0/22','91.108.12.0/22','91.108.16.0/22','91.108.20.0/22','91.108.56.0/22','95.161.64.0/20','185.76.151.0/24','2001:67c:4e8::/48','2001:b28:f23d::/48','2001:b28:f23f::/48'

function run-line($dir, $line, $name) {
  $exe = "$dir\CloudGram.exe"
  New-NetFirewallRule -DisplayName "gram-block-$line" -Direction Outbound -Program $exe -RemoteAddress $tgNets -Action Block | Out-Null
  Set-NetFirewallProfile -All -Enabled True
  $gram | Out-File "$dir\gram.json" -Encoding ascii
  $data = "$env:APPDATA\Cloud Gram"
  Remove-Item "$data\log.txt" -ErrorAction SilentlyContinue
  $p = Start-Process $exe -PassThru
  $log = "$data\log.txt"
  $deadline = (Get-Date).AddSeconds(150)
  $seen = @{}
  while ((Get-Date) -lt $deadline) {
    Start-Sleep 3
    if (Test-Path $log) {
      $t = Get-Content $log -Raw -ErrorAction SilentlyContinue
      foreach ($k in 'Tgx: brand','enable: auto','xray up on','telegram state 2 (bypass)') { if ($t -match [regex]::Escape($k)) { $seen[$k] = $true } }
      if ($seen['telegram state 2 (bypass)']) { break }
    }
  }
  Start-Sleep 4
  shot "$line-window"
  $t = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
  ($t -split "`n" | Select-String 'Tgx:' | Select-Object -Last 40) | Out-File "$R\$line-tgx.txt" -Encoding utf8
  Copy-Item $log "$R\$line-log.txt" -ErrorAction SilentlyContinue
  $b = ($t -split "`n" | Select-String 'Tgx: brand' | Select-Object -First 1)
  if ($b -and "$b" -match "brand $line, api set") { ok "${name}: brand $line, api keys from gram.json" } else { bad "${name}: brand line '$b'" }
  if ($seen['enable: auto']) { ok "${name}: direct failed, bypass turned on by itself" } else { bad "${name}: bypass did not turn on" }
  if ($seen['xray up on']) { ok "${name}: xray core running" } else { bad "${name}: xray core did not start" }
  if ($seen['telegram state 2 (bypass)']) { ok "${name}: Telegram connected through the bypass" } else { bad "${name}: no connection through the bypass" }
  if (Get-Process xray -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir*" }) { ok "${name}: xray.exe child alive" } else { bad "${name}: no xray.exe from $dir" }
  $title = (Get-Process CloudGram -ErrorAction SilentlyContinue | Select-Object -First 1).MainWindowTitle
  if ($title -like "*$name*") { ok "${name}: window title '$title'" } else { note "${name}: window title '$title'" }
  Stop-Process -Name CloudGram -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
  if (Get-Process xray -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir*" }) { bad "${name}: xray.exe survived the client (job object)" } else { ok "${name}: xray.exe ended with the client" }
  Remove-NetFirewallRule -DisplayName "gram-block-$line" -ErrorAction SilentlyContinue
}

# ---------- Cloud
if (fetch 'setup-url.txt' 'setup-sha.txt' "$env:TEMP\CloudGram-Setup.exe") {
  Start-Process "$env:TEMP\CloudGram-Setup.exe" -ArgumentList '/S' -Wait
  $dir = 'C:\Program Files\Cloud Gram'
  foreach ($f in 'CloudGram.exe','xray.exe','gram.json','brand.json','uninstall.exe') { if (Test-Path "$dir\$f") { ok "Cloud: $f installed" } else { bad "Cloud: no $f" } }
  if ((Get-Content "$dir\brand.json" -Raw) -match '"brand":"cloud"') { ok 'Cloud: brand.json cloud' } else { bad "Cloud: brand.json $(Get-Content "$dir\brand.json" -Raw)" }
  if (Test-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Cloud Gram.lnk") { ok 'Cloud: Start menu shortcut' } else { note 'Cloud: no Start menu shortcut in ProgramData' }
  run-line $dir 'cloud' 'Cloud Gram'
}
$n = (Select-String -Path C:\xrsrv\access.log -Pattern '(149\.154\.|91\.108\.)[0-9.]+:(443|80|5222)' -ErrorAction SilentlyContinue | Measure-Object).Count
if ($n -gt 0) { ok "test server: $n connections to Telegram data centers went through it" } else { bad 'test server: no Telegram connections in its log' }

# ---------- Vice over Cloud
if ((Test-Path 'vice-url.txt') -and (fetch 'vice-url.txt' 'vice-sha.txt' "$env:TEMP\ViceGram-Setup.exe")) {
  Start-Process "$env:TEMP\ViceGram-Setup.exe" -ArgumentList '/S' -Wait
  $vdir = 'C:\Program Files\Vice Gram'
  if (Test-Path "$vdir\CloudGram.exe") { ok 'Vice: installed into its own folder' } else { bad 'Vice: not in C:\Program Files\Vice Gram' }
  if (-not (Test-Path 'C:\Program Files\Cloud Gram\CloudGram.exe')) { ok 'Vice: Cloud line removed' } else { bad 'Vice: Cloud line still installed' }
  if ((Get-Content "$vdir\brand.json" -Raw) -match '"brand":"vice"') { ok 'Vice: brand.json vice' } else { bad 'Vice: brand.json' }
  run-line $vdir 'vice' 'Vice Gram'
  Start-Process "$vdir\uninstall.exe" -ArgumentList '/S' -Wait
  Start-Sleep 3
  if (-not (Test-Path "$vdir\CloudGram.exe")) { ok 'uninstall /S removed the program' } else { bad 'uninstall left the program' }
  if (Test-Path "$env:APPDATA\Cloud Gram") { ok 'uninstall kept the user data folder' } else { note 'no user data folder after uninstall' }
}
Copy-Item C:\xrsrv\access.log "$R\server-access.log" -ErrorAction SilentlyContinue
"FAILS=$script:fails" | Tee-Object -FilePath $SUM -Append
exit ([int]($script:fails -gt 0))
