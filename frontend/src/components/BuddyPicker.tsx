/** Compact, explicit buddy choices. Browsing the dialog never saves a choice. */
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, errorText, getKidExtras, updateKidExtras } from "../lib/api";
import { BUDDY_CATALOG, BUDDY_CATALOG_VERSION, getCatalogBuddy, recommendBuddies, type CatalogBuddy } from "../lib/buddyCatalog";
import { buddyCatalogEnabled, buddyChoice, buddyRevision, buddySelectionInput, type BuddyChoice } from "../lib/buddyIdentity";
import type { Child } from "../lib/family";
import { useStore } from "../lib/store";
import { applyExtras } from "../lib/sync";
import Buddy, { BUDDIES } from "./Buddy";
import { CatalogDialog } from "./CatalogDialog";

export const catalogChoice = (buddy: CatalogBuddy): BuddyChoice => ({ mode: "catalog", buddy: "fox", catalogBuddyId: buddy.id, catalogVersion: BUDDY_CATALOG_VERSION });
export const sameBuddyChoice = (a: BuddyChoice, b: BuddyChoice) => a.mode === b.mode && (a.mode === "catalog" ? a.catalogBuddyId === b.catalogBuddyId && a.catalogVersion === b.catalogVersion : a.buddy === b.buddy);
const choiceKey = (choice: BuddyChoice) => choice.mode === "catalog" ? `catalog:${choice.catalogBuddyId}` : `legacy:${choice.buddy}`;
const displayProps = (choice: BuddyChoice) => ({ buddy: choice.buddy, selectionMode: choice.mode, catalogBuddyId: choice.catalogBuddyId, catalogVersion: choice.catalogVersion });
const recordFor = (choice: BuddyChoice) => choice.mode === "catalog" ? getCatalogBuddy(choice.catalogBuddyId, choice.catalogVersion) : undefined;
const nameFor = (choice: BuddyChoice) => recordFor(choice)?.name ?? BUDDIES.find(buddy => buddy.id === choice.buddy)!.name;
const originals: BuddyChoice[] = BUDDIES.map(buddy => ({ mode: "legacy", buddy: buddy.id }));
const words = (value: string) => value.replaceAll("-", " ");

function ChoiceTile({ choice, selected, onChoose, size, disabled, lazy = false }: {
  choice: BuddyChoice; selected: boolean; onChoose: (choice: BuddyChoice) => void; size: number; disabled?: boolean; lazy?: boolean;
}) {
  const record = recordFor(choice);
  const traits = record ? `${words(record.tone)} ${words(record.speciesOrForm)}` : `Original ${choice.buddy} buddy`;
  const ages = record ? `Suggested for ages ${record.primaryAgeBand.replace("-", "–")}` : "Available for ages 3–13";
  return <button type="button" role="radio" aria-checked={selected} disabled={disabled} aria-label={`${nameFor(choice)}, ${traits}. ${ages}`}
    className={`buddy-choice ${selected ? "is-on" : ""}`} onClick={() => onChoose(choice)}>
    <Buddy {...displayProps(choice)} size={size} loading={lazy ? "lazy" : "eager"} />
    <span className="buddy-choice__copy"><strong>{nameFor(choice)}</strong>
      <span className="buddy-choice__traits">{traits}</span>
      <small>{ages}</small>
    </span>
    {selected && <span className="buddy-choice__selected">Selected</span>}
  </button>;
}

/** Arrow keys move and choose within the current visible group; Enter/Space work on each tile. */
function chooseWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='radio']:not(:disabled)")];
  const index = choices.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !choices.length) return;
  event.preventDefault();
  const target = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + choices.length) % choices.length;
  choices[target].focus(); choices[target].click();
}

export function CompactBuddyPicker({ age, value, onChange, onManualChoice, count = 3, kid = false, disabled = false }: {
  age: number; value: BuddyChoice; onChange: (choice: BuddyChoice) => void; onManualChoice?: () => void; count?: number; kid?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const enabled = buddyCatalogEnabled();
  const alternatives = enabled ? recommendBuddies(age, { limit: 24 }).map(catalogChoice) : originals;
  const choices = [value, ...alternatives.filter(choice => !sameBuddyChoice(choice, value))].slice(0, enabled ? count : value.mode === "catalog" ? 5 : 4);
  const choose = (choice: BuddyChoice) => { onManualChoice?.(); if (!sameBuddyChoice(value, choice)) onChange(choice); };
  return <div className={`buddy-chooser ${kid ? "buddy-chooser--kid" : ""}`}>
    <div className="buddy-chooser__inline" role="radiogroup" aria-label={kid ? "Your buddy" : "Buddy"} onKeyDown={chooseWithKeyboard}>
      {choices.map(choice => <ChoiceTile key={choiceKey(choice)} choice={choice} selected={sameBuddyChoice(value, choice)} onChoose={choose} size={kid ? 64 : 48} disabled={disabled} />)}
    </div>
    {enabled && <button type="button" className="btn btn--ghost btn--sm buddy-chooser__more" disabled={disabled} onClick={() => setOpen(true)}>More buddies</button>}
    {open && <BuddyChooserDialog age={age} value={value} onClose={() => setOpen(false)} onChoose={choice => { choose(choice); setOpen(false); }} />}
  </div>;
}

/** The selection is local until the explicit Choose button is used. */
export function BuddyChooserDialog({ age, value, onChoose, onClose }: { age: number; value: BuddyChoice; onChoose: (choice: BuddyChoice) => void; onClose: () => void }) {
  const [preview, setPreview] = useState(value);
  const [theme, setTheme] = useState("");
  const [interest, setInterest] = useState("");
  const id = useId();
  const themes = [...new Set(BUDDY_CATALOG.map(record => record.kind))].sort();
  const interests = [...new Set(BUDDY_CATALOG.flatMap(record => record.interestTags))].sort();
  const ranked = recommendBuddies(age, { limit: 24 });
  const visible = ranked.filter(record => (!theme || record.kind === theme) && (!interest || record.interestTags.includes(interest)));
  const record = recordFor(preview);
  return <CatalogDialog title="Choose a buddy" onClose={onClose}>
    <div className="buddy-dialog">
      <p className="hint">All buddies are available for ages 3–13. Suggested ages are a starting point. Choose any buddy you like.</p>
      <div className="buddy-dialog__filters">
        <label className="field" htmlFor={`${id}-theme`}><span>Theme</span><select id={`${id}-theme`} value={theme} onChange={event => setTheme(event.target.value)}><option value="">All themes</option>{themes.map(item => <option key={item} value={item}>{words(item)}</option>)}</select></label>
        <label className="field" htmlFor={`${id}-interest`}><span>Interest</span><select id={`${id}-interest`} value={interest} onChange={event => setInterest(event.target.value)}><option value="">All interests</option>{interests.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div className="buddy-dialog__preview" aria-label="Buddy preview">
        <Buddy {...displayProps(preview)} size={144} representation="full" />
        <div><h3>{nameFor(preview)}</h3><p>{record?.description ?? `Your original ${preview.buddy} quest buddy.`}</p>
          {record && <><p className="hint">Suggested for ages {record.primaryAgeBand.replace("-", "–")}</p><p className="hint">Likes: {record.interestTags.join(", ")}</p></>}
        </div>
      </div>
      <div className="buddy-dialog__actions"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn--primary" onClick={() => onChoose(preview)}>Choose {nameFor(preview)}</button></div>
      <h3>Catalog buddies</h3>
      <div className="buddy-dialog__grid" role="radiogroup" aria-label="Catalog buddies" onKeyDown={chooseWithKeyboard}>
        {visible.map(buddy => <ChoiceTile key={buddy.id} choice={catalogChoice(buddy)} selected={sameBuddyChoice(preview, catalogChoice(buddy))} onChoose={setPreview} size={48} lazy />)}
      </div>
      {!visible.length && <p role="status">No buddies match these filters. Your selected buddy is still here. Try another theme or interest.</p>}
      <h3>Original buddies</h3>
      <div className="buddy-dialog__grid buddy-dialog__grid--originals" role="radiogroup" aria-label="Original buddies" onKeyDown={chooseWithKeyboard}>
        {originals.map(choice => <ChoiceTile key={choiceKey(choice)} choice={choice} selected={sameBuddyChoice(preview, choice)} onChoose={setPreview} size={48} />)}
      </div>
    </div>
  </CatalogDialog>;
}

/** Apply only the server's saved choice; a failed request leaves the old buddy selected. */
export function KidBuddyPicker({ child }: { child: Child }) {
  const { update } = useStore();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failedChoice, setFailedChoice] = useState<BuddyChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function choose(choice: BuddyChoice) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const extras = await updateKidExtras({ buddy_selection: buddySelectionInput(choice, buddyRevision(child)) });
      update(family => applyExtras(family, child.id, extras));
      setFailedChoice(null); setSaved(true);
    } catch (err) {
      setFailedChoice(choice);
      setError(`Your buddy could not be saved. ${errorText(err)}`);
      if (err instanceof ApiError && err.status === 409) {
        try { const extras = await getKidExtras(); update(family => applyExtras(family, child.id, extras)); } catch { /* Keep the last confirmed choice and allow a new explicit retry. */ }
      }
    } finally { saving.current = false; setBusy(false); }
  }
  return <div>
    <CompactBuddyPicker age={child.age} value={buddyChoice(child)} onChange={choose} kid disabled={busy} />
    <p className="hint" role="status" aria-live="polite">{busy ? "Saving your buddy…" : saved ? "Your buddy is saved." : ""}</p>
    {error && <div className="buddy-save-error" role="alert"><p>{error}</p><button type="button" className="btn btn--soft btn--sm" disabled={busy} onClick={() => failedChoice && choose(failedChoice)}>Try again</button></div>}
  </div>;
}
