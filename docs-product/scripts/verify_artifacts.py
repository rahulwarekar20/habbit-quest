#!/usr/bin/env python3
"""Verify local illustration artifacts and refresh their provenance manifest."""

from __future__ import annotations

import hashlib
import json
import re
import struct
import zlib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_metadata(path: Path) -> dict:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"Invalid PNG: {path}"
    width, height = struct.unpack(">II", data[16:24])
    offset = 8
    ended = False
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        payload = data[offset + 4:offset + 8 + length]
        crc = struct.unpack(">I", data[offset + 8 + length:offset + 12 + length])[0]
        assert zlib.crc32(payload) & 0xFFFFFFFF == crc, f"PNG CRC mismatch: {path}"
        offset += length + 12
        if payload[:4] == b"IEND":
            ended = True
            break
    assert ended and offset == len(data), f"Incomplete PNG: {path}"
    return {"path": str(path.relative_to(ROOT)), "width": width, "height": height,
            "bytes": len(data), "sha256": digest(path)}


def main() -> None:
    metadata = json.loads((ROOT / "slides.json").read_text())
    slides = metadata["slides"]
    assert len(slides) == 10, "Expected ten main slides"
    assert len({slide["image"] for slide in slides}) == 10
    preservation = json.loads((ROOT / "sources/pre-planner-review-image-hashes.json").read_text())
    for relative, expected in preservation.items():
        assert digest(ROOT / relative) == expected, f"Preserved illustration changed: {relative}"
    assets = [png_metadata(path) for path in sorted((ROOT / "illustrations").glob("*.png"))]
    by_path = {asset["path"]: asset for asset in assets}
    for slide in slides:
        asset = by_path[slide["image"]]
        assert (slide["width"], slide["height"]) == (asset["width"], asset["height"])
        assert slide["alt"] and slide["caption"]
        assert (ROOT / slide["contract"]).is_file()

    checked_links: list[Path] = []
    def check_link(base: Path, url: str) -> None:
        if not url or url.startswith(("#", "http:", "https:", "mailto:", "data:")):
            return
        relative = unquote(url.split("#", 1)[0].split("?", 1)[0])
        if relative:
            target = (base / relative).resolve()
            assert target.exists(), f"Missing link target: {target}"
            checked_links.append(target)

    markdown_files = [ROOT.parent / "README.md", *ROOT.rglob("*.md")]
    for path in markdown_files:
        body = re.sub(r"```.*?```", "", path.read_text(), flags=re.S)
        for url in re.findall(r"!?\[[^\]]*\]\(([^\s)]+)\)", body):
            check_link(path.parent, url)

    class Page(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.images: list[dict] = []
            self.ids: set[str] = set()
            self.anchors: list[str] = []

        def handle_starttag(self, tag: str, attrs: list) -> None:
            item = dict(attrs)
            if "id" in item:
                self.ids.add(item["id"])
            for key in ("href", "src"):
                if key in item:
                    check_link(ROOT, item[key])
            if item.get("href", "").startswith("#"):
                self.anchors.append(item["href"][1:])
            if tag == "img":
                self.images.append(item)

    for name in ("index.html", "presentation.html"):
        page = Page()
        page.feed((ROOT / name).read_text())
        assert set(page.anchors) <= page.ids, f"Bad internal anchors: {name}"
        if name == "index.html":
            assert len(page.images) == 10
        for item in page.images:
            assert item.get("alt"), f"Missing alt text: {name}"
            if item.get("src") and "width" in item and "height" in item:
                asset = png_metadata(ROOT / item["src"])
                assert (int(item["width"]), int(item["height"])) == (asset["width"], asset["height"])

    for path in [*markdown_files, *ROOT.rglob("*.txt"), *ROOT.glob("*.html")]:
        assert all(line == line.rstrip() for line in path.read_text().splitlines()), path

    contracts = sorted((ROOT / "sources").glob("*contract.md"))
    source_paths = set((WORKSPACE / "habbit-quest/docs-design").glob("*.md"))
    for contract in contracts:
        for url in re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", contract.read_text()):
            if not url.startswith(("http:", "https:", "#")):
                source = (contract.parent / unquote(url.split("#", 1)[0])).resolve()
                if source.is_file() and not source.is_relative_to(ROOT):
                    source_paths.add(source)

    active = {slide["image"] for slide in slides}
    for asset in assets:
        asset["role"] = "main slide" if asset["path"] in active else "supplemental reference"
    manifest = {
        "collection": "HabitQuest architecture illustrations",
        "review_date": "2026-11-06",
        "dates_in_final_artwork": False,
        "main_slide_count": len(slides),
        "generation": {
            "tool": "built-in image_gen.imagegen",
            "mode": "style-reference generation and targeted image edits",
            "original_collection_calls": 10,
            "expanded_collection_calls": 12,
            "dedicated_helper_calls": 2,
            "python_image_editing": False,
            "note": "Original figures and drafts retained; prompts and individual review records explain corrections."
        },
        "skills": [
            "Illustrated Explainers",
            "imagegen",
            "ML Best Practices (recorded evaluation interpretation only)"
        ],
        "slides": slides,
        "assets": assets,
        "source_documents": [{"path": str(path.relative_to(WORKSPACE)), "sha256": digest(path)}
                             for path in sorted(source_paths)],
        "prompts": [{"path": str(path.relative_to(ROOT)), "sha256": digest(path)}
                    for path in sorted((ROOT / "prompts").glob("*.txt"))],
        "contracts": [{"path": str(path.relative_to(ROOT)), "sha256": digest(path)} for path in contracts],
        "drafts": [png_metadata(path) for path in sorted((ROOT / "drafts").glob("*.png"))],
        "previous_manifest": "sources/collection-v1-manifest.json",
        "seven_slide_manifest": "sources/collection-v2-manifest.json",
        "preserved_images": {"count": len(preservation), "all_hashes_unchanged": True,
                             "record": "sources/pre-planner-review-image-hashes.json"},
        "scope": "Local illustration artifacts only; no application, database or AWS changes."
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    report = {
        "status": "pass", "main_slides": len(slides), "final_pngs": len(assets),
        "local_links_checked": len(checked_links), "missing_targets": [],
        "png_chunk_integrity": "pass", "metadata_matches_png_dimensions": True,
        "gallery_alt_text_and_anchors": "pass", "trailing_whitespace": False,
        "visual_review": "VISUAL-QA.md", "dates_in_artwork_check": "Visual inspection, not OCR",
        "new_provider_evaluations_run": False
    }
    report["preserved_images_unchanged"] = len(preservation)
    (ROOT / "sources/verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
