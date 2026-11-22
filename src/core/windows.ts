// Окна обращений для фазы 1 события «Подавление ядра» (см. CORE_SUPPRESSION.md).
// В разных точках экрана плавно появляется небольшое окно: фрагмент воспоминания Орфеи и три способа
// ответить. Выбор сдвигает окна значений шкал эмоций (emotions.ts). Если не ответить до конца
// таймера, это тоже ответ: окно гаснет и тоже влияет на шкалы.
// Своя механика, а не копия чьей-то игры: никаких процентов успеха и характеристик, только последствия.
//
// Безопасность: окно проявляется и гаснет плавно, таймер это линия, которая линейно сжимается.
// При motionReduced() окно не «подъезжает», а просто проявляется, и времени на ответ больше.

import { log } from "../log";
import { getMemories } from "../memories/store";
import { motionReduced } from "../settings";
import { type EmotionId, type EmotionModel } from "./emotions";

type Effect = { id: EmotionId; dir: "up" | "down"; step: number };
type Choice = { label: string; effects: Effect[] };

const CHOICES: readonly Choice[] = [
  {
    label: "Сказать правду",
    effects: [
      { id: "hate", dir: "up", step: 15 },
      { id: "trust", dir: "up", step: 10 },
    ],
  },
  {
    label: "Промолчать",
    effects: [
      { id: "hate", dir: "up", step: 10 },
      { id: "sorrow", dir: "up", step: 10 },
    ],
  },
  {
    label: "Утешить",
    effects: [
      { id: "hate", dir: "down", step: 10 },
      { id: "joy", dir: "up", step: 10 },
    ],
  },
];

/** Что происходит, если не ответить вовремя. */
const IGNORED: readonly Effect[] = [
  { id: "hate", dir: "up", step: 10 },
  { id: "fear", dir: "up", step: 10 },
];

const MAX_OPEN = 2;
const FADE_OUT_MS = 500;
const SPAWN_EVERY: [number, number] = [5000, 8500];

export type Appeals = { stop: () => void };

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickPhrase(): string {
  const list = getMemories().filter((s) => s.trim() !== "");
  return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : "...";
}

/**
 * Запускает показ окон обращений поверх layer.
 * target: эмоция, которая запускает следующую фазу. Только она может зафиксироваться на 100.
 */
export function startAppeals(model: EmotionModel, layer: HTMLElement, target: EmotionId): Appeals {
  const calm = motionReduced();
  const lifetime = calm ? 24_000 : 14_000;

  const open = new Map<HTMLElement, number>(); // окно -> id его таймера
  let spawnTimer = 0;
  let stopped = false;
  let counter = 0;

  const apply = (effects: readonly Effect[]): void => {
    for (const e of effects) {
      if (e.dir === "up") model.raise(e.id, e.step, e.id === target);
      else model.lower(e.id, e.step);
    }
  };

  const close = (win: HTMLElement, effects: readonly Effect[] | null): void => {
    const timer = open.get(win);
    if (timer === undefined) return; // уже закрывается
    window.clearTimeout(timer);
    open.delete(win);
    if (effects) apply(effects);
    win.classList.add("is-out");
    win.querySelectorAll("button").forEach((b) => (b.disabled = true));
    window.setTimeout(() => win.remove(), FADE_OUT_MS);
  };

  /** Из нескольких случайных точек берёт самую далёкую от уже открытых окон. */
  const pickSpot = (): { left: number; top: number } => {
    const taken = Array.from(open.keys()).map((w) => ({
      left: parseFloat(w.style.left),
      top: parseFloat(w.style.top),
    }));
    let best = { left: rand(6, 56), top: rand(14, 62) };
    let bestDist = -1;
    for (let i = 0; i < 8; i++) {
      const c = { left: rand(6, 56), top: rand(14, 62) };
      const d = taken.reduce((m, t) => Math.min(m, Math.hypot(t.left - c.left, t.top - c.top)), Infinity);
      if (d > bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  };

  const spawn = (): void => {
    counter += 1;
    const win = document.createElement("section");
    win.className = "core-win";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", `Обращение ${counter}`);

    const spot = pickSpot();
    win.style.left = `${spot.left}%`;
    win.style.top = `${spot.top}%`;
    // С какой стороны окно «подплывает»: у каждого своя, но смещение небольшое.
    win.style.setProperty("--dx", `${calm ? 0 : Math.round(rand(-28, 28))}px`);
    win.style.setProperty("--dy", `${calm ? 0 : Math.round(rand(-22, 22))}px`);

    const tag = document.createElement("p");
    tag.className = "core-win-tag";
    tag.textContent = `Обращение ${String(counter).padStart(2, "0")}`;

    const text = document.createElement("p");
    text.className = "core-win-text";
    text.textContent = pickPhrase();

    const actions = document.createElement("div");
    actions.className = "core-win-actions";
    for (const choice of CHOICES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "core-win-btn";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        log("system", "debug", `Подавление ядра: выбор «${choice.label}».`);
        close(win, choice.effects);
      });
      actions.append(btn);
    }

    const timer = document.createElement("div");
    timer.className = "core-win-timer";
    const bar = document.createElement("i");
    bar.style.transition = `transform ${lifetime}ms linear`;
    timer.append(bar);

    win.append(tag, text, actions, timer);
    layer.append(win);

    // Проявление и запуск таймера на следующем кадре, чтобы сработали переходы.
    requestAnimationFrame(() => {
      win.classList.add("is-in");
      bar.style.transform = "scaleX(0)";
    });

    open.set(
      win,
      window.setTimeout(() => {
        log("system", "debug", "Подавление ядра: обращение осталось без ответа.");
        close(win, IGNORED);
      }, lifetime),
    );
  };

  const scheduleNext = (): void => {
    spawnTimer = window.setTimeout(() => {
      if (stopped) return;
      if (open.size < MAX_OPEN) spawn();
      scheduleNext();
    }, rand(SPAWN_EVERY[0], SPAWN_EVERY[1]));
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      window.clearTimeout(spawnTimer);
      // Закрываем без последствий для шкал.
      Array.from(open.keys()).forEach((w) => close(w, null));
    },
  };
}
