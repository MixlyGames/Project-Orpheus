// Воспоминания Орфеи: фразы печатаются по буквам в случайных местах экрана под небольшим углом,
// как в играх Project Moon (Lobotomy Corporation, Library of Ruina). Это не кат-сцена:
// экран не затемняется, интерфейс остаётся рабочим, а текст живёт на фоне и по очереди гаснет.
// Вызов: `const p = playMemories({ loop: true }); ... p.stop();` или `await p.done;` для одного прохода.

import "./memories.css";
import { log } from "../log";
import { getMemories } from "./store";
import { typeInto, type Typing } from "./typewriter";

export type PlayOptions = {
  /** Что показывать. По умолчанию текущий список из хранилища. */
  phrases?: string[];
  /** Средняя пауза между символами, мс. */
  speed?: number;
  /**
   * Где лежит текст. behind: под интерфейсом, на фоне (по умолчанию).
   * front: поверх интерфейса, но клики проходят сквозь него.
   */
  layer?: "behind" | "front";
  /** Повторять список по кругу, пока не вызван stop(). Для сцены подавления ядра. */
  loop?: boolean;
  /** Перемешивать порядок фраз (при loop каждый круг заново). */
  shuffle?: boolean;
  /** Пауза между появлениями фраз после окончания печати, мс: [минимум, максимум]. */
  gap?: [number, number];
  /** Максимальное количество одновременно отображаемых фраз (по умолчанию 3) */
  maxConcurrent?: number;
};

export type Playback = {
  /** Выполнится, когда все фразы показаны и погасли (или после stop()). */
  done: Promise<void>;
  /** Останавливает показ: недописанные фразы гаснут. */
  stop: () => void;
};

const FADE_MS = 1400;
const TITLEBAR_H = 44;
const EDGE = 28; // отступ текста от краёв окна, px
const SPOT_TRIES = 10;

type Line = {
  el: HTMLElement;
  x: number;
  y: number;
  typing: Typing | null;
  /** Досрочно заканчивает «удержание» и запускает затухание. */
  release: () => void;
};

let active: Playback | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function holdFor(phrase: string): number {
  return Math.min(5000, Math.max(1800, 1400 + Array.from(phrase).length * 55));
}

function shuffled<T>(list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function createLayer(kind: "behind" | "front"): HTMLElement {
  const layer = node("div", `mem-layer is-${kind}`);
  layer.setAttribute("aria-hidden", "true"); // фоновый декор: скринридеру не нужен

  if (kind === "behind") {
    // Сразу после фона: интерфейс (.stage, .app, панель) лежит выше, текст виден сквозь стекло.
    const bg = document.querySelector(".bg");
    if (bg) bg.after(layer);
    else document.body.prepend(layer);
  } else {
    document.body.append(layer);
  }
  return layer;
}

/** Выбирает центр для строки: из нескольких случайных точек берёт самую далёкую от уже видимых строк. */
function pickSpot(
  boxW: number,
  boxH: number,
  angleDeg: number,
  others: readonly Line[],
): { x: number; y: number } {
  const rad = (Math.abs(angleDeg) * Math.PI) / 180;
  const bw = boxW * Math.cos(rad) + boxH * Math.sin(rad); // размер с учётом наклона
  const bh = boxW * Math.sin(rad) + boxH * Math.cos(rad);

  const minX = EDGE + bw / 2;
  const maxX = window.innerWidth - EDGE - bw / 2;
  const minY = TITLEBAR_H + EDGE + bh / 2;
  const maxY = window.innerHeight - EDGE - bh / 2;

  // Если строка шире окна, ставим по центру.
  const pickX = (): number => (maxX > minX ? rand(minX, maxX) : window.innerWidth / 2);
  const pickY = (): number => (maxY > minY ? rand(minY, maxY) : window.innerHeight / 2);

  let best = { x: pickX(), y: pickY() };
  let bestDist = -1;

  for (let i = 0; i < SPOT_TRIES; i++) {
    const c = { x: pickX(), y: pickY() };
    const dist = others.reduce((m, o) => Math.min(m, Math.hypot(o.x - c.x, o.y - c.y)), Infinity);
    if (dist > bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

export function playMemories(options: PlayOptions = {}): Playback {
  active?.stop();

  const phrases = (options.phrases ?? getMemories()).map((s) => s.trim()).filter((s) => s !== "");
  if (phrases.length === 0) {
    log("system", "warn", "Воспоминания: нечего показывать, список фраз пуст.");
    return { done: Promise.resolve(), stop: () => {} };
  }

  const layer = createLayer(options.layer ?? "behind");
  const lines = new Set<Line>();
  const lives: Promise<void>[] = [];

  let stopped = false;
  let wakeGap: (() => void) | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    lines.forEach((l) => {
      l.typing?.cancel();
      l.release();
    });
    wakeGap?.();
  };

  /** Создаёт строку в случайном месте и начинает печатать. Возвращает, когда печать закончена. */
  const spawn = (phrase: string): Promise<void> => {
    const el = node("p", "mem-line");
    const text = node("span", "mem-text");
    const caret = node("span", "mem-caret");
    el.append(text, caret);

    // Сначала невидимо выставляем полный текст, чтобы узнать размер: во время печати
    // рамка не должна «прыгать» и менять переносы строк.
    el.style.visibility = "hidden";
    text.textContent = phrase;
    caret.hidden = true;
    layer.append(el);

    const w = Math.ceil(el.offsetWidth) + 10;
    const h = Math.ceil(el.offsetHeight);
    const mag = rand(5, 15);
    const angle = Math.random() < 0.5 ? -mag : mag;
    const spot = pickSpot(w, h, angle, [...lines]);

    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.left = `${spot.x}px`;
    el.style.top = `${spot.y}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(2)}deg)`;
    el.style.visibility = "";
    caret.hidden = false;

    let release: () => void = () => {};
    const line: Line = { el, x: spot.x, y: spot.y, typing: null, release: () => release() };
    lines.add(line);

    const typing = typeInto(text, phrase, { speed: options.speed });
    line.typing = typing;

    const life = (async (): Promise<void> => {
      await typing.done;
      caret.remove();
      line.typing = null;

      if (!stopped) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, holdFor(phrase));
          release = () => {
            window.clearTimeout(timer);
            resolve();
          };
        });
      }

      el.classList.add("is-out");
      await sleep(FADE_MS);
      el.remove();
      lines.delete(line);
    })();
    lives.push(life);

    return typing.done;
  };

  const maxConcurrent = options.maxConcurrent ?? 2; // Сколько фраз могут печататься/висеть одновременно
  const spawnInterval = options.gap ?? [400, 900]; // Пауза между появлениями новых строк

  const run = async (): Promise<void> => {
    do {
      const round = options.shuffle ? shuffled(phrases) : phrases;
      
      for (const phrase of round) {
        if (stopped) break;

        // Если активных строк уже слишком много, ждём, пока какая-нибудь освободится
        while (lines.size >= maxConcurrent && !stopped) {
          await sleep(100);
        }
        if (stopped) break;

        // Запускаем спавн фразы АВТОНОМНО (без await), чтобы она жила своей жизнью
        spawn(phrase).catch(() => {});

        // Пауза перед появлением следующей строки
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, rand(spawnInterval[0], spawnInterval[1]));
          wakeGap = () => {
            window.clearTimeout(timer);
            resolve();
          };
        });
        wakeGap = null;
      }

      // Если loop выключен, ждём завершения оставшихся на экране строк перед выходом из do-while
      if (!options.loop) {
        while (lines.size > 0 && !stopped) {
          await sleep(100);
        }
      }
    } while (options.loop && !stopped);

    // Дожидаемся завершения всех затуханий
    await Promise.allSettled(lives);
  };

  const done = run()
    .catch((err: unknown) => {
      log("system", "error", "Воспоминания: показ прервался из-за ошибки.", String(err));
    })
    .finally(() => {
      layer.remove();
      if (active === playback) active = null;
    });

  const playback: Playback = { done, stop };
  active = playback;
  log("system", "debug", `Воспоминания: показ ${phrases.length} фраз${options.loop ? " по кругу" : ""}.`);
  return playback;
}
