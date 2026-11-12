import json,hashlib,collections
from pathlib import Path
base=Path('.archive-local');tasks=json.loads((base/'native-vision-tasks.json').read_text());groups={}
for t in tasks:
    key=hashlib.sha256(Path(t['imagePath']).read_bytes()).hexdigest()+'|'+t['title'];groups.setdefault(key,[]).append(t)
unique=[v[0] for v in groups.values()];aliases={v[0]['id']:[t['id'] for t in v[1:]] for v in groups.values() if len(v)>1}
(base/'native-vision-unique.json').write_text(json.dumps(unique,indent=2));(base/'native-vision-aliases.json').write_text(json.dumps(aliases,indent=2))
print({'pages':len(tasks),'unique':len(unique),'duplicates':len(tasks)-len(unique)})
print(collections.Counter(t['title'] for t in tasks).most_common(8))
