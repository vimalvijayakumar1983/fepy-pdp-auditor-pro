import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
import cloud_browser as cloud

class CloudTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        @contextmanager
        def connection():
            with sqlite3.connect(Path(self.folder.name) / 'test.db') as db:
                yield db
        self.connection = connection
        def auth(authorization: str = Header(default='')):
            if authorization != 'Bearer test': raise HTTPException(401, 'Unauthorized')
        app = FastAPI()
        app.include_router(cloud.build_router(connection, auth))
        self.client = TestClient(app)
        self.auth = {'Authorization': 'Bearer test'}
        self.provider = {'id': '12345678-1234-1234-1234-123456789abc', 'status': 'active', 'liveUrl': 'https://live.browser-use.com/session-secret', 'cdpUrl': 'wss://private.example/cdp-secret'}
    def tearDown(self): self.folder.cleanup()
    def create(self):
        with patch.object(cloud, 'provider_request', return_value=self.provider) as provider:
            response = self.client.post('/browser-sessions', headers=self.auth)
        self.assertEqual(response.status_code, 201)
        return response.json(), provider
    def test_uae_blank_session_and_no_credentials_in_response(self):
        item, provider = self.create()
        args = provider.call_args.args
        self.assertEqual(args[:2], ('POST', '/browsers'))
        self.assertEqual(args[2]['proxyCountryCode'], 'ae')
        self.assertFalse(args[2]['solveCaptchas'])
        self.assertFalse(args[2]['enableRecording'])
        self.assertNotIn('startUrl', args[2])
        self.assertNotIn('cdpUrl', item)
        self.assertNotIn('providerId', item)
        self.assertNotIn('cdp-secret', str(item))
    def test_auth_missing_key_and_invalid_id(self):
        self.assertEqual(self.client.post('/browser-sessions').status_code, 401)
        with patch.dict(os.environ, {'BROWSER_USE_API_KEY': ''}):
            self.assertEqual(self.client.post('/browser-sessions',headers=self.auth).status_code,503)
        self.assertEqual(self.client.get('/browser-sessions/invalid',headers=self.auth).status_code,404)
    def test_capacity_and_stop(self):
        item, _ = self.create()
        self.create()
        with patch.object(cloud,'provider_request') as provider:
            self.assertEqual(self.client.post('/browser-sessions',headers=self.auth).status_code,429)
            provider.assert_not_called()
        with patch.object(cloud,'provider_request',return_value={'status':'stopped'}) as provider:
            stopped=self.client.delete('/browser-sessions/'+item['id'],headers=self.auth)
            self.assertEqual(provider.call_args.args[2],{'action':'stop'})
        self.assertIsNone(stopped.json()['liveUrl'])
        self.assertIsNone(cloud.lookup(self.connection,item['id'])['cdpUrl'])
    def test_access_gate_before_new_network_audit(self):
        item,_=self.create()
        with patch.dict(os.environ,{'FEPY_AUDITOR_ACCESS_APPROVED':''}):
            with self.assertRaises(HTTPException) as raised:
                cloud.session_for_audit(self.connection,item['id'])
            self.assertEqual(raised.exception.status_code,409)
        with patch.dict(os.environ,{'FEPY_AUDITOR_ACCESS_APPROVED':'true'}):
            self.assertEqual(cloud.session_for_audit(self.connection,item['id']),self.provider['cdpUrl'])
    def test_unexpected_live_host_rejected(self):
        with patch.object(cloud,'provider_request',return_value={**self.provider,'liveUrl':'https://attacker.example'}):
            self.assertEqual(self.client.post('/browser-sessions',headers=self.auth).status_code,502)

if __name__ == '__main__': unittest.main()
