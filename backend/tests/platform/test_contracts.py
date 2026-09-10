import json
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from contracts.models import Estimate, FieldCreate, Interval, Measurement, Recommendation
from contracts.routes import ROUTES


def test_generation_is_reproducible():
    subprocess.run([sys.executable,str(ROOT/'scripts/generate_contracts.py'),'--check'],check=True)


def test_all_operations_have_concrete_envelopes_and_auth():
    doc=json.loads((ROOT/'contracts/openapi.yaml').read_text())
    count=0
    for path,operations in doc['paths'].items():
        assert path.startswith('/api/v1/')
        for method,op in operations.items():
            count+=1
            assert op['security']==[{'firebaseBearer':[]}]
            assert op['responses']['422']['content']['application/json']['schema']['$ref'].endswith('/ErrorResponse')
            if method=='post':assert any(p['name']=='Idempotency-Key' and p['required'] for p in op['parameters'])
    # Pinned so a route cannot be added by accident. Update it deliberately,
    # together with the reason. 60 added POST /soil/readings, the only way to
    # record a soil moisture reading dated today — the input the water balance
    # requires and that a photographed lab card can never supply. 61 adds
    # GET /market/prices/{id} for live mandi prices.
    assert count==61==len(ROUTES)
    def refs(node):
        if isinstance(node,dict):
            if '$ref' in node:assert node['$ref'].split('/')[-1] in doc['components']['schemas']
            for value in node.values():refs(value)
        elif isinstance(node,list):
            for value in node:refs(value)
    refs(doc)


def test_synthetic_fixtures_validate_against_authority():
    for name in ('science','events'):
        schema=json.loads((ROOT/f'contracts/{name}.schema.json').read_text())
        Draft202012Validator.check_schema(schema)
        validator=Draft202012Validator(schema)
        for path in (ROOT/'contracts/fixtures').glob('*.json'):
            if (name=='events') == ('.event.' in path.name):
                validator.validate(json.loads(path.read_text()))


def test_naive_and_reversed_intervals_rejected():
    for start,end in [('2026-09-09T10:00:00','2026-09-09T12:00:00'),('2026-09-09T12:00:00Z','2026-09-09T10:00:00Z')]:
        with pytest.raises(ValidationError):Interval(start_at=start,end_at=end)


def test_unknown_is_not_zero_and_estimate_quantiles_cannot_cross():
    with pytest.raises(ValidationError):Measurement(value=None,unit='mm')
    assert Measurement(value=0,unit='mm').value==0
    with pytest.raises(ValidationError):Estimate(p10=100,p50=20,p90=30,unit='INR',basis='scenario',target='profit',input_completeness=.5)


def test_identity_cannot_be_injected_and_ids_are_not_numeric():
    fixture=json.loads((ROOT/'contracts/fixtures/cotton.snapshot.json').read_text())
    body={k:v for k,v in fixture['field'].items() if k in FieldCreate.model_fields}
    with pytest.raises(ValidationError):FieldCreate(**body,tenant_id='foreign')
    data=json.loads((ROOT/'contracts/fixtures/cotton.blocked.json').read_text())['recommendation']
    with pytest.raises(ValidationError):Recommendation(**{**data,'id':1})
