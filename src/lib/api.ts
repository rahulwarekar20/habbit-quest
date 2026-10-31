/**
 * Typed client for the HabitQuest backend: one `request` helper, one function per endpoint, and
 * the response types next to them.
 *
 *   Tokens   Caregiver token for everything except /v1/kid/*; kid token only for /v1/kid/*.
 *   Waking   The API sleeps on Render's free plan. A call after an idle spell gets 70 seconds and
 *            is retried if the proxy answers before the app is up; listeners hear when a call
 *            is taking long, so the UI can say "waking up the server…" instead of failing.
 *   Errors   Everything throws ApiError with a `detail` string written for people.
 */
import {
  clearCaregiverToken, expireKidSession, getCaregiverToken, getKidSession,
} from "./storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = "father" | "mother" | "guardian" | "other";
export type Buddy = "fox" | "owl" | "bear" | "bunny";
export type ThemeWorld = "space" | "forest" | "city";
export type DayName = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const ROUTINE_PARTS = ["morning", "midday", "after_school", "evening", "bedtime"] as const;
export type RoutinePart = (typeof ROUTINE_PARTS)[number];
export type RoutineTimes = Partial<Record<RoutinePart, string>>;

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface FamilyLink { id: string; name: string; display_name: string; role: Role }
export interface Me { id: string; name: string | null; email: string | null; families: FamilyLink[] }

export interface Caregiver { user_id: string; display_name: string; role: Role }
export interface ApiFamily {
  id: string;
  name: string;
  timezone: string;
  invite_code: string;
  has_pin: boolean;
  created_at: string;
  caregivers: Caregiver[];
}

export interface ApiChild {
  id: string;
  family_id: string;
  name: string;
  age: number;
  buddy: Buddy;
  world: ThemeWorld;
  routine_times: RoutineTimes;
  created_at: string;
}
export type ChildInput = Pick<ApiChild, "name" | "age" | "buddy" | "world" | "routine_times">;

export interface Progress {
  sparks: number;
  level: number;
  level_name: string;
  unlocked_tier: number;
  next_level_at: number | null;
}

export interface HabitText {
  goal_id: string;
  title: string;
  description: string;
  kid_title: string;
  kid_hint: string;
  icon: string;
  anchor: RoutinePart;
  tier: number;
  points: number;
}
export interface Option extends HabitText { id: string; recommended?: boolean }

export interface PlanGoal {
  goal_id: string;
  title: string;
  status: "suggested" | "active";
  reason: string | null;
  recommended_habit_ids: string[];
  options: Option[];
}
export interface PlanHabit extends HabitText {
  id: string; // the child-habit id
  habit_id: string;
  cue_time: string;
  days: DayName[];
  status: "active" | "paused";
  started_on: string;
}
export interface Plan { child_id: string; progress: Progress; goals: PlanGoal[]; habits: PlanHabit[] }
export interface PlanInput {
  goals: string[];
  habits: { habit_id: string; cue_time?: string; days?: DayName[] }[];
}

export interface PainPoint { id: string; text: string; mapped_by: "ai" | "keywords" | "manual"; created_at: string }
export interface PainPointResult {
  pain_point: PainPoint | null;
  safety: { guidance: string } | null;
  plan: Plan | null;
}

export interface Goal { id: string; title: string; description: string }

export type HabitStatus = "todo" | "submitted" | "approved" | "rejected";
export interface TodayHabit {
  child_habit_id: string;
  habit_id: string;
  kid_title: string;
  kid_hint: string;
  icon: string;
  anchor: RoutinePart;
  tier: number;
  points: number;
  cue_time: string;
  status: HabitStatus;
  completion_id: string | null;
}
export interface Today {
  child: { id: string; name: string; buddy: Buddy; world: ThemeWorld };
  day: string;
  progress: Progress;
  points: number;
  habits: TodayHabit[];
}

export interface Approval {
  completion_id: string;
  child_id: string;
  child_name: string;
  habit_id: string;
  title: string;
  kid_title: string;
  icon: string;
  points: number;
  day: string;
  submitted_at: string;
}
export interface Decision {
  completion: { id: string; status: "approved" | "rejected"; day: string; submitted_at: string; decided_at: string };
  child_id: string;
  progress: Progress;
  points: number;
}

export interface PointsEntry {
  id: number | string;
  amount: number;
  reason: "earned" | "redeemed" | "adjusted";
  note: string | null;
  created_at: string;
  habit_id: string | null;
  kid_title: string | null;
  icon: string | null;
  completion_day: string | null;
  by?: string | null;
}
export interface PointsHistory { points: number; earned: number; spent: number; entries: PointsEntry[] }

// ── Errors ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(detail);
    this.name = "ApiError";
  }
}

/** A message to show a person for anything thrown by a request. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/** Turns `{detail}` from the API (a string, or a validation list) into one readable line. */
export function detailText(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error, /, "")).filter(Boolean).join(" ") || "Please check what you entered.";
  }
  return status >= 500 ? "The server had a problem. Please try again." : `Request failed (${status}).`;
}

// ── Waking up, and who to tell ────────────────────────────────────────────────

export const WAKE_TIMEOUT_MS = 70_000;
export const NORMAL_TIMEOUT_MS = 30_000;
/** The AI mapping can take a while even on a warm server. */
export const AI_TIMEOUT_MS = 60_000;
const IDLE_AFTER_MS = 10 * 60_000; // Render sleeps after 15 idle minutes; assume cold a little before
const WAKE_NOTICE_MS = 2_500;
const WAKE_RETRY_MS = 3_000;
const RETRY_STATUS = new Set([502, 503, 504]);

let lastOk = 0;
let slowCalls = 0;
let onWaking: (waking: boolean) => void = () => {};
let onCaregiverExpired: () => void = () => {};

export function setWakingListener(fn: (waking: boolean) => void): void {
  onWaking = fn;
}

/** Called when the caregiver token is missing, expired or refused. */
export function setExpiredListener(fn: () => void): void {
  onCaregiverExpired = fn;
}

/** Test hook: forget that the server has answered recently. */
export function resetWakeState(): void {
  lastOk = 0;
  slowCalls = 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── The request helper ────────────────────────────────────────────────────────

export interface RequestOptions {
  kid?: boolean; // use the kid token
  form?: Record<string, string>; // send as application/x-www-form-urlencoded (dev login)
  noAuth?: boolean; // sign-in calls
  timeoutMs?: number;
}

function expired(kid: boolean): ApiError {
  if (kid) {
    expireKidSession();
    return new ApiError(401, "Kid mode has timed out.");
  }
  clearCaregiverToken();
  onCaregiverExpired();
  return new ApiError(401, "Please sign in again.");
}

export async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const { kid = false, form, noAuth = false } = options;
  const headers: Record<string, string> = {};
  if (!noAuth) {
    const token = kid ? getKidSession()?.token : getCaregiverToken()?.token;
    if (!token) throw expired(kid);
    headers.Authorization = `Bearer ${token}`;
  }
  let payload: string | undefined;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const cold = Date.now() - lastOk > IDLE_AFTER_MS;
  const timeoutMs = cold ? Math.max(WAKE_TIMEOUT_MS, options.timeoutMs ?? 0) : options.timeoutMs ?? NORMAL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  // Only a cold call can be "waking up"; a warm call that is slow is just slow.
  let noticed = false;
  const notice = cold ? setTimeout(() => {
    noticed = true;
    if (++slowCalls === 1) onWaking(true);
  }, WAKE_NOTICE_MS) : undefined;

  try {
    for (;;) {
      const left = deadline - Date.now();
      let response: Response;
      try {
        response = await fetch(`${baseUrl()}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(left) });
      } catch (e) {
        const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
        if (!timedOut && cold && deadline - Date.now() > WAKE_RETRY_MS) {
          await sleep(WAKE_RETRY_MS);
          continue;
        }
        throw new ApiError(0, timedOut
          ? "The server is taking too long to answer. Please try again."
          : "We couldn't reach the server. Check your connection and try again.");
      }
      if (cold && RETRY_STATUS.has(response.status) && deadline - Date.now() > WAKE_RETRY_MS) {
        await sleep(WAKE_RETRY_MS);
        continue;
      }
      lastOk = Date.now();
      if (response.status === 204) return undefined as T;
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) return data as T;
      if (response.status === 401 && !noAuth) throw expired(kid);
      throw new ApiError(response.status, detailText(data, response.status));
    }
  } finally {
    clearTimeout(notice);
    if (noticed && --slowCalls === 0) onWaking(false);
  }
}

function baseUrl(): string {
  return String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
}

// ── Sign-in ───────────────────────────────────────────────────────────────────

export const signInWithGoogle = (credential: string) =>
  request<TokenResponse>("POST", "/v1/auth/google", { credential }, { noAuth: true });

export const signInDev = (username: string, password: string) =>
  request<TokenResponse>("POST", "/v1/auth/token", undefined, { noAuth: true, form: { username, password } }).catch((e) => {
    // The route only exists while the server has DEV_LOGIN=true.
    throw e instanceof ApiError && e.status === 404
      ? new ApiError(404, "The development login is turned off on this server. Please use Google sign-in.")
      : e;
  });

export const getMe = () => request<Me>("GET", "/v1/me");

// ── Families ──────────────────────────────────────────────────────────────────

export const createFamily = (input: { name: string; timezone: string; pin: string; display_name: string; role: Role }) =>
  request<ApiFamily>("POST", "/v1/families", input);
export const joinFamily = (input: { invite_code: string; display_name: string; role: Role }) =>
  request<ApiFamily>("POST", "/v1/families/join", input);
export const getFamily = (id: string) => request<ApiFamily>("GET", `/v1/families/${id}`);
export const updateFamily = (id: string, changes: { name?: string; timezone?: string }) =>
  request<ApiFamily>("PATCH", `/v1/families/${id}`, changes);
export const updateCaregiver = (id: string, changes: { display_name?: string; role?: Role }) =>
  request<ApiFamily>("PATCH", `/v1/families/${id}/caregivers/me`, changes);
export const newInviteCode = (id: string) => request<ApiFamily>("POST", `/v1/families/${id}/invite-code`);
export const setPin = (id: string, pin: string) => request<void>("PUT", `/v1/families/${id}/pin`, { pin });
export const verifyPin = (id: string, pin: string) => request<{ valid: boolean }>("POST", `/v1/families/${id}/pin/verify`, { pin });

// ── Children ──────────────────────────────────────────────────────────────────

export const addChild = (familyId: string, input: ChildInput) =>
  request<ApiChild>("POST", `/v1/families/${familyId}/children`, input);
export const listChildren = (familyId: string) => request<ApiChild[]>("GET", `/v1/families/${familyId}/children`);
export const getChild = (id: string) => request<ApiChild>("GET", `/v1/children/${id}`);
export const updateChild = (id: string, changes: Partial<ChildInput>) =>
  request<ApiChild>("PATCH", `/v1/children/${id}`, changes);

// ── Onboarding: pain points, goals, habits ────────────────────────────────────

export const addPainPoint = (childId: string, text: string) =>
  request<PainPointResult>("POST", `/v1/children/${childId}/pain-points`, { text }, { timeoutMs: AI_TIMEOUT_MS });
export const getPlan = (childId: string) => request<Plan>("GET", `/v1/children/${childId}/plan`);
export const putPlan = (childId: string, input: PlanInput) => request<Plan>("PUT", `/v1/children/${childId}/plan`, input);
export const updateChildHabit = (id: string, changes: { cue_time?: string; days?: DayName[]; status?: "active" | "paused" | "removed" }) =>
  request<Plan>("PATCH", `/v1/child-habits/${id}`, changes);
export const listGoals = () => request<Goal[]>("GET", "/v1/goals");
export const listGoalHabits = (goalId: string, age?: number, maxTier?: number) => {
  const query = new URLSearchParams();
  if (age !== undefined) query.set("age", String(age));
  if (maxTier !== undefined) query.set("max_tier", String(maxTier));
  const text = query.toString();
  return request<Option[]>("GET", `/v1/goals/${goalId}/habits${text ? `?${text}` : ""}`);
};

// ── Kid mode and the daily loop ───────────────────────────────────────────────

export const startKidSession = (childId: string) =>
  request<TokenResponse & { child: { id: string; name: string } }>("POST", `/v1/children/${childId}/kid-session`);
export const getKidMe = () =>
  request<{ id: string; name: string; age: number; buddy: Buddy; world: ThemeWorld }>("GET", "/v1/kid/me", undefined, { kid: true });
export const getKidToday = () => request<Today>("GET", "/v1/kid/today", undefined, { kid: true });
export const getChildToday = (childId: string) => request<Today>("GET", `/v1/children/${childId}/today`);
export const submitCompletion = (childHabitId: string) =>
  request<Today>("POST", "/v1/kid/completions", { child_habit_id: childHabitId }, { kid: true });
export const listApprovals = (familyId: string) => request<Approval[]>("GET", `/v1/families/${familyId}/approvals`);
export const approveCompletion = (id: string) => request<Decision>("POST", `/v1/completions/${id}/approve`);
export const rejectCompletion = (id: string) => request<Decision>("POST", `/v1/completions/${id}/reject`);

// ── Points ────────────────────────────────────────────────────────────────────

export const redeemPoints = (childId: string, points: number, note: string) =>
  request<{ entry: Pick<PointsEntry, "id" | "amount" | "reason" | "note" | "created_at">; points: number }>(
    "POST", `/v1/children/${childId}/redemptions`, { points, note });
export const getPoints = (childId: string, limit = 50) =>
  request<PointsHistory>("GET", `/v1/children/${childId}/points?limit=${limit}`);
export const getKidPoints = (limit = 50) =>
  request<PointsHistory>("GET", `/v1/kid/points?limit=${limit}`, undefined, { kid: true });
