#!/usr/bin/env python3
"""Run one of our workflows on GitHub runners from a temporary branch of the public Chihua repository
(same practice as the other apps' Windows/emulator checks):

    tools/ci_run.py <workflow.yml> <out dir> [--wait-min 240] [--keep] [--extra path=src ...]

The branch holds only this repository's own files (android/, desktop/, tools/, VERSION) and the chosen workflow;
no secrets ever go there. Waits for the run, downloads every artifact into <out dir>, deletes the branch.
The token is read from /root/chihua.txt and only goes into the Authorization header and git's credential helper.
"""
import io
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

REPO = 'dexterresurrection/chihuabrowser'
TOKFILE = '/root/chihua.txt'
HELPER = '!f() { echo username=x-access-token; echo "password=$(cat /root/chihua.txt)"; }; f'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ['android', 'desktop', 'tools', 'brand', 'VERSION', 'README.md']


class NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.remove_header('Authorization')
        return new


urllib.request.install_opener(urllib.request.build_opener(NoAuthRedirect))


def api(path, raw=False, method='GET'):
    tok = open(TOKFILE).read().strip()
    url = path if path.startswith('http') else f'https://api.github.com/repos/{REPO}{path}'
    req = urllib.request.Request(url, method=method, headers={
        'Authorization': 'Bearer ' + tok, 'User-Agent': 'gram-ci', 'Accept': 'application/vnd.github+json'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                body = r.read()
                return body if raw else (json.loads(body) if body else {})
        except urllib.error.URLError as e:
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 or attempt == 5:
                raise
            time.sleep(20)


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    wf, out = args[0], args[1]
    wait_min = int(args[args.index('--wait-min') + 1]) if '--wait-min' in args else 240
    keep = '--keep' in args
    tag = secrets.token_hex(6)
    branch = f'ci-gram-{tag}'
    work = tempfile.mkdtemp(prefix='gramci-', dir=os.environ.get('CI_TMP'))
    pushed = False
    try:
        for name in INCLUDE:
            src = os.path.join(HERE, name)
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(work, name), ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'upstream'))
            elif os.path.exists(src):
                shutil.copy(src, os.path.join(work, name))
        if os.path.isdir(os.path.join(HERE, '.github/actions')):
            shutil.copytree(os.path.join(HERE, '.github/actions'), os.path.join(work, '.github/actions'))
        os.makedirs(os.path.join(work, '.github/workflows'), exist_ok=True)
        shutil.copy(os.path.join(HERE, '.github/workflows', wf), os.path.join(work, '.github/workflows', wf))
        g = ['git', '-C', work, '-c', 'user.name=CloudVPN CI', '-c', 'user.email=dexterresurrection@users.noreply.github.com']
        subprocess.run(['git', 'init', '-q', '-b', branch, work], check=True)
        subprocess.run(g + ['add', '-A'], check=True)
        subprocess.run(g + ['commit', '-q', '-m', f'temporary CI run: {wf}'], check=True)
        head = subprocess.run(['git', '-C', work, 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
        subprocess.run(g + ['-c', f'credential.helper={HELPER}', 'push', '-q', f'https://github.com/{REPO}.git',
                            f'HEAD:refs/heads/{branch}'], check=True)
        pushed = True
        print('branch', branch, head[:8], flush=True)
        run = None
        deadline = time.time() + wait_min * 60
        last = ''
        while time.time() < deadline:
            time.sleep(60)
            runs = api(f'/actions/runs?branch={branch}&per_page=5')['workflow_runs']
            run = next((r for r in runs if r['head_sha'] == head), None)
            if run:
                jobs = api(f"/actions/runs/{run['id']}/jobs?per_page=50")['jobs']
                st = ' | '.join(f"{j['name']}:{j['status'][:4]}/{(j['conclusion'] or '-')[:4]}" for j in jobs)
                if st != last:
                    print(time.strftime('%H:%M'), 'run', run['id'], st, flush=True)
                    last = st
                if run['status'] == 'completed':
                    break
        if not run:
            print('no run appeared')
            return 2
        print('run', run['id'], run['status'], run['conclusion'], run['html_url'], flush=True)
        os.makedirs(out, exist_ok=True)
        for job in api(f"/actions/runs/{run['id']}/jobs?per_page=50")['jobs']:
            if job['conclusion'] not in ('success', 'skipped'):
                try:
                    log = api(f"/actions/jobs/{job['id']}/logs", raw=True)
                    open(os.path.join(out, f"log-{job['name'].replace('/', '_').replace(' ', '_')}.txt"), 'wb').write(log)
                except Exception as e:  # noqa: BLE001
                    print('log of', job['name'], 'not available:', e)
        for a in api(f"/actions/runs/{run['id']}/artifacts?per_page=100")['artifacts']:
            z = zipfile.ZipFile(io.BytesIO(api(a['archive_download_url'], raw=True)))
            dst = os.path.join(out, a['name'])
            z.extractall(dst)
            print('artifact', a['name'], '→', dst, flush=True)
        return 0 if run['conclusion'] == 'success' else 1
    finally:
        if pushed and not keep:
            try:
                api(f'/git/refs/heads/{branch}', method='DELETE')
                print('branch deleted')
            except Exception as e:  # noqa: BLE001
                print('could not delete the branch:', e)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
