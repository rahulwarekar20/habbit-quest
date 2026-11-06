import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChildForm } from "./ChildForm";
import { CompactBuddyPicker } from "./BuddyPicker";

beforeEach(() => vi.stubEnv("VITE_BUDDY_CATALOG_ENABLED", "true"));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it("preselects three age-aware choices, follows age until a manual choice, and submits that choice explicitly", async () => {
  const user = userEvent.setup();
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<ChildForm submitLabel="Add child" onSubmit={submit} />);
  const group = within(screen.getByRole("radiogroup", { name: "Buddy" }));
  expect(group.getAllByRole("radio")).toHaveLength(3);
  expect(group.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
  expect(group.getAllByText("Suggested for ages 6–8").length).toBeGreaterThan(0);
  await user.selectOptions(screen.getByLabelText("Age"), "3");
  expect(group.getByRole("radio", { name: /^Momo,/ })).toBeChecked();
  await user.click(group.getByRole("radio", { name: /^Nori,/ }));
  await user.selectOptions(screen.getByLabelText("Age"), "13");
  expect(group.getByRole("radio", { name: /^Nori,/ })).toBeChecked();
  await user.type(screen.getByLabelText("Child's first name"), "River");
  await user.click(screen.getByRole("button", { name: "Add child" }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ name: "River", age: 13,
    buddy_selection: { mode: "catalog", catalog_buddy_id: "nori-bunny", buddy_catalog_version: "0.1.0" } }));
  expect(submit.mock.calls[0][0]).not.toHaveProperty("buddy");
  expect(screen.queryByRole("radio", { name: /none|no buddy/i })).not.toBeInTheDocument();
});

it("pins an existing buddy among six edit choices and leaves the saved selection out of unrelated edits", async () => {
  const user = userEvent.setup();
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<ChildForm initial={{ name: "Alex", age: 8, buddy: "bunny", routine_times: {}, buddy_selection_revision: 5 }} submitLabel="Save changes" onSubmit={submit} />);
  const group = within(screen.getByRole("radiogroup", { name: "Buddy" }));
  expect(group.getAllByRole("radio")).toHaveLength(6);
  expect(group.getByRole("radio", { name: /^Bunny,/ })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Age"), "13");
  expect(group.getByRole("radio", { name: /^Bunny,/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(submit.mock.calls[0][0]).not.toHaveProperty("buddy_selection");
  expect(submit.mock.calls[0][0]).not.toHaveProperty("buddy");
});

it("treats clicking the preselected new-child buddy as a manual choice", async () => {
  const user = userEvent.setup();
  render(<ChildForm submitLabel="Add child" onSubmit={vi.fn()} />);
  await user.click(screen.getByRole("radio", { name: /^Dot,/ }));
  await user.selectOptions(screen.getByLabelText("Age"), "3");
  expect(screen.getByRole("radio", { name: /^Dot,/ })).toBeChecked();
});

it("keeps the edit's original revision even when a fresher read arrives while a draft is open", async () => {
  const user = userEvent.setup();
  const submit = vi.fn().mockResolvedValue(undefined);
  const initial = { name: "Alex", age: 8, buddy: "bunny" as const, routine_times: {}, buddy_selection_revision: 5 };
  const { rerender } = render(<ChildForm initial={initial} submitLabel="Save changes" onSubmit={submit} />);
  await user.click(screen.getByRole("radio", { name: /^Dot,/ }));
  rerender(<ChildForm initial={{ ...initial, buddy_selection_revision: 6 }} submitLabel="Save changes" onSubmit={submit} />);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(submit.mock.calls[0][0].buddy_selection).toEqual({ mode: "catalog", catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0", expected_revision: 5 });
});

it("browses all 24 buddies and four originals without saving, keeps empty filters local, and restores focus", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(<CompactBuddyPicker age={3} value={{ mode: "legacy", buddy: "fox" }} onChange={change} />);
  const more = screen.getByRole("button", { name: "More buddies" });
  await user.click(more);
  const dialog = within(screen.getByRole("dialog", { name: "Choose a buddy" }));
  expect(dialog.getByRole("button", { name: "Close details" })).toHaveFocus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(dialog.getByRole("radio", { name: /^Bunny,/ })).toHaveFocus();
  await user.keyboard("{Tab}");
  expect(dialog.getByRole("button", { name: "Close details" })).toHaveFocus();
  const catalog = within(dialog.getByRole("radiogroup", { name: "Catalog buddies" }));
  expect(catalog.getAllByRole("radio")).toHaveLength(24);
  expect(within(dialog.getByRole("radiogroup", { name: "Original buddies" })).getAllByRole("radio")).toHaveLength(4);
  await user.click(catalog.getByRole("radio", { name: /^Nova,/ }));
  expect(within(dialog.getByLabelText("Buddy preview")).getByText("Suggested for ages 11–13")).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
  await user.selectOptions(dialog.getByLabelText("Theme"), "technology");
  await user.selectOptions(dialog.getByLabelText("Interest"), "soft toys");
  expect(dialog.getByText(/No buddies match/)).toBeInTheDocument();
  expect(dialog.getByRole("button", { name: "Choose Nova" })).toBeEnabled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(more).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
  await user.click(more);
  const reopened = within(screen.getByRole("dialog"));
  expect(reopened.getByLabelText("Theme")).toHaveValue("");
  await user.click(reopened.getByRole("radio", { name: /^Nova,/ }));
  await user.click(reopened.getByRole("button", { name: "Choose Nova" }));
  expect(change).toHaveBeenCalledWith({ mode: "catalog", buddy: "fox", catalogBuddyId: "nova-fox", catalogVersion: "0.1.0" });
});

it("supports keyboard choices and keeps the four originals when catalog picking is disabled", () => {
  vi.stubEnv("VITE_BUDDY_CATALOG_ENABLED", "false");
  const change = vi.fn();
  render(<CompactBuddyPicker age={8} value={{ mode: "legacy", buddy: "fox" }} onChange={change} />);
  expect(screen.getAllByRole("radio")).toHaveLength(4);
  const fox = screen.getByRole("radio", { name: /^Fox,/ });
  fox.focus(); fireEvent.keyDown(fox, { key: "ArrowRight" });
  expect(change).toHaveBeenCalledWith({ mode: "legacy", buddy: "owl" });
  expect(screen.queryByRole("button", { name: "More buddies" })).not.toBeInTheDocument();
});
