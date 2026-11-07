import "../test/renderApp";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import AppEntry from "../AppEntry";
import { startFakeServer } from "../test/fakeServer";
import { getCaregiverToken, saveCaregiverToken } from "../lib/storage";
import type { TokenomicsPolicy } from "../lib/adminApi";

const initial: TokenomicsPolicy = { revision: 1, daily_credits: 100, enforce_budgets: false, show_costs: false, reference_usd_per_credit: ".0015", operator_cap_usd: "5", weights: { coach: 2, habit_batch: 1, planner: 2, review: 2, onboarding: 2, buddy: 0, child_screen: 0 } };
function setup() {
  const server = startFakeServer(); let policy = structuredClone(initial);
  server.on("POST", /\/admin\/auth\/login$/, (_m, body) => (body as { password: string }).password === "admin-secret" ? { access_token: "operator-token", token_type: "bearer", expires_in: 1800, username: "admin" } : { status: 401, body: { detail: "Incorrect username or password" } });
  server.on("GET", /\/admin\/tokenomics\/config$/, (_m, _b, token) => token === "operator-token" ? policy : { status: 401, body: { detail: "Admin authentication required" } });
  server.on("PATCH", /\/admin\/tokenomics\/config$/, (_m, body) => { policy = { ...(body as TokenomicsPolicy), revision: policy.revision + 1 }; return policy; });
  server.on("GET", /\/admin\/tokenomics\/prices$/, () => ({ items: [] }));
  server.on("POST", /\/admin\/tokenomics\/prices$/, (_m, body) => ({ id: "rate-2", ...(body as object) }));
  server.on("GET", /\/admin\/metrics$/, () => ({ summary: { operations: 2, legacy_carryover_usd: "1.1" }, activities: [], recommendations: [{ activity: "coach", configured_credits: 2, recommended_credits: 2, reference_cost_usd: ".0021877", components: { embedding: .000002, search: .000018, egress: .000002 }, status: "planning" }] }));
  server.on("GET", /\/admin\/models$/, () => ({ items: [{ role: "coach", model: "configured-model", api_mode: "responses", pricing_status: "unpriced" }] }));
  window.history.replaceState(null, "", "/admin");
  saveCaregiverToken("family-token", 3600);
  const view = render(<AppEntry />);
  const login = async () => { fireEvent.change(screen.getByLabelText("Password"), { target: { value: "admin-secret" } }); fireEvent.click(screen.getByRole("button", { name: "Sign in as admin" })); await screen.findByText("Tracking only"); };
  return { server, view, login };
}

it("mounts /admin without family requests and keeps operator login only in memory", async () => {
  const { server, view, login } = setup();
  expect(server.calls).toHaveLength(0);
  await login();
  expect(server.calls.every(call => call.path.startsWith("/v1/admin/"))).toBe(true);
  expect(localStorage.getItem("habbit-quest.token")).toContain("family-token");
  expect(JSON.stringify(Object.values(localStorage))).not.toContain("operator-token");
  view.unmount(); render(<AppEntry />);
  expect(screen.getByRole("heading", { name: "Admin sign in" })).toBeInTheDocument();
  expect(getCaregiverToken()?.token).toBe("family-token");
});

it("saves a revisioned allowance and enforcement policy, with retrieval in credit references", async () => {
  const { server, login } = setup(); await login();
  expect(screen.getByText("Embedding", { selector: "dt" })).toBeInTheDocument();
  expect(screen.getByText("Search")).toBeInTheDocument();
  expect(screen.getByText("$0.00001800")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Daily family coaching credits"), { target: { value: "150" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Enforce coaching budgets/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Show generation costs/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  await screen.findByText("Configuration saved.");
  expect(server.sent("PATCH", /\/config$/)[0].body).toMatchObject({ revision: 1, daily_credits: 150, enforce_budgets: true, show_costs: true, weights: { coach: 2, habit_batch: 1 } });
  expect(screen.getByText("Budgets enforced")).toBeInTheDocument();
});

it("handles an expired admin token without signing out the family", async () => {
  const { server, login } = setup(); await login();
  server.on("GET", /\/admin\/models$/, () => ({ status: 401, body: { detail: "Expired" } }));
  fireEvent.click(screen.getByRole("button", { name: "Models" }));
  await screen.findByRole("heading", { name: "Admin sign in" });
  expect(getCaregiverToken()?.token).toBe("family-token");
  expect(screen.getByRole("alert")).toHaveTextContent("Your admin session ended");
});

it("keeps child encouragement and screening free of family credits", async () => {
  const { server, login } = setup(); await login();
  for (const name of [/^Buddy encouragement/, /^Child text screening/]) {
    expect(screen.getByRole("spinbutton", { name })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name })).toHaveValue(0);
  }
  expect(screen.getAllByText("Always 0 family credits. Provider cost is still tracked.")).toHaveLength(2);
  expect(screen.getByRole("spinbutton", { name: "Coach / more goals" })).toBeEnabled();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Coach / more goals" }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  await screen.findByText("Configuration saved.");
  expect(server.sent("PATCH", /\/config$/)[0].body).toMatchObject({ weights: { coach: 3, buddy: 0, child_screen: 0 } });
});

it("shows the effective model and writes a separate price version", async () => {
  const { server, login } = setup(); await login();
  fireEvent.click(screen.getByRole("button", { name: "Models" }));
  await screen.findByText("configured-model");
  fireEvent.click(screen.getByRole("button", { name: "Tokenomics" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save configuration" })).toBeEnabled());
  fireEvent.click(screen.getByText("Add a price version"));
  for (const [label, value] of [["Provider", "OpenAI"], ["Model", "configured-model"], ["Source url", "https://example.com/pricing"], ["Input rate ($/million)", "0.02"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText("Usage kind"), { target: { value: "embedding" } });
  fireEvent.change(screen.getByLabelText("API mode"), { target: { value: "embeddings" } });
  fireEvent.click(screen.getByRole("button", { name: "Save price version" }));
  await waitFor(() => expect(server.sent("POST", /\/prices$/)).toHaveLength(1));
  expect(server.sent("POST", /\/prices$/)[0].body).toMatchObject({ provider: "OpenAI", model: "configured-model", input_rate: .02, kind: "embedding", api_mode: "embeddings", status: "manual" });
});

it("requires a verification time for verified tariffs and sends explicit UTC timestamps", async () => {
  const { server, login } = setup(); await login();
  fireEvent.click(screen.getByText("Add a price version"));
  expect(screen.queryByLabelText(/^Verified at/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Verification"), { target: { value: "verified" } });
  const verifiedAt = screen.getByLabelText(/^Verified at/);
  expect(verifiedAt).toBeRequired();
  for (const [label, value] of [["Model", "configured-model"], ["Source url", "https://example.com/pricing"], ["Input rate ($/million)", "0.02"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save price version" }));
  expect(server.sent("POST", /\/prices$/)).toHaveLength(0);
  fireEvent.change(verifiedAt, { target: { value: "2026-11-05T12:30:45" } });
  fireEvent.change(screen.getByLabelText(/^Effective at/), { target: { value: "2026-11-06T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save price version" }));
  await waitFor(() => expect(server.sent("POST", /\/prices$/)).toHaveLength(1));
  expect(server.sent("POST", /\/prices$/)[0].body).toMatchObject({ status: "verified", verified_at: "2026-11-05T12:30:45.000Z", effective_at: "2026-11-06T00:00:00.000Z" });
});

it("shows audit history as the latest records without unsupported pagination", async () => {
  const { server, login } = setup();
  server.on("GET", /\/admin\/audit$/, () => ({ items: Array.from({ length: 25 }, (_, i) => ({ id: `revision-${i}`, action: "policy_update" })) }));
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Change history" }));
  await screen.findByText("revision-24");
  expect(screen.getByText(/Latest 25 policy and pricing revisions/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
});

it("shows tariff and usage coverage as separate percentages", async () => {
  const { server, login } = setup();
  server.on("GET", /\/admin\/metrics$/, () => ({ activities: [{ activity: "coach", usage_coverage: .9, tariff_coverage: .75 }] }));
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Metrics" }));
  expect(await screen.findByText("90.0%")).toBeInTheDocument();
  expect(screen.getByText("75.0%")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Tariff coverage" })).toBeInTheDocument();
});

it("shows measured, partial, missing and non-token usage without replacing missing counts with zero", async () => {
  const { server, login } = setup();
  const rows = [
    { id: "measured-row", activity: "coach", input_tokens: 12345, output_tokens: 678, token_usage_status: "measured" },
    { id: "partial-row", activity: "habit_batch", input_tokens: 42, output_tokens: null, token_usage_status: "partial" },
    { id: "missing-row", activity: "review", input_tokens: null, output_tokens: null, token_usage_status: "unavailable" },
    { id: "zero-row", activity: "planner", input_tokens: 0, output_tokens: 0, token_usage_status: "measured" },
    { id: "local-row", activity: "buddy", input_tokens: null, output_tokens: null, token_usage_status: "not_applicable" },
  ];
  server.on("GET", /\/admin\/generations$/, () => ({ items: rows }));
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Generation history" }));
  await screen.findByRole("columnheader", { name: "Input tokens" });
  expect(screen.getAllByRole("columnheader").slice(0, 4).map(cell => cell.textContent)).toEqual(["Activity", "Input tokens", "Output tokens", "Token counts"]);
  const row = (id: string) => within(screen.getByText(id).closest("tr")!);
  expect(row("measured-row").getByText("12,345")).toBeInTheDocument();
  expect(row("measured-row").getByText("678")).toBeInTheDocument();
  expect(row("partial-row").getByText("42")).toBeInTheDocument();
  expect(row("partial-row").getByText("Partial")).toBeInTheDocument();
  expect(row("partial-row").getByText("Not measured")).toBeInTheDocument();
  expect(row("missing-row").getAllByText("Not measured")).toHaveLength(3);
  expect(row("zero-row").getAllByText("0")).toHaveLength(2);
  expect(row("local-row").getByText("Not applicable")).toBeInTheDocument();
  expect(screen.getByText(/retries and embedding input/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
});
