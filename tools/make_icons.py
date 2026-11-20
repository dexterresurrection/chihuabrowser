#!/usr/bin/env python3
"""Placeholder icons of Cloud Gram / Vice Gram (until the design kit has the real ones): cloud + speech tail + «G».
No paper plane and nothing from Telegram's logo. Writes android/overlay mipmaps, desktop/overlay art, brand/*.png|ico."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def grad(size, c1, c2):
    im = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,))
    return im


def icon(size, vice, round_=False):
    S = 1024
    im = grad(S, (255, 64, 160) if vice else (88, 182, 255), (110, 40, 230) if vice else (37, 99, 235))
    d = ImageDraw.Draw(im)
    w = (255, 255, 255, 255)
    k = S / 512
    if vice:
        glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([96 * k, 96 * k, 416 * k, 416 * k], outline=(43, 217, 254, 255), width=int(26 * k))
        im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10 * k)))
        d.ellipse([110 * k, 110 * k, 402 * k, 402 * k], outline=(43, 217, 254, 255), width=int(14 * k))
    for box in ([130, 200, 270, 340], [220, 150, 380, 310], [300, 215, 420, 335]):
        d.ellipse([v * k for v in box], fill=w)
    d.rounded_rectangle([130 * k, 260 * k, 420 * k, 345 * k], int(42 * k), fill=w)
    d.polygon([(190 * k, 330 * k), (165 * k, 395 * k), (250 * k, 340 * k)], fill=w)
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(96 * k))
    d.text((275 * k, 262 * k), 'G', font=f, fill=(110, 40, 230, 255) if vice else (37, 99, 235, 255), anchor='mm')
    m = Image.new('L', (S, S), 0)
    if round_:
        ImageDraw.Draw(m).ellipse([0, 0, S - 1, S - 1], fill=255)
    else:
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], int(224), fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out.resize((size, size), Image.LANCZOS)


def save(img, rel):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)


def main():
    for name, vice in (('tgx_ic_cloud', False), ('tgx_ic_vice', True)):
        for dens, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
            save(icon(px, vice), f'android/overlay/TMessagesProj/src/main/res/mipmap-{dens}/{name}.png')
        save(icon(512, vice), f'brand/{name}-512.png')
        ico = icon(256, vice)
        ico.save(os.path.join(ROOT, f'brand/{name}.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    art = 'desktop/overlay/Telegram/Resources/art/'
    for base, px in (('icon16', 16), ('icon32', 32), ('icon48', 48), ('icon64', 64), ('icon128', 128), ('icon256', 256), ('icon512', 512)):
        save(icon(px, False), art + base + '.png')
        save(icon(px * 2, False), art + base + '@2x.png')
    save(icon(256, False), art + 'logo_256.png')
    save(icon(256, False), art + 'logo_256_no_margin.png')
    save(icon(1024, False, round_=True), art + 'icon_round512@2x.png')
    icon(256, False).save(os.path.join(ROOT, art + 'icon256.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('icons written')


if __name__ == '__main__':
    main()
