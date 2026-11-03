/** Kid mode: kid sessions, signing in with the family code and a kid PIN, today's quests. */
import type { ApiFamily, Approval, Buddy, Decision, ThemeWorld, Today, TokenResponse } from "./types";
import { request } from "./client";

// ── Kid mode and the daily loop ───────────────────────────────────────────────

export const startKidSession = (childId: string, pin?: string) =>
  request<TokenResponse & { child: { id: string; name: string } }>("POST", `/v1/children/${childId}/kid-session`, pin ? { pin } : undefined);

// ── Kid login: the family login code (QR) and each child's PIN ────────────────

export interface LoginFamily {
  family: { id: string; name: string };
  children: { id: string; name: string; buddy: Buddy; has_pin: boolean }[];
}
export interface KidLoginResult extends TokenResponse {
  child: { id: string; name: string; age: number; buddy: Buddy; world: ThemeWorld };
  family: { id: string; name: string };
}

export const newLoginCode = (familyId: string) => request<ApiFamily>("POST", `/v1/families/${familyId}/login-code`);
export const setKidPin = (childId: string, pin: string) => request<void>("PUT", `/v1/children/${childId}/kid-pin`, { pin });
export const removeKidPin = (childId: string) => request<void>("DELETE", `/v1/children/${childId}/kid-pin`);
export const findLoginFamily = (code: string) =>
  request<LoginFamily>("GET", `/v1/kid-login/${encodeURIComponent(code)}`, undefined, { noAuth: true });
export const kidLogin = (code: string, childId: string, pin: string) =>
  request<KidLoginResult>("POST", `/v1/kid-login/${encodeURIComponent(code)}`, { child_id: childId, pin }, { noAuth: true });
export const getKidMe = () =>
  request<{ id: string; name: string; age: number; buddy: Buddy; world: ThemeWorld }>("GET", "/v1/kid/me", undefined, { kid: true });
export const getKidToday = () => request<Today>("GET", "/v1/kid/today", undefined, { kid: true });
export const getChildToday = (childId: string) => request<Today>("GET", `/v1/children/${childId}/today`);
export const submitCompletion = (childHabitId: string) =>
  request<Today>("POST", "/v1/kid/completions", { child_habit_id: childHabitId }, { kid: true });
export const listApprovals = (familyId: string) => request<Approval[]>("GET", `/v1/families/${familyId}/approvals`);
export const approveCompletion = (id: string) => request<Decision>("POST", `/v1/completions/${id}/approve`);
export const rejectCompletion = (id: string) => request<Decision>("POST", `/v1/completions/${id}/reject`);
