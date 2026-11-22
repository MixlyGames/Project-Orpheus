// Эмоции Орфеи для события подавления ядра (см. CORE_SUPPRESSION.md).
//
// У каждой эмоции есть «окно» шириной SPAN пунктов, внутри которого на экране прыгает значение:
// сначала 0–30, потом 20–50 и так далее, пока окно не упрётся в потолок (70–100).
// Переход к следующей фазе происходит не когда значение случайно мигнуло до 100, а когда
// эмоцию «зафиксировали»: raise() на уже верхнем окне замораживает её на 100.
// Здесь только модель. Что именно поднимает окна (выбор в окнах работ, действия игрока),
// подключается позже.

export type EmotionId = "hate" | "trust" | "joy" | "fear" | "sorrow";

export const EMOTIONS: readonly { id: EmotionId; label: string }[] = [
  { id: "hate", label: "Ненависть" },
  { id: "trust", label: "Доверие" },
  { id: "joy", label: "Радость" },
  { id: "fear", label: "Страх" },
  { id: "sorrow", label: "Печаль" },
];

const SPAN = 30;
const TOP = 100 - SPAN; // нижняя граница самого верхнего окна (70–100)

type Slot = { lo: number; locked: boolean };

export class EmotionModel {
  private slots = new Map<EmotionId, Slot>();
  private lockListeners = new Set<(id: EmotionId) => void>();

  constructor() {
    this.reset();
  }

  /** Все эмоции в начальное окно 0–30, фиксации сняты. */
  reset(): void {
    for (const e of EMOTIONS) this.slots.set(e.id, { lo: 0, locked: false });
  }

  private slot(id: EmotionId): Slot {
    const s = this.slots.get(id);
    if (!s) throw new Error(`Неизвестная эмоция: ${id}`);
    return s;
  }

  /**
   * Сдвигает окно вверх. Если оно уже на потолке, фиксирует эмоцию на 100.
   * canLock = false: эмоция может дойти до потолка, но не замораживается (для эмоций,
   * которые не запускают следующую фазу).
   */
  raise(id: EmotionId, step = 20, canLock = true): void {
    const s = this.slot(id);
    if (s.locked) return;
    if (s.lo >= TOP) {
      if (!canLock) return;
      s.locked = true;
      this.lockListeners.forEach((cb) => cb(id));
      return;
    }
    s.lo = Math.min(TOP, s.lo + step);
  }

  /** Сдвигает окно вниз. Зафиксированную эмоцию не трогает. */
  lower(id: EmotionId, step = 10): void {
    const s = this.slot(id);
    if (!s.locked) s.lo = Math.max(0, s.lo - step);
  }

  isLocked(id: EmotionId): boolean {
    return this.slot(id).locked;
  }

  /** Случайное значение внутри текущего окна (для шкалы на экране). */
  sample(id: EmotionId): number {
    const s = this.slot(id);
    if (s.locked) return 100;
    return Math.round(s.lo + Math.random() * SPAN);
  }

  /** Вызывается, когда эмоция зафиксирована на 100. Возвращает функцию отписки. */
  onLock(cb: (id: EmotionId) => void): () => void {
    this.lockListeners.add(cb);
    return () => this.lockListeners.delete(cb);
  }
}

/** Общая модель на всё приложение: шкалы в событии и потом во вкладке «Власть» читают её. */
export const emotions = new EmotionModel();
