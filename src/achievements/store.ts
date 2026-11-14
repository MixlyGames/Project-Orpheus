// Прогресс достижений: какие получены и когда. Хранится в localStorage (только на этом компьютере).
// Выдать достижение из любого места кода: `unlockAchievement("first_words")`.

import { log } from "../log";
import { ACHIEVEMENTS } from "./data";
import { showAchievementToast } from "./toast";

const KEY = "orpheus.achievements";

let unlocked: Record<string, number> = load();
const listeners = new Set<() => void>();

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const result: Record<string, number> = {};
    for (const [id, time] of Object.entries(data as Record<string, unknown>)) {
      if (typeof time === "number") result[id] = time;
    }
    return result;
  } catch {
    return {};
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(unlocked));
  } catch {
    // Без хранилища достижения просто не переживут перезапуск.
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

export function isUnlocked(id: string): boolean {
  return id in unlocked;
}

/** Когда получено (мс с 1970 года) или null. */
export function unlockedAt(id: string): number | null {
  return unlocked[id] ?? null;
}

/** Сколько достижений из текущего списка получено (id, которых уже нет в списке, не считаются). */
export function unlockedCount(): number {
  return ACHIEVEMENTS.filter((a) => isUnlocked(a.id)).length;
}

/** Выдаёт достижение. Возвращает true, только если оно получено впервые. */
export function unlockAchievement(id: string): boolean {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) {
    log("system", "warn", `Достижение «${id}» не найдено в списке (src/achievements/data.ts).`);
    return false;
  }
  if (isUnlocked(id)) return false;

  unlocked[id] = Date.now();
  save();
  log("system", "info", `Получено достижение: «${a.title}».`, `id: ${a.id}`);
  showAchievementToast(a);
  notify();
  return true;
}

export function resetAchievements(): void {
  unlocked = {};
  save();
  log("system", "info", "Прогресс достижений сброшен.");
  notify();
}

export function onAchievementsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
