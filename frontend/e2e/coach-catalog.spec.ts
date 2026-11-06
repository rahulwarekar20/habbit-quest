/** Catalog presentation against synthetic API fixtures; never contacts a provider or writes app data. */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const source = JSON.parse(readFileSync(new URL("./fixtures/coach-goal.json", import.meta.url), "utf8"));

const presentation = JSON.parse(readFileSync(new URL("../src/data/catalogPresentation.json", import.meta.url), "utf8"));
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

const now = "2026-11-04T12:00:00Z";
const goal = { id: "g1", child_id: "c1", goal_id: source.goal_id, title: source.title, description: source.description,
  reason: "A small, specific question gives Alex a manageable way to ask for help with homework.", source_ref: source.source_ref, setting: "home", created_at: now };
const thread = { messages: [{ id: 1, role: "coach", content: "Let's make homework easier to begin.\n1. Sit together and choose just one task.\n2. Invite Alex to point to the part that feels tricky.\n3. Try one question together, then take a pause.", sources: [], no_habit_match: false, created_at: now }], suggestions: [], goal_recommendations: [goal, ...([...new Set(Object.values(presentation.goals).filter((visual: any) => visual.age === "6–8" && visual.category !== source.source_ref.category_id).map((visual: any) => visual.category))] as string[]).slice(0, 3).map((category, index) => {
  const [id, visual] = Object.entries(presentation.goals).find(([, value]) => (value as any).category === category && (value as any).age === "6–8")! as [string, any];
  return { ...goal, id: `extra${index}`, goal_id: visual.goalId, title: visual.title, description: visual.description, source_ref: { ...goal.source_ref, source_id: id, category_id: category }, reason: "A small supported practice for this part of the day." };
})] };
const batch = { id: "b1", child_id: "c1", goal_id: source.goal_id, status: "ready", outcome: "ready", source: source.source_ref,
  expires_at: "2099-01-01T00:00:00Z", timings: { total_ms: 7400, writer_ms: 7300 }, items: [{ id: "d1", accepted_habit_id: null, child_habit_id: null,
    draft: { title: "Point to one tricky part", description: "Make the place you need help visible.", kid_title: "My little question", kid_hint: "Find one tricky part.",
      instruction: "Point to one tricky part of your homework and ask for help.", why: "A specific question helps a grown-up know where to start.", parent_setup: "Sit nearby with the work your child already has.", strategy: "specific question", estimated_seconds: 60,
      steps: ["Choose one piece of homework.", "Point to the part you want help with.", "Ask: Can we try this bit together?"], materials: [], help_text: "Can we try this bit together?", cue: "When homework starts", completion: "You have shown one place you want help.", recurrence: "weekly",
      parent_guidance: { prepare: "Leave room for one small question.", coach: "Listen, then show one example together.", if_hard: "Let your child point without explaining.", observe: "Notice the request for help, not a finished worksheet." } } }] };

for (const width of [1280, 390]) test(`goal and habit presentation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 });
  const unknown: string[] = [];
  let generated = 0, accepted = 0, cap = 5;
  let lastBatch = batch;
  let currentThread = structuredClone(thread);
  const [extraId, extraVisual] = Object.entries(presentation.goals).find(([, value]) => (value as any).age === "6–8" && !thread.goal_recommendations.some(card => card.goal_id === (value as any).goalId))! as [string, any];
  const extraGoal = { ...goal, id: "more-goal", goal_id: extraVisual.goalId, title: extraVisual.title, description: extraVisual.description, source_ref: { ...goal.source_ref, source_id: extraId, category_id: extraVisual.category } };
  const assigned: any[] = [];
  await page.addInitScript(() => {
    const expiresAt = 4102444800000;
    if (!localStorage.getItem("habitquest.generation.u1.details")) localStorage.setItem("habitquest.generation.u1.details", "true");
    localStorage.setItem("habbit-quest.token", JSON.stringify({ token: "synthetic-preview", expiresAt }));
    localStorage.setItem("habbit-quest.coachFresh", JSON.stringify({ signIn: expiresAt, children: ["c1"] }));
  });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body: unknown;
    if (path === "/v1/ai/budget") {
      if (method === "PATCH") cap = route.request().postDataJSON().cap_usd;
      body = { cap_usd: cap, accounted_usd: 0.9830207, remaining_usd: cap - 0.9830207, initialized: true, enabled: true, can_edit: true };
    }
    else if (path === "/v1/me") body = { id: "u1", name: "Sam", email: null, families: [{ id: "f1", name: "Example", display_name: "Sam", role: "mother" }] };
    else if (path === "/v1/families/f1") body = { id: "f1", name: "Example", timezone: "America/New_York", has_pin: false, caregivers: [{ user_id: "u1", display_name: "Sam", role: "mother" }], created_at: now };
    else if (path === "/v1/families/f1/children") body = [{ id: "c1", family_id: "f1", name: "Alex", age: 8, buddy: "bunny", world: "camp", tier_override: 0, routine_times: {}, created_at: now }];
    else if (path.endsWith("/coach-context")) body = { children: { c1: currentThread }, history_limit: 20 };
    else if (path.endsWith("/coach/messages")) {
      if (method === "DELETE") { await route.fulfill({ status: 204 }); return; }
      if (method === "POST") {
        expect(route.request().postDataJSON().more_goals).toBe(true);
        currentThread = { ...currentThread, goal_recommendations: [...currentThread.goal_recommendations, extraGoal] };
        body = { ...currentThread, reply: "Here is an additional approach.", safety: null, mapped_by: "ai", outcome: "recommendations", response_goal_ids: [extraGoal.goal_id] };
      } else body = currentThread;
    } else if (path.endsWith("/source")) {
      const selected = currentThread.goal_recommendations.find(goal => path.includes(goal.goal_id))!;
      body = { ...source, goal_id: selected.goal_id, title: selected.title, description: selected.description, source_ref: selected.source_ref,
        kid: selected.goal_id === source.goal_id ? source.kid : { ...source.kid, title: selected.title, description: selected.description } };
    }
    else if (path.endsWith("/habit-drafts")) {
      if (method === "POST") {
        generated++;
        expect(route.request().postDataJSON().setting).toBe("home");
        const count = route.request().postDataJSON().count;
        const selected = currentThread.goal_recommendations.find(goal => path.includes(goal.goal_id))!;
        lastBatch = { ...batch, id: `b${generated}`, goal_id: selected.goal_id, source: selected.source_ref, items: Array.from({ length: count }, (_, i) => ({ ...batch.items[0], id: `d${generated}-${i}`, draft: { ...batch.items[0].draft, kid_title: ["My little question", "Draw a tricky part", "Find one example"][i % 3] + (generated > 1 ? " again" : ""), emoji_key: ["speech_balloon", "pencil", "book"][i % 3] } })) };
        const events = ["context", "habit_generation", "validation", "saving", "complete"].map((stage, i) => `event: stage\ndata: ${JSON.stringify({ stage, elapsed_ms: i * 400 })}\n\n`).join("");
        await route.fulfill({ contentType: "text/event-stream", body: events + `event: result\ndata: ${JSON.stringify(lastBatch)}\n\n` }); return;
      }
      body = { batches: [] };
    } else if (path.endsWith("/plan")) body = { habits: assigned, goals: assigned.length ? [{ goal_id: source.goal_id, title: source.title, status: "active", options: [], recommended_habit_ids: [], reason: null }] : [], child_id: "c1", capacity: { limit: 6, used: assigned.length, remaining: 6 - assigned.length } };
    else if (path.endsWith("/kid-session")) body = { access_token: "kid-fixture", expires_in: 3600, child: { id: "c1", name: "Alex" } };
    else if (path === "/v1/kid/habits/my-ai-example/details") body = { habit_id: "my-ai-example", goal_id: source.goal_id, ...batch.items[0].draft };
    else if (path.endsWith("/checkins/today")) body = null;
    else if (path.endsWith("/today")) body = { child: { id: "c1", name: "Alex", buddy: "bunny", world: "camp" }, day: "2026-11-05", rest_day: false, welcome_back: false, next_quest_day: null, habits: path.startsWith("/v1/kid/") ? [{ child_habit_id: "ch1", habit_id: "my-ai-example", kid_title: "My little question", kid_hint: "Find one tricky part.", icon: "fluent:speech_balloon", anchor: "evening", tier: 1, points: 10, cue_time: "18:00", status: "todo", completion_id: null, boosts: [], multiplier: 1, stars: 0 }] : [], progress: { sparks: 0, pending_sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null }, points: 0, streak: 0, week: {} };
    else if (path.endsWith("/extras") || path.endsWith("/app-time")) body = { app_limit: 0, buddy_talk: false, discoveries: [], accessories: [], wearing: null, goal: null, chests: [], level_seen: 1, app_seconds: {}, app_extra_minutes: {}, screen_bonus: {} };
    else if (path.endsWith("/journey")) body = { progress: { sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null }, discoveries: [], quest_stars: [], worlds: [{ id: "camp", name: "Starter Camp", sparks: 0, rank: "Camp Sprout", tier: 1, blurb: "Where it begins", landmarks: [] }] };
    else if (path.endsWith("/surprises")) body = [];
    else if (path.endsWith("/buddy-line")) body = { line: "One small step." };
    else if (path.endsWith("/accept")) { accepted++; assigned.push({ ...lastBatch.items[0].draft, id: "ch1", habit_id: "my-ai-example", goal_id: source.goal_id, status: "active", days: ["thu"], cue_time: "18:00", anchor: "evening", icon: "fluent:speech_balloon", tier: 1, points: 10 }); body = { habit_id: "my-ai-example", child_habit_id: "ch1", goal_id: source.goal_id }; }
    else { unknown.push(`${method} ${path}`); await route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }); return; }
    await route.fulfill({ json: body });
  });
  await page.goto("http://localhost:5180/#/coach/c1");
  await expect(page.getByLabel("Message the habit coach")).toBeVisible();
  await expect(page.getByRole("heading", { name: source.kid.title, exact: true })).toBeVisible();
  const chat = page.getByRole("region", { name: "Chat about Alex" });
  await expect(chat.getByRole("textbox", { name: "Message the habit coach" })).toBeVisible();
  await expect(chat.getByRole("radio", { name: "Home", exact: true })).toBeChecked();
  await expect(chat.getByRole("button", { name: "Something different", exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Get more goals", exact: true })).toBeVisible();
  const chatBounds = (await chat.boundingBox())!;
  const firstGoalBounds = (await page.locator(".source-goal").first().boundingBox())!;
  expect(chatBounds.y + chatBounds.height).toBeLessThan(firstGoalBounds.y);
  const settingIcons = await chat.locator(".setting-choice img").evaluateAll(images => images.map(image => image.getBoundingClientRect().width));
  expect(settingIcons).toEqual([18, 18, 18, 18, 18]);
  const largestSetting = await chat.locator(".setting-choice").evaluateAll(choices => Math.max(...choices.map(choice => choice.getBoundingClientRect().height)));
  expect(largestSetting).toBeLessThanOrEqual(40);
  await expect(page.locator(".source-goal__picture img").first()).toHaveJSProperty("complete", true);
  expect(await page.locator(".source-goal__picture img").first().evaluate((image: HTMLImageElement) => image.currentSrc)).toContain(".512.png");
  await expect(page.locator(".guidance-text ol li")).toHaveCount(3);
  await expect(page.locator(".source-goal").first().getByText("Ages 6–8", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Research behind this goal" })).toHaveCount(4);
  const goalDetails = page.locator(".source-goal").first().getByRole("button", { name: "Read goal details", exact: true });
  await goalDetails.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByText("Research and limitations", { exact: true }).click();
  await expect(dialog.getByRole("link", { name: /Read research source/ }).first()).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.height).toBeLessThan(900);
  expect(bounds!.width).toBeLessThanOrEqual(width - 24);
  if (width >= 1280) expect(bounds!.width).toBe(960);
  await dialog.screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/linked-goal-dialog-${width}.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(goalDetails).toBeFocused();
  const boxes = await page.locator(".source-goal").evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y, width: card.getBoundingClientRect().width })));
  if (width >= 1280) {
    expect(boxes).toHaveLength(4);
    expect(new Set(boxes.slice(0, 3).map(box => Math.round(box.y))).size).toBe(1);
    expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
    expect(new Set(boxes.slice(0, 3).map(box => Math.round(box.x))).size).toBe(3);
    expect(boxes[0].width).toBeGreaterThan(340);
    expect(boxes[0].width).toBeLessThan(400);
  }
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/linked-goals-${width}.png`, fullPage: true });
  await page.locator(".source-goal").first().evaluate(element => element.scrollIntoView({ block: "center" }));
  await page.locator(".source-goal").first().screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/linked-card-${width}.png` });
  expect(generated).toBe(0);
  await page.getByRole("button", { name: "Make three habits", exact: true }).first().click();
  await expect(page.locator(".habit-draft")).toHaveCount(3);
  expect(generated).toBe(1);
  const generator = page.locator(`[data-goal-id="${source.goal_id}"] .goal-generator`);
  await generator.getByRole("button", { name: "Adjust setting, add a note or make more choices" }).click();
  await expect(dialog.getByRole("radio", { name: "Home" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "School" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close details" }).click();
  await expect(page.getByText("Server generation: 7.4s · 3 habits")).toBeVisible();
  const icons = await page.locator(".habit-draft__art img").evaluateAll(images => images.map(image => image.getAttribute("src")));
  expect(new Set(icons).size).toBe(3);
  await page.locator(".habit-drafts__grid").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/linked-habits-${width}.png`, fullPage: true });
  const cards = page.locator(".habit-draft");
  expect((await cards.first().boundingBox())!.height).toBeLessThan(120);
  await cards.first().getByRole("button", { name: /Read habit details/ }).click();
  await expect(dialog.locator(".habit-draft__child .practice-steps li")).toHaveCount(3);
  await expect(dialog.getByLabel("Time", { exact: true })).toBeVisible();
  await dialog.screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/linked-habit-dialog-${width}.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Add to Alex's quests" }).first().click();
  await expect(page.getByText("Added to Alex's quests")).toBeVisible();
  expect(accepted).toBe(1);
  await expect(page.getByRole("heading", { name: "Goals in Alex's plan", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coach recommendations", exact: true })).toBeVisible();
  await expect(page.locator(".source-goal")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: source.kid.title, exact: true })).toHaveCount(1);
  const savedHeading = (await page.getByRole("heading", { name: "Goals in Alex's plan", exact: true }).boundingBox())!;
  const suggestedBottom = await page.locator('.source-goal[data-goal-state="recommended"]').evaluateAll(cards => Math.max(...cards.map(card => card.getBoundingClientRect().bottom)));
  expect(suggestedBottom).toBeLessThan(savedHeading.y);
  expect(await page.locator(".source-goals__plan-heading").evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("2px");
  await expect(generator.getByRole("slider")).toHaveCount(0);
  await generator.getByRole("button", { name: "More habit choices", exact: true }).click();
  await expect(page.locator(".habit-draft")).toHaveCount(6);
  expect(generated).toBe(2);
  await expect(page.getByText("Added to Alex's quests")).toBeVisible();
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/linked-saved-recommendations-${width}.png`, fullPage: true });
  await chat.getByRole("button", { name: "Get more goals", exact: true }).click();
  await expect(page.locator(".source-goal")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "New recommendations", exact: true })).toBeVisible();
  await expect(page.locator(`[data-goal-id="${extraGoal.goal_id}"] .habit-draft`)).toHaveCount(3);
  await expect(page.locator(`[data-goal-id="${source.goal_id}"] .habit-draft`)).toHaveCount(6);
  expect(generated).toBe(3);
  await expect(page.getByText("Added to Alex's quests")).toBeVisible();
  await page.screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/more-goals-${width}.png`, fullPage: true });
  await page.goto("http://localhost:5180/#/family");
  await expect(page.getByLabel("Cumulative cap ($)")).toHaveValue("5");
  await page.getByText("Recent generation history (4)").click();
  await expect(page.locator(".generation-history > li")).toHaveCount(4);
  await page.locator(".generation-settings").screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/generation-settings-${width}.png` });
  await page.getByLabel("Show generation seconds and stage details").uncheck();
  await page.reload();
  await expect(page.getByLabel("Show generation seconds and stage details")).not.toBeChecked();
  await expect(page.getByText("Recent generation history (4)")).toBeVisible();
  await page.getByLabel("Cumulative cap ($)").fill("6");
  await page.getByRole("button", { name: "Save cap", exact: true }).click();
  await expect(page.getByText("Budget cap saved. Existing usage was preserved.")).toBeVisible();
  await expect(page.getByText("$0.983", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("http://localhost:5180/#/kid/c1");
  await expect(page.getByRole("heading", { name: "My little question" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Your goal" })).toBeVisible();
  await expect(page.getByText("Sit nearby with the work your child already has.")).toHaveCount(0);
  await expect(page.locator(".generated-steps .practice-steps li")).toHaveCount(3);
  await page.locator(".quest").screenshot({ path: `../docs-detailed/evidence/2026-11-05/more-choices/child-habit-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(unknown).toEqual([]);
});
