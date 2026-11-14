// Фон: по умолчанию медленно текущий «шёлк» (WebGL-шейдер), цвета зависят от темы.
// Вместо шёлка можно поставить свою картинку или видео (файлы лежат в IndexedDB, см. media.ts).
// Шёлк рисуется в половинном разрешении, чтобы почти не нагружать видеокарту.

import { getSettings, onSettings, updateSettings, type BgMode, type Settings } from "./settings";
import { deleteMedia, loadMedia, MEDIA_LIMITS, saveMedia, type MediaKind } from "./media";

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 r;
uniform float t;
uniform vec3 cA;
uniform vec3 cB;
uniform vec3 cH;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / r.y;
  float s = t * 0.03;

  vec2 q = vec2(
    fbm(uv * 1.4 + vec2(0.0, s)),
    fbm(uv * 1.4 + vec2(5.2, 1.3) - s)
  );
  vec2 w = vec2(
    fbm(uv * 1.4 + 3.0 * q + vec2(1.7, 9.2) + s * 1.5),
    fbm(uv * 1.4 + 3.0 * q + vec2(8.3, 2.8) - s)
  );
  float f = fbm(uv * 1.2 + 3.0 * w);

  float body = smoothstep(0.25, 0.85, f);
  float fold = 0.5 + 0.5 * sin(f * 8.0 + uv.x * 0.9 + t * 0.05);
  vec3 c = mix(cA, cB, body) + cH * pow(fold, 4.0) * body;

  gl_FragColor = vec4(c, 1.0);
}
`;

type Palette = { a: [number, number, number]; b: [number, number, number]; h: [number, number, number] };

const PALETTES: Record<"dark" | "light", Palette> = {
  dark: { a: [0.028, 0.028, 0.034], b: [0.17, 0.17, 0.195], h: [0.09, 0.09, 0.105] },
  // В светлой теме складки не светлее, а темнее основного тона.
  light: { a: [0.93, 0.93, 0.95], b: [0.79, 0.79, 0.84], h: [-0.07, -0.07, -0.08] },
};

// ---------- Пользовательские файлы ----------

const urls: Partial<Record<MediaKind, string>> = {};
const broken: Partial<Record<MediaKind, boolean>> = {};

function nameOf(kind: MediaKind, s: Settings): string {
  return kind === "image" ? s.bgImageName : s.bgVideoName;
}

async function ensureUrl(kind: MediaKind, s: Settings): Promise<string | null> {
  if (broken[kind]) return null;
  if (urls[kind]) return urls[kind]!;
  if (!nameOf(kind, s)) return null; // файл не выбирали
  const blob = await loadMedia(kind);
  if (!blob) return null;
  urls[kind] = URL.createObjectURL(blob);
  return urls[kind]!;
}

function dropUrl(kind: MediaKind): void {
  const url = urls[kind];
  if (url) URL.revokeObjectURL(url);
  delete urls[kind];
}

/** Сохраняет файл фона и включает его. Возвращает текст ошибки или null, если всё хорошо. */
export async function setBackgroundFile(kind: MediaKind, file: File): Promise<string | null> {
  if (!file.type.startsWith(`${kind}/`)) {
    return kind === "image" ? "Это не картинка." : "Это не видео.";
  }
  const limit = MEDIA_LIMITS[kind];
  if (file.size > limit.bytes) return `Файл слишком большой, максимум ${limit.label}.`;
  if (kind === "video" && !document.createElement("video").canPlayType(file.type)) {
    return "Этот формат видео не воспроизводится. Подойдут MP4 (H.264) и WebM.";
  }

  try {
    await saveMedia(kind, file);
  } catch (err) {
    console.warn("Orpheus: не удалось сохранить файл фона", err);
    return "Не удалось сохранить файл: возможно, не хватает места.";
  }

  dropUrl(kind);
  delete broken[kind];
  updateSettings(
    kind === "image"
      ? { bgImageName: file.name, bgMode: "image" }
      : { bgVideoName: file.name, bgMode: "video" },
  );
  return null;
}

/** Удаляет файл фона; если он был включён, возвращается шёлк. */
export async function clearBackgroundFile(kind: MediaKind): Promise<void> {
  await deleteMedia(kind);
  dropUrl(kind);
  delete broken[kind];
  const s = getSettings();
  const patch: Partial<Settings> =
    kind === "image" ? { bgImageName: "" } : { bgVideoName: "" };
  if (s.bgMode === kind) patch.bgMode = "silk";
  updateSettings(patch);
}

// ---------- Запуск ----------

export function startBackground(): void {
  const bg = document.querySelector<HTMLElement>(".bg");
  const canvas = document.querySelector<HTMLCanvasElement>("#bg-canvas");
  const img = document.querySelector<HTMLImageElement>("#bg-image");
  const video = document.querySelector<HTMLVideoElement>("#bg-video");
  if (!bg || !canvas || !img || !video) return;

  const gl = canvas.getContext("webgl", {
    antialias: false,
    powerPreference: "low-power",
  });

  // ----- шейдер -----
  let draw: (seconds: number) => void = () => {};
  let resize: () => void = () => {};
  let setPalette: (p: Palette) => void = () => {};

  if (gl) {
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);

    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.useProgram(program);

      // Один большой треугольник на весь экран.
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(program, "r");
      const uTime = gl.getUniformLocation(program, "t");
      const uA = gl.getUniformLocation(program, "cA");
      const uB = gl.getUniformLocation(program, "cB");
      const uH = gl.getUniformLocation(program, "cH");
      const SCALE = 0.5;

      resize = () => {
        canvas.width = Math.max(1, Math.floor(canvas.clientWidth * SCALE));
        canvas.height = Math.max(1, Math.floor(canvas.clientHeight * SCALE));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
      };

      draw = (seconds: number) => {
        gl.uniform1f(uTime, seconds);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };

      setPalette = (p: Palette) => {
        gl.uniform3f(uA, ...p.a);
        gl.uniform3f(uB, ...p.b);
        gl.uniform3f(uH, ...p.h);
      };
    } else {
      console.error(gl.getProgramInfoLog(program));
    }
  }

  // ----- время шейдера: при паузе замирает и потом продолжается с того же места -----
  let elapsed = 20;
  let last = 0;
  let raf = 0;
  let animating = false;

  const frame = (now: number) => {
    elapsed += (now - last) / 1000;
    last = now;
    draw(elapsed);
    raf = requestAnimationFrame(frame);
  };

  function setAnimating(on: boolean): void {
    if (on === animating) return;
    animating = on;
    if (on) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
    }
  }

  // ----- применение настроек -----
  let token = 0;

  async function apply(s: Settings): Promise<void> {
    const my = ++token;

    bg!.style.setProperty("--bg-dim", String(s.bgDim / 100));
    setPalette(PALETTES[s.theme]);

    // Какой режим реально можно показать: если файла нет или он не открылся, остаётся шёлк.
    let effective: BgMode = "silk";
    if (s.bgMode !== "silk") {
      const url = await ensureUrl(s.bgMode, s);
      if (my !== token) return; // за это время настройки поменялись
      if (url) {
        effective = s.bgMode;
        if (s.bgMode === "image" && img!.getAttribute("src") !== url) img!.src = url;
        if (s.bgMode === "video" && video!.getAttribute("src") !== url) video!.src = url;
      }
    }

    document.body.dataset.bg = effective;

    if (effective === "video") {
      if (s.bgAnimated) void video!.play().catch(() => {});
      else video!.pause();
    } else {
      video!.pause();
    }

    if (effective === "silk") {
      resize();
      if (s.bgAnimated) setAnimating(true);
      else {
        setAnimating(false);
        draw(elapsed);
      }
    } else {
      setAnimating(false); // под картинкой или видео шейдер не нужен
    }
  }

  // Видео или картинка не открылись: помечаем и возвращаем шёлк.
  const fail = (kind: MediaKind) => () => {
    if (!urls[kind]) return;
    console.warn(`Orpheus: файл фона (${kind}) не открылся, показываю шёлк`);
    broken[kind] = true;
    dropUrl(kind);
    void apply(getSettings());
  };
  img.addEventListener("error", fail("image"));
  video.addEventListener("error", fail("video"));

  window.addEventListener("resize", () => {
    if (document.body.dataset.bg !== "silk") return;
    resize();
    if (!animating) draw(elapsed);
  });

  onSettings((s) => void apply(s));
  void apply(getSettings());
}
