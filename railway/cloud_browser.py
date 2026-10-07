"""Private Browser Use Cloud sessions with an explicit UAE egress route."""
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException

API = 'https://api.browser-use.com/api/v4'
LOCK = threading.Lock()


def provider_request(method, path, payload=None):
    key = os.getenv('BROWSER_USE_API_KEY', '').strip()
    if not key:
        raise HTTPException(503, 'Add BROWSER_USE_API_KEY to the Railway worker to activate the live UAE browser.')
    try:
        response = httpx.request(method, API + path, json=payload, headers={'X-Browser-Use-API-Key': key}, timeout=15, trust_env=False)
    except httpx.HTTPError:
        raise HTTPException(502, 'Browser Use could not be reached. Creation is not automatically retried; check the provider dashboard before retrying.')
    if response.status_code not in (200, 201):
        messages = {401: 'Browser Use API key was rejected.', 402: 'Browser Use account needs available credits.', 422: 'Browser Use rejected the UAE session settings. No alternative country was requested.', 429: 'Browser Use session limit reached.'}
        raise HTTPException(response.status_code if response.status_code in messages else 502, messages.get(response.status_code, 'Browser Use session request failed.'))
    try:
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except ValueError:
        raise HTTPException(502, 'Browser Use returned an invalid response.')


def public_session(item):
    # CDP URL and provider API credentials must never leave the worker.
    return {key: item.get(key) for key in ('id', 'status', 'liveUrl', 'timeoutAt', 'countryCode', 'locationVerification')}


def lookup(connection, session_id):
    if not re.fullmatch(r'[a-f0-9]{32}', session_id):
        raise HTTPException(404, 'Browser session not found.')
    with connection() as db:
        found = db.execute('SELECT payload FROM browser_sessions WHERE id=?', (session_id,)).fetchone()
    if not found:
        raise HTTPException(404, 'Browser session not found.')
    return json.loads(found[0])


def persist(connection, item):
    with connection() as db:
        db.execute('INSERT OR REPLACE INTO browser_sessions VALUES (?,?,?)', (item['id'], item['created'], json.dumps(item)))


def session_for_audit(connection, session_id):
    if os.getenv('FEPY_AUDITOR_ACCESS_APPROVED', '').lower() != 'true':
        raise HTTPException(409, 'FEPY blocked the existing audit browser. Its administrator must permit the authorised auditor before using a new UAE session for automated FEPY audits. Then set FEPY_AUDITOR_ACCESS_APPROVED=true on the worker.')
    item = lookup(connection, session_id)
    if item['status'] != 'active' or item['expires'] <= time.time() or not item.get('cdpUrl'):
        raise HTTPException(409, 'Start an active UAE browser session before auditing.')
    return item['cdpUrl']


def build_router(connection, require_auth):
    router = APIRouter(dependencies=[Depends(require_auth)])
    with connection() as db:
        db.execute('CREATE TABLE IF NOT EXISTS browser_sessions (id TEXT PRIMARY KEY, created REAL, payload TEXT)')

    @router.get('/browser-sessions')
    def browser_capabilities():
        with connection() as db:
            active = [json.loads(value) for (value,) in db.execute('SELECT payload FROM browser_sessions ORDER BY created DESC').fetchall()]
        resumable = [{key: item.get(key) for key in ('id', 'status', 'timeoutAt', 'countryCode')} for item in active if item['status'] == 'active' and item['expires'] > time.time()]
        return {'activeSessions': resumable, 'configured': bool(os.getenv('BROWSER_USE_API_KEY', '').strip()), 'countryCode': 'ae', 'sessionMinutes': 30, 'auditAccessApproved': os.getenv('FEPY_AUDITOR_ACCESS_APPROVED', '').lower() == 'true'}

    @router.post('/browser-sessions', status_code=201)
    def create_session():
        with LOCK:
            with connection() as db:
                sessions = [json.loads(value) for (value,) in db.execute('SELECT payload FROM browser_sessions').fetchall()]
            if sum(item['status'] == 'active' and item['expires'] > time.time() for item in sessions) >= 2:
                raise HTTPException(429, 'Stop an existing live browser before opening another.')
            # Start blank. Never retry FEPY via a new network route after a known access block.
            data = provider_request('POST', '/browsers', {'proxyCountryCode': 'ae', 'timeout': 30, 'browserScreenWidth': 1365, 'browserScreenHeight': 900, 'allowResizing': True, 'solveCaptchas': False, 'enableRecording': False})
            provider_id = data.get('id', '')
            if not re.fullmatch(r'[a-fA-F0-9-]{36}', provider_id):
                raise HTTPException(502, 'Browser Use returned an invalid session identifier.')
            live = data.get('liveUrl')
            if live and (urlparse(live).scheme != 'https' or urlparse(live).hostname != 'live.browser-use.com'):
                try:
                    provider_request('PATCH', '/browsers/' + provider_id, {'action': 'stop'})
                except HTTPException:
                    pass
                raise HTTPException(502, 'Browser Use returned an unexpected live-view host.')
            created = time.time()
            item = {'id': secrets.token_hex(16), 'providerId': provider_id, 'created': created, 'expires': created + 1800, 'countryCode': 'ae', 'locationVerification': 'UAE route requested; IP location not independently verified', **{key: data.get(key) for key in ('status', 'liveUrl', 'cdpUrl', 'timeoutAt')}}
            if data.get('timeoutAt'):
                try:
                    item['expires'] = datetime.fromisoformat(data['timeoutAt'].replace('Z', '+00:00')).timestamp()
                except ValueError:
                    pass
            persist(connection, item)
            return public_session(item)

    @router.get('/browser-sessions/{session_id}')
    def get_session(session_id: str):
        item = lookup(connection, session_id)
        if item['expires'] <= time.time():
            item['status'] = 'stopped'; item['liveUrl'] = None
            persist(connection, item)
            return public_session(item)
        data = provider_request('GET', '/browsers/' + item['providerId'])
        live = data.get('liveUrl')
        if live and (urlparse(live).scheme != 'https' or urlparse(live).hostname != 'live.browser-use.com'):
            raise HTTPException(502, 'Unexpected live-view host.')
        item.update(status=data.get('status', 'stopped'), liveUrl=live, cdpUrl=data.get('cdpUrl'), timeoutAt=data.get('timeoutAt'))
        persist(connection, item)
        return public_session(item)

    @router.delete('/browser-sessions/{session_id}')
    def stop_session(session_id: str):
        item = lookup(connection, session_id)
        provider_request('PATCH', '/browsers/' + item['providerId'], {'action': 'stop'})
        item.update(status='stopped', liveUrl=None, cdpUrl=None)
        persist(connection, item)
        return public_session(item)

    return router
