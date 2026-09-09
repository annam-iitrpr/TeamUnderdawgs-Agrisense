"""Location search offers real places, or says it cannot. It never guesses a coordinate."""
from __future__ import annotations

import httpx
import pytest
from agrisense.config import Settings
from agrisense.platform import locations
from agrisense.platform.errors import PlatformError

NAGPUR = {'id': 1262180, 'name': 'Nagpur', 'latitude': 21.14631, 'longitude': 79.08491,
          'country_code': 'IN', 'feature_code': 'PPLA2', 'admin1': 'Maharashtra', 'admin2': 'Nagpur'}


@pytest.fixture(autouse=True)
def clear_cache():
    locations._cache.clear()
    yield
    locations._cache.clear()


def stub(monkeypatch, records, calls=None):
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'results': records}

    def get(url, params=None, timeout=None):
        if calls is not None:
            calls.append(params)
        return Response()

    monkeypatch.setattr(locations.httpx, 'get', get)


def test_a_real_place_becomes_a_usable_result(monkeypatch):
    stub(monkeypatch, [NAGPUR])
    page = locations.search('nagpur', 5, Settings(app_env='test'))
    item = page['items'][0]
    assert item['name'] == 'Nagpur' and item['state'] == 'Maharashtra' and item['district'] == 'Nagpur'
    assert item['centroid']['latitude'] == pytest.approx(21.14631)
    assert item['centroid']['source'] == 'village'
    assert page['next_cursor'] is None


def test_entries_that_cannot_be_offered_honestly_are_dropped(monkeypatch):
    stub(monkeypatch, [
        {**NAGPUR, 'id': 1, 'latitude': None},                       # no coordinate
        {**NAGPUR, 'id': 2, 'admin1': None},                         # no state: ambiguous
        {**NAGPUR, 'id': 3, 'country_code': 'US'},                   # not in India
        {**NAGPUR, 'id': 4, 'feature_code': 'STM'},                  # a stream, not a place
        {**NAGPUR, 'id': 5, 'name': ''},                             # unnamed
        NAGPUR,
    ])
    items = locations.search('nagpur', 10, Settings(app_env='test'))['items']
    assert [item['id'] for item in items] == [str(NAGPUR['id'])]


def test_a_district_is_optional_but_a_state_is_not(monkeypatch):
    stub(monkeypatch, [{**NAGPUR, 'admin2': None}])
    item = locations.search('nagpur', 5, Settings(app_env='test'))['items'][0]
    assert item['district'] is None and item['state'] == 'Maharashtra'


def test_repeated_typing_does_not_repeat_the_upstream_call(monkeypatch):
    calls = []
    stub(monkeypatch, [NAGPUR], calls)
    for _ in range(4):
        locations.search('nagpur', 5, Settings(app_env='test'))
    assert len(calls) == 1
    # A different query is a different cache entry.
    locations.search('amravati', 5, Settings(app_env='test'))
    assert len(calls) == 2


def test_an_upstream_failure_reports_itself_rather_than_returning_a_guess(monkeypatch):
    def fail(url, params=None, timeout=None):
        raise httpx.ConnectTimeout('upstream down')

    monkeypatch.setattr(locations.httpx, 'get', fail)
    with pytest.raises(PlatformError) as raised:
        locations.search('nagpur', 5, Settings(app_env='test'))
    assert raised.value.code == 'DEPENDENCY_UNAVAILABLE'
    assert raised.value.retryable is True


def test_a_too_short_or_too_long_query_is_refused(monkeypatch):
    stub(monkeypatch, [NAGPUR])
    for bad in ('', ' ', 'a', 'x' * 101):
        with pytest.raises(PlatformError) as raised:
            locations.search(bad, 5, Settings(app_env='test'))
        assert raised.value.status == 422


def test_the_route_requires_authentication_and_bounds_its_limit(asha, harness, monkeypatch):
    stub(monkeypatch, [NAGPUR])
    assert harness.get('/api/v1/catalog/locations', params={'q': 'nagpur'}).status_code == 401
    ok = asha.get('/catalog/locations', params={'q': 'nagpur', 'limit': 5})
    assert ok.status_code == 200
    assert ok.json()['data']['items'][0]['state'] == 'Maharashtra'
    assert asha.get('/catalog/locations', params={'q': 'nagpur', 'limit': 500}).status_code == 422
    assert asha.get('/catalog/locations', params={'q': 'n'}).status_code == 422
