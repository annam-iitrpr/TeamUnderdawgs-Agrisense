"""Isolated in-memory platform harness. Token verification is stubbed only inside tests."""
from __future__ import annotations

import os
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault('AGRISENSE_ENV_FILE', '/dev/null')


@dataclass
class StubVerifier:
    """Stands in for Firebase. Any unknown token is rejected exactly as the real verifier would."""
    identities: dict

    def verify(self, token: str, sensitive: bool = False):
        from agrisense.platform.errors import PlatformError
        identity = self.identities.get(token)
        if identity is None:
            raise PlatformError('UNAUTHENTICATED', 'Please sign in again.', 401)
        return identity


@pytest.fixture
def harness():
    from agrisense.config import Settings
    from agrisense.platform import db as d
    from agrisense.platform.app import create_app
    from agrisense.platform.auth import Identity

    settings = Settings(app_env='test', database_url='sqlite://', firebase_project_id='demo-agrisense')
    app = create_app(settings)
    d.Base.metadata.create_all(app.state.engine)
    identities = {
        'token-asha': Identity('uid-asha', True, 'Asha'),
        'token-ravi': Identity('uid-ravi', True, 'Ravi'),
        'token-unverified': Identity('uid-unverified', False, 'Unverified'),
    }
    app.state.verifier = StubVerifier(identities)
    with TestClient(app) as client:
        yield client
    app.state.engine.dispose()


class Caller:
    def __init__(self, client, token):
        self.client = client
        self.token = token
        self.counter = 0

    def request(self, method, path, json=None, key=None, **kwargs):
        headers = {'Authorization': f'Bearer {self.token}'}
        if method in ('POST', 'DELETE'):
            self.counter += 1
            headers['Idempotency-Key'] = key or f'{self.token}-key-{self.counter}'
        return self.client.request(method, '/api/v1' + path, json=json, headers=headers, **kwargs)

    def get(self, path, **kwargs):
        return self.request('GET', path, **kwargs)

    def post(self, path, json=None, **kwargs):
        return self.request('POST', path, json=json, **kwargs)

    def patch(self, path, json=None, **kwargs):
        return self.request('PATCH', path, json=json, **kwargs)

    def delete(self, path, **kwargs):
        return self.request('DELETE', path, **kwargs)


@pytest.fixture
def asha(harness):
    return Caller(harness, 'token-asha')


@pytest.fixture
def ravi(harness):
    return Caller(harness, 'token-ravi')


FIELD = {'name': 'North plot', 'area_ha': 2.0, 'entered_area': 2.0, 'entered_area_unit': 'ha',
         'centroid': {'latitude': 21.1, 'longitude': 79.1, 'source': 'manual'}}
SEASON = {'crop_id': 'rice', 'allocated_area_ha': 1.0}


@pytest.fixture
def field(asha):
    response = asha.post('/fields', FIELD)
    assert response.status_code == 201, response.text
    return response.json()['data']


@pytest.fixture
def season(asha, field):
    response = asha.post(f'/fields/{field["id"]}/seasons', SEASON)
    assert response.status_code == 201, response.text
    return response.json()['data']
