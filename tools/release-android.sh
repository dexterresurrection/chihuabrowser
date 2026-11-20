#!/bin/bash
# Release APKs from the CI build (gram-android artifact): Cloud and Vice, universal and arm64, our key.
#   tools/release-android.sh <CloudGram-unsigned-ci.apk> <version> [out dir]
# Secrets stay outside the repository: /root/vicegram-secrets/gram.json (chmod 600) =
#   {"api_id":…, "api_hash":"…", "bypass":{"mode":"auto","xray":[outbound…],"mtproto":[{"server","port","secret"}…],
#    "profiles_url":"…"}}
# Signing runs in the s3client-builder:2 image (Android SDK); wait for memory first, no build lock needed (light).
set -euo pipefail
IN=$1; VER=$2; OUT=${3:-/root/vicegram/out/$VER}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SECRETS=${GRAM_SECRETS:-/root/vicegram-secrets/gram.json}
KS=$ROOT/keystore/keystore-gram.properties
[ -f "$SECRETS" ] || { echo "no $SECRETS (api_id/api_hash from my.telegram.org + bypass profiles)"; exit 1; }
mkdir -p "$OUT"
brand() {   # brand <cloud|vice> → brand.json text (secrets merged, never printed)
  python3 -I - "$1" "$SECRETS" "$VER" <<'PY'
import json, sys
line, secrets, ver = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
if not (isinstance(secrets.get('api_id'), int) and len(secrets.get('api_hash', '')) == 32):
    sys.exit('api_id/api_hash missing in the secrets file')
b = {'v': 1, 'brand': line, 'name': 'Vice Gram' if line == 'vice' else 'Cloud Gram',
     'product': 'vice-gram' if line == 'vice' else 'gram', 'theme': 'vice-night' if line == 'vice' else '',
     'version': ver, 'ads_slot': 'gram.settings', 'downloads': 'https://cabinet.zjd.uk/app/downloads.json'}
b.update({k: secrets[k] for k in ('api_id', 'api_hash', 'bypass') if k in secrets})
print(json.dumps(b, ensure_ascii=False, separators=(',', ':')))
PY
}
CLOUD=$(brand cloud); VICE=$(brand vice)
python3 "$ROOT/tools/brand_apk.py" --in "$IN" --out "$OUT/CloudGram-$VER.apk" --keystore-props "$KS" --brand "$CLOUD" --any-cert
python3 "$ROOT/tools/brand_apk.py" --in "$IN" --out "$OUT/CloudGram-arm64-$VER.apk" --keystore-props "$KS" --brand "$CLOUD" --any-cert --keep-abi arm64-v8a
python3 "$ROOT/tools/brand_apk.py" --in "$OUT/CloudGram-$VER.apk" --out "$OUT/ViceGram-$VER.apk" --keystore-props "$KS" --brand "$VICE" \
  --enable ViceIcon --disable DefaultIcon --label alias
python3 "$ROOT/tools/brand_apk.py" --in "$OUT/CloudGram-arm64-$VER.apk" --out "$OUT/ViceGram-arm64-$VER.apk" --keystore-props "$KS" --brand "$VICE" \
  --enable ViceIcon --disable DefaultIcon --label alias
ls -la "$OUT"
