// Оверлей воспоминаний: затемняет экран и по очереди печатает на нём фразы Орфеи.
// Используется для предпросмотра (Настройки → «Воспоминания Орфеи») и позже для сцены подавления ядра.
// Вызов: `const p = playMemories({ skippable: false }); await p.done;` или `p.stop()`.

import "./memories.css";
import { log } from "../log";
import { getMemories } from "./store";
import { typeInto, type Typing } from "./typewriter";

export type PlayOptions = {
  /** Что показывать. По умолчанию текущий список из хранилища. */
  phrases?: string[];
  /** Можно ли пропускать клавишами и кликом, закрывать по Esc. Для сюжетной сцены ставь false. */
  skippable?: boolean;
  /** Средняя пауза между символами, мс. */
  speed?: number;
};

export type Playback = {
  /** Выполнится, когда оверлей закрыт и убран. */
  done: Promise<void>;
  /** Закрывает оверлей досрочно. */
  stop: () => void;
};

const OVERLAY_FADE_MS = 600;
const LINE_FADE_MS = 450;
const GAP_MS = 350;

let active: Playback | null = null;

function holdFor(phrase: string): number {
  return Math.min(4500, Math.max(1400, 1100 + Array.from(phrase).length * 45));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

export function playMemories(options: PlayOptions = {}): Playback {
  active?.stop();

  const phrases = (options.phrases ?? getMemories()).map((s) => s.trim()).filter((s) => s !== "");
  const skippable = options.skippable ?? true;

  if (phrases.length === 0) {
    log("system", "warn", "Воспоминания: нечего показывать, список фраз пуст.");
    return { done: Promise.resolve(), stop: () => {} };
  }

  const overlay = node("div", "mem-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Воспоминание Орфеи");

  const line = node("p", "mem-line");
  const text = node("span", "mem-text");
  const caret = node("span", "mem-caret");
  text.setAttribute("aria-hidden", "true");
  caret.setAttribute("aria-hidden", "true");
  line.append(text, caret);

  // Для скринридера фраза объявляется целиком один раз, а не по буквам.
  const sr = node("span", "mem-sr");
  sr.setAttribute("aria-live", "polite");

  overlay.append(line, sr);

  if (skippable) {
    const hint = node("p", "mem-hint");
    hint.textContent = "Клик — дальше · Esc — закрыть";
    overlay.append(hint);
  }

  let stopped = false;
  let typing: Typing | null = null;
  let wake: (() => void) | null = null;

  /** Ожидание, которое можно прервать пропуском. */
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const finish = (): void => {
        window.clearTimeout(timer);
        wake = null;
        resolve();
      };
      const timer = window.setTimeout(finish, ms);
      wake = finish;
    });

  const advance = (): void => {
    if (!skippable) return;
    if (typing) typing.finish();
    else wake?.();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    typing?.cancel();
    wake?.();
  };

  const onKey = (e: KeyboardEvent): void => {
    // Пока идут воспоминания, сочетания клавиш приложения не работают.
    e.stopPropagation();
    if (e.key === "Tab") e.preventDefault();
    if (!skippable) return;
    if (e.key === "Escape") {
      e.preventDefault();
      stop();
    } else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      advance();
    }
  };

  overlay.addEventListener("click", advance);
  document.addEventListener("keydown", onKey, true);
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.append(overlay);

  const run = async (): Promise<void> => {
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    await wait(OVERLAY_FADE_MS);

  for (const phrase of phrases) {
  if (stopped) break;

  line.classList.remove("is-out");
  sr.textContent = phrase;

  // --- случайная позиция и наклон ---
  const padX = 8;
  const padY = 12;
  line.style.left = `${padX + Math.random() * (100 - padX * 2)}%`;
  line.style.top  = `${padY + Math.random() * (100 - padY * 2)}%`;
  const mag = 5 + Math.random() * 10;
  const angle = (Math.random() < 0.5 ? -mag : mag).toFixed(2);
  line.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

  typing = typeInto(text, phrase, { speed: options.speed });
      await typing.done;
      typing = null;
      if (stopped) break;

      await wait(holdFor(phrase));
      if (stopped) break;

      line.classList.add("is-out");
      await wait(LINE_FADE_MS);
      if (stopped) break;
      await wait(GAP_MS);
    }

    overlay.classList.remove("is-in");
    await sleep(OVERLAY_FADE_MS);
  };

  const done = run()
    .catch((err: unknown) => {
      log("system", "error", "Воспоминания: показ прервался из-за ошибки.", String(err));
    })
    .finally(() => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (active === playback) active = null;
    });

  const playback: Playback = { done, stop };
  active = playback;
  log("system", "debug", `Воспоминания: показ ${phrases.length} фраз.`);
  return playback;
}
