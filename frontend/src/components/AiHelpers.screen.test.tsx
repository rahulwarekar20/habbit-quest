/** Explicit retry gets a fresh request only after the server confirms the old one ended. */
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";
import type { CoachingBudget } from "../lib/api/tokenomics";

function events(text: string) {
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
}

describe.each([
  ["plan-suggestions", "Suggest a plan", "plan"],
  ["reviews", "Write this week's review", "review"],
] as const)("%s retries", (path, button, kind) => {
  it("refreshes credits on completion and gates report details on the admin setting", async () => {
    const server = startFakeServer();
    let budget: CoachingBudget = { allowance: 100, used: 0, pending: 0, remaining: 100, overage: 0, reset_at: "2026-11-06T05:00:00Z", enforced: false, show_costs: false, activity_quotes: { planner: 2, review: 2 }, policy_revision: 1 };
    server.on("GET", /\/ai\/budget$/, () => budget);
    server.on("POST", new RegExp(`/${path}$`), () => {
      budget = { ...budget, used: 2, remaining: 98 };
      return { id: "report", kind, created_at: new Date().toISOString(), result: kind === "plan" ? { summary: "Report ready", tips: [] } : { headline: "Report ready", children: [], patterns: [] }, tokenomics: { operation_id: "op", parent_operation_id: null, activity: kind, status: "completed", credits: 2, pending_credits: 0, budget } };
    });
    const { user } = renderApp("/parent");
    await screen.findByLabelText("0 / 100 credits used");
    expect(screen.queryByText(/credits per useful/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: button }));
    await screen.findByText("Report ready");
    await screen.findByLabelText("2 / 100 credits used");
    expect(screen.getByRole("progressbar", { name: "Coaching credits used" })).toHaveValue(2);
    expect(screen.queryByLabelText("Generation accounting")).not.toBeInTheDocument();
    budget = { ...budget, show_costs: true };
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText("2 credits per useful review.");
    expect(screen.getByText("2 credits per useful plan.")).toBeInTheDocument();
    expect(screen.getByLabelText("Generation accounting")).toHaveTextContent("2 credits used");
    budget = { ...budget, show_costs: false };
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.queryByText(/credits per useful/)).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Generation accounting")).not.toBeInTheDocument();
  });

  it.each([
    [502, "The AI report was cut short before it finished. Please try a new request.", true],
    [503, "The AI helpers are busy right now. Please try again in a minute.", true],
    [409, "This request has no saved result. Start a new request to try again.", true],
    [409, "This generation is still running. Check its operation status.", false],
    [0, "The connection ended before the result arrived. Check the conversation or saved drafts before retrying.", false],
  ] as const)("handles status %s without automatic generation or duplicate ambiguous work", async (status, message, newRequest) => {
    startFakeServer();
    const fallback = globalThis.fetch;
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (init?.method === "POST" && url.pathname.endsWith(`/${path}`)) {
        ids.push(url.searchParams.get("request_id")!);
        if (ids.length === 1) return status === 0
          ? events('event: stage\ndata: {"stage":"planning","elapsed_ms":1}\n\n')
          : events(`event: error\ndata: ${JSON.stringify({ status, detail: message })}\n\n`);
        return events(`event: result\ndata: ${JSON.stringify({ id: "report", kind, created_at: new Date().toISOString(), result: kind === "plan" ? { summary: "Report ready", tips: [] } : { headline: "Report ready", children: [], patterns: [] } })}\n\n`);
      }
      return fallback(input, init);
    }));
    const { user } = renderApp("/parent");
    await user.click(await screen.findByRole("button", { name: button }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(ids).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByText("Report ready")).toBeInTheDocument();
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids.every(Boolean)).toBe(true);
    expect(ids[1] === ids[0]).toBe(!newRequest);
  });
});
