"""Workspace lifecycle tests using synthetic evidence; no site, browser or AI calls."""
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import main as worker
from workspace import build_router, baseline_findings

AUTH={'Authorization':'Bearer workspace-test-token'}

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.old_db=worker.DB
        self.old_dir=worker.DATA_DIR
        worker.DATA_DIR=Path(self.folder.name)
        worker.DB=worker.DATA_DIR/'test.sqlite'
        self.env=patch.dict(os.environ,{'AUDITOR_WORKER_TOKEN':'workspace-test-token','OPENAI_API_KEY':'','FEPY_AUDITOR_ACCESS_APPROVED':''})
        self.env.start()
        with worker.connection() as db:
            db.execute('CREATE TABLE jobs (id TEXT PRIMARY KEY, created REAL, payload TEXT)')
            db.execute('CREATE TABLE cache (key TEXT PRIMARY KEY, created REAL, value TEXT)')
        build_router(worker.connection,worker.require_auth,worker.get_job,worker.clean_row)
        self.client=TestClient(worker.app)
        self.project=self.client.post('/workspace/projects',headers=AUTH,json={'name':'Synthetic test project'}).json()['id']

    def tearDown(self):
        worker.DB=self.old_db
        worker.DATA_DIR=self.old_dir
        self.env.stop()
        self.folder.cleanup()

    def call(self,path,body=None,method='POST'):
        return self.client.request(method,path,headers=AUTH,json=body)

    def import_row(self,row=None):
        row=row or {'sku':'DEMO','product_url':'https://www.fepy.com/demo-product','title_en':'Synthetic demo product'}
        result=self.call(f'/workspace/projects/{self.project}/products',{'rows':[row]})
        self.assertEqual(result.status_code,201,result.text)
        return self.call('/workspace/products/'+result.json()['productIds'][0],method='GET').json()

    def job(self,index,captured='2026-10-09T10:00:00Z',issues=None,quality=None,failed=False):
        job_id=f'{index:032x}'
        page=dict(status='error' if failed else 'completed',requestedUrl='https://www.fepy.com/demo-product',auditedAt=captured,extracted=worker.clean_row({'sku':'DEMO','product_url':'https://www.fepy.com/demo-product','title_en':'Synthetic demo product'}),technical=issues or [],evidence={'desktop':job_id+'-0-desktop.jpg'})
        job=dict(id=job_id,created=time.time(),status='completed',mode='live',projectId=self.project,total=1,completed=1,results=[dict(rowIndex=0,sku='DEMO',live=page,quality=quality or {},decisions={'status':'not_requested'},embeddings={'status':'not_requested'})])
        worker.save_job(job)
        return job_id

    def test_auth_validation_and_atomic_import(self):
        self.assertEqual(self.client.get('/workspace').status_code,401)
        self.assertEqual(self.call('/workspace/projects',{'name':'  '}).status_code,400)
        self.assertEqual(self.call(f'/workspace/projects/{self.project}/products',{'rows':[{'sku':'GOOD'},{'product_url':'https://127.0.0.1/internal'}]}).status_code,400)
        self.assertEqual(len(self.call(f'/workspace/projects/{self.project}',method='GET').json()['products']),0)
        self.assertEqual(self.call(f'/workspace/projects/{self.project}/products',{'rows':[{}]}).status_code,400)

    def test_identity_dedup_and_durable_review_with_revision_conflict(self):
        p=self.import_row()
        self.import_row({'sku':'DEMO','title_en':'Updated synthetic title','product_url':'https://fepy.com/demo-product/'})
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(len(data['products']),1)
        p=self.call('/workspace/products/'+p['id'],method='GET').json()
        f=p['findings'][0]
        route=f"/workspace/products/{p['id']}/findings/{f['id']}"
        body=dict(revision=p['revision'],status='in_progress',owner='Content team',note='Verify against the supplier sheet.',dueDate='2026-10-12')
        saved=self.call(route,body,method='PATCH')
        self.assertEqual(saved.status_code,200)
        self.assertEqual(saved.json()['findings'][0]['owner'],'Content team')
        self.assertEqual(self.call(route,body,method='PATCH').status_code,409)
        self.assertEqual(self.call(route,dict(body,revision=saved.json()['revision'],status='verified'),method='PATCH').status_code,422)

    def test_drafts_never_overwrite_captured_fields(self):
        p=self.import_row()
        response=self.call(f"/workspace/products/{p['id']}/drafts",{'revision':p['revision'],'fields':{'title_en':'Editorial draft title'}},method='PUT')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['row']['title_en'],'Synthetic demo product')
        self.assertEqual(response.json()['drafts']['title_en']['value'],'Editorial draft title')
        self.assertEqual(self.call(f"/workspace/products/{p['id']}/drafts",{'revision':response.json()['revision'],'fields':{'arbitrary_field':'x'}},method='PUT').status_code,400)

    def test_auto_archive_without_browser_client_and_old_evidence_is_available(self):
        job_id=self.job(1)
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(data['audits'][0]['id'],job_id)
        evidence=worker.DATA_DIR/'evidence';evidence.mkdir()
        from PIL import Image
        Image.new('RGB',(20,20),'white').save(evidence/f'{job_id}-0-desktop.jpg')
        with worker.connection() as db:db.execute('DELETE FROM jobs WHERE id=?',(job_id,))
        self.assertEqual(worker.get_job(job_id)['id'],job_id)
        self.assertEqual(self.client.get(f'/jobs/{job_id}/evidence/0/desktop',headers=AUTH).status_code,200)
        self.assertEqual(self.client.get(f'/jobs/{job_id}/evidence/0/desktop').status_code,401)
        attached=self.call(f'/workspace/projects/{self.project}/audits',{'jobId':job_id})
        self.assertTrue(attached.json()['alreadySaved'])
        export=self.call(f'/workspace/projects/{self.project}/export',method='GET').json()
        self.assertEqual(len(export['audits']),1)
        self.assertEqual(len(export['products']),1)

    def test_same_capture_does_not_close_finding_but_fresh_capture_can(self):
        issue=dict(code='synthetic_layout',severity='review',finding='Synthetic visible issue',evidence='Fixture evidence',action='Review the source.',category='content')
        self.job(2,issues=[issue])
        self.job(3,captured='2026-10-09T10:00:00Z')
        def issue_status():
            data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
            return next(f['status'] for f in data['findings'] if f['code']=='synthetic_layout')
        self.assertEqual(issue_status(),'open')
        self.job(4,captured='2026-10-09T11:00:00Z')
        self.assertEqual(issue_status(),'not_detected')
        self.job(5,captured='2026-10-09T12:00:00Z',issues=[issue])
        self.assertEqual(issue_status(),'open')

    def test_failed_source_or_ai_does_not_close_manufacturer_finding(self):
        issue=dict(code='synthetic_reference',severity='high',finding='Synthetic reference conflict',evidence='Fixture quote',action='Review source.',category='accuracy',sourceUrl='https://datasheets.tdx.henkel.com/example.pdf')
        self.job(6,quality={'status':'completed','findings':[issue]})
        self.job(7,captured='2026-10-09T12:00:00Z',quality={'status':'error','findings':[]})
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(next(f['status'] for f in data['findings'] if f['code']=='synthetic_reference'),'open')
        self.job(8,captured='2026-10-09T13:00:00Z',quality={'status':'completed','sources':[],'findings':[]})
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(next(f['status'] for f in data['findings'] if f['code']=='synthetic_reference'),'open')

    def test_failed_page_not_scored_or_imported(self):
        self.job(9,failed=True)
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(data['products'],[])
        self.assertEqual(len(data['audits']),1)

    def test_out_of_order_capture_cannot_replace_current(self):
        self.job(10,captured='2026-10-09T13:00:00Z')
        self.job(11,captured='2026-10-09T10:00:00Z')
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(data['products'][0]['latestAudit'],f'{10:032x}')
        p=self.call('/workspace/products/'+data['products'][0]['id'],method='GET').json()
        self.assertEqual(len(p['audits']),2)

    def test_live_permission_gate_covers_background_path_before_dns(self):
        with patch('live_pdp.validate_url') as validate,patch.object(worker.EXECUTOR,'submit') as submit:
            response=self.call('/live-jobs',{'urls':['https://www.fepy.com/demo-product']})
        self.assertEqual(response.status_code,409)
        validate.assert_not_called();submit.assert_not_called()

    def test_model_identity_parts_do_not_create_false_search_title_finding(self):
        row={'model_number':'GSB 18V-50 + 06019H51L0','meta_title':'Bosch 06019H51L0 GSB 18V-50 cordless drill'}
        self.assertNotIn('search_title_identity',[f['code'] for f in baseline_findings(row)])
        row['meta_title']='Bosch GSB 18V-50 cordless drill'
        self.assertIn('search_title_identity',[f['code'] for f in baseline_findings(row)])

    def test_fepy_image_gate_runs_before_dns_or_network(self):
        with patch.object(worker.socket,'getaddrinfo') as dns, patch.object(worker.httpx,'stream') as fetch:
            with self.assertRaises(ValueError): worker.safe_image('https://www.fepy.com/product.jpg')
        dns.assert_not_called();fetch.assert_not_called()

    def test_invalid_project_cannot_queue_a_paid_assessment(self):
        with patch.object(worker.EXECUTOR,'submit') as submit:
            r=self.call('/jobs',{'projectId':'f'*32,'rows':[{'sku':'DEMO'}]})
        self.assertEqual(r.status_code,404)
        submit.assert_not_called()

    def test_recovery_archives_terminal_job_after_restart(self):
        job_id=self.job(15)
        with worker.connection() as db:
            db.execute('DELETE FROM workspace_audits WHERE id=?',(job_id,))
            db.execute('DELETE FROM workspace_products')
        worker.recover_workspace_audits()
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(len(data['audits']),1)
        self.assertEqual(len(data['products']),1)

    def test_run_job_preserves_project_and_archives_when_client_is_closed(self):
        job_id=f'{16:032x}'
        row=worker.clean_row({'sku':'DEMO','title_en':'Synthetic worker product'})
        worker.save_job(dict(id=job_id,created=time.time(),projectId=self.project,status='queued',total=1,completed=0,results=[]))
        worker.run_job(job_id,[row],False,False)
        data=self.call(f'/workspace/projects/{self.project}',method='GET').json()
        self.assertEqual(data['audits'][0]['id'],job_id)
        self.assertEqual(data['products'][0]['sku'],'DEMO')

    def test_container_includes_workspace_module(self):
        docker=Path(__file__).with_name('Dockerfile').read_text()
        self.assertIn('quality.py workspace.py .',docker)

if __name__=='__main__':unittest.main()
