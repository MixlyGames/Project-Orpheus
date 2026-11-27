// Движок аватара: сцена, камера, цикл отрисовки и 3D-модель VRM.
// Он ничего не знает о странице: получает контейнер и сам создаёт в нём canvas.
// Версия VRM (0.x или 1.0) определяется при загрузке: three-vrm приводит выражения к общим именам
// (blink, happy, aa…), а rotateVRM0 разворачивает модели 0.x в то же направление, что и 1.0.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { motionReduced } from "../settings";
import { looksLikeFbx, packBundle, unpackBundle, type BundleFile } from "./bundle";
import type { Avatar, AvatarFraming } from "./types";

export interface ModelInfo {
  /** Название из метаданных модели (может быть пустым). */
  name: string;
  /** Формат загруженной модели. */
  format: "vrm" | "fbx";
  /** Версия VRM; у FBX пусто. */
  vrmVersion: "0.x" | "1.0" | "";
  /** Что не удалось подхватить (например, текстуры, которых не было среди выбранных файлов). */
  warnings: string[];
}

/** Короткая подпись формата для интерфейса и журнала: «VRM 1.0» или «FBX». */
export function describeFormat(info: ModelInfo): string {
  return info.format === "fbx" ? "FBX" : "VRM " + info.vrmVersion;
}

/** Загруженная FBX-модель: у неё нет humanoid и выражений VRM, поэтому всё находится по именам. */
interface FbxModel {
  root: THREE.Group;
  /** Белая заглушка вместо недостающих текстур: по ней видно, каким материалам не хватает картинки. */
  blank: string;
  /** Меши с морф-таргетами (формы лица и тела). */
  morphMeshes: THREE.Mesh[];
  /** Все имена морфов: они же «выражения» для панели разработчика. */
  morphNames: string[];
  /** Морфы, похожие на моргание (оба глаза двигаются вместе). */
  blinkNames: string[];
  boneCount: number;
  spine: THREE.Bone | null;
  spineBase: number;
  chest: THREE.Bone | null;
  chestBase: number;
  head: THREE.Bone | null;
}

/** Исходные данные FBX: нужны, чтобы перезагрузить модель с новыми текстурами и собрать комплект для сохранения. */
interface FbxSource {
  data: ArrayBuffer;
  name: string;
  textures: BundleFile[];
  assign: Record<string, string>;
  matte: boolean;
}

export interface FbxMaterialInfo {
  /** Ключ материала для назначения текстуры (имя, а у повторяющихся имён с номером). */
  key: string;
  name: string;
  /** Цвет материала, например "#ffffff", или пусто. */
  color: string;
  /** ok: текстура есть; missing: в FBX она указана, но файла не было; none: у материала нет текстуры. */
  status: "ok" | "missing" | "none";
  /** Текстура, назначенная вручную, или пусто. */
  assigned: string;
}

export interface FbxEditorState {
  materials: FbxMaterialInfo[];
  /** Имена файлов текстур, которые лежат в комплекте. */
  textures: string[];
  matte: boolean;
}

/** Настройки «жизни» модели. Их можно менять на лету в панели разработчика и сохранять для модели. */
export interface Tuning {
  /** Насколько опускаем руки из T-позы (радианы): 0 это T-поза, 1 (около 57°) даёт А-позу. */
  armDown: number;
  /** Амплитуда дыхания (поворот позвоночника в радианах), 0 выключает. */
  breath: number;
  /** Автоматическое моргание. */
  autoBlink: boolean;
}

export const DEFAULT_TUNING: Readonly<Tuning> = { armDown: 1, breath: 0.012, autoBlink: true };

export interface ModelStats {
  bones: number;
  expressions: string[];
}

const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** Имена морфов, которые считаем морганием (английские, японские из MMD, ARKit eyeBlinkLeft/Right). */
const BLINK_RE = /blink|まばたき|瞬き|eye.?clos/i;

/** Имя файла без пути и регистра: так текстуры из FBX находятся среди выбранных картинок. */
function baseName(url: string): string {
  let s = url.split(/[?#]/)[0] ?? url;
  try {
    s = decodeURIComponent(s);
  } catch {
    // оставляем как есть
  }
  return (s.split(/[\\/]/).pop() ?? s).toLowerCase();
}

function mimeOf(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png" || ext === "webp" || ext === "bmp") return "image/" + ext;
  return "application/octet-stream";
}

/** Белый пиксель вместо недостающей текстуры: модель остаётся видимой, а не чёрной. */
function whitePixel(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
  }
  return canvas.toDataURL("image/png");
}

interface MaterialRef {
  key: string;
  name: string;
  material: THREE.Material;
}

/** Все материалы модели по одному разу, в стабильном порядке обхода: по нему ключи совпадают после перезагрузки. */
function collectMaterials(root: THREE.Object3D): MaterialRef[] {
  const seen = new Set<THREE.Material>();
  const counts = new Map<string, number>();
  const out: MaterialRef[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (seen.has(material)) continue;
      seen.add(material);
      const name = material.name || "материал " + (out.length + 1);
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      out.push({ key: n === 1 ? name : name + "#" + n, name, material });
    }
  });
  return out;
}

function mapOf(material: THREE.Material): THREE.Texture | null {
  return (material as THREE.MeshPhongMaterial).map ?? null;
}

function isBlankMap(material: THREE.Material, blank: string): boolean {
  const image = mapOf(material)?.image as unknown as { src?: string } | undefined;
  return image?.src === blank;
}

async function loadTextureFile(file: BundleFile): Promise<THREE.Texture> {
  const url = URL.createObjectURL(new Blob([file.data], { type: mimeOf(file.name) }));
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = file.name;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Ставит выбранные вручную текстуры на материалы. Что не вышло, попадает в warnings. */
async function applyAssignments(
  root: THREE.Object3D,
  textures: BundleFile[],
  assign: Record<string, string>,
  warnings: string[],
): Promise<void> {
  const materials = collectMaterials(root);
  for (const [key, textureName] of Object.entries(assign)) {
    const target = materials.find((m) => m.key === key);
    const file = textures.find((t) => baseName(t.name) === baseName(textureName));
    if (!target || !file) continue;
    const material = target.material as THREE.MeshPhongMaterial;
    if (!("map" in material)) continue;
    try {
      material.map = await loadTextureFile(file);
      // Цвет FBX умножается на текстуру: у тёмного материала картинка бы не проявилась.
      material.color.set(0xffffff);
      material.needsUpdate = true;
    } catch {
      warnings.push("Не удалось применить текстуру " + file.name + " к материалу «" + key + "».");
    }
  }
}

interface ShinyMaterial {
  isMeshPhongMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  specular: THREE.Color;
  shininess: number;
  roughness: number;
  metalness: number;
  needsUpdate: boolean;
}

const originalShine = new WeakMap<THREE.Material, { specular: number; shininess: number; roughness: number; metalness: number }>();

/** Матовый вид: убирает блик Phong и металличность Standard. Исходные значения запоминаются, переключение обратимо. */
function applyMatte(root: THREE.Object3D, on: boolean): void {
  for (const { material } of collectMaterials(root)) {
    const m = material as unknown as ShinyMaterial;
    let orig = originalShine.get(material);
    if (!orig) {
      orig = {
        specular: m.isMeshPhongMaterial ? m.specular.getHex() : 0x111111,
        shininess: m.isMeshPhongMaterial ? m.shininess : 30,
        roughness: m.isMeshStandardMaterial ? m.roughness : 1,
        metalness: m.isMeshStandardMaterial ? m.metalness : 0,
      };
      originalShine.set(material, orig);
    }
    if (m.isMeshPhongMaterial) {
      m.specular.setHex(on ? 0x000000 : orig.specular);
      m.shininess = on ? 0 : orig.shininess;
    }
    if (m.isMeshStandardMaterial) {
      m.roughness = on ? 1 : orig.roughness;
      m.metalness = on ? 0 : orig.metalness;
    }
    m.needsUpdate = true;
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh as THREE.SkinnedMesh).skeleton?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export class AvatarEngine implements Avatar {
  /** Вызывается примерно дважды в секунду, пока идёт отрисовка. */
  onStats: ((fps: number) => void) | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  private readonly pivot = new THREE.Group();
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private readonly target = new THREE.Vector3(0, 1, 0);

  private vrm: VRM | null = null;
  private fbx: FbxModel | null = null;
  /** Общая подсветка только для FBX: у обычных материалов без неё теневая сторона становится чёрной. */
  private fbxAmbient: THREE.AmbientLight | null = null;
  private fbxSource: FbxSource | null = null;
  private tuning: Tuning = { ...DEFAULT_TUNING };
  private raf = 0;
  private active = false;
  private time = 0;
  private nextBlink = 2;
  private blinkT = -1;
  private baseDistance = 3;
  private zoom = 1;
  private dragging = false;
  private lastX = 0;
  private frames = 0;
  private fpsTime = 0;
  /** Минимальный интервал между кадрами, мс (0 = без ограничения). */
  private minFrameMs = 0;
  private lastRender = 0;

  private framing: AvatarFraming = "full";

  /**
   * options.controls = false отключает собственное управление мышью (вращение и масштаб).
   * Окно-пет так и создаёт движок: там мышь нужна для перетаскивания всего окна.
   */
  constructor(
    private host: HTMLElement,
    options: { controls?: boolean; lite?: boolean } = {},
  ) {
    // lite (окно-пет): потолок разрешения 1.5 и предпочтение встроенной видеокарте. MSAA оставлен:
    // без него мелкие детали лица рвутся. Основная экономия идёт за счёт ограничения FPS.
    const lite = options.lite === true;
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: lite ? "low-power" : "default",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
    this.renderer.domElement.style.touchAction = "none";
    host.prepend(this.renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1, 1.2, 1.6).normalize();
    this.scene.add(light, this.pivot);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    if (options.controls !== false) this.attachControls();
  }

  /** Ограничивает частоту отрисовки (0 или меньше снимает ограничение). Дёшево, можно вызывать каждый кадр. */
  setMaxFps(fps: number): void {
    this.minFrameMs = fps > 0 ? 1000 / fps : 0;
  }

  /** Меняет потолок разрешения отрисовки на лету (качество графики в «Конфиге»). */
  setMaxPixelRatio(max: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, max));
  }

  /**
   * Снимок бюста для карточки модели: на миг ставит план «по пояс», рисует квадрат size × size и
   * возвращает WebP (data URL). Холст и камера после этого возвращаются как были.
   */
  captureBust(size = 192): string | null {
    if (!this.modelRoot) return null;
    const prevFraming = this.framing;
    const prevAspect = this.camera.aspect;
    const prevRatio = this.renderer.getPixelRatio();
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    try {
      this.framing = "bust";
      this.frameModel(true);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(size, size, false);
      this.camera.aspect = 1;
      this.camera.updateProjectionMatrix();
      this.animate(0); // руки опущены, поза как на сцене
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/webp", 0.82);
    } catch {
      return null;
    } finally {
      this.framing = prevFraming;
      this.renderer.setPixelRatio(prevRatio);
      this.renderer.setSize(prevSize.x, prevSize.y, false);
      this.camera.aspect = prevAspect;
      this.camera.updateProjectionMatrix();
      this.frameModel();
    }
  }

  get hasModel(): boolean {
    return this.modelRoot !== null;
  }

  /** Корень загруженной модели, какого бы формата она ни была. */
  private get modelRoot(): THREE.Object3D | null {
    return this.vrm?.scene ?? this.fbx?.root ?? null;
  }

  /**
   * Прямоугольник модели на холсте в CSS-пикселях (по ограничивающему боксу, не по силуэту).
   * Нужен окну-пету, чтобы понять, наведена ли мышь на Орфею и где у неё ступни.
   * null, если модели нет или холст ещё не получил размер.
   */
  getModelRect(): { left: number; top: number; right: number; bottom: number } | null {
    const root = this.modelRoot;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!root || w === 0 || h === 0) return null;

    this.pivot.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const corner = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).project(this.camera);
          const px = (corner.x * 0.5 + 0.5) * w;
          const py = (-corner.y * 0.5 + 0.5) * h;
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
      }
    }
    return { left, top, right, bottom };
  }

  // ---------- Настройки и выражения (для панели разработчика) ----------

  getTuning(): Tuning {
    return { ...this.tuning };
  }

  setTuning(patch: Partial<Tuning>): void {
    Object.assign(this.tuning, patch);
    if (patch.autoBlink === false) {
      this.blinkT = -1;
      this.setBlink(0);
    }
  }

  getStats(): ModelStats {
    if (this.fbx) return this.fbxStats();
    const vrm = this.vrm;
    if (!vrm) return { bones: 0, expressions: [] };
    return {
      bones: Object.values(vrm.humanoid.humanBones).filter((b) => b !== undefined).length,
      expressions: vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? [],
    };
  }

  getExpression(name: string): number {
    if (this.fbx) return this.fbxGetMorph(name);
    return this.vrm?.expressionManager?.getValue(name) ?? 0;
  }

  setExpression(name: string, value: number): void {
    if (this.fbx) {
      this.fbxSetMorph(name, value);
      return;
    }
    this.vrm?.expressionManager?.setValue(name, value);
  }

  resetExpressions(): void {
    if (this.fbx) {
      this.fbxResetMorphs();
      return;
    }
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    for (const e of manager.expressions) manager.setValue(e.expressionName, 0);
  }

  // ---------- Модель ----------

  /**
   * Загружает модель любого поддерживаемого формата: .vrm, .fbx или комплект «FBX + текстуры».
   * Формат определяется по содержимому файла, а не по имени.
   * Старая модель заменяется только после успешной загрузки.
   */
  async loadModel(data: ArrayBuffer): Promise<ModelInfo> {
    if (data.byteLength > MAX_FILE_BYTES) throw new Error("Файл слишком большой (больше 200 МБ).");

    const bundle = unpackBundle(data);
    if (bundle) {
      const [model, ...textures] = bundle.files;
      if (!model) throw new Error("Комплект модели пуст.");
      return this.loadFbx(model.data, model.name, textures, bundle.assign, bundle.matte ?? true);
    }
    if (looksLikeFbx(data)) return this.loadFbx(data, "model.fbx", [], {}, true);
    return this.loadVrm(data);
  }

  /**
   * FBX не знает человеческого скелета и выражений VRM, поэтому здесь всё проще: модель масштабируется
   * до роста 1.6 и ставится ногами на пол, морф-таргеты (формы лица) становятся выражениями, моргание
   * ищется среди них по имени. Текстуры берутся из комплекта по имени файла (путь внутри FBX не важен).
   */
  private async loadFbx(
    data: ArrayBuffer,
    name: string,
    textures: BundleFile[],
    assign: Record<string, string>,
    matte: boolean,
  ): Promise<ModelInfo> {
    const urls = new Map<string, string>();
    for (const t of textures) {
      urls.set(baseName(t.name), URL.createObjectURL(new Blob([t.data], { type: mimeOf(t.name) })));
    }
    const revoke = (): void => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    };

    const blank = whitePixel();
    const missing = new Set<string>();
    const state = { started: false };
    let finish: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const manager = new THREE.LoadingManager();
    manager.onStart = () => {
      state.started = true;
    };
    manager.onLoad = () => finish();
    manager.addHandler(/\.tga$/i, new TGALoader(manager));
    manager.setURLModifier((url) => {
      if (url.startsWith("blob:") || url.startsWith("data:")) return url;
      const key = baseName(url);
      const hit = urls.get(key);
      if (hit) return hit;
      missing.add(key);
      return blank;
    });

    let root: THREE.Group;
    try {
      root = new FBXLoader(manager).parse(data, "");
    } catch (err) {
      revoke();
      throw new Error("Не удалось прочитать FBX: " + (err instanceof Error ? err.message : "файл повреждён") + ".");
    }

    if (!state.started) {
      revoke();
    } else {
      void settled.then(revoke);
      // Ждём текстуры, чтобы бюст для библиотеки снялся уже с ними; зависшую загрузку вечно не ждём.
      await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, 15000))]);
    }

    const wrap = new THREE.Group();
    wrap.add(root);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) {
      disposeObject(wrap);
      throw new Error("В FBX нет видимой геометрии.");
    }
    // FBX бывает в сантиметрах, метрах или чём угодно: приводим к росту 1.6, ступни на полу, по центру.
    wrap.scale.setScalar(1.6 / size.y);
    wrap.updateMatrixWorld(true);
    box.setFromObject(wrap);
    const center = box.getCenter(new THREE.Vector3());
    wrap.position.set(-center.x, -box.min.y, -center.z);
    wrap.updateMatrixWorld(true);

    const morphMeshes: THREE.Mesh[] = [];
    const morphNames = new Set<string>();
    const bones: THREE.Bone[] = [];
    wrap.traverse((o) => {
      o.frustumCulled = false;
      if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
      const mesh = o as THREE.Mesh;
      const dict = mesh.morphTargetDictionary;
      if (mesh.isMesh && dict && mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0) {
        morphMeshes.push(mesh);
        for (const key of Object.keys(dict)) morphNames.add(key);
      }
    });
    const findBone = (re: RegExp): THREE.Bone | null => bones.find((b) => re.test(b.name)) ?? null;
    const spine = findBone(/spine/i);
    const chestCandidate = findBone(/chest|spine_?0?2$/i);
    const chest = chestCandidate !== spine ? chestCandidate : null;
    const head = bones.find((b) => /head$/i.test(b.name) && !/fore/i.test(b.name)) ?? null;
    const names = Array.from(morphNames);

    const warnings: string[] = [];
    await applyAssignments(wrap, textures, assign, warnings);
    applyMatte(wrap, matte);
    const stillMissing = collectMaterials(wrap).some((m) => isBlankMap(m.material, blank));

    this.clearModel();
    if (!this.fbxAmbient) this.fbxAmbient = new THREE.AmbientLight(0xffffff, 1);
    this.scene.add(this.fbxAmbient);
    this.fbx = {
      root: wrap,
      blank,
      morphMeshes,
      morphNames: names,
      blinkNames: names.filter((n) => BLINK_RE.test(n)),
      boneCount: bones.length,
      spine,
      spineBase: spine ? spine.rotation.x : 0,
      chest,
      chestBase: chest ? chest.rotation.x : 0,
      head,
    };
    this.pivot.add(wrap);
    this.fbxSource = { data, name, textures, assign: { ...assign }, matte };
    this.nextBlink = 2;
    this.blinkT = -1;
    this.frameModel();

    if (missing.size > 0 && stillMissing) {
      const list = Array.from(missing);
      warnings.push(
        "Не найдены текстуры (" + list.length + "): " + list.slice(0, 3).join(", ") + (list.length > 3 ? "…" : "") +
          ". Выбирай FBX сразу вместе с картинками.",
      );
    }
    return { name: "", format: "fbx", vrmVersion: "", warnings };
  }

  // ---------- Редактор материалов FBX (панель «Настройка модели») ----------

  /** Состояние редактора или null, если загружена не FBX-модель. */
  getFbxEditor(): FbxEditorState | null {
    const f = this.fbx;
    const s = this.fbxSource;
    if (!f || !s) return null;
    return {
      matte: s.matte,
      textures: s.textures.map((t) => t.name),
      materials: collectMaterials(f.root).map((m) => {
        const color = (m.material as { color?: THREE.Color }).color;
        return {
          key: m.key,
          name: m.name,
          color: color ? "#" + color.getHexString() : "",
          status: mapOf(m.material) === null ? "none" : isBlankMap(m.material, f.blank) ? "missing" : "ok",
          assigned: s.assign[m.key] ?? "",
        };
      }),
    };
  }

  /** Добавляет картинки к модели (одноимённые заменяются) и перезагружает её: текстуры подхватятся по имени. */
  async addFbxTextures(files: BundleFile[]): Promise<ModelInfo> {
    const s = this.fbxSource;
    if (!s) throw new Error("Сейчас загружена не FBX-модель.");
    const incoming = new Set(files.map((f) => baseName(f.name)));
    s.textures = [...s.textures.filter((t) => !incoming.has(baseName(t.name))), ...files];
    return this.reloadFbx();
  }

  /** Назначает текстуру материалу (null возвращает как в файле). Бросает ошибку, если картинка не открылась. */
  async assignFbxTexture(key: string, textureName: string | null): Promise<void> {
    const s = this.fbxSource;
    const f = this.fbx;
    if (!s || !f) return;
    if (textureName === null) {
      delete s.assign[key];
      await this.reloadFbx();
      return;
    }
    s.assign[key] = textureName;
    const warnings: string[] = [];
    await applyAssignments(f.root, s.textures, { [key]: textureName }, warnings);
    if (warnings.length > 0) throw new Error(warnings[0]);
  }

  setFbxMatte(on: boolean): void {
    const f = this.fbx;
    const s = this.fbxSource;
    if (!f || !s) return;
    s.matte = on;
    applyMatte(f.root, on);
  }

  /** Комплект для сохранения: модель, текстуры, ручные назначения и матовый вид. null для не-FBX. */
  exportBundle(): ArrayBuffer | null {
    const s = this.fbxSource;
    if (!s) return null;
    return packBundle([{ name: s.name, data: s.data }, ...s.textures], { assign: s.assign, matte: s.matte });
  }

  private reloadFbx(): Promise<ModelInfo> {
    const s = this.fbxSource;
    if (!s) return Promise.reject(new Error("Сейчас загружена не FBX-модель."));
    return this.loadFbx(s.data, s.name, s.textures, s.assign, s.matte);
  }

  private disposeFbx(): void {
    const f = this.fbx;
    if (!f) return;
    this.pivot.remove(f.root);
    if (this.fbxAmbient) this.scene.remove(this.fbxAmbient);
    disposeObject(f.root);
    this.fbx = null;
    this.fbxSource = null;
  }

  private setBlink(value: number): void {
    if (this.fbx) {
      for (const n of this.fbx.blinkNames) this.fbxSetMorph(n, value);
    } else {
      this.vrm?.expressionManager?.setValue("blink", value);
    }
  }

  private fbxStats(): ModelStats {
    const f = this.fbx;
    return f ? { bones: f.boneCount, expressions: f.morphNames } : { bones: 0, expressions: [] };
  }

  private fbxGetMorph(name: string): number {
    for (const m of this.fbx?.morphMeshes ?? []) {
      const i = m.morphTargetDictionary?.[name];
      if (i !== undefined) return m.morphTargetInfluences?.[i] ?? 0;
    }
    return 0;
  }

  private fbxSetMorph(name: string, value: number): void {
    for (const m of this.fbx?.morphMeshes ?? []) {
      const i = m.morphTargetDictionary?.[name];
      if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = value;
    }
  }

  private fbxResetMorphs(): void {
    for (const m of this.fbx?.morphMeshes ?? []) m.morphTargetInfluences?.fill(0);
  }

  /** Для FBX: лёгкое дыхание (позвоночник, если нашёлся) и моргание через морфы. Руки не трогаем: оси у костей разные. */
  private animateFbx(dt: number): void {
    const f = this.fbx;
    if (!f) return;
    this.time += dt;

    if (!motionReduced()) {
      const breath = Math.sin(this.time * 1.8) * this.tuning.breath;
      if (f.spine) f.spine.rotation.x = f.spineBase + breath;
      if (f.chest) f.chest.rotation.x = f.chestBase + breath;
    }

    if (this.tuning.autoBlink && f.blinkNames.length > 0) {
      this.nextBlink -= dt;
      if (this.blinkT < 0 && this.nextBlink <= 0) this.blinkT = 0;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const p = this.blinkT / 0.16;
        this.setBlink(p >= 1 ? 0 : Math.sin(p * Math.PI));
        if (p >= 1) {
          this.blinkT = -1;
          this.nextBlink = 2 + Math.random() * 3.5;
        }
      }
    }
  }

  /** Загружает модель из файла .vrm. Старая модель заменяется только после успешной загрузки. */
  async loadVrm(data: ArrayBuffer): Promise<ModelInfo> {
    if (data.byteLength > MAX_FILE_BYTES) throw new Error("Файл слишком большой (больше 200 МБ).");

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(data, "");
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error("В файле нет данных VRM: это обычный GLB или файл повреждён.");

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
    });

    this.clearModel();
    this.vrm = vrm;
    this.pivot.add(vrm.scene);
    this.nextBlink = 2;
    this.blinkT = -1;
    this.frameModel();

    const meta = vrm.meta;
    return meta.metaVersion === "0"
      ? { name: meta.title ?? "", format: "vrm", vrmVersion: "0.x", warnings: [] }
      : { name: meta.name ?? "", format: "vrm", vrmVersion: "1.0", warnings: [] };
  }

  clearModel(): void {
    if (this.fbx) this.disposeFbx();
    if (!this.vrm) return;
    this.pivot.remove(this.vrm.scene);
    VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
  }

  /** Запускает или останавливает отрисовку (скрытая вкладка не должна грузить видеокарту). */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.clock.getDelta();
      this.frames = 0;
      this.fpsTime = 0;
      this.resize();
      this.tick();
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  dispose(): void {
    this.setActive(false);
    this.resizeObserver.disconnect();
    this.clearModel();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.minFrameMs > 0) {
      // Ограничение частоты кадров: лишние кадры пропускаем, не рисуя и не считая анимацию.
      const now = performance.now();
      if (now - this.lastRender < this.minFrameMs - 1) return;
      this.lastRender = now;
    }
    const raw = this.clock.getDelta();
    this.animate(Math.min(raw, 0.1));
    this.renderer.render(this.scene, this.camera);

    this.frames += 1;
    this.fpsTime += raw;
    if (this.fpsTime >= 0.5) {
      this.onStats?.(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
  };

  /** Пока без внешних команд: руки опущены, лёгкое дыхание и моргание. */
  private animate(dt: number): void {
    if (this.fbx) {
      this.animateFbx(dt);
      return;
    }
    const vrm = this.vrm;
    if (!vrm) return;
    this.time += dt;

    const humanoid = vrm.humanoid;
    const leftArm = humanoid.getNormalizedBoneNode("leftUpperArm");
    const rightArm = humanoid.getNormalizedBoneNode("rightUpperArm");
    if (leftArm) leftArm.rotation.z = this.tuning.armDown;
    if (rightArm) rightArm.rotation.z = -this.tuning.armDown;

    if (!motionReduced()) {
      const breath = Math.sin(this.time * 1.8) * this.tuning.breath;
      const spine = humanoid.getNormalizedBoneNode("spine");
      const chest = humanoid.getNormalizedBoneNode("chest");
      if (spine) spine.rotation.x = breath;
      if (chest) chest.rotation.x = breath;
    }

    if (this.tuning.autoBlink) {
      this.nextBlink -= dt;
      if (this.blinkT < 0 && this.nextBlink <= 0) this.blinkT = 0;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const p = this.blinkT / 0.16;
        vrm.expressionManager?.setValue("blink", p >= 1 ? 0 : Math.sin(p * Math.PI));
        if (p >= 1) {
          this.blinkT = -1;
          this.nextBlink = 2 + Math.random() * 3.5;
        }
      }
    }

    vrm.update(dt);
  }

  /** Переносит холст в другой контейнер (вкладка «Аватар», квадрат в чате) и ставит нужный план. */
  attach(host: HTMLElement, framing: AvatarFraming = "full"): void {
    if (host === this.host && framing === this.framing) return;
    if (host !== this.host) {
      this.host = host;
      this.resizeObserver.disconnect();
      host.prepend(this.renderer.domElement);
      this.resizeObserver.observe(host);
    }
    this.framing = framing;
    this.resize();
    this.frameModel();
  }

  /** Ставит камеру по выбранному плану: модель целиком, по пояс или лицо. */
  private frameModel(portrait = false): void {
    const vrm = this.vrm;
    const root = this.modelRoot;
    if (!root) return;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 0.5);

    // Высота головы: по кости, а если её нет, то по доле роста.
    const headPos = new THREE.Vector3(center.x, box.min.y + height * 0.9, center.z);
    if (vrm) vrm.humanoid.getNormalizedBoneNode("head")?.getWorldPosition(headPos);
    else this.fbx?.head?.getWorldPosition(headPos);

    // visible: сколько метров по вертикали должно поместиться в кадр.
    const targetPos = center.clone();
    let visible = height * 1.2;
    if (portrait) {
      // Портрет для карточки: голова целиком, шея и самый верх плеч.
      targetPos.y = headPos.y - height * 0.035;
      visible = height * 0.32;
    } else if (this.framing === "bust") {
      targetPos.y = headPos.y - height * 0.1;
      visible = height * 0.5;
    } else if (this.framing === "face") {
      targetPos.y = headPos.y + height * 0.01;
      visible = height * 0.24;
    }

    this.target.copy(targetPos);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.baseDistance = visible / 2 / Math.tan(fov / 2);
    this.zoom = 1;
    this.pivot.rotation.y = 0;
    this.placeCamera();
  }

  private placeCamera(): void {
    this.camera.position.set(
      this.target.x,
      this.target.y + this.baseDistance * 0.04,
      this.target.z + this.baseDistance * this.zoom,
    );
    this.camera.lookAt(this.target);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Мышь: перетаскивание поворачивает модель, Ctrl + колесо масштабирует, двойной клик сбрасывает. */
  private attachControls(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.pivot.rotation.y += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
    const stop = (e: PointerEvent): void => {
      this.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return; // обычное колесо листает страницу
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.35, 1.8);
        this.placeCamera();
      },
      { passive: false },
    );
    el.addEventListener("dblclick", () => {
      this.pivot.rotation.y = 0;
      this.zoom = 1;
      this.placeCamera();
    });
  }
}
