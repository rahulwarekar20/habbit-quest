/**
 * Buddy lines in kid mode: fetched from the backend once per key per day and cached. Returns null
 * until a line arrives, or when `event` is null (buddy talk is off). Errors are silent: kid mode
 * keeps its built-in messages.
 */
import { useEffect, useState } from "react";
import { getBuddyLine } from "./api";
import { dayKey } from "./time";

export type BuddyEvent = "greet" | "submitted" | "celebrate";

const BUDDY_CACHE = "habbit-quest.buddyLines";

function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(BUDDY_CACHE) ?? "{}");
  } catch {
    return {};
  }
}

function writeCache(key: string, line: string) {
  try {
    const today = dayKey();
    const kept = Object.fromEntries(Object.entries(readCache()).filter(([k]) => k.startsWith(today)));
    localStorage.setItem(BUDDY_CACHE, JSON.stringify({ ...kept, [key]: line }));
  } catch {
    /* storage blocked: lines just aren't cached */
  }
}

export function useBuddyLine(key: string, event: BuddyEvent | null): string | null {
  const cacheKey = `${dayKey()}:${key}`;
  const [line, setLine] = useState<string | null>(() => (event ? readCache()[cacheKey] ?? null : null));

  useEffect(() => {
    if (!event) return setLine(null);
    const cached = readCache()[cacheKey];
    if (cached) return setLine(cached);
    setLine(null);
    let live = true;
    getBuddyLine(event)
      .then(({ line: fresh }) => {
        writeCache(cacheKey, fresh);
        if (live) setLine(fresh);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cacheKey, event]);

  return line;
}