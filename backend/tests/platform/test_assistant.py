"""The assistant may answer from the farmer's own records or draft a change. It never writes."""
from __future__ import annotations

from datetime import timedelta

import pytest
from agrisense.platform import assistant, worker
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError
from sqlalchemy import select


class StubModel:
    """Stands in for Gemini. Returns whatever draft the test wants to exercise."""

    def __init__(self, payload: str):
        self.payload = payload
        self.prompts: list[str] = []

    def install(self, monkeypatch):
        def ask(settings, records, turns):
            self.prompts.append(str(records))
            import json
            return json.loads(self.payload)
        monkeypatch.setattr(assistant, 'ask', ask)
        return self


def conversation_for(caller, season):
    response = caller.post('/conversations', {'season_id': season['id'], 'language': 'en'})
    assert response.status_code == 201, response.text
    return response.json()['data']


def test_without_a_configured_model_the_assistant_reports_its_dependency(harness, asha, season):
    convo = conversation_for(asha, season)
    posted = asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'What should I spray?'})
    assert posted.status_code == 201
    sessions = harness.app.state.sessions
    with sessions() as session:
        job = session.scalar(select(d.JobRow).where(d.JobRow.kind == 'assistant.reply'))
        assert job is not None
    with pytest.raises(PlatformError) as raised:
        assistant.client(harness.app.state.settings)
    assert raised.value.code == 'DEPENDENCY_UNAVAILABLE'


async def test_an_answer_becomes_an_assistant_message_grounded_in_the_farmers_records(
        harness, asha, season, field, monkeypatch):
    stub = StubModel('{"kind":"answer","text":"You last watered on 9 September."}').install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'When did I last water?'})
    assert await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings) == 1

    messages = asha.get(f'/conversations/{convo["id"]}/messages').json()['data']['items']
    roles = [m['role'] for m in messages]
    assert roles == ['user', 'assistant'] or roles == ['assistant', 'user']
    answer = next(m for m in messages if m['role'] == 'assistant')
    assert answer['text'] == 'You last watered on 9 September.'
    assert answer['proposal_ids'] == []
    # The prompt carried this farmer's own field, and nothing else.
    assert field['id'] in stub.prompts[0]


async def test_a_draft_becomes_a_proposal_that_only_the_farmer_can_apply(
        harness, asha, season, monkeypatch):
    draft = ('{"kind":"proposal","text":"Shall I record that?","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"watered","occurred_at":"2026-09-09T04:00:00Z","text":"Irrigated"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'I watered this morning'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)

    with harness.app.state.sessions() as session:
        proposal = session.scalar(select(d.ProposalRow))
        assert proposal is not None and proposal.status == 'pending'
        proposal_id = proposal.id
        # Nothing was written to the journal by the assistant itself.
        assert session.scalars(select(d.JournalRow)).all() == []

    assert asha.get(f'/seasons/{season["id"]}/journal').json()['data']['items'] == []
    receipt = asha.post(f'/proposals/{proposal_id}/confirm', {'expected_version': 1})
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()['data']['status'] == 'completed'
    assert len(asha.get(f'/seasons/{season["id"]}/journal').json()['data']['items']) == 1

    # A proposal is single use.
    assert asha.post(f'/proposals/{proposal_id}/confirm', {'expected_version': 2}).status_code == 409


async def test_another_farmer_can_neither_see_nor_confirm_a_proposal(harness, asha, ravi, season, monkeypatch):
    draft = ('{"kind":"proposal","text":"Record it?","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"observation","occurred_at":"2026-09-09T04:00:00Z"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'note this'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        proposal_id = session.scalar(select(d.ProposalRow)).id
    assert ravi.post(f'/proposals/{proposal_id}/confirm', {'expected_version': 1}).status_code == 404
    assert ravi.get(f'/conversations/{convo["id"]}/messages').status_code == 404


async def test_a_hallucinated_target_never_becomes_a_proposal(harness, asha, season, monkeypatch):
    draft = ('{"kind":"proposal","text":"Recording that.","operation":"journal.create",'
             '"target_id":"season-that-does-not-exist","expected_version":1,'
             '"values":{"action":"watered","occurred_at":"2026-09-09T04:00:00Z"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'I watered'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.ProposalRow)).all() == []
    answer = [m for m in asha.get(f'/conversations/{convo["id"]}/messages').json()['data']['items']
              if m['role'] == 'assistant']
    assert len(answer) == 1 and answer[0]['proposal_ids'] == []


async def test_a_malformed_draft_is_discarded_rather_than_stored(harness, asha, season, monkeypatch):
    draft = ('{"kind":"proposal","text":"Recording.","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"teleported","occurred_at":"not-a-timestamp"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'something odd'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.ProposalRow)).all() == []


async def test_an_expired_proposal_cannot_be_confirmed(harness, asha, season, monkeypatch):
    draft = ('{"kind":"proposal","text":"Record it?","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"observation","occurred_at":"2026-09-09T04:00:00Z"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'note'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        proposal = session.scalar(select(d.ProposalRow))
        proposal.expires_at = d.utcnow() - timedelta(minutes=1)
        proposal_id = proposal.id
        session.commit()
    refused = asha.post(f'/proposals/{proposal_id}/confirm', {'expected_version': 1})
    assert refused.status_code == 409 and refused.json()['error']['code'] == 'PROPOSAL_EXPIRED'


def test_grounding_never_includes_another_farmers_records(harness, asha, ravi, season, field):
    ravi.post('/fields', {'name': 'Ravi private plot', 'area_ha': 3.0, 'entered_area': 3.0,
                          'entered_area_unit': 'ha',
                          'centroid': {'latitude': 22.0, 'longitude': 78.0, 'source': 'manual'}})
    convo = conversation_for(asha, season)
    with harness.app.state.sessions() as session:
        row = session.scalar(select(d.ConversationRow).where(d.ConversationRow.id == convo['id']))
        records = assistant.grounding(session, row.tenant_id, row.farmer_id, row)
    names = [f['name'] for f in records['fields']]
    assert 'Ravi private plot' not in names
    assert names == ['North plot']
