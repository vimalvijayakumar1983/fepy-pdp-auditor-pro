import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
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
