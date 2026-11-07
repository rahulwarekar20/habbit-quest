# Microsoft Fluent Emoji for action cards

This is a small, locally served **Flat SVG** selection from [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji), pinned to commit `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`. The 32 original SVGs total 61,631 bytes. The [MIT license](LICENSE) and Microsoft copyright notice are retained.

An action selects an approved semantic key such as `book`, `basket` or `toothbrush`. Its icon URL is `/fluent-emoji/{key}.svg`; use `sparkles` when no more specific approved icon fits. The app displays the actual SVG file in an image element. Unicode in the manifest is a search/accessibility reference, not the rendered artwork.

[manifest.json](manifest.json) records every key, emoji, accessible label, local file/URL, upstream path and pinned raw URL, upstream Git blob SHA, downloaded SHA-256 and byte count. The model never supplies SVG markup, arbitrary file paths or an external image URL.

The assets are unmodified upstream files. Before inclusion, every file was parsed as SVG XML and checked for scripts, embedded foreign content, event-handler attributes, document entities and external resource references. Official source and license:

- [Repository](https://github.com/microsoft/fluentui-emoji)
- [Pinned license](https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/LICENSE)
- [Pinned asset tree](https://github.com/microsoft/fluentui-emoji/tree/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets)

From `hq-app/testing`, run `npm test` to verify this selection's hashes, allowlist, provenance, license and reference safety along with the other local tests. No network or AI call is needed.
