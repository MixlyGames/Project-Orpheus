// Хранилище чатов (локально, в localStorage) с простой подпиской на изменения.

import type { ChatMessage } from "./llm";

export type Chat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

/** "active": сменился открытый чат. "list": изменился список чатов. */
export type StoreEvent = "active" | "list";

const CHATS_KEY = "orpheus.chats";

function load(): Chat[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.flatMap((c): Chat[] => {
      if (!c || typeof c !== "object") return [];
      const o = c as Partial<Chat>;
      if (typeof o.id !== "string" || !Array.isArray(o.messages)) return [];
      const messages = o.messages.filter(
        (m) =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      );
      return [
        {
          id: o.id,
          title: typeof o.title === "string" && o.title ? o.title : "Новый чат",
          messages,
          updatedAt: Number(o.updatedAt) || Date.now(),
        },
      ];
    });
  } catch {
    return [];
  }
}

let chats: Chat[] = load();
let activeId: string | null = null;

const listeners = new Set<(e: StoreEvent) => void>();

function emit(e: StoreEvent): void {
  listeners.forEach((l) => l(e));
}

function save(): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить чаты", err);
  }
}

export function subscribe(listener: (e: StoreEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChats(): readonly Chat[] {
  return chats;
}

export function getActiveId(): string | null {
  return activeId;
}

export function getActive(): Chat | undefined {
  return chats.find((c) => c.id === activeId);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function setActive(id: string | null): void {
  if (id === activeId) return;
  activeId = id;
  emit("active");
  emit("list");
}

export function createChat(title: string): Chat {
  const chat: Chat = { id: uid(), title, messages: [], updatedAt: Date.now() };
  chats.unshift(chat);
  activeId = chat.id;
  emit("active");
  emit("list");
  return chat;
}

/** Сохраняет изменения чата (новые сообщения, время обновления). */
export function commit(chat: Chat): void {
  chat.updatedAt = Date.now();
  save();
  emit("list");
}

export function removeChat(id: string): void {
  chats = chats.filter((c) => c.id !== id);
  save();
  if (id === activeId) {
    activeId = null;
    emit("active");
  }
  emit("list");
}

export function clearChats(): void {
  chats = [];
  activeId = null;
  save();
  emit("active");
  emit("list");
}
