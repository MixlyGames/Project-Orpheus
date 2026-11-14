// Вкладка «Дебаггер»: лента журнала (см. log.ts), фильтры, копирование и режим разработчика.

import { clearLogs, getLogs, onLog, type LogEntry, type LogLevel, type LogSource } from "./log";
import { getSettings, onSettings, updateSettings } from "./settings";

const SOURCE_LABEL: Record<LogSource, string> = {
  system: "Система",
  chat: "Чат",
  orphea: "Орфея",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "Отладка",
  info: "Инфо",
  warn: "Внимание",
  error: "Ошибка",
};

type SourceFilter = "all" | LogSource;
type LevelFilter = "all" | "problems";

const MAX_ROWS = 500;

let listEl: HTMLElement;
let emptyEl: HTMLElement;
let devSwitch: HTMLButtonElement;
let copyBtn: HTMLButtonElement;
let sourceFilter: SourceFilter = "all";
let levelFilter: LevelFilter = "all";
let lastDev = false;
let copyTimer = 0;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
}

/** Подходит ли запись под фильтры. Отладочные записи видны только разработчику. */
function isVisible(e: LogEntry): boolean {
  if (e.level === "debug" && !getSettings().devMode) return false;
  if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
  if (levelFilter === "problems" && e.level !== "warn" && e.level !== "error") return false;
  return true;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const base = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return getSettings().devMode ? `${base}.${String(d.getMilliseconds()).padStart(3, "0")}` : base;
}

function buildRow(e: LogEntry): HTMLElement {
  const row = document.createElement("div");
  row.className = "dbg-row";
  row.dataset.level = e.level;

  const time = document.createElement("span");
  time.className = "dbg-time";
  time.textContent = fmtTime(e.time);

  const tag = document.createElement("span");
  tag.className = "dbg-tag";
  tag.dataset.source = e.source;
  tag.textContent = SOURCE_LABEL[e.source];

  const msg = document.createElement("p");
  msg.className = "dbg-msg";
  msg.textContent = e.message;

  row.append(time, tag, msg);

  if (e.details && getSettings().devMode) {
    const pre = document.createElement("pre");
    pre.className = "dbg-details";
    pre.textContent = e.details;
    row.append(pre);
  }
  return row;
}

function updateEmpty(shown: number): void {
  if (shown > 0) {
    emptyEl.hidden = true;
    return;
  }
  emptyEl.hidden = false;
  emptyEl.textContent =
    getLogs().length === 0
      ? "Пока тихо. Здесь появятся события приложения, чата и Орфеи."
      : "Под выбранные фильтры ничего не подходит.";
}

function scrollToEnd(): void {
  listEl.scrollTop = listEl.scrollHeight;
}

function render(): void {
  const rows = getLogs().filter(isVisible).map(buildRow);
  listEl.replaceChildren(...rows);
  updateEmpty(rows.length);
  scrollToEnd();
}

function onEntry(entry: LogEntry | null): void {
  if (entry === null) {
    render();
    return;
  }
  if (!isVisible(entry)) return;

  // Если пользователь листает вверх, ленту не дёргаем.
  const stick = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
  listEl.append(buildRow(entry));
  while (listEl.childElementCount > MAX_ROWS) listEl.firstElementChild?.remove();
  updateEmpty(listEl.childElementCount);
  if (stick) scrollToEnd();
}

function bindSeg(selector: string, key: "dbgSource" | "dbgLevel", apply: (value: string) => void): void {
  const btns = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
  btns.forEach((b) => {
    if (b.getAttribute("aria-pressed") === "true") b.classList.add("is-on");
    b.addEventListener("click", () => {
      apply(b.dataset[key] ?? "all");
      btns.forEach((x) => {
        const on = x === b;
        x.classList.toggle("is-on", on);
        x.setAttribute("aria-pressed", String(on));
      });
      render();
    });
  });
}

function flashCopy(text: string): void {
  window.clearTimeout(copyTimer);
  copyBtn.textContent = text;
  copyTimer = window.setTimeout(() => {
    copyBtn.textContent = "Копировать";
  }, 1600);
}

async function copyVisible(): Promise<void> {
  const dev = getSettings().devMode;
  const text = getLogs()
    .filter(isVisible)
    .map((e) => {
      const head = `[${fmtTime(e.time)}] [${SOURCE_LABEL[e.source]}] [${LEVEL_LABEL[e.level]}] ${e.message}`;
      return dev && e.details ? `${head}\n${e.details}` : head;
    })
    .join("\n");
  if (!text) {
    flashCopy("Нечего копировать");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    flashCopy("Скопировано");
  } catch {
    flashCopy("Не удалось");
  }
}

export function initDebug(): void {
  listEl = byId("dbg-list");
  emptyEl = byId("dbg-empty");
  devSwitch = byId("opt-dev");
  copyBtn = byId("dbg-copy");
  const clearBtn = byId<HTMLButtonElement>("dbg-clear");

  bindSeg("[data-dbg-source]", "dbgSource", (v) => (sourceFilter = v as SourceFilter));
  bindSeg("[data-dbg-level]", "dbgLevel", (v) => (levelFilter = v as LevelFilter));

  lastDev = getSettings().devMode;
  devSwitch.setAttribute("aria-checked", String(lastDev));
  devSwitch.addEventListener("click", () => updateSettings({ devMode: !getSettings().devMode }));
  onSettings(() => {
    const dev = getSettings().devMode;
    devSwitch.setAttribute("aria-checked", String(dev));
    if (dev !== lastDev) {
      lastDev = dev;
      render(); // режим разработчика меняет состав и вид записей
    }
  });

  copyBtn.addEventListener("click", () => void copyVisible());
  clearBtn.addEventListener("click", () => clearLogs());

  onLog(onEntry);
  render();
}

/** Вызывается при открытии вкладки: листаем ленту к последним записям. */
export function refreshDebug(): void {
  scrollToEnd();
}
