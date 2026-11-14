// Движок аватара: сцена, камера, цикл отрисовки и 3D-модель VRM.
// Он ничего не знает о странице: получает контейнер и сам создаёт в нём canvas.
// Версия VRM (0.x или 1.0) определяется при загрузке: three-vrm приводит выражения к общим именам
// (blink, happy, aa…), а rotateVRM0 разворачивает модели 0.x в то же направление, что и 1.0.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { motionReduced } from "../settings";

export interface ModelInfo {
  /** Название из метаданных модели (может быть пустым). */
  name: string;
  vrmVersion: "0.x" | "1.0";
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

export class AvatarEngine {
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

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.style.touchAction = "none";
    host.prepend(this.renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1, 1.2, 1.6).normalize();
    this.scene.add(light, this.pivot);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.attachControls();
  }

  get hasModel(): boolean {
    return this.vrm !== null;
  }

  // ---------- Настройки и выражения (для панели разработчика) ----------

  getTuning(): Tuning {
    return { ...this.tuning };
  }

  setTuning(patch: Partial<Tuning>): void {
    Object.assign(this.tuning, patch);
    if (patch.autoBlink === false) {
      this.blinkT = -1;
      this.vrm?.expressionManager?.setValue("blink", 0);
    }
  }

  getStats(): ModelStats {
    const vrm = this.vrm;
    if (!vrm) return { bones: 0, expressions: [] };
    return {
      bones: Object.values(vrm.humanoid.humanBones).filter((b) => b !== undefined).length,
      expressions: vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? [],
    };
  }

  getExpression(name: string): number {
    return this.vrm?.expressionManager?.getValue(name) ?? 0;
  }

  setExpression(name: string, value: number): void {
    this.vrm?.expressionManager?.setValue(name, value);
  }

  resetExpressions(): void {
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    for (const e of manager.expressions) manager.setValue(e.expressionName, 0);
  }

  // ---------- Модель ----------

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
      ? { name: meta.title ?? "", vrmVersion: "0.x" }
      : { name: meta.name ?? "", vrmVersion: "1.0" };
  }

  clearModel(): void {
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

  /** Ставит камеру так, чтобы модель целиком помещалась в кадр. */
  private frameModel(): void {
    if (!this.vrm) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    this.target.copy(box.getCenter(new THREE.Vector3()));
    const height = Math.max(size.y, 0.5);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.baseDistance = (height / 2 / Math.tan(fov / 2)) * 1.2;
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
