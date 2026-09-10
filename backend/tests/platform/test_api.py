"""Behaviour of the authenticated platform surface: identity, tenancy, versions and replays."""
from __future__ import annotations

import pytest
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
    for path in (f'/seasons/{season["id"]}/water', f'/seasons/{season["id"]}/economics'):
        response = asha.get(path)
        assert response.status_code == 503
        assert response.json()['error'] == {'code': 'DEPENDENCY_UNAVAILABLE', 'message': response.json()['error']['message'], 'details': {}, 'retryable': True}
    # Planning needs historical climate, which needs a provider key; without one it says so.
    comparison = asha.post('/planning/compare', {'field_id': field['id'], 'proposed_season': {'start_date': '2026-10-01', 'end_date': '2027-02-01'}, 'candidate_crop_ids': ['rice']})
    assert comparison.status_code == 503
    assert comparison.json()['error']['code'] == 'DEPENDENCY_UNAVAILABLE'


def test_archiving_requires_closed_seasons_and_health_probes_answer(asha, field, season, harness):
    blocked = asha.post(f'/fields/{field["id"]}/archive', {'expected_version': 1})
    assert blocked.status_code == 409
    assert blocked.json()['error']['code'] == 'ACTIVE_SEASONS_EXIST'
    closed = asha.post(f'/seasons/{season["id"]}/close', {
        'expected_version': 1, 'harvest_quantity_kg': 3200.0, 'product_form': 'paddy', 'moisture_basis': '14%',
        'harvested_area_ha': 1.0, 'realized_sales_inr': 74000.0, 'realized_costs_inr': 41000.0, 'harvested_on': '2026-08-20'})
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


def test_closing_a_season_scores_it_against_the_forecasts_on_record(asha, season):
    """Closure returns real metrics, not a placeholder warning.

    The platform used to answer both /close and /summary with "Science
    forecast-error evaluation pending integration" while Phase 2's
    summarize_season sat unused. A farmer who entered their harvest got no
    comparison at all, which is the entire point of closing a season.
    """
    closed = asha.post(f'/seasons/{season["id"]}/close', {
        'expected_version': 1, 'harvest_quantity_kg': 4200.0, 'product_form': 'grain',
        'moisture_basis': 'dry_basis', 'harvested_area_ha': 1.0,
        'realized_sales_inr': 92000.0, 'realized_costs_inr': 54000.0,
        'harvested_on': '2026-08-20'})
    assert closed.status_code == 200, closed.text
    body = closed.json()['data']
    metrics = {row['name']: row for row in body['metrics']}
    assert metrics, 'closing produced no metrics'

    # Margin is recomputed by the science from stored sales and costs; a stale
    # supplied margin must never survive a revision.
    assert metrics['actual_margin']['value'] == 38000.0
    assert metrics['actual_margin']['unit'] == 'INR'
    assert metrics['actual_margin']['denominator_policy'] == 'none'

    # ROI over a non-zero cost, with the denominator policy stated so the figure
    # is comparable to anything else claiming to be an ROI.
    assert metrics['actual_roi']['value'] == pytest.approx(100 * 38000 / 54000)
    assert metrics['actual_roi']['denominator_policy'] == 'null_when_cost_zero'

    # No forecast-error claim is made, because vintage economics forecasts are
    # not stored. Saying so beats implying the comparison was complete.
    assert 'vintage_economics_forecasts_missing_no_error_claim' in body['warnings']

    # The same answer is reachable afterwards, so the review survives a reload.
    again = asha.get(f'/seasons/{season["id"]}/summary')
    assert again.status_code == 200
    assert again.json()['data']['metrics'] == body['metrics']


def test_closure_scoring_survives_a_stored_evaluation_bundle(asha, season, harness):
    """A season that was actually evaluated must still score.

    `RecommendationRow.payload` holds the whole EvaluationBundle, not a bare
    Recommendation. Handing the bundle to the science raised twenty-one
    validation errors in production while every test passed, because the fixture
    season has no evaluation at all. This inserts one so the shape is exercised.
    """
    from datetime import timedelta

    from agrisense.contracts_generated import models as c
    from agrisense.platform import db as d

    now = d.utcnow()
    recommendation = c.Recommendation(
        id='rec_test_bundle_shape', field_id=season['field_id'], season_id=season['id'],
        input_version=1, input_hash='hash', generated_at=now, expires_at=now + timedelta(hours=1),
        rule_version='advisory_v1.0.0', status='insufficient_data',
        readiness=None, need=None, timing_fit=None, viability=None,
        selected_window=None, reasons=[],
    )
    bundle = c.EvaluationBundle(recommendation=recommendation, data_mode='live')

    from sqlalchemy import select as sa_select

    sessions = harness.app.state.sessions
    with sessions() as session:
        season_row = session.scalar(sa_select(d.SeasonRow).where(d.SeasonRow.id == season['id']))
        field_row = session.scalar(sa_select(d.FieldRow).where(d.FieldRow.id == season_row.field_id))
        session.add(d.RecommendationRow(
            id=recommendation.id, tenant_id=season_row.tenant_id, farmer_id=field_row.farmer_id,
            season_id=season['id'], input_hash='hash', input_version=1, superseded=False,
            payload=bundle.model_dump(mode='json'), snapshot={},
        ))
        session.commit()

    closed = asha.post(f'/seasons/{season["id"]}/close', {
        'expected_version': 1, 'harvest_quantity_kg': 4200.0, 'product_form': 'grain',
        'moisture_basis': 'dry_basis', 'harvested_area_ha': 1.0,
        'realized_sales_inr': 92000.0, 'realized_costs_inr': 54000.0,
        'harvested_on': '2026-08-20'})
    assert closed.status_code == 200, closed.text
    body = closed.json()['data']
    assert body['closure']['forecast_snapshot_ids'] == [recommendation.id]
    metrics = {row['name']: row['value'] for row in body['metrics']}
    assert metrics['actual_margin'] == 38000.0, body['warnings']


def test_a_future_harvest_date_is_refused_not_quietly_unscoreable(asha, season):
    """A typo in the outcome record would corrupt every later forecast score."""
    from datetime import timedelta

    from agrisense.platform import db as d

    tomorrow = (d.utcnow() + timedelta(days=2)).date().isoformat()
    response = asha.post(f'/seasons/{season["id"]}/close', {
        'expected_version': 1, 'harvest_quantity_kg': 100.0, 'product_form': 'grain',
        'moisture_basis': 'dry_basis', 'harvested_area_ha': 1.0,
        'realized_sales_inr': 1.0, 'realized_costs_inr': 1.0, 'harvested_on': tomorrow})
    assert response.status_code == 422, response.text
    assert response.json()['error']['code'] == 'INVALID_HARVEST_DATE'
    # The season stays open, so the farmer can correct the date and try again.
    assert asha.get(f'/seasons/{season["id"]}').json()['data']['status'] != 'closed'


def test_re_evaluating_an_unchanged_season_does_not_collide(asha, season, harness):
    """A refresh of a season whose facts have not changed must still store.

    `uq_recommendation_snapshot` is UNIQUE(season_id, input_hash), and the hash
    covered farm facts only — not the weather. So re-evaluating an unchanged
    season produced the same hash and the insert failed, permanently, with the
    job retrying against a constraint that could never be satisfied. That is
    exactly what a farmer does when their advice expires: nothing about the
    field changed, only the clock and the forecast.

    This drives `store_evaluation` directly, since a real evaluation needs live
    weather. Two evaluations of identical facts with different weather must both
    persist and the older must be marked superseded.
    """
    from datetime import timedelta

    from agrisense.contracts_generated import models as c
    from agrisense.platform import db as d
    from agrisense.platform import science
    from sqlalchemy import select as sa_select

    sessions = harness.app.state.sessions
    with sessions() as session:
        row = session.scalar(sa_select(d.SeasonRow).where(d.SeasonRow.id == season['id']))
        field = session.scalar(sa_select(d.FieldRow).where(d.FieldRow.id == row.field_id))
        snapshot = science.build_season_snapshot(session, row.tenant_id, season['id'], d.utcnow())

        stored = []
        for index in (0, 1):
            now = d.utcnow() + timedelta(minutes=index)
            recommendation = c.Recommendation(
                id=f'rec_refresh_{index}', field_id=row.field_id, season_id=season['id'],
                input_version=row.version, input_hash='ignored', generated_at=now,
                expires_at=now + timedelta(hours=1), rule_version='advisory_v1.0.0',
                status='insufficient_data', readiness=None, need=None, timing_fit=None,
                viability=None, selected_window=None, reasons=[])
            bundle = c.EvaluationBundle(recommendation=recommendation, data_mode='live')
            # Identical facts, a genuinely different weather read.
            per_run = snapshot.model_copy(update={'input_hash': science.snapshot_hash({
                'facts': snapshot.input_hash,
                'forecast_payload': f'payload-{index}',
                'forecast_retrieved_at': now.isoformat(),
            })})
            stored.append(science.store_evaluation(
                session, row.tenant_id, field.farmer_id, row, bundle, per_run))
        session.commit()

        assert stored[0].input_hash != stored[1].input_hash, (
            'identical facts with different weather produced the same identity, '
            'so a refresh would collide'
        )
        rows = list(session.scalars(sa_select(d.RecommendationRow).where(
            d.RecommendationRow.season_id == season['id'])))
        assert len(rows) == 2
        live = [r for r in rows if not r.superseded]
        assert [r.id for r in live] == ['rec_refresh_1'], 'the older advice was not retired'


def test_a_farmer_can_record_a_soil_moisture_reading_dated_today(asha, field, season):
    """The only soil input that can satisfy the water balance.

    Observations could previously only come from a photographed Soil Health
    Card, whose `sampled_on` is the lab date. The water balance needs the
    moisture in the root zone *now*, so every water figure was unreachable no
    matter what the farmer did.
    """
    from agrisense.platform import db as d

    today = d.utcnow().astimezone(
        __import__('zoneinfo').ZoneInfo('Asia/Kolkata')
    ).date().isoformat()
    created = asha.post('/soil/readings', {
        'field_id': field['id'], 'sampled_on': today,
        'moisture': {'value': 0.24, 'unit': 'm³/m³'}, 'moisture_basis': 'volumetric',
        'depth_cm': 30})
    assert created.status_code == 201, created.text
    body = created.json()['data']
    assert body['sampled_on'] == today
    assert body['moisture']['value'] == 0.24
    # A self-reported figure must never be mistaken for a lab result, and there
    # is nothing for the farmer to approve in a value they typed themselves.
    assert body['source'] == 'farmer'
    assert body['confirmation_state'] == 'confirmed'

    # The reading has to change the advice, not sit in a record nobody reads:
    # every open season on the field is bumped so it re-evaluates.
    assert asha.get(f'/seasons/{season["id"]}').json()['data']['version'] > 1


def test_a_soil_reading_cannot_be_dated_in_the_future(asha, field):
    from datetime import timedelta

    from agrisense.platform import db as d

    ahead = (d.utcnow() + timedelta(days=3)).date().isoformat()
    response = asha.post('/soil/readings', {
        'field_id': field['id'], 'sampled_on': ahead,
        'moisture': {'value': 0.24, 'unit': 'm³/m³'}, 'moisture_basis': 'volumetric'})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_SAMPLE_DATE'


def test_a_soil_reading_cannot_be_attached_to_another_farmers_field(ravi, field):
    """Tenancy holds on the new route as it does everywhere else."""
    from agrisense.platform import db as d

    today = d.utcnow().date().isoformat()
    response = ravi.post('/soil/readings', {
        'field_id': field['id'], 'sampled_on': today,
        'moisture': {'value': 0.24, 'unit': 'm³/m³'}, 'moisture_basis': 'volumetric'})
    assert response.status_code == 404, response.text


def test_summary_before_closing_says_so_rather_than_scoring_nothing(asha, season):
    response = asha.get(f'/seasons/{season["id"]}/summary')
    assert response.status_code == 200
    body = response.json()['data']
    assert body['closure'] is None
    assert body['metrics'] == []
    assert body['warnings'] == ['Season has not been closed.']


def test_a_zero_cost_season_reports_roi_as_unknown_not_as_infinite(asha, season):
    """Dividing by a zero cost has no answer, and the metric says which."""
    closed = asha.post(f'/seasons/{season["id"]}/close', {
        'expected_version': 1, 'harvest_quantity_kg': 100.0, 'product_form': 'grain',
        'moisture_basis': 'dry_basis', 'harvested_area_ha': 1.0,
        'realized_sales_inr': 5000.0, 'realized_costs_inr': 0.0,
        'harvested_on': '2026-08-20'})
    assert closed.status_code == 200, closed.text
    roi = next(row for row in closed.json()['data']['metrics'] if row['name'] == 'actual_roi')
    assert roi['value'] is None
    assert roi['missing_reason'] == 'zero_cost'


def test_the_catalog_is_served_from_the_reference_bundle_never_invented(asha, monkeypatch):
    """Until Phase 2's bundle is present the catalog reports its dependency rather than guessing."""
    from agrisense.contracts_generated import models as c
    from agrisense.platform import science

    # With the science package present the catalog serves the reviewed bundle.
    live = asha.get('/catalog/crops')
    assert live.status_code == 200
    assert [item['id'] for item in live.json()['data']['items']]

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


def test_a_conversation_reads_in_the_order_it_happened(asha, season, harness):
    """Ordering by id alone would order a conversation by random identifier."""
    from datetime import timedelta

    from agrisense.platform import db as d
    from sqlalchemy import select

    convo = asha.post('/conversations', {'season_id': season['id']}).json()['data']
    texts = [f'message number {index}' for index in range(6)]
    for text in texts:
        assert asha.post(f'/conversations/{convo["id"]}/messages', {'text': text}).status_code == 201

    # Force distinct creation times; the ids stay random, as they are in production.
    with harness.app.state.sessions() as session:
        base = d.utcnow()
        for offset, row in enumerate(session.scalars(select(d.MessageRow).order_by(d.MessageRow.id))):
            row.created_at = base + timedelta(seconds=offset)
        session.commit()
        expected = [row.payload['text'] for row in session.scalars(
            select(d.MessageRow).order_by(d.MessageRow.created_at, d.MessageRow.id))]

    seen, cursor = [], None
    for _ in range(6):
        page = asha.get(f'/conversations/{convo["id"]}/messages',
                        params={'limit': 2, **({'cursor': cursor} if cursor else {})}).json()['data']
        seen += [item['text'] for item in page['items']]
        cursor = page['next_cursor']
        if not cursor:
            break
    assert seen == expected, 'messages did not read in the order they happened'
    assert len(seen) == len(texts)


def test_a_page_boundary_does_not_skip_or_repeat_records_sharing_a_timestamp(asha, season, harness):
    """Identical creation times are common in a burst, so the id must break the tie."""
    from agrisense.platform import db as d
    from sqlalchemy import select

    convo = asha.post('/conversations', {'season_id': season['id']}).json()['data']
    for index in range(5):
        asha.post(f'/conversations/{convo["id"]}/messages', {'text': f'burst {index}'})
    with harness.app.state.sessions() as session:
        moment = d.utcnow()
        for row in session.scalars(select(d.MessageRow)):
            row.created_at = moment
        session.commit()

    seen, cursor = [], None
    for _ in range(6):
        page = asha.get(f'/conversations/{convo["id"]}/messages',
                        params={'limit': 2, **({'cursor': cursor} if cursor else {})}).json()['data']
        seen += [item['id'] for item in page['items']]
        cursor = page['next_cursor']
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 5


async def test_planning_compares_crops_against_past_climate_never_a_forecast(asha, field, monkeypatch):
    """A ten-day forecast is not a season's climate, so planning uses reanalysis."""
    from agrisense.contracts_generated import models as c
    from agrisense.platform import science

    captured: dict[str, object] = {}

    async def climate(location, period, as_of, settings):
        captured['period'] = period
        return c.ClimateBundle(location=location, period=period, daily=[],
                               provenance=[c.Provenance(source='reanalysis', data_mode='estimated')],
                               data_mode='estimated')

    def compare(snapshot, references, climate_bundle):
        captured['snapshot'] = snapshot
        captured['climate'] = climate_bundle
        return c.CropComparison(candidates=[], data_mode='estimated',
                                warnings=['No reviewed regional records for this location.'])

    monkeypatch.setattr(science, 'climate_for', climate)
    monkeypatch.setattr(science, 'facade', lambda name: compare)

    response = asha.post('/planning/compare', {
        'field_id': field['id'],
        'proposed_season': {'start_date': '2026-10-01', 'end_date': '2027-02-01'},
        'candidate_crop_ids': ['rice', 'wheat'], 'available_water_m3': 5000.0})
    assert response.status_code == 200, response.text
    body = response.json()['data']
    # Absent reviewed evidence is a structured comparison with reasons, not a 503.
    assert body['candidates'] == []
    assert body['warnings']
    assert captured['climate'].data_mode == 'estimated'
    # The snapshot carries the caller's own field, and the request it actually made.
    assert captured['snapshot'].field.id == field['id']
    assert captured['snapshot'].request.candidate_crop_ids == ['rice', 'wheat']


def test_planning_refuses_a_field_that_is_not_the_callers(ravi, field):
    refused = ravi.post('/planning/compare', {
        'field_id': field['id'],
        'proposed_season': {'start_date': '2026-10-01', 'end_date': '2027-02-01'},
        'candidate_crop_ids': ['rice']})
    assert refused.status_code == 404


def test_advice_retired_by_the_farmers_own_reading_says_so(asha, field, season, harness):
    """"Nobody has asked" is the wrong thing to tell someone who just asked.

    Recording a soil moisture reading bumps every open season on the field,
    which supersedes the advice that reading was meant to improve — correctly,
    because the water balance now has an input it did not have before. But the
    read path answered 503 for a superseded row exactly as it does for a season
    nobody ever evaluated, so the dashboard told a farmer who had done
    everything the app asked that nobody had asked for advice, and their
    evaluation appeared to have been thrown away.
    """
    from datetime import timedelta

    from agrisense.contracts_generated import models as c
    from agrisense.platform import db as d
    from agrisense.platform import science
    from sqlalchemy import select as sa_select

    # A season nobody has evaluated is genuinely unavailable, not superseded.
    never = asha.get(f'/seasons/{season["id"]}/recommendations/latest')
    assert never.status_code == 503, never.text

    sessions = harness.app.state.sessions
    with sessions() as session:
        row = session.scalar(sa_select(d.SeasonRow).where(d.SeasonRow.id == season['id']))
        owner = session.scalar(sa_select(d.FieldRow).where(d.FieldRow.id == row.field_id))
        snapshot = science.build_season_snapshot(session, row.tenant_id, season['id'], d.utcnow())
        now = d.utcnow()
        recommendation = c.Recommendation(
            id='rec_superseded', field_id=row.field_id, season_id=season['id'],
            input_version=row.version, input_hash='ignored', generated_at=now,
            # Well inside its 45-minute life, so an expiry cannot explain the result.
            expires_at=now + timedelta(hours=1), rule_version='advisory_v1.0.0',
            status='insufficient_data', readiness=None, need=None, timing_fit=None,
            viability=None, selected_window=None, reasons=[])
        science.store_evaluation(session, row.tenant_id, owner.farmer_id, row,
                                 c.EvaluationBundle(recommendation=recommendation,
                                                    data_mode='live'), snapshot)
        session.commit()

    assert asha.get(f'/seasons/{season["id"]}/recommendations/latest').status_code == 200

    today = d.utcnow().astimezone(
        __import__('zoneinfo').ZoneInfo('Asia/Kolkata')
    ).date().isoformat()
    assert asha.post('/soil/readings', {
        'field_id': field['id'], 'sampled_on': today,
        'moisture': {'value': 0.20, 'unit': 'm³/m³'}, 'moisture_basis': 'volumetric',
        'depth_cm': 30}).status_code == 201

    stale = asha.get(f'/seasons/{season["id"]}/recommendations/latest')
    assert stale.status_code == 409, stale.text
    assert stale.json()['error']['code'] == 'RECOMMENDATION_SUPERSEDED'
    # Retryable: asking again is exactly what fixes it.
    assert stale.json()['error']['retryable'] is True
