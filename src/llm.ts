// Интерфейс провайдера LLM. Новый провайдер: реализовать `stream` и добавить его
// в `providerFor` внизу файла. Выбор хранится в настройках (`provider`).

import type { ProviderKind } from "./settings";
import { log } from "./log";

export type Role = "user" | "assistant";

export interface Source {
  title: string;
  url: string;
  snippet: string;
}

/** Шаг ленты инструментов над ответом (пока только поиск в интернете). */
export interface SearchStep {
  id: string;
  status: "running" | "done" | "failed";
  query: string;
  sources: Source[];
  /** Короткая причина неудачи, понятная человеку. */
  reason?: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Шаги поиска, которые Орфея сделала перед ответом. */
  trace?: SearchStep[];
  /** Сколько миллисекунд в сумме заняли поиски. */
  traceMs?: number;
}

export interface LLMProvider {
  readonly name: string;
  /**
   * Потоково отдаёт куски ответа. При abort бросает DOMException("AbortError").
   * onStep получает шаги инструментов (поиск), если провайдер умеет их показывать.
   */
  stream(
    messages: ChatMessage[],
    signal: AbortSignal,
    onStep?: (step: SearchStep) => void,
  ): AsyncGenerator<string, void, void>;
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Данные о шагах приходят от сервера и из localStorage, поэтому проверяем всё, что читаем.

function parseSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): Source[] => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url : "";
    if (!isHttpUrl(url)) return [];
    return [
      {
        title: typeof o.title === "string" ? o.title : "",
        url,
        snippet: typeof o.snippet === "string" ? o.snippet : "",
      },
    ];
  });
}

/** live: идущий поиск остаётся «running». У сохранённых сообщений незавершённый шаг считаем неудачным. */
export function parseStep(value: unknown, live: boolean): SearchStep | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const status: SearchStep["status"] =
    o.status === "done" || o.status === "failed" ? o.status : live ? "running" : "failed";
  return {
    id: o.id,
    status,
    query: typeof o.query === "string" ? o.query : "",
    sources: parseSources(o.sources),
    reason: typeof o.reason === "string" ? o.reason : undefined,
  };
}

export function normalizeTrace(value: unknown): SearchStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): SearchStep[] => {
    const step = parseStep(v, false);
    return step ? [step] : [];
  });
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------- Заглушка: печатает ответ по буквам ----------

function buildReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const quoted = last.length > 140 ? `${last.slice(0, 140)}…` : last;
  return (
    "Привет! Сейчас я работаю как заглушка: настоящая модель ещё не подключена, " +
    "зато потоковый вывод уже можно проверить.\n\n" +
    `Ты написал: «${quoted}»\n\n` +
    "Когда подключим LLM, здесь появится настоящий ответ."
  );
}

export const fakeProvider: LLMProvider = {
  name: "Заглушка",
  async *stream(messages, signal) {
    // Короткая пауза «подумать», чтобы был виден индикатор набора.
    await sleep(650, signal);

    const chars = Array.from(buildReply(messages));
    let i = 0;
    while (i < chars.length) {
      const size = 1 + Math.floor(Math.random() * 3);
      const chunk = chars.slice(i, i + size).join("");
      i += size;
      yield chunk;
      await sleep(14 + Math.random() * 20, signal);
    }
  },
};

// ---------- Орфея: Python-сервер по WebSocket ----------
// Сервер: orphea_server.py в PyCharm-проекте Orpheus, протокол описан в начале того файла.

/** Ошибка провайдера с текстом, который не стыдно показать в чате. */
export class ProviderError extends Error {}

const ORPHEA_URL = "ws://127.0.0.1:8765/chat";

type Incoming =
  | { kind: "token"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "closed" }
  | { kind: "aborted" };

export const orpheaProvider: LLMProvider = {
  name: "Орфея",
  async *stream(messages, signal, onStep) {
    if (signal.aborted) throw abortError();

    const reqId = crypto.randomUUID();
    const queue: Incoming[] = [];
    let wake: (() => void) | null = null;
    let opened = false;

    const push = (item: Incoming): void => {
      queue.push(item);
      wake?.();
      wake = null;
    };

    let ws: WebSocket;
    try {
      log("orphea", "debug", "Подключаюсь к серверу Орфеи.", ORPHEA_URL);
      ws = new WebSocket(ORPHEA_URL);
    } catch {
      throw new ProviderError("Не удалось открыть соединение с сервером Орфеи.");
    }

    ws.onopen = () => {
      opened = true;
      log("orphea", "debug", "Соединение открыто, отправляю историю чата.", `Реплик: ${messages.length}`);
      // На сервер уходит только роль и текст, без шагов поиска.
      const plain = messages.map(({ role, content }) => ({ role, content }));
      ws.send(JSON.stringify({ type: "chat", id: reqId, messages: plain }));
    };
    ws.onmessage = (event) => {
      let data: {
        type?: string;
        id?: string;
        text?: string;
        message?: string;
        level?: string;
        details?: string;
        step_id?: string;
        status?: string;
        query?: string;
        sources?: unknown;
        reason?: string;
      };
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (data.type === "step") {
        const step = parseStep(
          {
            id: data.step_id,
            status: data.status,
            query: data.query,
            sources: data.sources,
            reason: data.reason,
          },
          true,
        );
        if (step) onStep?.(step);
        return;
      }
      if (data.type === "log") {
        const level =
          data.level === "debug" || data.level === "warn" || data.level === "error" ? data.level : "info";
        log("orphea", level, data.message || "", data.details);
        return;
      }
      if (data.type === "ready") {
        log("orphea", "debug", "Сервер ответил и готов принять запрос.");
        return;
      }
      if (data.id !== undefined && data.id !== "" && data.id !== reqId) return;
      if (data.type === "token" && typeof data.text === "string") {
        push({ kind: "token", text: data.text });
      } else if (data.type === "done") {
        push({ kind: "done" });
      } else if (data.type === "error") {
        push({ kind: "error", message: data.message || "Ошибка на стороне сервера Орфеи." });
      }
    };
    ws.onclose = () => push({ kind: "closed" });

    // Остановка: закрываем соединение, сервер сам прервёт генерацию.
    const onAbort = () => push({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        while (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        const item = queue.shift()!;
        if (item.kind === "token") {
          yield item.text;
        } else if (item.kind === "done") {
          return;
        } else if (item.kind === "error") {
          throw new ProviderError(item.message);
        } else if (item.kind === "aborted") {
          throw abortError();
        } else {
          const reason = opened
            ? "Соединение с Орфеей оборвалось."
            : "Не удалось подключиться к Орфее. Запусти orphea_server.py в PyCharm " +
              "и дождись строки «Орфея готова».";
          log(
            "orphea",
            "error",
            opened
              ? "Связь с сервером Орфеи оборвалась посреди ответа."
              : "Сервер Орфеи недоступен: к нему не удалось подключиться.",
            `Адрес: ${ORPHEA_URL}`,
          );
          throw new ProviderError(reason);
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      ws.onclose = null;
      ws.close();
    }
  },
};

// ---------- Выбор провайдера ----------

export function providerFor(kind: ProviderKind): LLMProvider {
  return kind === "orphea" ? orpheaProvider : fakeProvider;
}
