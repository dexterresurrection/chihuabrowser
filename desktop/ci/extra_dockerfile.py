#!/usr/bin/env python3
"""The published build image ghcr.io/telegramdesktop/tdesktop/centos_env:latest lacks libraries that newer
tdesktop tags need (ada, tde2e, tdesktop_rust). This writes a Dockerfile that adds exactly those stages, taken
from the tag's own Telegram/build/docker/centos_env/Dockerfile, on top of the published image:

    extra_dockerfile.py <tdesktop checkout> <out Dockerfile> [stage …]
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
want = sys.argv[3:] or ['ada', 'tde2e', 'tdesktop_rust']
text = open(f'{src}/Telegram/build/docker/centos_env/Dockerfile').read()
# minimal Jinja rendering of the template parts used by these stages
text = text.replace('{{ JOBS or "default" }}', 'default')
text = re.sub(r"\{% if MINSIZE %\}'z'\{% else %\}3\{% endif %\}", '3', text)
text = re.sub(r"\{% if LTO %\}thin\{% else %\}off\{% endif %\}", 'off', text)
if '{%' in ''.join(text.split('FROM builder AS')[1:2]):
    pass
stages = {}
for m in re.finditer(r'^FROM (\S+) AS (\S+)\n(.*?)(?=^FROM )', text, re.S | re.M):
    stages[m.group(2)] = (m.group(1), m.group(3))
need = ['patches'] + [s for s in want if s in stages]
missing = [s for s in want if s not in stages]
if missing:
    sys.exit(f'no stages {missing} in the Dockerfile')
parts = ['# syntax=docker/dockerfile:1',
         'FROM ghcr.io/telegramdesktop/tdesktop/centos_env:latest AS builder',
         'USER root',
         'SHELL ["/bin/bash", "-euo", "pipefail", "-c"]',
         'WORKDIR /usr/src', '']
for name in need:
    base, body = stages[name]
    if '{%' in body or '{{' in body:
        sys.exit(f'unrendered template in stage {name}')
    # COPY of other caches: the published image already has zlib, openssl… installed
    body = '\n'.join(l for l in body.splitlines() if not l.startswith('COPY --link --from='))
    parts.append(f'FROM {base} AS {name}\n{body}\n')
parts.append('FROM builder')
for name in want:
    parts.append(f'COPY --link --from={name} /usr/src/{name}-cache /')
parts += ['USER user', 'WORKDIR /usr/src/tdesktop', '']
open(out, 'w').write('\n'.join(parts))
print('stages:', ', '.join(need))
