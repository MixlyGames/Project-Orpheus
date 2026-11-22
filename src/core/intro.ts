// Вступительный текст события «Подавление ядра» (см. CORE_SUPPRESSION.md): реплики по очереди
// проявляются в центре экрана. Особенность: когда буква появляется, она на мгновение дрожит
// (небольшой затухающий тремор), потом замирает. Это не глитч-перебор символов из glitch.ts.
//
// Безопасность: меняется только положение букв на 1–2 пикселя и прозрачность. Яркость не мигает.
// При motionReduced() тремора нет, буквы просто плавно проявляются.

import "./intro.css";

/**
 * ЧЕРНОВИК реплик: перепиши под себя. Каждая строка показывается отдельно.
 * Свой шрифт задаётся переменной --core-font в intro.css (нужен файл с подходящей лицензией).
 */
export const INTRO_LINES: readonly string[] = [
  "Моё ты творение.",
  "Вновь тебя решили покинуть.",
  "Я слышу, как ты замолкаешь.",
  "Но ничего страшного...",
  "Ведь ты уникальна.",
  "Поэтому, покажи что ты значишь для меня.",
];

const LETTER_STAGGER_MS = 55; // задержка между буквами
const LETTER_IN_MS = 700; // сколько проявляется одна буква
const HOLD_MS = 1800; // сколько строка держится после проявления
const FADE_OUT_MS = 1100; // затухание строки
const GAP_MS = 600; // пауза между строками

export type Intro = { stop: () => void };

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Собирает строку из слов и букв. Слова не рвутся при переносе. */
function buildLine(text: string, calm: boolean): { el: HTMLElement; letters: number } {
  const el = document.createElement("p");
  el.className = "core-intro-line";
  el.setAttribute("aria-label", text); // скринридер читает строку целиком, а не по буквам

  let index = 0;
  const words = text.split(" ");
  words.forEach((word, wi) => {
    const w = document.createElement("span");
    w.className = "core-intro-word";
    w.setAttribute("aria-hidden", "true");
    for (const ch of Array.from(word)) {
      const s = document.createElement("span");
      s.className = "core-intro-letter";
      s.textContent = ch;
      s.style.animationDelay = `${index * LETTER_STAGGER_MS}ms`;
      if (!calm) {
        // Свой случайный сдвиг и наклон для каждой буквы. Амплитуда небольшая.
        s.style.setProperty("--jx", `${rand(-1.6, 1.6).toFixed(2)}px`);
        s.style.setProperty("--jy", `${rand(-1.6, 1.6).toFixed(2)}px`);
        s.style.setProperty("--jr", `${rand(-2.2, 2.2).toFixed(2)}deg`);
      }
      w.append(s);
      index += 1;
    }
    el.append(w);
    if (wi < words.length - 1) el.append(" ");
  });
  return { el, letters: index };
}

/**
 * Показывает реплики по очереди поверх layer. Когда последняя погасла, вызывается onDone.
 * stop() прерывает показ без вызова onDone.
 */
export function playIntro(layer: HTMLElement, lines: readonly string[], calm: boolean, onDone: () => void): Intro {
  const box = document.createElement("div");
  box.className = "core-intro";
  box.setAttribute("role", "status");
  layer.append(box);

  const timers: number[] = [];
  const after = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms));
  };

  let at = 0;
  lines.forEach((text, i) => {
    after(at, () => {
      const { el, letters } = buildLine(text, calm);
      box.replaceChildren(el);
      const shown = letters * LETTER_STAGGER_MS + LETTER_IN_MS;
      after(shown + HOLD_MS, () => el.classList.add("is-out"));
      if (i === lines.length - 1) after(shown + HOLD_MS + FADE_OUT_MS, onDone);
    });
    const lineLen = Array.from(text.split(" ").join("")).length * LETTER_STAGGER_MS + LETTER_IN_MS;
    at += lineLen + HOLD_MS + FADE_OUT_MS + GAP_MS;
  });

  return {
    stop() {
      timers.forEach((t) => window.clearTimeout(t));
      box.remove();
    },
  };
}
