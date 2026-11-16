// Хранилище воспоминаний: список фраз для вывода на экран.
// Пока ничего не сохранено, используется DEFAULT_MEMORIES из data.ts.
// Свой список лежит в localStorage (`orpheus.memories`) и полностью заменяет стандартный.

import { log } from "../log";
import { DEFAULT_MEMORIES } from "./data";

const KEY = "orpheus.memories";

/** Предел длины одной фразы и числа фраз: защита от случайной вставки огромного текста. */
export const MEMORY_MAX_LENGTH = 200;
export const MEMORY_MAX_COUNT = 200;

let custom: string[] | null = load();
const listeners = new Set<() => void>();

function load(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return normalize(data.filter((x): x is string => typeof x === "string"));
  } catch {
    return null;
  }
}

function save(): void {
  try {
    if (custom === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(custom));
  } catch {
    log("system", "warn", "Не удалось сохранить воспоминания: без хранилища они пропадут после перезапуска.");
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

/** Убирает пустые строки и лишние пробелы, обрезает слишком длинное. */
function normalize(list: string[]): string[] {
  return list
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, MEMORY_MAX_LENGTH))
    .filter((s) => s !== "")
    .slice(0, MEMORY_MAX_COUNT);
}

/** Текущие фразы: свои, если они сохранены, иначе стандартные. */
export function getMemories(): string[] {
  return custom ? [...custom] : [...DEFAULT_MEMORIES];
}

/** true, если пользователь сохранил свой список. */
export function hasCustomMemories(): boolean {
  return custom !== null;
}

/** Превращает текст редактора (одна строка = одна фраза) в список. */
export function parseMemoryText(text: string): string[] {
  return normalize(text.split(/\r?\n/));
}

export function memoriesToText(list: readonly string[]): string {
  return list.join("\n");
}

/** Сохраняет свой список. Возвращает false, если после очистки не осталось ни одной фразы. */
export function setMemories(list: string[]): boolean {
  const clean = normalize(list);
  if (clean.length === 0) return false;
  custom = clean;
  save();
  log("system", "info", `Воспоминания сохранены: ${clean.length} шт.`);
  notify();
  return true;
}

/** Возвращает стандартный список (свой удаляется). */
export function resetMemories(): void {
  custom = null;
  save();
  log("system", "info", "Воспоминания возвращены к стандартным.");
  notify();
}

export function onMemoriesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
