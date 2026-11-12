import json,hashlib,zipfile,re
from pathlib import Path
base=Path('.archive-local');pending=json.loads((base/'unmatched-after-checksum.json').read_text());byhash={f.get('md5Checksum'):f for f in pending if f.get('md5Checksum')};matches=json.loads((base/'past-matches.json').read_text());dest=base/'materialized';dest.mkdir(exist_ok=True);added=[]
root=Path('/mnt/c/Real/College/2026-2027/SGA/JHU SGA Past Documents')
for p in root.rglob('*.zip'):
    if re.search(r'trainers?[ _-]*feedback',str(p),re.I):continue
    with zipfile.ZipFile(p) as z:
        for info in z.infolist():
            if info.is_dir() or info.file_size>20_000_000:continue
            data=z.read(info);f=byhash.get(hashlib.md5(data).hexdigest())
            if not f or any(m['id']==f['id'] for m in matches):continue
            target=dest/(f['id']+Path(f['name']).suffix);target.write_bytes(data)
            match={**f,'localPath':str(target.resolve()),'relative':str(p.relative_to(root))+'!'+info.filename,'extension':target.suffix,'matchMethod':'verified-zip-entry-md5'};matches.append(match);added.append(f['name'])
(base/'past-matches.json').write_text(json.dumps(matches,indent=2));print({'matchedZipEntries':added})
