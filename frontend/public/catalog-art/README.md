# Catalog artwork

Copied unchanged from `hq-habits-catalog/habit-art/asset-manifest.json`, refreshed
on 2026-11-05. All copied bytes and PNG dimensions were checked against that
manifest. The local `manifest.json` records each original source path, SHA-256,
dimensions and byte count.

Includes 381 age-specific illustrations (512px wide), their 381 original 128px
icons, and 24 category illustrations at their original native dimensions. Goal
cards previously enlarged the 128px icons, causing softness, especially on
high-density screens. `CatalogVisual` now uses the 512px original with a
128w/512w responsive source set. Small 64px references can use the icon; larger
cards, dialogs and 88px child references can use the illustration. Keep the
illustration display box at or below 256 CSS pixels for full 2× resolution,
preserve its aspect ratio with `object-fit: contain`, and pass the actual CSS
width through the component's `sizes` prop when changing a layout. There is no
256px original export, and no artwork was regenerated, upscaled or recompressed.
The bundled PNGs total 153.4 MB; they load lazily as needed.

These are static presentation assets, not imported database goals. Metadata in
`src/data/catalogPresentation.json` is keyed by canonical source ID; child-facing titles/descriptions, ages,
supported contexts, deterministic goal IDs and emoji come from the pinned backend catalog, and category labels/art from the
art manifest. No generated draft chooses image URLs.

Generated habit pictures remain bundled Fluent SVGs under `public/fluent-emoji`;
they scale cleanly and are separate from the catalog's goal illustrations.
