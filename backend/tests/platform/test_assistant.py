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
        def ask(settings, records, turns, images=None):
            self.prompts.append(str(records))
            self.images = images or []
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


async def test_an_identifier_the_target_already_carries_does_not_destroy_the_proposal(
        harness, asha, season, monkeypatch):
    """The model repeats season_id inside values; the contract model forbids extra fields."""
    draft = ('{"kind":"proposal","text":"Record it?","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             f'"values":{{"season_id":"{season["id"]}","action":"watered",'
             '"occurred_at":"2026-09-09T04:00:00Z"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'I watered'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        proposal = session.scalar(select(d.ProposalRow))
        assert proposal is not None, 'a repeated identifier discarded a valid proposal'
        # The narrowing drops the echoed id rather than trusting it.
        assert 'season_id' not in proposal.payload['new_values']


async def test_a_malformed_draft_fails_the_proposal_not_the_whole_reply(
        harness, asha, season, monkeypatch):
    draft = ('{"kind":"proposal","text":"Recording.","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"teleported","occurred_at":"not-a-timestamp"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'something odd'})
    assert await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings) == 1
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.ProposalRow)).all() == []
        job = session.scalar(select(d.JobRow))
        assert job.status == 'succeeded', 'a bad draft failed the whole reply'
    replies = [m for m in asha.get(f'/conversations/{convo["id"]}/messages').json()['data']['items']
               if m['role'] == 'assistant']
    assert len(replies) == 1 and replies[0]['proposal_ids'] == []


async def test_an_empty_model_response_is_retried_rather_than_stored_as_a_reply(
        harness, asha, season, monkeypatch):
    """A spent output budget yields an empty body; that is a transient fault, not an answer."""
    from agrisense.config import Settings
    from agrisense.platform import assistant
    from agrisense.platform.errors import PlatformError

    class Empty:
        text = '   '

    class Models:
        def generate_content(self, **kwargs): return Empty()

    class Client:
        models = Models()

    monkeypatch.setattr(assistant, 'client', lambda settings: Client())
    with pytest.raises(PlatformError) as raised:
        assistant.ask(Settings(app_env='test'), {}, [])
    assert raised.value.code == 'ASSISTANT_UNREADABLE' and raised.value.retryable is True


async def test_a_proposal_can_be_read_before_it_is_confirmed(harness, asha, ravi, season, monkeypatch):
    """Confirming a change a farmer cannot see would be asking for blind approval."""
    draft = ('{"kind":"proposal","text":"Record it?","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"watered","occurred_at":"2026-09-09T04:00:00Z","cost_inr":250.0}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'I watered'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        proposal_id = session.scalar(select(d.ProposalRow)).id

    seen = asha.get(f'/proposals/{proposal_id}')
    assert seen.status_code == 200, seen.text
    body = seen.json()['data']
    assert body['operation'] == 'journal.create'
    assert body['status'] == 'pending'
    assert body['new_values']['cost_inr'] == 250.0
    assert body['expected_version'] == 1
    # Another farmer cannot read it at all.
    assert ravi.get(f'/proposals/{proposal_id}').status_code == 404

    from datetime import timedelta
    with harness.app.state.sessions() as session:
        session.get(d.ProposalRow, proposal_id).expires_at = d.utcnow() - timedelta(minutes=1)
        session.commit()
    # An expired proposal reads as expired rather than looking confirmable.
    assert asha.get(f'/proposals/{proposal_id}').json()['data']['status'] == 'expired'


async def test_confirm_takes_the_proposals_own_version_not_the_targets(
        harness, asha, season, monkeypatch):
    """Two version fields sit on a proposal and mean different things."""
    draft = ('{"kind":"proposal","text":"Record it?","operation":"journal.create",'
             f'"target_id":"{season["id"]}","expected_version":1,'
             '"values":{"action":"watered","occurred_at":"2026-09-09T04:00:00Z"}}')
    StubModel(draft).install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'I watered'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    with harness.app.state.sessions() as session:
        proposal_id = session.scalar(select(d.ProposalRow)).id

    body = asha.get(f'/proposals/{proposal_id}').json()['data']
    # The proposal's own version is what confirm expects.
    accepted = asha.post(f'/proposals/{proposal_id}/confirm', {'expected_version': body['version']})
    assert accepted.status_code == 200, accepted.text
    assert len(asha.get(f'/seasons/{season["id"]}/journal').json()['data']['items']) == 1


def test_an_integer_detail_stays_an_integer(asha, field):
    """A version rendered as 1.0 reads as a bug to a client parsing it."""
    stale = asha.patch(f'/fields/{field["id"]}', {'expected_version': 99, 'name': 'x'})
    assert stale.status_code == 409
    current = stale.json()['error']['details']['current_version']
    assert current == 1 and isinstance(current, int) and not isinstance(current, bool)


async def test_an_attached_photo_reaches_the_model(harness, asha, season, monkeypatch):
    """A farmer who attaches a photo must not be told the assistant cannot see it."""
    import hashlib
    from urllib.parse import urlsplit


    png = b'\x89PNG\r\n\x1a\x0a' + b'synthetic pixels'
    ticket = asha.post('/media/uploads', {'filename': 'leaf.png', 'content_type': 'image/png',
                                          'size_bytes': len(png)}).json()['data']
    parts = urlsplit(ticket['upload_url'])
    assert harness.put(f'{parts.path}?{parts.query}', content=png).status_code == 204
    asset_id = ticket['asset']['id']
    assert asha.post(f'/media/{asset_id}/complete',
                     {'sha256': hashlib.sha256(png).hexdigest()}).status_code == 200

    stub = StubModel('{"kind":"answer","text":"The leaf looks discoloured."}').install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages',
              {'text': 'What do you see?', 'media_ids': [asset_id]})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)

    assert stub.images, 'the attached photo never reached the model'
    assert stub.images[0][1] == 'image/png'
    assert stub.images[0][0] == png


async def test_another_farmers_photo_is_never_attached(harness, asha, ravi, season, monkeypatch):
    import hashlib
    from urllib.parse import urlsplit

    png = b'\x89PNG\r\n\x1a\x0a' + b'ravi private pixels'
    ticket = ravi.post('/media/uploads', {'filename': 'r.png', 'content_type': 'image/png',
                                          'size_bytes': len(png)}).json()['data']
    parts = urlsplit(ticket['upload_url'])
    harness.put(f'{parts.path}?{parts.query}', content=png)
    ravi.post(f'/media/{ticket["asset"]["id"]}/complete', {'sha256': hashlib.sha256(png).hexdigest()})

    stub = StubModel('{"kind":"answer","text":"ok"}').install(monkeypatch)
    convo = conversation_for(asha, season)
    # Asha references Ravi's asset id; the message itself is refused.
    refused = asha.post(f'/conversations/{convo["id"]}/messages',
                        {'text': 'look', 'media_ids': [ticket['asset']['id']]})
    assert refused.status_code == 404
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    assert not getattr(stub, 'images', [])


async def test_an_attachment_the_model_rejects_does_not_lose_the_reply(
        harness, asha, season, monkeypatch):
    """A truncated recording must not cost the farmer their answer."""
    import hashlib
    from urllib.parse import urlsplit

    from agrisense.platform import assistant

    blob = b'\x1a\x45\xdf\xa3' + b'not really audio'
    ticket = asha.post('/media/uploads', {'filename': 'v.webm', 'content_type': 'audio/webm',
                                          'size_bytes': len(blob)}).json()['data']
    parts = urlsplit(ticket['upload_url'])
    harness.put(f'{parts.path}?{parts.query}', content=blob)
    asha.post(f'/media/{ticket["asset"]["id"]}/complete',
              {'sha256': hashlib.sha256(blob).hexdigest()})

    seen: list[bool] = []

    def ask(settings, records, turns, images=None):
        seen.append(bool(images))
        if images:
            raise RuntimeError('400 INVALID_ARGUMENT')
        assert records.get('attachment_unreadable') is True
        import json as _json
        return _json.loads('{"kind":"answer","text":"I could not play that recording."}')

    monkeypatch.setattr(assistant, 'ask', ask)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages',
              {'text': '', 'media_ids': [ticket['asset']['id']]})
    assert await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings) == 1

    # Tried with the attachment, then again without it.
    assert seen == [True, False]
    with harness.app.state.sessions() as session:
        assert session.scalar(select(d.JobRow)).status == 'succeeded'
    replies = [m for m in asha.get(f'/conversations/{convo["id"]}/messages').json()['data']['items']
               if m['role'] == 'assistant']
    assert len(replies) == 1 and 'could not play' in replies[0]['text']


async def test_a_voice_question_is_written_back_so_the_farmer_can_read_it(
        harness, asha, season, monkeypatch):
    """A voice note leaves the farmer's own turn blank; the transcription fills it."""
    import hashlib
    from urllib.parse import urlsplit

    wav = b'RIFF' + (36).to_bytes(4, 'little') + b'WAVEfmt ' + bytes(24) + b'data' + bytes(8)
    ticket = asha.post('/media/uploads', {'filename': 'q.wav', 'content_type': 'audio/wav',
                                          'size_bytes': len(wav)}).json()['data']
    parts = urlsplit(ticket['upload_url'])
    harness.put(f'{parts.path}?{parts.query}', content=wav)
    asha.post(f'/media/{ticket["asset"]["id"]}/complete',
              {'sha256': hashlib.sha256(wav).hexdigest()})

    StubModel('{"kind":"answer","text":"No watering is recorded.",'
              '"heard":"मैंने पिछली बार पानी कब दिया?"}').install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages',
              {'text': '', 'media_ids': [ticket['asset']['id']]})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)

    items = asha.get(f'/conversations/{convo["id"]}/messages').json()['data']['items']
    asked = next(m for m in items if m['role'] == 'user')
    assert asked['text'] == 'मैंने पिछली बार पानी कब दिया?'
    assert asked['media_ids'] == [ticket['asset']['id']]


async def test_a_typed_question_is_never_overwritten_by_a_transcription(
        harness, asha, season, monkeypatch):
    StubModel('{"kind":"answer","text":"ok","heard":"something else entirely"}').install(monkeypatch)
    convo = conversation_for(asha, season)
    asha.post(f'/conversations/{convo["id"]}/messages', {'text': 'What did I spend?'})
    await worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings)
    items = asha.get(f'/conversations/{convo["id"]}/messages').json()['data']['items']
    asked = next(m for m in items if m['role'] == 'user')
    assert asked['text'] == 'What did I spend?'
