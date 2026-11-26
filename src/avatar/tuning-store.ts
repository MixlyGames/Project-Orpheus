// Сохранённые настройки «жизни» модели (опускание рук, дыхание, моргание), по имени файла модели.
// Общий модуль: настройки пишет панель разработчика в главном окне, а читают и она, и окно-пет Орфеи.
// При сохранении остальные окна получают сигнал и применяют значения.

import { notifyAvatarTuningChanged } from "./channel";
import { DEFAULT_TUNING, type Tuning } from "./engine";

const KEY = "orpheus.avatar.tuning";

function readAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Сохранённые значения для модели или значения по умолчанию. */
export function loadTuning(fileName: string): Tuning {
  const raw = readAll()[fileName];
  const t = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    armDown: num(t.armDown, DEFAULT_TUNING.armDown, -1.5, 1.6),
    breath: num(t.breath, DEFAULT_TUNING.breath, 0, 0.05),
    autoBlink: typeof t.autoBlink === "boolean" ? t.autoBlink : DEFAULT_TUNING.autoBlink,
  };
}

/** Сохраняет значения для модели и сообщает об этом другим окнам. Возвращает false, если запись не удалась. */
export function saveTuning(fileName: string, tuning: Tuning): boolean {
  try {
    const all = readAll();
    all[fileName] = tuning;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить настройки модели.", err);
    return false;
  }
  notifyAvatarTuningChanged();
  return true;
}
