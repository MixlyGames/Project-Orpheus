// Связь между окнами про аватар. Главное окно и окно-пет работают в одном приложении и делят
// хранилище, но событий об изменениях IndexedDB и localStorage между окнами нет, поэтому о них
// сообщаем сами. Сигналы: "model" (выбрана или удалена модель), "tuning" (сохранены настройки модели)
// и "graphics" (изменены настройки графики пета).

const NAME = "orpheus.avatar";

type AvatarSignal = "model" | "tuning" | "graphics" | "anims";

function send(signal: AvatarSignal): void {
  try {
    const channel = new BroadcastChannel(NAME);
    channel.postMessage(signal);
    channel.close();
  } catch {
    // Если BroadcastChannel недоступен, пет подхватит изменения при следующем запуске.
  }
}

function listen(signal: AvatarSignal, cb: () => void): () => void {
  const channel = new BroadcastChannel(NAME);
  channel.onmessage = (e: MessageEvent) => {
    if (e.data === signal) cb();
  };
  return () => channel.close();
}

/** Сообщает остальным окнам, что сохранённая модель изменилась. */
export function notifyAvatarModelChanged(): void {
  send("model");
}

/** Сообщает остальным окнам, что настройки модели сохранены. */
export function notifyAvatarTuningChanged(): void {
  send("tuning");
}

/** Сообщает остальным окнам, что настройки графики изменились. */
export function notifyAvatarGraphicsChanged(): void {
  send("graphics");
}

/** Подписка на смену модели в другом окне. Возвращает функцию отписки. */
export function onAvatarModelChanged(cb: () => void): () => void {
  return listen("model", cb);
}

/** Подписка на сохранение настроек модели в другом окне. Возвращает функцию отписки. */
export function onAvatarTuningChanged(cb: () => void): () => void {
  return listen("tuning", cb);
}

/** Подписка на смену настроек графики в другом окне. Возвращает функцию отписки. */
export function onAvatarGraphicsChanged(cb: () => void): () => void {
  return listen("graphics", cb);
}

/** Сообщает остальным окнам, что библиотека анимаций изменилась (добавили, удалили, сменили слот). */
export function notifyAvatarAnimsChanged(): void {
  send("anims");
}

/** Подписка на изменение библиотеки анимаций в другом окне. Возвращает функцию отписки. */
export function onAvatarAnimsChanged(cb: () => void): () => void {
  return listen("anims", cb);
}
