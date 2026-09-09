"""Contract-driven ASGI surface. Routes come from the frozen registry, never hand-written per endpoint."""
from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from agrisense.config import Settings, get_settings
from agrisense.contracts_generated import models as c
from agrisense.contracts_generated.routes import ROUTES
from agrisense.platform import db as d
from agrisense.platform.auth import Actor, FirebaseVerifier, enroll
from agrisense.platform.errors import PlatformError
from agrisense.platform.service import DomainService

log = logging.getLogger('agrisense.platform')
API_PREFIX = '/api/v1'
# POST is always replayable by key; account deletion is the one destructive verb that also needs one.
IDEMPOTENT = {(method, path) for method, path, *_ in ROUTES if method == 'POST'} | {('DELETE', '/me')}


def envelope(data: Any, request_id: str, warnings: list[str] | None = None) -> dict[str, Any]:
    meta = c.Meta(request_id=request_id, data_mode='live', generated_at=d.utcnow(), warnings=warnings or [])
    return {'data': data, 'meta': meta.model_dump(mode='json')}


def failure(error: PlatformError, request_id: str) -> JSONResponse:
    body = c.ErrorResponse(error=c.ErrorDetail(code=error.code, message=error.message, details=error.details, retryable=error.retryable), request_id=request_id)
    return JSONResponse(body.model_dump(mode='json'), status_code=error.status)


def readable(exc: ValidationError) -> PlatformError:
    # Field paths help the caller; raw submitted values are never echoed back.
    fields = {'.'.join(str(part) for part in item['loc']): item['type'] for item in exc.errors()[:10]}
    return PlatformError('INVALID_REQUEST', 'Some values could not be accepted. Check the highlighted fields.', 422, details=fields)


def build_dispatcher(app: FastAPI, method: str, path: str, request_model, response_model, status: int) -> Callable:
    adapter = TypeAdapter(response_model)
    request_adapter = TypeAdapter(request_model) if request_model else None
    operation = f'{method} {path}'

    async def dispatch(request: Request) -> Response:
        request_id = request.state.request_id
        settings: Settings = request.app.state.settings
        raw = await request.body()
        if len(raw) > settings.max_request_bytes:
            return failure(PlatformError('REQUEST_TOO_LARGE', 'This request is too large.', 413), request_id)
        try:
            payload = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return failure(PlatformError('INVALID_JSON', 'The request body is not valid JSON.'), request_id)
        session = request.app.state.sessions()
        try:
            actor: Actor = authorize(request, session)
            body = request_adapter.validate_python(payload if payload is not None else {}) if request_adapter else None
            service = DomainService(session, actor, request_id)
            identifier = request.path_params.get('id', '')
            query = {key: value for key, value in request.query_params.items()}

            def run():
                return service.execute(method, path, identifier, body, query)

            if (method, path) in IDEMPOTENT:
                result = service.idempotent(operation, request.headers.get('Idempotency-Key', ''), payload or {}, run)
            else:
                result = run()
            session.commit()
        except PlatformError as error:
            session.rollback()
            return failure(error, request_id)
        except ValidationError as exc:
            session.rollback()
            return failure(readable(exc), request_id)
        except IntegrityError:
            session.rollback()
            log.warning('integrity conflict on %s request_id=%s', operation, request_id)
            return failure(PlatformError('CONFLICT', 'This change conflicts with existing data.', 409, True), request_id)
        except SQLAlchemyError:
            session.rollback()
            log.exception('database failure on %s request_id=%s', operation, request_id)
            return failure(PlatformError('STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.', 503, True), request_id)
        finally:
            session.close()
        code = 202 if path == '/seasons/{id}/evaluate' and isinstance(result, c.Job) else status
        try:
            validated = adapter.dump_python(adapter.validate_python(result), mode='json')
        except ValidationError:
            # A stored record that no longer satisfies the contract must not leak as a success.
            log.exception('response failed contract validation on %s request_id=%s', operation, request_id)
            return failure(PlatformError('RESPONSE_CONTRACT_ERROR', 'This result could not be produced. Please retry.', 500, True), request_id)
        return JSONResponse(envelope(validated, request_id), status_code=code)

    dispatch.__name__ = f'{method.lower()}_{path}'
    return dispatch


def authorize(request: Request, session) -> Actor:
    header = request.headers.get('Authorization', '')
    scheme, _, token = header.partition(' ')
    if scheme.lower() != 'bearer' or not token.strip():
        raise PlatformError('UNAUTHENTICATED', 'Please sign in to continue.', 401)
    identity = request.app.state.verifier.verify(token.strip(), sensitive=request.method in ('DELETE', 'PATCH'))
    return enroll(session, identity)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title='AgriSense platform', version='1.0.0', docs_url=None, redoc_url=None, openapi_url=None)
    engine = d.make_engine(settings)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessions = d.session_factory(engine)
    app.state.verifier = FirebaseVerifier(settings)

    origins = [origin.strip() for origin in settings.cors_allowed_origins.split(',') if origin.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                       allow_methods=['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
                       allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key'], max_age=600)

    @app.middleware('http')
    async def request_context(request: Request, call_next):
        request.state.request_id = d.new_id()
        response = await call_next(request)
        response.headers['X-Request-Id'] = request.state.request_id
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Frame-Options'] = 'DENY'
        if settings.app_env in ('staging', 'production'):
            response.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains'
        return response

    for method, path, request_model, response_model, status in ROUTES:
        app.add_api_route(API_PREFIX + path, build_dispatcher(app, method, path, request_model, response_model, status),
                          methods=[method], include_in_schema=False)

    @app.get('/healthz', include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {'status': 'ok'}

    @app.get('/readyz', include_in_schema=False)
    async def readyz() -> Response:
        from sqlalchemy import text
        try:
            with engine.connect() as connection:
                connection.execute(text('select 1'))
        except SQLAlchemyError:
            return JSONResponse({'status': 'unavailable'}, status_code=503)
        return JSONResponse({'status': 'ready'})

    return app
