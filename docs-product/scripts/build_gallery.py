#!/usr/bin/env python3
"""Rebuild the local viewers and slide index from slides.json; never alter artwork."""

import html
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    path = ROOT / "slides.json"
    data = json.loads(path.read_text())
    slides = data["slides"]
    for number, slide in enumerate(slides, 1):
        slide["number"] = number
        image = ROOT / slide["image"]
        if image.is_file():
            slide["width"], slide["height"] = struct.unpack(">II", image.read_bytes()[16:24])
    path.write_text(json.dumps(data, indent=2) + "\n")
    count = len(slides)
    escape = lambda value: html.escape(str(value), quote=True)
    figures = []
    for slide in slides:
        title = escape(slide["title"])
        image = escape(slide["image"])
        figures.append(f'''<figure id="{escape(slide['id'])}">
<div class="figure-heading"><h2><span class="number">{slide['number']:02d}</span> {title}</h2><a class="download" href="{image}" download>Download PNG</a></div>
<a class="image-link" href="{image}" aria-label="Open full-size {title}"><img src="{image}" alt="{escape(slide['alt'])}" width="{slide['width']}" height="{slide['height']}" loading="lazy"></a>
<figcaption><p class="caption">{escape(slide['caption'])}</p><p class="source"><a href="{escape(slide['contract'])}">Read the content contract and source references</a></p></figcaption>
</figure>''')
    extras = "".join(f'<li><a href="{escape(item["image"])}">{escape(item["title"])}</a> · <a href="{escape(item["contract"])}">source notes</a></li>' for item in data["supplemental"])
    supplemental = f'''<section aria-labelledby="supplemental-heading"><h2 id="supplemental-heading">Preserved supplemental reference</h2><p class="intro">The original product journey remains available here. The original detailed AI pipeline is also preserved unchanged and appears in the main presentation.</p><ul>{extras}</ul></section>'''
    page = (ROOT / "index.html").read_text()
    page = re.sub(r"<main>.*?</main>", lambda _: "<main>\n" + "\n".join(figures) + supplemental + "\n</main>", page, flags=re.S)
    nav = "".join(f'<a href="#{escape(item["id"])}">{item["number"]:02d} · {escape(item["title"])}</a>' for item in slides)
    nav += '<a href="presentation.html">Present slides</a><a href="README.md">Documentation</a>'
    page = re.sub(r'<nav aria-label="Illustrations">.*?</nav>', lambda _: '<nav aria-label="Illustrations">' + nav + '</nav>', page, flags=re.S)
    intro = f'{count} illustrated views preserve the detailed Coach runtime and give Quest Planner and Weekly Review their own full-size explanations, alongside the application, catalog, safeguards, Tokenomics, evaluations and deployment.'
    page = re.sub(r'(<header>.*?<p class="intro">).*?(</p>)', lambda match: match.group(1) + intro + match.group(2), page, count=1, flags=re.S)
    (ROOT / "index.html").write_text(page)
    presentation = (ROOT / "presentation.html").read_text()
    embedded = json.dumps(slides, ensure_ascii=False).replace("</", "<\\/")
    presentation = re.sub(r'(<script type="application/json" id="slide-data">).*?(</script>)', lambda match: match.group(1) + embedded + match.group(2), presentation, flags=re.S)
    presentation = re.sub(r'(<span id="status" aria-live="polite">).*?(</span>)', lambda match: match.group(1) + f'1 / {count}' + match.group(2), presentation)
    (ROOT / "presentation.html").write_text(presentation)
    old_readme = (ROOT / "README.md").read_text()
    tail = old_readme.split("## Reading the design accurately", 1)[1]
    tail = re.sub(r'## Supplemental references.*?## Files and reuse', '## Files and reuse', tail, flags=re.S)
    tail = tail.replace("seven-slide", f"{count}-slide").replace("seven slides", f"{count} slides")
    readme = f'''# HabitQuest architecture illustrations

{count} slides explain the implemented system, with separate full-size views for Habit Coach, Quest Planner and Weekly Review. The original detailed AI pipeline is preserved unchanged and included in the main sequence alongside the catalog-creation view. All earlier artwork remains intact.

**[Present the {count} slides](presentation.html)** · **[Open the preview gallery](index.html)** · [Slide inventory](slides.json)

The figures follow the [HQ AI Services illustration style](../../hq-ai-services/docs/planning-agent/illustrations/README.md) and the [current system design](../../habbit-quest/docs-design/README.md). They contain no implementation dates. Presentation mode supports arrow keys, a slide picker and fullscreen without a server or network connection.

'''
    for slide in slides:
        readme += f"## {slide['number']}. {slide['title']}\n\n[Full-size PNG]({slide['image']}) · [Content contract and evidence]({slide['contract']})\n\n{slide['caption']}\n\n"
    readme += "## Preserved earlier artwork\n\nThe detailed runtime diagram is now slide 4, with its original pixels and source contract unchanged. The two-part overview and all other prior illustrations also remain. [Preservation hashes](sources/pre-planner-review-image-hashes.json) verify the earlier images.\n\n"
    for item in data["supplemental"]:
        readme += f"- [{item['title']}]({item['image']}) · [source notes]({item['contract']})\n"
    readme += "\n## Reading the design accurately" + tail
    if "scripts/build_gallery.py" not in readme:
        readme += "\nTo rebuild the viewers after changing slide order or metadata, run `python3 scripts/build_gallery.py`, then `python3 scripts/verify_artifacts.py`. Neither command changes the images.\n"
    (ROOT / "README.md").write_text(readme)
    print(f"Built {count} slides; preserved original illustration files.")


if __name__ == "__main__":
    main()
