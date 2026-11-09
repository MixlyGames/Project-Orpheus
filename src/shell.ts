import "./shell.css";
import { fakeProvider } from "./llm";
import * as store from "./store";
import { getSettings, onSettings, updateSettings, type NavPosition } from "./settings";

// ---------- Разделы ----------

export type ViewId = "chat" | "history" | "avatar" | "control" | "settings";

const VIEW_ORDER: ViewId[] = ["chat", "history", "avatar", "control", "settings"];

export type ShellHooks = {
  getNickname: () => string;
  getAbout: () => string;
  onEditProfile: () => void;
};

let hooks: ShellHooks = {
  getNickname: () => "",
  getAbout: () => "",
  onEditProfile: () => {},
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} не найден в index.html`);
  return el as T;
}

const dock = byId<HTMLElement>("dock");
const dockThumb = byId<HTMLElement>("dock-thumb");
const dockBtns = Array.from(dock.querySelectorAll<HTMLButtonElement>(".dock-btn"));

const viewEls = new Map<ViewId, HTMLElement>();
document.querySelectorAll<HTMLElement>(".view").forEach((el) => {
  viewEls.set(el.dataset.view as ViewId, el);
});

const historySearch = byId<HTMLInputElement>("history-search");
const historyList = byId<HTMLElement>("history-list");
const historyEmpty = byId<HTMLElement>("history-empty");
const historyStart = byId<HTMLButtonElement>("history-start");

const ctlProvider = byId<HTMLElement>("ctl-provider");

const setAva = byId<HTMLElement>("set-ava");
const setName = byId<HTMLElement>("set-name");
const setAbout = byId<HTMLElement>("set-about");
const editProfileBtn = byId<HTMLButtonElement>("edit-profile");
const segBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-nav-pos]"));
const optLabels = byId<HTMLButtonElement>("opt-labels");
const clearBtn = byId<HTMLButtonElement>("clear-chats");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let current: ViewId = "chat";
let started = false;
const viewListeners = new Set<(v: ViewId) => void>();

export function currentView(): ViewId {
  return current;
}

export function onView(listener: (v: ViewId) => void): void {
  viewListeners.add(listener);
}

// ---------- «Капля» под активной кнопкой ----------

type Rect = { left: number; top: number; width: number; height: number };
let thumbRect: Rect | null = null;

function measure(): Rect | null {
  const btn = dockBtns.find((b) => b.dataset.view === current);
  if (!btn) return null;
  return {
    left: btn.offsetLeft,
    top: btn.offsetTop,
    width: btn.offsetWidth,
    height: btn.offsetHeight,
  };
}

function keyframe(r: Rect): Keyframe {
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  };
}

function placeThumb(animate: boolean): void {
  const next = measure();
  if (!next) return;
  const prev = thumbRect;
  thumbRect = next;

  Object.assign(dockThumb.style, {
    left: `${next.left}px`,
    top: `${next.top}px`,
    width: `${next.width}px`,
    height: `${next.height}px`,
  });

  if (!animate || !prev || reduceMotion.matches) return;

  // На полпути капля растягивается на обе кнопки, а затем «перетекает» в новую.
  const left = Math.min(prev.left, next.left);
  const top = Math.min(prev.top, next.top);
  const right = Math.max(prev.left + prev.width, next.left + next.width);
  const bottom = Math.max(prev.top + prev.height, next.top + next.height);
  const mid: Rect = { left, top, width: right - left, height: bottom - top };

  dockThumb.animate([keyframe(prev), { ...keyframe(mid), offset: 0.5 }, keyframe(next)], {
    duration: 520,
    easing: "cubic-bezier(0.65, 0, 0.25, 1)",
  });
}

// ---------- Переключение разделов ----------

export function showView(id: ViewId): void {
  const prev = current;
  const dir = VIEW_ORDER.indexOf(id) >= VIEW_ORDER.indexOf(prev) ? 1 : -1;
  // Ось сдвига совпадает с положением панели: сверху едем вбок, слева вертикально.
  const axis = document.body.dataset.nav === "top" ? "X" : "Y";
  current = id;

  viewEls.forEach((el, key) => {
    const active = key === id;

    if (started && prev !== id) {
      if (active) {
        el.style.transition = "none";
        el.style.transform = `translate${axis}(${dir * 16}px)`;
        void el.offsetWidth;
        el.style.transition = "";
        el.style.transform = "";
      } else if (key === prev) {
        el.style.transform = `translate${axis}(${-dir * 16}px)`;
      }
    }

    el.classList.toggle("is-active", active);
    el.inert = !active;
    el.setAttribute("aria-hidden", String(!active));
  });

  dockBtns.forEach((b) => {
    const active = b.dataset.view === id;
    b.classList.toggle("is-active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  placeThumb(started && prev !== id);
  started = true;

  if (id === "history") renderHistory();
  viewListeners.forEach((l) => l(id));
}

dockBtns.forEach((b) => {
  b.addEventListener("click", () => showView(b.dataset.view as ViewId));
});

// Ctrl + 1…5: быстрый переход между разделами.
document.addEventListener("keydown", (e) => {
  if (!document.body.classList.contains("is-chat")) return;
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
  if (!/^[1-5]$/.test(e.key)) return;
  e.preventDefault();
  showView(VIEW_ORDER[Number(e.key) - 1]);
});

export function enableShell(on: boolean): void {
  dock.inert = !on;
  dock.setAttribute("aria-hidden", String(!on));
}

// ---------- История ----------

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function snippet(chat: store.Chat): string {
  const last = [...chat.messages].reverse().find((m) => m.content.trim() !== "");
  if (!last) return "Пустой чат";
  const text = last.content.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function renderHistory(): void {
  const q = historySearch.value.trim().toLowerCase();
  const all = [...store.getChats()].sort((a, b) => b.updatedAt - a.updatedAt);
  const list = q
    ? all.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
    : all;

  historyList.replaceChildren();
  historyEmpty.hidden = list.length > 0;
  historyEmpty.querySelector(".empty-note")!.textContent =
    all.length === 0 ? "Здесь появятся твои разговоры." : "Ничего не найдено.";
  historyStart.hidden = all.length > 0;

  for (const c of list) {
    const card = document.createElement("article");
    card.className = "hcard";
    card.classList.toggle("is-active", c.id === store.getActiveId());

    const open = document.createElement("button");
    open.type = "button";
    open.className = "hcard-open";

    const title = document.createElement("span");
    title.className = "hcard-title";
    title.textContent = c.title;

    const text = document.createElement("span");
    text.className = "hcard-snippet";
    text.textContent = snippet(c);

    const count = c.messages.filter((m) => m.content !== "").length;
    const meta = document.createElement("span");
    meta.className = "hcard-meta";
    meta.textContent = `${dateFmt.format(c.updatedAt)} · ${count} ${plural(count, "сообщение", "сообщения", "сообщений")}`;

    open.append(title, text, meta);
    open.addEventListener("click", () => {
      store.setActive(c.id);
      showView("chat");
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "hcard-del";
    del.setAttribute("aria-label", "Удалить чат");
    del.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>';
    del.addEventListener("click", () => store.removeChat(c.id));

    card.append(open, del);
    historyList.append(card);
  }
}

historySearch.addEventListener("input", renderHistory);
historyStart.addEventListener("click", () => {
  store.setActive(null);
  showView("chat");
});

store.subscribe((e) => {
  if (e !== "list") return;
  if (current === "history") renderHistory();
  clearBtn.disabled = store.getChats().length === 0;
});

// ---------- Настройки ----------

export function refreshProfile(): void {
  const nick = hooks.getNickname().trim();
  const about = hooks.getAbout().trim();
  setName.textContent = nick || "Без имени";
  setAva.textContent = (Array.from(nick)[0] ?? "?").toUpperCase();
  setAbout.textContent = about || "Описание не заполнено.";
}

function applySettings(): void {
  const s = getSettings();
  document.body.dataset.nav = s.navPosition;
  document.body.classList.toggle("nav-no-labels", !s.navLabels);

  segBtns.forEach((b) => {
    const on = b.dataset.navPos === s.navPosition;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  optLabels.setAttribute("aria-checked", String(s.navLabels));

  // Размеры панели поменялись: ставим каплю на место без анимации.
  requestAnimationFrame(() => placeThumb(false));
}

function setNavPosition(pos: NavPosition): void {
  if (pos === getSettings().navPosition) return;
  // Панель коротко гаснет, перепрыгивает на новое место и появляется снова.
  dock.classList.add("is-switching");
  window.setTimeout(
    () => {
      updateSettings({ navPosition: pos });
      requestAnimationFrame(() => dock.classList.remove("is-switching"));
    },
    reduceMotion.matches ? 0 : 200,
  );
}

segBtns.forEach((b) => {
  b.addEventListener("click", () => setNavPosition(b.dataset.navPos as NavPosition));
});

optLabels.addEventListener("click", () => {
  updateSettings({ navLabels: !getSettings().navLabels });
});

editProfileBtn.addEventListener("click", () => hooks.onEditProfile());

// Очистка истории: двухшаговая, чтобы не стереть всё случайно.
let clearTimer = 0;

function resetClear(): void {
  window.clearTimeout(clearTimer);
  clearBtn.classList.remove("is-confirm");
  clearBtn.textContent = "Очистить";
}

clearBtn.addEventListener("click", () => {
  if (!clearBtn.classList.contains("is-confirm")) {
    clearBtn.classList.add("is-confirm");
    clearBtn.textContent = "Точно очистить?";
    clearTimer = window.setTimeout(resetClear, 3000);
    return;
  }
  resetClear();
  store.clearChats();
});

onSettings(applySettings);

// ---------- Запуск ----------

export function initShell(h: ShellHooks): void {
  hooks = h;
  ctlProvider.textContent = fakeProvider.name;
  clearBtn.disabled = store.getChats().length === 0;
  applySettings();
  refreshProfile();
  showView("chat");
  window.addEventListener("resize", () => placeThumb(false));
  void document.fonts?.ready.then(() => placeThumb(false));
}
