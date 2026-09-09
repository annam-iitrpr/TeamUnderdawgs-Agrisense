"""Behaviour of the authenticated platform surface: identity, tenancy, versions and replays."""
from __future__ import annotations

from tests.platform.conftest import FIELD, SEASON


def test_every_route_rejects_missing_and_unknown_credentials(harness):
    from agrisense.contracts_generated.routes import ROUTES
    for method, path, *_ in ROUTES:
        url = '/api/v1' + path.replace('{id}', 'some-id')
        anonymous = harness.request(method, url, json={})
        assert anonymous.status_code == 401, f'{method} {path} allowed an anonymous caller'
        assert anonymous.json()['error']['code'] == 'UNAUTHENTICATED'
        unknown = harness.request(method, url, json={}, headers={'Authorization': 'Bearer forged-token'})
        assert unknown.status_code == 401, f'{method} {path} accepted an unverifiable token'


def test_enrollment_is_idempotent_and_profile_round_trips(asha):
    first = asha.get('/me')
    assert first.status_code == 200
    assert first.json()['data']['display_name'] == 'Asha'
    assert first.json()['meta']['request_id'] != asha.get('/me').json()['meta']['request_id']
    patched = asha.patch('/me', {'expected_version': 1, 'preferred_language': 'hi'})
    assert patched.status_code == 200
    assert patched.json()['data']['preferred_language'] == 'hi'
    assert patched.json()['data']['version'] == 2
    stale = asha.patch('/me', {'expected_version': 1, 'preferred_language': 'mr'})
    assert stale.status_code == 409
    assert stale.json()['error']['code'] == 'VERSION_CONFLICT'


def test_tenant_isolation_hides_another_farmers_records(asha, ravi, field, season):
    assert ravi.get(f'/fields/{field["id"]}').status_code == 404
    assert ravi.get(f'/seasons/{season["id"]}').status_code == 404
    assert ravi.patch(f'/fields/{field["id"]}', {'expected_version': 1, 'name': 'Taken'}).status_code == 404
    assert ravi.get('/fields').json()['data']['items'] == []
    assert asha.get('/fields').json()['data']['items'][0]['id'] == field['id']


def test_identity_fields_in_the_body_are_refused(asha):
    response = asha.post('/fields', {**FIELD, 'farmer_id': 'someone-else'})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_REQUEST'


def test_repeated_key_replays_the_first_result_and_conflicting_input_is_refused(asha):
    first = asha.post('/fields', FIELD, key='stable-create-key')
    replay = asha.post('/fields', FIELD, key='stable-create-key')
    assert first.status_code == replay.status_code == 201
    assert first.json()['data']['id'] == replay.json()['data']['id']
    assert len(asha.get('/fields').json()['data']['items']) == 1
    conflicting = asha.post('/fields', {**FIELD, 'name': 'Different'}, key='stable-create-key')
    assert conflicting.status_code == 409
    assert conflicting.json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'
    assert asha.client.post('/api/v1/fields', json=FIELD, headers={'Authorization': 'Bearer token-asha'}).status_code == 422


def test_season_allocation_cannot_exceed_the_field(asha, field):
    assert asha.post(f'/fields/{field["id"]}/seasons', {**SEASON, 'allocated_area_ha': 1.5}).status_code == 201
    overflow = asha.post(f'/fields/{field["id"]}/seasons', {**SEASON, 'crop_id': 'wheat', 'allocated_area_ha': 1.0})
    assert overflow.status_code == 422
    assert overflow.json()['error']['code'] == 'AREA_ALLOCATION_EXCEEDED'
    shrink = asha.patch(f'/fields/{field["id"]}', {'expected_version': 1, 'area_ha': 1.0})
    assert shrink.status_code == 422


def test_journal_entry_supersedes_the_current_recommendation_and_writes_an_outbox_event(asha, season, harness):
    from agrisense.platform import db as d
    from sqlalchemy import select
    entry = asha.post(f'/seasons/{season["id"]}/journal',
                      {'action': 'watered', 'occurred_at': '2026-09-09T04:00:00Z',
                       'quantities': [{'value': 12.0, 'unit': 'mm'}], 'cost_inr': 250.0, 'text': 'Irrigated'})
    assert entry.status_code == 201, entry.text
    listed = asha.get(f'/seasons/{season["id"]}/journal').json()['data']['items']
    assert [item['id'] for item in listed] == [entry.json()['data']['id']]
    with harness.app.state.sessions() as session:
        ledger = list(session.scalars(select(d.LedgerRow)))
        assert sorted(line.kind for line in ledger) == ['cost', 'irrigation']
        kinds = [row.kind for row in session.scalars(select(d.OutboxRow))]
        assert 'journal.confirmed' in kinds and 'season.updated' in kinds
    assert asha.get(f'/seasons/{season["id"]}').json()['data']['version'] == 2


def test_pagination_is_bounded_and_cursors_do_not_repeat_items(asha):
    created = {asha.post('/fields', {**FIELD, 'name': f'Plot {index}'}).json()['data']['id'] for index in range(5)}
    seen, cursor = [], None
    for _ in range(5):
        page = asha.get('/fields', params={'limit': 2, **({'cursor': cursor} if cursor else {})}).json()['data']
        seen += [item['id'] for item in page['items']]
        cursor = page['next_cursor']
        if not cursor:
            break
    assert set(seen) == created and len(seen) == len(created)
    assert asha.get('/fields', params={'limit': 500}).status_code == 422
    assert asha.get('/fields', params={'cursor': 'not-base64!!'}).status_code == 422


def test_unimplemented_science_capabilities_report_dependency_state_rather_than_guessing(asha, season, field):
    for path in (f'/seasons/{season["id"]}/water', f'/seasons/{season["id"]}/economics', '/catalog/crops'):
        response = asha.get(path)
        assert response.status_code == 503
        assert response.json()['error'] == {'code': 'DEPENDENCY_UNAVAILABLE', 'message': response.json()['error']['message'], 'details': {}, 'retryable': True}
    comparison = asha.post('/planning/compare', {'field_id': field['id'], 'proposed_season': {'start_date': '2026-10-01', 'end_date': '2027-02-01'}, 'candidate_crop_ids': ['rice']})
    assert comparison.status_code == 503


def test_archiving_requires_closed_seasons_and_health_probes_answer(asha, field, season, harness):
    blocked = asha.post(f'/fields/{field["id"]}/archive', {'expected_version': 1})
    assert blocked.status_code == 409
    assert blocked.json()['error']['code'] == 'ACTIVE_SEASONS_EXIST'
    closed = asha.post(f'/seasons/{season["id"]}/close', {
        'expected_version': 1, 'harvest_quantity_kg': 3200.0, 'product_form': 'paddy', 'moisture_basis': '14%',
        'harvested_area_ha': 1.0, 'realized_sales_inr': 74000.0, 'realized_costs_inr': 41000.0, 'harvested_on': '2027-01-20'})
    assert closed.status_code == 200, closed.text
    assert closed.json()['data']['closure']['actual_margin_inr'] == 33000.0
    assert asha.post(f'/seasons/{season["id"]}/journal', {'action': 'observation', 'occurred_at': '2027-01-21T04:00:00Z'}).status_code == 409
    version = asha.get(f'/fields/{field["id"]}').json()['data']['version']
    assert asha.post(f'/fields/{field["id"]}/archive', {'expected_version': version}).status_code == 200
    # The documented paths, plus the aliases kept for the container probe and monitoring.
    for path in ('/health/live', '/healthz', '/livez'):
        assert harness.get(path).json() == {'status': 'ok'}, path
    for path in ('/health/ready', '/readyz'):
        assert harness.get(path).json() == {'status': 'ready'}, path


def test_the_catalog_is_served_from_the_reference_bundle_never_invented(asha, monkeypatch):
    """Until Phase 2's bundle is present the catalog reports its dependency rather than guessing."""
    from agrisense.contracts_generated import models as c
    from agrisense.platform import science

    assert asha.get('/catalog/crops').status_code == 503

    bundle = c.ReferenceBundle(
        version='test-bundle',
        crops=[c.Crop(id=f'crop-{index}', name=f'Crop {index}', supported_for_biological_advice=index < 2)
               for index in range(5)],
        products=[])
    monkeypatch.setattr(science, 'references', lambda: bundle)

    page = asha.get('/catalog/crops', params={'limit': 2})
    assert page.status_code == 200
    body = page.json()['data']
    assert [item['id'] for item in body['items']] == ['crop-0', 'crop-1']
    assert body['next_cursor']

    rest = asha.get('/catalog/crops', params={'limit': 10, 'cursor': body['next_cursor']}).json()['data']
    assert [item['id'] for item in rest['items']] == ['crop-2', 'crop-3', 'crop-4']
    assert rest['next_cursor'] is None
    # Products come from the same bundle, and an empty catalog is an empty page, not an error.
    assert asha.get('/catalog/products').json()['data']['items'] == []
    assert asha.get('/catalog/crops', params={'limit': 0}).status_code == 422
    # Location search has no source yet and says so rather than returning invented places.
    assert asha.get('/catalog/locations', params={'q': 'nagpur'}).status_code == 503
