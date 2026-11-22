import "./contextmenu.css";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getSettings } from "./settings";

// Правая кнопка мыши. WebView2 по умолчанию показывает меню как в браузере
// («Сохранить изображение», «Другие инструменты», «Проверить» и так далее),
// через него можно вытащить картинку с моделью или сохранить страницу целиком.
//
// Правила:
//   поле ввода (input, textarea): своё меню «Вырезать / Копировать / Вставить»;
//   выделен обычный текст: своё меню с одним пунктом «Копировать»;
//   всё остальное (фон, холст аватара, картинки): меню не показывается.
// Режим разработчика: правая кнопка с зажатым Shift открывает родное меню (там есть «Проверить»).

type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "number", ""]);

function textField(target: EventTarget | null): TextField | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("input, textarea");
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) return el;
  return null;
}

function selectedIn(el: TextField): string {
  return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
}

async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    document.execCommand("copy");
  }
}

async function pasteInto(el: TextField): Promise<void> {
  let text = "";
  try {
    text = await readText();
  } catch {
    return; // нет доступа к буферу обмена: Ctrl + V всё равно работает
  }
  if (text === "") return;

  el.focus();
  // execCommand сохраняет историю отмены и сам шлёт событие input (поле чата растягивается).
  if (!document.execCommand("insertText", false, text)) {
    el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// ---------- Меню ----------

type Item = { label: string; hint: string; enabled: boolean; run: () => void | Promise<void> };

let menu: HTMLElement | null = null;

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

function openMenu(x: number, y: number, items: Item[]): void {
  closeMenu();

  const el = document.createElement("div");
  el.className = "ctx-menu";
  el.setAttribute("role", "menu");

  for (const it of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-item";
    btn.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.textContent = it.label;
    const hint = document.createElement("span");
    hint.className = "ctx-key";
    hint.textContent = it.hint;
    btn.append(label, hint);
    btn.disabled = !it.enabled;
    // Без этого клик по пункту уводит фокус и снимает выделение раньше, чем сработает действие.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", async () => {
      await it.run();
      closeMenu();
    });
    el.append(btn);
  }

  document.body.append(el);

  // Не выходим за край окна.
  const { width, height } = el.getBoundingClientRect();
  el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
  el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
  menu = el;
}

export function installContextMenu(): void {
  document.addEventListener("contextmenu", (e) => {
    // Для разработки: Shift + правая кнопка оставляет родное меню.
    if (getSettings().devMode && e.shiftKey) return;

    e.preventDefault();

    const field = textField(e.target);
    if (field) {
      const text = selectedIn(field);
      const editable = !field.readOnly && !field.disabled;
      openMenu(e.clientX, e.clientY, [
        {
          label: "Вырезать",
          hint: "Ctrl+X",
          enabled: editable && text !== "",
          run: () => {
            field.focus();
            document.execCommand("cut");
          },
        },
        { label: "Копировать", hint: "Ctrl+C", enabled: text !== "", run: () => copyText(text) },
        { label: "Вставить", hint: "Ctrl+V", enabled: editable, run: () => pasteInto(field) },
      ]);
      return;
    }

    const text = window.getSelection()?.toString() ?? "";
    if (text.trim() !== "") {
      openMenu(e.clientX, e.clientY, [
        { label: "Копировать", hint: "Ctrl+C", enabled: true, run: () => copyText(text) },
      ]);
    } else {
      closeMenu();
    }
  });

  // Закрываем по клику снаружи, Esc, прокрутке и смене размера окна.
  document.addEventListener("pointerdown", (e) => {
    if (menu && e.target instanceof Node && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
  document.addEventListener("scroll", closeMenu, true);

  // Горячие клавиши браузера, которые вытаскивают содержимое: «Сохранить страницу», «Печать», «Исходник».
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "s" || key === "p" || key === "u") e.preventDefault();
  });

  // Картинки, видео и холсты нельзя утащить мышкой в проводник или другое окно.
  document.addEventListener("dragstart", (e) => {
    if (e.target instanceof Element && e.target.closest("img, video, canvas, a")) {
      e.preventDefault();
    }
  });
}
