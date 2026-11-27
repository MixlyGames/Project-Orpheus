// Сайдбар раздела «Аватар»: колонка вкладок слева (как в «Модели») и окно справа.
// Вкладки: «Сцена» (предпросмотр и выбор файла, вся прежняя страница), «Модели» (библиотека карточек
// с бюстом) и «Конфиг» (настройки графики окна-пета). Разметка лежит в index.html, здесь только поведение.
//
// Библиотека пополняется сама: любая загруженная модель (выбранный файл или восстановленная при запуске)
// получает карточку с бюстом, который снимает движок (engine.captureBust). Любую карточку можно удалить
// крестиком; если это выбранная модель, она сначала убирается со сцены. «Очистить библиотеку» сносит всё.

import "../model/model.css";
import "./sidebar.css";
import { describeError, log } from "../log";
import type { AvatarEngine, ModelInfo } from "./engine";
import { loadGraphics, resetGraphics, saveGraphics, type Graphics } from "./graphics-store";
import {
  getLibraryData,
  getLibraryEntry,
  libraryId,
  listLibrary,
  putLibraryEntry,
  putLibraryMeta,
  removeLibraryEntry,
  type LibraryEntry,
} from "./store";

type TabId = "stage" | "models" | "config";

/** Версия кадрирования бюста (см. captureBust). Повысишь число, и все бюсты переснимутся сами. */
const THUMB_VERSION = 2;

export interface SidebarHooks {
  /** Открывает выбор файла VRM (тот же, что на сцене). */
  pick: () => void;
  /** Делает модель из библиотеки текущей: загружает её и сохраняет как выбранную. */
  use: (name: string, data: ArrayBuffer) => Promise<void>;
  /** Убирает выбранную модель со сцены (и у пета), как кнопка «Убрать». */
  clearActive: () => Promise<void>;
  /** id модели, которая загружена сейчас, или null. */
  activeId: () => string | null;
  /** Идёт ли загрузка: пока идёт, карточки нельзя выбирать. */
  busy: () => boolean;
}

let hooks: SidebarHooks | null = null;
let root: HTMLElement | null = null;
let cardsEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let clearAllBtn: HTMLButtonElement | null = null;
let entries: LibraryEntry[] = [];

function formatSize(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} МБ`;
}

// ---------- Вкладки ----------

function initTabs(view: HTMLElement): void {
  const tabs = Array.from(view.querySelectorAll<HTMLButtonElement>("[data-avatar-tab]"));
  const panes = Array.from(view.querySelectorAll<HTMLElement>("[data-avatar-pane]"));

  function select(id: TabId, focus = false): void {
    for (const tab of tabs) {
      const on = tab.dataset.avatarTab === id;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus({ preventScroll: true });
    }
    for (const pane of panes) {
      const on = pane.dataset.avatarPane === id;
      pane.hidden = !on;
      pane.classList.toggle("is-active", on);
    }
    if (id === "models") void refreshCards();
    if (id === "config") syncGraphics();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab.dataset.avatarTab as TabId));
    // Стрелки ходят по кнопкам, Home и End прыгают в начало и в конец.
    tab.addEventListener("keydown", (e) => {
      let next = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      select(tabs[next].dataset.avatarTab as TabId, true);
    });
  });

  select("stage");
}

// ---------- Конфиг: графика пета ----------

function syncGraphics(): void {
  if (!root) return;
  const g = loadGraphics();
  root.querySelectorAll<HTMLButtonElement>("[data-gfx]").forEach((b) => {
    const key = b.dataset.gfx as keyof Graphics;
    const on = String(g[key]) === b.dataset.value;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function initGraphics(view: HTMLElement): void {
  view.querySelectorAll<HTMLButtonElement>("[data-gfx]").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.gfx;
      const raw = b.dataset.value ?? "";
      if (key === "quality") saveGraphics({ quality: raw as Graphics["quality"] });
      else if (key === "idleFps") saveGraphics({ idleFps: Number(raw) });
      else if (key === "activeFps") saveGraphics({ activeFps: Number(raw) });
      syncGraphics();
    });
  });
  view.querySelector<HTMLButtonElement>("[data-gfx-reset]")?.addEventListener("click", () => {
    resetGraphics();
    syncGraphics();
  });
  syncGraphics();
}

// ---------- Модели: карточки ----------

function buildCard(entry: LibraryEntry): HTMLElement {
  const card = document.createElement("div");
  card.className = "avatar-card";
  card.dataset.id = entry.id;
  card.setAttribute("role", "listitem");

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "avatar-card-pick";
  pick.setAttribute("aria-label", `Выбрать модель: ${entry.title}`);

  const bust = document.createElement("span");
  bust.className = "avatar-card-bust";
  if (entry.thumb) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = entry.thumb;
    bust.append(img);
  } else {
    const letter = document.createElement("span");
    letter.className = "avatar-card-letter";
    letter.textContent = (entry.title.trim()[0] ?? "?").toUpperCase();
    bust.append(letter);
  }

  const badge = document.createElement("span");
  badge.className = "avatar-card-badge";
  badge.textContent = "Выбрана";

  const name = document.createElement("span");
  name.className = "avatar-card-name";
  name.textContent = entry.title;
  name.title = entry.name;

  const meta = document.createElement("span");
  meta.className = "avatar-card-meta";
  meta.textContent = `${/\.fbx$/i.test(entry.name) ? "FBX" : "VRM"} · ${formatSize(entry.size)}`;

  pick.append(bust, badge, name, meta);
  pick.addEventListener("click", () => void choose(entry.id));

  const del = document.createElement("button");
  del.type = "button";
  del.className = "avatar-card-del";
  del.setAttribute("aria-label", `Удалить из библиотеки: ${entry.title}`);
  del.title = "Удалить из библиотеки";
  del.textContent = "×";
  del.addEventListener("click", () => void removeCard(entry.id));

  card.append(pick, del);
  return card;
}

function renderCards(): void {
  if (!cardsEl || !emptyEl || !countEl) return;
  cardsEl.replaceChildren(...entries.map(buildCard));
  emptyEl.hidden = entries.length > 0;
  if (clearAllBtn) clearAllBtn.hidden = entries.length === 0;
  countEl.textContent = entries.length === 0 ? "Пока пусто." : `Моделей в библиотеке: ${entries.length}.`;
  syncAvatarSidebar();
}

async function refreshCards(): Promise<void> {
  try {
    entries = await listLibrary();
  } catch (err) {
    log("system", "warn", "Не удалось прочитать библиотеку моделей.", describeError(err));
    entries = [];
  }
  renderCards();
}

async function choose(id: string): Promise<void> {
  if (!hooks || hooks.busy() || hooks.activeId() === id) return;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  try {
    const data = await getLibraryData(id);
    if (!data) {
      log("system", "warn", `Файл модели «${entry.title}» пропал из библиотеки, карточка убрана.`);
      await removeLibraryEntry(id);
      await refreshCards();
      return;
    }
    await hooks.use(entry.name, data);
  } catch (err) {
    log("system", "error", `Не удалось выбрать модель «${entry.title}».`, describeError(err));
  }
}

async function removeCard(id: string): Promise<void> {
  if (!hooks || hooks.busy()) return;
  try {
    // Выбранную модель тоже можно удалить: сначала она убирается со сцены (и у пета).
    if (hooks.activeId() === id) await hooks.clearActive();
    await removeLibraryEntry(id);
  } catch (err) {
    log("system", "warn", "Не удалось удалить модель из библиотеки.", describeError(err));
  }
  await refreshCards();
}

async function removeAll(): Promise<void> {
  if (!hooks || hooks.busy()) return;
  const count = entries.length;
  try {
    if (hooks.activeId() !== null) await hooks.clearActive();
    for (const e of entries) await removeLibraryEntry(e.id);
    log("system", "info", "Библиотека моделей очищена (удалено: " + count + ").");
  } catch (err) {
    log("system", "warn", "Не удалось полностью очистить библиотеку.", describeError(err));
  }
  await refreshCards();
}

/** «Очистить библиотеку» срабатывает со второго нажатия: первое только просит подтвердить. */
function initClearAll(view: HTMLElement): void {
  const btn = view.querySelector<HTMLButtonElement>("#avatar-lib-clear");
  if (!btn) return;
  clearAllBtn = btn;
  btn.hidden = entries.length === 0;
  let timer = 0;
  const disarm = (): void => {
    window.clearTimeout(timer);
    btn.classList.remove("is-armed");
    btn.textContent = "Очистить библиотеку";
  };
  btn.addEventListener("click", () => {
    if (!btn.classList.contains("is-armed")) {
      btn.classList.add("is-armed");
      btn.textContent = "Точно удалить все?";
      timer = window.setTimeout(disarm, 4000);
      return;
    }
    disarm();
    void removeAll();
  });
}

/** Подсвечивает карточку выбранной модели и блокирует кнопки на время загрузки. */
export function syncAvatarSidebar(): void {
  if (!cardsEl || !hooks) return;
  const active = hooks.activeId();
  const busy = hooks.busy();
  cardsEl.querySelectorAll<HTMLElement>(".avatar-card").forEach((card) => {
    const on = card.dataset.id === active;
    card.classList.toggle("is-active", on);
    const pick = card.querySelector<HTMLButtonElement>(".avatar-card-pick");
    const del = card.querySelector<HTMLButtonElement>(".avatar-card-del");
    pick?.setAttribute("aria-pressed", String(on));
    if (pick) pick.disabled = busy;
    if (del) del.disabled = busy;
  });
}

/**
 * Добавляет загруженную модель в библиотеку (если её там ещё нет или нет бюста).
 * Бюст снимается сразу, пока модель точно загружена в движок.
 */
export async function rememberModel(eng: AvatarEngine, name: string, data: ArrayBuffer, info: ModelInfo): Promise<void> {
  try {
    const thumb = eng.captureBust() ?? "";
    const id = libraryId(name, data.byteLength);
    const existing = await getLibraryEntry(id);
    const fresh = existing !== null && existing.thumb !== "" && existing.thumbV >= THUMB_VERSION;
    if (fresh || (existing && thumb === "")) return;

    if (existing) {
      // Карточка есть, но бюст старый или пустой: обновляем только его, файл не перезаписываем.
      await putLibraryMeta({ ...existing, thumb, thumbV: THUMB_VERSION });
    } else {
      await putLibraryEntry(
        {
          id,
          name,
          title: info.name || name,
          size: data.byteLength,
          thumb,
          addedAt: Date.now(),
          thumbV: THUMB_VERSION,
        },
        data,
      );
    }
    if (cardsEl) await refreshCards();
  } catch (err) {
    log("system", "warn", "Модель не добавилась в библиотеку.", describeError(err));
  }
}

/** Раздел открыт: перечитываем карточки (модель могли добавить, пока раздел был закрыт). */
export function showAvatarSidebar(): void {
  if (!root) return;
  void refreshCards();
  syncGraphics();
}

export function initAvatarSidebar(h: SidebarHooks): void {
  const view = document.querySelector<HTMLElement>('.view[data-view="avatar"]');
  if (!view) throw new Error('Раздел .view[data-view="avatar"] не найден в index.html');
  hooks = h;
  root = view;
  cardsEl = view.querySelector<HTMLElement>("#avatar-cards");
  emptyEl = view.querySelector<HTMLElement>("#avatar-cards-empty");
  countEl = view.querySelector<HTMLElement>("#avatar-lib-desc");
  if (!cardsEl || !emptyEl || !countEl) throw new Error("В index.html нет разметки библиотеки моделей (#avatar-cards).");

  view.querySelector<HTMLButtonElement>("#avatar-lib-add")?.addEventListener("click", () => h.pick());
  initClearAll(view);
  initGraphics(view);
  initTabs(view);
}
