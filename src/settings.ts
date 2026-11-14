// Настройки интерфейса (локально, в localStorage).
// Сами файлы фона (картинка, видео) тут не хранятся: они лежат в IndexedDB, см. media.ts.

export type NavPosition = "left" | "top";
export type Theme = "dark" | "light";
export type BgMode = "silk" | "image" | "video";
export type AvatarMode = "3d" | "2d";
export type ProviderKind = "fake" | "orphea";

export type Settings = {
  /** Где стоит панель кнопок: слева (вертикально) или сверху (горизонтально). */
  navPosition: NavPosition;
  /** Показывать подписи под иконками кнопок. */
  navLabels: boolean;
  /** Цветовая тема. */
  theme: Theme;
  /** Анимации интерфейса: переходы, «капля» панели, появление карточек. */
  animations: boolean;
  /** Движение фона: шейдер и видео. Если выключено, фон остаётся статичным. */
  bgAnimated: boolean;
  /** Что показывать на фоне. */
  bgMode: BgMode;
  /** Затемнение (в светлой теме осветление) фона для читаемости, 0–80 %. */
  bgDim: number;
  /** Имена выбранных файлов, только для показа в настройках. */
  bgImageName: string;
  bgVideoName: string;
  /** Тип аватара: 3D-модель (VRM) или 2D-спрайты (спрайтшит). */
  avatarMode: AvatarMode;
  /** Кто отвечает в чате: заглушка или Орфея (Python-сервер). */
  provider: ProviderKind;
  /** Режим разработчика: технические детали и отладочные записи во вкладке «Дебаггер». */
  devMode: boolean;
};

const SETTINGS_KEY = "orpheus.settings";

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const DEFAULTS: Settings = {
  navPosition: "left",
  navLabels: true,
  theme: "dark",
  animations: !prefersReduced,
  bgAnimated: !prefersReduced,
  bgMode: "silk",
  bgDim: 30,
  bgImageName: "",
  bgVideoName: "",
  avatarMode: "3d",
  provider: "fake",
  devMode: false,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      navPosition: p.navPosition === "top" ? "top" : "left",
      navLabels: typeof p.navLabels === "boolean" ? p.navLabels : DEFAULTS.navLabels,
      theme: p.theme === "light" ? "light" : "dark",
      animations: typeof p.animations === "boolean" ? p.animations : DEFAULTS.animations,
      bgAnimated: typeof p.bgAnimated === "boolean" ? p.bgAnimated : DEFAULTS.bgAnimated,
      bgMode: p.bgMode === "image" || p.bgMode === "video" ? p.bgMode : "silk",
      bgDim: typeof p.bgDim === "number" ? clamp(Math.round(p.bgDim), 0, 80) : DEFAULTS.bgDim,
      bgImageName: typeof p.bgImageName === "string" ? p.bgImageName : "",
      bgVideoName: typeof p.bgVideoName === "string" ? p.bgVideoName : "",
      avatarMode: p.avatarMode === "2d" ? "2d" : "3d",
      provider: p.provider === "orphea" ? "orphea" : "fake",
      devMode: p.devMode === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

/** Тема и режим анимаций применяются к документу сразу: на них завязан весь CSS. */
function applyToDocument(s: Settings): void {
  document.documentElement.dataset.theme = s.theme;
  document.body?.classList.toggle("no-motion", !s.animations);
}

applyToDocument(current);
// <body> на момент загрузки модуля уже есть (скрипт отложенный), но на всякий случай:
document.addEventListener("DOMContentLoaded", () => applyToDocument(current));

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  current.bgDim = clamp(Math.round(current.bgDim), 0, 80);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить настройки", err);
  }
  applyToDocument(current);
  listeners.forEach((l) => l(current));
}

export function onSettings(listener: (s: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** true, если анимации интерфейса надо пропустить (выключены в настройках или в системе). */
export function motionReduced(): boolean {
  return (
    !current.animations ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
