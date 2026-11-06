/** Real local API/DB integration. Requires an explicitly isolated service with fake providers. */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const isolatedApi = process.env.HQ_ISOLATED_API;
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

test("four goals prepare habits and a full plan supports remove, add, restore and child details", async ({ page, request }) => {
  test.skip(!isolatedApi, "Start the disposable _test API with fake providers and set HQ_ISOLATED_API.");
  test.setTimeout(120_000);
  expect(isolatedApi).toBe("http://127.0.0.1:8001");
  const login = await request.post(`${isolatedApi}/v1/auth/token`, { form: { username: `parent:catalog-flow-${Date.now()}`, password: "isolated-test-password" } });
  expect(login.ok()).toBe(true);
  const token = (await login.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };
  const familyResponse = await request.post(`${isolatedApi}/v1/families`, { headers, data: { name: "Browser test family", display_name: "Taylor", role: "guardian", timezone: "America/New_York" } });
  expect(familyResponse.ok()).toBe(true);
  const family = await familyResponse.json();
  const childResponse = await request.post(`${isolatedApi}/v1/families/${family.id}/children`, { headers, data: { name: "Demo", age: 8, buddy: "bunny" } });
  expect(childResponse.ok()).toBe(true);
  const child = await childResponse.json();
  const catalogResponse = await request.get(`${isolatedApi}/v1/catalog`, { headers });
  const habits = (await catalogResponse.json()).filter((habit: { min_age: number; max_age: number; tier: number }) => habit.min_age <= 8 && habit.max_age >= 8 && habit.tier === 1).slice(0, 6);
  expect(habits).toHaveLength(6);
  const fullPlan = await request.put(`${isolatedApi}/v1/children/${child.id}/plan`, { headers, data: { goals: [...new Set(habits.map((habit: { goal_id: string }) => habit.goal_id))], habits: habits.map((habit: { id: string }) => ({ habit_id: habit.id })) } });
  expect(fullPlan.ok()).toBe(true);

  let generated = 0;
  await page.route("**/v1/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/habit-drafts")) generated++;
    // The browser exercises the actual API and database. Only its destination changes.
    const response = await route.fetch({ url: `${isolatedApi}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.addInitScript(({ token, childId }) => {
    const expiresAt = Date.now() + 3_000_000;
    if (!localStorage.getItem("habbit-quest.token")) localStorage.setItem("habbit-quest.token", JSON.stringify({ token, expiresAt }));
    const saved = JSON.parse(localStorage.getItem("habbit-quest.token")!);
    localStorage.setItem("habbit-quest.coachFresh", JSON.stringify({ signIn: saved.expiresAt, children: [childId] }));
  }, { token, childId: child.id });
  await page.goto(`http://localhost:5180/#/coach/${child.id}`);
  await page.getByLabel("Message the habit coach").fill("Homework is hard to start. We need small ways to ask for help, get materials ready, and take a supported break at home.");
  await page.getByRole("radio", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".source-goal")).toHaveCount(4);
  await expect(page.locator(".habit-draft")).toHaveCount(12, { timeout: 30_000 });
  expect(generated).toBe(4);
  await expect(page.getByText("Plan full — remove a habit to make room", { exact: true })).toBeVisible();
  const goal = page.locator(".source-goal").first();
  await expect(goal.getByRole("region", { name: "Research behind this goal" })).toBeVisible();
  await goal.getByRole("button", { name: "Read goal details", exact: true }).click();
  await page.getByRole("dialog").getByText("Research and limitations", { exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: /Read research source/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  const draft = goal.locator(".habit-draft").first();
  await expect(draft.getByRole("button", { name: "Add to Demo's quests", exact: true })).toBeDisabled();
  await page.locator(".coach-plan-manager").getByRole("button", { name: /Remove .* from plan/ }).first().click();
  await expect(draft.getByRole("button", { name: "Add to Demo's quests", exact: true })).toBeEnabled();
  await goal.getByRole("button", { name: "Add goal to plan", exact: true }).click();
  await draft.getByRole("button", { name: "Add to Demo's quests", exact: true }).click();
  await expect(draft.getByText("Added to Demo's quests", { exact: true })).toBeVisible();
  const readPlan = async () => (await request.get(`${isolatedApi}/v1/children/${child.id}/plan`, { headers })).json();
  let plan = await readPlan();
  expect(plan.capacity).toEqual({ used: 6, limit: 6, remaining: 0 });
  const assignment = plan.habits.find((habit: { habit_id: string }) => habit.habit_id.startsWith("my-ai-"));
  expect(assignment).toBeTruthy();
  await draft.getByRole("button", { name: /Remove .* from plan/ }).click();
  await expect(draft.getByRole("button", { name: "Add back to Demo's quests", exact: true })).toBeEnabled();
  await draft.getByRole("button", { name: "Add back to Demo's quests", exact: true }).click();
  await expect(draft.getByText("Added to Demo's quests", { exact: true })).toBeVisible();
  expect((await readPlan()).habits.filter((habit: { habit_id: string }) => habit.habit_id === assignment.habit_id)).toHaveLength(1);
  await goal.getByRole("button", { name: "Remove goal and 1 habit", exact: true }).click();
  await expect(goal.getByRole("button", { name: "Add goal to plan", exact: true })).toBeEnabled();
  expect((await readPlan()).habits.some((habit: { habit_id: string }) => habit.habit_id === assignment.habit_id)).toBe(false);
  await goal.getByRole("button", { name: "Add goal to plan", exact: true }).click();
  await draft.getByRole("button", { name: "Add back to Demo's quests", exact: true }).click();
  await expect(draft.getByText("Added to Demo's quests", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.locator(".source-goal")).toHaveCount(1);
  await expect(page.locator(".habit-draft")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".source-goal")).toHaveCount(1);
  await expect(page.locator(".habit-draft")).toHaveCount(1);
  expect(generated).toBe(4);
  await page.goto(`http://localhost:5180/#/kid/${child.id}`);
  const childHabit = page.locator(".quest").filter({ has: page.getByRole("heading", { name: assignment.kid_title, exact: true }) });
  await expect(childHabit).toBeVisible();
  await expect(childHabit.locator(".generated-steps .practice-steps li")).not.toHaveCount(0);
  await expect(childHabit.getByRole("complementary", { name: "Your goal" })).toBeVisible();
  await page.screenshot({ path: "../docs-detailed/evidence/2026-11-05/real-api-child-plan.png", fullPage: true });
});

test("dashboard keeps two children's generated, scheduled and paused assignments visible after reload and changes", async ({ page, request }) => {
  test.skip(!isolatedApi, "Requires the disposable _test API with all providers disabled.");
  expect(isolatedApi).toBe("http://127.0.0.1:8001");
  test.setTimeout(120_000);
  const login = await request.post(`${isolatedApi}/v1/auth/token`, { form: { username: `parent:dashboard-flow-${Date.now()}`, password: "isolated-test-password" } });
  expect(login.ok()).toBe(true);
  const token = (await login.json()).access_token as string;
  const headers = { Authorization: `Bearer ${token}` };
  const familyResponse = await request.post(`${isolatedApi}/v1/families`, { headers, data: { name: "Dashboard test family", display_name: "Taylor", role: "guardian", timezone: "America/New_York" } });
  expect(familyResponse.ok()).toBe(true);
  const family = await familyResponse.json();
  const children = [];
  for (const name of ["Demo One", "Demo Two"]) {
    const response = await request.post(`${isolatedApi}/v1/families/${family.id}/children`, { headers, data: { name, age: 8, buddy: "bunny" } });
    expect(response.ok()).toBe(true);
    children.push(await response.json());
  }
  const todayResponse = await request.get(`${isolatedApi}/v1/children/${children[0].id}/today`, { headers });
  expect(todayResponse.ok()).toBe(true);
  const day = (await todayResponse.json()).day as string;
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const today = dayNames[weekday], otherDay = dayNames[(weekday + 1) % 7];
  const catalogResponse = await request.get(`${isolatedApi}/v1/catalog`, { headers });
  const catalog = (await catalogResponse.json()).filter((habit: { min_age: number; max_age: number; tier: number }) => habit.min_age <= 8 && habit.max_age >= 8 && habit.tier === 1).slice(0, 3);
  const generated: { habit_id: string; child_habit_id: string; goal_id: string; kid_title: string }[] = [];
  for (const [index, child] of children.entries()) {
    const coached = await request.post(`${isolatedApi}/v1/children/${child.id}/coach/messages`, { headers, data: { text: "Homework is hard to start. We need small ways to ask for help and get materials ready at home.", setting: "home" } });
    expect(coached.ok()).toBe(true);
    const goal = (await coached.json()).goal_recommendations[index];
    expect(goal).toBeTruthy();
    const written = await request.post(`${isolatedApi}/v1/children/${child.id}/goals/${goal.goal_id}/habit-drafts`, { headers, data: { request_id: randomUUID(), setting: "home", parent_instruction: "", count: index + 1 } });
    expect(written.ok()).toBe(true);
    const batch = await written.json();
    expect(batch.items).toHaveLength(index + 1);
    const item = batch.items[index];
    const accepted = await request.post(`${isolatedApi}/v1/habit-drafts/${batch.id}/items/${item.id}/accept`, { headers, data: { cue_time: "18:00", days: item.draft.recurrence === "daily" ? dayNames : [index ? today : otherDay], anchor: "evening" } });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    const assignment = await accepted.json();
    // Exercise the existing plan editor's scheduling API after approval.
    const scheduled = await request.patch(`${isolatedApi}/v1/child-habits/${assignment.child_habit_id}`, { headers, data: { days: [index ? today : otherDay] } });
    expect(scheduled.ok()).toBe(true);
    generated.push({ ...assignment, kid_title: item.draft.kid_title });
  }
  let firstPlan: any;
  for (const habit of catalog.slice(0, 2)) {
    const added = await request.post(`${isolatedApi}/v1/children/${children[0].id}/habits`, { headers, data: { habit_id: habit.id, days: [today] } });
    expect(added.ok()).toBe(true);
    firstPlan = await added.json();
  }
  const paused = firstPlan.habits.find((habit: { habit_id: string }) => habit.habit_id === catalog[1].id);
  const pause = await request.patch(`${isolatedApi}/v1/child-habits/${paused.id}`, { headers, data: { status: "paused" } });
  expect(pause.ok()).toBe(true);
  await page.route("**/v1/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${isolatedApi}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.addInitScript(token => {
    localStorage.setItem("habbit-quest.token", JSON.stringify({ token, expiresAt: Date.now() + 3_000_000 }));
  }, token);
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.goto("http://localhost:5180/#/parent");
  const first = page.getByRole("article", { name: "Demo One's dashboard" });
  const second = page.getByRole("article", { name: "Demo Two's dashboard" });
  const checkPlans = async () => {
    await expect(first.getByText("3 habits assigned", { exact: true })).toBeVisible();
    await expect(first.getByRole("region", { name: "Demo One's other days" }).getByText(generated[0].kid_title, { exact: false })).toBeVisible();
    await expect(first.getByRole("region", { name: "Demo One's paused" }).getByText(paused.kid_title, { exact: false })).toBeVisible();
    await expect(first.getByRole("region", { name: "Demo One's quests today" }).getByText(catalog[0].kid_title, { exact: false })).toBeVisible();
    await expect(second.getByText("1 habit assigned", { exact: true })).toBeVisible();
    await expect(second.getByRole("region", { name: "Demo Two's quests today" }).getByText(generated[1].kid_title, { exact: false })).toBeVisible();
    await expect(first.getByText(generated[1].kid_title, { exact: false })).toHaveCount(0);
    await expect(second.getByText(generated[0].kid_title, { exact: false })).toHaveCount(0);
    await expect(first.getByRole("list", { name: "Saved goals" }).locator("img").first()).toBeVisible();
    await expect(first.getByRole("region", { name: "Demo One's other days" }).getByRole("button")).toHaveCount(0);
  };
  await checkPlans();
  await page.reload();
  await checkPlans();
  await page.screenshot({ path: "../docs-detailed/evidence/2026-11-05/linked-dashboard-two-children.png", fullPage: true });
  const added = await request.post(`${isolatedApi}/v1/children/${children[1].id}/habits`, { headers, data: { habit_id: catalog[2].id, days: [otherDay] } });
  expect(added.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(second.getByText("2 habits assigned", { exact: true })).toBeVisible();
  await expect(second.getByRole("region", { name: "Demo Two's other days" }).getByText(catalog[2].kid_title, { exact: false })).toBeVisible();
  const removed = await request.patch(`${isolatedApi}/v1/child-habits/${generated[0].child_habit_id}`, { headers, data: { status: "removed" } });
  expect(removed.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(first.getByText("2 habits assigned", { exact: true })).toBeVisible();
  await expect(first.getByText(generated[0].kid_title, { exact: false })).toHaveCount(0);
  await expect(second.getByText(generated[1].kid_title, { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const goalLink = second.getByRole("link", { name: new RegExp(`^Goal for ${generated[1].kid_title}:`) });
  await expect(goalLink).toHaveAttribute("href", `#/quests/${children[1].id}/goal/${generated[1].goal_id}`);
  await goalLink.click();
  await expect(page.getByRole("region", { name: "Selected goal" })).toContainText("1 habit linked to this goal.");
  await expect(page.locator(".quest-rows > li")).toHaveCount(1);
  await page.getByRole("button", { name: "Read habit details", exact: true }).click();
  const habitDialog = page.getByRole("dialog");
  await expect(habitDialog.getByRole("link")).toHaveAttribute("href", `#/quests/${children[1].id}/goal/${generated[1].goal_id}`);
  await expect(habitDialog.locator(".habit-draft__child .practice-steps li")).not.toHaveCount(0);
  await habitDialog.screenshot({ path: "../docs-detailed/evidence/2026-11-05/linked-approved-habit-dialog.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Selected goal" }).getByRole("button", { name: "Read goal details" }).click();
  await expect(page.getByRole("dialog").locator(".goal-reader")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".quest-rows > li")).toHaveCount(1);
});
