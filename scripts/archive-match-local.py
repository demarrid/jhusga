import json,re,unicodedata,difflib
from collections import defaultdict
from pathlib import Path
BASE=Path('.archive-local');ROOT=Path('/mnt/c/Real/College/2026-2027/SGA/JHU SGA Past Documents')
inv=json.loads((BASE/'past-drive-inventory.json').read_text());rootname=inv['root']['name']
mapping={'Historical Documents':'morris','JHU SGA (2015-2016)':'2015-2016','JHU SGA (2019-2020)':'2019-2020'}
def norm(s):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).lower())
def stem(s):return norm(re.sub(r'\.(docx?|pdf|pptx?|xlsx?|csv|png|jpe?g|pages|zip|cr2|mp4|html?)$','',s,flags=re.I))
def localpath(p):
    parts=list(p.relative_to(ROOT).parts);parts[0]=mapping.get(parts[0],parts[0]);return parts
local=[]
for p in ROOT.rglob('*'):
    if not p.is_file() or re.search('trainers?[ _-]*feedback',str(p),re.I):continue
    parts=localpath(p);local.append({'localPath':str(p),'relative':str(p.relative_to(ROOT)),'parts':parts,'name':p.name,'extension':p.suffix.lower(),'key':'/'.join(norm(v) for v in parts[:-1])+'/'+stem(p.name)})
bykey=defaultdict(list);byname=defaultdict(list)
for l in local:
    bykey[l['key']].append(l);byname[(norm(l['parts'][0]),stem(l['name']))].append(l)
matched=[];unmatched=[];used=set()
for f in inv['files']:
    if re.search('trainers?[ _-]*feedback',f['folderPath']+'/'+f['name'],re.I):continue
    folders=f['folderPath'].split('/');folders=folders[1:] if folders[0]==rootname else folders
    key='/'.join(norm(v) for v in folders)+'/'+stem(f['name'])
    expected={'application/vnd.google-apps.document':'.docx','application/vnd.google-apps.spreadsheet':'.xlsx','application/vnd.google-apps.presentation':'.pptx'}.get(f['mimeType'],Path(f['name']).suffix.lower())
    def compatible(rows):
        same=[l for l in rows if l['extension']==expected]
        return same if same else rows
    candidates=compatible(bykey[key]);method='normalized-path-and-type'
    if len(candidates)!=1:
        candidates=compatible(byname[(norm(folders[0]) if folders else '',stem(f['name']))]);method='unique-name-and-type-in-collection'
    if len(candidates)==1:
        l=candidates[0];matched.append({**f,**l,'matchMethod':method});used.add(l['localPath'])
    else:unmatched.append(f)
(BASE/'past-matches.json').write_text(json.dumps(matched,indent=2));(BASE/'past-unmatched-drive.json').write_text(json.dumps(unmatched,indent=2));(BASE/'past-unmatched-local.json').write_text(json.dumps([l for l in local if l['localPath'] not in used],indent=2))
print({'local':len(local),'drive':len(inv['files']),'matched':len(matched),'unmatchedDrive':len(unmatched),'unmatchedLocal':len(local)-len(used)})
print('Unmatched Drive examples:',[(f['name'],f['folderPath']) for f in unmatched[:25]])
