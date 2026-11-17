// Рейка слева в разделе «Чат»: свёрнутая панель из иконок, которая разворачивается
// в плавающую панель с подписями и списком чатов.
//
// Два режима (data-mode на .chat-wrap):
//   chat: обычный чат. Кнопки: развернуть, «Заглушка», «Новый чат».
//   stub: экран «Заглушка». Кнопки: развернуть, «Чат».
// «Заглушка» это временное название: что там будет, решим позже.

import "./rail.css";
import * as store from "./store";
import { onView } from "./shell";

type RailMode = "chat" | "stub";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} не найден в index.html`);
  return el as T;
}

const wrap = byId<HTMLElement>("chat-wrap");
const chatEl = byId<HTMLElement>("chat");
const stubPane = byId<HTMLElement>("stub-pane");
const panel = byId<HTMLElement>("rail-panel");
const expandBtn = byId<HTMLButtonElement>("rail-expand");
const collapseBtn = byId<HTMLButtonElement>("rail-collapse");
const list = byId<HTMLElement>("rail-list");
const composer = byId<HTMLTextAreaElement>("composer-input");

let mode: RailMode = "chat";
let open = false;

// ---------- Время рядом с чатом ----------

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

/** «только что», «5 мин назад», «2 ч назад», «Вчера», дальше дата. */
function ago(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (ts >= today.getTime()) return `${Math.floor(minutes / 60)} ч назад`;
  if (ts >= today.getTime() - 86_400_000) return "Вчера";
  return dateFmt.format(ts);
}

// ---------- Список чатов ----------

function renderList(): void {
  const chats = [...store.getChats()].sort((a, b) => b.updatedAt - a.updatedAt);
  list.replaceChildren();

  if (chats.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rail-empty";
    empty.textContent = "Здесь появятся твои разговоры.";
    list.append(empty);
    return;
  }

  const activeId = store.getActiveId();
  for (const c of chats) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rail-chat";
    btn.classList.toggle("is-active", c.id === activeId);

    const title = document.createElement("span");
    title.className = "rail-chat-title";
    title.textContent = c.title;

    const time = document.createElement("span");
    time.className = "rail-chat-time";
    time.textContent = ago(c.updatedAt);

    btn.append(title, time);
    btn.addEventListener("click", () => {
      store.setActive(c.id);
      setMode("chat");
      setOpen(false);
      focusComposer();
    });
    list.append(btn);
  }
}

// ---------- Режим ----------

function setMode(next: RailMode): void {
  mode = next;
  wrap.dataset.mode = next;
  const stub = next === "stub";
  chatEl.inert = stub;
  stubPane.inert = !stub;
  stubPane.setAttribute("aria-hidden", String(!stub));
}

function focusComposer(): void {
  if (mode === "chat") composer.focus({ preventScroll: true });
}

// ---------- Раскрытие панели ----------

function setOpen(on: boolean): void {
  if (on === open) return;
  open = on;
  wrap.classList.toggle("is-rail-open", on);
  panel.inert = !on;
  panel.setAttribute("aria-hidden", String(!on));
  expandBtn.setAttribute("aria-expanded", String(on));

  if (on) {
    renderList();
    collapseBtn.focus({ preventScroll: true });
  } else if (panel.contains(document.activeElement)) {
    expandBtn.focus({ preventScroll: true });
  }
}

expandBtn.addEventListener("click", () => setOpen(true));
collapseBtn.addEventListener("click", () => setOpen(false));

// Клик вне панели и Esc закрывают её.
document.addEventListener("pointerdown", (e) => {
  if (open && e.target instanceof Node && !panel.contains(e.target)) setOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !open) return;
  e.preventDefault();
  setOpen(false);
});

// ---------- Кнопки действий (и в рейке, и в панели) ----------

wrap.querySelectorAll<HTMLElement>("[data-rail-go]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const go = btn.dataset.railGo;
    setOpen(false);

    if (go === "stub") {
      setMode("stub");
      expandBtn.focus({ preventScroll: true });
    } else if (go === "chat") {
      setMode("chat");
      focusComposer();
    } else if (go === "new") {
      store.setActive(null);
      setMode("chat");
      focusComposer();
    }
  });
});

// ---------- Связь с остальным приложением ----------

// Открылся другой чат (например из раздела «История»): с экрана «Заглушка» возвращаемся в чат.
store.subscribe((e) => {
  if (e === "active") setMode("chat");
  if (open) renderList();
});

// Ушли из раздела «Чат»: панель не должна остаться висеть открытой.
onView((v) => {
  if (v !== "chat") setOpen(false);
});

export function initRail(): void {
  setMode("chat");
}
