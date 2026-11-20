#!/bin/bash
# In the emulator (runner with KVM; Telegram is blocked on the host by prepare-check.sh):
#  A. Cloud APK, mode «auto»: starts, Telegram does not connect directly, the bypass turns on by itself, the client
#     connects through the xray core; the test server's access log shows the Telegram data centers.
#  B. Vice APK over it (same key): launcher entry is the Vice alias with the Vice name; starts and connects.
# Result: results/api-<N>/summary.txt, screenshots, logcat. Any FAIL → exit code 1.
set -uo pipefail
ADB=$(command -v adb)
adb() { timeout 300 "$ADB" "$@"; }
R=results/api-${API:-x}
mkdir -p "$R"
SUM=$R/summary.txt
cp results/host.txt "$SUM" 2>/dev/null || : > "$SUM"
FAILS=$(grep -c '^FAIL' "$SUM" || true)
ok()   { echo "OK   $*" | tee -a "$SUM"; }
bad()  { echo "FAIL $*" | tee -a "$SUM"; FAILS=$((FAILS+1)); }
note() { echo "--   $*" | tee -a "$SUM"; }
shot() { timeout 30 adb exec-out screencap -p > "$R/$1.png" 2>/dev/null || true; }
PKG=uk.zjd.cloudgram
note "Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r')), ABI $(adb shell getprop ro.product.cpu.abilist | tr -d '\r')"

wait_log() {   # wait_log <regex> <seconds>
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do
    adb logcat -d -s tgx:I 2>/dev/null | grep -E -m1 "$1" && return 0
    sleep 3
  done
  return 1
}

run_line() {   # run_line <apk> <tag> <expected alias> <expected label>
  local apk=$1 tag=$2 alias=$3 label=$4
  if adb install -r "$apk" >/dev/null 2>&1; then ok "$tag: installed"; else bad "$tag: install"; return; fi
  local la
  la=$(adb shell cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER $PKG 2>/dev/null | tr -d '\r' | grep -o "$PKG/[A-Za-z0-9_.]*" | head -3 | tr '\n' ' ')
  if echo "$la" | grep -q "$alias"; then ok "$tag: launcher entry $alias"; else bad "$tag: launcher entry is '$la', want $alias"; fi
  adb shell am force-stop $PKG
  adb logcat -c
  adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 6
  shot "$tag-start"
  local lbl
  lbl=$(adb shell dumpsys package $PKG | tr -d '\r' | grep -m1 -o "versionName=[^ ]*")
  note "$tag: $lbl"
  if wait_log "telegram state [0-9]+ \(direct\)" 40 >/dev/null; then ok "$tag: client started, direct attempt first (mode auto)"; else bad "$tag: no tgx state log"; fi
  if l=$(wait_log "enable: auto" 60); then ok "$tag: bypass turned on by itself: ${l#*: }"; else bad "$tag: bypass did not turn on"; fi
  if l=$(wait_log "xray up on" 30); then ok "$tag: xray core running (${l##*xray up on })"; else bad "$tag: xray core did not start"; fi
  if l=$(wait_log "telegram state 3 \(bypass\)" 90); then ok "$tag: Telegram connected through the bypass"; else bad "$tag: Telegram did not connect through the bypass"; fi
  if adb shell ps -A 2>/dev/null | grep -q libxray; then ok "$tag: libxray process present"; else bad "$tag: no libxray process"; fi
  sleep 5
  shot "$tag-connected"
  adb shell "uiautomator dump /sdcard/ui.xml" >/dev/null 2>&1
  adb exec-out cat /sdcard/ui.xml > "$R/$tag-ui.xml" 2>/dev/null || true
  if grep -q "$label" "$R/$tag-ui.xml"; then ok "$tag: «$label» on screen"; else note "$tag: «$label» not on the first screen (see $tag-connected.png)"; fi
  if grep -q '>Telegram<\|text="Telegram"' "$R/$tag-ui.xml"; then bad "$tag: the word Telegram as a title on the first screen"; fi
  adb logcat -d > "$R/$tag-logcat.txt" 2>/dev/null
  if grep -q "FATAL EXCEPTION" "$R/$tag-logcat.txt"; then bad "$tag: crash (FATAL EXCEPTION in logcat)"; grep -A25 -m1 "FATAL EXCEPTION" "$R/$tag-logcat.txt" | tee -a "$SUM"; fi
  grep " tgx " "$R/$tag-logcat.txt" | tail -40 > "$R/$tag-tgx.txt" || true
}

run_line ci/cloud.apk cloud DefaultIcon "Cloud Gram"
n=$(sudo grep -cE '(149\.154\.|91\.108\.)[0-9.]+:(443|80|5222)' /opt/xr/access.log 2>/dev/null || echo 0)
if [ "${n:-0}" -gt 0 ]; then ok "test server: $n connections to Telegram data centers went through it"; else bad "test server: no Telegram connections in its log"; fi
sudo tail -5 /opt/xr/access.log | sed 's/^/     /' | tee -a "$SUM"
run_line ci/vice.apk vice ViceIcon "Vice Gram"
sudo cp /opt/xr/access.log "$R/server-access.log" 2>/dev/null; sudo chmod 644 "$R/server-access.log" 2>/dev/null
echo "FAILS=$FAILS" | tee -a "$SUM"
[ "$FAILS" -eq 0 ]
