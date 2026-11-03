/** Kid mode: kid sessions, signing in with the family code and a kid PIN, today's quests. */
import type { ApiFamily, Approval, Buddy, Decision, ThemeWorld, Today, TokenResponse } from "./types";
import { request } from "./client";

// ── Kid mode and the daily loop ───────────────────────────────────────────────

/** Start kid mode: `POST /v1/children/{child_id}/kid-session`. */
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

/** Make a new login code: `POST /v1/families/{family_id}/login-code`. */
export const newLoginCode = (familyId: string) => request<ApiFamily>("POST", `/v1/families/${familyId}/login-code`);
/** Set a kid PIN: `PUT /v1/children/{child_id}/kid-pin`. */
export const setKidPin = (childId: string, pin: string) => request<void>("PUT", `/v1/children/${childId}/kid-pin`, { pin });
/** Remove a kid PIN: `DELETE /v1/children/{child_id}/kid-pin`. */
export const removeKidPin = (childId: string) => request<void>("DELETE", `/v1/children/${childId}/kid-pin`);
/** Who can sign in with this code: `GET /v1/kid-login/{code}`. */
export const findLoginFamily = (code: string) =>
  request<LoginFamily>("GET", `/v1/kid-login/${encodeURIComponent(code)}`, undefined, { noAuth: true });
/** Kid signs in: `POST /v1/kid-login/{code}`. */
export const kidLogin = (code: string, childId: string, pin: string) =>
  request<KidLoginResult>("POST", `/v1/kid-login/${encodeURIComponent(code)}`, { child_id: childId, pin }, { noAuth: true });
/** Kid mode (kid token): Who is playing: `GET /v1/kid/me`. */
export const getKidMe = () =>
  request<{ id: string; name: string; age: number; buddy: Buddy; world: ThemeWorld }>("GET", "/v1/kid/me", undefined, { kid: true });
/** Kid mode (kid token): Today's quests: `GET /v1/kid/today`. */
export const getKidToday = () => request<Today>("GET", "/v1/kid/today", undefined, { kid: true });
/** A child's day: `GET /v1/children/{child_id}/today`. */
export const getChildToday = (childId: string) => request<Today>("GET", `/v1/children/${childId}/today`);
/** Kid mode (kid token): I did it!: `POST /v1/kid/completions`. */
export const submitCompletion = (childHabitId: string) =>
  request<Today>("POST", "/v1/kid/completions", { child_habit_id: childHabitId }, { kid: true });
/** Waiting for approval: `GET /v1/families/{family_id}/approvals`. */
export const listApprovals = (familyId: string) => request<Approval[]>("GET", `/v1/families/${familyId}/approvals`);
/** Approve: `POST /v1/completions/{completion_id}/approve`. */
export const approveCompletion = (id: string) => request<Decision>("POST", `/v1/completions/${id}/approve`);
/** Not yet: `POST /v1/completions/{completion_id}/reject`. */
export const rejectCompletion = (id: string) => request<Decision>("POST", `/v1/completions/${id}/reject`);
