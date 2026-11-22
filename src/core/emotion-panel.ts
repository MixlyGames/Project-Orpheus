// Панель «Отношения»: вертикальные шкалы эмоций, которые постоянно «прыгают» внутри своего окна значений
// (см. emotions.ts). Это просто DOM-элемент: где он лежит, решает вызывающий код. Сейчас его
// монтирует событие подавления ядра, позже он переедет во вкладку «Власть».
//
// Безопасность: каждый столбик меняет значение сам по себе, не чаще раза в 0,45 с, а между
// значениями идёт плавный CSS-переход. Никаких резких смен яркости. При motionReduced()
// значения обновляются заметно реже.

import { motionReduced } from "../settings";
import { EMOTIONS, type EmotionId, type EmotionModel } from "./emotions";

export type EmotionPanel = {
  el: HTMLElement;
  start: () => void;
  stop: () => void;
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function createEmotionPanel(model: EmotionModel): EmotionPanel {
  const el = document.createElement("section");
  el.className = "core-emotions";
  el.setAttribute("aria-hidden", "true"); // постоянно меняющиеся шкалы скринридеру не нужны

  const title = document.createElement("p");
  title.className = "core-emotions-title";
  title.textContent = "Отношения";

  const bars = document.createElement("div");
  bars.className = "core-bars";

  const fills = new Map<EmotionId, HTMLElement>();
  for (const e of EMOTIONS) {
    const col = document.createElement("div");
    col.className = "core-bar";
    col.dataset.emotion = e.id;

    const track = document.createElement("div");
    track.className = "core-bar-track";
    const fill = document.createElement("div");
    fill.className = "core-bar-fill";
    track.append(fill);

    const label = document.createElement("span");
    label.className = "core-bar-label";
    label.textContent = e.label;

    col.append(track, label);
    bars.append(col);
    fills.set(e.id, fill);
  }
  el.append(title, bars);

  const timers = new Map<EmotionId, number>();
  let running = false;

  const paint = (id: EmotionId): void => {
    fills.get(id)?.style.setProperty("--v", String(model.sample(id) / 100));
  };

  const schedule = (id: EmotionId): void => {
    const [min, max] = motionReduced() ? [1400, 2200] : [450, 800];
    timers.set(
      id,
      window.setTimeout(() => {
        if (!running) return;
        paint(id);
        schedule(id);
      }, rand(min, max)),
    );
  };

  return {
    el,
    start() {
      if (running) return;
      running = true;
      for (const e of EMOTIONS) {
        paint(e.id);
        // Столбики не синхронны: у каждого свой первый тик.
        timers.set(e.id, window.setTimeout(() => schedule(e.id), rand(0, 400)));
      }
    },
    stop() {
      running = false;
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    },
  };
}
