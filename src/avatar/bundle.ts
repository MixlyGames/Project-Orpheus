// Комплект модели «FBX + текстуры» в одном ArrayBuffer.
//
// FBX часто лежит рядом с картинками текстур, а хранилище (store.ts) умеет держать модель только как
// один файл. Поэтому при выборе нескольких файлов мы склеиваем их в один буфер: хранилище, библиотека
// и окно-пет продолжают работать как раньше, а движок сам распаковывает комплект.
//
// Формат: 4 байта "ORPB", uint32 (LE) длина JSON, JSON, затем данные файлов подряд.
// JSON: {"files":[{"name","size"}], "assign":{материал: файл текстуры}, "matte": true|false}.
// Первый файл в списке это сама модель, остальные текстуры. assign и matte появляются, когда
// их меняют в редакторе материалов (панель «Настройка модели»); окно-пет читает их отсюда же.

export interface BundleFile {
  name: string;
  data: ArrayBuffer;
}

export interface BundleOptions {
  /** Какая текстура назначена какому материалу вручную (ключ материала → имя файла). */
  assign?: Record<string, string>;
  /** Матовые материалы без блика. Если не задано, движок включает матовый вид сам. */
  matte?: boolean;
}

export interface UnpackedBundle {
  files: BundleFile[];
  assign: Record<string, string>;
  matte: boolean | undefined;
}

const MAGIC = [0x4f, 0x52, 0x50, 0x42]; // "ORPB"
const HEADER = 8;

/** Расширения картинок, которые можно приложить к FBX как текстуры. */
export const TEXTURE_EXT = /\.(png|jpe?g|webp|bmp|tga)$/i;

/** FBX бывает двоичным («Kaydara FBX Binary») и текстовым (первая строка начинается с «; FBX»). */
export function looksLikeFbx(data: ArrayBuffer): boolean {
  if (data.byteLength < 32) return false;
  const head = new TextDecoder("latin1").decode(new Uint8Array(data, 0, 32));
  return head.startsWith("Kaydara FBX Binary") || head.startsWith("; FBX");
}

export function isBundle(data: ArrayBuffer): boolean {
  if (data.byteLength < HEADER) return false;
  const bytes = new Uint8Array(data, 0, 4);
  return MAGIC.every((b, i) => bytes[i] === b);
}

export function packBundle(files: BundleFile[], options: BundleOptions = {}): ArrayBuffer {
  const json = new TextEncoder().encode(
    JSON.stringify({
      files: files.map((f) => ({ name: f.name, size: f.data.byteLength })),
      assign: options.assign ?? {},
      matte: options.matte,
    }),
  );
  const total = HEADER + json.byteLength + files.reduce((sum, f) => sum + f.data.byteLength, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.byteLength, true);
  out.set(json, HEADER);
  let offset = HEADER + json.byteLength;
  for (const f of files) {
    out.set(new Uint8Array(f.data), offset);
    offset += f.data.byteLength;
  }
  return out.buffer;
}

/** Возвращает содержимое комплекта (модель в files первой) или null, если это не комплект. */
export function unpackBundle(data: ArrayBuffer): UnpackedBundle | null {
  if (!isBundle(data)) return null;
  const jsonLen = new DataView(data).getUint32(4, true);
  if (HEADER + jsonLen > data.byteLength) throw new Error("Комплект модели повреждён.");
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(data, HEADER, jsonLen))) as {
    files?: { name?: unknown; size?: unknown }[];
    assign?: unknown;
    matte?: unknown;
  };
  if (!Array.isArray(meta.files) || meta.files.length === 0) throw new Error("Комплект модели пуст.");

  const files: BundleFile[] = [];
  let offset = HEADER + jsonLen;
  for (const f of meta.files) {
    if (typeof f.name !== "string" || typeof f.size !== "number") throw new Error("Комплект модели повреждён.");
    if (offset + f.size > data.byteLength) throw new Error("Комплект модели повреждён.");
    files.push({ name: f.name, data: data.slice(offset, offset + f.size) });
    offset += f.size;
  }

  const assign: Record<string, string> = {};
  if (meta.assign && typeof meta.assign === "object") {
    for (const [key, value] of Object.entries(meta.assign as Record<string, unknown>)) {
      if (typeof value === "string") assign[key] = value;
    }
  }
  return { files, assign, matte: typeof meta.matte === "boolean" ? meta.matte : undefined };
}
