/**
 * Browser tests of the main journeys, end to end: the real app, API and database.
 *   1. A new family's first day: set up, pick a quest, the child does it, a grown-up approves, the child sees it.
 *   2. The parent PIN: kid mode keeps a child out of the grown-ups' pages until the right PIN is entered.
 */
import { expect, test, type Page } from "@playwright/test";
import { createFamily, signInAsNewParent } from "./helpers";

/** Adds the catalog's "Wake up early" (kid title "Rise and shine!") to the child's quests. */
async function addWakeQuest(page: Page, child: string) {
  await page.getByRole("link", { name: "Quest library" }).click();
  await page.getByRole("button", { name: `Add Wake up early to ${child}` }).click();
  await expect(page.getByText(`Wake up early added to ${child}'s quests.`)).toBeVisible();
}

const quest = (page: Page, kidTitle: string) => page.locator("article").filter({ has: page.getByRole("heading", { name: kidTitle }) });

test("a new family's first day: a quest is picked, done and approved", async ({ page }) => {
  await signInAsNewParent(page);
  await createFamily(page, { child: "Mia" });
  await addWakeQuest(page, "Mia");

  // Kid mode: the only child goes straight to today's quests.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Open kid mode" }).click();
  const wake = quest(page, "Rise and shine!");
  await wake.getByRole("button", { name: "I did it!" }).click();
  await expect(wake.getByText("Waiting for a grown-up")).toBeVisible();

  // Back to the grown-ups (this family has no PIN), where the quest waits for approval.
  await page.goto("/#/parent");
  const approvals = page.locator("section").filter({ has: page.getByRole("heading", { name: "Waiting for your OK" }) });
  await expect(approvals.getByText("Wake up early")).toBeVisible();
  await approvals.getByRole("button", { name: /Approve/ }).click();
  await expect(approvals.getByText(/When your child taps/)).toBeVisible();

  // The child sees the Spark.
  await page.getByRole("button", { name: "Open kid mode" }).click();
  await expect(quest(page, "Rise and shine!").getByText("Spark earned!")).toBeVisible();
});

test("the parent PIN keeps a child in kid mode out of the grown-ups' pages", async ({ page }) => {
  await signInAsNewParent(page);
  await createFamily(page, { child: "Leo", pin: "2468" });
  await page.getByRole("button", { name: "Open kid mode" }).click();
  await expect(page).toHaveURL(/#\/kid\//);

  await page.goto("/#/parent");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("This page is for grown-ups.")).toBeVisible();
  await dialog.getByLabel("4-digit PIN").fill("1357");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("That PIN isn't right. Try again.")).toBeVisible();

  await dialog.getByLabel("4-digit PIN").fill("2468");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: /, Robin$/ })).toBeVisible();
  await expect(dialog).toBeHidden();
});
