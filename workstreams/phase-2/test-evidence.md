# Phase 2 test evidence

All numeric fixtures are synthetic arithmetic inputs, not empirical field evidence.

Milestone 1: Python 3.12.10, `PYTHONPATH=backend python3 -m unittest discover -s backend/tests/science -p test_core.py -v`, 9 passed. Source boundary, monotonicity, nonfinite/missing, water balance, unit conversion, FAO reference, decimal economics, zero yield and duplicate/revised cost coverage.

Independent ET0 source: https://www.fao.org/4/x0490e/x0490e08.htm, example 18, Rn=13.28 MJ/m²/day and published ET0=3.88 mm/day. Initial fixture transcription failure corrected and rerun successfully.

Not run: authenticated API, PostgreSQL integration, Playwright and hosted staging. These require the shared runtime; unit checks do not substitute for them.
