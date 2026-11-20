#!/usr/bin/env python3
"""Telegram's logo out of the app (Telegram API terms 2.4): the intro plane, the notification icon, launcher icons,
the «Telegram» wordmark and the splash are replaced by ours, same names and pixel sizes.

    python3 android/logos.py <Telegram-Android checkout>
"""
import os
import re
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'tools'))
from make_icons import icon  # noqa: E402


def cloud_silhouette(size, pad=0.12):
    """White cloud with a speech tail on transparent — status bar icon and the intro centre."""
    S = 512
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = (255, 255, 255, 255)
    for box in ([60, 170, 230, 340], [170, 100, 370, 300], [290, 180, 450, 340]):
        d.ellipse(box, fill=w)
    d.rounded_rectangle([60, 250, 450, 345], 48, fill=w)
    d.polygon([(140, 330), (105, 420), (225, 340)], fill=w)
    inner = int(size * (1 - 2 * pad))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2, (size - inner) // 2))
    return out


def main():
    up = sys.argv[1]
    n = 0
    for module in ('TMessagesProj', 'TMessagesProj_AppStandalone'):
        res = os.path.join(up, module, 'src/main/res')
        for d in sorted(os.listdir(res)):
            if not (d.startswith('drawable') or d.startswith('mipmap')):
                continue
            for f in sorted(os.listdir(os.path.join(res, d))):
                p = os.path.join(res, d, f)
                base, ext = os.path.splitext(f)
                if d.startswith('mipmap-anydpi') and re.match(r'(ic_launcher|icon_\d_launcher)(_round|_sa)?', base):
                    os.remove(p)   # adaptive icons of Telegram → the PNGs below are used
                    n += 1
                    continue
                if ext not in ('.png', '.webp'):
                    continue
                if not (base in ('intro_tg_plane', 'notification', 'logo_middle', 'ic_launcher_dr')
                        or re.fullmatch(r'(ic_launcher|icon_\d_launcher)(_round)?(_sa)?', base)):
                    continue
                w, h = Image.open(p).size
                if base == 'notification':
                    img = cloud_silhouette(w, 0.06)
                elif base == 'intro_tg_plane':
                    img = cloud_silhouette(w, 0.18)
                else:
                    img = icon(w, False, round_=('round' in base))
                if (w, h) != img.size:
                    img = img.resize((w, h), Image.LANCZOS)
                img.save(p, 'WEBP' if ext == '.webp' else 'PNG', **({'lossless': True} if ext == '.webp' else {}))
                n += 1
        dr = os.path.join(res, 'drawable')
        for f in ('telegram_logo.xml', 'telegram_logo_2.xml'):
            p = os.path.join(dr, f)
            if os.path.exists(p):   # the «Telegram» wordmark → nothing (same size, transparent)
                t = open(p).read()
                head = re.search(r'<vector[^>]*>', t, re.S).group(0)
                open(p, 'w').write(head + '\n    <path android:fillColor="#00000000" android:pathData="M0,0h1v1h-1z"/>\n</vector>\n')
                n += 1
        p = os.path.join(dr, 'tg_splash_320.xml')
        if os.path.exists(p):
            open(p, 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n'
                               '    <item android:drawable="@mipmap/tgx_ic_cloud" android:width="160dp" android:height="160dp" android:gravity="center"/>\n</layer-list>\n')
            n += 1
    print('logos replaced:', n)


if __name__ == '__main__':
    main()
