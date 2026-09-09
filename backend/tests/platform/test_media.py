"""Media custody: a ticket authorises one object, and only verified bytes become readable."""
from __future__ import annotations

import hashlib
from urllib.parse import urlsplit

import pytest

PNG = b'\x89PNG\r\n\x1a\n' + b'synthetic test image bytes'
JPEG = b'\xff\xd8\xff' + b'synthetic test image bytes'


def ask(caller, content_type='image/png', size=None, **extra):
    size = len(PNG) if size is None else size
    return caller.post('/media/uploads', {'filename': 'card.png', 'content_type': content_type,
                                          'size_bytes': size, **extra})


def put(harness, url, data):
    parts = urlsplit(url)
    return harness.put(f'{parts.path}?{parts.query}', content=data)


def upload(harness, caller, data=PNG, content_type='image/png'):
    ticket = ask(caller, content_type, len(data)).json()['data']
    assert put(harness, ticket['upload_url'], data).status_code == 204
    return ticket


def test_a_ticket_never_carries_the_bytes_and_confirms_only_on_a_matching_digest(harness, asha):
    ticket = upload(harness, asha)
    asset_id = ticket['asset']['id']
    assert ticket['asset']['status'] == 'pending'
    assert ticket['method'] == 'PUT'
    assert asha.get(f'/media/{asset_id}/access').status_code == 409

    wrong = asha.post(f'/media/{asset_id}/complete', {'sha256': hashlib.sha256(b'other').hexdigest()})
    assert wrong.status_code == 422 and wrong.json()['error']['code'] == 'MEDIA_DIGEST_MISMATCH'

    done = asha.post(f'/media/{asset_id}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()})
    assert done.status_code == 200, done.text
    assert done.json()['data']['status'] == 'ready'
    access = asha.get(f'/media/{asset_id}/access')
    assert access.status_code == 200
    assert access.json()['data']['url'].startswith('http')


def test_declared_type_must_match_the_stored_bytes(harness, asha):
    ticket = ask(asha, 'image/png', len(JPEG)).json()['data']
    assert put(harness, ticket['upload_url'], JPEG).status_code == 204
    response = asha.post(f'/media/{ticket["asset"]["id"]}/complete', {'sha256': hashlib.sha256(JPEG).hexdigest()})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'MEDIA_TYPE_MISMATCH'


def test_declared_size_must_match_the_stored_bytes(harness, asha):
    ticket = ask(asha, 'image/png', len(PNG) + 100).json()['data']
    assert put(harness, ticket['upload_url'], PNG).status_code == 204
    response = asha.post(f'/media/{ticket["asset"]["id"]}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'MEDIA_SIZE_MISMATCH'


def test_upload_links_cannot_be_forged_or_replayed_after_expiry(harness, asha):
    url = ask(asha).json()['data']['upload_url']
    parts = urlsplit(url)
    tampered = parts.query.replace('signature=', 'signature=ff')
    assert harness.put(f'{parts.path}?{tampered}', content=PNG).status_code == 403
    stale = '&'.join(part if not part.startswith('expires=') else 'expires=1' for part in parts.query.split('&'))
    assert harness.put(f'{parts.path}?{stale}', content=PNG).status_code == 403


def test_another_farmer_cannot_confirm_or_read_someone_elses_asset(harness, asha, ravi):
    ticket = upload(harness, asha)
    asset_id = ticket['asset']['id']
    assert ravi.post(f'/media/{asset_id}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()}).status_code == 404
    asha.post(f'/media/{asset_id}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()})
    assert ravi.get(f'/media/{asset_id}/access').status_code == 404


def test_object_keys_are_tenant_prefixed_and_cannot_escape_the_media_root(harness, asha):
    from agrisense.config import Settings
    from agrisense.platform import media
    from agrisense.platform.errors import PlatformError
    ticket = ask(asha).json()['data']
    with harness.app.state.sessions() as session:
        from agrisense.platform import db as d
        from sqlalchemy import select
        row = session.scalar(select(d.MediaRow).where(d.MediaRow.id == ticket['asset']['id']))
        assert row.object_key.startswith('tenants/') and row.tenant_id in row.object_key
    with pytest.raises(PlatformError):
        media.local_path(Settings(app_env='test'), '../../../etc/passwd')


def test_an_unconfirmed_asset_cannot_be_attached_to_a_journal_entry(harness, asha, season):
    ticket = upload(harness, asha)
    blocked = asha.post(f'/seasons/{season["id"]}/journal', {
        'action': 'observation', 'occurred_at': '2026-09-09T04:00:00Z', 'media_ids': [ticket['asset']['id']]})
    assert blocked.status_code == 409 and blocked.json()['error']['code'] == 'MEDIA_NOT_READY'
    asha.post(f'/media/{ticket["asset"]["id"]}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()})
    allowed = asha.post(f'/seasons/{season["id"]}/journal', {
        'action': 'observation', 'occurred_at': '2026-09-09T04:00:00Z', 'media_ids': [ticket['asset']['id']]})
    assert allowed.status_code == 201, allowed.text


def test_soil_extraction_requires_a_confirmed_asset_and_is_queued(harness, asha, field):
    ticket = upload(harness, asha)
    asset_id = ticket['asset']['id']
    early = asha.post('/soil/extractions', {'field_id': field['id'], 'media_id': asset_id})
    assert early.status_code == 409
    asha.post(f'/media/{asset_id}/complete', {'sha256': hashlib.sha256(PNG).hexdigest()})
    queued = asha.post('/soil/extractions', {'field_id': field['id'], 'media_id': asset_id})
    assert queued.status_code == 202, queued.text
    assert queued.json()['data']['kind'] == 'soil.extract'
