"""Only verified Firebase claims can enroll an application actor."""
import hashlib
import os
from dataclasses import dataclass

import firebase_admin
from firebase_admin import auth
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.contracts_generated.models import Farmer
from agrisense.platform.db import FarmerRow, Membership, Tenant, User
from agrisense.platform.errors import PlatformError


@dataclass(frozen=True)
class Identity:
    uid: str
    identity_verified: bool
    display_name: str

@dataclass(frozen=True)
class Actor:
    user_id: str
    tenant_id: str
    farmer_id: str
    role: str
    identity_verified: bool

class FirebaseVerifier:
    def __init__(self, settings: Settings):
        self.settings=settings
        if settings.firebase_auth_emulator_host:
            if settings.app_env not in ('development','test'):
                raise ValueError('Emulator is local-only')
            os.environ['FIREBASE_AUTH_EMULATOR_HOST']=settings.firebase_auth_emulator_host
        self.app_name='agrisense-'+settings.firebase_project_id

    def verify(self, token: str, sensitive: bool=False) -> Identity:
        try:
            try:app=firebase_admin.get_app(self.app_name)
            except ValueError:app=firebase_admin.initialize_app(options={'projectId':self.settings.firebase_project_id},name=self.app_name)
            claims=auth.verify_id_token(token,app=app,check_revoked=sensitive or not bool(self.settings.firebase_auth_emulator_host))
        except (ValueError,auth.InvalidIdTokenError,auth.ExpiredIdTokenError,auth.RevokedIdTokenError,auth.UserDisabledError) as exc:
            raise PlatformError('UNAUTHENTICATED','Please sign in again.',401) from exc
        except Exception as exc:
            # External auth failure is never converted to a valid identity.
            raise PlatformError('AUTH_UNAVAILABLE','Authentication is temporarily unavailable.',503,True) from exc
        uid=claims.get('uid') or claims.get('sub')
        if not isinstance(uid,str) or not uid:
            raise PlatformError('UNAUTHENTICATED','Please sign in again.',401)
        # Email accounts used this claim historically. Phone Auth users prove
        # possession through Firebase's phone provider, represented by the
        # verified phone_number claim instead.
        verified = bool(claims.get('email_verified') or claims.get('phone_number'))
        return Identity(uid, verified, str(claims.get('name') or 'Farmer')[:160])


def enroll(session: Session, identity: Identity) -> Actor:
    user=session.scalar(select(User).where(User.firebase_uid==identity.uid))
    if user is None:
        digest=hashlib.sha256(identity.uid.encode()).hexdigest()[:32]
        user_id='user_'+digest;tenant_id='tenant_'+digest;farmer_id='farmer_'+digest
        try:
            with session.begin_nested():
                session.add(Tenant(id=tenant_id));session.flush()
                session.add(User(id=user_id,firebase_uid=identity.uid));session.flush()
                session.add(Membership(user_id=user_id,tenant_id=tenant_id,role='farmer'))
                farmer=Farmer(id=farmer_id,tenant_id=tenant_id,display_name=identity.display_name,version=1)
                session.add(FarmerRow(id=farmer_id,tenant_id=tenant_id,user_id=user_id,payload=farmer.model_dump(mode='json')))
                session.flush()
        except IntegrityError:
            pass  # A concurrent verified request may have completed this same enrollment.
        user=session.scalar(select(User).where(User.firebase_uid==identity.uid))
    if not user or user.disabled:
        raise PlatformError('ACCOUNT_DISABLED','This account is unavailable.',403)
    farmer=session.scalar(select(FarmerRow).where(FarmerRow.user_id==user.id))
    if not farmer:raise PlatformError('ACCOUNT_NOT_ENROLLED','Account membership requires operator review.',403)
    membership=session.get(Membership,(user.id,farmer.tenant_id))
    if not membership:raise PlatformError('FORBIDDEN','Account membership is unavailable.',403)
    return Actor(user.id,farmer.tenant_id,farmer.id,membership.role,identity.identity_verified)
