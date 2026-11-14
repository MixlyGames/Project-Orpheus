// Плашка «Получено достижение» (как в Steam): появляется справа сверху, держится несколько секунд.
// Если достижения выдаются подряд, плашки показываются по очереди, а не друг на друге.

import "./achievements.css";
import type { Achievement } from "./data";
import { iconSvg } from "./icons";

const SHOW_MS = 6000;
const OUT_MS = 400;

const queue: Achievement[] = [];
let showing = false;
let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host) return host;
  host = document.createElement("div");
  host.className = "ach-toasts";
  host.setAttribute("aria-live", "polite");
  document.body.append(host);
  return host;
}

function text(tag: "p", className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}

function buildToast(a: Achievement): HTMLElement {
  const card = document.createElement("div");
  card.className = "ach-toast";

  const ico = document.createElement("span");
  ico.className = "ach-toast-ico";
  ico.append(iconSvg(a.icon));

  const body = document.createElement("div");
  body.className = "ach-toast-text";
  body.append(
    text("p", "ach-toast-kicker", "Получено достижение"),
    text("p", "ach-toast-title", a.title),
    text("p", "ach-toast-desc", a.description),
  );

  card.append(ico, body);
  return card;
}

function next(): void {
  const a = queue.shift();
  if (!a) {
    showing = false;
    return;
  }
  showing = true;
  const card = buildToast(a);
  ensureHost().append(card);
  requestAnimationFrame(() => card.classList.add("is-in"));
  window.setTimeout(() => {
    card.classList.remove("is-in");
    window.setTimeout(() => {
      card.remove();
      next();
    }, OUT_MS);
  }, SHOW_MS);
}

export function showAchievementToast(a: Achievement): void {
  queue.push(a);
  if (!showing) next();
}
