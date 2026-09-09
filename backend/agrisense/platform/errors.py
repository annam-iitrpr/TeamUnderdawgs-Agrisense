from typing import Any


class PlatformError(Exception):
    def __init__(self, code: str, message: str, status: int=422, retryable: bool=False, details: dict[str,Any] | None=None):
        self.code=code;self.message=message;self.status=status;self.retryable=retryable;self.details=details or {}
        super().__init__(message)

def missing() -> PlatformError:
    return PlatformError('NOT_FOUND','This record was not found.',404)

def unavailable(capability: str) -> PlatformError:
    return PlatformError('DEPENDENCY_UNAVAILABLE',f'{capability} is not available. Please try again later.',503,True)
