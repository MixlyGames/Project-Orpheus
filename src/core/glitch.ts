// Глитч текста интерфейса для события подавления ядра: у случайного элемента текст на время
// превращается в перебор случайных символов, потом возвращается. Оригинал всегда восстанавливается.
//
// Что портим (белый список TARGETS): подписи кнопок навигации, а также названия и описания
// элементов в настройках, управлении и окне «Модель». Это обычный текст, не кнопки с действиями.
//
// Правила безопасности:
// - новые элементы по умолчанию неприкосновенны: в TARGETS нужно добавлять явно, и туда
//   не должны попадать кнопки с действиями (очистка истории, отправка, закрытие окна);
// - ничего не мигает: меняются только буквы в одном элементе, не чаще 8 раз в секунду,
//   не более двух элементов одновременно;
// - глючат только видимые элементы активного раздела (не внутри inert);
// - если код сам изменил текст элемента во время глитча, оригинал поверх него не пишется;
// - при motionReduced() глитча нет совсем.

import { motionReduced } from "../settings";

/** Подписи навигации, названия и описания строк настроек, карточки «Управления», вкладки «Модели». */
const TARGETS = [
  ".dock-label",
  ".rail-label:not(.rail-brand)",
  ".model-tab > span",
  ".row-title",
  ".row-desc",
  ".mod-title",
  ".mod-desc",
].join(", ");

const CHARS = "абвгдежзиклмнопрстуфхцчшэюя#$%&@?01{}<>/\\|ABCDEFGHJKLMNPRSTXZ";
const TICK_MS = 125;
const MAX_AT_ONCE = 2;
/** Короткие подписи портим сильнее, длинные описания слабее: они иначе меняют перенос строк. */
const SHORT_LEN = 14;

type Glitched = { original: string; shown: string; timer: number };
const active = new Map<HTMLElement, Glitched>();

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomChar(): string {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}

function restore(el: HTMLElement): void {
  const g = active.get(el);
  if (!g) return;
  window.clearInterval(g.timer);
  active.delete(el);

  // Если текст за это время поменял сам код (например, название строки), оставляем его версию.
  if (el.textContent === g.shown) el.textContent = g.original;

  el.style.minWidth = "";
  el.style.minHeight = "";
  el.removeAttribute("aria-hidden");
}

/** Портит текст на ms миллисекунд, потом возвращает как было. */
export function scramble(el: HTMLElement, ms: number): void {
  if (active.has(el)) return;
  const original = el.textContent ?? "";
  if (original.trim() === "") return;

  const chars = Array.from(original);
  const ratio = chars.length <= SHORT_LEN ? 0.65 : 0.3;
  const g: Glitched = { original, shown: original, timer: 0 };
  active.set(el, g);

  // Размер фиксируем, чтобы остальной интерфейс не «ездил», пока буквы меняются.
  el.style.minWidth = `${el.offsetWidth}px`;
  el.style.minHeight = `${el.offsetHeight}px`;
  el.setAttribute("aria-hidden", "true"); // у кнопок есть title, имя для скринридера берётся из него

  const started = performance.now();
  g.timer = window.setInterval(() => {
    if (performance.now() - started >= ms) {
      restore(el);
      return;
    }
    g.shown = chars.map((c) => (c === " " || c === "\n" || Math.random() > ratio ? c : randomChar())).join("");
    el.textContent = g.shown;
  }, TICK_MS);
}

export type Glitcher = { stop: () => void };

/** Раз в 1,4–3,2 с портит случайный видимый элемент из белого списка. */
export function startGlitch(): Glitcher {
  if (motionReduced()) return { stop: () => {} };

  let stopped = false;
  let timer = 0;

  const fire = (): void => {
    if (active.size >= MAX_AT_ONCE) return;
    const pool = Array.from(document.querySelectorAll<HTMLElement>(TARGETS)).filter(
      (el) => !active.has(el) && el.getClientRects().length > 0 && !el.closest("[inert]"),
    );
    if (pool.length === 0) return;
    scramble(pool[Math.floor(Math.random() * pool.length)], rand(700, 1500));
  };

  const next = (): void => {
    timer = window.setTimeout(() => {
      if (stopped) return;
      fire();
      next();
    }, rand(1400, 3200));
  };
  next();

  return {
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      Array.from(active.keys()).forEach(restore);
    },
  };
}
