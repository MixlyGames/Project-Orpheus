// Интерфейс провайдера LLM. Реальные модели (API, локальные) подключим позже:
// достаточно реализовать `stream` и подставить провайдер в chat.ts.

export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface LLMProvider {
  readonly name: string;
  /** Потоково отдаёт куски ответа. При abort бросает DOMException("AbortError"). */
  stream(
    messages: ChatMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<string, void, void>;
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
