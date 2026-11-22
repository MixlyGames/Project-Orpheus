// Окно «Модель» (открывается карточкой в «Управлении»): колонка кнопок слева и окно справа.
// Вкладки: Провайдер, Отношения, Память, Тулзы, Власть. Здесь только переключение вкладок,
// содержимое лежит в index.html. Рейки в этом разделе нет: она существует только внутри «Чата».
//
// «Власть» открыта, если выдано достижение «To Your Oblivion» (id "spread", «Вы подавили ядро
// Орфеи»), и закрыта, если нет. Отдельного флага нет: пока достижения нет, на кнопке маленький
// замок, а содержимое окна размыто (см. model.css). Выдача достижения открывает вкладку сразу.
//
// В режиме разработчика во вкладке «Власть» есть блок управления: запуск и остановка подавления
// ядра (то же, что Ctrl + Alt + K) и выдача этого достижения для проверки.

import "./model.css";
import { isUnlocked, onAchievementsChange, unlockAchievement } from "../achievements/store";
import {
  beginCoreSuppression,
  endCoreSuppression,
  isCoreSuppressionActive,
  onCoreSuppressionChange,
} from "../core/suppression";

type TabId = "provider" | "relations" | "memory" | "tools" | "power";

/** Достижение, от которого зависит доступ к «Власти». */
const POWER_ACHIEVEMENT = "spread";

export function isPowerUnlocked(): boolean {
  return isUnlocked(POWER_ACHIEVEMENT);
}

export function initModelView(): void {
  const root = document.querySelector<HTMLElement>('.view[data-view="model"]');
  if (!root) throw new Error('Раздел .view[data-view="model"] не найден в index.html');

  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-model-tab]"));
  const panes = Array.from(root.querySelectorAll<HTMLElement>("[data-model-pane]"));
  const powerTab = tabs.find((t) => t.dataset.modelTab === "power");
  const powerPane = panes.find((p) => p.dataset.modelPane === "power");
  const powerContent = powerPane?.querySelector<HTMLElement>(".model-power-content");
  const grantBtn = root.querySelector<HTMLButtonElement>("[data-power-grant]");
  const runBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-core-run]"));

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

  // Замок на кнопке, размытие и плашка зависят только от достижения.
  const applyPower = (): void => {
    const open = isPowerUnlocked();
    powerTab?.classList.toggle("is-locked", !open);
    powerPane?.classList.toggle("is-locked", !open);
    if (powerContent) {
      powerContent.inert = !open;
      powerContent.setAttribute("aria-hidden", String(!open));
    }
    if (grantBtn) {
      grantBtn.disabled = open;
      grantBtn.setAttribute("aria-pressed", String(open));
    }
  };
  applyPower();
  onAchievementsChange(applyPower);

  // Блок для разработки: запуск и остановка подавления, выдача достижения.
  const syncRun = (): void => {
    const on = isCoreSuppressionActive();
    runBtns.forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.coreRun === "on") === on)));
  };
  runBtns.forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.coreRun === "on") beginCoreSuppression();
      else endCoreSuppression();
    }),
  );
  onCoreSuppressionChange(syncRun);
  syncRun();

  grantBtn?.addEventListener("click", () => {
    unlockAchievement(POWER_ACHIEVEMENT);
  });

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
