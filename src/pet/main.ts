// Окно-пет Орфеи: отдельное прозрачное окно Tauri (метка "pet", см. tauri.conf.json), которое
// остаётся поверх остальных окон, даже когда главное окно свёрнуто или перекрыто.
//
// Первая версия: только показывает модель. Перетаскивания и кликов пока нет, окно «прозрачно для мыши»:
// все нажатия проходят сквозь него к тому, что лежит под ним.
// Модель берётся из того же IndexedDB, что и в главном окне; при смене модели главное окно присылает сигнал.

import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onAvatarModelChanged } from "../avatar/channel";
import { AvatarEngine } from "../avatar/engine";
import { loadSavedModel } from "../avatar/store";

/** Размер окна должен совпадать с tauri.conf.json. */
const WIDTH = 360;
const HEIGHT = 560;
/** Отступ от края рабочей области экрана. */
const MARGIN = 24;

/** Ставит окно в правый нижний угол рабочей области (без панели задач). */
async function placeWindow(): Promise<void> {
  const x = Math.max(0, window.screen.availWidth - WIDTH - MARGIN);
  const y = Math.max(0, window.screen.availHeight - HEIGHT - MARGIN);
  await getCurrentWindow().setPosition(new LogicalPosition(x, y));
}

async function loadModel(engine: AvatarEngine): Promise<void> {
  try {
    const saved = await loadSavedModel();
    if (!saved) {
      engine.clearModel();
      return;
    }
    await engine.loadVrm(saved.data);
  } catch (err) {
    console.error("Орфея: не удалось загрузить модель для пета.", err);
  }
}

async function main(): Promise<void> {
  const host = document.getElementById("pet-host");
  if (!host) throw new Error("#pet-host не найден в pet.html");

  let engine: AvatarEngine;
  try {
    engine = new AvatarEngine(host);
  } catch (err) {
    console.error("Орфея: WebGL недоступен, пет не запущен.", err);
    return;
  }
  engine.setActive(true);

  const win = getCurrentWindow();
  await Promise.allSettled([placeWindow(), win.setIgnoreCursorEvents(true), loadModel(engine)]);

  onAvatarModelChanged(() => void loadModel(engine));
}

void main();
