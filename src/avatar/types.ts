// Общий интерфейс аватара. Его реализует 3D-движок (VRM) и будет реализовывать 2D (спрайтшиты):
// остальное приложение работает только с ним и не знает, что внутри.

/** План камеры: целиком (вкладка «Аватар»), по пояс или лицо (квадрат в чате). */
export type AvatarFraming = "full" | "bust" | "face";

export interface Avatar {
  readonly hasModel: boolean;
  /** Переносит изображение в другой контейнер и ставит план. */
  attach(host: HTMLElement, framing?: AvatarFraming): void;
  /** Запускает или останавливает отрисовку (скрытый аватар не должен грузить видеокарту). */
  setActive(on: boolean): void;
  dispose(): void;
}
