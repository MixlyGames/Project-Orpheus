// Редактор воспоминаний (Настройки → «Воспоминания Орфеи», виден в режиме разработчика):
// правка списка фраз, сохранение, предпросмотр показа на экране.

import { playMemories, type Playback } from "./overlay";
import {
  getMemories,
  hasCustomMemories,
  memoriesToText,
  parseMemoryText,
  resetMemories,
  setMemories,
} from "./store";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function initMemoriesDev(): void {
  const editor = byId<HTMLTextAreaElement>("mem-editor");
  const count = byId<HTMLElement>("mem-count");
  const status = byId<HTMLElement>("mem-status");
  const playBtn = byId<HTMLButtonElement>("mem-play");
  const saveBtn = byId<HTMLButtonElement>("mem-save");
  const resetBtn = byId<HTMLButtonElement>("mem-reset");
  const frontSwitch = byId<HTMLButtonElement>("mem-front");

  let playing: Playback | null = null;
  let front = false;
  let statusTimer = 0;
  let resetTimer = 0;

  const isDirty = (): boolean => {
    const typed = parseMemoryText(editor.value);
    const saved = getMemories();
    return typed.length !== saved.length || typed.some((p, i) => p !== saved[i]);
  };

  const baseStatus = (): string => {
    if (isDirty()) return "Есть несохранённые изменения";
    return hasCustomMemories() ? "Свой список" : "Стандартный список";
  };

  const refreshMeta = (): void => {
    const n = parseMemoryText(editor.value).length;
    count.textContent = `${n} ${plural(n, "фраза", "фразы", "фраз")}`;
    if (!statusTimer) {
      status.classList.remove("is-warn");
      status.textContent = baseStatus();
    }
  };

  /** Короткое сообщение вместо обычного статуса. */
  const flash = (message: string, warn = false): void => {
    window.clearTimeout(statusTimer);
    status.classList.toggle("is-warn", warn);
    status.textContent = message;
    statusTimer = window.setTimeout(() => {
      statusTimer = 0;
      refreshMeta();
    }, 2500);
  };

  const loadEditor = (): void => {
    editor.value = memoriesToText(getMemories());
    refreshMeta();
  };

  editor.addEventListener("input", refreshMeta);

  saveBtn.addEventListener("click", () => {
    if (!setMemories(parseMemoryText(editor.value))) {
      flash("Нужна хотя бы одна фраза", true);
      return;
    }
    loadEditor(); // показываем уже очищенный список: без пустых строк и лишних пробелов
    flash("Сохранено");
  });

  // Предпросмотр берёт текст из редактора, даже несохранённый: так удобно подбирать формулировки.
  const setPlaying = (on: boolean): void => {
    playBtn.textContent = on ? "Остановить" : "Показать";
  };

  playBtn.addEventListener("click", () => {
    if (playing) {
      playing.stop();
      return;
    }
    const phrases = parseMemoryText(editor.value);
    if (phrases.length === 0) {
      flash("Нечего показывать: список пуст", true);
      return;
    }
    const p = playMemories({ phrases, layer: front ? "front" : "behind" });
    playing = p;
    setPlaying(true);
    void p.done.then(() => {
      if (playing === p) {
        playing = null;
        setPlaying(false);
      }
    });
  });

  frontSwitch.addEventListener("click", () => {
    front = !front;
    frontSwitch.setAttribute("aria-checked", String(front));
  });

  // Возврат к стандартным двухшаговый: свои фразы так просто не потерять.
  const clearResetConfirm = (): void => {
    window.clearTimeout(resetTimer);
    resetBtn.classList.remove("is-confirm");
    resetBtn.textContent = "Вернуть стандартные";
  };

  resetBtn.addEventListener("click", () => {
    if (!resetBtn.classList.contains("is-confirm")) {
      resetBtn.classList.add("is-confirm");
      resetBtn.textContent = "Точно вернуть?";
      resetTimer = window.setTimeout(clearResetConfirm, 3000);
      return;
    }
    clearResetConfirm();
    resetMemories();
    loadEditor();
    flash("Возвращены стандартные");
  });

  loadEditor();
}
