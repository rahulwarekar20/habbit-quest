/** Check-ins, surprises, kid-mode extras and family settings. */
import type { Buddy, Checkin, CheckinInput, ChestPrize, Extras, FamilySettings, Journey, OwnCheckin, Surprise } from "./types";
import { AI_TIMEOUT_MS, KID, request, withPin } from "./client";

// ── Check-ins and surprises ───────────────────────────────────────────────────

export const sendCheckin = (input: CheckinInput) =>
  request<{ checkin: OwnCheckin; message: string | null }>("POST", "/v1/kid/checkins", input, { ...KID, timeoutMs: AI_TIMEOUT_MS });
export const getTodayCheckin = () => request<OwnCheckin | null>("GET", "/v1/kid/checkins/today", undefined, KID);
export const listCheckins = (familyId: string) => request<Checkin[]>("GET", `/v1/families/${familyId}/checkins`);
export const markCheckinsRead = (familyId: string) =>
  request<{ marked: number }>("POST", `/v1/families/${familyId}/checkins/read`);
export const plantSurprise = (familyId: string, input: Pick<Surprise, "kind" | "message" | "points" | "day"> & { child_id?: string }) =>
  request<Surprise>("POST", `/v1/families/${familyId}/surprises`, input);
export const listSurprises = (familyId: string) => request<Surprise[]>("GET", `/v1/families/${familyId}/surprises`);
export const listKidSurprises = () => request<Surprise[]>("GET", "/v1/kid/surprises", undefined, KID);
export const openSurprise = (id: string) =>
  request<{ surprise: Surprise; points: number }>("POST", `/v1/kid/surprises/${id}/open`, undefined, KID);

// ── Kid extras and settings ───────────────────────────────────────────────────

export const getKidExtras = () => request<Extras>("GET", "/v1/kid/extras", undefined, KID);
export const getKidJourney = () => request<Journey>("GET", "/v1/kid/journey", undefined, KID);
export const updateKidExtras = (changes: { discover?: string; wearing?: string; goal?: string; clear_goal?: boolean; level_seen?: number; buddy?: Buddy }) =>
  request<Extras>("PATCH", "/v1/kid/extras", changes, KID);
export const openChest = () =>
  request<{ prize: ChestPrize; points: number; extras: Extras }>("POST", "/v1/kid/chest", undefined, KID);
export const reportAppTime = (seconds: number) => request<Extras>("POST", "/v1/kid/app-time", { seconds }, KID);
export const extendAppTime = (childId: string, minutes: number, pin: string) =>
  request<Extras>("POST", `/v1/children/${childId}/app-time/extend`, { minutes, ...withPin(pin) });
export const getChildExtras = (childId: string) => request<Extras>("GET", `/v1/children/${childId}/extras`);
export const getFamilySettings = (familyId: string) => request<FamilySettings>("GET", `/v1/families/${familyId}/settings`);
export const updateFamilySettings = (familyId: string, changes: Partial<FamilySettings>) =>
  request<FamilySettings>("PATCH", `/v1/families/${familyId}/settings`, changes);
