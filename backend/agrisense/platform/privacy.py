"""Account export and erasure.

Both run as durable jobs because they touch every table a farmer owns. Export produces one
file the farmer downloads through the ordinary short-lived media link. Erasure removes the
records themselves, not just a flag, and removes the stored objects with them.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import media
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.privacy')

# Ordered child-first so foreign keys stay satisfied without disabling constraint checks.
OWNED_TABLES = (
    d.JournalRevision, d.LedgerRow, d.JournalRow, d.RecommendationRow, d.TaskRow,
    d.ReminderRow, d.NotificationRow, d.ClosureRow, d.ProposalRow, d.MessageRow,
    d.ConversationRow, d.SoilRow, d.MediaRow, d.LinkChallenge, d.ChannelRow, d.JobRow,
    d.SeasonRow, d.FieldRow,
)
EXPORTED = {
    'farmer': d.FarmerRow, 'fields': d.FieldRow, 'seasons': d.SeasonRow,
    'journal': d.JournalRow, 'cost_ledger': d.LedgerRow, 'soil_observations': d.SoilRow,
    'recommendations': d.RecommendationRow, 'tasks': d.TaskRow, 'reminders': d.ReminderRow,
    'notifications': d.NotificationRow, 'season_closures': d.ClosureRow,
    'conversations': d.ConversationRow, 'messages': d.MessageRow, 'media_assets': d.MediaRow,
}


def owned(session: Session, table, tenant_id: str, farmer_id: str) -> list[Any]:
    statement = select(table).where(table.tenant_id == tenant_id)
    if hasattr(table, 'farmer_id'):
        statement = statement.where(table.farmer_id == farmer_id)
    return list(session.scalars(statement))


def collect(session: Session, tenant_id: str, farmer_id: str) -> dict[str, Any]:
    """Everything this farmer owns, in contract shape, so the file is readable and portable."""
    document: dict[str, Any] = {'schema_version': '1.0', 'exported_at': d.utcnow().isoformat(),
                                'notice': 'Personal data export. Handle it as you would any private record.'}
    for name, table in EXPORTED.items():
        if table is d.FarmerRow:
            row = session.scalar(select(d.FarmerRow).where(d.FarmerRow.id == farmer_id,
                                                           d.FarmerRow.tenant_id == tenant_id))
            document[name] = row.payload if row else None
            continue
        document[name] = [row.payload for row in owned(session, table, tenant_id, farmer_id)]
    # Revisions hang off journal entries rather than off the farmer, so they are gathered separately.
    journal_ids = [entry['id'] for entry in document['journal']]
    document['journal_revisions'] = [
        row.payload for row in session.scalars(
            select(d.JournalRevision).where(d.JournalRevision.journal_id.in_(journal_ids)))
    ] if journal_ids else []
    return document


def export(session: Session, settings: Settings, tenant_id: str, farmer_id: str, job_id: str) -> str:
    """Write the export as a media asset the farmer reads through the usual signed link."""
    document = collect(session, tenant_id, farmer_id)
    data = json.dumps(document, indent=2, sort_keys=True).encode()
    asset_id = d.new_id()
    key = f'tenants/{tenant_id}/exports/{asset_id}.json'
    media.store(settings).write(key, data)
    asset = c.MediaAsset(id=asset_id, content_type='application/json', size_bytes=len(data),
                         status='ready', received_at=d.utcnow(), version=1)
    session.add(d.MediaRow(id=asset_id, tenant_id=tenant_id, farmer_id=farmer_id,
                           object_key=key, status='ready', sha256=hashlib.sha256(data).hexdigest(),
                           version=1, payload=asset.model_dump(mode='json')))
    log.info('privacy export prepared job=%s bytes=%d', job_id, len(data))
    return asset_id


def erase(session: Session, settings: Settings, tenant_id: str, farmer_id: str, user_id: str) -> dict[str, int]:
    """Remove the records themselves. A disabled flag is not erasure."""
    removed: dict[str, int] = {}
    store = media.store(settings)
    for row in owned(session, d.MediaRow, tenant_id, farmer_id):
        try:
            store.delete(row.object_key)
        except PlatformError:
            # A missing object is already in the desired state; the row still goes.
            log.warning('stored object already absent during erasure')
    journal_ids = [row.id for row in owned(session, d.JournalRow, tenant_id, farmer_id)]
    if journal_ids:
        removed['journal_revisions'] = session.execute(
            delete(d.JournalRevision).where(d.JournalRevision.journal_id.in_(journal_ids))).rowcount

    for table in OWNED_TABLES:
        if table is d.JournalRevision:
            continue
        statement = delete(table).where(table.tenant_id == tenant_id)
        if hasattr(table, 'farmer_id'):
            statement = statement.where(table.farmer_id == farmer_id)
        removed[table.__tablename__] = session.execute(statement).rowcount

    # These reference the user or tenant directly rather than the farmer.
    receipts = select(d.OutboxRow.id).where(d.OutboxRow.tenant_id == tenant_id)
    session.execute(delete(d.ConsumerReceipt).where(d.ConsumerReceipt.event_id.in_(receipts)))
    removed['outbox_events'] = session.execute(delete(d.OutboxRow).where(d.OutboxRow.tenant_id == tenant_id)).rowcount
    removed['audit_events'] = session.execute(delete(d.AuditRow).where(d.AuditRow.tenant_id == tenant_id)).rowcount
    removed['idempotency_keys'] = session.execute(
        delete(d.IdempotencyRow).where(d.IdempotencyRow.actor_id == user_id)).rowcount
    session.execute(delete(d.Assignment).where(d.Assignment.farmer_id == farmer_id))
    removed['farmers'] = session.execute(
        delete(d.FarmerRow).where(d.FarmerRow.id == farmer_id, d.FarmerRow.tenant_id == tenant_id)).rowcount
    session.execute(delete(d.Membership).where(d.Membership.user_id == user_id))
    removed['users'] = session.execute(delete(d.User).where(d.User.id == user_id)).rowcount
    remaining = session.scalar(select(d.Membership).where(d.Membership.tenant_id == tenant_id))
    if remaining is None:
        removed['tenants'] = session.execute(delete(d.Tenant).where(d.Tenant.id == tenant_id)).rowcount
    log.info('privacy erasure completed for one account')
    return {name: count for name, count in removed.items() if count}
