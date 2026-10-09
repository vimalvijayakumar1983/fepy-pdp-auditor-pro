import io,json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent))
import quality
ROW=json.loads((Path(__file__).parent/'fixtures/pattex_page.json').read_text())
# Short factual test fixture; runtime retrieves the actual manufacturer document.
DOC='Pattex PL150. Temperature resistance -20°C to +80°C (fully cured). Final bond strength: Up to 6 N/mm2 (shear strength of wood at room temperature). Gap-bridging capacity Max. 10 mm. Not suitable for bonding with constant exposure to moisture. HEAVY LOADS: Wait for at least 24 hours before using it.'
class QualityTests(unittest.TestCase):
    def test_pattex_template_and_curing_are_detected_without_source(self):
        codes={x['code'] for x in quality.page_findings(ROW)}
        self.assertTrue({'generic_benefits','irrelevant_benefits','curing_claim_conflict','search_title_identity'}<=codes)
        self.assertEqual(quality.reference_findings(ROW,[]),[])
    def test_manufacturer_comparison_and_corrected_negative_controls(self):
        ref=dict(url=quality.PL150_SOURCE,status='matched_model',text=DOC)
        codes={x['code'] for x in quality.reference_findings(ROW,[ref])}
        self.assertTrue({'reference_temperature','reference_strength_label','reference_gap_label','reference_support','reference_waterproofing','reference_thickness_review'}<=codes)
        fixed=dict(ROW,specs_inline='Temperature Resistance: -20°C to +80°C | Final Bond Strength: Up to 6 N/mm2 | Gap-bridging capacity: Max. 10 mm',faq_text='Support heavy loads and wait at least 24 hours.',meta_description='Water-resistant adhesive; not for constant moisture exposure.')
        self.assertEqual(quality.reference_findings(fixed,[ref]),[])
        ref['status']='identity_unconfirmed'
        self.assertEqual(quality.reference_findings(ROW,[ref]),[])
    def test_chemical_review_mismatch_and_delivery_are_review_signals(self):
        row=dict(ROW,reviews_text='الكابل طوله كافٍ. الحقيبة متينة.',page_context='Free delivery on orders above AED 200. Free Delivery on all orders above AED 100 across UAE.')
        codes={x['code']:x for x in quality.page_findings(row)}
        self.assertIn('delivery_threshold_conflict',codes)
        self.assertIn('not proof',codes['review_product_mismatch']['action'])
        row['title_en']='Cordless drill'
        self.assertNotIn('review_product_mismatch',{x['code'] for x in quality.page_findings(row)})
    def test_reference_security_and_no_wrong_model_fallback(self):
        addr=[(2,1,6,'',('104.21.1.1',443))]
        with patch.object(quality.socket,'getaddrinfo',return_value=addr):
            self.assertEqual(quality.validate_reference_url(quality.PL150_SOURCE),quality.PL150_SOURCE)
            for u in ['https://127.0.0.1/a.pdf','http://datasheets.tdx.henkel.com/a.pdf','https://datasheets.tdx.henkel.com.attacker.com/a.pdf','https://user:pass@datasheets.tdx.henkel.com/a.pdf']:
                with self.assertRaises(ValueError):quality.validate_reference_url(u)
        with patch.object(quality.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):quality.validate_reference_url(quality.PL150_SOURCE)
        self.assertEqual(quality.reference_candidates(dict(title_en='Bosch drill',model_number='ABC')),[])
    def test_ungrounded_ai_quotes_are_withheld(self):
        issue=dict(code='template',finding='Template',pageQuote='Ergonomic Design',referenceQuote='',sourceId='',action='Replace generic content',severity='review',category='content')
        bad=dict(issue,code='bad',pageQuote='Invented text that does not exist')
        duplicate=dict(issue,code='duplicated_faq',finding='Duplicated FAQ block')
        badref=dict(issue,code='badref',sourceId='reference_0',referenceQuote='Invented manufacturer specification')
        class Reply:
            status_code=200
            def json(self):return dict(status='completed',output=[{'content':[{'type':'output_text','text':json.dumps(dict(summary='Review',issues=[issue,bad,badref,duplicate],limitations=['No performance test']))}]}])
        with patch.dict(os.environ,{'OPENAI_API_KEY':'fake'}),patch.object(quality.httpx,'post',return_value=Reply()):
            result=quality.detailed_review(ROW,[dict(status='matched_model',url=quality.PL150_SOURCE,text=DOC)])
        self.assertEqual(len(result['issues']),1)
        self.assertEqual(result['rejectedUngroundedIssues'],3)
    def test_source_failure_never_becomes_verified(self):
        with patch.object(quality,'fetch_reference',side_effect=ValueError('bad')),patch.object(quality,'detailed_review',return_value={'status':'completed','issues':[]}):
            result=quality.review_product(ROW)
        self.assertEqual(result['manufacturerStatus'],'not_verified')
        self.assertEqual(result['sources'][0]['status'],'unavailable')
        self.assertTrue(result['findings'])
    def test_quality_reports_separate_source_and_model_timing_and_usage(self):
        review={'status':'completed','issues':[],'model':'test-model','usage':{'input_tokens':12,'output_tokens':7}}
        with patch.object(quality,'reference_candidates',return_value=[]),patch.object(quality,'detailed_review',return_value=review):
            result=quality.review_product(ROW)
        self.assertEqual(result['usage'],review['usage'])
        self.assertEqual(result['model'],'test-model')
        self.assertGreaterEqual(result['timings']['referenceFetchSeconds'],0)
        self.assertGreaterEqual(result['timings']['detailedReviewSeconds'],0)
if __name__=='__main__':unittest.main()
