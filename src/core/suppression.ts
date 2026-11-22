// Событие «Подавление ядра» (см. CORE_SUPPRESSION.md). Сейчас реализовано вступление фазы 1:
// 1) экран и интерфейс слегка затемняются (плавно, без вспышек);
// 2) по центру по очереди проявляются реплики (с небольшим тремором при появлении);
// 3) после последней реплики медленно выезжают шкалы эмоций;
// 4) начинается глитч текстов интерфейса, потом воспоминания на фоне.
// Механика самой фазы 1 (что делает игрок) ещё не выбрана, окна обращений отключены флагом.
// Когда ненависть (упрощённая цель события) фиксируется на 100, фаза 1 заканчивается:
// экран плавно светлеет. Фаза 2, победа и поражение подключаются позже.
//
// Запуск и остановка сейчас только в режиме разработчика: Ctrl + Alt + K.

import "./core.css";
import { log } from "../log";
import { getSettings, motionReduced } from "../settings";
import { playMemories, type Playback } from "../memories/overlay";
import { emotions, type EmotionId } from "./emotions";
import { createEmotionPanel, type EmotionPanel } from "./emotion-panel";
import { startGlitch, type Glitcher } from "./glitch";
import { INTRO_LINES, playIntro, type Intro } from "./intro";
import { startAppeals, type Appeals } from "./windows";

/** Эмоция, фиксация которой завершает фазу 1. В упрощённом варианте цель всегда одна. */
const TARGET: EmotionId = "hate";

/** Окна обращений признаны неудачными: код оставлен, но не запускается, пока не решим механику. */
const USE_APPEALS = false;

/** Когда начинается вступительный текст после запуска, мс (дождаться затемнения). */
const INTRO_AT = 2200;
/** Что начинается после того, как погасла последняя реплика, мс. */
const AFTER_INTRO = { panel: 800, glitch: 6300, memories: 8000, appeals: 10_000 } as const;
/** Сколько слой остаётся в DOM после начала затухания (должно быть не меньше времени в core.css). */
const FADE_OUT_MS = 3200;

type Running = {
  layer: HTMLElement;
  panel: EmotionPanel;
  intro: Intro | null;
  glitch: Glitcher | null;
  memories: Playback | null;
  appeals: Appeals | null;
  offLock: () => void;
  timers: number[];
};

let running: Running | null = null;

const listeners = new Set<() => void>();

/** Подписка на запуск и остановку события (для кнопок управления). Возвращает функцию отписки. */
export function onCoreSuppressionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((l) => l());
}

export function isCoreSuppressionActive(): boolean {
  return running !== null;
}

export function beginCoreSuppression(): void {
  if (running) return;
  emotions.reset();

  const calm = motionReduced();
  const layer = document.createElement("div");
  layer.className = "core-layer";
  if (calm) layer.classList.add("is-calm");

  const dim = document.createElement("div");
  dim.className = "core-dim";
  const panel = createEmotionPanel(emotions);
  layer.append(dim, panel.el);
  document.body.append(layer);

  const r: Running = {
    layer,
    panel,
    intro: null,
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

  // После вступления: шкалы, глитч, воспоминания.
  const startMain = (): void => {
    after(AFTER_INTRO.panel, () => {
      panel.el.classList.add("is-in");
      panel.start();
    });
    after(AFTER_INTRO.glitch, () => {
      r.glitch = startGlitch();
    });
    after(AFTER_INTRO.memories, () => {
      r.memories = playMemories({ loop: true, shuffle: true, layer: "behind", maxConcurrent: 3 });
    });
    if (USE_APPEALS) {
      after(AFTER_INTRO.appeals, () => {
        r.appeals = startAppeals(emotions, layer, TARGET);
      });
    }
  };

  // Класс добавляем на следующем кадре, иначе переход затемнения не сработает.
  requestAnimationFrame(() => layer.classList.add("is-dim"));
  after(INTRO_AT, () => {
    r.intro = playIntro(layer, INTRO_LINES, calm, startMain);
  });

  log("system", "info", "Подавление ядра: событие началось.");
  notify();
}

export function endCoreSuppression(): void {
  const r = running;
  if (!r) return;
  running = null;

  r.timers.forEach((t) => window.clearTimeout(t));
  r.offLock();
  r.intro?.stop();
  r.appeals?.stop();
  r.glitch?.stop();
  r.memories?.stop();
  r.panel.stop();

  r.layer.classList.remove("is-dim");
  r.panel.el.classList.remove("is-in");
  window.setTimeout(() => r.layer.remove(), FADE_OUT_MS);

  log("system", "info", "Подавление ядра: событие остановлено.");
  notify();
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
