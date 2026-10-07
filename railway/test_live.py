import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
import tempfile
sys.path.insert(0, str(Path(__file__).parent))
import live_pdp

class LiveTests(unittest.TestCase):
    def test_only_public_fepy_products(self):
        address=[(2,1,6,'',('104.21.1.1',443))]
        with patch.object(live_pdp.socket,'getaddrinfo',return_value=address):
            self.assertEqual(live_pdp.validate_url('https://www.fepy.com/a-product'), 'https://www.fepy.com/a-product')
            for url in ['http://fepy.com/product','https://fepy.com/','https://fepy.com/shop/cart','https://fepy.com/%63ustomer/login','https://fepy.com.attacker.com/product','https://fepy.com/product?q=1','https://user:pass@fepy.com/product','https://fepy.com:8000/product']:
                with self.assertRaises(ValueError): live_pdp.validate_url(url)
        with patch.object(live_pdp.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError): live_pdp.validate_url('https://fepy.com/product')

    def test_technical_findings_preserve_evidence(self):
        data={'canonical':'','robots':'noindex,follow','h1Count':2,'productSchema':False,'malformedSchema':1,'mobileOverflow':True,'mobilePageWidth':500}
        findings=live_pdp.technical_findings(data,'https://fepy.com/p')
        self.assertEqual({f['code'] for f in findings}, {'canonical_missing','noindex','h1_count','schema_missing','schema_invalid_json','mobile_overflow'})
        self.assertIn('noindex',next(f['evidence'] for f in findings if f['code']=='noindex'))

    def test_access_block_stops_remaining_page_requests(self):
        class Browser:
            def __init__(self, **kwargs): pass
            async def start(self): pass
            async def stop(self): pass
        blocked={'status':'error','requestedUrl':'https://fepy.com/one','failureKind':'access_blocked','error':'Verification blocked'}
        updates=[]
        with patch.dict(sys.modules, {'browser_use':SimpleNamespace(Browser=Browser)}), patch.object(live_pdp,'collect_one',AsyncMock(return_value=blocked)) as collect:
            result=asyncio.run(live_pdp.collect_pages(['https://fepy.com/one','https://fepy.com/two','https://fepy.com/three'],'test',Path(tempfile.mkdtemp()),lambda count,pages:updates.append(count)))
        self.assertEqual(collect.await_count,1)
        self.assertEqual(len(result),3)
        self.assertEqual(result[1]['failureKind'],'skipped_after_block')
        self.assertEqual(updates[-1],1)

    def test_screenshots_are_labelled_and_scoped(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('worker_shot',Path(__file__).with_name('main.py'))
        worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        payload=worker.decision_payload(worker.clean_row({}), screenshots={'mobile':b'jpeg'})
        question=next(q for q in payload['questions'] if q['name']=='mobile_first_view')
        self.assertIn('not a full usability',question['instructions'])
        self.assertIn('mobile first-viewport',payload['input'][0]['content'][1]['text'])

    def test_speed_conflict_and_power_review_are_concrete(self):
        data={'canonical':'https://fepy.com/p','h1Count':1,'productSchema':True,'schemaModel':'','row':{'title_en':'Bosch Cordless Drill','model_number':'GSB 18V-50 + 06019H51L0','specs_inline':'No Load Speed: 0 – 2,500 / 0 rpm | Power Input: 710W | Battery Voltage: 18V','faq_text':'What is the no-load speed? First gear is 0 to 460 rpm, second reaches 1,800 rpm.'}}
        found={f['code']:f for f in live_pdp.technical_findings(data,'https://fepy.com/p')}
        self.assertIn('2,500', found['speed_conflict']['evidence'])
        self.assertIn('1,800', found['speed_conflict']['evidence'])
        self.assertIn('710W', found['cordless_power_review']['evidence'])
        self.assertIn('not proof', found['cordless_power_review']['action'])
        self.assertIn('schema_model_missing', found)
        data['row']['specs_inline']='No Load Speed: 0 – 460 / 0 – 1,800 rpm'
        self.assertNotIn('speed_conflict',{f['code'] for f in live_pdp.technical_findings(data,'https://fepy.com/p')})

    def test_weight_conflict_requires_supplier_verification(self):
        data={'canonical':'https://fepy.com/p','h1Count':1,'productSchema':True,'row':{'description_en':'Weighing only 1.7 kg','specs_inline':'Weight: 3.44 kg | Voltage: 18V'}}
        finding=live_pdp.technical_findings(data,'https://fepy.com/p')[0]
        self.assertEqual(finding['code'],'weight_conflict')
        self.assertIn('1.7',finding['evidence'])
        self.assertIn('shipping weights',finding['action'])

    def test_failed_page_does_not_receive_ai_checks(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('worker_live',Path(__file__).with_name('main.py'))
        worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        page={'status':'error','requestedUrl':'https://fepy.com/p','error':'Not a product'}
        with patch.object(worker,'decisions') as decisions, patch.object(worker,'embedding') as embeddings:
            worker.run_job('live-test', [worker.clean_row({})], True, True, [page])
        decisions.assert_not_called();embeddings.assert_not_called()
        result=worker.get_job('live-test')['results'][0]
        self.assertEqual(result['decisions']['status'],'not_evaluated')
        self.assertEqual(result['live']['status'],'error')

if __name__=='__main__':unittest.main()
