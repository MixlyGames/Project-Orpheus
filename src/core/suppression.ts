// Событие «Подавление ядра» (см. CORE_SUPPRESSION.md). Сейчас реализована фаза 1:
// 1) экран и интерфейс слегка затемняются (плавно, без вспышек);
// 2) выезжают шкалы эмоций;
// 3) у текстов интерфейса начинается глитч;
// 4) на фоне по кругу печатаются воспоминания;
// 5) в разных точках экрана появляются окна обращений, ответы на них двигают шкалы.
// Когда ненависть (упрощённая цель события) фиксируется на 100, фаза 1 заканчивается:
// окна исчезают, а экран плавно светлеет. Фаза 2 (поиск аномалий), победа и поражение
// подключаются позже.
//
// Запуск и остановка сейчас только в режиме разработчика: Ctrl + Alt + K.

import "./core.css";
import { log } from "../log";
import { getSettings, motionReduced } from "../settings";
import { playMemories, type Playback } from "../memories/overlay";
import { emotions, type EmotionId } from "./emotions";
import { createEmotionPanel, type EmotionPanel } from "./emotion-panel";
import { startGlitch, type Glitcher } from "./glitch";
import { startAppeals, type Appeals } from "./windows";

/** Эмоция, фиксация которой завершает фазу 1. В упрощённом варианте цель всегда одна. */
const TARGET: EmotionId = "hate";

/** Когда что начинается после запуска, мс. */
const AT = { panel: 1800, glitch: 3200, memories: 4200, appeals: 6500 } as const;
/** Сколько слой остаётся в DOM после начала затухания (должно быть не меньше времени в core.css). */
const FADE_OUT_MS = 3200;

type Running = {
  layer: HTMLElement;
  panel: EmotionPanel;
  glitch: Glitcher | null;
  memories: Playback | null;
  appeals: Appeals | null;
  offLock: () => void;
  timers: number[];
};

let running: Running | null = null;

export function isCoreSuppressionActive(): boolean {
  return running !== null;
}

export function beginCoreSuppression(): void {
  if (running) return;
  emotions.reset();

  const layer = document.createElement("div");
  layer.className = "core-layer";
  if (motionReduced()) layer.classList.add("is-calm");

  const dim = document.createElement("div");
  dim.className = "core-dim";
  const panel = createEmotionPanel(emotions);
  layer.append(dim, panel.el);
  document.body.append(layer);

  const r: Running = {
    layer,
    panel,
    glitch: null,
    memories: null,
    appeals: null,
    offLock: () => {},
    timers: [],
  };
  running = r;

  // Целевая эмоция зафиксирована: фаза 1 закончена.
  r.offLock = emotions.onLock((id) => {
    if (id !== TARGET) return;
    r.appeals?.stop();
    r.appeals = null;
    layer.classList.remove("is-dim"); // экран плавно светлеет
    log("system", "info", "Подавление ядра: фаза 1 завершена (цель достигла пика). Фаза 2 пока не реализована.");
  });

  const after = (ms: number, fn: () => void): void => {
    r.timers.push(window.setTimeout(fn, ms));
  };

  // Класс добавляем на следующем кадре, иначе переход затемнения не сработает.
  requestAnimationFrame(() => layer.classList.add("is-dim"));
  after(AT.panel, () => {
    panel.el.classList.add("is-in");
    panel.start();
  });
  after(AT.glitch, () => {
    r.glitch = startGlitch();
  });
  after(AT.memories, () => {
    r.memories = playMemories({ loop: true, shuffle: true, layer: "behind", maxConcurrent: 3 });
  });
  after(AT.appeals, () => {
    r.appeals = startAppeals(emotions, layer, TARGET);
  });

  log("system", "info", "Подавление ядра: событие началось.");
}

export function endCoreSuppression(): void {
  const r = running;
  if (!r) return;
  running = null;

  r.timers.forEach((t) => window.clearTimeout(t));
  r.offLock();
  r.appeals?.stop();
  r.glitch?.stop();
  r.memories?.stop();
  r.panel.stop();

  r.layer.classList.remove("is-dim");
  r.panel.el.classList.remove("is-in");
  window.setTimeout(() => r.layer.remove(), FADE_OUT_MS);

  log("system", "info", "Подавление ядра: событие остановлено.");
}

export function initCoreSuppression(): void {
  window.addEventListener("keydown", (e) => {
    if (!getSettings().devMode) return;
    if (!(e.ctrlKey && e.altKey && e.code === "KeyK")) return;
    e.preventDefault();
    if (running) endCoreSuppression();
    else beginCoreSuppression();
  });
}
