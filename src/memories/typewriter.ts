// Посимвольный вывод текста. Нужен для воспоминаний Орфеи, пригодится для любых «печатающихся» надписей.
// Если анимации выключены (в настройках или в системе), текст появляется сразу целиком.

import { motionReduced } from "../settings";

export type TypeOptions = {
  /** Средняя пауза между символами, мс. */
  speed?: number;
};

export type Typing = {
  /** Выполнится, когда текст допечатан, допечатан принудительно или печать остановлена. */
  done: Promise<void>;
  /** Мгновенно показывает весь текст. */
  finish: () => void;
  /** Останавливает печать на текущем месте. */
  cancel: () => void;
};

/** Дополнительная пауза после символа: на знаках препинания печать «задумывается». */
function pauseAfter(chars: string[], i: number, base: number): number {
  const ch = chars[i];
  const next = chars[i + 1];
  if (next === undefined) return 0;

  if (ch === "…") return base * 10;
  if (ch === ".") {
    if (next === ".") return base * 1.5; // внутри «...»
    return chars[i - 1] === "." ? base * 10 : base * 8;
  }
  if (ch === "!" || ch === "?") {
    return next === "!" || next === "?" ? base : base * 8;
  }
  if (ch === "," || ch === ";" || ch === ":" || ch === "—") return base * 4;
  return 0;
}

function jitter(base: number): number {
  return base * (0.7 + Math.random() * 0.6);
}

/** Печатает `text` в `target` по одному символу. Возвращает управление печатью. */
export function typeInto(target: HTMLElement, text: string, options: TypeOptions = {}): Typing {
  const base = Math.max(8, options.speed ?? 95);
  const chars = Array.from(text); // по символам, а не по кодовым единицам: эмодзи не рвутся
  let shown = 0;
  let timer = 0;
  let settled = false;
  let resolve: () => void = () => {};
  const done = new Promise<void>((r) => {
    resolve = r;
  });

  const render = (): void => {
    target.textContent = chars.slice(0, shown).join("");
  };

  const settle = (): void => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    resolve();
  };

  const step = (): void => {
    shown += 1;
    render();
    if (shown >= chars.length) {
      settle();
      return;
    }
    timer = window.setTimeout(step, jitter(base) + pauseAfter(chars, shown - 1, base));
  };

  target.textContent = "";

  if (chars.length === 0 || motionReduced()) {
    shown = chars.length;
    render();
    settle();
  } else {
    timer = window.setTimeout(step, base);
  }

  return {
    done,
    finish: () => {
      if (settled) return;
      shown = chars.length;
      render();
      settle();
    },
    cancel: settle,
  };
}
