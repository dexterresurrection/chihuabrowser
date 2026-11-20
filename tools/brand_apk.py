#!/usr/bin/env python3
"""Vice-сборка Android-приложения из готового Cloud-APK — без второй сборки Gradle.

Тот же код, applicationId и ключ подписи; меняются только:
  * assets/brand.json — линия и тема первого запуска ({"v":1,"brand":"vice","name":"Vice Mail","theme":"vice-night"});
  * в двоичном AndroidManifest.xml — числа на своих местах (длина файла та же): у двух activity-alias меняются
    местами значения android:enabled (значок Cloud → значок Vice), у <application> ссылки android:label и
    android:icon (и roundIcon, если есть) — на ресурсы Vice (имя в окне установки и в «Приложениях»).
Потом zipalign и apksigner тем же ключом (в образе сборки s3client-builder:2, там Android SDK).

  python3 tools/brand_apk.py --in out/CloudMail_1.1.0_universal.apk --out out/ViceMail_1.1.0_universal.apk \\
      --keystore-props keystore/keystore-mail.properties \\
      --brand '{"v":1,"brand":"vice","name":"Vice Mail","theme":"vice-night"}' \\
      --enable .ViceLauncher --disable .MainActivity \\
      --label string/app_name_vice --icon mipmap/ic_launcher_vice

Секреты ключа не печатаются: пароли уходят в apksigner через переменные окружения контейнера.
"""
import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

IMAGE = os.environ.get('BRAND_APK_IMAGE', 's3client-builder:2')
LOCAL = os.environ.get('BRAND_APK_LOCAL') == '1'   # CI: Android SDK on the runner itself, no docker
BUILD_TOOLS = os.environ.get('BRAND_APK_BUILD_TOOLS', '36.0.0')

ATTR_NAME, ATTR_LABEL, ATTR_ICON, ATTR_ENABLED, ATTR_ROUND_ICON = 0x01010003, 0x01010001, 0x01010002, 0x0101000E, 0x0101052C
T_REFERENCE, T_STRING, T_BOOLEAN = 0x01, 0x03, 0x12


def parse_pool(b, off):
    _, hs, _, count, _, flags, start, _ = struct.unpack_from('<HHIIIIII', b, off)
    utf8 = bool(flags & 0x100)
    offs = struct.unpack_from('<%dI' % count, b, off + hs)
    out = []
    for o in offs:
        p = off + start + o
        if utf8:
            n = b[p]; p += 2 if n & 0x80 else 1           # длина в символах
            n = b[p]
            if n & 0x80:
                n = ((n & 0x7F) << 8) | b[p + 1]; p += 2
            else:
                p += 1
            out.append(bytes(b[p:p + n]).decode('utf-8', 'replace'))
        else:
            n = struct.unpack_from('<H', b, p)[0]; p += 2
            if n & 0x8000:
                n = ((n & 0x7FFF) << 16) | struct.unpack_from('<H', b, p)[0]; p += 2
            out.append(bytes(b[p:p + 2 * n]).decode('utf-16-le', 'replace'))
    return out


def alias_res(data, alias):
    """(label_id, icon_id) of an activity-alias in the binary manifest — no lookup by resource name needed
    (Telegram's release build keeps an unusual resource table where aapt2 does not list most names)."""
    b = bytes(data)
    _, hs, total = struct.unpack_from('<HHI', b, 0)
    strings, resmap = [], []
    off = hs
    while off < total:
        ct, chs, csize = struct.unpack_from('<HHI', b, off)
        if ct == 0x0001:
            strings = parse_pool(b, off)
        elif ct == 0x0180:
            resmap = list(struct.unpack_from('<%dI' % ((csize - chs) // 4), b, off + chs))
        elif ct == 0x0102:
            _, name_i, a_start, a_size, a_count = struct.unpack_from('<IIHHH', b, off + 16)
            if strings[name_i] == 'activity-alias':
                attrs = {}
                for i in range(a_count):
                    ao = off + 16 + a_start + i * a_size
                    _, an, raw, _, _, dt, val = struct.unpack_from('<IIIHBBI', b, ao)
                    rid = resmap[an] if an < len(resmap) else 0
                    attrs[rid] = (raw, dt, val)
                nm = attrs.get(ATTR_NAME)
                name = strings[nm[0]] if nm and nm[0] != 0xFFFFFFFF else (strings[nm[2]] if nm else '')
                if name == alias or name.endswith('.' + alias.lstrip('.')):
                    lab, ico = attrs.get(ATTR_LABEL), attrs.get(ATTR_ICON)
                    if not lab or not ico or lab[1] != T_REFERENCE or ico[1] != T_REFERENCE:
                        raise SystemExit(f'у {name} нет android:label/android:icon ссылками')
                    return lab[2], ico[2]
        off += csize
    raise SystemExit(f'нет activity-alias {alias}')


def patch_manifest(data, enable, disable, label_id, icon_id):
    """Меняет значения на месте; возвращает (новые байты, список сделанного)."""
    b = bytearray(data)
    t, hs, total = struct.unpack_from('<HHI', b, 0)
    if t != 0x0003:
        raise SystemExit('AndroidManifest.xml — не двоичный XML')
    strings, resmap, done = [], [], []
    found = {enable: False, disable: False}
    off = hs
    while off < total:
        ct, chs, csize = struct.unpack_from('<HHI', b, off)
        if ct == 0x0001:
            strings = parse_pool(b, off)
        elif ct == 0x0180:
            resmap = list(struct.unpack_from('<%dI' % ((csize - chs) // 4), b, off + chs))
        elif ct == 0x0102:
            _, name_i, a_start, a_size, a_count = struct.unpack_from('<IIHHH', b, off + 16)
            tag = strings[name_i]
            attrs = []
            for i in range(a_count):
                ao = off + 16 + a_start + i * a_size
                _, an, raw, _, _, dt, val = struct.unpack_from('<IIIHBBI', b, ao)
                rid = resmap[an] if an < len(resmap) else 0
                attrs.append((rid, raw, dt, val, ao))
            if tag == 'activity-alias':
                name = next((strings[raw] if raw != 0xFFFFFFFF else strings[val] for rid, raw, dt, val, _ in attrs if rid == ATTR_NAME), '')
                for want, on in ((enable, True), (disable, False)):
                    if name == want or name.endswith(want if want.startswith('.') else '.' + want):
                        en = [a for a in attrs if a[0] == ATTR_ENABLED]
                        if not en or en[0][2] != T_BOOLEAN:
                            raise SystemExit(f'у {name} нет android:enabled — задайте его в манифесте явно')
                        struct.pack_into('<I', b, en[0][4] + 16, 0xFFFFFFFF if on else 0)
                        found[want] = True
                        done.append(f'{name}: enabled={"true" if on else "false"}')
            elif tag == 'application':
                for rid, raw, dt, val, ao in attrs:
                    new = {ATTR_LABEL: label_id, ATTR_ICON: icon_id, ATTR_ROUND_ICON: icon_id}.get(rid)
                    if new is None:
                        continue
                    if dt != T_REFERENCE:
                        raise SystemExit(f'у <application> атрибут 0x{rid:08x} не ссылка на ресурс')
                    struct.pack_into('<I', b, ao + 16, new)
                    done.append(f'application 0x{rid:08x}: 0x{val:08x} → 0x{new:08x}')
        off += csize
    missing = [k for k, v in found.items() if not v]
    if missing:
        raise SystemExit('не нашёл activity-alias: ' + ', '.join(missing))
    if not any(d.startswith('application 0x01010001') for d in done):
        raise SystemExit('у <application> нет android:label-ссылки')
    return bytes(b), done


def docker(args, work, env=None, capture=True):
    if LOCAL:
        r = subprocess.run(['bash', '-c', args], cwd=work, env={**os.environ, **(env or {})}, capture_output=capture, text=True)
    else:
        cmd = ['docker', 'run', '--rm', '--memory=1g', '-v', f'{work}:/w', '-w', '/w']
        for k in (env or {}):
            cmd += ['-e', k]
        cmd += [IMAGE, 'bash', '-c', args]
        r = subprocess.run(cmd, env={**os.environ, **(env or {})}, capture_output=capture, text=True)
    if r.returncode != 0:
        sys.stderr.write((r.stdout or '')[-2000:] + (r.stderr or '')[-2000:])
        raise SystemExit(f'не получилось: {args.split()[0]}')
    return r.stdout


def res_ids(work, apk):
    out = docker(f'$ANDROID_HOME/build-tools/{BUILD_TOOLS}/aapt2 dump resources {apk}', work)
    ids = {}
    for m in re.finditer(r'resource (0x[0-9a-f]{8}) (\S+)', out):
        ids[m.group(2)] = int(m.group(1), 16)
    return ids


def props(path):
    p = {}
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            p[k.strip()] = v.strip()
    return p


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--keystore-props', required=True)
    ap.add_argument('--brand', required=True, help='содержимое assets/brand.json')
    ap.add_argument('--brand-path', default='assets/brand.json')
    ap.add_argument('--enable', help='без --enable/--disable манифест не меняется (Cloud: только brand.json и подпись)')
    ap.add_argument('--disable')
    ap.add_argument('--label', help='ресурс имени, например string/app_name_vice; alias — взять имя и значок у ярлыка --enable')
    ap.add_argument('--icon', help='ресурс значка, например mipmap/ic_launcher_vice')
    ap.add_argument('--any-cert', action='store_true', help='исходный APK подписан другим ключом (сборка CI)')
    ap.add_argument('--keep-abi', help='оставить только эту архитектуру в lib/ (arm64-v8a — «облегчённый» APK)')
    a = ap.parse_args()

    brand = json.dumps(json.loads(a.brand), ensure_ascii=False, separators=(',', ':'))
    kp = props(a.keystore_props)
    ks = kp['storeFile']
    if not os.path.isabs(ks):
        ks = os.path.join(os.path.dirname(os.path.abspath(a.keystore_props)), ks)
    if not os.path.exists(ks):
        ks = os.path.join(os.path.dirname(os.path.abspath(a.keystore_props)), os.path.basename(kp['storeFile']))

    work = tempfile.mkdtemp(prefix='brand-apk-', dir=os.environ.get('BRAND_APK_TMP'))
    try:
        shutil.copy(a.src, f'{work}/in.apk')
        shutil.copy(ks, f'{work}/key.jks')
        os.chmod(f'{work}/key.jks', 0o600)
        label_id = icon_id = None
        if a.enable and a.label == 'alias':
            with zipfile.ZipFile(f'{work}/in.apk') as z:
                label_id, icon_id = alias_res(z.read('AndroidManifest.xml'), a.enable)
            print(f'имя и значок из ярлыка {a.enable}: 0x{label_id:08x}, 0x{icon_id:08x}')
        elif a.enable:
            ids = res_ids(work, 'in.apk')
            label_id, icon_id = ids.get(a.label), ids.get(a.icon)
            if not label_id or not icon_id:
                raise SystemExit(f'нет ресурса {a.label if not label_id else a.icon} в APK')

        with zipfile.ZipFile(f'{work}/in.apk') as zin, zipfile.ZipFile(f'{work}/unsigned.apk', 'w') as zout:
            names = zin.namelist()
            if a.brand_path not in names:
                raise SystemExit(f'в APK нет {a.brand_path}: у Cloud-сборки он должен быть (линия cloud)')
            for info in zin.infolist():
                n = info.filename
                if n.startswith('META-INF/') and re.search(r'\.(SF|RSA|DSA|EC)$|MANIFEST\.MF$', n):
                    continue  # старая подпись v1 — apksigner сделает новую
                if a.keep_abi and n.startswith('lib/') and not n.startswith(f'lib/{a.keep_abi}/'):
                    continue
                data = zin.read(n)
                if n == 'AndroidManifest.xml' and a.enable:
                    data, done = patch_manifest(data, a.enable, a.disable, label_id, icon_id)
                    for d in done:
                        print('манифест:', d)
                elif n == a.brand_path:
                    data = brand.encode()
                    print(f'{n}: заменён ({len(brand)} байт)')   # api_hash и профили не печатаются
                zi = zipfile.ZipInfo(n, info.date_time)
                zi.compress_type = info.compress_type
                zi.external_attr = info.external_attr
                zout.writestr(zi, data)

        bt = f'$ANDROID_HOME/build-tools/{BUILD_TOOLS}'
        env = {'KS_PASS': kp['storePassword'], 'KEY_PASS': kp.get('keyPassword', kp['storePassword']), 'KEY_ALIAS': kp['keyAlias']}
        docker(f'set -e; {bt}/zipalign -P 16 -f 4 unsigned.apk aligned.apk && '
               f'{bt}/apksigner sign --ks key.jks --ks-pass env:KS_PASS --key-pass env:KEY_PASS --ks-key-alias "$KEY_ALIAS" '
               f'--out signed.apk aligned.apk', work, env)
        # проверка: подпись цела, сертификат тот же, что у исходного APK; имя и значок — Vice
        certs = docker(f'{bt}/apksigner verify --print-certs in.apk | grep SHA-256; echo ===; '
                       f'{bt}/apksigner verify --print-certs signed.apk | grep SHA-256', work)
        before, after = certs.split('===')
        if (before.strip() != after.strip() and not a.any_cert) or not after.strip():
            raise SystemExit('сертификат подписи не совпадает с исходным APK')
        badging = docker(f'{bt}/aapt2 dump badging signed.apk', work)
        lab = re.search(r"application-label:'([^']*)'", badging)
        print('сертификат тот же:', after.strip().split()[-1][:16] + '…')
        print('имя приложения:', lab.group(1) if lab else '?')  # значки activity-alias aapt2 не показывает — см. «манифест:» выше
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        shutil.copy(f'{work}/signed.apk', a.out)
        print('готово:', a.out, os.path.getsize(a.out), 'байт')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
