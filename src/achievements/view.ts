// Раздел «Достижения»: список со статусами.
// В режиме разработчика у каждого есть кнопка «Выдать»,
// а сверху «Сбросить все»: так удобно проверять плашку и вид списка.

import "./achievements.css";
import { describeError, log } from "../log";
import { getSettings, onSettings } from "../settings";
import { ACHIEVEMENTS, type Achievement } from "./data";
import { hasIcon, iconSvg } from "./icons";
import {
  isUnlocked,
  onAchievementsChange,
  resetAchievements,
  unlockAchievement,
  unlockedAt,
  unlockedCount,
} from "./store";

let ready = false;
let list: HTMLElement;
let subtitle: HTMLElement;
let tools: HTMLElement;
let resetBtn: HTMLButtonElement;
let resetTimer = 0;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (content) node.textContent = content;
  return node;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildCard(a: Achievement, dev: boolean): HTMLElement {
  const got = isUnlocked(a.id);
  const hidden = a.secret === true && !got;

  const card = el("div", "ach-card");
  card.dataset.state = got ? "unlocked" : "locked";

  const ico = el("span", "ach-ico");
  ico.append(iconSvg(hidden ? "lock" : a.icon));

  const body = el("div", "ach-body");

  body.append(
    el("p", "ach-title", hidden ? "Секретное достижение" : a.title),
    el(
      "p",
      "ach-desc",
      hidden
        ? "Описание откроется, когда достижение будет получено."
        : a.description,
    ),
  );

  const when = unlockedAt(a.id);

  if (got && when !== null) {
    body.append(el("p", "ach-date", `Получено ${formatDate(when)}`));
  }

  card.append(ico, body);

  if (dev && !got) {
    const give = el("button", "btn", "Выдать");
    give.type = "button";
    give.addEventListener("click", () => unlockAchievement(a.id));
    card.append(give);
  }

  return card;
}

/** Карточка, которая не может сломать весь список: при ошибке рисуется запасная, а причина идёт в «Дебаггер». */
function safeCard(a: Achievement, dev: boolean): HTMLElement {
  try {
    return buildCard(a, dev);
  } catch (err) {
    log("system", "error", `Не удалось нарисовать достижение «${a.id}».`, describeError(err));
    const fallback = el("div", "ach-card", `Достижение «${a.id}»: ошибка отображения (подробности в «Дебаггере»).`);
    fallback.dataset.state = "locked";
    return fallback;
  }
}

/** Проверяет data.ts и пишет понятные предупреждения в «Дебаггер» вместо поломок. */
function validateAchievements(): void {
  const seen = new Set<string>();
  for (const a of ACHIEVEMENTS) {
    if (!a.id) {
      log("system", "warn", "В списке достижений есть запись без id (src/achievements/data.ts).");
    }
    if (seen.has(a.id)) {
      log(
        "system",
        "warn",
        `Достижения: id «${a.id}» повторяется, такие достижения будут выдаваться вместе. Поменяй id у одного из них.`,
      );
    }
    seen.add(a.id);
    if (!hasIcon(a.icon)) {
      log(
        "system",
        "warn",
        `Достижение «${a.id}»: нет иконки «${a.icon}» в src/achievements/icons.ts, показана запасная.`,
      );
    }
  }
}

function render(): void {
  if (!ready) return;

  const dev = getSettings().devMode;

  tools.hidden = !dev;
  subtitle.textContent = `Получено ${unlockedCount()} из ${ACHIEVEMENTS.length}.`;

  list.replaceChildren(...ACHIEVEMENTS.map((a) => safeCard(a, dev)));
}

function resetConfirm(): void {
  window.clearTimeout(resetTimer);
  resetBtn.classList.remove("is-confirm");
  resetBtn.textContent = "Сбросить все";
}

export function initAchievementsView(): void {
  list = byId("ach-list");
  subtitle = byId("ach-subtitle");
  tools = byId("ach-tools");
  resetBtn = byId("ach-reset");

  validateAchievements();

  // Сброс двухшаговый, чтобы не стереть прогресс случайно.
  resetBtn.addEventListener("click", () => {
    if (!resetBtn.classList.contains("is-confirm")) {
      resetBtn.classList.add("is-confirm");
      resetBtn.textContent = "Точно сбросить?";
      resetTimer = window.setTimeout(resetConfirm, 3000);
      return;
    }

    resetConfirm();
    resetAchievements();
  });

  onAchievementsChange(render);
  onSettings(render);

  ready = true;
  render();
}

export function refreshAchievementsView(): void {
  render();
}