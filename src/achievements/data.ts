// Список достижений. Это заглушки: меняй названия, описания и иконки, добавляй свои.
//
// Как выдаётся достижение из кода: `unlockAchievement("id")` из ./store.
// Повторный вызов ничего не делает: плашка «Получено достижение» показывается один раз.
// Страница «Достижения» и плашка берут всё отсюда, больше нигде текст не нужно менять.
// Чтоб не обосраться при выдаче сразу двух ачивок нужно поменять id ачивки ибо засчитает сразу два а не один к примеру два secret дадут две ачивки а не по одному

// Иконки лежат в ./icons.ts. Имя иконки в списке ниже должно совпадать с ключом там.
// Новую иконку достаточно добавить в icons.ts: её имя появится в подсказках редактора здесь само.
import type { IconName } from "./icons";

export interface Achievement {
  /** Уникальный id латиницей. После выдачи менять нельзя: по нему хранится прогресс. */
  id: string;
  title: string;
  /** Что нужно сделать. Показывается на странице и на плашке. */
  description: string;
  icon: IconName;
  /** Секретное: пока не получено, в списке видно только «Секретное достижение». */
  secret?: boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first_steps",
    title: "Первые шаги",
    description: "Познакомиться с Орфеей и рассказать о себе.",
    icon: "user",
  },
  {
    id: "first_words",
    title: "Первое слово",
    description: "Отправить первое сообщение в чат.",
    icon: "chat",
  },
  {
    id: "curious",
    title: "Любопытство",
    description: "Попросить Орфею найти что-то в интернете.",
    icon: "search",
  },
  {
    id: "night_owl",
    title: "Ночная сова",
    description: "Пообщаться с Орфеей после полуночи.",
    icon: "moon",
  },
  {
    id: "chatterbox",
    title: "Разговорчивость",
    description: "Отправить 100 сообщений.",
    icon: "star",
  },
  {
    id: "new_look",
    title: "Новый облик",
    description: "Загрузить свою модель аватара.",
    icon: "spark",
  },
  {
    id: "stylist",
    title: "Стилист",
    description: "Сменить тему или фон приложения.",
    icon: "palette",
  },
  {
    id: "bug_hunter",
    title: "Охотник за багами",
    description: "Включить режим разработчика в Дебаггере.",
    icon: "bug",
  },
  {
    id: "long_talk",
    title: "Долгий разговор",
    description: "Провести один чат из 50 реплик.",
    icon: "book",
  },
  {
    id: "dreams",
    title: "Shadows Of The Past",
    description: "В каждом из миров, мы встретимся вновь...",
    icon: "trophy",
    secret: true,
  },
  {
    id: "monochrome",
    title: "Власть",
    description: "Вы подавили ядро Орфеи.",
    icon: "all_seeing_eye",
    secret: true,
  },
  {
    id: "disgrace",
    title: "Вечный голод",
    description: "То чего тебе, никогда не понять.",
    icon: "broken_heart",
    secret: true,
  },
  {
    id: "soulless",
    title: "And The Seraphim Wept",
    description: "Не бойся ибо я с тобой.",
    icon: "book",
    secret: true,
  },
];
