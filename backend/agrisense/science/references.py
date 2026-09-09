"""Read reviewed, versioned scalar records through the existing v1 extension map."""

from datetime import date

from agrisense.contracts_generated import models as api

from .units import finite


def reference_bundle() -> api.ReferenceBundle:
    """Return the catalog available without approved regional/product evidence.

    Catalog inclusion is not scientific approval. Each call returns fresh models;
    deployments can inject separately reviewed bundles into the pure facade.
    """
    return api.ReferenceBundle(
        version="rules-only-unreviewed-v1",
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
        evidence=[],
        parameters={},
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
