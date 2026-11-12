import importlib.util,io,json,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
vision=module('archive_vision','archive-vision.py');native=module('archive_native','archive-native.py')
class PipelineChecks(unittest.TestCase):
 def test_zero_and_false_are_not_dropped(self):
  text=native.table([['Amount','Confirmed'],[0,False],[None,True]])
  self.assertIn('| 0 | False |',text);self.assertIn('|  | True |',text)
 def test_form_export_is_read_as_document(self):
  with tempfile.TemporaryDirectory() as d,patch.object(native,'BASE',Path(d)):
   base=Path(d);(base/'native').mkdir();source=base/'responses.zip'
   with zipfile.ZipFile(source,'w') as z:z.writestr('Responses.csv','Name,Amount\nExample,0\n')
   result=native.process({'id':'form','name':'Responses.zip','localPath':str(source)})
   self.assertEqual(result['status'],'complete');self.assertIn('| Example | 0 |',result['content']);self.assertTrue(result['quality'])
 def test_invalid_model_schema(self):
  with self.assertRaises(ValueError):vision.validate({'content':'text','uncertainties':'none','sensitiveFlags':[],'handwritten':False,'nonDocument':False})
  with self.assertRaises(ValueError):vision.validate({'content':'','uncertainties':[],'sensitiveFlags':[],'handwritten':False,'nonDocument':False})
 def test_explicit_unreadable_text_is_preserved(self):
  data={'content':'Name: [illegible]','uncertainties':['Name unreadable'],'sensitiveFlags':[],'handwritten':True,'nonDocument':False}
  self.assertEqual(vision.validate(data)['content'],'Name: [illegible]')
 def test_truncated_api_output_never_becomes_complete(self):
  with tempfile.TemporaryDirectory() as d:
   base=Path(d);(base/'vision').mkdir();image=base/'page.jpg';vision.Image.new('RGB',(16,16),'white').save(image)
   payload={'choices':[{'finish_reason':'length','message':{'content':'{"content":"partial'}}]}
   with patch.object(vision,'BASE',base),patch.object(vision,'env',return_value={'AI_PROVIDER':'openai','AI_MODEL':'test-model','AI_API_KEY':'test-key'}),patch.object(vision.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
    result=vision.review({'id':'test','imagePath':str(image),'title':'Test'})
   self.assertEqual(result['status'],'error');self.assertIn('Incomplete output',result['error'])
 def test_word_paragraphs_and_table_survive(self):
  xml=b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  result=native.word_text(xml);self.assertIn('First paragraph.\n\nSecond paragraph.',result);self.assertIn('| 0 |',result)
if __name__=='__main__':unittest.main()
