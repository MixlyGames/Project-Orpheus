// Настройки интерфейса (локально, в localStorage).

export type NavPosition = "left" | "top";

export type Settings = {
  /** Где стоит панель кнопок: слева (вертикально) или сверху (горизонтально). */
  navPosition: NavPosition;
  /** Показывать подписи под иконками кнопок. */
  navLabels: boolean;
};

const SETTINGS_KEY = "orpheus.settings";

const DEFAULTS: Settings = {
  navPosition: "left",
  navLabels: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      navPosition: p.navPosition === "top" ? "top" : "left",
      navLabels: typeof p.navLabels === "boolean" ? p.navLabels : DEFAULTS.navLabels,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить настройки", err);
  }
  listeners.forEach((l) => l(current));
}

export function onSettings(listener: (s: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
