// Режим разработчика: общий переключатель (в «Настройках») и запись изменений в журнал.
// Сам режим это настройка devMode. Класс dev-mode на <body> ставит settings.ts, а блоки
// с атрибутом data-dev-only (см. dev.css) показываются только при включённом режиме.
// Переключатель во вкладке «Дебаггер» живёт отдельно (debug.ts), оба меняют одну и ту же настройку.

import { log } from "./log";
import { getSettings, onSettings, updateSettings } from "./settings";

export function initDevMode(): void {
  const switches = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-dev-switch]"));
  let last = getSettings().devMode;

  const sync = (): void => {
    const on = getSettings().devMode;
    switches.forEach((s) => s.setAttribute("aria-checked", String(on)));
    if (on !== last) {
      last = on;
      log("system", "info", on ? "Режим разработчика включён." : "Режим разработчика выключен.");
    }
  };

  switches.forEach((s) => {
    s.addEventListener("click", () => updateSettings({ devMode: !getSettings().devMode }));
  });
  onSettings(sync);
  sync();
}
