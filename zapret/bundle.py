#!/usr/bin/env python3
"""Пакет zapret для Windows-программ Cloud VPN (Cloud VPN для Windows, Cloud Browser, Chihua Browser).

  python3 bundle.py --out DIR [--cache DIR] [--zapretctl path\\to\\zapretctl.exe]

В DIR получается то, что программа кладёт рядом с собой в папку zapret\\:
  bin\\       winws.exe, cygwin1.dll, WinDivert.dll, WinDivert64.sys — из официального релиза bol-van/zapret v72.9 (MIT);
              *.bin — фейковые пакеты Flowseal (MIT). Пресеты Flowseal ссылаются на них как %BIN%…
  lists\\     списки доменов и IP Flowseal 1.10.4
  presets.json  22 стратегии Flowseal (general, ALT…, FAKE TLS AUTO…, SIMPLE FAKE…) — аргументы winws из .bat как есть
  bundle.json   номер пакета, версии и SHA-256 каждого файла: zapretctl сверяет по нему копию в %ProgramData%
  LICENSES.txt, zapretctl.exe

Почему winws (zapret 1), а не winws2: готовые стратегии Flowseal написаны для winws; бинарники в сборке Flowseal
побайтно совпадают с релизом автора v72.9 (проверено 2026-11-12). Скрипт сверяет и это.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
import zipfile

BUNDLE = 1  # растёт при любой смене содержимого: программы обновляют общую копию в %ProgramData%, только если номер больше
ZAPRET = ('v72.9', 'https://github.com/bol-van/zapret/releases/download/v72.9/zapret-v72.9.zip',
          '2d8eef31e4966f32cd25b1ca361b0faa8f3c10cbaa514b8d0b6d82986784dfe7')
FLOWSEAL = ('1.10.4', 'https://github.com/Flowseal/zapret-discord-youtube/releases/download/1.10.4/zapret-discord-youtube-1.10.4.zip',
            '291af673bd0238506f9548e0e94ca0abf244000f4c9a06960544fb01c5f97b34')
BINARIES = ('winws.exe', 'cygwin1.dll', 'WinDivert.dll', 'WinDivert64.sys')


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def fetch(cache, url, want):
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, url.rsplit('/', 1)[1])
    if not os.path.isfile(path) or sha256(open(path, 'rb').read()) != want:
        req = urllib.request.Request(url, headers={'User-Agent': 'cloudvpn-zapret-bundle'})
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
        if sha256(data) != want:
            sys.exit(f'SHA-256 не совпал: {url}')
        with open(path, 'wb') as f:
            f.write(data)
    return zipfile.ZipFile(path)


def natural(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', name)]


def preset_args(bat):
    """Аргументы winws из .bat Flowseal: всё после "%BIN%winws.exe" до конца команды (строки с ^ — продолжение)."""
    text = bat.replace('\r', '')
    i = text.find('winws.exe"')
    if i < 0:
        return None
    cmd = []
    for line in text[i + len('winws.exe"'):].split('\n'):
        line = line.strip()
        cont = line.endswith('^')
        cmd.append(line[:-1] if cont else line)
        if not cont:
            break
    s = ' '.join(cmd)
    s = (s.replace('%BIN%', '{BIN}').replace('%LISTS%', '{LISTS}').replace('%GameFilterTCP%', '{GAME_TCP}')
         .replace('%GameFilterUDP%', '{GAME_UDP}').replace('%GameFilter%', '{GAME}'))
    if '%' in s:
        sys.exit(f'в пресете осталась переменная: {re.findall(r"%[^%]+%", s)}')
    args = [a.replace('"', '') for a in s.split()]
    if not args or not all(a.startswith('--') for a in args):
        sys.exit(f'странные аргументы: {args[:5]}')
    return args


def main():
    for stream in (sys.stdout, sys.stderr):  # консоль Windows в cp1252, а сообщения по-русски
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache'))
    ap.add_argument('--zapretctl', default='')
    a = ap.parse_args()
    z = fetch(a.cache, ZAPRET[1], ZAPRET[2])
    f = fetch(a.cache, FLOWSEAL[1], FLOWSEAL[2])
    zroot, froot = f'zapret-{ZAPRET[0]}/', f'zapret-discord-youtube-{FLOWSEAL[0]}/'

    if os.path.isdir(a.out):
        shutil.rmtree(a.out)
    os.makedirs(os.path.join(a.out, 'bin'))
    os.makedirs(os.path.join(a.out, 'lists'))
    files = {}

    def put(rel, data):
        p = os.path.join(a.out, *rel.split('/'))
        with open(p, 'wb') as out:
            out.write(data)
        files[rel] = sha256(data)

    for name in BINARIES:
        data = z.read(zroot + 'binaries/windows-x86_64/' + name)
        if data != f.read(froot + 'bin/' + name):
            sys.exit(f'{name} у Flowseal не совпал с релизом bol-van {ZAPRET[0]}: пресеты проверены на другом winws')
        put('bin/' + name, data)
    for n in f.namelist():
        if n.startswith(froot + 'bin/') and n.endswith('.bin'):
            put('bin/' + n.rsplit('/', 1)[1], f.read(n))
        if n.startswith(froot + 'lists/') and n.endswith('.txt'):
            put('lists/' + n.rsplit('/', 1)[1], f.read(n))

    presets = []
    for n in sorted((n for n in f.namelist() if n.endswith('.bat') and '/service' not in n and n.count('/') == 1),
                    key=lambda n: (n.rsplit('/', 1)[1] != 'general.bat', natural(n.rsplit('/', 1)[1][:-4].replace(')', '')))):
        args = preset_args(f.read(n).decode('utf-8', 'replace'))
        if not args:
            continue
        name = n.rsplit('/', 1)[1][:-4]
        for ref in re.findall(r'\{BIN\}([^,\s]+)|\{LISTS\}([^,\s]+)', ' '.join(args)):
            rel = ('bin/' + ref[0]) if ref[0] else ('lists/' + ref[1])
            if rel not in files and not rel.endswith('-user.txt'):
                sys.exit(f'{name}: нет файла {rel}')
        presets.append({'id': name, 'name': name, 'args': args})
    if not presets or presets[0]['id'] != 'general':
        sys.exit('нет пресета general')
    put('presets.json', json.dumps({'default': 'general', 'presets': presets}, ensure_ascii=False, indent=1).encode())

    lic = f"""Обход блокировок zapret в программах Cloud VPN

winws {ZAPRET[0]} — bol-van/zapret, MIT License, Copyright (c) 2016-2026 bol-van. https://github.com/bol-van/zapret
Стратегии, фейковые пакеты и списки {FLOWSEAL[0]} — Flowseal/zapret-discord-youtube, MIT License,
Copyright (c) 2016-2026 bol-van, Copyright (c) 2024-2026 Flowseal. https://github.com/Flowseal/zapret-discord-youtube

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

WinDivert (WinDivert.dll, WinDivert64.sys) — basil00/WinDivert, LGPL-3.0 или GPL-2.0 на выбор; файлы без изменений,
исходники: https://github.com/basil00/WinDivert
cygwin1.dll — Cygwin, LGPL-3.0; исходники: https://cygwin.com/git/newlib-cygwin.git
"""
    put('LICENSES.txt', lic.encode())
    if a.zapretctl:
        put('zapretctl.exe', open(a.zapretctl, 'rb').read())
    manifest = {'bundle': BUNDLE, 'version': f'zapret {ZAPRET[0]} + Flowseal {FLOWSEAL[0]}', 'files': files}
    with open(os.path.join(a.out, 'bundle.json'), 'w', encoding='utf-8') as out:
        json.dump(manifest, out, ensure_ascii=False, indent=1)
    print(f'zapret: пакет {BUNDLE}, {manifest["version"]}, пресетов {len(presets)}, файлов {len(files)}')


if __name__ == '__main__':
    main()
