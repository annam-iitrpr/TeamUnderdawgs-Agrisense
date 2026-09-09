"""Domain transactions. Every lookup is tenant/owner scoped before use."""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agrisense.config import Settings, get_settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import locations, media, science
from agrisense.platform.auth import Actor
from agrisense.platform.errors import PlatformError, missing, unavailable


def dump(value):
    return value.model_dump(mode='json') if hasattr(value,'model_dump') else value


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class DomainService:
    def __init__(self, session: Session, actor: Actor, request_id: str, settings: Settings | None=None):
        self.s=session;self.actor=actor;self.request_id=request_id
        self.settings=settings or get_settings()

    def own(self, model, id: str, lock: bool=False):
        query=select(model).where(model.id==id,model.tenant_id==self.actor.tenant_id)
        if hasattr(model,'farmer_id'):query=query.where(model.farmer_id==self.actor.farmer_id)
        if model is d.FarmerRow:query=query.where(model.id==self.actor.farmer_id)
        if lock:query=query.with_for_update()
        row=self.s.scalar(query)
        if row is None:raise missing()
        if model is d.SeasonRow:self.own(d.FieldRow,row.field_id)
        return row

    def version(self,row,expected):
        if row.version!=expected:
            raise PlatformError('VERSION_CONFLICT','This record changed. Refresh it and review your changes.',409,details={'current_version':row.version})

    def event(self,kind,row):
        event=c.DomainEvent(event_id=d.new_id(),event_type=kind,aggregate_id=row.id,aggregate_version=row.version,tenant_id=self.actor.tenant_id,occurred_at=d.utcnow(),payload_reference_id=row.id)
        self.s.add(d.OutboxRow(id=event.event_id,tenant_id=self.actor.tenant_id,kind=kind,aggregate_id=row.id,payload=dump(event)))
        self.s.add(d.AuditRow(tenant_id=self.actor.tenant_id,actor_id=self.actor.user_id,action=kind,resource_id=row.id,request_id=self.request_id))

    def owned_values(self,payload):
        return {'id':payload['id'],'tenant_id':self.actor.tenant_id,'farmer_id':self.actor.farmer_id,'payload':payload,'version':payload.get('version',1)}

    def paginate(self,model,query:dict[str,str],**filters):
        try:
            limit=int(query.get('limit','25'))
            if not 1<=limit<=100:raise ValueError()
            cursor=query.get('cursor')
            after=base64.urlsafe_b64decode(cursor.encode()).decode() if cursor else ''
            if len(after)>128:raise ValueError()
        except (ValueError,UnicodeError) as exc:
            raise PlatformError('INVALID_PAGINATION','Use a valid cursor and limit from 1 to 100.') from exc
        stmt=select(model).where(model.tenant_id==self.actor.tenant_id,model.id>after)
        if hasattr(model,'farmer_id'):stmt=stmt.where(model.farmer_id==self.actor.farmer_id)
        for k,v in filters.items():stmt=stmt.where(getattr(model,k)==v)
        rows=list(self.s.scalars(stmt.order_by(model.id).limit(limit+1)))
        next_cursor=base64.urlsafe_b64encode(rows[limit-1].id.encode()).decode() if len(rows)>limit else None
        return {'items':[row.payload for row in rows[:limit]],'next_cursor':next_cursor}

    def idempotent(self,operation,key,body,action):
        if not key or not 8<=len(key)<=128:
            raise PlatformError('IDEMPOTENCY_KEY_REQUIRED','Supply an Idempotency-Key of 8 to 128 characters.')
        fingerprint=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        pk=(self.actor.user_id,operation,key)
        existing=self.s.get(d.IdempotencyRow,pk)
        if existing is None:
            try:
                with self.s.begin_nested():
                    self.s.add(d.IdempotencyRow(actor_id=pk[0],operation=operation,key=key,request_hash=fingerprint));self.s.flush()
            except IntegrityError:
                pass
            existing=self.s.get(d.IdempotencyRow,pk)
        if existing is None:raise PlatformError('RETRY_REQUEST','Please retry this request.',409,True)
        if existing.request_hash!=fingerprint:
            raise PlatformError('IDEMPOTENCY_CONFLICT','This key was already used for different input.',409)
        if existing.response is not None:return existing.response
        result=action()
        existing.response=dump(result)
        self.s.flush()
        return result

    def bump_season(self,season):
        season.version+=1;season.payload={**season.payload,'version':season.version}
        for rec in self.s.scalars(select(d.RecommendationRow).where(d.RecommendationRow.season_id==season.id,d.RecommendationRow.tenant_id==self.actor.tenant_id,d.RecommendationRow.superseded.is_(False))):
            rec.superseded=True
            rec.payload={**rec.payload,'recommendation':{**rec.payload['recommendation'],'superseded':True}}
        self.event('season.updated',season)

    def allocation(self,field,area,exclude=None):
        stmt=select(func.coalesce(func.sum(d.SeasonRow.allocated_area_ha),0)).where(d.SeasonRow.field_id==field.id,d.SeasonRow.tenant_id==self.actor.tenant_id,d.SeasonRow.status!='closed')
        if exclude:stmt=stmt.where(d.SeasonRow.id!=exclude)
        if float(self.s.scalar(stmt) or 0)+area>field.area_ha+1e-9:
            raise PlatformError('AREA_ALLOCATION_EXCEEDED','Season allocations exceed the field area.')

    def create_field(self,body):
        value=c.Field(**dump(body),id=d.new_id(),farmer_id=self.actor.farmer_id,version=1)
        row=d.FieldRow(id=value.id,tenant_id=self.actor.tenant_id,farmer_id=self.actor.farmer_id,name=value.name,area_ha=value.area_ha,version=1,payload=dump(value))
        self.s.add(row);self.s.flush();self.event('field.updated',row);return value

    def create_season(self,field_id,body):
        field=self.own(d.FieldRow,field_id,True)
        if field.archived:raise PlatformError('FIELD_ARCHIVED','Restore or choose an active field.',409)
        if body.intercropping_group_id:raise PlatformError('INTERCROPPING_UNSUPPORTED','Explicit intercropping allocation rules are not configured.')
        self.allocation(field,body.allocated_area_ha)
        value=c.Season(**dump(body),id=d.new_id(),field_id=field_id,version=1)
        row=d.SeasonRow(id=value.id,tenant_id=self.actor.tenant_id,field_id=field_id,crop_id=value.crop_id,allocated_area_ha=value.allocated_area_ha,status=value.status,version=1,payload=dump(value))
        self.s.add(row);self.s.flush();self.event('season.updated',row);return value

    def active_season(self,id,lock=True):
        season=self.own(d.SeasonRow,id,lock)
        if season.status=='closed':raise PlatformError('SEASON_CLOSED','This season is already closed.',409)
        return season

    def create_journal(self,season_id,body,source='web'):
        season=self.active_season(season_id)
        for media_id in body.media_ids:
            media=self.own(d.MediaRow,media_id)
            if media.status!='ready':raise PlatformError('MEDIA_NOT_READY','Complete media validation before attaching it.',409)
        if body.recommendation_id:
            rec=self.own(d.RecommendationRow,body.recommendation_id)
            if rec.season_id!=season_id:raise missing()
        value=c.JournalEntry(**dump(body),id=d.new_id(),season_id=season_id,entered_by=self.actor.user_id,source=source,received_at=d.utcnow(),observation_quality='confirmed',version=1)
        row=d.JournalRow(**self.owned_values(dump(value)),season_id=season_id,occurred_at=body.occurred_at)
        self.s.add(row);self.s.flush();self.sync_ledger(value)
        self.bump_season(season);self.event('journal.confirmed',row);return value

    def sync_ledger(self,value):
        self.s.execute(delete(d.LedgerRow).where(d.LedgerRow.journal_entry_id==value.id,d.LedgerRow.tenant_id==self.actor.tenant_id))
        if value.cost_inr is not None:
            line=c.LedgerLine(id=d.new_id(),season_id=value.season_id,journal_entry_id=value.id,kind='cost',amount=value.cost_inr,unit='INR',occurred_at=value.occurred_at)
            self.s.add(d.LedgerRow(**self.owned_values(dump(line)),season_id=value.season_id,journal_entry_id=value.id,kind='cost',amount=value.cost_inr,unit='INR'))
        if value.action=='watered':
            for quantity in value.quantities:
                if quantity.value is not None and quantity.unit in ('mm','m3','litre'):
                    if quantity.value<0:raise PlatformError('INVALID_QUANTITY','Water quantity cannot be negative.')
                    line=c.LedgerLine(id=d.new_id(),season_id=value.season_id,journal_entry_id=value.id,kind='irrigation',amount=quantity.value,unit=quantity.unit,occurred_at=value.occurred_at)
                    self.s.add(d.LedgerRow(**self.owned_values(dump(line)),season_id=value.season_id,journal_entry_id=value.id,kind='irrigation',amount=quantity.value,unit=quantity.unit))

    def job(self,kind,payload):
        now=d.utcnow();value=c.Job(id=d.new_id(),kind=kind,status='pending',created_at=now,updated_at=now)
        row=d.JobRow(**self.owned_values({'id':value.id,'request':payload}),kind=kind,status='pending',attempts=0,created_at=now,updated_at=now)
        self.s.add(row);self.s.flush()
        self.s.add(d.OutboxRow(tenant_id=self.actor.tenant_id,kind='job.requested',aggregate_id=row.id,payload={'job_id':row.id}))
        return value

    def job_view(self,row):
        return c.Job(id=row.id,kind=row.kind,status=row.status,created_at=aware(row.created_at),updated_at=aware(row.updated_at),attempts=row.attempts,result_id=row.payload.get('result_id'),error=row.payload.get('error'))

    def close_season(self,id,body):
        season=self.active_season(id);self.version(season,body.expected_version)
        if body.harvested_area_ha>season.allocated_area_ha:raise PlatformError('INVALID_HARVEST_AREA','Harvested area exceeds allocated area.')
        recs=list(self.s.scalars(select(d.RecommendationRow).where(d.RecommendationRow.season_id==id,d.RecommendationRow.tenant_id==self.actor.tenant_id)))
        value=c.SeasonClosure(**dump(body),id=d.new_id(),season_id=id,actual_margin_inr=body.realized_sales_inr-body.realized_costs_inr,forecast_snapshot_ids=[r.id for r in recs],confirmed_at=d.utcnow(),version=1)
        self.s.add(d.ClosureRow(**self.owned_values(dump(value)),season_id=id))
        season.status='closed';season.version+=1;season.payload={**season.payload,'status':'closed','version':season.version}
        for model in (d.TaskRow,d.ReminderRow):
            for row in self.s.scalars(select(model).where(model.season_id==id,model.tenant_id==self.actor.tenant_id).with_for_update()):
                if row.status in ('pending','snoozed','scheduled','queued'):
                    row.status='cancelled';row.version+=1;row.payload={**row.payload,'status':'cancelled','version':row.version}
        self.event('season.closed',season)
        return c.SeasonEvaluation(season_id=id,closure=value,warnings=['Science forecast-error evaluation pending integration.'])

    def execute(self,method,path,id,body,query):
        if path=='/me':
            row=self.own(d.FarmerRow,self.actor.farmer_id,method!='GET')
            if method=='GET':return row.payload
            if method=='PATCH':
                self.version(row,body.expected_version);row.version+=1
                patch=body.model_dump(mode='json',exclude_unset=True);patch.pop('expected_version')
                if 'consents' in patch and patch['consents'] is not None:
                    # Receipt time belongs to server, not the submitted consent timestamp.
                    patch['consents']=[{**v,'recorded_at':d.utcnow().isoformat()} for v in patch['consents']]
                value=c.Farmer.model_validate({**row.payload,**patch,'version':row.version});row.payload=dump(value);return value
            if not self.actor.email_verified:raise PlatformError('EMAIL_VERIFICATION_REQUIRED','Verify your email before deleting your account.',403)
            job=self.job('privacy.delete',{'user_id':self.actor.user_id});user=self.s.get(d.User,self.actor.user_id);user.disabled=True;return job
        if path=='/me/export':
            if not self.actor.email_verified:raise PlatformError('EMAIL_VERIFICATION_REQUIRED','Verify your email before exporting data.',403)
            return self.job('privacy.export',{})
        if path=='/fields':
            return self.paginate(d.FieldRow,query,archived=False) if method=='GET' else self.create_field(body)
        if path=='/fields/{id}':
            row=self.own(d.FieldRow,id,method!='GET')
            if method=='GET':return row.payload
            self.version(row,body.expected_version)
            patch=body.model_dump(mode='json',exclude_unset=True);patch.pop('expected_version')
            value=c.Field.model_validate({**row.payload,**patch,'version':row.version+1})
            allocated=self.s.scalar(select(func.coalesce(func.sum(d.SeasonRow.allocated_area_ha),0)).where(d.SeasonRow.field_id==id,d.SeasonRow.status!='closed'))
            if value.area_ha<float(allocated):raise PlatformError('AREA_ALLOCATION_EXCEEDED','New field area is below current season allocations.')
            row.name=value.name;row.area_ha=value.area_ha;row.version=value.version;row.payload=dump(value);self.event('field.updated',row)
            for season in self.s.scalars(select(d.SeasonRow).where(d.SeasonRow.field_id==id,d.SeasonRow.status!='closed').with_for_update()):self.bump_season(season)
            return value
        if path=='/fields/{id}/archive':
            row=self.own(d.FieldRow,id,True);self.version(row,body.expected_version)
            count=self.s.scalar(select(func.count()).select_from(d.SeasonRow).where(d.SeasonRow.field_id==id,d.SeasonRow.status!='closed'))
            if count:raise PlatformError('ACTIVE_SEASONS_EXIST','Close field seasons before archiving.',409)
            row.archived=True;row.version+=1;row.payload={**row.payload,'archived':True,'version':row.version};self.event('field.updated',row);return row.payload
        if path=='/fields/{id}/seasons':
            self.own(d.FieldRow,id)
            return self.paginate(d.SeasonRow,query,field_id=id) if method=='GET' else self.create_season(id,body)
        if path=='/seasons/{id}':
            row=self.own(d.SeasonRow,id,method!='GET')
            if method=='GET':return row.payload
            self.active_season(id);self.version(row,body.expected_version)
            patch=body.model_dump(mode='json',exclude_unset=True);patch.pop('expected_version')
            value=c.Season.model_validate({**row.payload,**patch,'version':row.version})
            self.allocation(self.own(d.FieldRow,row.field_id,True),value.allocated_area_ha,id)
            row.allocated_area_ha=value.allocated_area_ha;row.status=value.status;row.payload=dump(value);self.bump_season(row);return row.payload
        if path=='/seasons/{id}/close':return self.close_season(id,body)
        if path=='/seasons/{id}/summary':
            self.own(d.SeasonRow,id);closure=self.s.scalar(select(d.ClosureRow).where(d.ClosureRow.season_id==id,d.ClosureRow.tenant_id==self.actor.tenant_id))
            return c.SeasonEvaluation(season_id=id,closure=closure.payload if closure else None,warnings=['Season has not been closed.'] if closure is None else ['Science forecast-error evaluation pending integration.'])
        if path=='/seasons/{id}/journal':
            self.own(d.SeasonRow,id)
            return self.paginate(d.JournalRow,query,season_id=id) if method=='GET' else self.create_journal(id,body)
        if path=='/journal/{id}':
            row=self.own(d.JournalRow,id,True);season=self.active_season(row.season_id);self.version(row,body.expected_version)
            self.s.add(d.JournalRevision(journal_id=row.id,version=row.version,payload=row.payload))
            patch=body.model_dump(mode='json',exclude_unset=True);patch.pop('expected_version')
            value=c.JournalEntry.model_validate({**row.payload,**patch,'version':row.version+1})
            row.version=value.version;row.occurred_at=value.occurred_at;row.payload=dump(value);self.sync_ledger(value);self.bump_season(season);self.event('journal.confirmed',row);return value
        if path in ('/tasks','/notifications','/reminders') and method=='GET':
            filters={}
            if query.get('season_id'):self.own(d.SeasonRow,query['season_id']);filters['season_id']=query['season_id']
            return self.paginate({'/tasks':d.TaskRow,'/notifications':d.NotificationRow,'/reminders':d.ReminderRow}[path],query,**filters)
        if path=='/tasks/{id}':
            row=self.own(d.TaskRow,id,True);self.active_season(row.season_id);self.version(row,body.expected_version)
            if row.status in ('done','cancelled','expired'):raise PlatformError('TASK_TERMINAL','This task cannot be changed.',409)
            if body.status=='snoozed' and (not body.snoozed_until or body.snoozed_until<=d.utcnow()):raise PlatformError('INVALID_SNOOZE','Choose a future snooze time.')
            if body.confirmed_action:
                if body.status!='done':raise PlatformError('ACTION_REQUIRES_DONE','Confirm an action only when completing the task.')
                self.create_journal(row.season_id,body.confirmed_action)
            row.status=body.status;row.version+=1;row.payload={**row.payload,'status':row.status,'version':row.version}
            if body.snoozed_until:
                due=c.Interval.model_validate(row.payload['due']);duration=due.end_at-due.start_at
                row.due_at=body.snoozed_until;row.payload={**row.payload,'due':dump(c.Interval(start_at=body.snoozed_until,end_at=body.snoozed_until+duration))}
            if row.status=='done':self.event('task.completed',row)
            return row.payload
        if path=='/notifications/{id}':
            row=self.own(d.NotificationRow,id,True);self.version(row,body.expected_version);row.version+=1
            row.payload={**row.payload,'version':row.version,'read_at':d.utcnow().isoformat() if body.read else row.payload.get('read_at'),'acknowledged_at':d.utcnow().isoformat() if body.acknowledged else row.payload.get('acknowledged_at')};return row.payload
        if path=='/reminders' and method=='POST':
            self.active_season(body.season_id)
            if body.scheduled_at<=d.utcnow():raise PlatformError('INVALID_SCHEDULE','Choose a future reminder time.')
            if body.task_id:
                task=self.own(d.TaskRow,body.task_id)
                if task.season_id!=body.season_id:raise missing()
            value=c.Reminder(**dump(body),id=d.new_id(),status='scheduled',version=1)
            self.s.add(d.ReminderRow(**self.owned_values(dump(value)),season_id=value.season_id,scheduled_at=value.scheduled_at,status=value.status));return value
        if path=='/reminders/{id}':
            row=self.own(d.ReminderRow,id,True)
            try:expected=body.expected_version if method=='PATCH' else int(query.get('expected_version','0'))
            except ValueError as exc:raise PlatformError('INVALID_VERSION','Supply expected_version.') from exc
            self.version(row,expected);row.version+=1
            patch=body.model_dump(mode='json',exclude_unset=True) if method=='PATCH' else {'status':'cancelled'};patch.pop('expected_version',None)
            value=c.Reminder.model_validate({**row.payload,**patch,'version':row.version})
            if value.status=='scheduled' and value.scheduled_at<=d.utcnow():raise PlatformError('INVALID_SCHEDULE','Choose a future reminder time.')
            row.payload=dump(value);row.status=value.status;row.scheduled_at=value.scheduled_at
            return value if method=='PATCH' else c.MutationReceipt(id=id,status='cancelled',resource_id=id,version=row.version)
        if path=='/jobs/{id}':return self.job_view(self.own(d.JobRow,id))
        if path=='/media/uploads':
            ticket,key=media.ticket(self.settings,self.actor.tenant_id,body)
            self.s.add(d.MediaRow(**self.owned_values(dump(ticket.asset)),object_key=key,status='pending'))
            return ticket
        if path=='/media/{id}/complete':
            row=self.own(d.MediaRow,id,True)
            asset=media.confirm(self.settings,row,body)
            row.status=asset.status;row.sha256=body.sha256;row.version=asset.version;row.payload=dump(asset)
            return asset
        if path=='/media/{id}/access':
            row=self.own(d.MediaRow,id)
            if row.status!='ready':raise PlatformError('MEDIA_NOT_READY','This file is still being processed.',409)
            url,expires=media.store(self.settings).access_url(row.object_key)
            return c.MediaAccess(url=url,expires_at=datetime.fromtimestamp(expires,UTC))
        if path=='/soil/extractions':
            self.own(d.FieldRow,body.field_id)
            asset=self.own(d.MediaRow,body.media_id)
            if asset.status!='ready':raise PlatformError('MEDIA_NOT_READY','Complete the upload before extraction.',409)
            return self.job('soil.extract',{'field_id':body.field_id,'media_id':body.media_id})
        if path=='/conversations':
            if body.field_id:self.own(d.FieldRow,body.field_id)
            if body.season_id:
                season=self.own(d.SeasonRow,body.season_id)
                if body.field_id and season.field_id!=body.field_id:raise missing()
            value=c.Conversation(**dump(body),id=d.new_id(),created_at=d.utcnow(),version=1)
            self.s.add(d.ConversationRow(**self.owned_values(dump(value))));return value
        if path=='/conversations/{id}/messages':
            self.own(d.ConversationRow,id,method=='POST')
            if method=='GET':return self.paginate(d.MessageRow,query,conversation_id=id)
            if not body.text.strip() and not body.media_ids:raise PlatformError('EMPTY_MESSAGE','Enter a message or attach media.')
            for media_id in body.media_ids:self.own(d.MediaRow,media_id)
            value=c.Message(**dump(body),id=d.new_id(),conversation_id=id,role='user',created_at=d.utcnow())
            self.s.add(d.MessageRow(**self.owned_values(dump(value)),conversation_id=id));self.s.flush()
            self.job('assistant.reply',{'conversation_id':id,'message_id':value.id});return value
        if path in ('/proposals/{id}/confirm','/proposals/{id}/cancel'):
            row=self.own(d.ProposalRow,id,True);self.version(row,body.expected_version)
            if row.status!='pending':raise PlatformError('PROPOSAL_NOT_PENDING','This proposal is no longer pending.',409)
            if aware(row.expires_at)<=d.utcnow():raise PlatformError('PROPOSAL_EXPIRED','This proposal expired. Request a new one.',409)
            proposal=c.ProposedMutation.model_validate(row.payload)
            if path.endswith('/cancel'):
                row.status='cancelled';row.version+=1;row.payload={**row.payload,'status':row.status,'version':row.version};return c.MutationReceipt(id=id,status='cancelled')
            mapping={'journal.create':('POST','/seasons/{id}/journal',d.SeasonRow),'field.update':('PATCH','/fields/{id}',d.FieldRow),'task.update':('PATCH','/tasks/{id}',d.TaskRow),'season.close':('POST','/seasons/{id}/close',d.SeasonRow)}
            target_method,target_path,model=mapping[proposal.operation]
            target=self.own(model,proposal.target_id,True);self.version(target,proposal.expected_version)
            result=self.execute(target_method,target_path,proposal.target_id,proposal.new_values,{})
            row.status='confirmed';row.version+=1;row.payload={**row.payload,'status':row.status,'version':row.version}
            return c.MutationReceipt(id=id,status='completed',resource_id=proposal.target_id,version=target.version)
        if path=='/channels/whatsapp/link':
            if method=='DELETE':
                for row in self.s.scalars(select(d.ChannelRow).where(d.ChannelRow.tenant_id==self.actor.tenant_id,d.ChannelRow.farmer_id==self.actor.farmer_id,d.ChannelRow.provider=='whatsapp')):
                    row.opted_in=False;self.s.delete(row)
                return c.MutationReceipt(id=d.new_id(),status='completed')
            if not self.actor.email_verified:raise PlatformError('EMAIL_VERIFICATION_REQUIRED','Verify your email before linking WhatsApp.',403)
            code=secrets.token_urlsafe(18);id=d.new_id();expiry=d.utcnow()+timedelta(minutes=10)
            self.s.add(d.LinkChallenge(**self.owned_values({'id':id,'consent_version':body.consent_version}),code_hash=hashlib.sha256(code.encode()).hexdigest(),expires_at=expiry))
            return c.ChannelLinkChallenge(challenge_id=id,code=code,expires_at=expiry,instructions='Send LINK followed by this code from your WhatsApp account. This code can be used once.')
        if path=='/channels/push':
            digest=hashlib.sha256(body.token.encode()).hexdigest()
            row=self.s.scalar(select(d.ChannelRow).where(d.ChannelRow.provider=='push',d.ChannelRow.external_id_hash==digest))
            if row and (row.farmer_id!=self.actor.farmer_id or row.tenant_id!=self.actor.tenant_id):raise missing()
            if method=='DELETE':
                if row:self.s.delete(row)
                return c.MutationReceipt(id=d.new_id(),status='completed')
            if not row:
                row=d.ChannelRow(**self.owned_values({'id':d.new_id(),'token':body.token,'consent_version':body.consent_version}),provider='push',external_id_hash=digest,opted_in=True);self.s.add(row)
            else:row.opted_in=True
            return c.MutationReceipt(id=row.id,status='completed',resource_id=row.id)
        if path.startswith('/agronomist/'):
            return self.agronomist(path,body,query)
        if path=='/planning/compare':
            self.own(d.FieldRow,body.field_id);raise unavailable('Crop planning science integration')
        if path.startswith('/catalog/'):
            return self.catalog(path,query)
        if path=='/seasons/{id}/evaluate':
            season=self.active_season(id);self.version(season,body.expected_version)
            return self.job('science.evaluate',{'season_id':id,'expected_version':body.expected_version})
        if path=='/recommendations/{id}':return self.own(d.RecommendationRow,id).payload['recommendation']
        if path.startswith('/seasons/{id}/'):
            season=self.own(d.SeasonRow,id)
            rec=self.s.scalar(select(d.RecommendationRow).where(d.RecommendationRow.season_id==id,d.RecommendationRow.tenant_id==self.actor.tenant_id,d.RecommendationRow.superseded.is_(False)).order_by(d.RecommendationRow.created_at.desc(),d.RecommendationRow.id.desc()).limit(1))
            if not rec:raise unavailable('Current season evaluation')
            if path.endswith('/recommendations/latest'):
                value=c.Recommendation.model_validate(rec.payload['recommendation'])
                if value.expires_at<=d.utcnow():raise PlatformError('RECOMMENDATION_EXPIRED','Request a fresh evaluation.',409,True)
                return value
            key=path.split('/')[-1]
            result=rec.snapshot.get('forecast') if key=='forecast' else rec.payload.get(key)
            if result is None:raise unavailable(key.capitalize())
            return result
        raise unavailable('This platform capability')

    def catalog(self,path,query):
        """Served from the Phase 2 reference bundle; the platform never invents catalog entries."""
        if path=='/catalog/locations':
            try:limit=int(query.get('limit','10'))
            except ValueError as exc:raise PlatformError('INVALID_PAGINATION','Use a valid cursor and limit from 1 to 100.') from exc
            if not 1<=limit<=100:raise PlatformError('INVALID_PAGINATION','Use a valid cursor and limit from 1 to 100.')
            return locations.search(query.get('q',''),limit,self.settings)
        bundle=science.references()
        items=bundle.crops if path=='/catalog/crops' else bundle.products
        try:
            limit=int(query.get('limit','25'))
            if not 1<=limit<=100:raise ValueError()
        except ValueError as exc:
            raise PlatformError('INVALID_PAGINATION','Use a valid cursor and limit from 1 to 100.') from exc
        after=''
        if query.get('cursor'):
            try:after=base64.urlsafe_b64decode(query['cursor'].encode()).decode()
            except (ValueError,UnicodeError) as exc:
                raise PlatformError('INVALID_PAGINATION','Use a valid cursor and limit from 1 to 100.') from exc
        ordered=sorted((dump(item) for item in items),key=lambda item:item['id'])
        page=[item for item in ordered if item['id']>after][:limit+1]
        next_cursor=base64.urlsafe_b64encode(page[limit-1]['id'].encode()).decode() if len(page)>limit else None
        return {'items':page[:limit],'next_cursor':next_cursor}

    def agronomist(self,path,body,query):
        if self.actor.role not in ('agronomist','admin'):raise PlatformError('FORBIDDEN','An assigned agronomist role is required.',403)
        assignments=select(d.Assignment.farmer_id).where(d.Assignment.user_id==self.actor.user_id,d.Assignment.tenant_id==self.actor.tenant_id)
        fields=list(self.s.scalars(select(d.FieldRow).where(d.FieldRow.tenant_id==self.actor.tenant_id,d.FieldRow.farmer_id.in_(assignments))))
        if path.endswith('/summary'):
            count=self.s.scalar(select(func.count()).select_from(d.SeasonRow).where(d.SeasonRow.tenant_id==self.actor.tenant_id,d.SeasonRow.field_id.in_([f.id for f in fields]),d.SeasonRow.status=='active'))
            return c.AgronomistSummary(assigned_farmer_count=len({f.farmer_id for f in fields}),field_count=len(fields),active_season_count=count or 0,recommendation_status_counts={})
        if path.endswith('/fields'):return {'items':[f.payload for f in fields[:100]],'next_cursor':None}
        if path.endswith('/stress-map'):return {'items':[dump(c.StressMapPoint(field_id=f.id,centroid=f.payload['centroid'],stress=None,missing_reason='No evaluated stress snapshot.')) for f in fields[:100]],'next_cursor':None}
        if path.endswith('/models'):return {'items':[r.payload for r in self.s.scalars(select(d.ModelRow).where(d.ModelRow.status=='approved').limit(100))],'next_cursor':None}
        if path.endswith('/evidence'):
            return {'items':[dump(record) for record in science.references().evidence[:100]],'next_cursor':None}
        raise unavailable('Reviewed backtests')
