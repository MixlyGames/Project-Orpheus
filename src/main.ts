import "@fontsource-variable/golos-text/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./onboarding.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startBackground } from "./background";
import { motionReduced } from "./settings";
import { closeChat, initChat, openChat } from "./chat";
import { installGlobalErrorLogging, log } from "./log";

installGlobalErrorLogging();
log("system", "info", "Приложение запущено.");
startBackground();

// ---------- Профиль (хранится локально, только на этом компьютере) ----------

type Profile = {
  nickname: string;
  about: string;
  createdAt: number;
  updatedAt: number;
};

const PROFILE_KEY = "orpheus.profile";

function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Profile>;
    if (typeof p.nickname !== "string") return null;
    return {
      nickname: p.nickname,
      about: typeof p.about === "string" ? p.about : "",
      createdAt: Number(p.createdAt) || Date.now(),
      updatedAt: Number(p.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить профиль", err);
  }
}

// ---------- Элементы ----------

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} не найден в index.html`);
  return el as T;
}

const card = byId<HTMLElement>("card");
const stepsBox = byId<HTMLElement>("steps");
const dotsBox = byId<HTMLElement>("dots");
const dotThumb = byId<HTMLElement>("dot-thumb");
const enterBtn = byId<HTMLButtonElement>("enter");
const nickInput = byId<HTMLInputElement>("nick");
const nickHint = byId<HTMLElement>("nick-hint");
const nameBack = byId<HTMLButtonElement>("name-back");
const nameNext = byId<HTMLButtonElement>("name-next");
const aboutInput = byId<HTMLTextAreaElement>("about");
const aboutCount = byId<HTMLElement>("about-count");
const aboutBack = byId<HTMLButtonElement>("about-back");
const aboutSkip = byId<HTMLButtonElement>("about-skip");
const aboutDone = byId<HTMLButtonElement>("about-done");
const doneNick = byId<HTMLElement>("done-nick");
const doneEdit = byId<HTMLButtonElement>("done-edit");
const doneContinue = byId<HTMLButtonElement>("done-continue");

// ---------- Шаги ----------

type StepId = "welcome" | "name" | "about" | "done";

// Порядок нужен, чтобы понимать направление: вперёд или назад.
const ORDER: StepId[] = ["welcome", "name", "about", "done"];

const stepEls = new Map<StepId, HTMLElement>();
document.querySelectorAll<HTMLElement>(".step").forEach((el) => {
  stepEls.set(el.dataset.step as StepId, el);
});

const focusTarget: Record<StepId, HTMLElement> = {
  welcome: enterBtn,
  name: nickInput,
  about: aboutInput,
  done: doneContinue,
};

// На сколько пикселей уезжает содержимое при смене шага.
const SHIFT = 22;

let current: StepId = "welcome";
let started = false;

// Высота карточки подстраивается под активный шаг (анимацию делает CSS).
function syncHeight(): void {
  const el = stepEls.get(current);
  if (el) stepsBox.style.height = `${el.offsetHeight}px`;
}

// Если текст перенёсся или окно сузилось, высота обновляется сама.
const resizeObserver = new ResizeObserver((entries) => {
  const active = stepEls.get(current);
  if (entries.some((e) => e.target === active)) syncHeight();
});
stepEls.forEach((el) => resizeObserver.observe(el));

// «Капля» точек: растягивается на обе позиции и перетекает на новую.
const DOT_STEP = 14; // сдвиг капли между позициями, px
let thumbPos: 0 | 1 = 0;

function moveThumb(to: 0 | 1): void {
  if (to === thumbPos) return;
  const from = thumbPos;
  thumbPos = to;
  dotsBox.dataset.pos = String(to);
  if (motionReduced()) return;
  const a = from * DOT_STEP;
  const b = to * DOT_STEP;
  dotThumb.animate(
    [
      { left: `${a}px`, width: "22px" },
      { left: `${Math.min(a, b)}px`, width: `${22 + DOT_STEP}px`, offset: 0.5 },
      { left: `${b}px`, width: "22px" },
    ],
    { duration: 520, easing: "cubic-bezier(0.65, 0, 0.25, 1)" },
  );
}

function show(id: StepId): void {
  const prev = current;
  const dir = ORDER.indexOf(id) >= ORDER.indexOf(prev) ? 1 : -1;
  current = id;

  stepEls.forEach((el, key) => {
    const active = key === id;

    if (started && prev !== id) {
      if (active) {
        // Новый шаг стартует чуть сбоку и «подъезжает» на место.
        el.style.transition = "none";
        el.style.transform = `translateX(${dir * SHIFT}px)`;
        void el.offsetWidth;
        el.style.transition = "";
        el.style.transform = "";
      } else if (key === prev) {
        // Прежний шаг уезжает в противоположную сторону.
        el.style.transform = `translateX(${-dir * SHIFT}px)`;
      }
    }

    el.classList.toggle("is-active", active);
    el.inert = !active;
    el.setAttribute("aria-hidden", String(!active));
  });

  syncHeight();

  // Точки видны только на шагах «имя» и «о себе».
  const hasDots = id === "name" || id === "about";
  dotsBox.classList.toggle("is-visible", hasDots);
  if (hasDots) moveThumb(id === "name" ? 0 : 1);

  if (!started) {
    started = true;
    // Анимацию высоты включаем после первой расстановки, чтобы карточка не «росла» при запуске.
    requestAnimationFrame(() => stepsBox.classList.add("is-animated"));
  }

  // Фокус ставим, когда содержимое уже почти встало на место.
  window.setTimeout(() => {
    if (current === id) focusTarget[id].focus({ preventScroll: true });
  }, 420);
}

// ---------- Никнейм ----------

const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,23}$/u;

function normalizeNick(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isNickValid(value: string): boolean {
  return NICK_RE.test(normalizeNick(value));
}

// Почему ник не подходит. Подсказка показывается только после нажатия «Дальше».
function nickProblem(value: string): string | null {
  const nick = normalizeNick(value);
  if (nick.length === 0) return "Введи имя или ник.";
  if (nick.length < 2) return "Слишком коротко: нужно хотя бы 2 символа.";
  if (!NICK_RE.test(nick)) {
    return "Допустимы буквы, цифры, пробел, точка, дефис и апостроф. Начинаться нужно с буквы или цифры.";
  }
  return null;
}

function showNickError(message: string): void {
  nickHint.textContent = message;
  nickHint.classList.add("is-error");
  nickInput.classList.remove("is-invalid");
  void nickInput.offsetWidth; // перезапуск анимации встряхивания
  nickInput.classList.add("is-invalid");
}

function clearNickError(): void {
  nickHint.textContent = "";
  nickHint.classList.remove("is-error");
  nickInput.classList.remove("is-invalid");
}

// Ошибка исчезает, как только ник стал подходящим.
nickInput.addEventListener("input", () => {
  if (nickHint.classList.contains("is-error") && isNickValid(nickInput.value)) {
    clearNickError();
  }
});
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    nameNext.click();
  }
});

// ---------- О себе ----------

function refreshAbout(): void {
  aboutCount.textContent = `${aboutInput.value.length} / ${aboutInput.maxLength}`;
}

aboutInput.addEventListener("input", refreshAbout);
aboutInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    aboutDone.click();
  }
});

// ---------- Завершение ----------

function finish(useAbout: boolean): void {
  const prev = loadProfile();
  const now = Date.now();
  const nickname = normalizeNick(nickInput.value);
  const about = useAbout ? aboutInput.value.trim() : (prev?.about ?? "");
  saveProfile({
    nickname,
    about,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  });
  doneNick.textContent = nickname;
  show("done");
}

// ---------- Кнопки ----------

enterBtn.addEventListener("click", () => show("name"));
nameBack.addEventListener("click", () => show("welcome"));
nameNext.addEventListener("click", () => {
  const problem = nickProblem(nickInput.value);
  if (problem) {
    showNickError(problem);
    nickInput.focus();
    return;
  }
  clearNickError();
  show("about");
});
aboutBack.addEventListener("click", () => show("name"));
aboutSkip.addEventListener("click", () => finish(false));
aboutDone.addEventListener("click", () => finish(true));
doneEdit.addEventListener("click", () => show("name"));
doneContinue.addEventListener("click", () => {
  // Знакомство закончено: открываем главный экран с чатом.
  openChat();
});

// Esc: шаг назад.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.body.classList.contains("is-chat")) return;
  if (current === "name") show("welcome");
  else if (current === "about") show("name");
});

// ---------- Мягкая подсветка карточки, которая следует за курсором ----------

window.addEventListener("pointermove", (e) => {
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
});

// ---------- Кнопки окна: свернуть, развернуть, закрыть ----------

const appWindow = getCurrentWindow();

async function syncMaximized(): Promise<void> {
  const maximized = await appWindow.isMaximized();
  document.documentElement.classList.toggle("maximized", maximized);
}

document
  .querySelector("#win-min")
  ?.addEventListener("click", () => appWindow.minimize());
document
  .querySelector("#win-max")
  ?.addEventListener("click", () => appWindow.toggleMaximize());
document
  .querySelector("#win-close")
  ?.addEventListener("click", () => appWindow.close());

// Иконка «развернуть/восстановить» меняется при любом изменении размера окна
// (в том числе при двойном клике по панели или перетаскивании к краю экрана).
appWindow.onResized(syncMaximized);
syncMaximized();

// ---------- Старт ----------

const saved = loadProfile();
nickInput.value = saved?.nickname ?? "";
aboutInput.value = saved?.about ?? "";
refreshAbout();

// Первый шаг показываем со следующего кадра, чтобы сработал плавный вход.
initChat({
  getAbout: () => loadProfile()?.about ?? "",
  getNickname: () => loadProfile()?.nickname ?? "",
  // «Изменить профиль» в боковой панели: возвращаемся к вводу имени.
  onEditProfile: () => {
    closeChat();
    show("name");
  },
});

// Профиль уже сохранён: знакомство пропускаем и сразу открываем чат.
if (saved) {
  doneNick.textContent = saved.nickname;
  openChat();
}

requestAnimationFrame(() => show("welcome"));
