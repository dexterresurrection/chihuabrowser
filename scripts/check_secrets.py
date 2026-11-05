#!/usr/bin/env python3
"""Fails if anything that looks like a credential is in the tree. Runs before every push and in CI."""
import os
import re
import subprocess
import sys

PATTERNS = {
    "GitHub token": r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}",
    "private key": r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY",
    "AWS key": r"\bAKIA[0-9A-Z]{16}\b",
    "Telegram bot token": r"\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b",
    "Slack token": r"\bxox[abprs]-[A-Za-z0-9-]{10,}",
    "API key": r"\bsk-[A-Za-z0-9_-]{32,}\b",
    "password in a URL": r"[a-z][a-z0-9+.-]*://[A-Za-z0-9._%-]+:[A-Za-z0-9._%!-]{6,}@(?!example|host|localhost|proxy\.example|gw\.example)[a-z0-9.-]+\.[a-z]{2,}",
    "assigned secret": r"(?i)\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*[\"'][A-Za-z0-9+/_=-]{24,}[\"']",
}
SKIP = re.compile(r"(^|/)(pnpm-lock\.yaml|Cargo\.lock|LICENSE)$|\.(png|jpg|ico|icns|woff2?|ttf)$|^scripts/check_secrets\.py$")
FORBIDDEN_FILES = re.compile(r"(^|/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.keystore|.*\.jks|id_rsa|id_ed25519|credentials\.json)$")

files = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], capture_output=True, text=True, check=True).stdout.split("\n")
bad = []
for path in filter(None, files):
    if FORBIDDEN_FILES.search(path):
        bad.append((path, 0, "file that must not be in the repository"))
        continue
    if SKIP.search(path) or not os.path.isfile(path):
        continue
    try:
        text = open(path, encoding="utf8").read()
    except UnicodeDecodeError:
        continue
    for name, pattern in PATTERNS.items():
        for m in re.finditer(pattern, text):
            line = text.count("\n", 0, m.start()) + 1
            if "#[cfg(test)]" in text[: m.start()] or "/tests/" in path or path.endswith((".test.mjs", ".test.ts")):
                continue
            bad.append((path, line, name))
for path, line, name in bad:
    print(f"{path}:{line}: {name}")
print(f"{len(bad)} problem(s) in {len(files)} files")
sys.exit(1 if bad else 0)
