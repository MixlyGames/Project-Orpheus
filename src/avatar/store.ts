// Выбранная модель аватара хранится в IndexedDB целиком, чтобы не выбирать файл заново при каждом запуске.
// Хранилище общее для всех окон приложения, поэтому его читает и окно-пет Орфеи.
//
// Кроме выбранной модели (ключ "vrm", её читает пет) есть библиотека: все модели, которые когда-либо
// выбирали. Метаданные и бюст для карточки лежат отдельно от самих файлов, чтобы список открывался
// быстро и не тащил в память все модели сразу.

import { notifyAvatarModelChanged } from "./channel";

const DB_NAME = "orpheus.avatar";
const DB_VERSION = 2;
const STORE = "files";
const KEY = "vrm";
const LIB_META = "library-meta";
const LIB_DATA = "library-data";

export interface SavedModel {
  name: string;
  data: ArrayBuffer;
}

/** Карточка модели в библиотеке (без самого файла). */
export interface LibraryEntry {
  id: string;
  /** Имя файла. */
  name: string;
  /** Название из метаданных VRM, если есть, иначе имя файла. */
  title: string;
  size: number;
  /** Бюст модели для карточки (data URL), пустая строка, если снимок не удался. */
  thumb: string;
  addedAt: number;
  /** Версия кадрирования бюста: когда её повышают, старые бюсты переснимаются при следующей загрузке модели. */
  thumbV: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [STORE, LIB_META, LIB_DATA]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withTx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = action(tx);
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? req.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? req.error);
    };
  });
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withTx([STORE], mode, (tx) => action(tx.objectStore(STORE)));
}

export async function saveModel(model: SavedModel): Promise<void> {
  await run("readwrite", (s) => s.put(model, KEY));
  notifyAvatarModelChanged();
}

export async function loadSavedModel(): Promise<SavedModel | null> {
  const value = await run<unknown>("readonly", (s) => s.get(KEY));
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !(v.data instanceof ArrayBuffer)) return null;
  return { name: v.name, data: v.data };
}

export async function clearSavedModel(): Promise<void> {
  await run("readwrite", (s) => s.delete(KEY));
  notifyAvatarModelChanged();
}

// ---------- Библиотека моделей ----------

/** Одна и та же модель (то же имя файла и размер) всегда получает один id, поэтому дублей не бывает. */
export function libraryId(name: string, size: number): string {
  return `${name}:${size}`;
}

function toEntry(value: unknown): LibraryEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.name !== "string" || typeof v.size !== "number") return null;
  return {
    id: v.id,
    name: v.name,
    title: typeof v.title === "string" && v.title !== "" ? v.title : v.name,
    size: v.size,
    thumb: typeof v.thumb === "string" ? v.thumb : "",
    addedAt: typeof v.addedAt === "number" ? v.addedAt : 0,
    thumbV: typeof v.thumbV === "number" ? v.thumbV : 0,
  };
}

/** Все карточки библиотеки, старые первыми. Сами файлы не читаются. */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const values = await withTx<unknown[]>([LIB_META], "readonly", (tx) => tx.objectStore(LIB_META).getAll());
  return values
    .map(toEntry)
    .filter((e): e is LibraryEntry => e !== null)
    .sort((a, b) => a.addedAt - b.addedAt);
}

export async function getLibraryEntry(id: string): Promise<LibraryEntry | null> {
  const value = await withTx<unknown>([LIB_META], "readonly", (tx) => tx.objectStore(LIB_META).get(id));
  return toEntry(value);
}

export async function getLibraryData(id: string): Promise<ArrayBuffer | null> {
  const value = await withTx<unknown>([LIB_DATA], "readonly", (tx) => tx.objectStore(LIB_DATA).get(id));
  return value instanceof ArrayBuffer ? value : null;
}

/** Кладёт карточку и файл в одной транзакции, чтобы не осталось карточки без файла. */
export async function putLibraryEntry(entry: LibraryEntry, data: ArrayBuffer): Promise<void> {
  await withTx<IDBValidKey>([LIB_META, LIB_DATA], "readwrite", (tx) => {
    tx.objectStore(LIB_DATA).put(data, entry.id);
    return tx.objectStore(LIB_META).put(entry, entry.id);
  });
}

/** Обновляет только карточку (например, новый бюст), сам файл модели не трогает. */
export async function putLibraryMeta(entry: LibraryEntry): Promise<void> {
  await withTx<IDBValidKey>([LIB_META], "readwrite", (tx) => tx.objectStore(LIB_META).put(entry, entry.id));
}

export async function removeLibraryEntry(id: string): Promise<void> {
  await withTx<undefined>([LIB_META, LIB_DATA], "readwrite", (tx) => {
    tx.objectStore(LIB_DATA).delete(id);
    return tx.objectStore(LIB_META).delete(id);
  });
}
