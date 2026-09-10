"""Export gives a farmer their own records back; erasure removes them, not just a flag."""
from __future__ import annotations

import hashlib
import json

from agrisense.platform import db as d
from agrisense.platform import media, worker
from sqlalchemy import select

PNG = b'\x89PNG\r\n\x1a\n' + b'synthetic test image bytes'


def populate(harness, caller, season):
    """A farmer with a journal entry, a cost, an uploaded photo and a conversation."""
    ticket = caller.post('/media/uploads', {'filename': 'p.png', 'content_type': 'image/png',
                                            'size_bytes': len(PNG)}).json()['data']
    from urllib.parse import urlsplit
    parts = urlsplit(ticket['upload_url'])
    harness.put(f'{parts.path}?{parts.query}', content=PNG)
    caller.post(f'/media/{ticket["asset"]["id"]}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()})
    caller.post(f'/seasons/{season["id"]}/journal',
                {'action': 'watered', 'occurred_at': '2026-09-09T04:00:00Z', 'cost_inr': 300.0,
                 'quantities': [{'value': 18.0, 'unit': 'mm'}],
                 'text': 'Irrigated the north plot', 'media_ids': [ticket['asset']['id']]})
    caller.post('/conversations', {'season_id': season['id']})
    return ticket['asset']['id']


async def test_export_returns_the_farmers_own_records_and_nobody_elses(harness, asha, ravi, season, field):
    populate(harness, asha, season)
    ravi.post('/fields', {'name': 'Ravi private plot', 'area_ha': 3.0, 'entered_area': 3.0,
                          'entered_area_unit': 'ha',
                          'centroid': {'latitude': 22.0, 'longitude': 78.0, 'source': 'manual'}})

    queued = asha.post('/me/export', None)
    assert queued.status_code == 202, queued.text
    assert await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings) >= 1

    job = asha.get(f'/jobs/{queued.json()["data"]["id"]}').json()['data']
    assert job['status'] == 'succeeded', job
    asset_id = job['result_id']

    with harness.app.state.sessions() as session:
        row = session.scalar(select(d.MediaRow).where(d.MediaRow.id == asset_id))
        document = json.loads(media.store(harness.app.state.settings).read(row.object_key))

    assert document['farmer']['id'] == row.farmer_id
    assert [f['name'] for f in document['fields']] == ['North plot']
    assert 'Ravi private plot' not in json.dumps(document)
    assert len(document['journal']) == 1 and document['journal'][0]['cost_inr'] == 300.0
    # Both the cost line and the irrigation line are exported.
    assert sorted(line['kind'] for line in document['cost_ledger']) == ['cost', 'irrigation']
    assert len(document['conversations']) == 1
    assert len(document['media_assets']) == 1

    # The farmer downloads it through the ordinary short-lived link.
    assert asha.get(f'/media/{asset_id}/access').status_code == 200
    assert ravi.get(f'/media/{asset_id}/access').status_code == 404


async def test_export_requires_a_verified_email(harness, asha):
    from agrisense.platform.auth import Identity
    harness.app.state.verifier.identities['token-asha'] = Identity('uid-asha', False, 'Asha')
    refused = asha.post('/me/export', None)
    assert refused.status_code == 403
    assert refused.json()['error']['code'] == 'IDENTITY_VERIFICATION_REQUIRED'


async def test_deletion_removes_the_records_and_the_stored_objects(harness, asha, ravi, season, field):
    asset_id = populate(harness, asha, season)
    ravi.get('/me')
    ravi.post('/fields', {'name': 'Ravi keeps this', 'area_ha': 3.0, 'entered_area': 3.0,
                          'entered_area_unit': 'ha',
                          'centroid': {'latitude': 22.0, 'longitude': 78.0, 'source': 'manual'}})

    sessions = harness.app.state.sessions
    settings = harness.app.state.settings
    with sessions() as session:
        key = session.scalar(select(d.MediaRow).where(d.MediaRow.id == asset_id)).object_key
    assert media.store(settings).read(key) == PNG

    queued = asha.delete('/me')
    assert queued.status_code == 202, queued.text
    assert await worker.drain_jobs(sessions, settings) >= 1
    with sessions() as session:
        # The job record is erased with the account it belonged to.
        assert session.scalar(select(d.JobRow).where(d.JobRow.kind == 'privacy.delete')) is None

    with sessions() as session:
        # Nothing of this farmer's survives.
        assert session.scalars(select(d.JournalRow)).all() == []
        assert session.scalars(select(d.ConversationRow)).all() == []
        assert session.scalar(select(d.MediaRow).where(d.MediaRow.id == asset_id)) is None
        assert [row.name for row in session.scalars(select(d.FieldRow))] == ['Ravi keeps this']
        assert session.scalar(select(d.User).where(d.User.firebase_uid == 'uid-asha')) is None
        # The other farmer is untouched.
        assert session.scalar(select(d.User).where(d.User.firebase_uid == 'uid-ravi')) is not None

    try:
        media.store(settings).read(key)
        raise AssertionError('the stored object survived erasure')
    except Exception:
        pass

    # The other farmer still works normally afterwards.
    assert ravi.get('/fields').json()['data']['items'][0]['name'] == 'Ravi keeps this'


async def test_deletion_requires_a_verified_email(harness, asha):
    from agrisense.platform.auth import Identity
    asha.get('/me')
    harness.app.state.verifier.identities['token-asha'] = Identity('uid-asha', False, 'Asha')
    refused = asha.delete('/me')
    assert refused.status_code == 403
    assert refused.json()['error']['code'] == 'IDENTITY_VERIFICATION_REQUIRED'


async def test_the_erasure_removes_its_own_job_record_along_with_the_account(harness, asha, season):
    """The job row references the tenant being erased, so it cannot outlive it."""
    sessions = harness.app.state.sessions
    populate(harness, asha, season)
    assert asha.delete('/me').status_code == 202
    with sessions() as session:
        assert session.scalar(select(d.JobRow).where(d.JobRow.kind == 'privacy.delete')) is not None

    assert await worker.drain_jobs(sessions, harness.app.state.settings) >= 1
    with sessions() as session:
        # No job row, and no dangling reference to a tenant that no longer exists.
        # A surviving row here would have failed the foreign key on commit.
        assert session.scalars(select(d.JobRow)).all() == []
        assert session.scalars(select(d.FarmerRow)).all() == []


async def test_a_phone_only_account_can_export_and_delete(harness, asha):
    """Export and deletion are data rights, not features.

    Phone accounts carry no email at all, so gating these on a verified *email*
    would lock a farmer who signed in by SMS out of their own records. An SMS
    sign-in only completes after the account has received a code at that number,
    so possession is already proved.
    """
    from agrisense.platform.auth import Identity

    asha.get('/me')
    # What the verifier produces for a phone sign-in: verified, but with no
    # email anywhere in the token.
    harness.app.state.verifier.identities['token-asha'] = Identity('uid-asha', True, 'Asha')

    exported = asha.post('/me/export', None)
    assert exported.status_code == 202, exported.text
    assert exported.json()['data']['kind'] == 'privacy.export'

    deleted = asha.delete('/me')
    assert deleted.status_code == 202, deleted.text
    assert deleted.json()['data']['kind'] == 'privacy.delete'


def test_a_phone_claim_alone_verifies_an_identity_but_an_empty_one_does_not(monkeypatch):
    """The claim mapping, which is where the phone/email equivalence is decided.

    A phone sign-in sets `phone_number` and leaves `email_verified` false. An
    empty string is not proof of anything and must not pass.
    """
    from agrisense.config import Settings
    from agrisense.platform import auth as module

    verifier = module.FirebaseVerifier(Settings(app_env='test', database_url='sqlite://',
                                                firebase_project_id='demo-agrisense'))

    def claims_for(payload):
        monkeypatch.setattr(module.auth, 'verify_id_token', lambda *a, **k: payload)
        monkeypatch.setattr(module.firebase_admin, 'get_app', lambda name=None: object())
        return verifier.verify('token')

    # Phone only: no email claim at all, yet the number was proved by SMS.
    assert claims_for({'sub': 'u1', 'phone_number': '+919620577459'}).identity_verified is True
    # Email only, the historical path.
    assert claims_for({'sub': 'u1', 'email_verified': True}).identity_verified is True
    # Neither.
    assert claims_for({'sub': 'u1'}).identity_verified is False
    assert claims_for({'sub': 'u1', 'email_verified': False}).identity_verified is False
    # An empty number is not a number.
    assert claims_for({'sub': 'u1', 'phone_number': ''}).identity_verified is False
