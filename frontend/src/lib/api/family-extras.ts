/** Check-ins, surprises, kid-mode extras and family settings. */
import type { Buddy, BuddySelectionInput, Checkin, CheckinInput, ChestPrize, Extras, FamilySettings, Journey, OwnCheckin, Surprise } from "./types";
import { AI_TIMEOUT_MS, KID, request, withPin } from "./client";

// ── Check-ins and surprises ───────────────────────────────────────────────────

/** Kid mode (kid token): Send a check-in: `POST /v1/kid/checkins`. */
export const sendCheckin = (input: CheckinInput) =>
  request<{ checkin: OwnCheckin; message: string | null }>("POST", "/v1/kid/checkins", input, { ...KID, timeoutMs: AI_TIMEOUT_MS });
/** Kid mode (kid token): Today's check-in: `GET /v1/kid/checkins/today`. */
export const getTodayCheckin = () => request<OwnCheckin | null>("GET", "/v1/kid/checkins/today", undefined, KID);
/** Check-ins from the kids: `GET /v1/families/{family_id}/checkins`. */
export const listCheckins = (familyId: string) => request<Checkin[]>("GET", `/v1/families/${familyId}/checkins`);
/** Mark check-ins read: `POST /v1/families/{family_id}/checkins/read`. */
export const markCheckinsRead = (familyId: string) =>
  request<{ marked: number }>("POST", `/v1/families/${familyId}/checkins/read`);
/** Plant a surprise: `POST /v1/families/{family_id}/surprises`. */
export const plantSurprise = (familyId: string, input: Pick<Surprise, "kind" | "message" | "points" | "day"> & { child_id?: string }) =>
  request<Surprise>("POST", `/v1/families/${familyId}/surprises`, input);
/** Surprises not yet found: `GET /v1/families/{family_id}/surprises`. */
export const listSurprises = (familyId: string) => request<Surprise[]>("GET", `/v1/families/${familyId}/surprises`);
/** Kid mode (kid token): Surprises to find: `GET /v1/kid/surprises`. */
export const listKidSurprises = () => request<Surprise[]>("GET", "/v1/kid/surprises", undefined, KID);
/** Kid mode (kid token): Open a surprise: `POST /v1/kid/surprises/{surprise_id}/open`. */
export const openSurprise = (id: string) =>
  request<{ surprise: Surprise; points: number }>("POST", `/v1/kid/surprises/${id}/open`, undefined, KID);

// ── Kid extras and settings ───────────────────────────────────────────────────

/** Kid mode (kid token): Worlds, wardrobe and time: `GET /v1/kid/extras`. */
export const getKidExtras = () => request<Extras>("GET", "/v1/kid/extras", undefined, KID);
/** Kid mode (kid token): The world journey: `GET /v1/kid/journey`. */
export const getKidJourney = () => request<Journey>("GET", "/v1/kid/journey", undefined, KID);
/** Kid mode (kid token): Save a discovery or outfit: `PATCH /v1/kid/extras`. */
export const updateKidExtras = (changes: { discover?: string; wearing?: string; goal?: string; clear_goal?: boolean; level_seen?: number; buddy?: Buddy; buddy_selection?: BuddySelectionInput }) =>
  request<Extras>("PATCH", "/v1/kid/extras", changes, KID);
/** Kid mode (kid token): Open today's chest: `POST /v1/kid/chest`. */
export const openChest = () =>
  request<{ prize: ChestPrize; points: number; extras: Extras }>("POST", "/v1/kid/chest", undefined, KID);
/** Kid mode (kid token): Report time in the app: `POST /v1/kid/app-time`. */
export const reportAppTime = (seconds: number) => request<Extras>("POST", "/v1/kid/app-time", { seconds }, KID);
/** Allow more time today: `POST /v1/children/{child_id}/app-time/extend`. */
export const extendAppTime = (childId: string, minutes: number, pin: string) =>
  request<Extras>("POST", `/v1/children/${childId}/app-time/extend`, { minutes, ...withPin(pin) });
/** A child's extras: `GET /v1/children/{child_id}/extras`. */
export const getChildExtras = (childId: string) => request<Extras>("GET", `/v1/children/${childId}/extras`);
/** Family settings: `GET /v1/families/{family_id}/settings`. */
export const getFamilySettings = (familyId: string) => request<FamilySettings>("GET", `/v1/families/${familyId}/settings`);
/** Change family settings: `PATCH /v1/families/{family_id}/settings`. */
export const updateFamilySettings = (familyId: string, changes: Partial<FamilySettings>) =>
  request<FamilySettings>("PATCH", `/v1/families/${familyId}/settings`, changes);
