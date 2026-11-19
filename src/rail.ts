// Рейка слева в разделе «Чат»: один элемент #rail. Свёрнутая показывает иконки,
// а по кнопке со звездой (#rail-toggle) растёт в панель с подписями и списком чатов
// поверх чата.
//
// Два режима (data-mode на .chat-wrap):
//   chat: обычный чат. Кнопки: звезда, «Пустота», «Новый чат». Есть список чатов.
//   stub: экран «Пустота». Кнопки: звезда, «Чат». Списка чатов нет.
// Какие кнопки видны в каком режиме, решает CSS по [data-rail-mode] (см. rail.css),
// здесь только состояние и поведение.
// «Пустота» это временное название: что там будет, решим позже.

import "./rail.css";
import * as store from "./store";
import { onView } from "./shell";

type RailMode = "chat" | "stub";

const LABEL_OPEN = "Открыть панель чатов";
const LABEL_CLOSE = "Закрыть панель чатов";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} не найден в index.html`);
  return el as T;
}

const wrap = byId<HTMLElement>("chat-wrap");
const chatEl = byId<HTMLElement>("chat");
const stubPane = byId<HTMLElement>("stub-pane");
const rail = byId<HTMLElement>("rail");
const toggleBtn = byId<HTMLButtonElement>("rail-toggle");
const list = byId<HTMLElement>("rail-list");
const composer = byId<HTMLTextAreaElement>("composer-input");

const chatsBox: HTMLElement = (() => {
  const el = rail.querySelector<HTMLElement>(".rail-chats");
  if (!el) throw new Error(".rail-chats не найден внутри #rail");
  return el;
})();

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
  // Список перерисовывается целиком: запоминаем фокус и прокрутку, чтобы они не «прыгали»,
  // когда чат обновился, пока рейка открыта.
  const focusedId = document.activeElement?.closest<HTMLElement>(".rail-chat")?.dataset.id;
  const scrollTop = list.scrollTop;

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
    btn.dataset.id = c.id;
    btn.classList.toggle("is-active", c.id === activeId);
    if (c.id === activeId) btn.setAttribute("aria-current", "true");

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

  list.scrollTop = scrollTop;
  if (focusedId) {
    const again = Array.from(list.querySelectorAll<HTMLElement>(".rail-chat")).find(
      (el) => el.dataset.id === focusedId,
    );
    again?.focus({ preventScroll: true });
  }
}

// Стрелки вверх и вниз ходят по списку чатов, Home и End прыгают в начало и в конец.
list.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const items = Array.from(list.querySelectorAll<HTMLElement>(".rail-chat"));
  if (items.length === 0) return;

  const at = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = items.length - 1;
  else if (e.key === "ArrowDown") next = at < 0 ? 0 : Math.min(at + 1, items.length - 1);
  else next = at < 0 ? items.length - 1 : Math.max(at - 1, 0);

  e.preventDefault();
  items[next].focus();
});

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

  // Если фокус был в списке, вернём его на звезду до того, как список станет inert,
  // иначе он пропадёт совсем.
  if (!on && chatsBox.contains(document.activeElement)) {
    toggleBtn.focus({ preventScroll: true });
  }

  wrap.classList.toggle("is-rail-open", on);
  chatsBox.inert = !on;
  toggleBtn.setAttribute("aria-expanded", String(on));
  toggleBtn.setAttribute("aria-label", on ? LABEL_CLOSE : LABEL_OPEN);

  if (on) renderList();
}

toggleBtn.addEventListener("click", () => setOpen(!open));

// Клик вне рейки и Esc закрывают её.
document.addEventListener("pointerdown", (e) => {
  if (open && e.target instanceof Node && !rail.contains(e.target)) setOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !open) return;
  e.preventDefault();
  setOpen(false);
});

// ---------- Кнопки действий ----------

rail.querySelectorAll<HTMLElement>("[data-rail-go]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const go = btn.dataset.railGo;
    setOpen(false);

    if (go === "stub") {
      setMode("stub");
      // Нажатая кнопка в режиме «Пустота» скрывается, поэтому фокус переносим на звезду.
      toggleBtn.focus({ preventScroll: true });
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

// Открылся другой чат (например из раздела «История»): с экрана «Пустота» возвращаемся в чат.
store.subscribe((e) => {
  if (e === "active") setMode("chat");
  if (open) renderList();
});

// Ушли из раздела «Чат»: рейка не должна остаться раскрытой.
onView((v) => {
  if (v !== "chat") setOpen(false);
});

export function initRail(): void {
  setMode("chat");
  // Начальное состояние берём не из разметки, а выставляем явно.
  wrap.classList.remove("is-rail-open");
  chatsBox.inert = true;
  toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.setAttribute("aria-label", LABEL_OPEN);
}
