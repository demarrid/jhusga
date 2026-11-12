import hashlib,json
from pathlib import Path
base=Path('.archive-local');local=json.loads((base/'past-unmatched-local.json').read_text());cloud=json.loads((base/'unmatched-checksums.json').read_text());matches=json.loads((base/'past-matches.json').read_text());hashes={}
extra=Path('/mnt/c/Real/College/2026-2027/SGA/Board of Trustees Resolution_final.pdf')
if extra.exists():local.append({'localPath':str(extra),'relative':extra.name,'name':extra.name,'extension':extra.suffix,'parts':[extra.name]})
for f in local:
    h=hashlib.md5()
    with open(f['localPath'],'rb') as stream:
        while chunk:=stream.read(1024*1024):h.update(chunk)
    hashes.setdefault(h.hexdigest(),[]).append(f)
added=[];unmatched=[]
for f in cloud:
    if any(m['id']==f['id'] for m in matches):continue
    candidates=hashes.get(f.get('md5Checksum'),[])
    if candidates:
        # Identical bytes establish the source even when several local copies exist.
        match={**f,**candidates[0],'matchMethod':'verified-md5'};matches.append(match);added.append(match)
    else:unmatched.append(f)
(base/'past-matches.json').write_text(json.dumps(matches,indent=2));(base/'checksum-added.json').write_text(json.dumps(added,indent=2));(base/'unmatched-after-checksum.json').write_text(json.dumps(unmatched,indent=2))
print({'addedByChecksum':len(added),'matchedTotal':len(matches),'unmatched':len(unmatched)})
print([(f['name'],f.get('mimeType'),f.get('size')) for f in unmatched])
