"""Worker entry point.

Deployed as a Cloud Run job that performs one pass and exits, which Cloud Scheduler invokes
on a schedule. A pass that finds nothing to do is normal and exits successfully; a pass that
fails exits non-zero so the failure is visible in the job history rather than swallowed.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from agrisense.config import Settings, get_settings
from agrisense.platform import analytics, limits, reminders, science, worker
from agrisense.platform import db as d

log = logging.getLogger('agrisense.platform.worker_main')


async def one_pass(settings: Settings, sessions) -> dict[str, int]:
    """Every stage is independent: one failing stage must not stop the others."""
    outcome: dict[str, int] = {}
    outcome['jobs'] = await worker.drain_jobs(sessions, settings)
    try:
        outcome['reminders'] = sum(reminders.dispatch(sessions, settings).values())
    except Exception:
        log.exception('reminder dispatch failed this pass')
        outcome['reminders'] = 0
    session = sessions()
    try:
        outcome['expired_tasks'] = science.expire_stale_tasks(session)
        outcome['pruned_rate_windows'] = limits.prune(session)
        session.commit()
    except Exception:
        session.rollback()
        log.exception('task expiry failed this pass')
        outcome['expired_tasks'] = 0
    finally:
        session.close()
    if settings.analytics_available:
        try:
            outcome['analytics'] = analytics.drain(sessions, settings)
        except Exception:
            log.exception('analytics export failed this pass')
            outcome['analytics'] = 0
    return outcome


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Drain queued platform work.')
    parser.add_argument('--loop', action='store_true', help='keep running; for local development only')
    parser.add_argument('--interval', type=float, default=5.0)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')
    settings = get_settings()
    engine = d.make_engine(settings)
    sessions = d.session_factory(engine)
    try:
        if args.loop:
            await worker.worker_loop(settings, interval=args.interval)
            return 0
        outcome = await one_pass(settings, sessions)
        log.info('worker pass complete: %s', outcome)
    except Exception:
        log.exception('worker pass failed')
        return 1
    finally:
        engine.dispose()
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
