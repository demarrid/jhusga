"""Extract local office/PDF documents; queue only scanned/image pages for vision review."""
import os
from html.parser import HTMLParser
import argparse,concurrent.futures as futures,csv,hashlib,importlib.util,io,json,re,subprocess,sys,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
BASE=Path(__file__).resolve().parents[1]/'.archive-local';sys.path.insert(0,str(BASE/'python'))
from PIL import Image,ImageOps
import pymupdf
spec=importlib.util.spec_from_file_location('local_ocr',Path(__file__).with_name('archive-ocr.py'));ocr=importlib.util.module_from_spec(spec);spec.loader.exec_module(ocr)
VERSION='local-native-v1'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}';A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
def table(rows):
    rows=[[('' if v is None else str(v)).replace('|','\\|').replace('\n',' / ') for v in row] for row in rows]
    if not rows:return ''
    width=max(map(len,rows));rows=[row+['']*(width-len(row)) for row in rows]
    return '\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*width)+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]])
def word_text(data):
    root=ET.fromstring(data);body=root.find(W+'body');parts=[]
    if body is None:return ''
    for node in body:
        if node.tag==W+'p':
            text=''.join(n.text or '' for n in node.iter(W+'t'))
            if text.strip():
                style=node.find('.//'+W+'pStyle');value=style.get(W+'val','') if style is not None else ''
                match=re.match(r'Heading(\d)',value,re.I)
                parts.append(('#'*min(6,int(match[1]))+' ' if match else '')+text)
        elif node.tag==W+'tbl':parts.append(table([[''.join(n.text or '' for n in cell.iter(W+'t')) for cell in row.findall(W+'tc')] for row in node.findall(W+'tr')]))
    return '\n\n'.join(parts)
def task_for_image(file,number,image,ocr_text=''):
    identity=file['id']+'-p'+str(number);dest=BASE/'page-images'/(identity+'.jpg')
    image=ImageOps.exif_transpose(image).convert('RGB');image.thumbnail((2800,2800));image.save(dest,quality=92)
    hint=BASE/'page-images'/(identity+'.json');hint.write_text(json.dumps({'content':ocr_text}))
    return {'id':identity,'imagePath':str(dest),'ocrPath':str(hint),'title':file['name'],'name':file['name']+' page '+str(number)}
def pdf_parts(file,data):
    parts=[];tasks=[]
    with pymupdf.open(stream=data,filetype='pdf') as doc:
        for number,page in enumerate(doc,1):
            text=page.get_text(sort=True).strip();letters=sum(c.isalpha() for c in text)
            area=page.rect.width*page.rect.height
            image_layer=any((i['bbox'][2]-i['bbox'][0])*(i['bbox'][3]-i['bbox'][1])>.65*area for i in page.get_image_info())
            if not image_layer and letters>=80 and text.count('\ufffd')<3:parts.append({'content':text,'method':'embedded PDF text'})
            else:
                pix=page.get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False)
                image=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
                task=task_for_image(file,number,image,text);tasks.append(task);parts.append({'visionId':task['id'],'content':text,'method':'scanned PDF page'})
    return parts,tasks

def process(file):
    source=Path(file['localPath']);out=BASE/'native'/(file['id']+'.json')
    digest=hashlib.sha256()
    with source.open('rb') as stream:
        while chunk:=stream.read(1024*1024):digest.update(chunk)
    sha=digest.hexdigest()
    if out.exists():
        cached=json.loads(out.read_text())
        if cached.get('sha256')==sha and cached.get('version')==VERSION and cached.get('status') in ('complete','vision-pending','non-document'):return cached
    try:
        ext=source.suffix.lower();parts=[];tasks=[];quality=[];status='complete'
        if ext=='.pdf':parts,tasks=pdf_parts(file,source.read_bytes())
        elif ext in ('.docx','.pptx','.pages'):
            with zipfile.ZipFile(source) as z:
                if ext=='.docx':
                    text=word_text(z.read('word/document.xml'));parts=[{'content':text,'method':'Word XML'}]
                    if len(text.strip())<80:
                        for name in z.namelist():
                            if name.startswith('word/media/') and Path(name).suffix.lower() in ('.png','.jpg','.jpeg','.tiff','.bmp'):
                                image=Image.open(io.BytesIO(z.read(name)));task=task_for_image(file,len(tasks)+1,image,text);tasks.append(task);parts.append({'visionId':task['id'],'content':'','method':'embedded image'})
                elif ext=='.pptx':
                    for name in sorted([n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$',n)],key=lambda n:int(re.search(r'(\d+)\.xml',n)[1])):
                        root=ET.fromstring(z.read(name));paragraphs=[''.join(t.text or '' for t in p.iter(A+'t')) for p in root.iter(A+'p')]
                        parts.append({'content':'\n\n'.join(p for p in paragraphs if p),'method':'PowerPoint XML'})
                else:
                    pdf=next((n for n in z.namelist() if n.lower().endswith('preview.pdf')),None)
                    if pdf:parts,tasks=pdf_parts(file,z.read(pdf))
                    elif 'preview.jpg' in z.namelist():
                        image=Image.open(io.BytesIO(z.read('preview.jpg')));task=task_for_image(file,1,image);tasks=[task];parts=[{'visionId':task['id'],'content':'','method':'Pages preview'}];quality.append('Apple Pages preview only: check original for additional pages')
                    else:raise ValueError('Pages document has no readable preview')
        elif ext in ('.xlsx','.xls'):
            if ext=='.xlsx':
                import openpyxl
                book=openpyxl.load_workbook(source,read_only=True,data_only=True)
                for sheet in book:
                    rows=[list(row) for row in sheet.iter_rows(values_only=True) if any(v is not None for v in row)]
                    parts.append({'content':'## '+sheet.title+'\n\n'+table(rows),'method':'Excel cached values'})
                book.close()
            else:
                import xlrd
                book=xlrd.open_workbook(source)
                for sheet in book.sheets():parts.append({'content':'## '+sheet.name+'\n\n'+table([sheet.row_values(i) for i in range(sheet.nrows)]),'method':'Excel values'})
        elif ext=='.csv':parts=[{'content':table(list(csv.reader(io.StringIO(source.read_text(errors='replace'))))),'method':'CSV'}]
        elif ext in ('.jpg','.jpeg','.png','.tiff','.bmp','.heic'):
            image=Image.open(source);task=task_for_image(file,1,image);tasks=[task];parts=[{'visionId':task['id'],'content':'','method':'image'}]
        elif ext=='.doc':
            if zipfile.is_zipfile(source):
                with zipfile.ZipFile(source) as z:
                    if 'word/document.xml' in z.namelist():parts=[{'content':word_text(z.read('word/document.xml')),'method':'Word XML'}]
                    else:status='source-defect';quality.append('File contains only Office theme data, no document body')
            else:
                exe=BASE/'tools/antiword/usr/bin/antiword';environment={**os.environ,'ANTIWORDHOME':str(BASE/'tools/antiword/usr/share/antiword')}
                result=subprocess.run([str(exe),'-w','0',str(source)],capture_output=True,text=True,env=environment,timeout=60)
                if result.returncode:raise ValueError('Legacy Word: '+result.stderr[:200])
                parts=[{'content':result.stdout,'method':'antiword'}]
        elif ext in ('.html','.htm'):
            class Reader(HTMLParser):
                def __init__(self):super().__init__();self.text=[];self.skip=0
                def handle_starttag(self,tag,attrs):
                    if tag in ('script','style'):self.skip+=1
                def handle_endtag(self,tag):
                    if tag in ('script','style'):self.skip=max(0,self.skip-1)
                def handle_data(self,data):
                    if not self.skip and data.strip():self.text.append(data.strip())
            reader=Reader();reader.feed(source.read_text(errors='replace'));parts=[{'content':'\n\n'.join(reader.text),'method':'HTML text'}]
        elif ext=='.ppt':raise ValueError('Legacy PowerPoint conversion required')
        elif ext=='.zip':
            with zipfile.ZipFile(source) as z:
                for entry in z.infolist():
                    if entry.is_dir() or entry.file_size>20_000_000:continue
                    suffix=Path(entry.filename).suffix.lower()
                    if suffix=='.csv':
                        text=z.read(entry).decode('utf-8-sig',errors='replace')
                        parts.append({'content':'## '+Path(entry.filename).stem+'\n\n'+table(list(csv.reader(io.StringIO(text)))),'method':'Form response CSV in source ZIP'})
                if not parts:status='non-document';quality.append('Container has no supported document text')
                else:quality.append('Form response export: review personal/contact information and free-text answers')
        elif ext in ('.mp4','.cr2',''):

            status='non-document';quality.append('Archive container or media asset; retained in inventory, not a text document')
        else:raise ValueError('Unsupported local type: '+ext)
        content='\n\n'.join(p['content'] for p in parts)
        if tasks:status='vision-pending'
        if not content.strip() and not tasks and status=='complete':quality.append('Source contains no extractable text');status='empty'
        result={**file,'version':VERSION,'sha256':sha,'status':status,'parts':parts,'visionTasks':tasks,'content':content,'flags':ocr.flags(content),'quality':quality}
    except Exception as e:result={**file,'version':VERSION,'sha256':sha,'status':'error','error':type(e).__name__+': '+str(e)[:300]}
    ocr.save(out,result);return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=4);args=parser.parse_args()
    for name in ['native','page-images']:(BASE/name).mkdir(exist_ok=True)
    files=json.loads((BASE/'past-matches.json').read_text());results=[]
    with futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(process,files):
            results.append(result)
            if len(results)%25==0:print(f'{len(results)}/{len(files)} extracted',flush=True)
    tasks=[t for r in results for t in r.get('visionTasks',[])]
    ocr.save(BASE/'native-vision-tasks.json',tasks);ocr.save(BASE/'native-run-report.json',[{k:r.get(k) for k in ['id','name','status','error','quality']} for r in results])
    print(json.dumps({'files':len(results),'statuses':{s:sum(r['status']==s for r in results) for s in set(r['status'] for r in results)},'visionPages':len(tasks)}))
if __name__=='__main__':main()

