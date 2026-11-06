/** Local diagnostic history: no messages, names, IDs of children, tokens or model inputs. */
import { useSyncExternalStore } from "react";
import type { ResponseTiming } from "../components/AiParts";
const EVENT = "habitquest:generation-preferences";
let owner = "signed-out";
const key = (part: string, account = owner) => `habitquest.generation.${account}.${part}`;
export const generationOwner = () => owner;
export function setGenerationOwner(value: string) { owner = value; window.dispatchEvent(new Event(EVENT)); }
function subscribe(notify: () => void) { window.addEventListener(EVENT, notify); window.addEventListener("storage", notify); return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); }; }
export function useGenerationDetails(): [boolean, (value: boolean) => void] {
  const show = useSyncExternalStore(subscribe, () => localStorage.getItem(key("details")) === "true");
  return [show, value => { localStorage.setItem(key("details"), String(value)); window.dispatchEvent(new Event(EVENT)); }];
}
export interface GenerationRecord extends ResponseTiming { id: string; kind: string; at: string }
export function generationHistory(account = owner): GenerationRecord[] {
  try { return JSON.parse(localStorage.getItem(key("history", account)) ?? "[]"); } catch { return []; }
}
export function recordGeneration(kind: string, timing: ResponseTiming, account = owner) {
  if (account === "signed-out") return;
  try { localStorage.setItem(key("history", account), JSON.stringify([{ ...timing, id: crypto.randomUUID(), kind, at: new Date().toISOString() }, ...generationHistory(account)].slice(0, 100))); window.dispatchEvent(new Event(EVENT)); } catch { /* Diagnostics must never break generation. */ }
}
export function useGenerationHistory() {
  useSyncExternalStore(subscribe, () => localStorage.getItem(key("history")));
  return generationHistory();
}
