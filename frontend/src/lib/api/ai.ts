/** The AI helpers: the habit coach, suggestions, plan and review reports, buddy lines. */
import type { CoachReply, CoachThread, PlanReport, Report, ReviewReport, Suggestion } from "./types";
import { AI, KID, request, withPin } from "./client";

// ── AI helpers ────────────────────────────────────────────────────────────────


export const getCoachThread = (childId: string) => request<CoachThread>("GET", `/v1/children/${childId}/coach/messages`);
export const sendCoachMessage = (childId: string, text: string) =>
  request<CoachReply>("POST", `/v1/children/${childId}/coach/messages`, { text }, AI);
export const resetCoachThread = (childId: string) => request<void>("DELETE", `/v1/children/${childId}/coach/messages`);
export const listSuggestions = (familyId: string) => request<Suggestion[]>("GET", `/v1/families/${familyId}/suggestions`);
export const acceptSuggestion = (id: string, pin: string) =>
  request<CoachThread>("POST", `/v1/suggestions/${id}/accept`, withPin(pin));
export const dismissSuggestion = (id: string) => request<CoachThread>("POST", `/v1/suggestions/${id}/dismiss`);
export const requestPlan = (familyId: string) =>
  request<Report<PlanReport>>("POST", `/v1/families/${familyId}/plan-suggestions`, undefined, AI);
export const requestReview = (familyId: string) =>
  request<Report<ReviewReport>>("POST", `/v1/families/${familyId}/reviews`, undefined, AI);
export const getReports = (familyId: string) =>
  request<{ plan: Report<PlanReport> | null; review: Report<ReviewReport> | null }>("GET", `/v1/families/${familyId}/reports`);
export const getBuddyLine = (event: "greet" | "submitted" | "celebrate") =>
  request<{ line: string }>("POST", "/v1/kid/buddy-line", { event }, { ...KID, ...AI });
