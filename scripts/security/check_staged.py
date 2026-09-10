#!/usr/bin/env python3
"""Inspect exactly the index before every commit. Never print matched secret values."""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def git(*args):
    return subprocess.check_output(['git','-C',str(ROOT),*args])

def check(all_tracked=False, secret_files=()):
    names=git('ls-files','-z') if all_tracked else git('diff','--cached','--name-only','--diff-filter=ACMR','-z')
    patterns={
        'private key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'Google API key':rb'AIza[0-9A-Za-z_-]{35}',
        'GitHub token':rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',
        'AWS access key':rb'(?:AKIA|ASIA)[A-Z0-9]{16}',
        'Slack token':rb'xox[baprs]-[A-Za-z0-9-]{20,}',
        'Meta token':rb'EA[A-Za-z0-9]{80,}',
        'JWT token':rb'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',
        'credential URL':rb'(?i)(?:postgres(?:ql)?(?:\+psycopg)?|mysql)://[^\s:@]+:[^\s@${}]+@',
    }
    values=[]
    for filename in secret_files:
        for line in Path(filename).read_text().splitlines():
            if '=' not in line or line.lstrip().startswith('#'): continue
            key,value=line.split('=',1);value=value.strip().strip('\"\'')
            if re.search(r'(?i)(secret|token|password|api_key|private_key)',key) and len(value)>=8 and not re.search(r'(?i)(replace|example|demo|placeholder|your_)',value):
                values.append(value.encode())
    issues=[]
    for raw in names.split(b'\0'):
        if not raw: continue
        name=raw.decode();base=Path(name).name.lower()
        # The root README is published on explicit operator instruction and is
        # written to say what the product does and nothing about how. It is
        # still scanned for secrets below like any other file; only the
        # filename rule is waived, and only for this exact path.
        if name=='README.md':
            data=git('show',':'+name)
            for reason,pattern in patterns.items():
                if re.search(pattern,data):issues.append((name,reason))
            if any(value in data for value in values):issues.append((name,'matches local secret value'))
            continue
        if base.startswith(('readme','.env')) or re.search(r'\.env(?:\.|$)',base) or base.endswith(('.pem','.key','.p12','.pfx')) or re.search(r'(service[-_]account|credentials).*\.json$',base):
            issues.append((name,'forbidden private/README filename'));continue
        data=git('show',':'+name)
        for reason,pattern in patterns.items():
            if re.search(pattern,data):issues.append((name,reason))
        if any(value in data for value in values):issues.append((name,'matches local secret value'))
    for name,reason in issues:print(f'BLOCKED {name}: {reason}')
    if issues:return 1
    print(f'Sensitive-data check passed ({"tracked" if all_tracked else "staged"} files; values redacted).')
    return 0

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--all-tracked',action='store_true');p.add_argument('--secret-file',action='append',default=[])
    a=p.parse_args();sys.exit(check(a.all_tracked,a.secret_file))
