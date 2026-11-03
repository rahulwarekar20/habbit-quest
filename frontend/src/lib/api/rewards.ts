/** Points, the reward shop and reward requests. */
import type { FamilyRewardRequest, PointsEntry, PointsHistory, Reward, RewardRequest } from "./types";
import { KID, request, withPin } from "./client";

// ── Points ────────────────────────────────────────────────────────────────────

/** Spend points: `POST /v1/children/{child_id}/redemptions`. Returns the ledger entry and the new balance. */
export const redeemPoints = (childId: string, points: number, note: string) =>
  request<{ entry: Pick<PointsEntry, "id" | "amount" | "reason" | "note" | "created_at">; points: number }>(
    "POST", `/v1/children/${childId}/redemptions`, { points, note });
/** Points history: `GET /v1/children/{child_id}/points`. */
export const getPoints = (childId: string, limit = 50) =>
  request<PointsHistory>("GET", `/v1/children/${childId}/points?limit=${limit}`);
/** Kid mode (kid token): My points: `GET /v1/kid/points`. */
export const getKidPoints = (limit = 50) =>
  request<PointsHistory>("GET", `/v1/kid/points?limit=${limit}`, undefined, { kid: true });

// ── Rewards ───────────────────────────────────────────────────────────────────


/** The reward shop: `GET /v1/families/{family_id}/rewards`. */
export const listRewards = (familyId: string) => request<Reward[]>("GET", `/v1/families/${familyId}/rewards`);
/** Add a reward: `POST /v1/families/{family_id}/rewards`. */
export const addReward = (familyId: string, reward: Omit<Reward, "id">) =>
  request<Reward>("POST", `/v1/families/${familyId}/rewards`, reward);
/** Edit a reward: `PATCH /v1/rewards/{reward_id}`. */
export const updateReward = (id: string, changes: { title?: string; emoji?: string; cost?: number }) =>
  request<Reward>("PATCH", `/v1/rewards/${id}`, changes);
/** Remove a reward: `DELETE /v1/rewards/{reward_id}`. */
export const removeReward = (id: string) => request<void>("DELETE", `/v1/rewards/${id}`);
/** Kid mode (kid token): The shop: `GET /v1/kid/rewards`. */
export const listKidRewards = () => request<Reward[]>("GET", "/v1/kid/rewards", undefined, KID);
/** Kid mode (kid token): Ask for a reward: `POST /v1/kid/reward-requests`. */
export const askForReward = (rewardId: string) =>
  request<{ request: RewardRequest; points: number }>("POST", "/v1/kid/reward-requests", { reward_id: rewardId }, KID);
/** Kid mode (kid token): My reward requests: `GET /v1/kid/reward-requests`. */
export const listKidRequests = (limit = 6) =>
  request<RewardRequest[]>("GET", `/v1/kid/reward-requests?limit=${limit}`, undefined, KID);
/** Reward requests: `GET /v1/families/{family_id}/reward-requests`. */
export const listRewardRequests = (familyId: string) =>
  request<FamilyRewardRequest[]>("GET", `/v1/families/${familyId}/reward-requests`);
/** Approve a reward: `POST /v1/reward-requests/{request_id}/approve`. */
export const approveRewardRequest = (id: string, pin: string) =>
  request<{ points: number }>("POST", `/v1/reward-requests/${id}/approve`, withPin(pin));
/** Not this time: `POST /v1/reward-requests/{request_id}/decline`. */
export const declineRewardRequest = (id: string) => request<{ points: number }>("POST", `/v1/reward-requests/${id}/decline`);
