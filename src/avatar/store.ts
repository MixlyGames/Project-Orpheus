// Выбранная модель аватара хранится в IndexedDB целиком, чтобы не выбирать файл заново при каждом запуске.

const DB_NAME = "orpheus.avatar";
const STORE = "files";
const KEY = "vrm";

export interface SavedModel {
  name: string;
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
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

export async function saveModel(model: SavedModel): Promise<void> {
  await run("readwrite", (s) => s.put(model, KEY));
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
}
