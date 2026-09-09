"""Typed error bodies. The frontend renders user_message and never a stack trace."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

log = logging.getLogger(__name__)


class ErrorBody(BaseModel):
    code: str
    message: str
    user_message: str
    retryable: bool


class AgriSenseError(Exception):
    """An error we understand well enough to explain to a user."""

    def __init__(
        self,
        code: str,
        message: str,
        user_message: str,
        retryable: bool = False,
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.user_message = user_message
        self.retryable = retryable
        self.status_code = status_code


class NotFoundError(AgriSenseError):
    def __init__(self, what: str) -> None:
        super().__init__(
            "not_found",
            f"{what} not found",
            f"We could not find that {what.lower()}.",
            False,
            status_code=status.HTTP_404_NOT_FOUND,
        )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AgriSenseError)
    async def handle_known(_: Request, exc: AgriSenseError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorBody(
                code=exc.code,
                message=exc.message,
                user_message=exc.user_message,
                retryable=exc.retryable,
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def handle_unknown(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorBody(
                code="internal_error",
                message=str(exc),
                user_message="Something went wrong on our side. Your data is safe. Please try again.",
                retryable=True,
            ).model_dump(),
        )
