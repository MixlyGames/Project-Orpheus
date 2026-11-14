// Единый журнал приложения: события Орфеи, чата и системы.
// У каждой записи есть понятный человеку текст и необязательные технические детали:
// их показывает режим разработчика во вкладке «Дебаггер».

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "system" | "chat" | "orphea";

export interface LogEntry {
  id: number;
  time: number;
  source: LogSource;
  level: LogLevel;
  /** Что произошло, простым языком. */
  message: string;
  /** Технические подробности (стек, адреса, коды): только для режима разработчика. */
  details?: string;
}

/** null означает «журнал очищен». */
type Listener = (entry: LogEntry | null) => void;

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

export function log(source: LogSource, level: LogLevel, message: string, details?: string): void {
  const entry: LogEntry = { id: nextId++, time: Date.now(), source, level, message };
  if (details) entry.details = details;

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  listeners.forEach((l) => l(entry));

  // Проблемы дублируем в консоль WebView (она нужна при разработке).
  if (level === "error") console.error(`[${source}] ${message}`, details ?? "");
  else if (level === "warn") console.warn(`[${source}] ${message}`, details ?? "");
}

export function getLogs(): readonly LogEntry[] {
  return entries;
}

export function clearLogs(): void {
  entries.length = 0;
  listeners.forEach((l) => l(null));
}

export function onLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Превращает ошибку любого вида в текст для технических деталей. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? `${err.name}: ${err.message}\n${err.stack}` : `${err.name}: ${err.message}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

let installed = false;

/** Ловит ошибки, которые никто не обработал, и кладёт их в журнал. */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (e) => {
    // Эту ошибку браузер показывает при обычном изменении размера окна, она безвредна.
    if (e.message?.startsWith("ResizeObserver loop")) return;
    const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "";
    const stack = e.error ? describeError(e.error) : "";
    log(
      "system",
      "error",
      `Ошибка в интерфейсе: ${e.message || "причина неизвестна"}`,
      [where, stack].filter(Boolean).join("\n"),
    );
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    if (reason instanceof DOMException && reason.name === "AbortError") return;
    const text = reason instanceof Error ? reason.message : String(reason);
    log("system", "error", `Сбой в фоновой задаче: ${text}`, describeError(reason));
  });
}
