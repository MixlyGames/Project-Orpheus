// Окно-пет Орфеи: отдельное прозрачное окно Tauri (метка "pet", см. tauri.conf.json), которое
// остаётся поверх остальных окон, даже когда главное окно свёрнуто или перекрыто.
//
// Что умеет:
// - показывает модель из того же хранилища, что и главное окно, и применяет её сохранённые настройки;
// - Орфею можно взять мышью и перенести, а когда отпустишь, она падает прямо вниз и встаёт на панель
//   задач (физика в physics.ts). Бросать её нельзя: только перетаскивание и гравитация;
// - всё окно «прозрачно для мыши», кроме моментов, когда курсор над самой моделью: тогда клики
//   достаются ей, а в остальное время проходят к тому, что лежит под окном.
//
// Как это устроено: пока окно игнорирует мышь, DOM-событий у нас нет, поэтому положение курсора
// опрашивается через Tauri (cursorPosition). Когда курсор над моделью, игнорирование выключается,
// и мы получаем обычные pointer-события для перетаскивания.

import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  monitorFromPoint,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { onAvatarGraphicsChanged, onAvatarModelChanged, onAvatarTuningChanged } from "../avatar/channel";
import { AvatarEngine } from "../avatar/engine";
import { loadGraphics, QUALITY_RATIO, type Graphics } from "../avatar/graphics-store";
import { loadSavedModel } from "../avatar/store";
import { loadTuning } from "../avatar/tuning-store";
import { centerX, clampToArea, step, type Body, type Platform, type Rect } from "./physics";

/** Размер окна должен совпадать с tauri.conf.json (логические пиксели). */
const WIDTH = 360;
const HEIGHT = 560;
/** Отступ при первом появлении от края рабочей области. */
const MARGIN = 24;

/** Как часто опрашиваем курсор, когда Орфея просто стоит, мс. */
const HOVER_POLL_MS = 33;
/** Как часто уточняем рабочую область монитора, мс (при перетаскивании чаще). */
const AREA_POLL_MS = 500;
const AREA_POLL_DRAG_MS = 150;
/** Как часто пересчитываем прямоугольник модели, мс. */
const RECT_POLL_MS = 100;
/** Пока Орфея стоит на опоре, раз в столько мс проверяем, не ушла ли опора из-под неё. */
const SETTLED_RECHECK_MS = 250;
/** Какую долю ширины по краям рамки модели не считаем «попаданием» (руки и волосы). */
const HIT_SHRINK = 0.12;
/** Как часто спрашиваем у системы края окон, мс. Пока сидит на окне, чаще: чтобы ехать вместе с ним. */
const LEDGE_POLL_MS = 300;
// Пока сидит, за движением окна следит Rust по событию; опрос нужен только чтобы заметить, что окно
// закрыли или перекрыли, поэтому он редкий.
const LEDGE_POLL_SEAT_MS = 250;
/** Насколько ступни могут быть ниже края в момент отпускания, чтобы всё равно на него встать (лог. px). */
const SNAP_LOGICAL = 48;
/** Запас по краям опоры, чтобы не падать из-за того, что события и опрос пришли вразнобой (лог. px). */
const SEAT_SLACK_LOGICAL = 12;
/** Сколько после последнего сдвига окна держим полную частоту кадров, мс. */
const SEAT_MOVE_HOLD_MS = 400;
/** Настройки графики из вкладки «Аватар» → «Конфиг» (частота кадров и потолок разрешения). */
let graphics: Graphics = loadGraphics();

function applyGraphics(): void {
  graphics = loadGraphics();
  engine?.setMaxPixelRatio(QUALITY_RATIO[graphics.quality]);
}

const win = getCurrentWindow();
const body: Body = { x: 0, y: 0, vy: 0 };

let engine: AvatarEngine | null = null;
let hostEl: HTMLElement | null = null;
let modelName = "";

let area: Rect = { left: 0, top: 0, right: 1920, bottom: 1080 };
let rectCss: Rect | null = null;

let dragging = false;

// ---------- Окна как опоры ----------

/** Что отдаёт Rust-команда list_ledges: видимый кусок верхнего края чужого окна. */
interface Ledge {
  id: number;
  left: number;
  right: number;
  y: number;
  wx: number;
}

let ledges: Platform[] = [];
let lastLedges = 0;
/** Край окна, на котором сидит Орфея; null, если на полу или в воздухе. */
let seat: Platform | null = null;
let lastLedgeError = "";
/** Следующий шаг физики разрешает встать на край, даже если ступни уже чуть ниже него (после отпускания). */
let snapNext = false;
/** Когда Rust в последний раз сдвинул её вместе с окном: пока окно едет, рисуем с полной частотой. */
let lastSeatMove = -Infinity;

/** Сидит ли Орфея на чужом окне (для анимаций и реакций). */
export function isSitting(): boolean {
  return seat !== null;
}

function setSeat(p: Platform | null): void {
  if (p === seat) return;
  const prevId = seat?.id ?? 0;
  const was = seat !== null;
  seat = p;
  if (was !== (p !== null)) hostEl?.classList.toggle("is-sitting", p !== null);
  const id = p?.id ?? 0;
  if (id !== prevId) {
    // Rust подписывается на движение этого окна и сам двигает пет вместе с ним (0 — отписаться).
    invoke("seat_watch", { target: id }).catch((err: unknown) => console.error("Орфея: seat_watch.", err));
  }
}

/** Rust уже сдвинул окно пета вместе с окном-опорой: синхронизируем физику, чтобы JS не вернул её назад. */
void win.listen<{ dx: number; dy: number }>("seat-moved", (e) => {
  if (!seat || dragging) return;
  body.x += e.payload.dx;
  body.y += e.payload.dy;
  sentX = Math.round(body.x);
  sentY = Math.round(body.y);
  lastSeatMove = performance.now();
});

/** Берёт свежий список краёв окон и проверяет, что под Орфеей всё ещё есть её окно. */
async function refreshLedges(sh: Rect): Promise<void> {
  try {
    const list = await invoke<Ledge[]>("list_ledges");
    ledges = list.map((l) => ({ id: l.id, left: l.left, right: l.right, top: l.y, wx: l.wx }));
  } catch (err) {
    ledges = [];
    const text = String(err);
    if (text !== lastLedgeError) {
      lastLedgeError = text;
      console.error("Орфея: не удалось получить окна-опоры.", err);
    }
  }
  if (!seat) return;

  const cx = centerX(body, sh);
  const slack = SEAT_SLACK_LOGICAL * dpr();
  const under = ledges.find((p) => p.id === seat?.id && cx >= p.left - slack && cx <= p.right + slack);
  if (under) {
    seat = under; // тот же id: без повторной подписки
  } else {
    // Окно закрыли, свернули, развернули на весь экран или перекрыли место под ней: падаем.
    setSeat(null);
    settled = false;
  }
}
let grabX = 0;
let grabY = 0;
let settled = false;
let ignoring = true;
let sentX = Number.NaN;
let sentY = Number.NaN;

let lastFrame = 0;
let lastHover = 0;
let lastArea = 0;
let lastRect = 0;
let lastSettled = 0;
let busy = false;
let lastError = "";

const dpr = (): number => window.devicePixelRatio || 1;

/** Где внутри окна находится модель, в физических пикселях. */
function shape(): Rect {
  const s = dpr();
  if (!rectCss) return { left: 0, top: 0, right: WIDTH * s, bottom: HEIGHT * s };
  const inset = (rectCss.right - rectCss.left) * HIT_SHRINK;
  return {
    left: (rectCss.left + inset) * s,
    top: rectCss.top * s,
    right: (rectCss.right - inset) * s,
    bottom: rectCss.bottom * s,
  };
}

/** Рабочая область того монитора, над которым сейчас модель (без панели задач). */
async function refreshArea(): Promise<void> {
  const sh = shape();
  const cx = Math.round(body.x + (sh.left + sh.right) / 2);
  const cy = Math.round(body.y + (sh.top + sh.bottom) / 2);
  const monitor = (await monitorFromPoint(cx, cy)) ?? (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) return;
  const { position, size } = monitor.workArea;
  area = {
    left: position.x,
    top: position.y,
    right: position.x + size.width,
    bottom: position.y + size.height,
  };
}

async function moveWindow(): Promise<void> {
  const x = Math.round(body.x);
  const y = Math.round(body.y);
  if (x === sentX && y === sentY) return;
  sentX = x;
  sentY = y;
  await win.setPosition(new PhysicalPosition(x, y));
}

async function setIgnore(value: boolean): Promise<void> {
  if (ignoring === value) return;
  ignoring = value;
  try {
    await win.setIgnoreCursorEvents(value);
  } catch (err) {
    ignoring = !value;
    console.error("Орфея: не удалось переключить прозрачность для мыши.", err);
  }
}

/** Наведён ли курсор (физические координаты экрана) на модель. */
function isOverModel(cx: number, cy: number): boolean {
  if (!rectCss) return false;
  const s = dpr();
  const inset = (rectCss.right - rectCss.left) * HIT_SHRINK;
  const x = (cx - body.x) / s;
  const y = (cy - body.y) / s;
  return x >= rectCss.left + inset && x <= rectCss.right - inset && y >= rectCss.top && y <= rectCss.bottom;
}

// ---------- Кадр ----------

async function tick(now: number): Promise<void> {
  const dt = lastFrame === 0 ? 0.016 : Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (engine && (rectCss === null || dragging || now - lastRect >= RECT_POLL_MS)) {
    rectCss = engine.getModelRect();
    lastRect = now;
  }
  if (!rectCss) {
    // Модели нет: ничего не считаем и не мешаем мыши.
    await setIgnore(true);
    return;
  }

  if (now - lastArea >= (dragging ? AREA_POLL_DRAG_MS : AREA_POLL_MS)) {
    await refreshArea();
    lastArea = now;
  }

  let cursor: PhysicalPosition | null = null;
  if (dragging || now - lastHover >= HOVER_POLL_MS) {
    cursor = await cursorPosition();
    lastHover = now;
  }

  const sh = shape();
  if (dragging) {
    if (cursor) {
      body.x = cursor.x - grabX;
      body.y = cursor.y - grabY;
      clampToArea(body, sh, area);
      body.vy = 0;
      settled = false;
    }
  } else {
    if (now - lastLedges >= (seat ? LEDGE_POLL_SEAT_MS : LEDGE_POLL_MS)) {
      lastLedges = now;
      await refreshLedges(sh);
    }
    // Пока сидит на окне, её двигает Rust вместе с окном, а физику не трогаем: перепроверка по старому
    // краю роняла её при резких сдвигах. Слезает она, только если окно пропало из-под неё (refreshLedges).
    if (!seat && (!settled || now - lastSettled >= SETTLED_RECHECK_MS)) {
      lastSettled = now;
      const snap = snapNext ? SNAP_LOGICAL * dpr() : 0;
      snapNext = false;
      const res = step(body, dt, { scale: dpr(), shape: sh, area, platforms: ledges, snap });
      settled = res.settled;
      setSeat(res.on);
    }
  }

  // Пока Орфея стоит, хватает редких кадров (дыхание и моргание); при движении нужна плавность.
  const moving = dragging || !settled || now - lastSeatMove < SEAT_MOVE_HOLD_MS;
  engine?.setMaxFps(moving ? graphics.activeFps : graphics.idleFps);

  await moveWindow();

  if (!dragging && cursor) await setIgnore(!isOverModel(cursor.x, cursor.y));
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (busy) return;
  busy = true;
  tick(now)
    .catch((err: unknown) => {
      // Одну и ту же ошибку пишем один раз, чтобы не засорять консоль на каждом кадре.
      const text = String(err);
      if (text !== lastError) {
        lastError = text;
        console.error("Орфея: ошибка в цикле пета.", err);
      }
    })
    .finally(() => {
      busy = false;
    });
}

// ---------- Перетаскивание ----------

function startDrag(e: PointerEvent): void {
  if (e.button !== 0 || dragging || !hostEl) return;
  dragging = true;
  settled = false;
  grabX = e.clientX * dpr();
  grabY = e.clientY * dpr();
  hostEl.setPointerCapture(e.pointerId);
  hostEl.classList.add("is-grabbed");
}

function endDrag(): void {
  if (!dragging) return;
  dragging = false;
  hostEl?.classList.remove("is-grabbed");
  // Бросков нет: отпущенная Орфея просто падает прямо вниз под действием гравитации.
  body.vy = 0;
  settled = false;
  setSeat(null);
  lastLedges = 0; // сразу узнать, какие окна сейчас под ней
  snapNext = true;
}

// ---------- Модель и настройки ----------

function applyTuning(): void {
  if (engine && modelName) engine.setTuning(loadTuning(modelName));
}

async function loadModel(): Promise<void> {
  if (!engine) return;
  try {
    const saved = await loadSavedModel();
    if (!saved) {
      modelName = "";
      rectCss = null;
      engine.clearModel();
      return;
    }
    await engine.loadModel(saved.data);
    modelName = saved.name;
    applyTuning();
    settled = false;
  } catch (err) {
    console.error("Орфея: не удалось загрузить модель для пета.", err);
  }
}

/** Первое появление: правый нижний угол рабочей области, чуть выше пола, чтобы Орфея упала на него. */
async function placeInitially(): Promise<void> {
  const pos = await win.outerPosition();
  body.x = pos.x;
  body.y = pos.y;
  await refreshArea();
  const s = dpr();
  body.x = area.right - (WIDTH + MARGIN) * s;
  body.y = area.bottom - (HEIGHT + MARGIN + 80) * s;
  await moveWindow();
}

async function main(): Promise<void> {
  const host = document.getElementById("pet-host");
  if (!host) throw new Error("#pet-host не найден в pet.html");
  hostEl = host;

  try {
    engine = new AvatarEngine(host, { controls: false, lite: true });
  } catch (err) {
    console.error("Орфея: WebGL недоступен, пет не запущен.", err);
    return;
  }
  engine.setActive(true);
  applyGraphics();

  await Promise.allSettled([placeInitially(), win.setIgnoreCursorEvents(true), loadModel()]);

  host.addEventListener("pointerdown", startDrag);
  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);
  host.addEventListener("lostpointercapture", endDrag);

  onAvatarModelChanged(() => void loadModel());
  onAvatarTuningChanged(applyTuning);
  onAvatarGraphicsChanged(applyGraphics);

  requestAnimationFrame(frame);
}

void main();
