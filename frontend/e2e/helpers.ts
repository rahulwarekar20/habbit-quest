/** Shared steps for the browser tests: signing in as a fresh test parent and setting up a family. */
import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/**
 * The development login's shared password: E2E_DEV_PASSWORD when set (CI), otherwise DEV_LOGIN_PASSWORD from
 * backend/.env, so a local run needs no extra setup. It is only typed into the sign-in form, never printed.
 */
function devPassword(): string {
  if (process.env.E2E_DEV_PASSWORD) return process.env.E2E_DEV_PASSWORD;
  const env = new URL("../../backend/.env", import.meta.url);
  const line = existsSync(env) ? readFileSync(env, "utf8").split(/\r?\n/).find((l) => l.startsWith("DEV_LOGIN_PASSWORD=")) : undefined;
  const password = line?.slice("DEV_LOGIN_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
  if (!password) throw new Error("Set E2E_DEV_PASSWORD, or DEV_LOGIN_PASSWORD in backend/.env");
  return password;
}

/** Signs in with the development login as a brand-new parent ("parent:e2e-…"), who has no family yet. */
export async function signInAsNewParent(page: Page): Promise<void> {
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Developer login" }).click();
  await page.getByLabel("Username").fill(`parent:e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await page.getByLabel("Shared password").fill(devPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Set up your family" })).toBeVisible();
}

/** First-time setup: creates a family (with `pin`, if given) and its first child, and waits for the dashboard. */
export async function createFamily(page: Page, { child = "Mia", age = "7", pin }: { child?: string; age?: string; pin?: string } = {}) {
  await page.getByLabel("Family name").fill("The E2E family");
  await page.getByLabel("Your name").fill("Robin");
  if (pin) await page.getByLabel("Parent PIN, 4 digits, optional").fill(pin);
  await page.getByRole("button", { name: "Create family" }).click();

  await expect(page.getByRole("heading", { name: "Who's going on quests?" })).toBeVisible();
  await page.getByLabel("Child's first name").fill(child);
  await page.getByRole("combobox", { name: "Age" }).selectOption(age); // the buddy cards say "ages" too
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(page.getByRole("heading", { name: /, Robin$/ })).toBeVisible();
}
