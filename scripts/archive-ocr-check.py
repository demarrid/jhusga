"""Run with python3 scripts/archive-ocr-check.py (no network or OCR dependencies)."""
import importlib.util, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('archive_ocr',Path(__file__).with_name('archive-ocr.py'))
ocr=importlib.util.module_from_spec(spec); spec.loader.exec_module(ocr)

class ArchiveChecks(unittest.TestCase):
    def test_sensitive_identifiers(self):
        self.assertIn('possible government identifier',ocr.flags('Social security: 123-45-6789'))
        self.assertIn('contact details',ocr.flags('Contact someone@example.org'))
        self.assertIn('financial account details',ocr.flags('Routing number: 123456789'))
    def test_policy_discussions_are_review_leads(self):
        self.assertIn('student records or disciplinary material',ocr.flags('Rules for disciplinary proceedings'))
        self.assertEqual(ocr.flags('The Council approved its standing rules.'),[])
    def test_cached_original_survives_throttle(self):
        with tempfile.TemporaryDirectory() as d, patch.object(ocr,'BASE',Path(d)):
            p=Path(d)/'originals';p.mkdir();(p/'abc').write_bytes(b'image')
            (p/'abc.json').write_text(json.dumps({'modifiedTime':'one'}))
            (Path(d)/'download-throttled.json').write_text('{}')
            self.assertEqual(ocr.download({'id':'abc','modifiedTime':'one'}),p/'abc')
            with self.assertRaisesRegex(RuntimeError,'stopped'):
                ocr.download({'id':'abc','modifiedTime':'two'})
    def test_offline_never_requests_missing_original(self):
        with tempfile.TemporaryDirectory() as d, patch.object(ocr,'BASE',Path(d)),patch.dict(os.environ,{'ARCHIVE_OFFLINE':'1'}):
            with self.assertRaisesRegex(RuntimeError,'offline'):
                ocr.download({'id':'abc','modifiedTime':'one'})
    def test_orientation_change_invalidates_cached_ocr(self):
        with tempfile.TemporaryDirectory() as d, patch.object(ocr,'BASE',Path(d)):
            p=Path(d)/'text';p.mkdir()
            cached={'version':ocr.VERSION,'modifiedTime':'one','status':'complete','content':'sideways','rotation':0}
            (p/'abc.json').write_text(json.dumps(cached))
            with patch.object(ocr,'download',side_effect=RuntimeError('fresh extraction needed')):
                self.assertEqual(ocr.process({'id':'abc','modifiedTime':'one','rotation':-90})['status'],'error')
    def test_cache_requires_matching_source_and_engine(self):
        with tempfile.TemporaryDirectory() as d, patch.object(ocr,'BASE',Path(d)):
            p=Path(d)/'text';p.mkdir()
            cached={'version':ocr.VERSION,'modifiedTime':'one','status':'complete','content':'cached'}
            (p/'abc.json').write_text(json.dumps(cached))
            self.assertEqual(ocr.process({'id':'abc','modifiedTime':'one'}),cached)
            with patch.object(ocr,'download',side_effect=RuntimeError('fresh extraction needed')):
                self.assertEqual(ocr.process({'id':'abc','modifiedTime':'two'})['status'],'error')

if __name__=='__main__': unittest.main()

