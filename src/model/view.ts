// Окно «Модель» (открывается карточкой в «Управлении»): колонка кнопок слева и окно справа.
// Вкладки: Провайдер, Отношения, Память, Тулзы, Власть. Здесь только переключение вкладок,
// содержимое лежит в index.html. Рейки в этом разделе нет: она существует только внутри «Чата».
//
// «Власть» закрыта: на кнопке маленький замок, а содержимое окна размыто, и поверх него лежит
// компактная плашка (см. model.css). Открывается из любого места кода вызовом
// setPowerUnlocked(true); состояние хранится в localStorage и переживает перезапуск.

import "./model.css";

type TabId = "provider" | "relations" | "memory" | "tools" | "power";

const POWER_KEY = "orpheus.model.power";

function loadPower(): boolean {
  try {
    return localStorage.getItem(POWER_KEY) === "1";
  } catch {
    return false;
  }
}

let powerUnlocked = loadPower();
let applyPower: (() => void) | null = null;

export function isPowerUnlocked(): boolean {
  return powerUnlocked;
}

/** Открывает или снова закрывает вкладку «Власть». */
export function setPowerUnlocked(on: boolean): void {
  powerUnlocked = on;
  try {
    localStorage.setItem(POWER_KEY, on ? "1" : "0");
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить состояние вкладки", err);
  }
  applyPower?.();
}

export function initModelView(): void {
  const root = document.querySelector<HTMLElement>('.view[data-view="model"]');
  if (!root) throw new Error('Раздел .view[data-view="model"] не найден в index.html');

  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-model-tab]"));
  const panes = Array.from(root.querySelectorAll<HTMLElement>("[data-model-pane]"));
  const powerTab = tabs.find((t) => t.dataset.modelTab === "power");
  const powerPane = panes.find((p) => p.dataset.modelPane === "power");
  const powerContent = powerPane?.querySelector<HTMLElement>(".model-power-content");

  function select(id: TabId, focus = false): void {
    for (const tab of tabs) {
      const on = tab.dataset.modelTab === id;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus({ preventScroll: true });
    }
    for (const pane of panes) {
      const on = pane.dataset.modelPane === id;
      pane.hidden = !on;
      pane.classList.toggle("is-active", on);
    }
  }

  // Замок на кнопке, размытие и плашка зависят только от флага.
  applyPower = () => {
    const locked = !powerUnlocked;
    powerTab?.classList.toggle("is-locked", locked);
    powerPane?.classList.toggle("is-locked", locked);
    if (powerContent) {
      powerContent.inert = locked;
      powerContent.setAttribute("aria-hidden", String(locked));
    }
  };
  applyPower();

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab.dataset.modelTab as TabId));

    // Стрелки ходят по кнопкам, Home и End прыгают в начало и в конец.
    tab.addEventListener("keydown", (e) => {
      let next = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      select(tabs[next].dataset.modelTab as TabId, true);
    });
  });

  select("provider");
}
