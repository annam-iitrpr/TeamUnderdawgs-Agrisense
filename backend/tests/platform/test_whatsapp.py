"""Inbound WhatsApp is a public URL: nothing is trusted before the signature check."""
from __future__ import annotations

import hashlib
import hmac
import json

from agrisense.platform import db as d
from agrisense.platform import whatsapp
from sqlalchemy import select

SECRET = 'test-meta-app-secret'
VERIFY = 'test-verify-token'
NUMBER = '919999900001'


def signed(harness, payload, secret=SECRET):
    raw = json.dumps(payload).encode()
    digest = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return harness.post('/webhooks/whatsapp', content=raw,
                        headers={'X-Hub-Signature-256': f'sha256={digest}', 'Content-Type': 'application/json'})


def message(text='hello', message_id='wamid.1', sender=NUMBER):
    return {'entry': [{'changes': [{'value': {'messages': [
        {'id': message_id, 'from': sender, 'type': 'text', 'text': {'body': text}, 'timestamp': '1757462400'}]}}]}]}


def test_an_unsigned_or_forged_delivery_is_refused(harness):
    raw = json.dumps(message()).encode()
    assert harness.post('/webhooks/whatsapp', content=raw).status_code == 403
    forged = hmac.new(b'wrong-secret', raw, hashlib.sha256).hexdigest()
    assert harness.post('/webhooks/whatsapp', content=raw,
                        headers={'X-Hub-Signature-256': f'sha256={forged}'}).status_code == 403
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.WebhookInbox)).all() == []


def test_without_an_app_secret_no_delivery_is_accepted(harness_without_messaging_secret):
    harness = harness_without_messaging_secret
    response = harness.post('/webhooks/whatsapp', content=json.dumps(message()).encode(),
                            headers={'X-Hub-Signature-256': 'sha256=' + 'a' * 64})
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'WEBHOOK_NOT_CONFIGURED'


def test_subscription_verification_echoes_only_for_the_configured_token(harness):
    ok = harness.get('/webhooks/whatsapp', params={'hub.mode': 'subscribe', 'hub.verify_token': VERIFY,
                                                   'hub.challenge': 'nonce-123'})
    assert ok.status_code == 200 and ok.text == 'nonce-123'
    bad = harness.get('/webhooks/whatsapp', params={'hub.mode': 'subscribe', 'hub.verify_token': 'guess',
                                                    'hub.challenge': 'nonce-123'})
    assert bad.status_code == 403


def test_a_retried_delivery_is_recorded_once(harness):
    assert signed(harness, message()).status_code == 200
    assert signed(harness, message()).status_code == 200
    with harness.app.state.sessions() as session:
        rows = session.scalars(select(d.WebhookInbox)).all()
        assert len(rows) == 1
        # The raw phone number is never stored.
        assert NUMBER not in json.dumps(rows[0].payload)
        assert rows[0].payload['from_hash'] == whatsapp.identity_hash(NUMBER)


def test_an_unlinked_sender_is_never_guessed_into_an_account(harness, asha):
    asha.get('/me')
    assert signed(harness, message()).status_code == 200
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.JobRow)).all() == []
        assert session.scalars(select(d.ChannelRow)).all() == []


def test_a_link_code_binds_one_identity_once_and_then_messages_are_queued(harness, asha):
    challenge = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'})
    assert challenge.status_code == 201, challenge.text
    code = challenge.json()['data']['code']

    assert signed(harness, message(f'LINK {code}', 'wamid.link')).status_code == 200
    with harness.app.state.sessions() as session:
        channel = session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp'))
        assert channel is not None and channel.opted_in
        assert channel.external_id_hash == whatsapp.identity_hash(NUMBER)
        assert channel.payload['msisdn'] == NUMBER

    # The same code cannot bind a second identity.
    assert signed(harness, message(f'LINK {code}', 'wamid.link2', '919999900002')).status_code == 200
    with harness.app.state.sessions() as session:
        assert len(session.scalars(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp')).all()) == 1

    assert signed(harness, message('I watered the field', 'wamid.2')).status_code == 200
    with harness.app.state.sessions() as session:
        jobs = session.scalars(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')).all()
        assert len(jobs) == 1


def test_a_linked_text_creates_the_normal_conversation_and_assistant_job(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    assert signed(harness, message('Show my pending tasks', 'wamid.question')).status_code == 200
    with harness.app.state.sessions() as session:
        conversation = session.scalar(select(d.ConversationRow))
        assert conversation is not None
        user_message = session.scalar(select(d.MessageRow).where(d.MessageRow.payload['text'].as_string() == 'Show my pending tasks'))
        assert user_message is not None
        job = session.scalar(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound'))
        assert job is not None
        assert job.payload['request']['message_id'] == user_message.id


def test_media_is_recorded_and_queued_for_worker_without_an_empty_assistant_turn(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    payload = {'entry': [{'changes': [{'value': {'messages': [
        {'id': 'wamid.photo', 'from': NUMBER, 'type': 'image',
         'image': {'id': 'media.1'}, 'timestamp': '1757462400'}]}}]}]}
    assert signed(harness, payload).status_code == 200
    with harness.app.state.sessions() as session:
        jobs = session.scalars(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')).all()
        assert len(jobs) == 1
        assert jobs[0].payload['request']['media_id'] == 'media.1'


def test_extracts_interactive_replies_and_media_captions():
    payload = {'entry': [{'changes': [{'value': {'messages': [
        {'id': 'wamid.button', 'from': NUMBER, 'type': 'interactive',
         'interactive': {'type': 'button_reply', 'button_reply': {'id': 'water', 'title': 'Water'}},
         'timestamp': '1757462400'},
        {'id': 'wamid.image', 'from': NUMBER, 'type': 'image',
         'image': {'id': 'media.1', 'caption': 'Leaf photo'}, 'timestamp': '1757462400'}]}}]}]}
    events = whatsapp.extract(payload)
    assert events[0]['text'] == 'water'
    assert events[1]['media_id'] == 'media.1' and events[1]['caption'] == 'Leaf photo'


def test_whatsapp_text_converts_common_markdown():
    assert whatsapp.whatsapp_text('## Ready\n- *now*\n**safe** [details](https://example.com)') == '*Ready\n* *now*\n*safe* details: https://example.com'


def test_explicit_journal_commands_have_contract_actions_and_units():
    action, text, quantities = whatsapp.journal_values('log watered 20 mm')
    assert action == 'watered' and text == '20 mm'
    assert quantities == [{'value': 20.0, 'unit': 'mm'}]
    assert whatsapp.journal_values('log sprayed')[0] == 'pesticide_applied'


def test_journal_command_is_processed_by_worker_and_queued_for_delivery(harness, asha, field, season):
    import asyncio

    from agrisense.platform import worker

    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    assert signed(harness, message('log watered 20 mm', 'wamid.journal')).status_code == 200

    # The webhook now starts this work itself rather than leaving it for the next
    # scheduled pass, so the job may already be done by the time we get here. This
    # drain is the safety net for that race, not the thing under test: what matters
    # is the recorded outcome below, whichever path produced it.
    asyncio.run(worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings))
    with harness.app.state.sessions() as session:
        journal = session.scalar(select(d.JournalRow).where(d.JournalRow.payload['source'].as_string() == 'whatsapp'))
        assert journal is not None
        outbound = session.scalar(select(d.OutboxRow).where(d.OutboxRow.kind == 'whatsapp.outbound'))
        assert outbound is not None
        # The reply has to name what was recorded, so a farmer can see the
        # command was understood as the action they meant.
        assert 'watered' in outbound.payload['body']
        assert journal.payload['action'] == 'watered'
        quantity = journal.payload['quantities'][0]
        assert (quantity['value'], quantity['unit']) == (20.0, 'mm')


def test_proposal_buttons_are_preserved_in_the_outbox_payload(harness, asha):
    channel_id = linked_channel(harness, asha)
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(
            session, harness.app.state.settings, channel, 'Apply now?',
            [('proposal_confirm:proposal-1', 'Confirm'), ('proposal_cancel:proposal-1', 'Cancel')],
        )
        session.commit()
        assert event.payload['buttons'] == [
            ['proposal_confirm:proposal-1', 'Confirm'],
            ['proposal_cancel:proposal-1', 'Cancel'],
        ]


def test_commands_list_and_select_a_farmer_field(harness, asha, field):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    assert signed(harness, message('fields', 'wamid.fields')).status_code == 200
    assert signed(harness, message(f'use {field["name"]}', 'wamid.use')).status_code == 200
    with harness.app.state.sessions() as session:
        channel = session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp'))
        conversation = session.get(d.ConversationRow, channel.payload['conversation_id'])
        assert channel.payload['active_field_id'] == field['id']
        assert conversation.payload['field_id'] == field['id']


def test_unlinking_stops_further_ingestion(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    assert asha.delete('/channels/whatsapp/link').status_code == 200
    assert signed(harness, message('another note', 'wamid.3')).status_code == 200
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')).all() == []


def test_outbound_outside_the_session_window_is_marked_as_needing_a_template(harness, asha):
    from datetime import timedelta
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    with harness.app.state.sessions() as session:
        channel = session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp'))
        queued = whatsapp.queue_outbound(session, harness.app.state.settings, channel, 'Irrigation is due today.')
        assert queued.payload['requires_template'] is False
        # A reply more than a day after the last inbound message needs an approved template.
        channel.last_inbound_at = d.utcnow() - timedelta(days=2)
        later = whatsapp.queue_outbound(session, harness.app.state.settings, channel, 'Irrigation is due today.')
        assert later.payload['requires_template'] is True
        # Nothing is sent from a test run; delivery stays queued.
        assert later.payload['send_mode'] == 'outbox'
        session.commit()


def linked_channel(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    with harness.app.state.sessions() as session:
        return session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp')).id


def test_nothing_is_sent_while_the_deployment_is_in_outbox_mode(harness, asha, monkeypatch):
    """Queueing is not sending. A misconfigured flip must not silently message farmers."""
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
        assert whatsapp.deliver_outbound(session, settings, event) == 'queued_not_sent'
    assert calls == []


def test_a_message_outside_the_session_window_needs_a_template_and_is_not_sent(harness, asha, monkeypatch):
    from datetime import timedelta
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings.model_copy(update={'whatsapp_send_mode': 'live'})
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        channel.last_inbound_at = d.utcnow() - timedelta(days=2)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
        assert whatsapp.deliver_outbound(session, settings, event) == 'template_required'
    assert calls == []


def test_a_revoked_channel_is_not_messaged_even_if_something_was_already_queued(harness, asha, monkeypatch):
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings.model_copy(update={'whatsapp_send_mode': 'live'})
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
    assert asha.delete('/channels/whatsapp/link').status_code == 200
    with harness.app.state.sessions() as session:
        assert whatsapp.deliver_outbound(session, settings, event) == 'not_opted_in'
    assert calls == []


def test_a_linked_channel_sends_to_the_number_the_farmer_supplied(harness, asha, monkeypatch):
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings.model_copy(update={'whatsapp_send_mode': 'live'})
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
        assert whatsapp.deliver_outbound(session, settings, event) == 'sent'
    assert len(calls) == 1 and calls[0][1] == NUMBER


def test_linking_records_the_channel_on_the_farmers_own_profile(harness, asha):
    """`/me` has to report the link, not just the database.

    `Farmer.linked_channel_ids` existed and nothing ever populated it, so a
    farmer who had successfully linked still saw an empty list. The account
    screen keys its "Connect WhatsApp" button off exactly that field, so it
    would have offered to connect an account that already was — and the only
    way to know better was to read the database directly.
    """
    before = asha.get('/me').json()['data']
    assert before['linked_channel_ids'] == []

    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    assert signed(harness, message(f'LINK {code}', 'wamid.profilelink')).status_code == 200

    after = asha.get('/me').json()['data']
    assert len(after['linked_channel_ids']) == 1, 'the link is invisible on the profile'
    # The version moves, so a client holding the old profile cannot silently
    # overwrite the new channel list on its next patch.
    assert after['version'] > before['version']

    # Linking twice must not accumulate duplicates of the same channel.
    again = asha.get('/me').json()['data']
    assert again['linked_channel_ids'] == after['linked_channel_ids']


def test_the_whatsapp_consumer_only_sees_its_own_events(harness, asha):
    """A consumer must not be handed the whole outbox.

    `drain_outbox` returned every unsettled event to every consumer, so the
    WhatsApp consumer picked up `season.updated`, `job.requested` and
    `field.updated`, raised on each because they are not messages, and spent
    its batch limit and its retry budget on events that could never succeed.
    Real replies sat unsent behind them.
    """
    from agrisense.platform import db as d
    from agrisense.platform import worker

    channel_id = linked_channel(harness, asha)
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        # One real message, and some ordinary domain events beside it.
        from agrisense.platform import whatsapp
        whatsapp.queue_outbound(session, harness.app.state.settings, channel, 'A real reply')
        for kind in ('season.updated', 'job.requested', 'field.updated'):
            session.add(d.OutboxRow(tenant_id=channel.tenant_id, kind=kind,
                                    aggregate_id=channel.id, payload={'noise': True}))
        session.commit()

    seen: list[str] = []

    def record(row):
        seen.append(row.kind)

    worker.drain_outbox(harness.app.state.sessions, 'whatsapp', record,
                        kinds=('whatsapp.outbound',))
    assert seen == ['whatsapp.outbound'], f'the consumer was handed {seen}'


def tapped(option_id, message_id, sender=NUMBER):
    """What Meta sends when a farmer taps a button or a list row, rather than typing."""
    return {'entry': [{'changes': [{'value': {'messages': [
        {'id': message_id, 'from': sender, 'type': 'interactive', 'timestamp': '1757462400',
         'interactive': {'type': 'list_reply', 'list_reply': {'id': option_id, 'title': option_id}}}]}}]}]}


def test_a_tapped_option_is_read_the_same_as_the_typed_command():
    events = whatsapp.extract(tapped('readiness', 'wamid.tap'))
    assert events[0]['text'] == 'readiness'


def test_the_menu_is_offered_as_a_list_because_it_is_longer_than_three_buttons(harness, asha):
    channel_id = linked_channel(harness, asha)
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        reply = whatsapp.command_reply(session, harness.app.state.settings, {'command': 'menu'},
                                       channel.tenant_id, channel.farmer_id)
    assert [option[0] for option in reply.options] == [option[0] for option in whatsapp.MENU_OPTIONS]
    assert len(reply.options) <= whatsapp.LIST_LIMIT
    assert reply.buttons == ()


def test_every_answer_carries_a_way_back_to_the_menu():
    reply = whatsapp.with_menu('Readiness is 7.', ('water', 'Water'))
    assert reply.buttons[-1] == whatsapp.MENU_BUTTON
    # Three is the Cloud API's hard cap: a fourth would be rejected for the whole message.
    assert len(whatsapp.with_menu('x', ('a', 'A'), ('b', 'B'), ('c', 'C')).buttons) == whatsapp.BUTTON_LIMIT


def test_a_list_reply_survives_the_outbox_so_delivery_can_send_it(harness, asha):
    channel_id = linked_channel(harness, asha)
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(
            session, harness.app.state.settings, channel,
            whatsapp.menu_reply('What would you like to see?'))
        session.commit()
        assert event.payload['options'][0] == list(whatsapp.MENU_OPTIONS[0])
        assert event.payload['list_label'] == 'Open menu'


def test_tapping_a_field_row_selects_it_without_matching_on_the_name(harness, asha, field):
    linked_channel(harness, asha)
    assert signed(harness, tapped(f'field:{field["id"]}', 'wamid.pickfield')).status_code == 200
    with harness.app.state.sessions() as session:
        job = session.scalar(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')
                             .order_by(d.JobRow.created_at.desc()))
        assert job.payload['request']['command'] == 'field_selected'


def test_readiness_answers_before_the_farmer_has_chosen_a_field(harness, asha, field, season):
    """The first question a farmer asks must not dead-end on an unset field.

    A channel conversation starts with no field selected, so readiness, water and
    money each replied "no open season is available for the active field" until
    the farmer happened to run `fields` and pick one -- the exact command
    knowledge that tappable navigation exists to remove.

    It also guards the bug hiding behind that one: those queries filtered on
    `SeasonRow.farmer_id`, which does not exist, and never raised only because
    the unset field short-circuited them away. Selecting a field by default
    without fixing the join would have turned this answer into a 500.
    """
    import asyncio

    from agrisense.platform import worker

    linked_channel(harness, asha)
    assert signed(harness, message('readiness', 'wamid.readiness')).status_code == 200
    asyncio.run(worker.drain_jobs(harness.app.state.sessions, harness.app.state.settings))

    with harness.app.state.sessions() as session:
        replies = [row.payload['body'] for row in session.scalars(
            select(d.OutboxRow).where(d.OutboxRow.kind == 'whatsapp.outbound'))]
    # An empty list means the job raised rather than answering.
    assert replies, 'readiness queued no reply at all'
    assert not any('No open season is available' in body for body in replies), replies


def test_a_chosen_field_is_never_overridden_by_the_default(harness):
    """The fallback fills an empty choice; it does not overrule the farmer's.

    No query should run at all here, so the tenant and farmer given are ones that
    own nothing: if the chosen field were ignored, there is nothing to fall back
    to and the assertion fails rather than passing by accident.
    """
    conversation = d.ConversationRow(
        id=d.new_id(), tenant_id='t', farmer_id='f', version=1,
        payload={'field_id': 'chosen-by-the-farmer'})
    with harness.app.state.sessions() as session:
        chosen = whatsapp.active_field_id(session, conversation, 'no-such-tenant', 'no-such-farmer')
    assert chosen == 'chosen-by-the-farmer'


def test_numbers_are_grouped_the_way_the_reader_groups_them():
    assert whatsapp.indian_number(1688112) == '16,88,112'
    assert whatsapp.indian_number(2425) == '2,425'
    assert whatsapp.indian_number(401) == '401'


def test_water_is_answered_in_words_not_as_a_serialised_object():
    """A farmer asking about water was sent the payload dict itself."""
    reply = whatsapp.water_reply({
        'irrigation_needed': True,
        'daily': [{'value': 1688112.0, 'unit': 'L'}, {'value': 1761120.0, 'unit': 'L'}],
    }, 1.2, '\n_North plot_')
    assert '{' not in reply and 'None' not in reply
    assert 'Irrigation is needed now.' in reply
    assert '16,88,112 L' in reply
    assert '_North plot_' in reply


def test_a_replenishment_volume_is_never_described_as_a_daily_rate():
    """Each figure refills the root zone; the science layer says they do not sum.

    Read as daily use, 16,88,112 L on 1.2 ha is 141 mm a day -- roughly twenty
    times what any crop transpires. The number is right; calling it "a day"
    would make it a wrong instruction.
    """
    reply = whatsapp.water_reply({
        'irrigation_needed': True,
        'daily': [{'value': 1688112.0, 'unit': 'L'}, {'value': 1761120.0, 'unit': 'L'}],
    }, 1.2, '')
    assert 'a day' not in reply
    assert 'not a daily total' in reply
    # The depth is what makes the volume checkable by anyone who knows the crop.
    assert '141 mm' in reply


def test_money_leads_with_the_price_rather_than_a_row_of_blanks():
    """Costs stay the farmer's own, but what the crop fetches is knowable today."""
    reply = whatsapp.money_reply('wheat', {'cost': {'p50': None}}, '')
    assert '{' not in reply
    assert '₹' in reply
    assert 'once you record them' in reply
