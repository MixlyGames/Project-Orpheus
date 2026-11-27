// Физика окна-пета Орфеи: только падение под действием гравитации и посадка на опору. Ни бросков, ни
// отскоков, ни скольжения: Орфею можно взять и перенести, а когда отпустишь, она падает прямо вниз.
// Чистая математика без обращений к окну и DOM, поэтому легко править и проверять отдельно.
//
// Все величины в физических пикселях экрана, ось Y направлена вниз. Тело это левый верхний угол окна;
// форма (shape) задаёт, где внутри окна находится сама модель: по ней считаются стены и линия ступней.
// Опоры (platforms) это горизонтальные поверхности, на которые можно встать сверху: низ рабочей
// области (верх панели задач) и верхние края чужих окон (их отдаёт Rust-команда list_ledges).

export interface Body {
  x: number;
  y: number;
  /** Скорость падения (вниз положительная). Горизонтальной скорости нет. */
  vy: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Горизонтальная опора: встать на неё можно только сверху. */
export interface Platform {
  left: number;
  right: number;
  top: number;
  /** Чьё это окно (дескриптор). У пола нет. */
  id?: number;
  /** Левый край самого окна: по его изменению видно, что окно сдвинули. */
  wx?: number;
}

export interface StepOptions {
  /** Масштаб экрана (физических пикселей на логический). Все скорости ниже заданы в логических. */
  scale: number;
  /** Где внутри окна находится модель (физические пиксели от левого верхнего угла окна). */
  shape: Rect;
  /** Рабочая область экрана без панели задач. Её низ это пол. */
  area: Rect;
  platforms: readonly Platform[];
  /**
   * Насколько ступни могут уже быть ниже края, чтобы на него всё равно встать (физические пиксели).
   * Нужно в момент, когда Орфею отпустили: ступни часто уже чуть заходят на заголовок окна.
   */
  snap?: number;
}

export interface StepResult {
  /** Стоит на опоре: можно перестать считать физику до следующего события. */
  settled: boolean;
  /** Только что приземлилась с заметной скоростью (пригодится для реакции и звука). */
  landed: boolean;
  /** На какой платформе стоит; null, если на полу или в воздухе. */
  on: Platform | null;
}

// Логические пиксели в секунду (и в секунду в квадрате). Подбирались на глаз, правятся здесь.
const GRAVITY = 2600;
const MAX_FALL = 3600;
const LAND_SPEED = 200; // скорость, с которой касание считается приземлением
const EPS = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Центр модели по X в координатах экрана. */
export function centerX(body: Body, shape: Rect): number {
  return body.x + (shape.left + shape.right) / 2;
}

/** Один шаг физики длительностью dt секунд. */
export function step(body: Body, dt: number, o: StepOptions): StepResult {
  const { scale, shape, area, platforms } = o;
  const prevFeet = body.y + shape.bottom;

  body.vy = Math.min(body.vy + GRAVITY * scale * dt, MAX_FALL * scale);
  body.y += body.vy * dt;

  // Не выходит за боковые края и верх рабочей области (если монитор или область изменились).
  body.x = clamp(body.x, area.left - shape.left, area.right - shape.right);
  const minY = area.top - shape.top;
  if (body.y < minY) {
    body.y = minY;
    body.vy = 0;
  }

  // Опоры: сверху можно встать на платформу, если центр модели над ней и ступни её пересекли.
  const feet = body.y + shape.bottom;
  const cx = centerX(body, shape);
  let on: Platform | null = null;
  for (const p of platforms) {
    if (p.top >= area.bottom) continue; // ниже пола (окно уехало под панель задач)
    const reach = Math.max(EPS * scale, o.snap ?? 0);
    if (cx >= p.left && cx <= p.right && body.vy >= 0 && prevFeet <= p.top + reach && feet >= p.top) {
      if (on === null || p.top < on.top) on = p;
    }
  }
  let support: number | null = on ? on.top : null;
  // Пол (верх панели задач) ловит всегда.
  if (feet >= area.bottom && (support === null || area.bottom < support)) {
    support = area.bottom;
    on = null;
  }

  let landed = false;
  if (support !== null) {
    body.y = support - shape.bottom;
    landed = body.vy > LAND_SPEED * scale;
    body.vy = 0;
  }

  return { settled: support !== null, landed, on };
}

/** Не даёт утащить модель за пределы рабочей области или под панель задач (для перетаскивания). */
export function clampToArea(body: Body, shape: Rect, area: Rect): void {
  body.x = clamp(body.x, area.left - shape.left, area.right - shape.right);
  body.y = clamp(body.y, area.top - shape.top, area.bottom - shape.bottom);
}
