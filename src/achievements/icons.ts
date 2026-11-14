// Иконки достижений: простые контурные рисунки 16×16 в том же стиле, что и остальной интерфейс.
//
// Чтобы добавить иконку, допиши её сюда: ключ это имя для data.ts, значение это список контуров
// (атрибут d у <path>). Больше нигде ничего менять не нужно: имя появится в подсказках редактора
// в data.ts само (тип IconName).
//
// Опечатка или неизвестное имя интерфейс не ломает: показывается запасная иконка,
// а в «Дебаггере» появляется предупреждение.

const NS = "http://www.w3.org/2000/svg";
const FALLBACK = "trophy";

const ICONS = {
  star: [
    "M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6L8 2z",
  ],

  chat: [
    "M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11A1.5 1.5 0 0 1 3 9.5v-5z",
  ],

  search: [
    "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
    "M10.5 10.5l3 3",
  ],

  palette: [
    "M8 2.5a5.5 5.5 0 1 0 0 11c.9 0 1.2-.6.9-1.2-.4-.8.1-1.8 1-1.8h1.6A2.5 2.5 0 0 0 14 8c0-3-2.7-5.5-6-5.5z",
    "M5.2 7.2h.01M7.5 5h.01M10.2 5.8h.01",
  ],

  user: [
    "M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    "M3.2 13c.6-2.4 2.4-3.6 4.8-3.6s4.2 1.2 4.8 3.6",
  ],

  bug: [
    "M8 5a2.5 3 0 0 1 2.5 3v1.5a2.5 2.5 0 0 1-5 0V8A2.5 3 0 0 1 8 5z",
    "M5.5 8H3M10.5 8H13M5.8 11L4 12.5M10.2 11l1.8 1.5M6.5 3.5L7.3 5M9.5 3.5L8.7 5",
  ],

  moon: [
    "M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z",
  ],

  book: [
    "M3 3.5h4a1 1 0 0 1 1 1V13a1 1 0 0 0-1-1H3V3.5z",
    "M13 3.5H9a1 1 0 0 0-1 1V13a1 1 0 0 1 1-1h4V3.5z",
  ],

  trophy: [
    "M5 2.5h6v3.2a3 3 0 0 1-6 0V2.5z",
    "M5 4H3a2 2 0 0 0 2 3M11 4h2a2 2 0 0 1-2 3M8 8.7V11M5.5 13.5h5M6.5 11h3",
  ],

  spark: [
    "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2",
  ],

  // Сбой сердца
  broken_heart: [
    "M8 13.5S1.5 9.5 1.5 5.8A3 3 0 0 1 7 3.5L8 5l1-1.5a3 3 0 0 1 5.5 2.3c0 3.7-6.5 7.7-6.5 7.7z",
    "M9 5.5L6.5 8h2l-1 3",
  ],

  // Всевидящее око
  all_seeing_eye: [
    "M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z",
    "M10.5 8a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0z",
    "M8 3.5V2M8 14v-1.5",
  ],

  // Служебная: замок для секретных достижений (в data.ts её указывать не нужно).
  lock: [
    "M5 7V5.5a3 3 0 0 1 6 0V7",
    "M4 7h8v6H4z",
  ],
} satisfies Record<string, string[]>;

/** Имена иконок, которые можно указывать в data.ts. */
export type IconName = Exclude<keyof typeof ICONS, "lock">;

function paths(name: string): string[] | undefined {
  // hasOwnProperty, чтобы имена вроде "constructor" не принимались за иконки.
  return Object.prototype.hasOwnProperty.call(ICONS, name)
    ? (ICONS as Record<string, string[]>)[name]
    : undefined;
}

export function hasIcon(name: string): boolean {
  return paths(name) !== undefined;
}

export function iconSvg(name: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");

  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  for (const d of paths(name) ?? paths(FALLBACK) ?? []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }

  return svg;
}
