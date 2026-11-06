/** Operator UI with synthetic accounting responses; all API traffic is intercepted. */
import { expect, test } from "@playwright/test";

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL, trace: "off" });
for (const width of [1280, 390]) test(`Tokenomics operator and family isolation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const unexpected: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let policy = { revision: 1, daily_credits: 100, enforce_budgets: false, show_costs: false, reference_usd_per_credit: ".0015", operator_cap_usd: "5", weights: { coach: 2, habit_batch: 1, planner: 2, review: 2, onboarding: 2, buddy: 0, child_screen: 0 } };
  await page.addInitScript(() => localStorage.setItem("habbit-quest.token", JSON.stringify({ token: "synthetic-family", expiresAt: 4102444800000 })));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith("/v1/")) {
      if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5180") await route.continue();
      else await route.abort();
      return;
    }
    let body: unknown;
    if (path === "/v1/admin/auth/login") body = { access_token: "synthetic-operator", token_type: "bearer", expires_in: 1800, username: "admin" };
    else if (path === "/v1/admin/tokenomics/config") {
      if (route.request().method() === "PATCH") policy = { ...route.request().postDataJSON(), revision: policy.revision + 1 };
      body = policy;
    } else if (path === "/v1/admin/tokenomics/prices") body = { items: [{ provider: "openai", model: "gpt-6-luna", kind: "chat", input_rate: ".1", cached_input_rate: ".01", output_rate: ".5", status: "verified" }, { provider: "openai", model: "text-embedding-3-small", kind: "embedding", input_rate: ".02", status: "verified" }, { provider: "pinecone", model: "documents-search", kind: "search", read_unit_rate: "18", egress_rate: ".10", status: "planning" }] };
    else if (path === "/v1/admin/models") body = { items: [{ role: "coach", model: "gpt-6-luna", provider: "openai", api_mode: "responses", pricing_status: "verified" }, { role: "embedding", model: "text-embedding-3-small", provider: "openai", api_mode: "embeddings", pricing_status: "verified" }, { role: "similarity_search", model: "documents-search", provider: "pinecone", api_mode: "documents", pricing_status: "planning" }] };
    else if (path === "/v1/admin/metrics") body = { summary: { operations: 2, useful: 2, failed: 0, known_cost_usd: ".0016", unknown_operations: 0, legacy_carryover_usd: "1.10", outstanding_exposure_usd: "0" }, activities: [{ activity: "habit_batch", model: "gpt-6-luna", samples: 2, mean_cost_usd: ".00078745", mean_latency_ms: 10528, mean_generation_ms: 10373, p50_latency_ms: 10528, p95_latency_ms: null, usage_coverage: 1 }], recommendations: [{ activity: "coach", configured_credits: 2, recommended_credits: 2, reference_cost_usd: ".0021877", components: { chats: .0021657, embedding: .000002, search: .000018, egress: .000002 }, status: "planning reference" }, { activity: "habit_batch", configured_credits: 1, recommended_credits: 1, reference_cost_usd: ".00078745", components: { writer: .00078745 }, status: "historical reference" }], coverage_note: "Synthetic preview data; not an additional live benchmark." };
    else if (path === "/v1/admin/generations") body = { items: [
      { id: "measured-example", activity: "coach", status: "completed", input_tokens: 12345, output_tokens: 678, token_usage_status: "measured", estimated_cost_usd: ".0021877", attempt_count: 4 },
      { id: "partial-example", activity: "habit_batch", status: "failed", input_tokens: 42, output_tokens: null, token_usage_status: "partial", estimated_cost_usd: null, attempt_count: 2 },
      { id: "unknown-example", activity: "review", status: "failed", input_tokens: null, output_tokens: null, token_usage_status: "unavailable", estimated_cost_usd: null, attempt_count: 1 },
      { id: "zero-example", activity: "planner", status: "completed", input_tokens: 0, output_tokens: 0, token_usage_status: "measured", estimated_cost_usd: 0, attempt_count: 1 },
    ] };
    else if (path === "/v1/admin/audit") body = { items: [] };
    else { unexpected.push(`${route.request().method()} ${path}`); await route.fulfill({ status: 404, json: { detail: "Unexpected preview endpoint" } }); return; }
    await route.fulfill({ json: body });
  });
  await page.goto("http://localhost:5180/admin");
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  await page.getByLabel("Password").fill("synthetic-only-password");
  await page.getByRole("button", { name: "Sign in as admin" }).click();
  await expect(page.getByText("Tracking only", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/tokenomics/admin-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Daily family coaching credits").fill("150");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByText("Configuration saved.")).toBeVisible();
  expect(policy.daily_credits).toBe(150);
  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  await expect(page.getByText("10.53s").first()).toBeVisible();
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/tokenomics/metrics-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Generation history", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Input tokens" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Output tokens" })).toBeVisible();
  await expect(page.getByText("12,345", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "partial-example" })).toContainText("Partial");
  const missing = page.getByRole("row").filter({ hasText: "unknown-example" });
  for (const column of [2, 3, 4]) await expect(missing.getByRole("cell").nth(column)).toHaveText("Not measured");
  await expect(page.getByRole("row").filter({ hasText: "zero-example" }).getByRole("cell", { name: "0", exact: true })).toHaveCount(2);
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/admin-entry-tokens/history-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("habbit-quest.token"))).toContain("synthetic-family");
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});

for (const width of [1280, 390]) test(`Admin login entry below developer login at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/v1/")) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 404, json: { detail: "Unexpected synthetic request" } });
    } else if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5180") await route.continue();
    else await route.abort();
  });
  await page.goto("http://localhost:5180/#/login");
  const link = page.getByRole("link", { name: "Admin login", exact: true });
  const developer = page.getByRole("button", { name: "Developer login", exact: true });
  await expect(link).toHaveAttribute("href", "/admin");
  const entry = await page.locator(".auth__utilities").evaluate(element => {
    const admin = element.querySelector(".auth__admin-link")!.getBoundingClientRect();
    const dev = element.querySelector(".dev-login__toggle")!.getBoundingClientRect();
    return { below: admin.top >= dev.bottom };
  });
  expect(entry.below).toBe(true);
  await developer.click();
  await expect(page.getByLabel("Shared password")).toBeVisible();
  const panel = (await page.locator(".dev-login__panel").boundingBox())!, admin = (await link.boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(admin.y + admin.height);
  await developer.click();
  await page.locator(".auth__bar").screenshot({ path: `../docs-detailed/evidence/2026-11-05/admin-entry-tokens/login-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await link.click();
  await expect(page).toHaveURL("http://localhost:5180/admin");
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

for (const width of [1280, 390]) test(`Coach budget and cost visibility at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const unknown: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const at = "2026-11-05T12:00:00Z";
  let costs = true, used = 0, enforced = false;
  const budget = () => ({ allowance: 100, used, pending: 0, remaining: Math.max(0, 100 - used), overage: Math.max(0, used - 100), reset_at: "2026-11-06T05:00:00Z", enforced, show_costs: costs, activity_quotes: { coach: 2, habit_batch: 1, planner: 2, review: 2 }, policy_revision: 1 });
  const progress = { sparks: 0, pending_sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null };
  const children = [{ id: "c1", family_id: "f1", name: "Alex", age: 8, buddy: "fox", world: "camp", tier_override: 0, routine_times: {}, created_at: at }, { id: "c2", family_id: "f1", name: "Jamie", age: 5, buddy: "bunny", world: "camp", tier_override: 0, routine_times: {}, created_at: at }];
  const accounting = () => ({ operation_id: "synthetic-op", parent_operation_id: null, activity: "coach", status: "completed", credits: 2, pending_credits: 0, budget: budget(), automatic_slots: [], ...(costs ? { estimated_cost_usd: ".0021877", cost_status: "partial" } : {}) });
  const messages = [{ id: 1, role: "parent", content: "Help with bedtime", sources: [], no_habit_match: false, created_at: at }, { id: 2, role: "coach", content: "1. Choose one calm activity together.\n2. Keep the next step small.\n3. Notice the effort.", sources: [], no_habit_match: false, created_at: at }];
  await page.addInitScript(() => {
    const expiresAt = 4102444800000;
    localStorage.setItem("habbit-quest.token", JSON.stringify({ token: "synthetic-family", expiresAt }));
    localStorage.setItem("habbit-quest.coachFresh", JSON.stringify({ signIn: expiresAt, children: ["c1"] }));
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (!path.startsWith("/v1/")) { if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5180") await route.continue(); else await route.abort(); return; }
    let body: unknown;
    if (path === "/v1/me") body = { id: "u1", name: "Sam", email: null, families: [{ id: "f1", name: "Example", display_name: "Sam", role: "mother" }] };
    else if (path === "/v1/families/f1") body = { id: "f1", name: "Example", timezone: "America/New_York", has_pin: false, caregivers: [{ user_id: "u1", display_name: "Sam", role: "mother" }], created_at: at };
    else if (path === "/v1/families/f1/children") body = children;
    else if (path.endsWith("/coach-context")) body = { children: {}, history_limit: 20 };
    else if (path.endsWith("/ai/budget")) body = budget();
    else if (path.endsWith("/ai/operations/synthetic-op")) body = accounting();
    else if (path.endsWith("/observation")) { await route.fulfill({ status: 204 }); return; }
    else if (path.endsWith("/coach/messages")) {
      if (method === "POST") { used = 2; body = { messages, suggestions: [], goal_recommendations: [], reply: messages[1].content, safety: null, mapped_by: "ai", outcome: "advice", tokenomics: accounting() }; }
      else if (method === "DELETE") { await route.fulfill({ status: 204 }); return; }
      else body = { messages: [], suggestions: [], goal_recommendations: [] };
    } else if (path.endsWith("/plan")) body = { child_id: path.includes("/c2/") ? "c2" : "c1", goals: [], habits: [], progress };
    else if (path.endsWith("/settings")) body = { app_limit: 0, buddy_talk: false };
    else if (/\/(approvals|checkins|reward-requests|suggestions|surprises)$/.test(path)) body = [];
    else if (path.endsWith("/reports")) body = { plan: null, review: null };
    else if (path.endsWith("/today")) body = { child: children.find(child => path.includes(child.id)), day: "2026-11-05", rest_day: false, welcome_back: false, next_quest_day: null, habits: [], progress, points: 0, streak: 0, week: {} };
    else if (path.endsWith("/extras")) body = { app_limit: 0, buddy_talk: false, discoveries: [], accessories: [], wearing: null, goal: null, chests: [], level_seen: 1, app_seconds: {}, app_extra_minutes: {}, screen_bonus: {} };
    else if (method === "POST" && /\/(reviews|plan-suggestions)$/.test(path)) {
      used += 2;
      const kind = path.endsWith("/reviews") ? "review" : "plan";
      body = { id: `report-${kind}`, kind, created_at: at, result: kind === "review" ? { headline: "A week of small steps", children: [], patterns: [] } : { summary: "Keep one small step at a time.", tips: [] } };
    }
    else { unknown.push(`${method} ${path}`); await route.fulfill({ status: 404, json: { detail: "Unexpected preview endpoint" } }); return; }
    await route.fulfill({ json: body });
  });
  await page.goto("http://localhost:5180/#/coach/c1");
  await expect(page.getByLabel("0 / 100 credits used")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Alex 8 yrs/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Jamie 5 yrs/ })).toBeVisible();
  await page.getByLabel("Message the habit coach").fill("Help with bedtime");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("2 / 100 credits used")).toBeVisible();
  await expect(page.getByLabel("Generation accounting")).toContainText("Estimated cost $0.00218770");
  // Measure in one frame: the conversation can still be smoothly scrolling after Send.
  const toolbar = await page.locator(".ai-chat__tools").evaluate(element => {
    const meter = element.querySelector(".coaching-meter")!.getBoundingClientRect();
    const chat = element.querySelector(".ai-chat__clear")!.getBoundingClientRect();
    return { width: meter.width, height: meter.height, offset: Math.abs(meter.y + meter.height / 2 - chat.y - chat.height / 2) };
  });
  expect(toolbar.width).toBeLessThanOrEqual(370);
  expect(toolbar.height).toBe(36);
  expect((await page.getByRole("radio", { name: /Alex 8 yrs/ }).boundingBox())!.height).toBe(toolbar.height);
  if (width >= 600) expect(toolbar.offset).toBeLessThan(2);
  expect((await page.getByRole("progressbar", { name: "Coaching credits used" }).boundingBox())!.width).toBeGreaterThanOrEqual(width >= 600 ? 120 : 40);
  await expect(page.getByText("Demo · limits off")).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: "instant" }); });
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/coaching-meter/coach-${width}.png`, fullPage: true });
  used = 114; await page.evaluate(() => window.dispatchEvent(new Event("hq:coaching-budget")));
  await expect(page.getByLabel("114 / 100 credits used")).toBeVisible();
  await expect(page.getByLabel("14 credits over the allowance")).toBeVisible();
  await expect(page.getByLabel("Demo mode · limits are not enforced")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Coaching credits used" })).toHaveJSProperty("value", 100);
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/coaching-meter/coach-overage-${width}.png`, fullPage: true });
  costs = false; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Generation accounting")).not.toContainText("Estimated cost");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  used = 6; enforced = true;
  await page.goto("http://localhost:5180/#/parent");
  await expect(page.getByLabel("6 / 100 credits used")).toBeVisible();
  await expect(page.getByLabel("Limits enforced")).toBeVisible();
  await expect(page.getByText(/credits per useful/)).toHaveCount(0);
  const dashboardMeter = (await page.getByLabel("Daily coaching allowance").boundingBox())!;
  expect(dashboardMeter.width).toBeLessThanOrEqual(370);
  expect(dashboardMeter.height).toBe(toolbar.height);
  await page.getByRole("button", { name: "Write this week's review" }).click();
  await expect(page.getByLabel("8 / 100 credits used")).toBeVisible();
  await page.getByRole("button", { name: "Suggest a plan" }).click();
  await expect(page.getByLabel("10 / 100 credits used")).toBeVisible();
  await page.locator("section.ai").screenshot({ path: `../docs-detailed/evidence/2026-11-05/coaching-meter/dashboard-${width}.png` });
  costs = true; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("2 credits per useful review.")).toBeVisible();
  await expect(page.getByText("2 credits per useful plan.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});
