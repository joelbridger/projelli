import { useEffect, useState } from 'react';
import type { CalendarProviderId } from '@/platform/utils/calendar-commands';

const PREFS_KEY = 'lantern:meetings:auto-join:calendar-prefs';
const DISABLED_KEY = 'lantern:meetings:auto-join:disabled-events';
const SETTINGS_EVENT = 'lantern:meetings:auto-join:settings-changed';

export type AutoJoinCalendarPrefs = Partial<Record<CalendarProviderId, boolean>>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
}

export function readAutoJoinCalendarPrefs(): AutoJoinCalendarPrefs {
  return readJson<AutoJoinCalendarPrefs>(PREFS_KEY, {});
}

export function setAutoJoinCalendarPref(provider: CalendarProviderId, enabled: boolean): void {
  const prefs = readAutoJoinCalendarPrefs();
  writeJson(PREFS_KEY, { ...prefs, [provider]: enabled });
}

export function readDisabledAutoJoinEventKeys(): Set<string> {
  return new Set(readJson<string[]>(DISABLED_KEY, []));
}

export function setAutoJoinEventDisabled(eventKey: string, disabled: boolean): void {
  const next = readDisabledAutoJoinEventKeys();
  if (disabled) next.add(eventKey);
  else next.delete(eventKey);
  writeJson(DISABLED_KEY, [...next].sort());
}

export function useAutoJoinCalendarPrefs(): AutoJoinCalendarPrefs {
  const [prefs, setPrefs] = useState<AutoJoinCalendarPrefs>(() => readAutoJoinCalendarPrefs());
  useEffect(() => {
    const refresh = () => {
      setPrefs(readAutoJoinCalendarPrefs());
    };
    window.addEventListener(SETTINGS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return prefs;
}

export function useDisabledAutoJoinEventKeys(): Set<string> {
  const [keys, setKeys] = useState<Set<string>>(() => readDisabledAutoJoinEventKeys());
  useEffect(() => {
    const refresh = () => {
      setKeys(readDisabledAutoJoinEventKeys());
    };
    window.addEventListener(SETTINGS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return keys;
}
