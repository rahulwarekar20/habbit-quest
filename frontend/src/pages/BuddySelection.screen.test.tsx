/** Buddy selection uses the real screen/client path and only ordinary profile requests. */
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { defaultState, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

beforeEach(() => vi.stubEnv("VITE_BUDDY_CATALOG_ENABLED", "true"));

it("adds a child with the provisional catalog default and preserves it through a plain parent edit", async () => {
  const server = startFakeServer(defaultState({ pin: null }));
  const { user } = renderApp("/parent");
  await user.click(await screen.findByRole("button", { name: /Add a child/ }));
  const form = within(screen.getByRole("heading", { name: "Add a child" }).closest(".kid-card--form")!);
  await user.type(form.getByLabelText("Child's first name"), "River");
  expect(form.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  await user.click(form.getByRole("button", { name: "Add child" }));
  await waitFor(() => expect(server.state.children).toHaveLength(2));
  expect(server.state.children[1]).toMatchObject({ buddy_selection_mode: "catalog", catalog_buddy_id: "dot-bot", buddy_selection_revision: 1 });
  window.location.hash = "/setup/c2";
  const savedChoice = await screen.findByRole("radio", { name: /^Dot,/ });
  expect(savedChoice).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Age"), "13");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved.");
  expect(server.sent("PATCH", /\/children\/c2$/)[0].body).not.toHaveProperty("buddy_selection");
  expect(server.state.children[1]).toMatchObject({ age: 13, catalog_buddy_id: "dot-bot", buddy_selection_revision: 1 });
  expect(server.calls.filter(call => call.method === "POST" && /buddy-line|coach|generate|pinecone|embedding/i.test(call.path))).toEqual([]);
});

it("keeps the last saved kid buddy after failure and retries explicitly with its revision", async () => {
  const server = startFakeServer(defaultState({ pin: null }));
  const { user } = renderApp("/parent");
  await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
  await screen.findByRole("heading", { name: "Rise and shine" });
  window.location.hash = "/journal/c1";
  const group = within(await screen.findByRole("radiogroup", { name: "Your buddy" }));
  expect(group.getAllByRole("radio")).toHaveLength(3);
  const beforeLines = server.sent("POST", /buddy-line$/).length;
  server.on("PATCH", /\/kid\/extras$/, () => ({ status: 503, body: { detail: "Try again in a moment." } }));
  await user.click(group.getByRole("radio", { name: /^Dot,/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your buddy could not be saved.");
  expect(group.getByRole("radio", { name: /^Fox,/ })).toBeChecked();
  expect(server.state.children[0].buddy_selection_mode).not.toBe("catalog");
  let sentToken: string | null = null;
  server.on("PATCH", /\/kid\/extras$/, (_match, body, token) => {
    sentToken = token;
    const choice = (body as { buddy_selection: { catalog_buddy_id: string; buddy_catalog_version: string; expected_revision: number } }).buddy_selection;
    expect(choice.expected_revision).toBe(0);
    Object.assign(server.state.children[0], { buddy_selection_mode: "catalog", catalog_buddy_id: choice.catalog_buddy_id, buddy_catalog_version: choice.buddy_catalog_version, buddy_selection_revision: 1 });
    return { app_limit: 0, buddy_talk: true, discoveries: [], accessories: [], wearing: null, goal: null, chests: [], level_seen: 1,
      app_seconds: {}, app_extra_minutes: {}, screen_bonus: {}, buddy: "fox", buddy_selection_mode: "catalog", catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0", buddy_selection_revision: 1 };
  });
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Your buddy is saved.")).toBeInTheDocument();
  expect(group.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  expect(sentToken).toBe("kid:c1");
  expect(server.sent("PATCH", /\/kid\/extras$/)).toHaveLength(2);
  expect(server.sent("POST", /buddy-line$/)).toHaveLength(beforeLines);
});

it("refreshes a conflicting kid choice before a deliberate retry, keeping all progress", async () => {
  const server = startFakeServer(defaultState({ pin: null }));
  const { user } = renderApp("/parent");
  await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
  await screen.findByRole("heading", { name: "Rise and shine" });
  window.location.hash = "/journal/c1";
  const group = within(await screen.findByRole("radiogroup", { name: "Your buddy" }));
  Object.assign(server.state.children[0], { buddy: "owl", buddy_selection_mode: "legacy", buddy_selection_revision: 1 });
  await user.click(group.getByRole("radio", { name: /^Dot,/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your buddy could not be saved.");
  await waitFor(() => expect(group.getByRole("radio", { name: /^Owl,/ })).toBeChecked());
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(group.getByRole("radio", { name: /^Dot,/ })).toBeChecked());
  expect(server.sent("PATCH", /\/kid\/extras$/).map(call => call.body)).toEqual([
    { buddy_selection: { mode: "catalog", catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0", expected_revision: 0 } },
    { buddy_selection: { mode: "catalog", catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0", expected_revision: 1 } },
  ]);
  expect(server.state.sparks.c1).toBe(4);
  expect(server.state.points.c1).toBe(40);
  expect(server.state.plans.c1).toHaveLength(2);
});

it("saves an original from the catalog dialog and preserves a newer kid choice during an unrelated parent edit", async () => {
  const server = startFakeServer(defaultState({ pin: null }));
  Object.assign(server.state.children[0], { buddy_selection_mode: "catalog", catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0", buddy_selection_revision: 2 });
  const { user } = renderApp("/setup/c1");
  expect(await screen.findByRole("radio", { name: /^Dot,/ })).toBeChecked();
  // A kid chose Nova on another device after the parent opened this form.
  Object.assign(server.state.children[0], { catalog_buddy_id: "nova-fox", buddy_selection_revision: 3 });
  await user.type(screen.getByLabelText("Child's first name"), " River");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved.");
  expect(server.state.children[0]).toMatchObject({ name: "Alex River", catalog_buddy_id: "nova-fox", buddy_selection_revision: 3 });
  expect(server.sent("PATCH", /\/children\/c1$/)[0].body).not.toHaveProperty("buddy_selection");
  await user.click(screen.getByRole("button", { name: "More buddies" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("radio", { name: /^Owl,/ }));
  await user.click(dialog.getByRole("button", { name: "Choose Owl" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(server.state.children[0].buddy_selection_revision).toBe(4));
  expect(server.state.children[0]).toMatchObject({ buddy: "owl", buddy_selection_mode: "legacy", catalog_buddy_id: null, buddy_catalog_version: null });
  expect(server.sent("PATCH", /\/children\/c1$/)[1].body).toMatchObject({ buddy_selection: { mode: "legacy", buddy: "owl", expected_revision: 3 } });
});

it("keeps a conflicting parent draft until explicit reload and advances the revision after each confirmed save", async () => {
  const server = startFakeServer(defaultState({ pin: null }));
  const { user } = renderApp("/setup/c1");
  await user.click(await screen.findByRole("radio", { name: /^Dot,/ }));
  await user.type(screen.getByLabelText("Child's first name"), " River");
  Object.assign(server.state.children[0], { buddy_selection_mode: "catalog", catalog_buddy_id: "nova-fox", buddy_catalog_version: "0.1.0", buddy_selection_revision: 1 });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  const reload = await screen.findByRole("button", { name: "Reload saved details" });
  expect(screen.getByLabelText("Child's first name")).toHaveValue("Alex River");
  expect(screen.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  expect(server.state.children[0].catalog_buddy_id).toBe("nova-fox");
  await user.click(reload);
  await waitFor(() => expect(screen.getByRole("radio", { name: /^Nova,/ })).toBeChecked());
  expect(screen.getByLabelText("Child's first name")).toHaveValue("Alex");
  await user.click(screen.getByRole("radio", { name: /^Dot,/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(server.state.children[0].buddy_selection_revision).toBe(2));
  await screen.findByText("Saved.");
  await user.click(screen.getByRole("radio", { name: /^Ember,/ }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(server.state.children[0].buddy_selection_revision).toBe(3));
  expect(server.sent("PATCH", /\/children\/c1$/).map(call => (call.body as { buddy_selection: { expected_revision: number } }).buddy_selection.expected_revision)).toEqual([0, 1, 2]);
});

it("retains all eight wardrobe accessories and the saved outfit when an outfit write fails", async () => {
  const server = startFakeServer(defaultState({ pin: null }));
  server.on("GET", /\/kid\/rewards$/, () => []);
  server.on("GET", /\/kid\/reward-requests$/, () => []);
  server.on("GET", /\/kid\/points$/, () => ({ points: 40, earned: 40, spent: 0, entries: [] }));
  server.on("GET", /\/kid\/extras$/, () => ({ app_limit: 0, buddy_talk: true, discoveries: [], accessories: ["party-hat", "crown", "shades", "bow", "wizard", "flower", "headphones", "halo"], wearing: "crown", goal: null, chests: [], level_seen: 1,
    app_seconds: {}, app_extra_minutes: {}, screen_bonus: {}, buddy: "fox", buddy_selection_mode: "legacy", buddy_selection_revision: 0 }));
  const { user } = renderApp("/parent");
  await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
  await screen.findByRole("heading", { name: "Rise and shine" });
  window.location.hash = "/shop/c1";
  const remove = await screen.findByRole("button", { name: /No accessory/ });
  const wardrobe = within(remove.closest(".wardrobe")!);
  expect(wardrobe.getAllByRole("button")).toHaveLength(9);
  const crown = wardrobe.getByRole("button", { name: /Golden crown/ });
  expect(crown).toHaveAttribute("aria-pressed", "true");
  server.on("PATCH", /\/kid\/extras$/, () => ({ status: 503, body: { detail: "Please try again." } }));
  await user.click(remove);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your accessory could not be saved.");
  expect(crown).toHaveAttribute("aria-pressed", "true");
  expect(remove).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(server.sent("PATCH", /\/kid\/extras$/)[0].body).toEqual({ wearing: "" });
  server.on("PATCH", /\/kid\/extras$/, () => ({ app_limit: 0, buddy_talk: true, discoveries: [], accessories: ["party-hat", "crown", "shades", "bow", "wizard", "flower", "headphones", "halo"], wearing: null, goal: null, chests: [], level_seen: 1,
    app_seconds: {}, app_extra_minutes: {}, screen_bonus: {}, buddy: "fox", buddy_selection_mode: "legacy", buddy_selection_revision: 0 }));
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(remove).toHaveAttribute("aria-pressed", "true"));
  expect(crown).toHaveAttribute("aria-pressed", "false");
  expect(wardrobe.getAllByRole("button")).toHaveLength(9);
});
