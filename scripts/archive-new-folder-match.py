"""Match an explicitly authorized new Drive folder to its local copy by MD5.

Usage: python3 scripts/archive-new-folder-match.py INVENTORY LOCAL_DIR PREFIX
Writes .archive-local/PREFIX-matches.json (files with localPath) and
PREFIX-unmatched.json (Drive files with no byte-identical local copy).
"""
import hashlib, json, sys, time, urllib.request
from pathlib import Path
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parents[1] / '.archive-local'


def md5(path):
    digest = hashlib.md5()
    with open(path, 'rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def api_key():
    for line in (BASE.parent / '.env').read_text().splitlines():
        if line.startswith('GOOGLE_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"\'')
    raise RuntimeError('GOOGLE_API_KEY missing')


def metadata(file_id, key):
    url = f'https://www.googleapis.com/drive/v3/files/{file_id}?' + urlencode({'fields': 'id,md5Checksum,size', 'key': key})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return json.load(response)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def main():
    inventory, local_dir, prefix = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    files = json.loads(inventory.read_text())['files']
    key = api_key()
    local = {}
    for path in local_dir.rglob('*'):
        if path.is_file():
            local.setdefault(md5(path), []).append(path)
    matched, unmatched = [], []
    for f in files:
        meta = metadata(f['id'], key)
        f['md5Checksum'] = meta.get('md5Checksum')
        candidates = local.get(f['md5Checksum'] or '', [])
        if candidates:
            matched.append({**f, 'localPath': str(candidates[0]), 'matchMethod': 'verified-md5'})
        else:
            unmatched.append(f)
    (BASE / f'{prefix}-matches.json').write_text(json.dumps(matched, indent=2))
    (BASE / f'{prefix}-unmatched.json').write_text(json.dumps(unmatched, indent=2))
    print(json.dumps({'drive': len(files), 'localFiles': sum(map(len, local.values())), 'matched': len(matched), 'unmatched': [f['name'] for f in unmatched]}))


if __name__ == '__main__':
    main()
