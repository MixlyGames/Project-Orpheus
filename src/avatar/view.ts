// Раздел «Аватар»: предпросмотр модели, выбор и удаление файла.
// Движок (engine.ts) о странице ничего не знает, все тексты и кнопки ведёт этот файл.

import "./avatar.css";
import { describeError, log } from "../log";
import { getSettings, onSettings, type AvatarMode } from "../settings";
import { AvatarEngine, type ModelInfo } from "./engine";
import { mountAvatarDev, unmountAvatarDev } from "./dev";
import { clearSavedModel, loadSavedModel, saveModel } from "./store";

const TEXT: Record<
  AvatarMode,
  { emptyTitle: string; emptyDesc: string; srcTitle: string; srcDesc: string; pick: string; states: string }
> = {
  "3d": {
    emptyTitle: "3D-модель не выбрана",
    emptyDesc: "Выбери файл .vrm, и персонаж появится здесь: он дышит и моргает.",
    srcTitle: "Файл модели",
    srcDesc: "Формат VRM (версии 0.x и 1.0). Пока не выбран.",
    pick: "Выбрать VRM…",
    states: "Покой, речь, жесты и мимика (скоро).",
  },
  "2d": {
    emptyTitle: "Спрайты не выбраны",
    emptyDesc: "Здесь появится 2D-персонаж: пиксельная или рисованная анимация из спрайтшита (PNG с кадрами).",
    srcTitle: "Спрайтшит",
    srcDesc: "PNG с кадрами анимации. Пока не выбран.",
    pick: "Выбрать спрайтшит…",
    states: "Покой, речь и раздумье: отдельный набор кадров для каждого состояния.",
  },
};

interface LoadedModel {
  fileName: string;
  size: number;
  info: ModelInfo;
}

let ready = false;
let visible = false;
let restored = false;
let busy = false;
let error = "";
let loaded: LoadedModel | null = null;
let engine: AvatarEngine | null = null;

let stage: HTMLElement;
let canvasHost: HTMLElement;
let titleEl: HTMLElement;
let descEl: HTMLElement;
let srcTitleEl: HTMLElement;
let srcDescEl: HTMLElement;
let statesEl: HTMLElement;
let pickBtn: HTMLButtonElement;
let clearBtn: HTMLButtonElement;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} МБ`;
}

/** Файл VRM это glTF Binary: первые 4 байта «glTF». */
function looksLikeGlb(data: ArrayBuffer): boolean {
  return data.byteLength > 12 && new DataView(data).getUint32(0, true) === 0x46546c67;
}

function ensureEngine(): AvatarEngine | null {
  if (engine) return engine;
  try {
    engine = new AvatarEngine(canvasHost);
  } catch (err) {
    log("system", "error", "Не удалось запустить 3D-движок: WebGL недоступен.", describeError(err));
    engine = null;
  }
  return engine;
}

export function renderAvatarView(): void {
  if (!ready) return;
  const mode = getSettings().avatarMode;
  const t = TEXT[mode];
  const show3d = mode === "3d" && loaded !== null;

  stage.classList.toggle("has-model", show3d);
  titleEl.textContent = t.emptyTitle;
  descEl.textContent = t.emptyDesc;
  srcTitleEl.textContent = t.srcTitle;
  statesEl.textContent = t.states;

  const described = mode === "3d" && loaded ? `${loaded.info.name || loaded.fileName} · VRM ${loaded.info.vrmVersion} · ${formatSize(loaded.size)}` : t.srcDesc;
  srcDescEl.textContent = error || described;
  srcDescEl.classList.toggle("is-error", error !== "");

  pickBtn.textContent = t.pick;
  pickBtn.disabled = mode === "2d" || busy;
  pickBtn.title = mode === "2d" ? "Скоро" : "";
  clearBtn.hidden = !(mode === "3d" && loaded);

  document.querySelectorAll<HTMLElement>("[data-avatar-only]").forEach((el) => {
    el.hidden = el.dataset.avatarOnly !== mode;
  });

  engine?.setActive(visible && show3d);
}

async function applyData(data: ArrayBuffer, fileName: string, persist: boolean): Promise<void> {
  const eng = ensureEngine();
  if (!eng) throw new Error("3D-движок не запустился.");
  const info = await eng.loadVrm(data);
  mountAvatarDev(eng, fileName, info);
  loaded = { fileName, size: data.byteLength, info };
  error = "";
  if (persist) {
    await saveModel({ name: fileName, data }).catch((err) => {
      log("system", "warn", "Модель загружена, но не сохранилась между запусками.", describeError(err));
    });
  }
  log(
    "system",
    "info",
    `Модель аватара загружена: ${info.name || fileName} (VRM ${info.vrmVersion}, ${formatSize(data.byteLength)}).`,
  );
}

async function loadFile(file: File): Promise<void> {
  busy = true;
  error = "";
  renderAvatarView();
  try {
    const data = await file.arrayBuffer();
    if (!looksLikeGlb(data)) throw new Error("Это не файл VRM: ожидается .vrm (формат glTF Binary).");
    await applyData(data, file.name, true);
  } catch (err) {
    error = err instanceof Error ? err.message : "Не удалось открыть файл.";
    log("system", "error", `Не удалось загрузить модель: ${error}`, describeError(err));
  } finally {
    busy = false;
    renderAvatarView();
  }
}

function pickFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".vrm";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void loadFile(file);
  });
  input.click();
}

async function clearModel(): Promise<void> {
  engine?.clearModel();
  unmountAvatarDev();
  loaded = null;
  error = "";
  await clearSavedModel().catch((err) => {
    log("system", "warn", "Не удалось удалить сохранённую модель.", describeError(err));
  });
  log("system", "info", "Модель аватара убрана.");
  renderAvatarView();
}

/** При первом открытии раздела поднимаем сохранённую модель (при запуске приложения WebGL не трогаем). */
async function restore(): Promise<void> {
  restored = true;
  try {
    const saved = await loadSavedModel();
    if (saved) await applyData(saved.data, saved.name, false);
  } catch (err) {
    log("system", "warn", "Сохранённую модель аватара не удалось открыть, она сброшена.", describeError(err));
    await clearSavedModel().catch(() => undefined);
  } finally {
    renderAvatarView();
  }
}

export function initAvatarView(): void {
  stage = byId("avatar-stage");
  canvasHost = byId("avatar-canvas");
  titleEl = byId("avatar-title");
  descEl = byId("avatar-desc");
  srcTitleEl = byId("avatar-src-title");
  srcDescEl = byId("avatar-src-desc");
  statesEl = byId("avatar-states-desc");
  pickBtn = byId("avatar-pick");
  clearBtn = byId("avatar-clear");

  pickBtn.addEventListener("click", pickFile);
  clearBtn.addEventListener("click", () => void clearModel());
  onSettings(renderAvatarView);

  ready = true;
  renderAvatarView();
}

export function showAvatarView(): void {
  if (!ready) return;
  visible = true;
  if (!restored) void restore();
  renderAvatarView();
}

export function hideAvatarView(): void {
  visible = false;
  engine?.setActive(false);
}
