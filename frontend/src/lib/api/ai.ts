import type { ProgressListener } from "./generationProgress";
/** The AI helpers: the habit coach, suggestions, plan and review reports, buddy lines. */
import type { CoachContext, CoachReply, CoachThread, HabitSetting, PlanReport, Report, ReviewReport, Suggestion } from "./types";
import { AI, KID, request, withPin } from "./client";

// ── AI helpers ────────────────────────────────────────────────────────────────


/** Read the conversation: `GET /v1/children/{child_id}/coach/messages`. */
export const getCoachThread = (childId: string) => request<CoachThread>("GET", `/v1/children/${childId}/coach/messages`);
/** Batch bounded history for each authorized child; cached in memory by the application. */
export const getCoachContext = (familyId: string) => request<CoachContext>("GET", `/v1/families/${familyId}/coach-context`);
/** Message the coach: `POST /v1/children/{child_id}/coach/messages`. */
export const sendCoachMessage = (childId: string, text: string, setting?: HabitSetting, onProgress?: ProgressListener, moreGoals = false, requestId?: string) =>
  request<CoachReply>("POST", `/v1/children/${childId}/coach/messages${onProgress ? "?stream=true" : ""}`, { text, ...(setting ? { setting } : {}), ...(moreGoals ? { more_goals: true } : {}), ...(requestId ? { request_id: requestId } : {}) }, { ...AI, retryWrites: false, onProgress });
/** Dismiss only a source goal recommendation, leaving existing habit suggestions intact. */
export const dismissGoalRecommendation = (childId: string, id: string) =>
  request<CoachThread>("POST", `/v1/children/${childId}/coach/goals/${id}/dismiss`, undefined, { retryWrites: false });
/** New chat: `DELETE /v1/children/{child_id}/coach/messages`. */
export const resetCoachThread = (childId: string) => request<void>("DELETE", `/v1/children/${childId}/coach/messages`, undefined, { retryWrites: false });
/** Suggested changes: `GET /v1/families/{family_id}/suggestions`. */
export const listSuggestions = (familyId: string) => request<Suggestion[]>("GET", `/v1/families/${familyId}/suggestions`);
/** Accept a suggestion: `POST /v1/suggestions/{suggestion_id}/accept`. */
export const acceptSuggestion = (id: string, pin: string) =>
  request<CoachThread>("POST", `/v1/suggestions/${id}/accept`, withPin(pin));
/** Dismiss a suggestion: `POST /v1/suggestions/{suggestion_id}/dismiss`. */
export const dismissSuggestion = (id: string) => request<CoachThread>("POST", `/v1/suggestions/${id}/dismiss`);
/** Suggest a plan: `POST /v1/families/{family_id}/plan-suggestions` (waits on the AI). */
export const requestPlan = (familyId: string, onProgress?: ProgressListener, requestId: string = crypto.randomUUID()) =>
  request<Report<PlanReport>>("POST", `/v1/families/${familyId}/plan-suggestions?request_id=${requestId}${onProgress ? "&stream=true" : ""}`, undefined, { ...AI, retryWrites: false, onProgress });
/** Write the weekly review: `POST /v1/families/{family_id}/reviews` (waits on the AI). */
export const requestReview = (familyId: string, onProgress?: ProgressListener, requestId: string = crypto.randomUUID()) =>
  request<Report<ReviewReport>>("POST", `/v1/families/${familyId}/reviews?request_id=${requestId}${onProgress ? "&stream=true" : ""}`, undefined, { ...AI, retryWrites: false, onProgress });
/** Latest plan and review: `GET /v1/families/{family_id}/reports`. */
export const getReports = (familyId: string) =>
  request<{ plan: Report<PlanReport> | null; review: Report<ReviewReport> | null }>("GET", `/v1/families/${familyId}/reports`);
/** Kid mode (kid token): A line from the buddy: `POST /v1/kid/buddy-line`. */
export const getBuddyLine = (event: "greet" | "submitted" | "celebrate") =>
  request<{ line: string }>("POST", "/v1/kid/buddy-line", { event }, { ...KID, ...AI });
