// Связь между окнами про аватар. Главное окно и окно-пет работают в одном приложении и делят
// хранилище, но событий об изменениях IndexedDB и localStorage между окнами нет, поэтому о них
// сообщаем сами. Сигналы: "model" (выбрана или удалена модель) и "tuning" (сохранены настройки модели).

const NAME = "orpheus.avatar";

type AvatarSignal = "model" | "tuning";

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

/** Подписка на смену модели в другом окне. Возвращает функцию отписки. */
export function onAvatarModelChanged(cb: () => void): () => void {
  return listen("model", cb);
}

/** Подписка на сохранение настроек модели в другом окне. Возвращает функцию отписки. */
export function onAvatarTuningChanged(cb: () => void): () => void {
  return listen("tuning", cb);
}
