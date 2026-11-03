/** The request helper every endpoint uses: tokens, errors written for people, and waking a sleeping server.
 *
 *   Tokens   Caregiver token for everything except /v1/kid/*; kid token only for /v1/kid/*.
 *   Waking   The API sleeps on Render's free plan. A call after an idle spell gets 70 seconds and
 *            is retried if the proxy answers before the app is up; listeners hear when a call
 *            is taking long, so the UI can say "waking up the server…" instead of failing.
 *   Errors   Everything throws ApiError with a `detail` string written for people. */
import {
  clearCaregiverToken, expireKidSession, getCaregiverToken, getKidSession,
} from "../storage";

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Every failed call throws this: the HTTP `status` (0 when the server could not be reached) and a `detail`
 * message written for people, safe to show as it is.
 */
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

/**
 * How long a call may take when the server is probably asleep: Render's free plan can take a minute to wake.
 */
export const WAKE_TIMEOUT_MS = 70_000;
/** How long an ordinary call may take on a server that is already awake. */
export const NORMAL_TIMEOUT_MS = 30_000;
/** The AI helpers can take a while even on a warm server. */
export const AI_TIMEOUT_MS = 75_000;
const IDLE_AFTER_MS = 10 * 60_000; // Render sleeps after 15 idle minutes; assume cold a little before
const WAKE_NOTICE_MS = 2_500;
const WAKE_RETRY_MS = 3_000;
/** Statuses a waking server returns. 502 and 503 mean the request never reached the app, so any call may retry;
 * 504 can come after the app already acted, so only reads retry on it (a write is never sent twice). */
const RETRY_STATUS = new Set([502, 503, 504]);
const NOT_REACHED = new Set([502, 503]);

let lastOk = 0;
let slowCalls = 0;
let onWaking: (waking: boolean) => void = () => {};
let onCaregiverExpired: () => void = () => {};

/**
 * Registers who to tell when a call is slow because the server is waking up (true) and when it has answered (false).
 */
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

/**
 * Sends one API call and returns its JSON. Adds the caregiver or kid token, gives a cold server time to wake and
 * retries while it does (reads on any waking status, writes only when the app was never reached), and turns every
 * failure into an ApiError with a readable `detail`. A 401 ends the session and tells the expiry listener.
 */
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
      const retryable = method === "GET" ? RETRY_STATUS : NOT_REACHED;
      if (cold && retryable.has(response.status) && deadline - Date.now() > WAKE_RETRY_MS) {
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


/** The family PIN for a request body, left out when the family has none (an empty PIN). */
export const withPin = (pin: string) => (pin ? { pin } : {});

/** Options for a call made with the kid token (the /v1/kid/* endpoints). */
export const KID = { kid: true };

/** Options for a call that waits on the AI provider, which can take longer than other calls. */
export const AI = { timeoutMs: AI_TIMEOUT_MS };
