"""Live Firebase verification against the real project.

Skipped unless FIREBASE_API_KEY and FIREBASE_PROJECT_ID are present, so CI and offline runs
stay green without credentials. The account it creates is deleted before the test returns.
"""
from __future__ import annotations

import json
import os
import secrets
import urllib.error
import urllib.request

import pytest
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.platform import db as d
from agrisense.platform.auth import FirebaseVerifier, enroll
from agrisense.platform.errors import PlatformError

API_KEY = os.environ.get('FIREBASE_API_KEY', '')
PROJECT = os.environ.get('FIREBASE_PROJECT_ID', '')
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not (API_KEY and PROJECT), reason='live Firebase credentials are not present'),
]


def identity_toolkit(endpoint: str, body: dict) -> dict:
    request = urllib.request.Request(
        f'https://identitytoolkit.googleapis.com/v1/accounts:{endpoint}?key={API_KEY}',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(request, timeout=30))
    except urllib.error.HTTPError as error:
        return {'error': json.load(error)['error']['message']}


@pytest.fixture
def live_token():
    account = identity_toolkit('signUp', {
        'email': f'agrisense-test-{secrets.token_hex(6)}@example.com',
        'password': secrets.token_urlsafe(18), 'returnSecureToken': True})
    if 'error' in account:
        pytest.skip(f'Firebase sign-up unavailable: {account["error"]}')
    try:
        yield account['idToken']
    finally:
        identity_toolkit('delete', {'idToken': account['idToken']})


def verifier() -> FirebaseVerifier:
    return FirebaseVerifier(Settings(app_env='development', database_url='postgresql://unused/db',
                                     firebase_project_id=PROJECT))


def test_a_real_id_token_verifies_and_a_tampered_one_does_not(live_token):
    checker = verifier()
    identity = checker.verify(live_token)
    assert identity.uid and isinstance(identity.email_verified, bool)
    for bad in (live_token[:-4] + 'AAAA', 'not-a-token', ''):
        with pytest.raises(PlatformError) as raised:
            checker.verify(bad)
        assert raised.value.status == 401


def test_enrollment_from_a_real_identity_is_idempotent(live_token):
    identity = verifier().verify(live_token)
    settings = Settings(app_env='test', database_url='sqlite://', firebase_project_id=PROJECT)
    engine = d.make_engine(settings)
    d.Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            first = enroll(session, identity)
            session.commit()
            assert enroll(session, identity) == first
            session.commit()
            # A repeated sign-in must never create a second tenant for the same person.
            assert session.query(d.Tenant).count() == 1
            assert session.query(d.FarmerRow).count() == 1
    finally:
        engine.dispose()
