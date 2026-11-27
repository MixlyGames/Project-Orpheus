// Раздел «Аватар»: предпросмотр модели, выбор и удаление файла.
// Движок (engine.ts) о странице ничего не знает, все тексты и кнопки ведёт этот файл.

import "./avatar.css";
import { describeError, log } from "../log";
import { getSettings, onSettings, type AvatarMode } from "../settings";
import { AvatarEngine, describeFormat, type ModelInfo } from "./engine";
import { looksLikeFbx, packBundle, TEXTURE_EXT } from "./bundle";
import { mountAvatarDev, unmountAvatarDev } from "./dev";
import { clearSavedModel, libraryId, loadSavedModel, removeLibraryEntry, saveModel } from "./store";
import { initAvatarSidebar, rememberModel, showAvatarSidebar, syncAvatarSidebar } from "./sidebar";

const TEXT: Record<
  AvatarMode,
  { emptyTitle: string; emptyDesc: string; srcTitle: string; srcDesc: string; pick: string; states: string }
> = {
  "3d": {
    emptyTitle: "3D-модель не выбрана",
    emptyDesc: "Выбери файл .vrm или .fbx, и персонаж появится здесь: он дышит и моргает.",
    srcTitle: "Файл модели",
    srcDesc: "Форматы: VRM (0.x и 1.0) и FBX (можно сразу вместе с текстурами). Пока не выбран.",
    pick: "Выбрать модель…",
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
let faceHost: HTMLElement | null = null; // квадрат Орфеи в чате, пока открыт чат

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

  const described =
    mode === "3d" && loaded
      ? `${loaded.info.name || loaded.fileName} · ${describeFormat(loaded.info)} · ${formatSize(loaded.size)}${loaded.info.warnings.length > 0 ? " · " + loaded.info.warnings[0] : ""}`
      : t.srcDesc;
  srcDescEl.textContent = error || described;
  srcDescEl.classList.toggle("is-error", error !== "");

  pickBtn.textContent = t.pick;
  pickBtn.disabled = mode === "2d" || busy;
  pickBtn.title = mode === "2d" ? "Скоро" : "";
  clearBtn.hidden = !(mode === "3d" && loaded);

  document.querySelectorAll<HTMLElement>("[data-avatar-only]").forEach((el) => {
    el.hidden = el.dataset.avatarOnly !== mode;
  });

  // Один движок рисует там, куда сейчас смотрят: во вкладке «Аватар» (целиком) или в квадрате чата (лицо).
  if (engine && show3d) {
    if (visible) engine.attach(canvasHost, "full");
    else if (faceHost) engine.attach(faceHost, "face");
  }
  faceHost?.closest(".agent")?.classList.toggle("has-face", show3d);
  engine?.setActive((visible || faceHost !== null) && show3d);
  syncAvatarSidebar();
}

/** Редактор текстур изменил комплект FBX: сохраняем новую версию вместо старой, без дубля в библиотеке. */
async function commitModelData(packed: ArrayBuffer): Promise<void> {
  const eng = engine;
  const current = loaded;
  if (!eng || !current) return;
  await removeLibraryEntry(libraryId(current.fileName, current.size)).catch(() => undefined);
  const next: LoadedModel = { ...current, size: packed.byteLength, info: { ...current.info, warnings: [] } };
  loaded = next;
  await saveModel({ name: next.fileName, data: packed });
  await rememberModel(eng, next.fileName, packed, next.info);
  log("system", "info", "Текстуры модели сохранены (" + formatSize(packed.byteLength) + ").");
  renderAvatarView();
}

async function applyData(data: ArrayBuffer, fileName: string, persist: boolean): Promise<void> {
  const eng = ensureEngine();
  if (!eng) throw new Error("3D-движок не запустился.");
  const info = await eng.loadModel(data);
  mountAvatarDev(eng, fileName, info, commitModelData);
  loaded = { fileName, size: data.byteLength, info };
  error = "";
  void rememberModel(eng, fileName, data, info);
  if (persist) {
    await saveModel({ name: fileName, data }).catch((err) => {
      log("system", "warn", "Модель загружена, но не сохранилась между запусками.", describeError(err));
    });
  }
  log(
    "system",
    "info",
    `Модель аватара загружена: ${info.name || fileName} (${describeFormat(info)}, ${formatSize(data.byteLength)}).`,
  );
  for (const w of info.warnings) log("system", "warn", w);
}

/** Выбранные файлы: модель (.vrm или .fbx) и, для FBX, картинки текстур. Остальное игнорируется. */
async function loadFiles(files: File[]): Promise<void> {
  busy = true;
  error = "";
  renderAvatarView();
  try {
    const model = files.find((f) => /\.(vrm|fbx)$/i.test(f.name));
    if (!model) throw new Error("Среди выбранных файлов нет модели: нужен .vrm или .fbx.");
    const data = await model.arrayBuffer();
    if (/\.vrm$/i.test(model.name)) {
      if (!looksLikeGlb(data)) throw new Error("Это не файл VRM: ожидается .vrm (формат glTF Binary).");
      await applyData(data, model.name, true);
    } else {
      if (!looksLikeFbx(data)) throw new Error("Это не файл FBX: ожидается FBX версии 7000 или новее.");
      // Текстуры, выбранные вместе с моделью, пакуем в один комплект, чтобы они сохранились между запусками.
      const textures = await Promise.all(
        files
          .filter((f) => f !== model && TEXTURE_EXT.test(f.name))
          .map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })),
      );
      const packed = textures.length > 0 ? packBundle([{ name: model.name, data }, ...textures]) : data;
      await applyData(packed, model.name, true);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Не удалось открыть файл.";
    log("system", "error", `Не удалось загрузить модель: ${error}`, describeError(err));
  } finally {
    busy = false;
    renderAvatarView();
  }
}

/** Выбор модели из библиотеки («Модели»): файл уже лежит в хранилище, проверять формат не нужно. */
async function useModel(name: string, data: ArrayBuffer): Promise<void> {
  busy = true;
  error = "";
  renderAvatarView();
  try {
    await applyData(data, name, true);
  } catch (err) {
    error = err instanceof Error ? err.message : "Не удалось открыть модель.";
    log("system", "error", `Не удалось загрузить модель: ${error}`, describeError(err));
  } finally {
    busy = false;
    renderAvatarView();
  }
}

function pickFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".vrm,.fbx,.png,.jpg,.jpeg,.webp,.bmp,.tga";
  input.multiple = true;
  input.addEventListener("change", () => {
    const picked = Array.from(input.files ?? []);
    if (picked.length > 0) void loadFiles(picked);
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
  initAvatarSidebar({
    pick: pickFile,
    use: useModel,
    activeId: () => (loaded ? libraryId(loaded.fileName, loaded.size) : null),
    busy: () => busy,
    clearActive: clearModel,
  });

  ready = true;
  renderAvatarView();
}

export function showAvatarView(): void {
  if (!ready) return;
  visible = true;
  showAvatarSidebar();
  if (!restored) void restore();
  renderAvatarView();
}

export function hideAvatarView(): void {
  visible = false;
  renderAvatarView();
}

/** Открыт чат: лицо Орфеи показывается в квадрате справа внизу (если выбрана 3D-модель). */
export async function showFace(): Promise<void> {
  faceHost = document.getElementById("agent-face");
  if (!ready || !faceHost) return;
  if (!restored) await restore();
  renderAvatarView();
}

export function hideFace(): void {
  faceHost = null;
  renderAvatarView();
}
