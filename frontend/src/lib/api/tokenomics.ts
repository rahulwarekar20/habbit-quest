/** Family-safe accounting projections. Dollar fields only arrive when the operator enables them. */
import { request } from "./client";

export interface CoachingBudget {
  allowance: number; used: number; pending: number; remaining: number; overage: number;
  reset_at: string; enforced: boolean; show_costs: boolean;
  activity_quotes: Record<string, number>; policy_revision: number;
}
export interface GenerationAccounting {
  operation_id: string; parent_operation_id: string | null; activity: string; status: string;
  credits: number; pending_credits: number; budget: CoachingBudget;
  automatic_slots?: { goal_id: string; parent_operation_id: string }[];
  timings?: Record<string, number>; estimated_cost_usd?: number | string | null; cost_status?: string;
  interaction?: { credits: number; pending_credits: number; batches_ready: number; batches_pending: number; batches_failed: number; estimated_cost_usd?: number | string | null; cost_status?: string };
}

export const getCoachingBudget = (familyId: string) =>
  request<CoachingBudget>("GET", `/v1/families/${familyId}/ai/budget`);
export const getGenerationAccounting = (familyId: string, operationId: string) =>
  request<GenerationAccounting>("GET", `/v1/families/${familyId}/ai/operations/${operationId}`);
export const observeGeneration = (familyId: string, operationId: string, values: { response_ms?: number; all_choices_ready_ms?: number; queue_ms?: number }) =>
  request<void>("POST", `/v1/families/${familyId}/ai/operations/${operationId}/observation`, values, { retryWrites: false });

/** Notify read-only meters after any operation, including one whose response was interrupted. */
export function refreshCoachingBudget(): void { window.dispatchEvent(new Event("hq:coaching-budget")); }
