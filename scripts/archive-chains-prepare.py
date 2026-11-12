"""Build document chains from the report's explicit start markers; optional --limit."""
import hashlib,json,re,shutil,sys,argparse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int);args=parser.parse_args()
base=Path('.archive-local')
sys.path.insert(0,str(base/'python'))
from PIL import Image,ImageOps
from pillow_heif import register_heif_opener
register_heif_opener()
local=Path('/mnt/c/Real/College/2026-2027/SGA/Selections of JHU Student Council Archives-1-001/Selections of JHU Student Council Archives')
report=json.loads((base/'grouping-report.json').read_text())
inventory=json.loads((base/'inventory.json').read_text()); byname={f['name']:f for f in inventory['files']}
starts=[]
for line in report['content'].splitlines():
    if not line.startswith('|'):continue
    cells=[v.strip() for v in line.split('|')[1:-1]]
    if len(cells)!=4:continue
    match=re.search(r'IMG\\?_(\d+)\.HEIC',cells[3])
    if match: starts.append({'title':re.sub(r'\\([_\-])',r'\1',cells[0]),'dateLabel':cells[1], 'start':int(match[1]),'startFileId':re.search(r'/d/([^/]+)/',cells[3])[1],'reportSource':report['source']})
assert len(starts)>20
assert all(a['start']<b['start'] for a,b in zip(starts,starts[1:])), 'Nonsequential report starts'
groups=[];files=[];verified=0
for index,start in enumerate(starts[:args.limit]):
    last=max(int(re.search(r'IMG_(\d+)',n)[1]) for n in byname if re.match(r'IMG_\d+\.HEIC$',n))
    group={**start,'end':starts[index+1]['start']-1 if index+1<len(starts) else last,'files':[]}
    for number in range(group['start'],group['end']+1):
        name=f'IMG_{number}.HEIC'
        if name not in byname:
            # Retain explicit missing-image evidence; never silently bridge a hole.
            group.setdefault('missingImages',[]).append(name);continue
        file=dict(byname[name]);source=local/name
        assert source.is_file(), f'Missing local image: {name}'
        dest=base/'originals'/file['id']
        digest=hashlib.sha256(source.read_bytes()).hexdigest()
        if dest.exists():
            assert hashlib.sha256(dest.read_bytes()).hexdigest()==digest, f'Local/Drive mismatch: {name}'
            verified+=1
        else: shutil.copyfile(source,dest)
        dest.with_suffix('.json').write_text(json.dumps({'modifiedTime':file['modifiedTime'],'localSource':str(source),'sha256':digest}))
        # This reviewed batch's landscape photos are quarter-turned counterclockwise.
        # Rotate clockwise for OCR; retain source bytes unchanged.
        with Image.open(source) as raw:
            upright=ImageOps.exif_transpose(raw)
            if upright.width>upright.height:file['rotation']=-90
        group['files'].append(file);files.append(file)
    assert group['files'][0]['id']==group['startFileId'], 'Report/Drive first-image mismatch'
    groups.append(group)
(base/'chains-plan.json').write_text(json.dumps(groups,indent=2))
(base/'chains-inventory.json').write_text(json.dumps({**inventory,'files':files},indent=2))
print(json.dumps({'documents':len(groups),'images':len(files),'matchedDownloadedOriginals':verified,'first':groups[0]['start'],'last':groups[-1]['end']}))


