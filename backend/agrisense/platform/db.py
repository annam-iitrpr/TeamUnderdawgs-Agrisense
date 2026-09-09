"""Relational tenant boundaries, optimistic aggregates, inbox and transactional outbox."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

from agrisense.config import Settings


def utcnow() -> datetime:
    return datetime.now(UTC)

def new_id() -> str:
    return uuid4().hex

def aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes; every stored instant is UTC by construction.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value

JSONType=JSON().with_variant(JSONB(),'postgresql')

class Base(DeclarativeBase):
    pass

class Tenant(Base):
    __tablename__='tenants'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)

class User(Base):
    __tablename__='users'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    firebase_uid: Mapped[str]=mapped_column(String(128),unique=True)
    disabled: Mapped[bool]=mapped_column(Boolean,default=False)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)

class Membership(Base):
    __tablename__='memberships'
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),primary_key=True,index=True)
    role: Mapped[str]=mapped_column(String(20),default='farmer')
    __table_args__=(CheckConstraint("role in ('farmer','agronomist','admin')",name='ck_membership_role'),)

class FarmerRow(Base):
    __tablename__='farmers'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),index=True)
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),unique=True)
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)
    version: Mapped[int]=mapped_column(Integer,default=1)
    __table_args__=(UniqueConstraint('tenant_id','id',name='uq_farmer_tenant_id'),)

class Assignment(Base):
    __tablename__='agronomist_assignments'
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    farmer_id: Mapped[str]=mapped_column(ForeignKey('farmers.id'),primary_key=True)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),index=True)
    __table_args__=(ForeignKeyConstraint(['tenant_id','farmer_id'],['farmers.tenant_id','farmers.id'],name='fk_assignment_farmer'),)

class FieldRow(Base):
    __tablename__='fields'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),index=True)
    farmer_id: Mapped[str]=mapped_column(String(128),index=True)
    name: Mapped[str]=mapped_column(String(160))
    area_ha: Mapped[float]=mapped_column(Float)
    archived: Mapped[bool]=mapped_column(Boolean,default=False)
    version: Mapped[int]=mapped_column(Integer,default=1)
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)
    __table_args__=(UniqueConstraint('tenant_id','id',name='uq_field_tenant_id'),ForeignKeyConstraint(['tenant_id','farmer_id'],['farmers.tenant_id','farmers.id'],name='fk_field_farmer'),CheckConstraint('area_ha > 0',name='ck_field_area'),Index('ix_fields_owner_page','tenant_id','farmer_id','id'))

class SeasonRow(Base):
    __tablename__='seasons'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),index=True)
    field_id: Mapped[str]=mapped_column(String(128),index=True)
    crop_id: Mapped[str]=mapped_column(String(128))
    allocated_area_ha: Mapped[float]=mapped_column(Float)
    status: Mapped[str]=mapped_column(String(16),default='planned')
    version: Mapped[int]=mapped_column(Integer,default=1)
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)
    __table_args__=(UniqueConstraint('tenant_id','id',name='uq_season_tenant_id'),ForeignKeyConstraint(['tenant_id','field_id'],['fields.tenant_id','fields.id'],name='fk_season_field'),CheckConstraint('allocated_area_ha > 0',name='ck_season_area'),CheckConstraint("status in ('planned','active','closed')",name='ck_season_status'),Index('ix_seasons_field_page','tenant_id','field_id','id'))

class OwnedRecord:
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),index=True)
    farmer_id: Mapped[str]=mapped_column(ForeignKey('farmers.id'),index=True)
    version: Mapped[int]=mapped_column(Integer,default=1)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)

class JournalRow(OwnedRecord,Base):
    __tablename__='journal_entries'
    season_id: Mapped[str]=mapped_column(String(128),index=True)
    occurred_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_journal_season'),ForeignKeyConstraint(['tenant_id','farmer_id'],['farmers.tenant_id','farmers.id'],name='fk_journal_farmer'),UniqueConstraint('tenant_id','id',name='uq_journal_tenant_id'))

class JournalRevision(Base):
    __tablename__='journal_revisions'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    journal_id: Mapped[str]=mapped_column(ForeignKey('journal_entries.id'),index=True)
    version: Mapped[int]=mapped_column(Integer)
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    __table_args__=(UniqueConstraint('journal_id','version',name='uq_journal_revision'),)

class LedgerRow(OwnedRecord,Base):
    __tablename__='economic_ledger_lines'
    season_id: Mapped[str]=mapped_column(String(128),index=True)
    journal_entry_id: Mapped[str | None]=mapped_column(String(128),nullable=True,index=True)
    kind: Mapped[str]=mapped_column(String(24))
    amount: Mapped[float]=mapped_column(Float)
    unit: Mapped[str]=mapped_column(String(32))
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_ledger_season'),ForeignKeyConstraint(['tenant_id','journal_entry_id'],['journal_entries.tenant_id','journal_entries.id'],name='fk_ledger_journal'),CheckConstraint('amount >= 0',name='ck_ledger_amount'))

class RecommendationRow(OwnedRecord,Base):
    __tablename__='recommendations'
    season_id: Mapped[str]=mapped_column(String(128),index=True)
    input_hash: Mapped[str]=mapped_column(String(64))
    input_version: Mapped[int]=mapped_column(Integer)
    superseded: Mapped[bool]=mapped_column(Boolean,default=False)
    snapshot: Mapped[dict[str,Any]]=mapped_column(JSONType)
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_recommendation_season'),UniqueConstraint('season_id','input_hash',name='uq_recommendation_snapshot'))

class TaskRow(OwnedRecord,Base):
    __tablename__='tasks'
    season_id: Mapped[str]=mapped_column(String(128),index=True)
    status: Mapped[str]=mapped_column(String(24),index=True)
    due_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),index=True)
    deduplication_key: Mapped[str]=mapped_column(String(255))
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_task_season'),UniqueConstraint('tenant_id','deduplication_key',name='uq_task_deduplication'))

class ReminderRow(OwnedRecord,Base):
    __tablename__='reminders'
    season_id: Mapped[str]=mapped_column(String(128),index=True)
    scheduled_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),index=True)
    status: Mapped[str]=mapped_column(String(24),index=True)
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_reminder_season'),)

class NotificationRow(OwnedRecord,Base):
    __tablename__='notifications'
    season_id: Mapped[str | None]=mapped_column(String(128),nullable=True,index=True)
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_notification_season'),)

class ClosureRow(OwnedRecord,Base):
    __tablename__='season_closures'
    season_id: Mapped[str]=mapped_column(String(128),unique=True)
    __table_args__=(ForeignKeyConstraint(['tenant_id','season_id'],['seasons.tenant_id','seasons.id'],name='fk_closure_season'),)

class ConversationRow(OwnedRecord,Base):
    __tablename__='conversations'
    __table_args__=(UniqueConstraint('tenant_id','id',name='uq_conversation_tenant_id'),)

class MessageRow(OwnedRecord,Base):
    __tablename__='messages'
    conversation_id: Mapped[str]=mapped_column(String(128),index=True)
    __table_args__=(ForeignKeyConstraint(['tenant_id','conversation_id'],['conversations.tenant_id','conversations.id'],name='fk_message_conversation'),)

class ProposalRow(OwnedRecord,Base):
    __tablename__='proposed_mutations'
    conversation_id: Mapped[str]=mapped_column(String(128),index=True)
    status: Mapped[str]=mapped_column(String(24),default='pending')
    expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    __table_args__=(ForeignKeyConstraint(['tenant_id','conversation_id'],['conversations.tenant_id','conversations.id'],name='fk_proposal_conversation'),)

class MediaRow(OwnedRecord,Base):
    __tablename__='media_assets'
    object_key: Mapped[str]=mapped_column(String(255),unique=True)
    status: Mapped[str]=mapped_column(String(24),default='pending')
    sha256: Mapped[str | None]=mapped_column(String(64),nullable=True)

class SoilRow(OwnedRecord,Base):
    __tablename__='soil_observations'
    field_id: Mapped[str]=mapped_column(String(128),index=True)
    __table_args__=(ForeignKeyConstraint(['tenant_id','field_id'],['fields.tenant_id','fields.id'],name='fk_soil_field'),)

class ChannelRow(OwnedRecord,Base):
    __tablename__='channel_identities'
    provider: Mapped[str]=mapped_column(String(24))
    external_id_hash: Mapped[str]=mapped_column(String(64))
    opted_in: Mapped[bool]=mapped_column(Boolean,default=False)
    last_inbound_at: Mapped[datetime | None]=mapped_column(DateTime(timezone=True),nullable=True)
    __table_args__=(UniqueConstraint('provider','external_id_hash',name='uq_channel_identity'),)

class LinkChallenge(OwnedRecord,Base):
    __tablename__='channel_link_challenges'
    code_hash: Mapped[str]=mapped_column(String(64),unique=True)
    expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    used: Mapped[bool]=mapped_column(Boolean,default=False)

class JobRow(OwnedRecord,Base):
    __tablename__='jobs'
    kind: Mapped[str]=mapped_column(String(64))
    status: Mapped[str]=mapped_column(String(24),index=True,default='pending')
    attempts: Mapped[int]=mapped_column(Integer,default=0)
    run_after: Mapped[datetime]=mapped_column(DateTime(timezone=True),index=True,default=utcnow)
    lease_until: Mapped[datetime | None]=mapped_column(DateTime(timezone=True),nullable=True)
    lease_token: Mapped[str | None]=mapped_column(String(128),nullable=True)
    updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)

class IdempotencyRow(Base):
    __tablename__='idempotency_keys'
    actor_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    operation: Mapped[str]=mapped_column(String(255),primary_key=True)
    key: Mapped[str]=mapped_column(String(128),primary_key=True)
    request_hash: Mapped[str]=mapped_column(String(64))
    response: Mapped[dict[str,Any] | None]=mapped_column(JSONType,nullable=True)
    status_code: Mapped[int]=mapped_column(Integer,default=200)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)

class OutboxRow(Base):
    __tablename__='outbox_events'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    tenant_id: Mapped[str | None]=mapped_column(ForeignKey('tenants.id'),nullable=True,index=True)
    kind: Mapped[str]=mapped_column(String(64))
    aggregate_id: Mapped[str]=mapped_column(String(128))
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    # Delivery status, attempts and backoff live on each consumer's receipt, not on the event.
    available_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow,index=True)

class ConsumerReceipt(Base):
    """Per-consumer delivery state. Attempts are tracked here, never on the shared event,
    so one failing consumer cannot dead-letter an event for every other subscriber."""
    __tablename__='consumer_receipts'
    event_id: Mapped[str]=mapped_column(ForeignKey('outbox_events.id'),primary_key=True)
    consumer: Mapped[str]=mapped_column(String(128),primary_key=True)
    status: Mapped[str]=mapped_column(String(24),default='processed',index=True)
    attempts: Mapped[int]=mapped_column(Integer,default=0)
    available_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow,index=True)
    processed_at: Mapped[datetime | None]=mapped_column(DateTime(timezone=True),nullable=True)
    __table_args__=(CheckConstraint("status in ('pending','processed','dead_letter')",name='ck_receipt_status'),)

class WebhookInbox(Base):
    __tablename__='webhook_inbox'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    provider: Mapped[str]=mapped_column(String(24))
    external_message_id: Mapped[str]=mapped_column(String(255))
    kind: Mapped[str]=mapped_column(String(24))
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)
    received_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    __table_args__=(UniqueConstraint('provider','external_message_id','kind',name='uq_webhook_provider_event'),)

class AuditRow(Base):
    __tablename__='audit_events'
    id: Mapped[str]=mapped_column(String(128),primary_key=True,default=new_id)
    tenant_id: Mapped[str]=mapped_column(ForeignKey('tenants.id'),index=True)
    actor_id: Mapped[str]=mapped_column(ForeignKey('users.id'),index=True)
    action: Mapped[str]=mapped_column(String(128))
    resource_id: Mapped[str]=mapped_column(String(128))
    occurred_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=utcnow)
    request_id: Mapped[str]=mapped_column(String(128))

class ModelRow(Base):
    __tablename__='model_versions'
    id: Mapped[str]=mapped_column(String(128),primary_key=True)
    status: Mapped[str]=mapped_column(String(24),index=True)
    payload: Mapped[dict[str,Any]]=mapped_column(JSONType)


def make_engine(settings: Settings):
    if settings.database_url.startswith('sqlite'):
        if settings.app_env!='test':
            raise ValueError('SQLite is permitted only for isolated tests; configure local PostgreSQL')
        engine=create_engine(settings.database_url,connect_args={'check_same_thread':False},poolclass=StaticPool)
        @event.listens_for(engine,'connect')
        def foreign_keys(dbapi_connection, _):
            dbapi_connection.execute('PRAGMA foreign_keys=ON')
    else:
        engine=create_engine(settings.database_url,pool_pre_ping=True,pool_size=settings.db_pool_size,max_overflow=settings.db_max_overflow,hide_parameters=True)
    return engine


def session_factory(engine):
    return sessionmaker(engine,expire_on_commit=False)
