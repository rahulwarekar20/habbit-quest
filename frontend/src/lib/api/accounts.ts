/** Signing in, families and their caregivers, the family PIN, and children. */
import type { ApiChild, ApiFamily, ChildInput, Me, Role, TokenResponse } from "./types";
import { ApiError, request, withPin } from "./client";

// ── Sign-in ───────────────────────────────────────────────────────────────────

/** Sign in with Google: `POST /v1/auth/google`. */
export const signInWithGoogle = (credential: string) =>
  request<TokenResponse>("POST", "/v1/auth/google", { credential }, { noAuth: true });

/** Development login (`POST /v1/auth/token`, a username and the shared password). Only exists while the server has
 * DEV_LOGIN on; otherwise the 404 is turned into a message pointing to Google sign-in. */
export const signInDev = (username: string, password: string) =>
  request<TokenResponse>("POST", "/v1/auth/token", undefined, { noAuth: true, form: { username, password } }).catch((e) => {
    // The route only exists while the server has DEV_LOGIN=true.
    throw e instanceof ApiError && e.status === 404
      ? new ApiError(404, "The development login is turned off on this server. Please use Google sign-in.")
      : e;
  });

/** Who am I: `GET /v1/me`. */
export const getMe = () => request<Me>("GET", "/v1/me");

// ── Families ──────────────────────────────────────────────────────────────────

/** Create a family: `POST /v1/families`. */
export const createFamily = (input: { name: string; timezone: string; pin?: string; display_name: string; role: Role }) =>
  request<ApiFamily>("POST", "/v1/families", input);
/** Join a family: `POST /v1/families/join`. */
export const joinFamily = (input: { invite_code: string; display_name: string; role: Role }) =>
  request<ApiFamily>("POST", "/v1/families/join", input);
/** Read a family: `GET /v1/families/{family_id}`. */
export const getFamily = (id: string) => request<ApiFamily>("GET", `/v1/families/${id}`);
/** Edit a family: `PATCH /v1/families/{family_id}`. */
export const updateFamily = (id: string, changes: { name?: string; timezone?: string }) =>
  request<ApiFamily>("PATCH", `/v1/families/${id}`, changes);
/** Edit my caregiver details: `PATCH /v1/families/{family_id}/caregivers/me`. */
export const updateCaregiver = (id: string, changes: { display_name?: string; role?: Role }) =>
  request<ApiFamily>("PATCH", `/v1/families/${id}/caregivers/me`, changes);
/** Replace the invite code: `POST /v1/families/{family_id}/invite-code`. */
export const newInviteCode = (id: string) => request<ApiFamily>("POST", `/v1/families/${id}/invite-code`);
/** `current` is the PIN being replaced; the server requires it when the family already has one. */
export const setPin = (id: string, pin: string, current?: string) =>
  request<void>("PUT", `/v1/families/${id}/pin`, current ? { pin, current_pin: current } : { pin });
/** Turn off the PIN: `POST /v1/families/{family_id}/pin/remove`. */
export const removePin = (id: string, pin: string) => request<void>("POST", `/v1/families/${id}/pin/remove`, withPin(pin));
/** Export family data: `GET /v1/families/{family_id}/export`. */
export const exportFamily = (id: string) => request<unknown>("GET", `/v1/families/${id}/export`);
/** Delete a family: `POST /v1/families/{family_id}/delete`. */
export const deleteFamily = (id: string, pin: string) => request<void>("POST", `/v1/families/${id}/delete`, withPin(pin));
/** Leave a family: `DELETE /v1/families/{family_id}/caregivers/me`. */
export const leaveFamily = (id: string) => request<void>("DELETE", `/v1/families/${id}/caregivers/me`);
/** Check the PIN: `POST /v1/families/{family_id}/pin/verify`. */
export const verifyPin = (id: string, pin: string) => request<{ valid: boolean }>("POST", `/v1/families/${id}/pin/verify`, { pin });

// ── Children ──────────────────────────────────────────────────────────────────

/** Add a child: `POST /v1/families/{family_id}/children`. */
export const addChild = (familyId: string, input: ChildInput) =>
  request<ApiChild>("POST", `/v1/families/${familyId}/children`, input);
/** List children: `GET /v1/families/{family_id}/children`. */
export const listChildren = (familyId: string) => request<ApiChild[]>("GET", `/v1/families/${familyId}/children`);
/** Read a child: `GET /v1/children/{child_id}`. */
export const getChild = (id: string) => request<ApiChild>("GET", `/v1/children/${id}`);
/** Edit a child: `PATCH /v1/children/{child_id}`. */
export const updateChild = (id: string, changes: Partial<ChildInput>) =>
  request<ApiChild>("PATCH", `/v1/children/${id}`, changes);
