"""Media custody: tickets, verification and short-lived reads.

Bytes never pass through the API. A ticket authorises exactly one object key, and an asset
only becomes readable once the uploaded bytes have been verified against the declared digest,
so a caller cannot register one file and store another.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError, unavailable

log = logging.getLogger('agrisense.platform.media')
TICKET_TTL = timedelta(minutes=15)
ACCESS_TTL = timedelta(minutes=10)
MAX_BYTES = 20 * 1024 * 1024
# Content type is never trusted from the client; the stored bytes must start with these.
SIGNATURES = {
    'image/jpeg': [b'\xff\xd8\xff'],
    'image/png': [b'\x89PNG\r\n\x1a\n'],
    'image/webp': [b'RIFF'],
    'application/pdf': [b'%PDF-'],
    'audio/ogg': [b'OggS'],
    # WebM and Matroska share the EBML header.
    'audio/webm': [b'\x1a\x45\xdf\xa3'],
    'audio/mpeg': [b'ID3', b'\xff\xfb', b'\xff\xf3', b'\xff\xf2'],
    'audio/wav': [b'RIFF'],
}
EXTENSIONS = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
              'application/pdf': '.pdf', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
              'audio/webm': '.webm'}


def object_key(tenant_id: str, asset_id: str, content_type: str) -> str:
    # Tenant-prefixed so a bucket-level listing cannot mix owners.
    return f'tenants/{tenant_id}/media/{asset_id}{EXTENSIONS.get(content_type, "")}'


def sign(settings: Settings, purpose: str, key: str, expires: int) -> str:
    secret = settings.media_signing_key
    if not secret:
        raise unavailable('Media storage')
    message = f'{purpose}:{key}:{expires}'.encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify_signature(settings: Settings, purpose: str, key: str, expires: int, signature: str, now: int) -> None:
    if expires < now:
        raise PlatformError('UPLOAD_LINK_EXPIRED', 'This link expired. Request a new one.', 403)
    if not hmac.compare_digest(sign(settings, purpose, key, expires), signature):
        raise PlatformError('UPLOAD_LINK_INVALID', 'This link is not valid.', 403)


def local_path(settings: Settings, key: str) -> Path:
    root = settings.uploads_dir.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        # A crafted key must never escape the media root.
        raise PlatformError('INVALID_OBJECT_KEY', 'This object could not be addressed.', 422)
    return path


class LocalStore:
    """Development store. Objects are written under the ignored .local media directory."""
    name = 'local'

    def __init__(self, settings: Settings):
        self.settings = settings

    def upload_url(self, key: str) -> tuple[str, dict[str, str], int]:
        expires = int((d.utcnow() + TICKET_TTL).timestamp())
        signature = sign(self.settings, 'put', key, expires)
        base = self.settings.public_api_base_url.rstrip('/')
        return f'{base}/media/local/{key}?expires={expires}&signature={signature}', {}, expires

    def access_url(self, key: str) -> tuple[str, int]:
        expires = int((d.utcnow() + ACCESS_TTL).timestamp())
        signature = sign(self.settings, 'get', key, expires)
        base = self.settings.public_api_base_url.rstrip('/')
        return f'{base}/media/local/{key}?expires={expires}&signature={signature}', expires

    def read(self, key: str) -> bytes:
        path = local_path(self.settings, key)
        if not path.exists():
            raise PlatformError('MEDIA_NOT_UPLOADED', 'Upload the file before confirming it.', 409)
        return path.read_bytes()

    def write(self, key: str, data: bytes) -> None:
        path = local_path(self.settings, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key: str) -> None:
        path = local_path(self.settings, key)
        if path.exists():
            path.unlink()


class BucketStore:
    """Google Cloud Storage. Signing needs a credential that can sign, not just read."""
    name = 'gcs'

    def __init__(self, settings: Settings):
        self.settings = settings
        from google.cloud import storage
        self.bucket = storage.Client(project=settings.google_cloud_project or None).bucket(settings.media_bucket)

    def _signing_identity(self) -> dict[str, str]:
        """Cloud Run's metadata credential has no private key, so signing goes through the IAM
        signBlob API instead. That needs serviceAccountTokenCreator on the runtime identity.
        A key-bearing credential signs locally and needs none of this."""
        from google.auth import default
        from google.auth.transport.requests import Request
        credentials, _ = default()
        if hasattr(credentials, 'signer_email') and getattr(credentials, 'signer', None) is not None:
            return {}
        credentials.refresh(Request())
        email = getattr(credentials, 'service_account_email', None)
        if not email or email == 'default':
            email = self.settings.signing_service_account
        if not email:
            raise unavailable('Media storage signing')
        return {'service_account_email': email, 'access_token': credentials.token}

    def _signed(self, key: str, method: str, ttl: timedelta, content_type: str | None = None) -> tuple[str, int]:
        expires = d.utcnow() + ttl
        try:
            url = self.bucket.blob(key).generate_signed_url(
                version='v4', expiration=expires, method=method, content_type=content_type,
                **self._signing_identity())
        except Exception as exc:
            # Without a signing credential the capability is unavailable; it is never bypassed.
            log.exception('cloud storage signing failed')
            raise unavailable('Media storage signing') from exc
        return url, int(expires.timestamp())

    def upload_url(self, key: str) -> tuple[str, dict[str, str], int]:
        url, expires = self._signed(key, 'PUT', TICKET_TTL)
        return url, {}, expires

    def access_url(self, key: str) -> tuple[str, int]:
        return self._signed(key, 'GET', ACCESS_TTL)

    def read(self, key: str) -> bytes:
        blob = self.bucket.blob(key)
        if not blob.exists():
            raise PlatformError('MEDIA_NOT_UPLOADED', 'Upload the file before confirming it.', 409)
        return blob.download_as_bytes()

    def write(self, key: str, data: bytes) -> None:
        self.bucket.blob(key).upload_from_string(data)

    def delete(self, key: str) -> None:
        blob = self.bucket.blob(key)
        if blob.exists():
            blob.delete()


def store(settings: Settings):
    if settings.media_bucket:
        return BucketStore(settings)
    if settings.app_env in ('staging', 'production'):
        raise unavailable('Media storage')
    return LocalStore(settings)


def sniff(content_type: str, data: bytes) -> None:
    prefixes = SIGNATURES.get(content_type)
    if prefixes and not any(data.startswith(prefix) for prefix in prefixes):
        raise PlatformError('MEDIA_TYPE_MISMATCH', 'This file does not match the type you declared.', 422)
    if content_type == 'audio/wav' and data[8:12] != b'WAVE':
        raise PlatformError('MEDIA_TYPE_MISMATCH', 'This file does not match the type you declared.', 422)
    if content_type == 'image/webp' and data[8:12] != b'WEBP':
        raise PlatformError('MEDIA_TYPE_MISMATCH', 'This file does not match the type you declared.', 422)


def ticket(settings: Settings, tenant_id: str, request: c.UploadRequest) -> tuple[c.UploadTicket, str]:
    if request.size_bytes > MAX_BYTES:
        raise PlatformError('MEDIA_TOO_LARGE', 'Choose a file of 20 MB or less.', 413)
    asset_id = d.new_id()
    key = object_key(tenant_id, asset_id, request.content_type)
    url, headers, expires = store(settings).upload_url(key)
    asset = c.MediaAsset(id=asset_id, content_type=request.content_type, size_bytes=request.size_bytes,
                         status='pending', captured_at=request.captured_at, received_at=d.utcnow(), version=1)
    # The advertised expiry is the store's own, so a client never trusts a longer window than exists.
    return c.UploadTicket(asset=asset, upload_url=url, expires_at=datetime.fromtimestamp(expires, UTC), headers=headers), key


def confirm(settings: Settings, row: d.MediaRow, declared: c.MediaComplete) -> c.MediaAsset:
    """Only bytes that match the declared digest, size and type become readable."""
    asset = c.MediaAsset.model_validate(row.payload)
    if row.status == 'ready':
        return asset
    data = store(settings).read(row.object_key)
    digest = hashlib.sha256(data).hexdigest()
    if not hmac.compare_digest(digest, declared.sha256):
        raise PlatformError('MEDIA_DIGEST_MISMATCH', 'The uploaded file does not match what was declared.', 422)
    if len(data) != asset.size_bytes:
        raise PlatformError('MEDIA_SIZE_MISMATCH', 'The uploaded file size does not match what was declared.', 422)
    if len(data) > MAX_BYTES:
        raise PlatformError('MEDIA_TOO_LARGE', 'Choose a file of 20 MB or less.', 413)
    sniff(asset.content_type, data)
    return asset.model_copy(update={'status': 'ready', 'version': asset.version + 1})


def nonce() -> str:
    return secrets.token_urlsafe(24)
