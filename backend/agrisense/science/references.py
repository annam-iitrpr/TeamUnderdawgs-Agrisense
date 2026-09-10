"""Read reviewed, versioned scalar records through the existing v1 extension map."""

import json
import os
from datetime import date
from functools import lru_cache
from pathlib import Path

from agrisense.contracts_generated import models as api

from .units import finite

# Reference records live as data, not as literals in this module, so a reviewed
# regional file can be dropped in without a code change and so every number
# keeps the citation it was transcribed from. See science/reference/PARAMETERS.md
# for what is sourced, what is assumed, and what is still missing.
#
# The directory is searched rather than hardcoded because the repository layout
# and the container layout differ: in the repo the files sit beside `backend/`,
# while the image copies them to `/app/science/reference` next to the package.
# A single hardcoded path silently resolved to nothing in the container, which
# turned a packaging omission into "no reviewed data available" — indistinguishable,
# from the outside, from the honest version of that same message.
_CANDIDATE_DIRS = (
    # An explicit override wins, so a deployment can mount a separately reviewed
    # bundle without rebuilding the image.
    None,  # placeholder for AGRISENSE_REFERENCE_DIR, resolved in reference_dir()
    Path(__file__).resolve().parents[3] / "science" / "reference",
    Path(__file__).resolve().parents[2] / "science" / "reference",
    Path("/app/science/reference"),
)


def reference_dir() -> Path | None:
    """First existing reference directory, or None when nothing is packaged."""
    override = os.environ.get("AGRISENSE_REFERENCE_DIR")
    if override:
        path = Path(override)
        return path if path.is_dir() else None
    for candidate in _CANDIDATE_DIRS[1:]:
        if candidate.is_dir():
            return candidate
    return None

# Order matters only in that a later file may add keys; it may not silently
# overwrite an earlier one. `_load` refuses a duplicate key outright, because a
# reference value quietly replaced by another file is exactly the kind of change
# nobody notices until the advice is wrong.
REFERENCE_FILES = ("parameters.json", "crop-calendar.json")


def _read(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # A malformed reference file must not be silently treated as "no
        # parameters": that reads as an honest unknown when it is really a
        # broken deployment. It is surfaced as an empty bundle plus a raise at
        # load time so tests catch it, rather than degrading in production.
        raise
    return loaded if isinstance(loaded, dict) else {}


@lru_cache(maxsize=1)
def _load() -> tuple[dict, tuple[api.EvidenceRecord, ...]]:
    """Read every reference file once, refusing duplicate parameter keys."""
    parameters: dict[str, dict] = {}
    evidence: dict[str, api.EvidenceRecord] = {}
    directory = reference_dir()
    if directory is None:
        return {}, ()
    for name in REFERENCE_FILES:
        loaded = _read(directory / name)
        for row in loaded.get("evidence") or []:
            record = api.EvidenceRecord(
                id=str(row["id"]),
                kind=str(row["kind"]),
                title=str(row["title"]),
                source=str(row["source"]),
                limitations=[str(item) for item in row.get("limitations") or []],
            )
            if record.id in evidence:
                raise ValueError(f"duplicate evidence id {record.id} in {name}")
            evidence[record.id] = record
        for key, record_body in (loaded.get("parameters") or {}).items():
            if key in parameters:
                raise ValueError(f"duplicate parameter key {key} in {name}")
            if not isinstance(record_body, dict):
                raise ValueError(f"parameter {key} in {name} is not an object")
            parameters[str(key)] = dict(record_body)
    return parameters, tuple(evidence.values())


def reference_bundle() -> api.ReferenceBundle:
    """Return the catalog, plus whatever reviewed records the reference files hold.

    Catalog inclusion is not scientific approval, and neither is the presence of
    a parameter record: `reviewed_parameters` still checks the review flag, the
    evidence reference and the validity window on every read. Each call returns
    fresh models; deployments can inject separately reviewed bundles into the
    pure facade.
    """
    parameters, evidence = _load()
    return api.ReferenceBundle(
        # The version names what is actually loaded. Reporting
        # "rules-only-unreviewed-v1" while serving FAO-sourced water parameters
        # would understate the bundle; reporting a reviewed version while the
        # files are empty would overstate it.
        version="fao56-water-v1" if parameters else "rules-only-unreviewed-v1",
        crops=[
            api.Crop(
                id=crop_id,
                name=name,
                supported_for_biological_advice=crop_id in {"rice", "wheat", "cotton"},
            )
            for crop_id, name in (
                ("rice", "Rice"),
                ("wheat", "Wheat"),
                ("maize", "Maize"),
                ("soybean", "Soybean"),
                ("cotton", "Cotton"),
            )
        ],
        products=[],
        evidence=list(evidence),
        # Copied per call: the facade and its callers must not be able to mutate
        # the cached reference data for every later request in the process.
        parameters={key: dict(body) for key, body in parameters.items()},
    )


def reviewed_parameters(references: api.ReferenceBundle, key: str, as_of: date) -> dict | None:
    record = references.parameters.get(key)
    if not record or record.get("reviewed") is not True:
        return None
    evidence = record.get("evidence_id")
    if not isinstance(evidence, str) or evidence not in {row.id for row in references.evidence}:
        return None
    try:
        valid_from = date.fromisoformat(str(record["valid_from"]))
        valid_until = date.fromisoformat(str(record["valid_until"]))
    except (KeyError, ValueError):
        return None
    return record if valid_from <= as_of <= valid_until else None


def number(record: dict, key: str, *, low: float | None = None, high: float | None = None) -> float:
    value = record[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{key} must be numeric")
    return finite(float(value), key, low, high)


def select_soil(
    observations: list[api.SoilObservation], field_id: str, as_of: date
) -> api.SoilObservation | None:
    eligible = [
        row
        for row in observations
        if row.field_id == field_id
        and row.confirmation_state == "confirmed"
        and row.sampled_on is not None
        and row.sampled_on <= as_of
    ]
    priority = {"lab": 0, "farmer": 1, "gridded_estimate": 2}
    eligible.sort(key=lambda row: (priority[row.source], -row.sampled_on.toordinal(), row.id))
    return eligible[0] if eligible else None
