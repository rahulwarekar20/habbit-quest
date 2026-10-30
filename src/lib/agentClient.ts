/**
 * Browser side of the agents: calls the agent server at /api/agent (server/agents.ts).
 * The API key lives on that server; nothing here talks to Anthropic directly.
 */
import { useEffect, useState } from "react";
import type { BuddyRequest, FamilyContext, HabitChange, HabitRecommendation, PlanResult, ReviewResult } from "./agents";
import { screenText, type SafetyCategory, type ScreenResult } from "./guardrails";
import { dayKey } from "./time";

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/agent/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the AI helpers. Is the app server running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The AI helper failed (${res.status}).`);
  return data as T;
}

export const askPlanner = (context: FamilyContext) => post<PlanResult>("plan", { context });

export const askReviewer = (context: FamilyContext) => post<ReviewResult>("review", { context });

export interface CoachReply {
  messages: unknown[];
  proposals: HabitChange[];
  recommendations: HabitRecommendation[];
  /** Set when the parent's message suggested a child may be at risk. */
  safety: { category: SafetyCategory; guidance: string } | null;
}

export const askAssistant = (context: FamilyContext, history: unknown[], message: string) =>
  post<CoachReply>("chat", { context, history, message });

/**
 * Screens a note a child wants to send: local checks first, then the server's AI classifier.
 * If the server can't be reached, the local result stands, so a check-in still works offline.
 */
export async function moderateKidNote(text: string): Promise<ScreenResult> {
  const local = screenText(text);
  if (!local.ok) return local;
  try {
    return await post<ScreenResult>("moderate", { text });
  } catch {
    return local;
  }
}

// ── Buddy lines (kid mode) ────────────────────────────────────────────────────

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

/**
 * An AI-written line from the child's buddy, fetched once per key per day and cached.
 * Returns null until it arrives, or when `request` is null (buddy talk off). Errors are
 * silent: kid mode keeps its built-in messages.
 */
export function useBuddyLine(key: string, request: BuddyRequest | null): string | null {
  const cacheKey = `${dayKey()}:${key}`;
  const [line, setLine] = useState<string | null>(() => (request ? readCache()[cacheKey] ?? null : null));
  const requestJson = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (!requestJson) return setLine(null);
    const cached = readCache()[cacheKey];
    if (cached) return setLine(cached);
    setLine(null);
    let live = true;
    post<{ line: string; replaced: SafetyCategory | null }>("buddy", JSON.parse(requestJson))
      .then(({ line }) => {
        writeCache(cacheKey, line);
        if (live) setLine(line);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // requestJson is read only on a cache miss for this key; the key decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, requestJson !== null]);

  return line;
}
