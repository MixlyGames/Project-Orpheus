// Лента шагов над ответом Орфеи: поиск в интернете (запросы, источники, неудачные попытки).
// Всё, что пришло из результатов поиска, выводим только через textContent: это данные из сети.

import "./trace.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isHttpUrl, type SearchStep, type Source } from "./llm";
import { log } from "./log";

export type TraceBlock = {
  el: HTMLDetailsElement;
  /** Перерисовывает ленту по шагам. ms: сколько суммарно заняли поиски. */
  update: (steps: readonly SearchStep[], ms?: number) => void;
  /** Сворачивает ленту, если пользователь сам её не раскрывал и не закрывал. */
  collapse: () => void;
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Иконка сайта. Пока она не загрузилась (или не нашлась), показываем первую букву домена. */
function makeIcon(domain: string): HTMLElement {
  const box = document.createElement("span");
  box.className = "trace-ico";
  box.textContent = (domain[0] ?? "?").toUpperCase();
  if (domain) {
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => box.replaceChildren(img));
    img.src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  }
  return box;
}

function openSource(url: string): void {
  if (!isHttpUrl(url)) return;
  openUrl(url).catch((err) => {
    log("system", "warn", "Не удалось открыть ссылку в браузере.", `${url}\n${String(err)}`);
  });
}

function summaryText(steps: readonly SearchStep[], running: boolean, ms?: number): string {
  if (running) return "Ищу в интернете…";
  const ok = steps.filter((s) => s.status === "done");
  if (ok.length === 0) return "Поиск не удался";
  const n = ok.reduce((sum, s) => sum + s.sources.length, 0);
  let text = `Поиск в интернете · ${n} ${plural(n, "источник", "источника", "источников")}`;
  if (steps.length > 1) text += ` · попыток: ${steps.length}`;
  if (ms && ms >= 500) text += ` · ${(ms / 1000).toFixed(1)} с`;
  return text;
}

function span(className: string, text = ""): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

function buildSummary(text: string): HTMLElement {
  const summary = document.createElement("summary");
  summary.className = "trace-head";
  summary.append(span("trace-dot"), span("trace-title", text), span("trace-chev"));
  return summary;
}

function buildSource(src: Source): HTMLElement {
  const domain = domainOf(src.url);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "trace-src";
  btn.title = src.url;
  btn.append(makeIcon(domain), span("trace-src-title", src.title || domain || src.url), span("trace-src-domain", domain));
  btn.addEventListener("click", () => openSource(src.url));
  return btn;
}

function buildStep(step: SearchStep): HTMLElement {
  const el = document.createElement("div");
  el.className = "trace-step";
  el.dataset.status = step.status;

  let state: string;
  if (step.status === "running") state = "Идёт поиск…";
  else if (step.status === "failed") state = step.reason || "Не удалось найти";
  else state = `${step.sources.length} ${plural(step.sources.length, "источник", "источника", "источников")}`;

  const line = document.createElement("div");
  line.className = "trace-line";
  line.append(span("trace-q", step.query ? `Ищу: «${step.query}»` : "Вызов инструмента"), span("trace-state", state));

  const main = document.createElement("div");
  main.className = "trace-main";
  main.append(line);
  if (step.status === "done") step.sources.forEach((src) => main.append(buildSource(src)));

  el.append(span("trace-mark"), main);
  return el;
}

export function createTraceBlock(): TraceBlock {
  const el = document.createElement("details");
  el.className = "trace";
  el.hidden = true;
  el.open = true;

  // Если пользователь сам раскрыл или закрыл ленту, автоматически её больше не трогаем.
  let touched = false;
  el.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("summary")) touched = true;
  });

  return {
    el,
    update(steps, ms) {
      if (steps.length === 0) {
        el.hidden = true;
        return;
      }
      const running = steps.some((s) => s.status === "running");
      el.hidden = false;
      el.dataset.state = running ? "running" : steps.some((s) => s.status === "done") ? "done" : "failed";

      const body = document.createElement("div");
      body.className = "trace-body";
      steps.forEach((s) => body.append(buildStep(s)));
      el.replaceChildren(buildSummary(summaryText(steps, running, ms)), body);
    },
    collapse() {
      if (!touched) el.open = false;
    },
  };
}
