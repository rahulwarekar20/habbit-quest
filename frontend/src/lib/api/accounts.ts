/** Signing in, families and their caregivers, the family PIN, and children. */
import type { ApiChild, ApiFamily, ChildInput, Me, Role, TokenResponse } from "./types";
import { ApiError, request, withPin } from "./client";

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

export const createFamily = (input: { name: string; timezone: string; pin?: string; display_name: string; role: Role }) =>
  request<ApiFamily>("POST", "/v1/families", input);
export const joinFamily = (input: { invite_code: string; display_name: string; role: Role }) =>
  request<ApiFamily>("POST", "/v1/families/join", input);
export const getFamily = (id: string) => request<ApiFamily>("GET", `/v1/families/${id}`);
export const updateFamily = (id: string, changes: { name?: string; timezone?: string }) =>
  request<ApiFamily>("PATCH", `/v1/families/${id}`, changes);
export const updateCaregiver = (id: string, changes: { display_name?: string; role?: Role }) =>
  request<ApiFamily>("PATCH", `/v1/families/${id}/caregivers/me`, changes);
export const newInviteCode = (id: string) => request<ApiFamily>("POST", `/v1/families/${id}/invite-code`);
/** `current` is the PIN being replaced; the server requires it when the family already has one. */
export const setPin = (id: string, pin: string, current?: string) =>
  request<void>("PUT", `/v1/families/${id}/pin`, current ? { pin, current_pin: current } : { pin });
export const removePin = (id: string, pin: string) => request<void>("POST", `/v1/families/${id}/pin/remove`, withPin(pin));
export const exportFamily = (id: string) => request<unknown>("GET", `/v1/families/${id}/export`);
export const deleteFamily = (id: string, pin: string) => request<void>("POST", `/v1/families/${id}/delete`, withPin(pin));
export const leaveFamily = (id: string) => request<void>("DELETE", `/v1/families/${id}/caregivers/me`);
export const verifyPin = (id: string, pin: string) => request<{ valid: boolean }>("POST", `/v1/families/${id}/pin/verify`, { pin });

// ── Children ──────────────────────────────────────────────────────────────────

export const addChild = (familyId: string, input: ChildInput) =>
  request<ApiChild>("POST", `/v1/families/${familyId}/children`, input);
export const listChildren = (familyId: string) => request<ApiChild[]>("GET", `/v1/families/${familyId}/children`);
export const getChild = (id: string) => request<ApiChild>("GET", `/v1/children/${id}`);
export const updateChild = (id: string, changes: Partial<ChildInput>) =>
  request<ApiChild>("PATCH", `/v1/children/${id}`, changes);
