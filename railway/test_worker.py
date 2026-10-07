import importlib.util
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

os.environ['AUDITOR_DATA_DIR'] = tempfile.mkdtemp()
os.environ['AUDITOR_WORKER_TOKEN'] = 'test-worker-token'
sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient
spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('main.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
client = TestClient(worker.app)
AUTH = {'Authorization': 'Bearer test-worker-token'}

class WorkerTests(unittest.TestCase):
    def test_auth_and_validation(self):
        self.assertEqual(client.get('/health').status_code, 200)
        self.assertEqual(client.get('/capabilities').status_code, 401)
        self.assertEqual(client.post('/jobs', headers=AUTH, json={'rows': []}).status_code, 422)
        self.assertEqual(client.post('/jobs', headers=AUTH, json={'rows': [{}] * 501}).status_code, 422)
        self.assertEqual(client.post('/jobs', headers=AUTH, json={'rows': [{}], 'decisions': False, 'embeddings': False}).status_code, 400)

    def test_decisions_visible_before_similarity(self):
        row=worker.clean_row({'sku':'A','title_en':'Cordless drill','faq_text':'FAQ evidence'})
        page={'status':'completed','extracted':row,'technical':[]}
        def embed(*args):
            partial=worker.get_job('early-test')
            self.assertEqual(partial['results'][0]['decisions']['status'],'completed')
            self.assertEqual(partial['results'][0]['live']['status'],'completed')
            self.assertEqual(partial['phase'],'image_similarity')
            return [1/(768**.5)]*768
        with patch.object(worker,'decisions',return_value={'status':'completed','checks':[]}), patch.object(worker,'embedding',side_effect=embed):
            worker.run_job('early-test',[row],True,True,[page])
        result=worker.get_job('early-test')
        self.assertEqual(result['status'],'completed')
        self.assertIn('similaritySeconds',result['results'][0]['timings'])
        self.assertIn('FAQ evidence',str(worker.decision_payload(row)))

    def test_missing_key_is_not_a_pass(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            self.assertEqual(worker.decisions(worker.clean_row({'sku': 'A'}))['status'], 'not_configured')

    def test_decisions_inline_images_refusal_and_bad_output(self):
        row = worker.clean_row({'sku': 'A', 'title_en': 'A drill'})
        payload = worker.decision_payload(row, b'image')
        self.assertTrue(payload['input'][0]['content'][1]['image_url'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(payload['questions'][0]['choices'][0]['value'], 'consistent')
        class Reply:
            status_code = 200
            def json(self):
                return {'answers': [{'type': 'choice', 'name': 'content_consistency', 'choice': 'contradiction', 'confidence': .95}, {'type': 'refusal', 'name': 'category_fit'}, {'type': 'choice', 'name': 'description_quality', 'choice': 'invented', 'confidence': .99}]}
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-not-real'}), patch.object(worker.httpx, 'post', return_value=Reply()):
            result = worker.decisions(row)
        checks = {c['name']: c for c in result['checks']}
        self.assertTrue(checks['content_consistency']['needsReview'])
        self.assertEqual(checks['category_fit']['assessment'], 'refused')
        self.assertEqual(checks['description_quality']['assessment'], 'unavailable')

    def test_copied_key_whitespace_is_trimmed(self):
        class Reply:
            status_code = 401
        with patch.dict(os.environ, {'OPENAI_API_KEY': ' test-key\n'}), patch.object(worker.httpx, 'post', return_value=Reply()) as request:
            result = worker.decisions(worker.clean_row({'sku': 'A'}))
        self.assertEqual(request.call_args.kwargs['headers']['Authorization'], 'Bearer test-key')
        self.assertIn('HTTP 401', result['error'])

    def test_duplicate_indices_and_no_self_matches(self):
        neighbors = worker.similarities({0: [1., 0.], 1: [1., 0.], 2: [0., 1.]})
        self.assertEqual(neighbors[0], [{'rowIndex': 1, 'similarity': 1.0}])
        self.assertEqual(neighbors[2], [])

    def test_embedding_normalizes_model_precision(self):
        with patch.object(worker, "cached", return_value=[.5] * 768):
            vector = worker.embedding("text", "key")
        self.assertAlmostEqual(sum(v * v for v in vector), 1.0)
        with patch.object(worker, "cached", return_value=[0.] * 768):
            with self.assertRaises(ValueError): worker.embedding("text", "key")

    def test_cache_and_image_host_restrictions(self):
        count = []
        def compute():
            count.append(1)
            return [1., 0.]
        self.assertEqual(worker.cached('test', compute), worker.cached('test', compute))
        self.assertEqual(len(count), 1)
        for url in ['http://fepy.com/a.jpg', 'https://127.0.0.1/a', 'https://attacker.example/a', 'https://fepy.com.attacker.example/a', 'https://user:pass@fepy.com/a']:
            with self.assertRaises(ValueError): worker.safe_image(url)

    def test_background_job_partial_failures_and_duplicate_skus(self):
        rows = [worker.clean_row({'sku': 'same', 'title_en': 'Drill'}), worker.clean_row({'sku': 'same', 'title_en': 'Drill'})]
        with patch.object(worker, 'embedding', return_value=[1., 0.]), patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            worker.run_job('testjob', rows, True, True)
        job = worker.get_job('testjob')
        self.assertEqual(job['status'], 'completed')
        self.assertEqual(job['completed'], 2)
        self.assertEqual(job['results'][0]['embeddings']['textNeighbors'][0]['rowIndex'], 1)
        self.assertEqual(job['results'][0]['decisions']['status'], 'not_configured')

if __name__ == '__main__': unittest.main()

class HistoryTests(unittest.TestCase):
    def test_history_requires_auth_and_only_contains_summary(self):
        self.assertEqual(client.get('/jobs').status_code,401)
        worker.save_job(dict(id='history-test',created=worker.time.time(),status='completed',total=1,completed=1,mode='live',results=[dict(sku='A',live={'extracted':{'title_en':'Public test product','description_en':'Large evidence'}})]))
        data=client.get('/jobs',headers=AUTH).json()
        item=next(j for j in data['jobs'] if j['id']=='history-test')
        self.assertEqual(item['title'],'Public test product')
        self.assertNotIn('Large evidence',str(item))
    def test_reassessment_reuses_page_without_browser_and_preserves_capture_time(self):
        page=dict(status='completed',requestedUrl='https://fepy.com/product',auditedAt='original-time',extracted={'sku':'P','title_en':'Pattex adhesive'},technical=[])
        worker.save_job(dict(id='old-evidence',created=worker.time.time(),status='completed',total=1,completed=1,results=[dict(rowIndex=0,sku='P',live=page)]))
        with patch.object(worker.EXECUTOR,'submit') as submit:
            response=client.post('/jobs/old-evidence/reassess',headers=AUTH,json={'referenceUrls':[]})
        self.assertEqual(response.status_code,202)
        args=submit.call_args.args
        self.assertIs(args[0],worker.run_job)
        self.assertEqual(args[5][0]['auditedAt'],'original-time')
        self.assertTrue(args[6])
        with worker.connection() as db:db.execute('DELETE FROM jobs WHERE id=?',(response.json()['id'],))
