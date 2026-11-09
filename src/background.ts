// Фон: медленно текущий «шёлк» в серо-чёрных тонах (WebGL-шейдер).
// Рисуется в половинном разрешении, чтобы почти не нагружать видеокарту.

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 r;
uniform float t;

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

  vec3 dark = vec3(0.028, 0.028, 0.034);
  vec3 mid = vec3(0.17, 0.17, 0.195);

  float body = smoothstep(0.25, 0.85, f);
  float fold = 0.5 + 0.5 * sin(f * 8.0 + uv.x * 0.9 + t * 0.05);
  vec3 c = mix(dark, mid, body) + vec3(0.09, 0.09, 0.105) * pow(fold, 4.0) * body;

  gl_FragColor = vec4(c, 1.0);
}
`;

export function startBackground() {
  const canvas = document.querySelector<HTMLCanvasElement>("#bg-canvas");
  const gl = canvas?.getContext("webgl", {
    antialias: false,
    powerPreference: "low-power",
  });
  if (!canvas || !gl) return; // без WebGL останется просто тёмный фон

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
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  // Один большой треугольник на весь экран.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(program, "r");
  const uTime = gl.getUniformLocation(program, "t");
  const SCALE = 0.5;

  const resize = () => {
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * SCALE));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };

  const draw = (seconds: number) => {
    gl.uniform1f(uTime, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const start = performance.now();

  const frame = (now: number) => {
    draw((now - start) / 1000 + 20);
    requestAnimationFrame(frame);
  };

  resize();
  window.addEventListener("resize", () => {
    resize();
    if (reduceMotion) draw(20);
  });

  if (reduceMotion) draw(20);
  else requestAnimationFrame(frame);
}
