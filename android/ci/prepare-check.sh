#!/bin/bash
# Runner host, before the emulator: (1) our test bypass server (VLESS + Reality, like the production pool) under its
# own user; (2) Telegram blocked for everything else on this machine — the emulator's traffic leaves through the host,
# so inside the emulator Telegram looks like from Russia (SYN to the data centers is dropped, as measured from ho-rus);
# (3) CI APKs: Cloud and Vice, test brand (public Telegram Desktop development keys, this test server), CI key.
set -euo pipefail
mkdir -p results ci
BT=$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)
echo "build-tools $BT"

# ---- test server
sudo useradd -r -s /usr/sbin/nologin xrsrv 2>/dev/null || true
sudo mkdir -p /opt/xr && cd /opt/xr
sudo curl -sSfL --retry 3 -o x.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY:-v26.11.9}/Xray-linux-64.zip"
sudo unzip -q -o x.zip xray && sudo chmod 755 xray
KEYS=$(./xray x25519)
PRIV=$(echo "$KEYS" | awk -F': ' '/PrivateKey/{print $2}')
PUB=$(echo "$KEYS" | awk -F': ' '/Password|PublicKey/{print $2}' | head -1)
UUID=$(./xray uuid)
SID=$(openssl rand -hex 8)
sudo tee server.json >/dev/null <<J
{"log":{"loglevel":"warning","access":"/opt/xr/access.log"},
 "inbounds":[{"listen":"0.0.0.0","port":7443,"protocol":"vless","settings":{"clients":[{"id":"$UUID","flow":"xtls-rprx-vision"}],"decryption":"none"},
   "streamSettings":{"network":"tcp","security":"reality","realitySettings":{"dest":"www.microsoft.com:443","serverNames":["www.microsoft.com"],"privateKey":"$PRIV","shortIds":["$SID"]}}}],
 "outbounds":[{"protocol":"freedom"}]}
J
sudo chown -R xrsrv /opt/xr
sudo -u xrsrv bash -c 'nohup /opt/xr/xray run -c /opt/xr/server.json > /opt/xr/server.out 2>&1 &'
sleep 2
cd - >/dev/null

# ---- Telegram blocked for everyone except the test server
for net in 149.154.160.0/20 91.108.4.0/22 91.108.8.0/22 91.108.12.0/22 91.108.16.0/22 91.108.20.0/22 91.108.56.0/22 95.161.64.0/20 185.76.151.0/24; do
  sudo iptables -I OUTPUT -d "$net" -m owner ! --uid-owner xrsrv -j DROP
done
for net in 2001:67c:4e8::/48 2001:b28:f23d::/48 2001:b28:f23f::/48 2001:b28:f23c::/48 2a0a:f280::/32; do
  sudo ip6tables -I OUTPUT -d "$net" -m owner ! --uid-owner xrsrv -j DROP || true
done
{
  if timeout 6 bash -c '</dev/tcp/149.154.167.51/443' 2>/dev/null; then echo "FAIL host: Telegram still reachable directly"; else echo "OK   host: Telegram blocked directly (DC2 149.154.167.51:443 timeout)"; fi
  if sudo -u xrsrv timeout 6 bash -c '</dev/tcp/149.154.167.51/443' 2>/dev/null; then echo "OK   host: the bypass server reaches Telegram"; else echo "FAIL host: the bypass server cannot reach Telegram"; fi
} | tee results/host.txt

# ---- CI APKs (CI key; release signing is never done here)
keytool -genkeypair -keystore ci/ci.jks -storepass android -keypass android -alias ci -keyalg RSA -keysize 2048 -validity 30 -dname CN=ci >/dev/null 2>&1
printf 'storeFile=ci.jks\nstorePassword=android\nkeyAlias=ci\nkeyPassword=android\n' > ci/ci.properties
OUTB=$(cat <<J
{"protocol":"vless","settings":{"vnext":[{"address":"10.0.2.2","port":7443,"users":[{"id":"$UUID","flow":"xtls-rprx-vision","encryption":"none"}]}]},
 "streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"www.microsoft.com","fingerprint":"chrome","publicKey":"$PUB","shortId":"$SID"}}}
J
)
# Telegram Desktop's public development keys (TDESKTOP_API_TEST) — CI only, never in a published build
KEYS_JSON='"api_id":17349,"api_hash":"344583e45741c457fe1862106095a5eb"'
CLOUD="{\"v\":1,\"brand\":\"cloud\",\"name\":\"Cloud Gram\",\"product\":\"gram\",$KEYS_JSON,\"bypass\":{\"mode\":\"auto\",\"xray\":[$OUTB],\"mtproto\":[]},\"ads_slot\":\"gram.settings\"}"
VICE="{\"v\":1,\"brand\":\"vice\",\"name\":\"Vice Gram\",\"product\":\"vice-gram\",\"theme\":\"vice-night\",$KEYS_JSON,\"bypass\":{\"mode\":\"auto\",\"xray\":[$OUTB],\"mtproto\":[]},\"ads_slot\":\"gram.settings\"}"
export BRAND_APK_LOCAL=1 BRAND_APK_BUILD_TOOLS=$BT
python3 tools/brand_apk.py --in out/CloudGram-unsigned-ci.apk --out ci/cloud.apk --keystore-props ci/ci.properties --brand "$CLOUD" --any-cert
python3 tools/brand_apk.py --in ci/cloud.apk --out ci/vice.apk --keystore-props ci/ci.properties --brand "$VICE" \
  --enable ViceIcon --disable DefaultIcon --label alias
ls -la ci
