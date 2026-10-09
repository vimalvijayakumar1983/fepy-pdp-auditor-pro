"""Offline scheduling/evidence regressions; no network or model calls."""
import copy
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
os.environ['AUDITOR_DATA_DIR'] = tempfile.mkdtemp()
spec = importlib.util.spec_from_file_location('performance_worker', Path(__file__).with_name('main.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class PerformanceTests(unittest.TestCase):
    def test_overlap_preserves_both_captured_product_results_and_inputs(self):
        pattex = json.loads((Path(__file__).parent / 'fixtures/pattex_page.json').read_text())
        bosch = {'sku':'synthetic-bosch','title_en':'Bosch Cordless Drill','model_number':'GSB 18V-50 + 06019H51L0','specs_inline':'No Load Speed: 0 – 2,500 / 0 rpm | Power Input: 710W | Battery Voltage: 18V','faq_text':'First gear is 0 to 460 rpm, second reaches 1,800 rpm.'}
        baseline = {'results':[{'sku':row['sku'], 'live':{'status':'completed','extracted':row,'technical':[], 'sources':{'title_en':'synthetic H1'}, 'evidence':{'desktop':'fixture.jpg','mobile':'fixture-mobile.jpg'}}, 'decisions':{'status':'completed','checks':[]}, 'quality':{'status':'completed','findings':worker.page_findings(row),'sources':[], 'manufacturerStatus':'not_verified'}} for row in (bosch, dict(pattex,sku='synthetic-pattex'))]}
        pages = [copy.deepcopy(r['live']) for r in baseline['results']]
        rows = [worker.clean_row(p['extracted']) for p in pages]
        expected = {r['sku']: r for r in baseline['results']}
        def decisions(row, image=None, screenshots=None):
            self.assertEqual(row, rows[next(i for i, v in enumerate(rows) if v['sku'] == row['sku'])])
            return copy.deepcopy(expected[row['sku']]['decisions'])
        def quality(row, urls, cache):
            self.assertEqual(row['faq_text'], worker.clean_row(expected[row['sku']]['live']['extracted'])['faq_text'])
            return copy.deepcopy(expected[row['sku']]['quality'])
        outputs = []
        for flag in ('false', 'true'):
            with patch.dict(os.environ, {'AUDITOR_OVERLAP_ASSESSMENTS': flag, 'OPENAI_API_KEY': ''}), patch.object(worker, 'decisions', side_effect=decisions), patch.object(worker, 'review_product', side_effect=quality):
                worker.run_job('replay-' + flag, rows, True, False, pages, True)
            output = worker.get_job('replay-' + flag)
            self.assertEqual(output['status'], 'completed')
            outputs.append([{k:r[k] for k in ('live', 'decisions', 'quality')} for r in output['results']])
        self.assertEqual(outputs[0], outputs[1])
        # Synthetic fixtures test scheduling equivalence, not live audit accuracy.

    def test_overlap_starts_quality_before_decisions_without_retries(self):
        entered = threading.Event()
        release = threading.Event()
        def review(row, urls, cache):
            entered.set()
            if not release.wait(2): raise RuntimeError('test scheduling timeout')
            return {'status':'completed','findings':[],'sources':[],'manufacturerStatus':'not_verified'}
        def decide(*args):
            try:
                self.assertTrue(entered.wait(2))
                raise TimeoutError('paid request outcome unknown')
            finally:
                release.set()
        with patch.dict(os.environ, {'AUDITOR_OVERLAP_ASSESSMENTS':'true'}), patch.object(worker, 'review_product', side_effect=review) as quality, patch.object(worker, 'decisions', side_effect=decide) as decisions:
            worker.run_job('overlap-failure', [worker.clean_row({'sku':'test'})], True, False, detailed=True)
        result = worker.get_job('overlap-failure')['results'][0]
        self.assertEqual(decisions.call_count, 1)
        self.assertEqual(quality.call_count, 1)
        self.assertEqual(result['decisions']['status'], 'error')
        self.assertEqual(result['quality']['status'], 'completed')
        self.assertTrue(result['timings']['assessmentsOverlapped'])

    def test_quality_failure_keeps_fast_results_and_page_findings(self):
        with patch.dict(os.environ, {'AUDITOR_OVERLAP_ASSESSMENTS':'true'}), patch.object(worker,'review_product',side_effect=RuntimeError('failure')), patch.object(worker,'decisions',return_value={'status':'completed','checks':[]}):
            worker.run_job('quality-failure',[worker.clean_row({'sku':'test'})],True,False,detailed=True)
        result=worker.get_job('quality-failure')['results'][0]
        self.assertEqual(result['quality']['status'],'error')
        self.assertEqual(result['quality']['manufacturerStatus'],'not_verified')
        self.assertEqual(result['decisions']['status'],'completed')

    def test_original_queue_and_collection_timings_survive_assessment(self):
        created = worker.time.time() - 5
        worker.save_job({'id':'timing-test','created':created,'status':'running','timings':{'queueSeconds':1.2,'browserCollectionSeconds':2.3}})
        worker.run_job('timing-test',[worker.clean_row({'sku':'test'})],False,False)
        job=worker.get_job('timing-test')
        self.assertEqual(job['created'],created)
        self.assertEqual(job['timings']['browserCollectionSeconds'],2.3)
        self.assertGreaterEqual(job['timings']['totalSeconds'],5)

    def test_failed_page_never_starts_either_assessment(self):
        with patch.dict(os.environ, {'AUDITOR_OVERLAP_ASSESSMENTS':'true'}), patch.object(worker,'review_product') as quality, patch.object(worker,'decisions') as decisions:
            worker.run_job('blocked-performance',[worker.clean_row({})],True,False,[{'status':'error','failureKind':'access_blocked'}],True)
        quality.assert_not_called()
        decisions.assert_not_called()


if __name__ == '__main__': unittest.main()
