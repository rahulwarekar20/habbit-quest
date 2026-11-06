import "../test/renderApp";
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CoachingBudgetMeter, GenerationDebit, useCoachingBudget } from "./CoachingBudget";
import { refreshCoachingBudget, type CoachingBudget } from "../lib/api/tokenomics";
import { saveCaregiverToken } from "../lib/storage";
import { startFakeServer } from "../test/fakeServer";
const budget: CoachingBudget = { allowance: 100, used: 6, pending: 1, remaining: 93, overage: 0, reset_at: "2026-11-06T05:00:00Z", enforced: false, show_costs: false, activity_quotes: { coach: 2, habit_batch: 1 }, policy_revision: 1 };

it("shows numerical cost only when enabled and keeps sub-cent precision", () => {
  const value = { operation_id: "op", parent_operation_id: null, activity: "coach", status: "completed", credits: 2, pending_credits: 1, budget, estimated_cost_usd: ".000022", cost_status: "partial" };
  const view = render(<GenerationDebit value={value} />);
  expect(screen.getByLabelText("Generation accounting")).toHaveTextContent("2 credits used · 1 pending");
  expect(screen.queryByText(/Estimated cost/)).not.toBeInTheDocument();
  view.rerender(<GenerationDebit value={{ ...value, budget: { ...budget, show_costs: true } }} />);
  expect(screen.getByLabelText("Generation accounting")).toHaveTextContent("Estimated cost $0.00002200 (partial)");
});

it("refreshes the family balance after generation and focus, showing demo overage", async () => {
  const server = startFakeServer(); saveCaregiverToken("parent-token", 3600);
  let current = budget;
  server.on("GET", /\/families\/f1\/ai\/budget$/, () => current);
  function Meter() { const { budget: value, error } = useCoachingBudget("f1", "c1"); return <CoachingBudgetMeter budget={value} error={error} />; }
  render(<Meter />);
  await screen.findByLabelText("6 / 100 credits used");
  expect(screen.getByText("1 pending")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveValue(6);
  expect(screen.getByLabelText("Demo mode · limits are not enforced")).toBeInTheDocument();
  current = { ...budget, used: 101, pending: 0, remaining: 0, overage: 1 };
  act(() => refreshCoachingBudget());
  await screen.findByLabelText("101 / 100 credits used");
  expect(screen.getByLabelText("1 credit over the allowance")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveValue(100);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "101 of 100 credits used; 1 over allowance");
  current = { ...budget, used: 102, pending: 0, remaining: 0, overage: 2 };
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByLabelText("102 / 100 credits used");
  current = { ...budget, used: 0, pending: 0, remaining: 100, enforced: true };
  act(() => refreshCoachingBudget());
  await screen.findByLabelText("Limits enforced");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "0 of 100 credits used; 100 left");
  expect(screen.getByRole("progressbar")).toHaveValue(0);
});
