// Библиотека анимаций аватара (вкладка «Анимации»). Файлы лежат в IndexedDB, отдельно от моделей:
// карточки (имя, слот) отдельно от самих байтов, чтобы список читался мгновенно, а файл поднимался
// в память только когда его слот впервые понадобился (см. animator.ts), и сразу же отпускался.
//
// Слот говорит, когда играть анимацию. При добавлении он угадывается по имени файла
// (sit*, drag*, fall*…), потом его можно сменить во вкладке. В одном слоте может быть несколько
// анимаций: тогда они чередуются случайно (например, несколько разных «покоев»).

import { notifyAvatarAnimsChanged } from "./channel";

const DB_NAME = "orpheus.anims";
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

export type AnimSlot = "idle" | "drag" | "fall" | "land" | "sit";

export interface AnimSlotInfo {
  id: AnimSlot;
  title: string;
  desc: string;
  /** Играть по кругу (иначе один раз). */
  loop: boolean;
}

export const ANIM_SLOTS: readonly AnimSlotInfo[] = [
  { id: "idle", title: "Покой", desc: "Стоит без дела. Несколько анимаций чередуются.", loop: true },
  { id: "drag", title: "Перетаскивание", desc: "Пока её держат мышью.", loop: true },
  { id: "fall", title: "Падение", desc: "Летит вниз после того, как отпустили.", loop: true },
  { id: "land", title: "Приземление", desc: "Один раз при касании опоры, потом покой или сидение.", loop: false },
  { id: "sit", title: "Сидит на окне", desc: "На краю чужого окна. Высота посадки берётся из анимации.", loop: true },
];

export interface AnimEntry {
  id: string;
  /** Имя файла. */
  name: string;
  slot: AnimSlot;
  size: number;
  addedAt: number;
}

/** Расширения файлов, из которых берём анимацию. */
export const ANIM_EXT = [".fbx", ".glb", ".gltf"];

const GUESS: [RegExp, AnimSlot][] = [
  [/sit|сид/i, "sit"],
  [/drag|grab|hang|hold|carry|тащ|вис/i, "drag"],
  [/land|приземл/i, "land"],
  [/fall|drop|пад/i, "fall"],
];

/** Угадывает слот по имени файла; по умолчанию «Покой». */
export function guessSlot(fileName: string): AnimSlot {
  for (const [re, slot] of GUESS) if (re.test(fileName)) return slot;
  return "idle";
}

export function isAnimSlot(v: unknown): v is AnimSlot {
  return ANIM_SLOTS.some((s) => s.id === v);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [META, DATA]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, action: (t: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = action(t);
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      reject(t.error ?? req.error);
    };
  });
}

function toEntry(value: unknown): AnimEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.name !== "string" || !isAnimSlot(v.slot)) return null;
  return {
    id: v.id,
    name: v.name,
    slot: v.slot,
    size: typeof v.size === "number" ? v.size : 0,
    addedAt: typeof v.addedAt === "number" ? v.addedAt : 0,
  };
}

/** Все карточки, старые первыми. Байты не читаются. */
export async function listAnims(): Promise<AnimEntry[]> {
  const values = await tx<unknown[]>([META], "readonly", (t) => t.objectStore(META).getAll());
  return values
    .map(toEntry)
    .filter((e): e is AnimEntry => e !== null)
    .sort((a, b) => a.addedAt - b.addedAt);
}

export async function getAnimData(id: string): Promise<ArrayBuffer | null> {
  const value = await tx<unknown>([DATA], "readonly", (t) => t.objectStore(DATA).get(id));
  return value instanceof ArrayBuffer ? value : null;
}

/** Добавляет файл; тот же файл (имя и размер) не дублируется, а перезаписывается. */
export async function addAnim(name: string, data: ArrayBuffer, slot: AnimSlot = guessSlot(name)): Promise<AnimEntry> {
  const entry: AnimEntry = { id: `${name}:${data.byteLength}`, name, slot, size: data.byteLength, addedAt: Date.now() };
  await tx<IDBValidKey>([META, DATA], "readwrite", (t) => {
    t.objectStore(DATA).put(data, entry.id);
    return t.objectStore(META).put(entry, entry.id);
  });
  notifyAvatarAnimsChanged();
  return entry;
}

export async function setAnimSlot(entry: AnimEntry, slot: AnimSlot): Promise<void> {
  await tx<IDBValidKey>([META], "readwrite", (t) => t.objectStore(META).put({ ...entry, slot }, entry.id));
  notifyAvatarAnimsChanged();
}

export async function removeAnim(id: string): Promise<void> {
  await tx<undefined>([META, DATA], "readwrite", (t) => {
    t.objectStore(DATA).delete(id);
    return t.objectStore(META).delete(id);
  });
  notifyAvatarAnimsChanged();
}
