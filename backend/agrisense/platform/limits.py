"""Request throttling.

Per-actor budgets live in the database so they hold across instances; Cloud Run runs several
and an in-process counter would let the real rate scale with the instance count. The cheap
in-process check in front of it exists only to blunt an unauthenticated flood before it costs
a token verification.

Expensive work gets its own smaller budget, so a farmer exhausting evaluations cannot also
lock themselves out of reading their own records.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.limits')


@dataclass(frozen=True)
class Budget:
    bucket: str
    limit: int
    window_seconds: int


READS = Budget('read', 600, 60)
WRITES = Budget('write', 120, 60)
# Each of these costs a provider call, a model call or a large object, so they are metered apart.
EXPENSIVE = Budget('expensive', 30, 60)
EXPENSIVE_OPERATIONS = {
    ('POST', '/seasons/{id}/evaluate'), ('POST', '/planning/compare'),
    ('POST', '/media/uploads'), ('POST', '/soil/extractions'),
    ('POST', '/conversations/{id}/messages'), ('POST', '/me/export'),
}
ANONYMOUS_PER_MINUTE = 120


def budget_for(method: str, path: str) -> Budget:
    if (method, path) in EXPENSIVE_OPERATIONS:
        return EXPENSIVE
    return READS if method == 'GET' else WRITES


def too_many(retry_after: int) -> PlatformError:
    return PlatformError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.',
                         429, True, {'retry_after_seconds': retry_after})


def check(session: Session, subject: str, budget: Budget, now: float | None = None) -> None:
    """Fixed window per subject. A window row is created once and incremented in place."""
    now = now if now is not None else time.time()
    window_start = int(now // budget.window_seconds) * budget.window_seconds
    key = (subject, budget.bucket, window_start)
    row = session.get(d.RateLimitWindow, key)
    if row is None:
        try:
            with session.begin_nested():
                row = d.RateLimitWindow(subject=subject, bucket=budget.bucket,
                                        window_start=window_start, count=0)
                session.add(row)
                session.flush()
        except IntegrityError:
            # A concurrent request created the same window; use theirs.
            row = session.get(d.RateLimitWindow, key)
    if row is None:
        return
    if row.count >= budget.limit:
        raise too_many(max(1, int(window_start + budget.window_seconds - now)))
    row.count += 1
    session.flush()


def consume(sessions, subject: str, budget: Budget, now: float | None = None) -> None:
    """Count the attempt in its own transaction.

    Sharing the request's transaction would roll the increment back whenever the request
    failed, so a caller sending nothing but invalid requests would never be throttled. An
    attempt costs budget whether or not it succeeds.
    """
    session = sessions()
    try:
        check(session, subject, budget, now)
        session.commit()
    except PlatformError:
        session.commit()
        raise
    except Exception:
        session.rollback()
        # Throttling must never be the reason a healthy request fails.
        log.exception('rate limit accounting failed; allowing the request')
    finally:
        session.close()


def prune(session: Session, now: float | None = None, keep_seconds: int = 3600) -> int:
    """Windows are only useful while they are current; old rows are dropped by the worker."""
    from sqlalchemy import delete
    now = now if now is not None else time.time()
    cutoff = int(now) - keep_seconds
    return session.execute(delete(d.RateLimitWindow).where(d.RateLimitWindow.window_start < cutoff)).rowcount


@dataclass
class AnonymousGuard:
    """Per-instance and approximate on purpose: it protects token verification from a flood,
    it is not the authoritative budget. The database check behind it is."""
    limit: int = ANONYMOUS_PER_MINUTE
    window_seconds: int = 60
    seen: dict[str, tuple[int, int]] = field(default_factory=dict)

    def allow(self, client: str, now: float | None = None) -> bool:
        now = now if now is not None else time.time()
        window = int(now // self.window_seconds)
        current, count = self.seen.get(client, (window, 0))
        if current != window:
            current, count = window, 0
        if count >= self.limit:
            self.seen[client] = (current, count)
            return False
        self.seen[client] = (current, count + 1)
        if len(self.seen) > 10000:
            # Bounded so a spoofed-address flood cannot grow this map without limit.
            self.seen = {k: v for k, v in self.seen.items() if v[0] == window}
        return True
