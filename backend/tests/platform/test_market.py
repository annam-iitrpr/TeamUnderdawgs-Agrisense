"""Live mandi prices: parsing, ranging and the traps in this upstream."""
from __future__ import annotations

import json
from datetime import date

import pytest
from agrisense.platform import market
from agrisense.platform.errors import PlatformError


def record(**overrides):
    row = {'state': 'Punjab', 'district': 'Ludhiana', 'market': 'Ludhiana APMC',
           'commodity': 'Cotton', 'variety': 'H4', 'grade': 'FAQ',
           'min_price': '8000', 'max_price': '9000', 'modal_price': '8500',
           'arrival_date': '10/09/2026'}
    row.update(overrides)
    return row


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    market.reset_cache_for_tests()
    monkeypatch.setenv('DATA_GOV_IN_API_KEY', 'test-key')
    yield
    market.reset_cache_for_tests()


def serve(monkeypatch, rows):
    calls = []

    def fake(commodity):
        calls.append(commodity)
        return rows

    monkeypatch.setattr(market, '_fetch', fake)
    return calls


def test_the_user_agent_is_not_python_urllib():
    """data.gov.in silently blackholes `Python-urllib` requests.

    The connection hangs until the read times out rather than returning a
    status, so it looks like a slow network and not a rejection — which cost a
    debugging session. Any ordinary agent answers in under half a second.
    """
    assert not market.USER_AGENT.lower().startswith('python-urllib')
    assert market.USER_AGENT.strip()


def test_commodity_names_are_the_feeds_own_not_ours():
    """Rice trades as Paddy and soybean as Soyabean in this feed.

    The plausible guesses return zero records, so they are pinned here to stop
    anyone 'tidying' the mapping into English crop names.
    """
    assert market.COMMODITY['rice'] == 'Paddy'
    assert market.COMMODITY['soybean'] == 'Soyabean'
    assert set(market.COMMODITY) == {'cotton', 'wheat', 'rice', 'maize', 'soybean'}


def test_the_range_spans_the_widest_price_a_farmer_could_meet(monkeypatch):
    serve(monkeypatch, [
        record(market='A', min_price='8000', max_price='9000', modal_price='8500'),
        record(market='B', min_price='7000', max_price='11000', modal_price='9000'),
        record(market='C', min_price='8200', max_price='8800', modal_price='8600'),
    ])
    result = market.prices('cotton')
    # Lowest minimum to highest maximum, not the spread of modal prices, which
    # would understate what a farmer is actually exposed to.
    assert result.low.value == 7000
    assert result.high.value == 11000
    assert result.modal.value == 8600
    assert result.low.unit == 'INR/quintal'


def test_unusable_rows_are_dropped_rather_than_dragging_the_range(monkeypatch):
    serve(monkeypatch, [
        record(market='good'),
        record(market='zero', min_price='0', max_price='0', modal_price='0'),
        record(market='blank', min_price='', max_price='', modal_price=''),
        record(market='inverted', min_price='9000', max_price='8000'),
        record(market='undated', arrival_date='not-a-date'),
    ])
    result = market.prices('cotton')
    # A zero price is not a real price; carrying it would pull the low end to
    # nothing and make the range meaningless.
    assert [q.market for q in result.quotes] == ['good']
    assert result.low.value == 8000


def test_no_usable_row_is_a_dependency_problem_not_an_empty_answer(monkeypatch):
    serve(monkeypatch, [record(min_price='0', max_price='0', modal_price='0')])
    with pytest.raises(PlatformError) as raised:
        market.prices('cotton')
    assert raised.value.status == 503


def test_an_unmapped_crop_is_a_404_not_a_guess(monkeypatch):
    serve(monkeypatch, [record()])
    with pytest.raises(PlatformError) as raised:
        market.prices('barley')
    assert raised.value.status == 404


def test_the_local_price_comes_only_from_the_farmers_own_state(monkeypatch):
    serve(monkeypatch, [
        record(state='Punjab', market='Ludhiana APMC', modal_price='8800'),
        record(state='Gujarat', market='Botad APMC', modal_price='9400'),
    ])
    local = market.prices('cotton', state='Punjab')
    assert local.nearest is not None
    assert local.nearest.state == 'Punjab'

    # A price 1500 km away is not a price they can get, so it stays null and
    # the answer says why rather than offering the closest thing available.
    market.reset_cache_for_tests()
    serve(monkeypatch, [record(state='Gujarat', market='Botad APMC')])
    away = market.prices('cotton', state='Punjab')
    assert away.nearest is None
    assert 'no_market_in_your_state_reported_today' in away.warnings


def test_msp_is_absent_with_a_stated_reason(monkeypatch):
    """A four-year-old MSP shown as this season's would cost a farmer money.

    The only machine-readable declared-MSP series available is 2022-23, so the
    field stays null and names the gap rather than being filled with a figure
    that would understate a sale.
    """
    serve(monkeypatch, [record()])
    result = market.prices('cotton')
    assert result.msp is None
    assert result.msp_missing_reason == 'current_declared_msp_series_unavailable'


def test_prices_are_labelled_as_observations_not_a_forecast(monkeypatch):
    serve(monkeypatch, [record()])
    result = market.prices('cotton')
    assert 'prices_are_reported_arrivals_not_a_forecast' in result.warnings
    assert result.source.startswith('data.gov.in')
    assert result.quotes[0].reported_on == date(2026, 9, 10)


def test_one_upstream_call_serves_a_burst_of_farmers(monkeypatch):
    """The upstream is a shared public API with a modest rate limit."""
    calls = serve(monkeypatch, [record()])
    for _ in range(5):
        market.prices('cotton')
    assert len(calls) == 1


def test_an_unconfigured_key_is_reported_not_silently_empty(monkeypatch):
    monkeypatch.delenv('DATA_GOV_IN_API_KEY', raising=False)
    with pytest.raises(PlatformError) as raised:
        market.prices('cotton')
    assert raised.value.status == 503


def test_the_request_carries_the_key_and_commodity_filter(monkeypatch):
    """Guards the query shape, which is easy to break silently."""
    seen = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({'status': 'ok', 'records': [record()]}).encode()

    def fake_urlopen(request, timeout=None):
        seen['url'] = request.full_url
        seen['agent'] = request.get_header('User-agent')
        return FakeResponse()

    monkeypatch.setattr(market.urllib.request, 'urlopen', fake_urlopen)
    monkeypatch.setattr(market.json, 'load', lambda fp: json.loads(fp.read()))
    market.prices('rice')
    assert 'api-key=test-key' in seen['url']
    assert 'Paddy' in seen['url']
    assert not seen['agent'].lower().startswith('python-urllib')
