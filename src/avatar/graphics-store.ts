// Настройки графики окна-пета (вкладка «Аватар» → «Конфиг»). Лежат в localStorage, общем для всех окон
// приложения; об изменении окно-пет узнаёт по сигналу "graphics" (см. channel.ts) и применяет сразу.

import { notifyAvatarGraphicsChanged } from "./channel";

const KEY = "orpheus.avatar.graphics";

export type GraphicsQuality = "low" | "mid" | "high";

export interface Graphics {
  /** Потолок разрешения отрисовки: чем ниже, тем легче видеокарте. */
  quality: GraphicsQuality;
  /** Кадров в секунду, пока Орфея стоит (дыхание и моргание). */
  idleFps: number;
  /** Кадров в секунду при перетаскивании и падении. */
  activeFps: number;
}

/** Максимальное отношение физических пикселей к логическим для каждого уровня качества. */
export const QUALITY_RATIO: Record<GraphicsQuality, number> = { low: 1, mid: 1.5, high: 2 };

export const IDLE_FPS_OPTIONS: readonly number[] = [15, 24, 30, 60];
export const ACTIVE_FPS_OPTIONS: readonly number[] = [30, 60];

export const DEFAULT_GRAPHICS: Graphics = { quality: "mid", idleFps: 24, activeFps: 60 };

function sanitize(raw: unknown): Graphics {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const quality = v.quality === "low" || v.quality === "mid" || v.quality === "high" ? v.quality : DEFAULT_GRAPHICS.quality;
  const idleFps = typeof v.idleFps === "number" && IDLE_FPS_OPTIONS.includes(v.idleFps) ? v.idleFps : DEFAULT_GRAPHICS.idleFps;
  const activeFps =
    typeof v.activeFps === "number" && ACTIVE_FPS_OPTIONS.includes(v.activeFps) ? v.activeFps : DEFAULT_GRAPHICS.activeFps;
  return { quality, idleFps, activeFps };
}

export function loadGraphics(): Graphics {
  try {
    const text = localStorage.getItem(KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

/** Сохраняет изменённые поля, сообщает другим окнам и возвращает итоговые настройки. */
export function saveGraphics(patch: Partial<Graphics>): Graphics {
  const next = sanitize({ ...loadGraphics(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Не сохранилось: настройки подействуют до перезапуска, если окно применит их сразу.
  }
  notifyAvatarGraphicsChanged();
  return next;
}

export function resetGraphics(): Graphics {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Нечего сбрасывать.
  }
  notifyAvatarGraphicsChanged();
  return { ...DEFAULT_GRAPHICS };
}
