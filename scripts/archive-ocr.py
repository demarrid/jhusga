"""Resumable local archive OCR; original files and review reports stay outside Git."""
import argparse, concurrent.futures as futures, hashlib, json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path
BASE = Path(__file__).resolve().parents[1] / '.archive-local'
sys.path.insert(0, str(BASE / 'python'))
VERSION = 'rapidocr-v2-columns'
ENGINE = None

def save(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temp.replace(path)

def key():
    if os.environ.get('GOOGLE_API_KEY'): return os.environ['GOOGLE_API_KEY']
    for line in (BASE.parent / '.env').read_text().splitlines():
        if line.startswith('GOOGLE_API_KEY='): return line.split('=',1)[1].strip().strip('\"\'')
    raise RuntimeError('GOOGLE_API_KEY missing')

def download(file):
    # One cross-process download at a time. OCR can still use many CPU workers.
    import fcntl
    with (BASE / 'download.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        dest = BASE / 'originals' / file['id']
        stamp = dest.with_suffix('.json')
        cached = dest.exists() and stamp.exists() and json.loads(stamp.read_text()).get('modifiedTime') == file['modifiedTime']
        if cached: return dest
        if os.environ.get('ARCHIVE_OFFLINE') == '1': raise RuntimeError('Pending download; offline processing')
        if (BASE / 'download-throttled.json').exists(): raise RuntimeError('Downloads stopped after Google throttling; resume later')
        time.sleep(3)
        return download_unlocked(file)

def download_unlocked(file):
    dest = BASE / 'originals' / file['id']; stamp = dest.with_suffix('.json')
    if dest.exists() and stamp.exists() and json.loads(stamp.read_text()).get('modifiedTime') == file['modifiedTime']: return dest
    from urllib.parse import urlencode
    url = 'https://www.googleapis.com/drive/v3/files/' + file['id'] + '?' + urlencode({'alt':'media','key':key()})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                temp = dest.with_suffix('.part')
                with temp.open('wb') as output:
                    while chunk := response.read(1024*1024): output.write(chunk)
                temp.replace(dest)
            save(stamp, {'modifiedTime':file['modifiedTime']}); return dest
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf8', errors='replace')
            throttled = error.code == 429 or (error.code == 403 and any(term in body for term in ('automated queries','rateLimitExceeded','userRateLimitExceeded','downloadQuotaExceeded')))
            if throttled:
                save(BASE/'download-throttled.json', {'at':time.time(), 'fileId':file['id'], 'status':error.code})
                raise RuntimeError('Google download throttling; requests stopped, resume later') from None
            if error.code not in (500,502,503,504): raise RuntimeError(f'Download HTTP {error.code}') from None
        except (TimeoutError, OSError):
            if attempt == 4: raise RuntimeError('Download connection failed') from None
        time.sleep(2**attempt)
    raise RuntimeError('Download retries exhausted')

def flags(text):
    rules = {
      'possible government identifier': r'\b\d{3}-\d{2}-\d{4}\b|\bsocial security\b',
      'contact details': r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b',
      'possible address': r'\b\d{1,5}\s+(?:\w+\s+){1,4}(?:street|avenue|road|lane|drive|apt\.?|apartment)\b',
      'student records or disciplinary material': r'\b(student (?:id|number)|grades?|gpa|disciplin\w*|expuls\w*|suspend\w*|academic probation)\b',
      'medical or personal allegations': r'\b(diagnos\w*|medical record|mental health|sexual assault|harass\w*|allegation|suicid\w*)\b',
      'financial account details': r'\b(bank account|routing number|credit card|account number)\b',
      'restricted or private marking': r'\b(confidential|private|executive session|personnel|not for distribution)\b',
    }
    return [label for label, pattern in rules.items() if re.search(pattern,text,re.I)]

def process(file):
    global ENGINE
    out = BASE / 'text' / (file['id']+'.json')
    if out.exists():
        cached = json.loads(out.read_text())
        if cached.get('version')==VERSION and cached.get('modifiedTime')==file['modifiedTime'] and cached.get('status')=='complete' and cached.get('rotation',0)==file.get('rotation',0): return cached
    try:
        source = download(file)
        from PIL import Image, ImageOps
        from pillow_heif import register_heif_opener
        import numpy as np
        register_heif_opener()
        if ENGINE is None:
            from rapidocr_onnxruntime import RapidOCR
            ENGINE = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1, det_limit_side_len=1600)
        pages=[]
        def recognize(image):
            image = ImageOps.exif_transpose(image).convert('RGB')
            if file.get('rotation'): image=image.rotate(file['rotation'],expand=True)
            image.thumbnail((2600,2600))
            result, _ = ENGINE(np.asarray(image))
            lines = [{'text':r[1], 'confidence':float(r[2]), 'box':r[0]} for r in (result or [])]
            # A persistent central gutter separates facing pages. Require enough
            # lines on each side and almost no lines spanning it before splitting.
            middle=image.width/2
            left=[r for r in lines if max(p[0] for p in r['box']) < middle+image.width*.025]
            right=[r for r in lines if min(p[0] for p in r['box']) > middle-image.width*.025]
            split=len(left)>8 and len(right)>8 and len(left)+len(right)>=len(lines)*.92
            if split:
                left.sort(key=lambda r:min(p[1] for p in r['box']))
                right.sort(key=lambda r:min(p[1] for p in r['box']))
                other=[r for r in lines if r not in left and r not in right]
                text='### Left page or column\n\n'+'\n'.join(r['text'] for r in left)+'\n\n### Right page or column\n\n'+'\n'.join(r['text'] for r in right)
                if other: text+='\n\n### Other visible text\n\n'+'\n'.join(r['text'] for r in other)
            else: text='\n'.join(r['text'] for r in lines)
            return {'text':text, 'lines':lines, 'method':'local OCR', 'splitColumns':split}
        if file['mimeType']=='application/pdf' or file['name'].lower().endswith('.pdf'):
            import pymupdf
            with pymupdf.open(source) as doc:
                for page in doc:
                    text = page.get_text().strip()
                    if len(text)>80: pages.append({'text':text,'lines':[], 'method':'embedded text'})
                    else:
                        pix=page.get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False)
                        pages.append(recognize(Image.frombytes('RGB',(pix.width,pix.height),pix.samples)))
        elif file['mimeType'].startswith('image/'):
            with Image.open(source) as image:
                for frame in range(getattr(image,'n_frames',1)):
                    image.seek(frame); pages.append(recognize(image.copy()))
        else: raise RuntimeError('Unsupported MIME type: '+file['mimeType'])
        text='\n\n'.join('## Page '+str(i+1)+'\n\n'+p['text'] for i,p in enumerate(pages))
        scores=[line['confidence'] for p in pages for line in p['lines']]; quality=[]
        if not any(p['text'].strip() for p in pages): quality.append('No text recognized')
        if scores and sum(s<0.8 for s in scores)/len(scores)>0.1: quality.append('Low-confidence OCR lines')
        result={**file,'version':VERSION,'status':'complete','sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'content':text,'pages':pages,'flags':flags(text),'quality':quality}
    except Exception as error:
        result={**file,'version':VERSION,'status':'error','error':type(error).__name__+': '+str(error).split('?')[0][:200]}
    save(out,result); return result

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--workers',type=int,default=4); parser.add_argument('--limit',type=int); parser.add_argument('--inventory',default='inventory.json'); parser.add_argument('--offline',action='store_true'); parser.add_argument('--resume-downloads',action='store_true'); args=parser.parse_args()
    if args.offline: os.environ['ARCHIVE_OFFLINE']='1'
    if args.resume_downloads: (BASE/'download-throttled.json').unlink(missing_ok=True)
    for folder in ('originals','text'): (BASE/folder).mkdir(parents=True,exist_ok=True)
    inventory=json.loads((BASE/args.inventory).read_text()); files=inventory['files'][:args.limit]; results=[]
    with futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        jobs={pool.submit(process,f):f for f in files}
        for job in futures.as_completed(jobs):
            result=job.result(); results.append(result)
            print(f'{len(results)}/{len(files)} {result["name"]}: {result["status"]}',flush=True)
            save(BASE/'progress.json',{'total':len(files),'processed':len(results),'errors':sum(r['status']=='error' for r in results)})
    report=[{k:r.get(k) for k in ('id','name','webViewLink','status','flags','quality','error')} for r in results]
    save(BASE/'review.json',report)
    rows=['# Archive review','', 'Automated leads, not determinations. OCR and pattern matching can miss sensitive content. Review original images, including handwriting and signatures.','']
    rows += [f"Completed: {sum(r['status']=='complete' for r in report)} / {len(report)}. Pending or failed: {sum(r['status']!='complete' for r in report)}.", '']
    for heading, field in [('Possible sensitive information','flags'), ('OCR quality review','quality'), ('Pending downloads or processing errors','error')]:
        rows += ['## '+heading,'']
        for r in sorted(report,key=lambda r:r['name']):
            labels=r.get(field)
            if not labels: continue
            if isinstance(labels,str): labels=[labels]
            url=r['webViewLink'] or 'https://drive.google.com/file/d/'+r['id']+'/view'
            rows.append(f'- [{r["name"]}]({url}): '+ '; '.join(labels))
        rows.append('')
    (BASE/'REVIEW.md').write_text('\n'.join(rows))
    print(json.dumps({'files':len(results),'errors':sum(r['status']=='error' for r in results),'flagged':sum(bool(r.get('flags')) for r in results),'qualityReview':sum(bool(r.get('quality')) for r in results)}))

if __name__=='__main__': main()





