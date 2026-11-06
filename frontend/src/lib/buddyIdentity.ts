/** Additive buddy identity adapter. The original four-value buddy remains a theme/fallback. */
import type { BuddySelectionFields, BuddySelectionInput } from "./api/types";
import type { BuddyId } from "./family";
import { getCatalogBuddy } from "./buddyCatalog";

export interface BuddyIdentitySource extends BuddySelectionFields {
  buddy?: BuddyId;
  buddySelectionMode?: "legacy" | "catalog";
  catalogBuddyId?: string | null;
  buddyCatalogVersion?: string | null;
  buddySelectionRevision?: number;
}
export interface BuddyChoice {
  mode: "legacy" | "catalog";
  buddy: BuddyId;
  catalogBuddyId?: string | null;
  catalogVersion?: string | null;
}
export const buddyCatalogEnabled = () => import.meta.env.VITE_BUDDY_CATALOG_ENABLED === "true";
export const buddyRevision = (source: BuddyIdentitySource) => source.buddy_selection_revision ?? source.buddySelectionRevision ?? 0;
export function buddyDisplayProps(source: BuddyIdentitySource) {
  return {
    buddy: source.buddy ?? "fox",
    selectionMode: source.buddy_selection_mode ?? source.buddySelectionMode ?? "legacy",
    catalogBuddyId: source.catalog_buddy_id ?? source.catalogBuddyId ?? null,
    catalogVersion: source.buddy_catalog_version ?? source.buddyCatalogVersion ?? null,
  };
}
export function buddyChoice(source: BuddyIdentitySource): BuddyChoice {
  const display = buddyDisplayProps(source);
  return { mode: display.selectionMode, buddy: display.buddy, catalogBuddyId: display.catalogBuddyId, catalogVersion: display.catalogVersion };
}
export function buddyName(source: BuddyIdentitySource): string {
  const props = buddyDisplayProps(source);
  return (props.selectionMode === "catalog" ? getCatalogBuddy(props.catalogBuddyId, props.catalogVersion)?.name : undefined)
    ?? `${props.buddy[0].toUpperCase()}${props.buddy.slice(1)}`;
}
export function buddySelectionInput(choice: BuddyChoice, expectedRevision?: number): BuddySelectionInput {
  const revision = expectedRevision === undefined ? {} : { expected_revision: expectedRevision };
  if (choice.mode === "legacy") return { mode: "legacy", buddy: choice.buddy, ...revision };
  if (!choice.catalogBuddyId || !choice.catalogVersion) throw new Error("Choose an available buddy before saving.");
  return { mode: "catalog", catalog_buddy_id: choice.catalogBuddyId, buddy_catalog_version: choice.catalogVersion, ...revision };
}
/** Ignore delayed choice fields without discarding unrelated progress/extras in the same response. */
export function mergeBuddySelection<T extends BuddyIdentitySource>(current: T, incoming: BuddyIdentitySource): T {
  if (incoming.buddy === undefined && incoming.buddy_selection_mode === undefined && incoming.buddySelectionMode === undefined) return current;
  if (buddyRevision(incoming) < buddyRevision(current)) return current;
  const props = buddyDisplayProps({ ...incoming, buddy: incoming.buddy ?? current.buddy });
  return { ...current, buddy: props.buddy, buddySelectionMode: props.selectionMode,
    catalogBuddyId: props.catalogBuddyId, buddyCatalogVersion: props.catalogVersion, buddySelectionRevision: buddyRevision(incoming) };
}
