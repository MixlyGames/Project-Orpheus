import "./chat.css";
import { fakeProvider, type ChatMessage, type LLMProvider } from "./llm";
import * as store from "./store";
import { enableShell, initShell, onView, refreshProfile, showView, type ShellHooks } from "./shell";

// ---------- Элементы ----------

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} не найден в index.html`);
  return el as T;
}

const stage = document.querySelector<HTMLElement>(".stage");
const app = byId<HTMLElement>("app");
const chatEl = byId<HTMLElement>("chat");
const chatTitle = byId<HTMLElement>("chat-title");
const newChatBtn = byId<HTMLButtonElement>("new-chat");
const emptyTitle = byId<HTMLElement>("empty-title");
const emptySub = byId<HTMLElement>("empty-sub");
const scroller = byId<HTMLElement>("scroller");
const thread = byId<HTMLElement>("thread");
const input = byId<HTMLTextAreaElement>("composer-input");
const sendBtn = byId<HTMLButtonElement>("send");

// ---------- Состояние ----------

export type ChatHooks = ShellHooks;

const provider: LLMProvider = fakeProvider;

let hooks: ChatHooks = { getNickname: () => "", getAbout: () => "", onEditProfile: () => {} };
let controller: AbortController | null = null;

function makeTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

// ---------- Приветствие на стартовом экране ----------

const SUBTITLES = [
  "О чём поговорим?",
  "Чем займёмся сегодня?",
  "Что у тебя на уме?",
  "С чего начнём?",
];

function dayPart(): string {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

function refreshGreeting(): void {
  const nick = hooks.getNickname().trim();
  emptyTitle.textContent = nick ? `${dayPart()}, ${nick}` : dayPart();
  emptySub.textContent = SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)];
}

// ---------- Сообщения ----------

type MessageView = {
  root: HTMLElement;
  setText: (text: string) => void;
  setStreaming: (on: boolean) => void;
};

function typingDots(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "typing";
  wrap.setAttribute("aria-label", "Орфея пишет");
  for (let i = 0; i < 3; i++) wrap.append(document.createElement("i"));
  return wrap;
}

function appendMessage(m: ChatMessage, animate: boolean): MessageView {
  const root = document.createElement("div");
  root.className = `msg ${m.role === "user" ? "msg-user" : "msg-bot"}`;
  if (!animate) root.classList.add("no-anim");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = m.content;

  if (m.role === "user") {
    root.append(bubble);
  } else {
    const ava = document.createElement("span");
    ava.className = "spark";
    ava.setAttribute("aria-hidden", "true");
    // Четырёхконечная звезда: вверх, вниз, влево, вправо.
    ava.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 2C12.8 8.2 15.8 11.2 22 12C15.8 12.8 12.8 15.8 12 22C11.2 15.8 8.2 12.8 2 12C8.2 11.2 11.2 8.2 12 2Z" /></svg>';

    const body = document.createElement("div");
    body.className = "body";

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini-btn";
    copy.textContent = "Копировать";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(m.content);
        copy.textContent = "Скопировано";
      } catch {
        copy.textContent = "Не вышло";
      }
      window.setTimeout(() => (copy.textContent = "Копировать"), 1500);
    });
    actions.append(copy);

    body.append(bubble, actions);
    root.append(ava, body);
  }

  thread.append(root);

  return {
    root,
    setText(text) {
      bubble.textContent = text;
    },
    setStreaming(on) {
      root.classList.toggle("is-streaming", on);
      if (on && !bubble.textContent) bubble.replaceChildren(typingDots());
    },
  };
}

function isNearBottom(): boolean {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
}

function scrollToBottom(smooth = false): void {
  scroller.scrollTo({
    top: scroller.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}

function renderThread(): void {
  thread.replaceChildren();
  const chat = store.getActive();
  chatTitle.textContent = chat?.title ?? "Новый чат";

  let shown = 0;
  for (const m of chat?.messages ?? []) {
    // Пустой ответ ассистента: оборванная генерация, её не показываем.
    if (m.role === "assistant" && !m.content) continue;
    appendMessage(m, false);
    shown++;
  }
  chatEl.classList.toggle("is-empty", shown === 0);
  if (shown === 0) refreshGreeting();
  scrollToBottom();
}

// Открытый чат сменился (из истории, «Новый чат», удаление): перерисовываем.
store.subscribe((e) => {
  if (e !== "active") return;
  stop();
  renderThread();
});

// ---------- Ввод и отправка ----------

function autosize(): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

function updateUi(): void {
  const streaming = controller !== null;
  sendBtn.classList.toggle("is-stop", streaming);
  sendBtn.setAttribute("aria-label", streaming ? "Остановить" : "Отправить");
  sendBtn.disabled = !streaming && input.value.trim() === "";
}

function stop(): void {
  controller?.abort();
}

async function send(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text || controller) return;

  // Новый чат создаём только с первым сообщением, пустых чатов не копится.
  const chat = store.getActive() ?? store.createChat(makeTitle(text));

  const userMsg: ChatMessage = { role: "user", content: text };
  const reply: ChatMessage = { role: "assistant", content: "" };
  chat.messages.push(userMsg, reply);

  input.value = "";
  autosize();

  chatEl.classList.remove("is-empty");
  appendMessage(userMsg, true);
  const bot = appendMessage(reply, true);
  bot.setStreaming(true);
  scrollToBottom(true);
  store.commit(chat);

  const ctrl = new AbortController();
  controller = ctrl;
  updateUi();

  const history = chat.messages.slice(0, -1);

  try {
    for await (const chunk of provider.stream(history, ctrl.signal)) {
      const stick = isNearBottom();
      reply.content += chunk;
      bot.setText(reply.content);
      if (stick) scrollToBottom();
    }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    if (!aborted) {
      console.warn("Orpheus: ошибка провайдера", err);
      reply.content = reply.content || "Не удалось получить ответ.";
      bot.setText(reply.content);
    }
  } finally {
    controller = null;
    bot.setStreaming(false);
    if (!reply.content) {
      // Остановили до первого символа: убираем пустой ответ.
      chat.messages = chat.messages.filter((m) => m !== reply);
      bot.root.remove();
    }
    store.commit(chat);
    updateUi();
    if (document.body.classList.contains("is-chat")) input.focus({ preventScroll: true });
  }
}

// ---------- События ----------

input.addEventListener("input", () => {
  autosize();
  updateUi();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!controller) void send(input.value);
  }
});

sendBtn.addEventListener("click", () => {
  if (controller) stop();
  else void send(input.value);
});

newChatBtn.addEventListener("click", () => {
  store.setActive(null);
  input.focus({ preventScroll: true });
});

document.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
  chip.addEventListener("click", () => void send(chip.dataset.prompt ?? chip.textContent ?? ""));
});

// Вернулись в раздел «Чат»: ставим курсор в поле ввода.
onView((v) => {
  if (v !== "chat") return;
  window.setTimeout(() => {
    if (document.body.classList.contains("is-chat")) input.focus({ preventScroll: true });
  }, 450);
});

// ---------- Публичный API ----------

export function initChat(h: ChatHooks): void {
  hooks = h;
  initShell(h);
  renderThread();
  updateUi();
}

export function openChat(): void {
  refreshProfile();
  if (!store.getActive()) refreshGreeting();
  document.body.classList.add("is-chat");
  app.inert = false;
  app.setAttribute("aria-hidden", "false");
  enableShell(true);
  if (stage) stage.inert = true;
  window.setTimeout(() => {
    if (document.body.classList.contains("is-chat")) {
      // Возвращаемся в раздел, где были; в чате сразу можно печатать.
      if (chatEl.closest(".view")?.classList.contains("is-active")) {
        input.focus({ preventScroll: true });
      }
    }
  }, 700);
}

export function closeChat(): void {
  document.body.classList.remove("is-chat");
  app.inert = true;
  app.setAttribute("aria-hidden", "true");
  enableShell(false);
  if (stage) stage.inert = false;
}

// Для кнопок из других разделов.
export { showView };
