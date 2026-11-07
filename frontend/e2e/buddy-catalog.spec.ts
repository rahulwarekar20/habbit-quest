/** Real buddy CRUD and avatar rendering; isolated fake-AI API, synthetic families, no paid calls. */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8002";
const evidence = fileURLToPath(new URL("../../docs-detailed/design-update/buddies/browser-evidence/", import.meta.url));
const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const syntheticPassword = "synthetic-buddy-browser-password";

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function screenshot(page: Page, name: string) {
  mkdirSync(evidence, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  // Settle the selected preview and eager avatars, never the offscreen lazy catalog portraits.
  await page.locator("img:not([loading='lazy'])").evaluateAll(async images => {
    await Promise.all(images.map(image => (image as HTMLImageElement).decode().catch(() => undefined)));
  });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: await page.getByRole("dialog").count() === 0 });
  await noOverflow(page);
}

async function parentToken(page: Page): Promise<string> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("habbit-quest.token")!).token as string);
}

for (const width of [1280, 390]) test(`buddy selection, persistence, outfits and fallback at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const errors: string[] = [], aiRequests: string[] = [], forbidden: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.method() === "POST" && /\/v1\/.*(?:buddy-line|coach|generate|review|planner)/.test(new URL(request.url()).pathname)) aiRequests.push(new URL(request.url()).pathname);
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if ((["localhost", "127.0.0.1"].includes(url.hostname) && ["5182", "8002"].includes(url.port)) ||
      (url.hostname === "habbit-quest-assets.s3.us-east-1.amazonaws.com" && url.pathname.startsWith("/buddies/catalog-0.1.0/"))) {
      await route.continue();
    } else {
      if (/openai|pinecone|nebius/.test(url.hostname)) forbidden.push(url.hostname);
      await route.abort();
    }
  });
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Developer login" }).click();
  await page.getByLabel("Username").fill(`parent:buddy-browser-${width}-${Date.now()}`);
  await page.getByLabel("Shared password").fill(syntheticPassword);
  // Enter also works around the existing small-screen developer-panel stacking issue.
  await page.getByLabel("Shared password").press("Enter");
  await expect(page.getByRole("heading", { name: "Set up your family" })).toBeVisible();
  await page.getByLabel("Family name").fill(`Browser buddy family ${width}`);
  await page.getByLabel("Your name").fill("Browser Parent");
  await page.getByRole("button", { name: "Create family", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Who's going on quests?" })).toBeVisible();
  const inline = page.getByRole("radiogroup", { name: "Buddy", exact: true });
  await expect(inline.getByRole("radio")).toHaveCount(3);
  await expect(inline.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  await expect(inline.getByText(/curious/i)).toBeVisible();
  await expect(inline.getByText("Suggested for ages 6–8").first()).toBeVisible();
  await page.getByRole("combobox", { name: /^Age/ }).selectOption("3");
  await expect(inline.getByRole("radio", { name: /^Momo,/ })).toBeChecked();
  await inline.getByRole("radio", { name: /^Nori,/ }).click();
  await page.getByRole("combobox", { name: /^Age/ }).selectOption("13");
  await expect(inline.getByRole("radio", { name: /^Nori,/ })).toBeChecked();
  const more = page.getByRole("button", { name: "More buddies" });
  await more.click();
  let dialog = page.getByRole("dialog", { name: "Choose a buddy" });
  await expect(dialog.getByRole("radiogroup", { name: "Catalog buddies" }).getByRole("radio")).toHaveCount(24);
  await expect(dialog.getByRole("radiogroup", { name: "Original buddies" }).getByRole("radio")).toHaveCount(4);
  await expect(dialog.getByRole("button", { name: "Close details" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("radio", { name: /^Bunny,/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close details" })).toBeFocused();
  await dialog.getByRole("radio", { name: /^Nova,/ }).click();
  await expect(dialog.getByRole("button", { name: "Choose Nova" })).toBeVisible();
  await expect(dialog.locator(".buddy-dialog__preview img")).toHaveAttribute("src", /\/nova-fox\/image\.png$/);
  await screenshot(page, `chooser-${width}`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  await expect(inline.getByRole("radio", { name: /^Nori,/ })).toBeChecked();
  await page.getByLabel("Child's first name").fill("Browser River");
  await screenshot(page, `setup-${width}`);
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await expect(page.getByRole("heading", { name: /, Browser Parent$/ })).toBeVisible();
  await expect(page.getByText(/Suggested for ages/)).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Nori", exact: true }).first()).toBeVisible();
  const token = await parentToken(page);
  const headers = { Authorization: `Bearer ${token}` };
  const me = await (await page.request.get(`${API}/v1/me`, { headers })).json();
  const familyId = me.families[0].id as string;
  const childrenPath = `${API}/v1/families/${familyId}/children`;
  const children = await (await page.request.get(childrenPath, { headers })).json();
  const childId = children[0].id as string;
  expect(children[0]).toMatchObject({ age: 13, buddy_selection_mode: "catalog", catalog_buddy_id: "nori-bunny", buddy_selection_revision: 1 });
  await page.goto(`/#/setup/${childId}`);
  await expect(inline.getByRole("radio")).toHaveCount(6);
  await expect(inline.getByRole("radio", { name: /^Nori,/ })).toBeChecked();
  await more.click(); dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Dot,/ }).click();
  await dialog.getByRole("button", { name: "Choose Dot" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(inline.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  await screenshot(page, `edit-${width}`);
  await page.goto("/#/parent");
  await page.getByRole("button", { name: "Open kid mode" }).click();
  await expect(page).toHaveURL(new RegExp(`#/kid/${childId}`));
  // Use the visible route only after kid-session/Today boot has completed.
  await page.getByRole("link", { name: /Field journal/ }).click();
  const kidInline = page.getByRole("radiogroup", { name: "Your buddy" });
  await expect(kidInline.getByRole("radio")).toHaveCount(3);
  await expect(kidInline.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  const beforePickerAi = aiRequests.length;
  await more.click(); dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Nova,/ }).click();
  await dialog.getByRole("button", { name: "Choose Nova" }).click();
  await expect(page.getByText("Your buddy is saved.")).toBeVisible();
  await expect(kidInline.getByRole("radio", { name: /^Nova,/ })).toBeChecked();
  expect(aiRequests).toHaveLength(beforePickerAi);
  await screenshot(page, `kid-journal-${width}`);
  await page.goto("/#/parent");
  await expect(page.getByRole("img", { name: "Nova", exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: "Nova", exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Suggested for ages/)).toHaveCount(0);
  await expect(page.locator(".buddy-choice__traits")).toHaveCount(0);
  await screenshot(page, `dashboard-${width}`);
  execFileSync(`${backend}/.venv/bin/python`, ["scripts/run_buddy_browser_api.py", "--equip-child", childId], { cwd: backend, stdio: "pipe" });
  // An old-client create keeps the original buddy and revision zero, even after migration.
  const legacyResponse = await page.request.post(childrenPath, { headers, data: { name: "Browser Original", age: 8, buddy: "owl", routine_times: {} } });
  expect(legacyResponse.ok()).toBe(true);
  const legacy = await legacyResponse.json();
  expect(legacy).toMatchObject({ buddy: "owl", buddy_selection_mode: "legacy", buddy_selection_revision: 0 });
  await page.reload();
  await expect(page.getByRole("img", { name: "owl", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open kid mode" }).click();
  await page.getByRole("button", { name: /Browser River/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/kid/${childId}`));
  await expect(page.getByRole("link", { name: /Field journal/ })).toBeVisible();
  await page.getByRole("link", { name: "Reward shop", exact: true }).click();
  const wardrobe = page.locator(".wardrobe");
  await expect(wardrobe.getByRole("button")).toHaveCount(9);
  const crown = wardrobe.getByRole("button", { name: /Golden crown/ });
  await expect(crown).toHaveAttribute("aria-pressed", "true");
  await expect(crown.locator("[data-accessory='crown']")).toHaveCount(1);
  await wardrobe.getByRole("button", { name: /Cool shades/ }).click();
  await expect(wardrobe.getByRole("button", { name: /Cool shades/ })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(wardrobe.getByRole("button", { name: /Cool shades/ })).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, `wardrobe-${width}`);
  await wardrobe.getByRole("button", { name: /No accessory/ }).click();
  await expect(wardrobe.getByRole("button", { name: /No accessory/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: "Nova", exact: true }).first()).toBeVisible();
  const beforeFallback = await (await page.request.get(`${API}/v1/children/${childId}`, { headers })).json();
  await page.route("https://habbit-quest-assets.s3.us-east-1.amazonaws.com/**", route => route.abort());
  await page.reload();
  await expect(page.getByRole("img", { name: "Nova (art unavailable)" }).first()).toBeVisible();
  await screenshot(page, `image-fallback-${width}`);
  const afterFallback = await (await page.request.get(`${API}/v1/children/${childId}`, { headers })).json();
  expect(afterFallback.catalog_buddy_id).toBe(beforeFallback.catalog_buddy_id);
  expect(afterFallback.buddy_selection_revision).toBe(beforeFallback.buddy_selection_revision);
  expect(afterFallback.catalog_buddy_id).toBe("nova-fox");
  expect(aiRequests).toEqual([]);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("direct journal boot waits for a real kid session before enabling buddy changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const loginResponse = await page.request.post(`${API}/v1/auth/token`, { form: {
    username: `parent:buddy-journal-boot-${Date.now()}`, password: syntheticPassword,
  } });
  expect(loginResponse.ok()).toBe(true);
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.access_token}` };
  const familyResponse = await page.request.post(`${API}/v1/families`, { headers, data: {
    name: "Browser direct journal family", timezone: "America/New_York", display_name: "Browser Parent", role: "guardian",
  } });
  expect(familyResponse.ok()).toBe(true);
  const family = await familyResponse.json();
  const childResponse = await page.request.post(`${API}/v1/families/${family.id}/children`, { headers, data: {
    name: "Browser Journal", age: 7, routine_times: {}, buddy_selection: {
      mode: "catalog", catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0",
    },
  } });
  expect(childResponse.ok()).toBe(true);
  const child = await childResponse.json();
  await page.addInitScript(({ accessToken, seconds }) => {
    localStorage.setItem("habbit-quest.token", JSON.stringify({ token: accessToken, expiresAt: Date.now() + seconds * 1000 }));
    sessionStorage.setItem("habbit-quest.kidMode", "1");
  }, { accessToken: login.access_token, seconds: login.expires_in });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sessionRequested = false;
  await page.route(`**/v1/children/${child.id}/kid-session`, async route => {
    sessionRequested = true;
    await gate;
    await route.continue();
  });
  await page.goto(`/#/journal/${child.id}`);
  try {
    await expect.poll(() => sessionRequested).toBe(true);
    await expect(page.getByText("Loading your buddy…")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Your buddy" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More buddies" })).toHaveCount(0);
  } finally { release(); }
  const picker = page.getByRole("radiogroup", { name: "Your buddy" });
  await expect(picker.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  await picker.getByRole("radio", { name: /^Ember,/ }).click();
  await expect(page.getByText("Your buddy is saved.")).toBeVisible();
  await expect(picker.getByRole("radio", { name: /^Ember,/ })).toBeChecked();
  const savedResponse = await page.request.get(`${API}/v1/children/${child.id}`, { headers });
  expect(savedResponse.ok()).toBe(true);
  expect(await savedResponse.json()).toMatchObject({ catalog_buddy_id: "ember-fox", buddy_selection_revision: 2 });
});
