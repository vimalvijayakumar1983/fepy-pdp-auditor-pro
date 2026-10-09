"""Synthetic local validation worker. Never enabled in the production app."""
import os
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'railway'))
import main
# Deliberately synthetic findings, not an export of live customer data.
row=main.clean_row(dict(sku='DEMO-TOOL-01',title_en='Demo Cordless Combi Drill · synthetic validation record',brand='Demo',model_number='DEMO-18',product_url='https://www.fepy.com/demo-cordless-drill',category='Power tools',price_aed='250',currency='AED',stock_status='in_stock',description_en='Synthetic validation description. Replace this fixture with verified product information in a real audit.',image_url_1='https://www.fepy.com/demo-image.jpg',image_alt_1='Synthetic demo drill',meta_title='Demo DEMO-18 cordless drill',meta_description='Synthetic search description for local application workflow validation only.',specs_inline='Voltage: 18V | Pack: tool only'))
issue=dict(code='fixture_fact_conflict',severity='high',category='accuracy',basis='captured_page_rule',finding='Synthetic specification conflict for workflow validation',evidence='Synthetic fixture: one field says 18 V and another says 20 V.',action='Review the source-backed specification and correct the mismatched field.')
job_id='a'*32
page=dict(status='completed',requestedUrl=row['product_url'],auditedAt='2026-10-08T10:00:00Z',durationSeconds=2,extracted=row,technical=[issue],evidence={'desktop':job_id+'-0-desktop.jpg','mobile':job_id+'-0-mobile.jpg'})
quality=dict(status='completed',manufacturerStatus='not_verified',findings=[],sources=[],limitations=['Synthetic local fixture; no manufacturer comparison or paid AI was run.'])
main.save_job(dict(id=job_id,created=time.time(),status='completed',mode='live',total=1,completed=1,results=[dict(rowIndex=0,sku=row['sku'],live=page,quality=quality,decisions={'status':'not_requested'},embeddings={'status':'not_requested'})],timings={'totalSeconds':2}))
evidence=main.DATA_DIR/'evidence';evidence.mkdir(exist_ok=True)
from PIL import Image
for view in ('desktop','mobile'):Image.new('RGB',(80,80),'#ecf3e8').save(evidence/f'{job_id}-0-{view}.jpg')
app=main.app
