"""Reproduce the main app's pinned, vector-free catalog from a verified local snapshot.

Usage: python scripts/package_planning_catalog.py /path/to/datasets/current.json
No provider or database calls. Original canonical card hashes remain unchanged.
"""

import hashlib
import json
import math
import sys
from pathlib import Path


def digest(value):
    raw = (
        value
        if isinstance(value, bytes)
        else json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    )
    return hashlib.sha256(raw).hexdigest()


def package(pointer_path: Path, destination: Path):
    pointer = json.loads(pointer_path.read_text())
    directory = pointer_path.parent / pointer["directory"]
    if directory.is_symlink() or directory.resolve().parent != pointer_path.parent.resolve():
        raise ValueError("Snapshot directory must stay beside its pointer")
    manifest_bytes = (directory / "manifest.json").read_bytes()
    if digest(manifest_bytes) != pointer["manifest_sha256"]:
        raise ValueError("Manifest checksum mismatch")
    manifest = json.loads(manifest_bytes)
    if manifest["snapshot_id"] != pointer["snapshot_id"] or manifest["records"] != 381:
        raise ValueError("Unexpected snapshot identity or count")
    if manifest["embedding"] != {
        "model": "text-embedding-3-small",
        "dimensions": 512,
        "metric": "cosine",
        "source": "actual_dimensions_api",
    } or manifest["target"] != {
        "index_name": "hq-habits-v1",
        "namespace": "habits-0-1-0",
        "catalog_version": "0.1.0",
    }:
        raise ValueError("Unexpected embedding contract or catalog target")
    if set(manifest["files"]) != {
        "dataset.json",
        "dataset.jsonl",
        "pinecone-documents.json",
        "pinecone-documents.jsonl",
        "supplemental.json",
    }:
        raise ValueError("Snapshot is incomplete")
    for name, expected in manifest["files"].items():
        path = directory / name
        if path.is_symlink() or path.parent != directory:
            raise ValueError("Invalid snapshot file")
        raw = path.read_bytes()
        if {"sha256": digest(raw), "bytes": len(raw)} != expected:
            raise ValueError("Snapshot file checksum mismatch")
    rows = json.loads((directory / "dataset.json").read_text())
    projected = []
    for row in rows:
        vector = row["embedding"]
        if (
            len(vector) != 512
            or any(type(x) not in {int, float} or not math.isfinite(x) for x in vector)
            or not any(vector)
            or digest(row["canonical_record"]) != row["metadata"]["canonical_record_sha256"]
            or digest(row["text"].encode()) != row["metadata"]["embedding_text_sha256"]
        ):
            raise ValueError("Invalid source card or vector")
        metadata = {
            k: row["metadata"][k]
            for k in (
                "concept_id",
                "category_id",
                "catalog_version",
                "age_min",
                "age_max",
                "contexts",
                "available_by_default",
                "language",
                "intent_class",
                "canonical_record_sha256",
                "embedding_text_sha256",
            )
        }
        projected.append(
            {
                "id": row["id"],
                "canonical_record": row["canonical_record"],
                "text": row["text"],
                "metadata": metadata,
            }
        )
    result = {
        "snapshot_id": pointer["snapshot_id"],
        "source_manifest_sha256": pointer["manifest_sha256"],
        "embedding": manifest["embedding"],
        "target": manifest["target"],
        "records": sorted(projected, key=lambda row: row["id"]),
    }
    raw = (
        json.dumps(
            result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
        + b"\n"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
    print(f"Packaged {len(projected)} canonical cards, {len(raw)} bytes, sha256={digest(raw)}")


if __name__ == "__main__":
    package(
        Path(sys.argv[1]),
        Path(__file__).resolve().parents[1] / "src/habitquest_backend/data/planning_catalog.json",
    )
