/** Approved Quest Library views against isolated synthetic data; never writes to the running API. */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { PlanHabit } from "../src/lib/api";

const source = JSON.parse(readFileSync(new URL("./fixtures/coach-goal.json", import.meta.url), "utf8"));
const presentation = JSON.parse(readFileSync(new URL("../src/data/catalogPresentation.json", import.meta.url), "utf8"));
const learn = Object.values(presentation.goals).find((goal: any) => goal.goalId === source.goal_id) as any;
const sleep = Object.values(presentation.goals).find((goal: any) => goal.age === "6–8" && goal.category === "sleep-rest") as any;
const visuals = [learn, sleep];
const now = "2026-11-05T12:00:00Z";
const progress = { sparks: 4, pending_sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null };
const children = [
  { id: "c1", family_id: "f1", name: "Alex", age: 8, buddy: "bunny", world: "camp", tier_override: 0, routine_times: {}, created_at: now },
  { id: "c2", family_id: "f1", name: "Robin", age: 7, buddy: "fox", world: "camp", tier_override: 0, routine_times: {}, created_at: now },
];
const habit = (id: string, goal: string, title: string, icon: string, time: string): PlanHabit => ({
  id, habit_id: `my-ai-${id}`, goal_id: goal, title, description: title, kid_title: title, kid_hint: "Try one small step together.",
  icon: `fluent:${icon}`, cue_time: time, anchor: "evening", tier: 1, points: 10, days: ["mon", "tue", "wed", "thu", "fri"], status: "active", started_on: "2026-11-05",
});

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL, trace: "off" });
for (const width of [1280, 390]) test(`Quest Library views and controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 1200 : 1100 });
  const assigned: Record<string, PlanHabit[]> = { c1: [
    habit("question", learn.goalId, "Point to one tricky part", "speech_balloon", "16:00"),
    habit("drawing", learn.goalId, "Draw the part I need help with", "pencil", "16:15"),
    habit("book", sleep.goalId, "Choose a quiet bedtime book", "book", "19:30"),
  ], c2: [] };
  const plan = (id: string) => ({ child_id: id, progress, habits: assigned[id], goals: id === "c1" ? visuals.map(goal => ({ goal_id: goal.goalId, title: goal.title, status: "active", reason: null, recommended_habit_ids: [], options: [] })) : [], capacity: { limit: 6, used: assigned[id].length, remaining: 6 - assigned[id].length } });
  const catalog = [{ id: "read-page", goal_id: learn.goalId, goal_title: learn.title, title: "Read one page together", description: "Share one page.", kid_title: "One page together", kid_hint: "Choose a page with your grown-up.", icon: "📖", anchor: "after_school", min_age: 6, max_age: 8, tier: 1, points: 10 }];
  const unknown: string[] = [], writes: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const expiresAt = 4102444800000;
    localStorage.setItem("habbit-quest.token", JSON.stringify({ token: "synthetic-preview", expiresAt }));
    localStorage.setItem("habbit-quest.coachFresh", JSON.stringify({ signIn: expiresAt, children: ["c1", "c2"] }));
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/v1/")) {
      if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5180") await route.continue();
      else await route.abort();
      return;
    }
    const path = url.pathname, method = route.request().method();
    if (method !== "GET") writes.push(`${method} ${path}`);
    let body: unknown;
    if (path === "/v1/me") body = { id: "u1", name: "Sam", email: null, families: [{ id: "f1", name: "Example", display_name: "Sam", role: "mother" }] };
    else if (path === "/v1/families/f1") body = { id: "f1", name: "Example", timezone: "America/New_York", has_pin: false, caregivers: [{ user_id: "u1", display_name: "Sam", role: "mother" }], created_at: now };
    else if (path === "/v1/families/f1/children") body = children;
    else if (path.endsWith("/coach-context")) body = { children: { c1: { messages: [], suggestions: [], goal_recommendations: [] }, c2: { messages: [], suggestions: [], goal_recommendations: [] } }, history_limit: 20 };
    else if (path.endsWith("/plan")) body = plan(path.includes("/c2/") ? "c2" : "c1");
    else if (path === "/v1/catalog") body = catalog;
    else if (path === "/v1/goals") body = visuals.map(goal => ({ id: goal.goalId, title: goal.title, description: goal.description }));
    else if (path === "/v1/families/f1/habits") body = [];
    else if (path.endsWith("/checkins/today")) body = null;
    else if (path.endsWith("/today")) body = { child: children.find(child => path.includes(child.id)), day: "2026-11-05", rest_day: false, welcome_back: false, next_quest_day: null, habits: [], progress, points: 0, streak: 0, week: {} };
    else if (path.endsWith("/extras") || path.endsWith("/app-time")) body = { app_limit: 0, buddy_talk: false, discoveries: [], accessories: [], wearing: null, goal: null, chests: [], level_seen: 1, app_seconds: {}, app_extra_minutes: {}, screen_bonus: {} };
    else if (path.endsWith("/journey")) body = { progress, discoveries: [], quest_stars: [], worlds: [{ id: "camp", name: "Starter Camp", sparks: 0, rank: "Camp Sprout", tier: 1, blurb: "Where it begins", landmarks: [] }] };
    else if (path.endsWith("/surprises")) body = [];
    else if (path.endsWith("/buddy-line")) body = { line: "One small step." };
    else if (path === `/v1/children/c1/goals/${source.goal_id}/source`) body = source;
    else if (method === "PATCH" && path.startsWith("/v1/child-habits/")) {
      const id = path.split("/").pop();
      const change = route.request().postDataJSON();
      assigned.c1 = change.status === "removed" ? assigned.c1.filter(habit => habit.id !== id) : assigned.c1.map(habit => habit.id === id ? { ...habit, ...change } : habit);
      body = plan("c1");
    } else { unknown.push(`${method} ${path}`); await route.fulfill({ status: 404, json: { detail: "Unmocked preview endpoint" } }); return; }
    await route.fulfill({ json: body });
  });
  await page.goto("http://localhost:5180/#/quests/c1");
  await expect(page.getByRole("tab", { name: "Quests", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".quest-row")).toHaveCount(3);
  await expect(page.getByLabel("Days for Point to one tricky part")).toHaveValue("School days");
  await page.evaluate(() => document.fonts.ready);
  if (width === 1280) await page.screenshot({ path: "../docs-detailed/evidence/2026-11-05/quest-library-views/quests-desktop.png", fullPage: true });
  await page.getByRole("tab", { name: "By goal" }).click();
  await expect(page.getByRole("tabpanel", { name: "By goal" }).getByRole("article")).toHaveCount(2);
  const learning = page.getByRole("article", { name: learn.title, exact: true });
  await expect(learning.locator(".quest-row")).toHaveCount(2);
  await expect(learning.getByText("Choose a quiet bedtime book", { exact: true })).toHaveCount(0);
  await expect(learning.getByText("Ages 6–8", { exact: true })).toBeVisible();
  for (const img of await page.locator(".quest-goal-head img").all()) { await img.scrollIntoViewIfNeeded(); await expect(img).toHaveJSProperty("complete", true); expect(await img.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0); }
  if (width === 1280) expect(await learning.locator(".quest-goal-head img").evaluate((image: HTMLImageElement) => image.currentSrc)).toContain(".512.png");
  expect(writes).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (width === 390) await page.evaluate(() => window.scrollTo(0, document.querySelector(".quest-library-views")!.getBoundingClientRect().top + scrollY - 90));
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/quest-library-views/by-goal-${width}.png`, fullPage: width === 1280 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await learning.getByRole("button", { name: "Read goal details" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: source.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  const question = learning.locator(".quest-row").filter({ hasText: "Point to one tricky part" });
  await question.getByLabel("Time for Point to one tricky part").fill("17:20");
  await question.getByLabel("Time for Point to one tricky part").blur();
  await expect.poll(() => assigned.c1[0].cue_time).toBe("17:20");
  await question.getByLabel("Days for Point to one tricky part").selectOption("Weekends");
  await expect.poll(() => assigned.c1[0].days).toEqual(["sat", "sun"]);
  await question.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(question.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.getByRole("tab", { name: "Quests", exact: true }).click();
  await expect(page.getByLabel("Time for Point to one tricky part")).toHaveValue("17:20");
  await expect(page.getByLabel("Days for Point to one tricky part")).toHaveValue("Weekends");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("tab", { name: "By goal" }).click();
  await learning.locator(".quest-row").filter({ hasText: "Draw the part I need help with" }).getByRole("button", { name: "Remove" }).click();
  await expect(learning.locator(".quest-row")).toHaveCount(1);
  await page.getByRole("tab", { name: /Robin/ }).click();
  await expect(page.getByRole("heading", { name: "Robin's quests (0/6)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Quests", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "By goal" }).click();
  await expect(page.getByText(/No goals in this plan yet/)).toBeVisible();
  await expect(page.locator(".quest-goal-group")).toHaveCount(0);
  expect(unknown).toEqual([]);
  expect(errors).toEqual([]);
  expect(writes).toHaveLength(5);
  expect(writes.every(call => call.startsWith("PATCH /v1/child-habits/"))).toBe(true);
});
