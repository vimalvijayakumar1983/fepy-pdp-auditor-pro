"""Durable, authenticated PDP improvement workspace. No storefront writes."""
import hashlib
import json
import re
import secrets
import time
from typing import Literal
from datetime import date
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from quality import page_findings

STATES = ('open', 'in_progress', 'ready_for_recheck', 'accepted_risk', 'not_detected')
DRAFT_FIELDS = {'title_en', 'title_ar', 'description_en', 'meta_title', 'meta_description', 'image_alt_1', 'specs_inline', 'faq_text'}


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ProjectInput(Input):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=500)


class ImportInput(Input):
    rows: list[dict] = Field(min_length=1, max_length=500)


class AttachInput(Input):
    jobId: str = Field(pattern=r'^[a-f0-9]{32}$')


class FindingInput(Input):
    status: Literal['open', 'in_progress', 'ready_for_recheck', 'accepted_risk']
    owner: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=2000)
    dueDate: str = Field(default='', pattern=r'^(|\d{4}-\d{2}-\d{2})$')
    revision: int = Field(ge=1)


class DraftInput(Input):
    fields: dict[str, str]
    note: str = Field(default='', max_length=2000)
    revision: int = Field(ge=1)


def identity(row):
    url = str(row.get('product_url', '')).strip()
    if url:
        p = urlparse(url)
        if p.scheme != 'https' or p.hostname not in ('fepy.com', 'www.fepy.com') or p.username or p.password or p.port not in (None, 443) or p.query or p.fragment:
            raise HTTPException(400, 'Use a canonical HTTPS FEPY product URL without query or fragment.')
        if not p.path.strip('/') or re.search(r'(^|/)(admin|cart|checkout|customer|account|graphql|api)(/|$)', p.path, re.I):
            raise HTTPException(400, 'Use a product page URL.')
        return urlunparse(('https', 'www.fepy.com', p.path.rstrip('/'), '', '', ''))
    sku = str(row.get('sku', '')).strip()
    if not sku:
        raise HTTPException(400, 'Every product needs a canonical FEPY URL or a SKU.')
    return 'sku:' + sku


def issue_key(issue):
    return hashlib.sha256(str(issue.get('code', 'unknown')).encode()).hexdigest()[:20]


def baseline_findings(row):
    """Presence and editorial checks; never a claim of factual correctness."""
    findings = list(page_findings(row))
    checks = [
        ('title_en', 'identity', 'Product title', 'Add the verified product identity and exact variant.'),
        ('brand', 'identity', 'Brand', 'Confirm the manufacturer or brand from a supplier source.'),
        ('model_number', 'identity', 'Model or part number', 'Record the exact manufacturer model where applicable.'),
        ('price_aed', 'commerce', 'Price', 'Confirm the current sellable variant price from the commerce system.'),
        ('stock_status', 'commerce', 'Stock status', 'Confirm availability from the commerce system.'),
        ('image_url_1', 'media', 'Primary image', 'Add an image of the exact sellable variant.'),
        ('image_alt_1', 'media', 'Image description', 'Describe the actual product image for accessibility.'),
        ('description_en', 'content', 'Product description', 'Add verified applications, distinguishing facts and included items.'),
        ('specs_inline', 'accuracy', 'Labelled specifications', 'Add source-backed specifications with units.'),
        ('meta_title', 'seo', 'Search title', 'Write a unique title retaining verified brand, model and variant.'),
        ('meta_description', 'seo', 'Search description', 'Summarise the product using supported facts.'),
    ]
    for field, category, label, action in checks:
        if not str(row.get(field, '')).strip():
            findings.append(dict(code='coverage_' + field, finding=label + ' was not captured', evidence='Captured field ' + field + ' is empty; absence in extraction does not prove absence on the storefront.', action=action + ' Check the page manually before editing.', severity='review', category=category, basis='captured_field_check'))
    return [dict(f, checkScope='page_rules') for f in findings]


def coverage(row):
    groups = {'Identity': ['title_en', 'brand', 'model_number'], 'Content': ['description_en', 'specs_inline'], 'Search': ['meta_title', 'meta_description'], 'Media': ['image_url_1', 'image_alt_1'], 'Commerce': ['price_aed', 'stock_status'], 'Answers': ['faq_text'], 'Arabic': ['title_ar']}
    return [{'name': name, 'present': sum(bool(str(row.get(f, '')).strip()) for f in fields), 'total': len(fields)} for name, fields in groups.items()]


def build_router(connection, require_auth, get_job, clean_row):
    router = APIRouter(prefix='/workspace', dependencies=[Depends(require_auth)])
    with connection() as db:
        db.execute('CREATE TABLE IF NOT EXISTS workspace_projects (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS workspace_products (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, identity TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(project_id, identity))')
        db.execute('CREATE INDEX IF NOT EXISTS workspace_products_project ON workspace_products(project_id)')
        db.execute('CREATE TABLE IF NOT EXISTS workspace_audits (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created REAL NOT NULL, payload TEXT NOT NULL)')
        db.execute('CREATE INDEX IF NOT EXISTS workspace_audits_project ON workspace_audits(project_id, created)')

    def project(db, project_id):
        record = db.execute('SELECT payload FROM workspace_projects WHERE id=?', (project_id,)).fetchone()
        if not record: raise HTTPException(404, 'Project not found.')
        return json.loads(record[0])

    def product(db, product_id):
        record = db.execute('SELECT payload FROM workspace_products WHERE id=?', (product_id,)).fetchone()
        if not record: raise HTTPException(404, 'Product not found.')
        return json.loads(record[0])

    def save_product(db, p):
        db.execute('INSERT INTO workspace_products VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', (p['id'], p['projectId'], p['identity'], json.dumps(p)))

    def event(p, kind, message):
        p.setdefault('activity', []).append(dict(at=time.time(), kind=kind, message=message))
        p['activity'] = p['activity'][-100:]

    def upsert(db, project_id, row):
        key = identity(row)
        found = db.execute('SELECT payload FROM workspace_products WHERE project_id=? AND identity=?', (project_id, key)).fetchone()
        if found: return json.loads(found[0])
        count = db.execute('SELECT COUNT(*) FROM workspace_products WHERE project_id=?', (project_id,)).fetchone()[0]
        if count >= 500: raise HTTPException(409, 'This project has 500 products. Create another project for the next batch.')
        p = dict(id=secrets.token_hex(16), projectId=project_id, identity=key, row=row, created=time.time(), updated=time.time(), revision=1, findings=[], drafts={}, activity=[], audits=[], coverage=coverage(row))
        event(p, 'created', 'Product added to the improvement workspace.')
        return p

    def summary(p):
        open_issues = [f for f in p['findings'] if f['status'] not in ('accepted_risk', 'not_detected')]
        row = p['row']
        return dict(id=p['id'], title=row.get('title_en') or row.get('sku') or p['identity'], sku=row.get('sku', ''), url=row.get('product_url', ''), brand=row.get('brand', ''), category=row.get('category', ''), updated=p['updated'], revision=p['revision'], open=len(open_issues), high=sum(f.get('severity') == 'high' for f in open_issues), auditCount=len(p['audits']), latestAudit=p.get('latestAudit'), coverage=p['coverage'], draftCount=len(p['drafts']), owners=list(dict.fromkeys(f.get('owner') for f in open_issues if f.get('owner'))))

    def merge_findings(p, issues, audit_id=None, captured_at=None, evaluated=None):
        previous = {f['id']: f for f in p['findings']}
        incoming = {}
        for issue in issues:
            key = issue_key(issue)
            # Prefer rich manufacturer/AI findings over duplicate rule codes.
            incoming[key] = dict(issue, id=key)
        now = time.time()
        for key, issue in incoming.items():
            old = previous.get(key)
            changed = old and (old.get('evidence') != issue.get('evidence') or old.get('finding') != issue.get('finding'))
            state = old.get('status', 'open') if old and not changed else 'open'
            if state == 'not_detected': state = 'open'
            incoming[key] = dict(issue, status=state, owner=old.get('owner', '') if old else '', note=old.get('note', '') if old else '', dueDate=old.get('dueDate', '') if old else '', firstSeen=old.get('firstSeen', now) if old else now, lastSeen=now, auditId=audit_id, capturedAt=captured_at)
        # Only a genuinely newer live capture can remove an issue from the active queue.
        previous_capture = p.get('capturedAt')
        fresh = bool(captured_at and (not previous_capture or captured_at > previous_capture))
        for key, old in previous.items():
            if key not in incoming:
                if fresh and old.get('code') in (evaluated or set()):
                    incoming[key] = dict(old, status='not_detected', lastCheckedAudit=audit_id)
                else:
                    incoming[key] = old
        p['findings'] = list(incoming.values())
        if captured_at and fresh: p['capturedAt'] = captured_at

    @router.get('')
    def list_projects():
        with connection() as db:
            projects = [json.loads(r[0]) for r in db.execute('SELECT payload FROM workspace_projects')]
            for item in projects:
                products = [summary(json.loads(r[0])) for r in db.execute('SELECT payload FROM workspace_products WHERE project_id=?', (item['id'],))]
                item.update(products=len(products), open=sum(p['open'] for p in products), high=sum(p['high'] for p in products), audits=db.execute('SELECT COUNT(*) FROM workspace_audits WHERE project_id=?', (item['id'],)).fetchone()[0])
        return dict(projects=sorted(projects, key=lambda x: x['created'], reverse=True), storage='Railway volume', scope='Shared team workspace')

    @router.post('/projects', status_code=201)
    def create_project(body: ProjectInput):
        if not body.name.strip(): raise HTTPException(400, 'Project name cannot be blank.')
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT COUNT(*) FROM workspace_projects').fetchone()[0] >= 100: raise HTTPException(409, 'Project limit reached.')
            p = dict(id=secrets.token_hex(16), name=body.name.strip(), description=body.description.strip(), created=time.time())
            db.execute('INSERT INTO workspace_projects VALUES (?,?)', (p['id'], json.dumps(p)))
        return p

    @router.get('/projects/{project_id}')
    def get_project(project_id: str):
        with connection() as db:
            p = project(db, project_id)
            products = [json.loads(r[0]) for r in db.execute('SELECT payload FROM workspace_products WHERE project_id=?', (project_id,))]
            audits = [json.loads(r[0]) for r in db.execute('SELECT payload FROM workspace_audits WHERE project_id=? ORDER BY created DESC LIMIT 100', (project_id,))]
        queue = [dict(f, productId=item['id'], productTitle=item['row'].get('title_en') or item['row'].get('sku') or item['identity'], revision=item['revision']) for item in products for f in item['findings']]
        return dict(project=p, products=sorted([summary(item) for item in products], key=lambda x: (x['high'], x['open'], x['updated']), reverse=True), findings=queue, audits=[dict(id=j['id'], created=j['created'], total=j['total'], status=j['status'], mode=j.get('mode', 'csv'), reassessedFrom=j.get('reassessedFrom'), timings=j.get('timings', {})) for j in audits])

    @router.post('/projects/{project_id}/products', status_code=201)
    def import_products(project_id: str, body: ImportInput):
        try: rows = [clean_row(row) for row in body.rows]
        except ValueError as e: raise HTTPException(400, str(e))
        # Validate the entire import before committing any records.
        for row in rows: identity(row)
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            project(db, project_id)
            ids = []
            for row in rows:
                p = upsert(db, project_id, row)
                if not p['audits']:
                    p['row'] = row
                    p['coverage'] = coverage(row)
                    merge_findings(p, baseline_findings(row))
                    p['revision'] += 1
                    p['updated'] = time.time()
                    event(p, 'imported', 'Catalog fields imported; these facts have not been independently verified.')
                save_product(db, p)
                ids.append(p['id'])
        return dict(productIds=list(dict.fromkeys(ids)), imported=len(set(ids)))

    @router.post('/projects/{project_id}/audits', status_code=201)
    def attach_audit(project_id: str, body: AttachInput):
        job = get_job(body.jobId)
        if job['status'] not in ('completed', 'failed'): raise HTTPException(409, 'Wait for the audit to finish before saving it.')
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            project(db, project_id)
            existing = db.execute('SELECT project_id FROM workspace_audits WHERE id=?', (body.jobId,)).fetchone()
            if existing:
                if existing[0] != project_id: raise HTTPException(409, 'This audit is already saved in another project.')
                return dict(saved=True, id=body.jobId, alreadySaved=True)
            # The archive retains full evidence metadata, findings and timing, never a CDP URL.
            db.execute('INSERT INTO workspace_audits VALUES (?,?,?,?)', (job['id'], project_id, job['created'], json.dumps(dict(job, projectId=project_id))))
            imported = 0
            sources = job.get('sourceRows', [])
            for result in job.get('results', []):
                live = result.get('live')
                if live and live.get('status') != 'completed': continue
                index = result.get('rowIndex', 0)
                raw = live.get('extracted', {}) if live else (sources[index] if index < len(sources) else {})
                row = clean_row(raw)
                if not row.get('product_url') and not row.get('sku'): continue
                p = upsert(db, project_id, row)
                captured = live.get('auditedAt') if live else None
                # Archived runs may be imported out of order. Preserve the newest capture as current.
                older = bool(captured and p.get('capturedAt') and captured < p['capturedAt']) or (not captured and p.get('latestAuditCreated', 0) > job['created'])
                p['audits'].append(dict(id=job['id'], rowIndex=index, created=job['created'], capturedAt=captured, status=job['status'], reassessedFrom=job.get('reassessedFrom')))
                if not older:
                    issues = [dict(f, checkScope='page_rules') for f in baseline_findings(row) + (live.get('technical', []) if live else [])] + [dict(f, checkScope='detail_review') for f in result.get('quality', {}).get('findings', [])]
                    evaluated = {f['code'] for f in baseline_findings(p['row'])}
                    if live:
                        evaluated.update(f['code'] for f in p['findings'] if f.get('checkScope') == 'page_rules')
                    quality = result.get('quality', {})
                    prior_quality = p.get('latestResult', {}).get('quality', {})
                    if quality.get('status') == 'completed':
                        matched_urls = {s['url'] for s in quality.get('sources', []) if s.get('status') == 'matched_model'}
                        evaluated.update(f['code'] for f in prior_quality.get('findings', []) if not f.get('sourceUrl') or f['sourceUrl'] in matched_urls)
                    merge_findings(p, issues, job['id'], captured, evaluated)
                    p.update(row=row, latestAudit=job['id'], latestAuditCreated=job['created'], latestResult=result, coverage=coverage(row))
                p['revision'] += 1
                p['updated'] = time.time()
                event(p, 'audit_saved', 'Audit saved with original capture time and source evidence.')
                save_product(db, p)
                imported += 1
        return dict(saved=True, id=body.jobId, products=imported)

    @router.get('/products/{product_id}')
    def get_product(product_id: str):
        with connection() as db: return product(db, product_id)

    @router.patch('/products/{product_id}/findings/{finding_id}')
    def update_finding(product_id: str, finding_id: str, body: FindingInput):
        if body.dueDate:
            try: date.fromisoformat(body.dueDate)
            except ValueError: raise HTTPException(400, 'Use a valid calendar due date.')
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            p = product(db, product_id)
            if p['revision'] != body.revision: raise HTTPException(409, 'This product changed. Reload it before saving your review.')
            f = next((f for f in p['findings'] if f['id'] == finding_id), None)
            if not f: raise HTTPException(404, 'Finding not found.')
            f.update(status=body.status, owner=body.owner.strip(), note=body.note.strip(), dueDate=body.dueDate, reviewedAt=time.time())
            p['revision'] += 1
            p['updated'] = time.time()
            event(p, 'finding_reviewed', f['finding'] + ': ' + body.status.replace('_', ' '))
            save_product(db, p)
        return p

    @router.put('/products/{product_id}/drafts')
    def save_draft(product_id: str, body: DraftInput):
        if not body.fields or not set(body.fields).issubset(DRAFT_FIELDS) or any(len(v) > 12000 for v in body.fields.values()): raise HTTPException(400, 'Use supported content fields, up to 12,000 characters each.')
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            p = product(db, product_id)
            if p['revision'] != body.revision: raise HTTPException(409, 'This product changed. Reload it before saving your draft.')
            for field, value in body.fields.items():
                p['drafts'][field] = dict(value=value, savedAt=time.time(), basedOnAudit=p.get('latestAudit'), note=body.note, status='draft')
            p['revision'] += 1
            p['updated'] = time.time()
            event(p, 'draft_saved', 'Content draft saved for editorial review: ' + ', '.join(body.fields))
            save_product(db, p)
        return p

    @router.get('/projects/{project_id}/export')
    def export_project(project_id: str):
        with connection() as db:
            p = project(db, project_id)
            products = [json.loads(r[0]) for r in db.execute('SELECT payload FROM workspace_products WHERE project_id=?', (project_id,))]
            audits = [json.loads(r[0]) for r in db.execute('SELECT payload FROM workspace_audits WHERE project_id=? ORDER BY created', (project_id,))]
        return dict(version='fepy-workspace-v1', exportedAt=time.time(), project=p, products=products, audits=audits, evidenceNote='Screenshot binaries are served separately from the authenticated evidence endpoints. Back up the Railway volume to retain them.')

    router.archive_job = lambda project_id, job_id: attach_audit(project_id, AttachInput(jobId=job_id))
    return router
