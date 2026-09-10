"""Live mandi prices: parsing, ranging and the traps in this upstream."""
from __future__ import annotations

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
    assert market.COMMODITY['lentil'] == 'Lentil (Masur)(Whole)'
    assert market.COMMODITY['bajra'] == 'Bajra(Pearl Millet/Cumbu)'
    # Sugarcane is not traded in daily arrivals at all, so it is deliberately
    # unmapped and served from the reference table instead.
    assert 'sugarcane' not in market.COMMODITY
    # Every crop the app offers resolves to a price by one route or the other.
    assert set(market.REFERENCE_PRICES) >= set(market.COMMODITY) - {'soybean'}


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


def test_no_usable_row_falls_back_to_a_labelled_reference_price(monkeypatch):
    """A blank is the one thing a price card must not show.

    A farmer comparing crops cannot compare against nothing, so an upstream that
    reports no usable row resolves to the reference figure -- labelled as one,
    never dressed up as today's quote from a named mandi.
    """
    serve(monkeypatch, [record(min_price='0', max_price='0', modal_price='0')])
    result = market.prices('cotton')
    assert result.modal.value == market.REFERENCE_PRICES['cotton']['modal']
    assert result.data_mode == 'demo'
    assert result.quotes == []
    assert 'indicative_reference_price_not_a_live_mandi_quote' in result.warnings
    assert 'no_market_reported_this_crop_today' in result.warnings


def test_a_crop_with_no_mandi_series_still_gets_its_reference_price(monkeypatch):
    """Sugarcane has no mandi quote to get: growers sell to mills at the SAP."""
    serve(monkeypatch, [record()])
    result = market.prices('sugarcane')
    assert result.modal.value == market.REFERENCE_PRICES['sugarcane']['modal']
    assert 'anchored_to_state_advised_price_2025_26' in result.warnings
    assert 'crop_is_not_traded_in_daily_mandi_arrivals' in result.warnings


def test_a_crop_this_build_has_never_heard_of_is_still_a_404(monkeypatch):
    """The fallback covers the catalogue, not any string a caller invents."""
    serve(monkeypatch, [record()])
    with pytest.raises(PlatformError) as raised:
        market.prices('dragonfruit')
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


def test_msp_is_the_declared_figure_for_the_current_season(monkeypatch):
    """The MSP is the floor a mandi range is judged against, so it is shown.

    It comes from the reviewed table for the current marketing season rather
    than the machine-readable series, which is four years stale -- a 2022-23
    figure presented as this season's would understate a sale.
    """
    serve(monkeypatch, [record()])
    result = market.prices('cotton')
    assert result.msp is not None
    assert result.msp.value == market.REFERENCE_PRICES['cotton']['msp']
    assert result.msp_missing_reason is None


def test_a_crop_without_a_declared_msp_says_so(monkeypatch):
    """Absence is stated, not filled in: onion and potato have no MSP at all."""
    serve(monkeypatch, [record()])
    result = market.prices('onion')
    assert result.msp is None
    assert result.msp_missing_reason == 'no_msp_is_declared_for_this_crop'


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


def test_an_unconfigured_key_falls_back_rather_than_failing(monkeypatch):
    monkeypatch.delenv('DATA_GOV_IN_API_KEY', raising=False)
    result = market.prices('cotton')
    assert result.data_mode == 'demo'
    assert 'live_market_feed_not_configured' in result.warnings


def test_the_request_carries_the_key_the_filter_and_a_safe_agent(monkeypatch):
    """Guards the query shape and the header, both easy to break silently."""
    seen = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {'status': 'ok', 'records': [record()]}

    def fake_get(url, params=None, headers=None, timeout=None, follow_redirects=None):
        seen['url'] = url
        seen['params'] = params or {}
        seen['headers'] = headers or {}
        return FakeResponse()

    monkeypatch.setattr(market.httpx, 'get', fake_get)
    market.prices('rice')
    assert seen['params']['api-key'] == 'test-key'
    assert seen['params']['filters[commodity]'] == 'Paddy'
    assert not seen['headers']['User-Agent'].lower().startswith('python-urllib')


def test_a_dropped_connection_is_a_503_not_a_crash(monkeypatch):
    """`RemoteDisconnected` is a ConnectionResetError, not an URLError.

    Under urllib it escaped the handler entirely and surfaced as a 500 from
    Cloud Run. Every transport failure must reach the farmer as an honest
    dependency message.
    """
    def fake_get(*_args, **_kwargs):
        raise ConnectionResetError('Remote end closed connection without response')

    monkeypatch.setattr(market.httpx, 'get', fake_get)
    monkeypatch.setattr(market.time, 'sleep', lambda _s: None)
    # The transport still reports honestly...
    with pytest.raises(PlatformError) as raised:
        market._fetch('Cotton')
    assert raised.value.status == 503
    assert raised.value.retryable is True
    # ...and the farmer still gets a price rather than an outage.
    assert market.prices('cotton').data_mode == 'demo'


def test_a_non_ok_payload_is_refused_rather_than_parsed(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {'status': 'error', 'message': 'quota exceeded'}

    monkeypatch.setattr(market.httpx, 'get', lambda *a, **k: FakeResponse())
    with pytest.raises(PlatformError) as raised:
        market._fetch('Cotton')
    assert raised.value.status == 503
    assert market.prices('cotton').data_mode == 'demo'


def test_cached_soil_retrieval_applies_only_near_where_it_was_measured(monkeypatch):
    """A soil estimate from a hundred kilometres away is not this field's soil.

    SoilGrids is intermittently unavailable — 503s and sixty-second hangs
    within one afternoon — so retrievals already made are kept and reused. The
    box is deliberately strict: reusing one far from where it was queried would
    be worse than reporting the gap, since the entire purpose is to open the
    pH gate honestly.
    """
    from agrisense.platform import soilgrids

    soilgrids.reset_cache_for_tests()

    def unreachable(latitude, longitude):
        raise TimeoutError('soilgrids hung')

    monkeypatch.setattr(soilgrids, '_query', unreachable)

    near = soilgrids.estimate('field-a', 30.9686, 76.4730)
    assert near is not None, 'a recorded retrieval for Ropar was not used'
    assert near.ph is not None and near.ph.value == 7.5
    assert near.source == 'gridded_estimate'
    # Never confirmed and never dated: a farmer confirms their own card, and a
    # modelled long-term average is not a sample taken on a day.
    assert near.confirmation_state == 'draft'
    assert near.sampled_on is None
    assert 'unreachable' in (near.ph.provenance[0].note or '')

    soilgrids.reset_cache_for_tests()
    far = soilgrids.estimate('field-b', 12.9716, 77.5946)
    assert far is None, 'a Ropar retrieval must not answer for Bengaluru'
