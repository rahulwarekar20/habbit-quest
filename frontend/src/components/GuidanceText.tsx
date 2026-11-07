/** Render plain-text lists safely and in their original order; never insert HTML. */
export function GuidanceText({ text }: { text: string }) {
  const blocks: { kind: "p" | "ol" | "ul"; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const kind = numbered ? "ol" : bullet ? "ul" : "p";
    const content = numbered?.[1] ?? bullet?.[1] ?? line;
    const last = blocks.at(-1);
    if (kind !== "p" && last?.kind === kind) last.lines.push(content);
    else blocks.push({ kind, lines: [content] });
  }
  return <div className="guidance-text">{blocks.map((block, i) => block.kind === "p" ? <p key={i}>{block.lines[0]}</p>
    : block.kind === "ol" ? <ol className="practice-steps" key={i}>{block.lines.map((line, j) => <li key={j}>{line}</li>)}</ol>
      : <ul key={i}>{block.lines.map((line, j) => <li key={j}>{line}</li>)}</ul>)}</div>;
}
