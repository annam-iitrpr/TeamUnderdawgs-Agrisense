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
REFERENCE_FILES = ("parameters.json", "crop-calendar.json", "biostimulants.json")


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
def _load() -> tuple[dict, tuple[api.EvidenceRecord, ...], tuple[api.Product, ...]]:
    """Read every reference file once, refusing duplicate parameter keys."""
    parameters: dict[str, dict] = {}
    evidence: dict[str, api.EvidenceRecord] = {}
    products: dict[str, api.Product] = {}
    directory = reference_dir()
    if directory is None:
        return {}, ()
    for name in REFERENCE_FILES:
        loaded = _read(directory / name)
        # Products are data like everything else here, so a new biostimulant is a
        # reference change and never a code change -- which is the whole point of
        # the engine reading a catalogue instead of branching on a product name.
        for row in loaded.get("products") or []:
            product = api.Product(
                id=str(row["id"]),
                name=str(row["name"]),
                crop_ids=[str(item) for item in row.get("crop_ids") or []],
                label_version=str(row["label_version"]),
                evidence_ids=[str(item) for item in row.get("evidence_ids") or []],
            )
            if product.id in products:
                raise ValueError(f"duplicate product id {product.id} in {name}")
            products[product.id] = product
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
        # Ranking weights sit beside the records as an ordinary parameter entry,
        # so the planner reads them the same way it reads everything else and an
        # agronomist can retune the emphasis without a code change.
        weights = loaded.get("ranking_weights")
        if isinstance(weights, dict):
            if "ranking_weights" in parameters:
                raise ValueError(f"duplicate ranking_weights in {name}")
            parameters["ranking_weights"] = {
                key: value for key, value in weights.items() if isinstance(value, (int, float))
            }
        for key, record_body in (loaded.get("parameters") or {}).items():
            if key in parameters:
                raise ValueError(f"duplicate parameter key {key} in {name}")
            if not isinstance(record_body, dict):
                raise ValueError(f"parameter {key} in {name} is not an object")
            parameters[str(key)] = dict(record_body)
    return parameters, tuple(evidence.values()), tuple(products.values())


def reference_bundle() -> api.ReferenceBundle:
    """Return the catalog, plus whatever reviewed records the reference files hold.

    Catalog inclusion is not scientific approval, and neither is the presence of
    a parameter record: `reviewed_parameters` still checks the review flag, the
    evidence reference and the validity window on every read. Each call returns
    fresh models; deployments can inject separately reviewed bundles into the
    pure facade.
    """
    parameters, evidence, products = _load()
    return api.ReferenceBundle(
        # The version names what is actually loaded. Reporting
        # "rules-only-unreviewed-v1" while serving FAO-sourced water parameters
        # would understate the bundle; reporting a reviewed version while the
        # files are empty would overstate it.
        version="punjab-pau-fao-v1" if parameters else "rules-only-unreviewed-v1",
        # Exactly the crops we hold a reviewed regional reference for. A
        # catalogue longer than the reference set would let a farmer pick
        # something the engine can only decline, which is a worse experience
        # than a shorter list of crops it can actually reason about.
        crops=[
            api.Crop(
                id=crop_id,
                name=name,
                # Biological product advice needs an approved product label, and
                # none is supplied for any crop yet. This flag says which crops
                # the product rules are *written* for, not that advice is ready.
                supported_for_biological_advice=crop_id in {"rice", "wheat", "cotton", "maize"},
            )
            # Ordered by regional suitability for the Punjab sub-montane
            # zone, most suited first. A caller that can only compare five
            # candidates at a time — which the engine's own limit is — then
            # gets the five worth comparing by taking the first five, rather
            # than an alphabetical accident.
            for crop_id, name in (
                ("wheat", "Wheat"),
                ("rice", "Rice (Paddy)"),
                ("maize", "Maize"),
                ("potato", "Potato"),
                ("sugarcane", "Sugarcane"),
                ("barley", "Barley"),
                ("field_pea", "Field Pea"),
                ("lentil", "Lentil"),
                ("sorghum", "Sorghum"),
                ("bajra", "Pearl Millet (Bajra)"),
                ("groundnut", "Groundnut"),
                ("onion", "Onion"),
                ("tomato", "Tomato"),
                ("moong", "Green Gram (Moong)"),
                ("cotton", "Cotton"),
            )
        ],
        products=list(products),
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
    """The best soil record for a field: a real sample if there is one, else a model.

    A measured, farmer-confirmed sample always wins. That ordering is the whole
    point, so it is expressed as two passes rather than one sort with a tie-break
    that could be reordered by accident.

    The second pass exists because the planner will not rank a crop without a
    soil pH, and a Soil Health Card is the only soil input most farmers can
    give — which most do not have to hand. With only the first pass, every crop
    was declined and the farmer was told to go and find a lab report, which is
    not an answer to "what should I sow". A gridded estimate opens that gate.

    A gridded estimate is deliberately *not* required to be confirmed or dated:
    a farmer confirms their own card, nobody can confirm a model on their
    behalf, and a modelled long-term average is not a sample taken on a day. It
    carries `source='gridded_estimate'` and its own provenance so every screen
    can say where the number came from.
    """
    mine = [row for row in observations if row.field_id == field_id]

    measured = [
        row
        for row in mine
        if row.source in ("lab", "farmer")
        and row.confirmation_state == "confirmed"
        and row.sampled_on is not None
        and row.sampled_on <= as_of
    ]
    if measured:
        priority = {"lab": 0, "farmer": 1}
        measured.sort(key=lambda row: (priority[row.source], -row.sampled_on.toordinal(), row.id))
        return measured[0]

    modelled = [
        row
        for row in mine
        if row.source == "gridded_estimate"
        and row.confirmation_state != "rejected"
        and (row.sampled_on is None or row.sampled_on <= as_of)
    ]
    modelled.sort(key=lambda row: row.id)
    return modelled[0] if modelled else None


def select_soil_moisture(
    observations: list[api.SoilObservation], field_id: str, as_of: date
) -> api.SoilObservation | None:
    """The reading a water balance can actually start from.

    `select_soil` answers a different question — the best soil record for this
    field — and for chemistry it is right to rank a lab result first and break
    ties on `id`. Moisture is not chemistry. A photographed Soil Health Card
    carries none at all, yet it is stored as an observation like any other, so
    the balance could be handed a record with no moisture in it and report that
    nothing was known. Both records are `source='farmer'` and both are dated the
    day they were taken, which left a random `id` deciding whether a farmer's
    water plan worked.

    So this ranks by recency, and only over readings in the volumetric m³/m³
    form the balance derives depletion from: a reading in another basis is kept
    but cannot start a balance, and must not shadow one that can.
    """
    priority = {"lab": 0, "farmer": 1, "gridded_estimate": 2}
    usable = [
        row
        for row in observations
        if row.field_id == field_id
        and row.confirmation_state == "confirmed"
        and row.sampled_on is not None
        and row.sampled_on <= as_of
        and row.moisture_basis == "volumetric"
        and row.moisture is not None
        and row.moisture.unit == "m³/m³"
        and row.moisture.value is not None
    ]
    usable.sort(key=lambda row: (-row.sampled_on.toordinal(), priority[row.source], row.id))
    return usable[0] if usable else None
