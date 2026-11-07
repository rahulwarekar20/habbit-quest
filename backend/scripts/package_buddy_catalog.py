"""Project canonical public buddy references into the backend's immutable release seed."""

import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path, help="Canonical buddies.json from hq-buddies-catalog")
args = parser.parse_args()
raw = args.source.read_bytes()
records = json.loads(raw)
references = [
    {
        "id": record["id"],
        "catalog_version": record["catalog_version"],
        "supported_age_min": record["supported_age_min"],
        "supported_age_max": record["supported_age_max"],
        "available": True,
    }
    for record in sorted(records, key=lambda record: record["id"])
]
assert len(references) == 24 and len({record["id"] for record in references}) == 24
assert all(record["catalog_version"] == "0.1.0" for record in references)
target = Path(__file__).resolve().parents[1] / "src/habitquest_backend/data/buddy_catalog.json"
target.write_text(
    json.dumps({"source_sha256": hashlib.sha256(raw).hexdigest(), "buddies": references}, indent=2) + "\n"
)
print("Packaged 24 public buddy references for catalog 0.1.0.")
