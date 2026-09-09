#!/usr/bin/env python3
"""Build synthetic, non-personal fixtures; never used as live provider fallback."""
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from contracts.models import (
    DomainEvent,
    EvaluationBundle,
    Farmer,
    Field,
    Location,
    Reason,
    Recommendation,
    Season,
    SeasonSnapshot,
)

for crop in ('rice','wheat','cotton'):
    farmer=Farmer(id='synthetic-farmer',tenant_id='synthetic-tenant',display_name='Synthetic farmer',version=1)
    field=Field(id=f'synthetic-field-{crop}',farmer_id=farmer.id,name=f'Synthetic {crop} plot',area_ha=2,entered_area=2,entered_area_unit='ha',centroid=Location(latitude=21,longitude=79,source='manual'),version=1)
    season=Season(id=f'synthetic-season-{crop}',field_id=field.id,crop_id=crop,allocated_area_ha=1,date_confidence='unknown',stage_source='unknown',status='planned',version=1)
    snapshot=SeasonSnapshot(snapshot_id=f'synthetic-snapshot-{crop}',input_hash='synthetic-not-a-live-hash',as_of='2026-09-09T00:00:00Z',farmer=farmer,field=field,season=season)
    (ROOT/f'contracts/fixtures/{crop}.snapshot.json').write_text(snapshot.model_dump_json(indent=2)+'\n')
    for status in ('recommended','monitor','blocked','insufficient_data','out_of_scope'):
        rec=Recommendation(id=f'synthetic-{crop}-{status}',field_id=field.id,season_id=season.id,input_version=1,input_hash=snapshot.input_hash,generated_at='2026-09-09T00:00:00Z',expires_at='2026-09-09T06:00:00Z',rule_version='synthetic-contract-only',status=status,readiness=72 if status=='recommended' else None,need=.8 if status=='recommended' else None,timing_fit=.9 if status=='recommended' else None,viability=1 if status=='recommended' else None,selected_window={'start_at':'2026-09-09T01:00:00Z','end_at':'2026-09-09T03:00:00Z'} if status=='recommended' else None,reasons=[Reason(code='SYNTHETIC_CONTRACT_FIXTURE',facts={'live_advice':False})])
        bundle=EvaluationBundle(recommendation=rec,data_mode='demo',warnings=['Synthetic schema fixture; not agronomic advice or a provider result.'])
        (ROOT/f'contracts/fixtures/{crop}.{status}.json').write_text(bundle.model_dump_json(indent=2)+'\n')
    event=DomainEvent(event_id=f'synthetic-event-{crop}',event_type='season.updated',aggregate_id=season.id,aggregate_version=1,tenant_id=farmer.tenant_id,occurred_at='2026-09-09T00:00:00Z',payload_reference_id=snapshot.snapshot_id)
    (ROOT/f'contracts/fixtures/{crop}.event.json').write_text(event.model_dump_json(indent=2)+'\n')
