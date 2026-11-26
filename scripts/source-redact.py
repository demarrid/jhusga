"""Redacted copies of archive source files: the helper behind scripts/source-redact.ts.

  python3 scripts/source-redact.py normalize OUT.pdf INPUT[:MIME] ...
  python3 scripts/source-redact.py lines INPUT.pdf OUT.json [--ocr-all]
  python3 scripts/source-redact.py apply INPUT.pdf PLAN.json OUT.pdf PREVIEW_DIR

`normalize` joins the sources of one document (a PDF, or a run of photographs)
into one upright PDF.

`lines` reports every line of text on every page with word boxes in PDF points
from the top-left corner: the text layer where a page has one, and local OCR of
the rendered page where it is a scan or carries images, because handwriting on
a printed form lives in the image and never in the text layer. It decides
nothing; lib/source-redaction.ts decides what to cover.

`apply` burns black boxes in with PyMuPDF redaction, which removes the text,
line art and image pixels underneath, then rasterises every page into a new
file. Nothing in the output can be selected, searched or recovered from behind
a box: no text layer, form field, annotation, attachment or metadata survives.
"""
import io, json, sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / '.archive-local'
sys.path.insert(0, str(BASE / 'python'))
import pymupdf  # noqa: E402

OCR_SCALE = 2.0
ENGINE = None


def image_pdf(path):
    from PIL import Image, ImageOps
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
    out = pymupdf.open()
    with Image.open(path) as image:
        for frame in range(getattr(image, 'n_frames', 1)):
            image.seek(frame)
            upright = ImageOps.exif_transpose(image.copy()).convert('RGB')
            data = io.BytesIO()
            upright.save(data, 'JPEG', quality=92)
            page = out.new_page(width=upright.width * 72 / 150, height=upright.height * 72 / 150)
            page.insert_image(page.rect, stream=data.getvalue())
    return out


def normalize(out_path, inputs):
    out = pymupdf.open()
    for item in inputs:
        path, _, mime = item.partition(':')
        is_pdf = mime == 'application/pdf' or (not mime and open(path, 'rb').read(5) == b'%PDF-')
        source = pymupdf.open(path) if is_pdf else image_pdf(path)
        out.insert_pdf(source)
    for page in out:
        if page.rotation:
            page.remove_rotation()
    out.save(out_path, garbage=3, deflate=True)
    print(json.dumps({'pages': out.page_count}))


def engine():
    global ENGINE
    if ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR
        ENGINE = RapidOCR(det_limit_side_len=2400, intra_op_num_threads=4, inter_op_num_threads=1)
    return ENGINE


def ocr_lines(page):
    """OCR upright, then turned a quarter each way: margin notes, phone numbers
    in particular, are often written up the side of a page."""
    import numpy as np
    pix = page.get_pixmap(matrix=pymupdf.Matrix(OCR_SCALE, OCR_SCALE), alpha=False)
    upright = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    width, height = pix.width, pix.height
    lines = []
    for turn in (0, 1, 3):
        # np.rot90 turns counter-clockwise; map each point back to the upright page.
        result, _ = engine()(np.ascontiguousarray(np.rot90(upright, turn)))
        for quad, text, score in result or []:
            if turn == 1:
                points = [(width - v, u) for u, v in quad]
            elif turn == 3:
                points = [(v, height - u) for u, v in quad]
            else:
                points = quad
            xs = [p[0] / OCR_SCALE for p in points]
            ys = [p[1] / OCR_SCALE for p in points]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            parts = text.split()
            if not parts:
                continue
            if turn:
                # Sideways text is mostly noise from the upright lines, so it
                # only counts when it reads cleanly, and is boxed as one piece.
                if float(score) < 0.6 or y1 - y0 < x1 - x0:
                    continue
                lines.append({'source': 'ocr', 'confidence': float(score),
                              'words': [{'text': ' '.join(parts), 'box': [x0, y0, x1, y1]}]})
                continue
            # OCR boxes a line; share its width among the words by length.
            total = sum(len(p) for p in parts) + len(parts) - 1
            words, at = [], 0
            for part in parts:
                start = x0 + (x1 - x0) * at / total
                at += len(part)
                end = x0 + (x1 - x0) * at / total
                at += 1
                words.append({'text': part, 'box': [start, y0, end, y1]})
            lines.append({'source': 'ocr', 'confidence': float(score), 'words': words})
    return lines


def text_lines(page):
    grouped = {}
    for x0, y0, x1, y1, word, block, line, _ in page.get_text('words'):
        grouped.setdefault((block, line), []).append({'text': word, 'box': [x0, y0, x1, y1]})
    return [{'source': 'text', 'words': words} for words in grouped.values()]


def needs_ocr(page):
    if len(page.get_text().strip()) < 80:
        return True
    area = abs(page.rect)
    covered = sum(abs(pymupdf.Rect(info['bbox']) & page.rect) for info in page.get_image_info())
    return area > 0 and covered / area > 0.3


def lines(path, out_path, ocr_all=False):
    doc = pymupdf.open(path)
    pages = []
    for page in doc:
        found = text_lines(page)
        if ocr_all or needs_ocr(page):
            found += ocr_lines(page)
        pages.append({'width': page.rect.width, 'height': page.rect.height, 'lines': found})
    Path(out_path).write_text(json.dumps({'pages': pages}))
    print(json.dumps({'pages': len(pages), 'lines': sum(len(p['lines']) for p in pages)}))


def apply(path, plan_path, out_path, preview_dir):
    plan = json.loads(Path(plan_path).read_text())
    dpi, quality = int(plan.get('dpi', 150)), int(plan.get('quality', 75))
    doc = pymupdf.open(path)
    boxes, withheld = {}, {}
    for item in plan['boxes']:
        boxes.setdefault(item['page'], []).append(pymupdf.Rect(item['box']))
        if item.get('kind') == 'withheld page':
            withheld[item['page']] = item.get('notice') or 'This page is withheld.'
    for number, rects in boxes.items():
        page = doc[number]
        for rect in rects:
            page.add_redact_annot(rect & page.rect, fill=(0, 0, 0))
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                              text=pymupdf.PDF_REDACT_TEXT_REMOVE)
        if number in withheld:
            # Drawn before flattening, so it becomes pixels like everything else.
            # It names the form ("This is a W-9."), so a reader knows what is missing.
            note = pymupdf.Rect(40, page.rect.height / 2 - 40, page.rect.width - 40, page.rect.height / 2 + 40)
            page.insert_textbox(note, withheld[number], fontsize=26, fontname='hebo',
                                color=(1, 1, 1), align=pymupdf.TEXT_ALIGN_CENTER)

    out = pymupdf.open()
    preview = Path(preview_dir)
    preview.mkdir(parents=True, exist_ok=True)
    for old in preview.glob('page-*.png'):
        old.unlink()
    for number, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi, alpha=False, annots=False)
        target = out.new_page(width=page.rect.width, height=page.rect.height)
        target.insert_image(target.rect, stream=pix.tobytes('jpeg', jpg_quality=quality))
        # Painted again on top of the raster, in case a renderer ever skipped a
        # fill. Not on a withheld page: it was emptied before rasterising, and
        # a repaint would cover its notice.
        for rect in ([] if number in withheld else boxes.get(number, [])):
            target.draw_rect(rect & target.rect, color=(0, 0, 0), fill=(0, 0, 0), width=0)
    out.set_metadata({})
    out.del_xml_metadata()
    out.save(out_path, garbage=4, deflate=True, clean=True)

    flat = pymupdf.open(out_path)
    for number, page in enumerate(flat):
        page.get_pixmap(dpi=90, alpha=False).save(str(preview / f'page-{number + 1:03d}.png'))
    print(json.dumps({'pages': flat.page_count, 'bytes': Path(out_path).stat().st_size,
                      'textLayer': sum(len(p.get_text().strip()) for p in flat)}))


def crops(path, plan_path, out_dir):
    """One picture per box, cut from the finished copy, with the box outlined in red."""
    from PIL import Image, ImageDraw
    doc = pymupdf.open(path)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('box-*.png'):
        old.unlink()
    for index, item in enumerate(json.loads(Path(plan_path).read_text())['boxes']):
        page = doc[item['page']]
        rect = pymupdf.Rect(item['box']) & page.rect
        whole = rect.width > page.rect.width * 0.9 and rect.height > page.rect.height * 0.9
        clip = page.rect if whole else pymupdf.Rect(rect.x0 - 60, rect.y0 - 45, rect.x1 + 60, rect.y1 + 45) & page.rect
        dpi = 40 if whole else 110
        pix = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
        image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        scale = dpi / 72
        box = [(rect.x0 - clip.x0) * scale, (rect.y0 - clip.y0) * scale, (rect.x1 - clip.x0) * scale, (rect.y1 - clip.y0) * scale]
        ImageDraw.Draw(image).rectangle(box, outline=(220, 30, 30), width=3)
        image.save(out / f'box-{index + 1:03d}.png')
    print(json.dumps({'crops': len(json.loads(Path(plan_path).read_text())['boxes'])}))


if __name__ == '__main__':
    command, args = sys.argv[1], sys.argv[2:]
    if command == 'crops':
        crops(*args[:3])
        raise SystemExit(0)
    if command == 'normalize':
        normalize(args[0], args[1:])
    elif command == 'lines':
        lines(args[0], args[1], '--ocr-all' in args)
    elif command == 'apply':
        apply(*args[:4])
    else:
        raise SystemExit('Unknown command: ' + command)
