import { describe, expect, it } from "vitest";
import { buddyChoice, buddyDisplayProps, buddyName, buddySelectionInput, mergeBuddySelection } from "./buddyIdentity";
import { addChild, newChild } from "./family";
import { emptyFamily } from "./testing";
import { applyExtras, applyToday } from "./sync";
import { reconcile } from "./store";
import { defaultState } from "../test/fakeServer";
import type { Extras, Today } from "./api";

const selected = { ...newChild("Alex", 8, "fox"), id: "c1", buddySelectionMode: "catalog" as const,
  catalogBuddyId: "ember-fox", buddyCatalogVersion: "0.1.0", buddySelectionRevision: 3 };
const raw = { buddy: "fox" as const, buddy_selection_mode: "catalog" as const, catalog_buddy_id: "dot-bot", buddy_catalog_version: "0.1.0", buddy_selection_revision: 4 };

describe("separate catalog identity and legacy compatibility", () => {
  it("resolves names and serializes explicit modes without aliasing them to old animal IDs", () => {
    expect(buddyName(selected)).toBe("Ember");
    expect(buddyDisplayProps(selected)).toMatchObject({ buddy: "fox", catalogBuddyId: "ember-fox", selectionMode: "catalog" });
    expect(buddySelectionInput(buddyChoice(selected), 3)).toEqual({ mode: "catalog", catalog_buddy_id: "ember-fox", buddy_catalog_version: "0.1.0", expected_revision: 3 });
    expect(buddySelectionInput({ mode: "legacy", buddy: "bunny" }, 4)).toEqual({ mode: "legacy", buddy: "bunny", expected_revision: 4 });
    expect(buddyName({ buddy: "owl" })).toBe("Owl");
  });

  it("accepts authoritative saves and ignores stale or old-format selection reads", () => {
    const current = mergeBuddySelection(selected, raw);
    expect(current.catalogBuddyId).toBe("dot-bot");
    expect(current.buddySelectionRevision).toBe(4);
    expect(mergeBuddySelection(current, { buddy: "bunny" })).toBe(current);
    expect(mergeBuddySelection(current, { ...raw, catalog_buddy_id: "pippin-bear", buddy_selection_revision: 2 })).toBe(current);
    const original = mergeBuddySelection(current, { buddy: "bear", buddy_selection_mode: "legacy", catalog_buddy_id: null, buddy_catalog_version: null, buddy_selection_revision: 5 });
    expect(original).toMatchObject({ buddy: "bear", buddySelectionMode: "legacy", catalogBuddyId: null, buddySelectionRevision: 5 });
  });

  it("merges progress and outfits while refusing a delayed selection downgrade", () => {
    const family = addChild(emptyFamily(), selected);
    const today: Today = { child: { id: "c1", name: "Alex", buddy: "bunny", world: "camp", buddy_selection_revision: 1 },
      day: "2026-11-05", welcome_back: false, rest_day: false, next_quest_day: null, habits: [], points: 40,
      progress: { sparks: 7, pending_sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null }, streak: 2, week: {} };
    const afterToday = applyToday(family, today);
    expect(afterToday.children[0]).toMatchObject({ catalogBuddyId: "ember-fox", buddySelectionRevision: 3, sparks: 7, balance: 40 });
    const extras: Extras = { app_limit: 0, buddy_talk: true, discoveries: [], accessories: ["crown"], wearing: "crown", goal: null,
      chests: [], level_seen: 1, app_seconds: {}, app_extra_minutes: {}, screen_bonus: {}, buddy: "bear", buddy_selection_revision: 0 };
    expect(applyExtras(afterToday, "c1", extras).children[0]).toMatchObject({ catalogBuddyId: "ember-fox", buddySelectionRevision: 3, wearing: "crown" });
  });

  it("retains a newer saved selection through parent reload reconciliation", () => {
    const saved = addChild(emptyFamily(), selected);
    const state = defaultState();
    const result = reconcile(saved, { me: state.me, server: state.family!, children: state.children });
    expect(result.children[0]).toMatchObject({ catalogBuddyId: "ember-fox", buddySelectionRevision: 3 });
    const next = reconcile(result, { me: state.me, server: state.family!, children: [{ ...state.children[0], ...raw }] });
    expect(next.children[0]).toMatchObject({ catalogBuddyId: "dot-bot", buddySelectionRevision: 4 });
  });
});
