// Панель разработчика в разделе «Аватар»: настройка модели «на лету» и сохранение значений для неё.
// Контейнер #avatar-dev помечен data-dev-only, поэтому виден только при включённом режиме разработчика.

import { describeError, log } from "../log";
import { TEXTURE_EXT } from "./bundle";
import { DEFAULT_TUNING, describeFormat, type AvatarEngine, type ModelInfo } from "./engine";
import { loadTuning, saveTuning } from "./tuning-store";

let engine: AvatarEngine | null = null;
/** Сохраняет изменённый комплект FBX (его даёт view.ts). null, пока модель не загружена. */
let commit: ((packed: ArrayBuffer) => Promise<void>) | null = null;
let persistTimer = 0;

function container(): HTMLElement | null {
  return document.getElementById("avatar-dev");
}

/** Сохраняет значения для модели; окно-пет Орфеи применит их после сигнала (см. tuning-store.ts). */
function saveForModel(fileName: string, eng: AvatarEngine): void {
  if (!saveTuning(fileName, eng.getTuning())) log("system", "warn", "Не удалось сохранить настройки модели.");
}

// ---------- Мелкие помощники для разметки ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function row(title: string, desc: string, control: HTMLElement): HTMLElement {
  const r = el("div", "row");
  const text = el("div", "row-text");
  text.append(el("p", "row-title", title));
  if (desc) text.append(el("p", "row-desc", desc));
  r.append(text, control);
  return r;
}

function slider(
  min: number,
  max: number,
  step: number,
  value: number,
  digits: number,
  onInput: (v: number) => void,
): HTMLElement {
  const wrap = el("div", "range");
  const input = el("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el("output", "", value.toFixed(digits));
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(digits);
    onInput(v);
  });
  wrap.append(input, out);
  return wrap;
}

function toggle(value: boolean, label: string, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = el("button", "switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-checked", String(value));
  b.append(document.createElement("i"));
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
}

function title(): HTMLElement {
  const h = el("h3", "panel-title", "Настройка модели");
  h.append(el("span", "dev-tag", "DEV"));
  return h;
}

function actions(onReset: () => void, onSave: () => void): HTMLElement {
  const wrap = el("div", "dev-actions");

  const reset = el("button", "btn", "Сбросить");
  reset.type = "button";
  reset.addEventListener("click", onReset);

  const save = el("button", "btn", "Сохранить для этой модели");
  save.type = "button";
  let timer = 0;
  save.addEventListener("click", () => {
    onSave();
    save.textContent = "Сохранено";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      save.textContent = "Сохранить для этой модели";
    }, 1500);
  });

  wrap.append(reset, save);
  return wrap;
}

// ---------- Материалы и текстуры (FBX) ----------

/** Сохраняет комплект с небольшой задержкой: серия быстрых правок даёт одну запись, а не двадцать мегабайт на каждую. */
function schedulePersist(eng: AvatarEngine): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const packed = eng.exportBundle();
    if (!packed || !commit) return;
    commit(packed).catch((err: unknown) => {
      log("system", "warn", "Не удалось сохранить текстуры модели.", describeError(err));
    });
  }, 600);
}

function fbxSection(eng: AvatarEngine, rebuild: () => void): HTMLElement[] {
  const editor = eng.getFbxEditor();
  if (!editor) return [];
  const items: HTMLElement[] = [el("p", "dev-sub", "Материалы и текстуры (сохраняются сами, видны и в пете)")];

  const add = el("button", "btn", "Добавить текстуры…");
  add.type = "button";
  add.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".png,.jpg,.jpeg,.webp,.bmp";
    input.addEventListener("change", () => {
      const picked = Array.from(input.files ?? []).filter((f) => TEXTURE_EXT.test(f.name));
      if (picked.length === 0) return;
      void (async () => {
        try {
          const added = await Promise.all(picked.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
          await eng.addFbxTextures(added);
          schedulePersist(eng);
        } catch (err) {
          log("system", "error", "Не удалось добавить текстуры.", describeError(err));
        }
        rebuild();
      })();
    });
    input.click();
  });
  const have =
    editor.textures.length === 0
      ? "Пока нет. Добавь картинки: подхватятся по имени файла, остальные можно назначить на материал вручную."
      : editor.textures.length + " шт.: " + editor.textures.slice(0, 3).join(", ") + (editor.textures.length > 3 ? "…" : "");
  items.push(row("Текстуры", have, add));

  items.push(
    row(
      "Матовые материалы",
      "Убирает пластиковый глянец, из-за которого FBX выглядит металлическим.",
      toggle(editor.matte, "Матовые материалы", (v) => {
        eng.setFbxMatte(v);
        schedulePersist(eng);
      }),
    ),
  );

  for (const m of editor.materials) {
    const select = el("select", "dev-select");
    select.add(new Option("Как в файле", ""));
    for (const t of editor.textures) select.add(new Option(t, t));
    select.value = m.assigned;
    select.addEventListener("change", () => {
      void (async () => {
        try {
          await eng.assignFbxTexture(m.key, select.value === "" ? null : select.value);
          schedulePersist(eng);
        } catch (err) {
          log("system", "error", "Не удалось назначить текстуру.", describeError(err));
        }
        rebuild();
      })();
    });
    const status = m.status === "ok" ? "текстура есть" : m.status === "missing" ? "файла текстуры не было" : "без текстуры";
    items.push(row(m.name, (m.color ? m.color + " · " : "") + status, select));
  }
  return items;
}

// ---------- Панель ----------

/** Строит панель по текущему состоянию движка. */
function build(eng: AvatarEngine, fileName: string, info: ModelInfo): void {
  const box = container();
  if (!box) return;

  const tuning = eng.getTuning();
  const stats = eng.getStats();

  const fps = el("span", "dev-val", "…");
  eng.onStats = (v) => {
    fps.textContent = String(Math.round(v));
  };

  const items: HTMLElement[] = [
    title(),
    row("Модель", "", el("span", "dev-val", `${info.name || fileName} · ${describeFormat(info)}`)),
    row("Кости и выражения", "", el("span", "dev-val", `${stats.bones} костей · ${stats.expressions.length} выражений`)),
    row("FPS", "Обновляется, пока раздел открыт.", fps),
    row(
      "Опускание рук",
      "0 это T-поза, 1 это А-поза.",
      slider(-0.5, 1.6, 0.01, tuning.armDown, 2, (v) => eng.setTuning({ armDown: v })),
    ),
    row(
      "Дыхание",
      "Амплитуда покачивания, 0 выключает.",
      slider(0, 0.05, 0.001, tuning.breath, 3, (v) => eng.setTuning({ breath: v })),
    ),
    row(
      "Моргание",
      "Автоматическое, раз в несколько секунд.",
      toggle(tuning.autoBlink, "Автоматическое моргание", (v) => eng.setTuning({ autoBlink: v })),
    ),
  ];

  if (info.format === "fbx") items.push(...fbxSection(eng, () => build(eng, fileName, info)));

  if (stats.expressions.length > 0) {
    items.push(el("p", "dev-sub", "Выражения лица (проверка, не сохраняются)"));
    for (const name of stats.expressions) {
      items.push(row(name, "", slider(0, 1, 0.01, eng.getExpression(name), 2, (v) => eng.setExpression(name, v))));
    }
  }

  items.push(
    actions(
      () => {
        eng.setTuning({ ...DEFAULT_TUNING });
        eng.resetExpressions();
        build(eng, fileName, info);
      },
      () => saveForModel(fileName, eng),
    ),
  );

  box.replaceChildren(...items);
}

/** Модель загружена: применяем сохранённые для неё значения и показываем панель. */
export function mountAvatarDev(
  eng: AvatarEngine,
  fileName: string,
  info: ModelInfo,
  commitModel?: (packed: ArrayBuffer) => Promise<void>,
): void {
  if (engine && engine !== eng) engine.onStats = null;
  engine = eng;
  commit = commitModel ?? null;
  window.clearTimeout(persistTimer);
  eng.setTuning(loadTuning(fileName));
  build(eng, fileName, info);
}

/** Модель убрана: панель возвращается к подсказке. */
export function unmountAvatarDev(): void {
  commit = null;
  window.clearTimeout(persistTimer);
  if (engine) engine.onStats = null;
  engine = null;
  const box = container();
  if (!box) return;
  box.replaceChildren(title(), el("p", "dev-empty", "Загрузи модель, чтобы её настроить."));
}
