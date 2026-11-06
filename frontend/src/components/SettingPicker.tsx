import { useId } from "react";
import type { HabitSetting } from "../lib/api";
import { HABIT_SETTINGS, SETTING_LABELS } from "../lib/habitSetting";

const ICONS: Record<HabitSetting, string> = { home: "door", school: "backpack", community: "compass", outdoors: "seedling", online: "headphones" };

/** Native radios retain keyboard navigation; unsupported source settings remain disabled. */
export function SettingPicker({ value, onChange, rationale, automatic, onAutomatic, disabled = false, allowed = HABIT_SETTINGS, label = "Where will this happen?" }: {
  value: HabitSetting; onChange: (value: HabitSetting) => void; rationale: string; automatic: boolean;
  onAutomatic: () => void; disabled?: boolean; allowed?: readonly string[]; label?: string;
}) {
  const name = useId();
  return <fieldset className="setting-picker" disabled={disabled}>
    <legend>{label}</legend>
    <div className="setting-picker__options">{HABIT_SETTINGS.map((setting) => <label key={setting} className={`setting-choice ${value === setting ? "is-selected" : ""} ${allowed.includes(setting) ? "" : "is-unavailable"}`} title={allowed.includes(setting) ? SETTING_LABELS[setting] : "This goal does not support this setting"}>
      <input type="radio" name={name} value={setting} checked={value === setting} disabled={!allowed.includes(setting)} onChange={() => onChange(setting)} />
      <img src={`/fluent-emoji/${ICONS[setting]}.svg`} width="30" height="30" alt="" aria-hidden="true" />
      <span>{SETTING_LABELS[setting]}</span>
    </label>)}</div>
    <div className="setting-picker__note">{automatic ? <span><b>Suggested: {SETTING_LABELS[value]}.</b> {rationale} You can change it.</span>
      : <><span><b>Your choice: {SETTING_LABELS[value]}.</b></span><button type="button" className="link-button" onClick={onAutomatic}>Use suggested setting</button></>}
    </div>
  </fieldset>;
}
