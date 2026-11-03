/** Points, the reward shop and reward requests. */
import type { FamilyRewardRequest, PointsEntry, PointsHistory, Reward, RewardRequest } from "./types";
import { KID, request, withPin } from "./client";

// ── Points ────────────────────────────────────────────────────────────────────

export const redeemPoints = (childId: string, points: number, note: string) =>
  request<{ entry: Pick<PointsEntry, "id" | "amount" | "reason" | "note" | "created_at">; points: number }>(
    "POST", `/v1/children/${childId}/redemptions`, { points, note });
export const getPoints = (childId: string, limit = 50) =>
  request<PointsHistory>("GET", `/v1/children/${childId}/points?limit=${limit}`);
export const getKidPoints = (limit = 50) =>
  request<PointsHistory>("GET", `/v1/kid/points?limit=${limit}`, undefined, { kid: true });

// ── Rewards ───────────────────────────────────────────────────────────────────


export const listRewards = (familyId: string) => request<Reward[]>("GET", `/v1/families/${familyId}/rewards`);
export const addReward = (familyId: string, reward: Omit<Reward, "id">) =>
  request<Reward>("POST", `/v1/families/${familyId}/rewards`, reward);
export const updateReward = (id: string, changes: { title?: string; emoji?: string; cost?: number }) =>
  request<Reward>("PATCH", `/v1/rewards/${id}`, changes);
export const removeReward = (id: string) => request<void>("DELETE", `/v1/rewards/${id}`);
export const listKidRewards = () => request<Reward[]>("GET", "/v1/kid/rewards", undefined, KID);
export const askForReward = (rewardId: string) =>
  request<{ request: RewardRequest; points: number }>("POST", "/v1/kid/reward-requests", { reward_id: rewardId }, KID);
export const listKidRequests = (limit = 6) =>
  request<RewardRequest[]>("GET", `/v1/kid/reward-requests?limit=${limit}`, undefined, KID);
export const listRewardRequests = (familyId: string) =>
  request<FamilyRewardRequest[]>("GET", `/v1/families/${familyId}/reward-requests`);
export const approveRewardRequest = (id: string, pin: string) =>
  request<{ points: number }>("POST", `/v1/reward-requests/${id}/approve`, withPin(pin));
export const declineRewardRequest = (id: string) => request<{ points: number }>("POST", `/v1/reward-requests/${id}/decline`);
