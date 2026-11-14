// Пользовательские файлы фона (картинка, видео). Хранятся локально в IndexedDB:
// localStorage для них мал, а доступ к диску из окна мы не открываем.

export type MediaKind = "image" | "video";

/** Ограничения, чтобы случайно не положить в хранилище гигабайты. */
export const MEDIA_LIMITS: Record<MediaKind, { bytes: number; label: string }> = {
  image: { bytes: 30 * 1024 * 1024, label: "30 МБ" },
  video: { bytes: 300 * 1024 * 1024, label: "300 МБ" },
};

const DB_NAME = "orpheus.media";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveMedia(kind: MediaKind, file: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(file, kind));
}

export async function loadMedia(kind: MediaKind): Promise<Blob | null> {
  try {
    const blob = await run<Blob | undefined>("readonly", (s) => s.get(kind));
    return blob ?? null;
  } catch (err) {
    console.warn("Orpheus: не удалось прочитать файл фона", err);
    return null;
  }
}

export async function deleteMedia(kind: MediaKind): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(kind));
  } catch (err) {
    console.warn("Orpheus: не удалось удалить файл фона", err);
  }
}
