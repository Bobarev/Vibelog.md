/**
 * Общая визуал-конфигурация задач (VL-211) по паттерну ref-2
 * (task-status.ts / task-priority.ts / tagTones из data.ts).
 *
 * Используется и в List-виде (tasks-list.tsx), и в Table (tasks-table.tsx),
 * чтобы бэйджи/иконки/цвета совпадали между видами, как в референсе.
 *
 * Статусы у нас динамические (backlog/config.yml), в отличие от статичных
 * ideas/planned/... в ref-2: карта покрывает дефолтный конфиг проекта
 * (Backlog…Blocked), неизвестный статус → Circle (fallback, чтобы
 * пользовательские статусы не падали).
 */

import {
  CalendarDays,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleEllipsis,
  ChevronUp,
  Flame,
  Hash,
  ListTodo,
  MessageSquare,
  Minus,
  Tag,
  Tags,
  Flag,
  type LucideIcon,
} from "lucide-react";

/**
 * Иконки статусов: дефолтный конфиг Vibelog (backlog/config.yml statuses).
 * По образцу ref-2 task-status.ts (ideas→CircleDashed, …, shipped→CircleCheck).
 */
export const statusIcons: Record<string, LucideIcon> = {
  Backlog: CircleDashed, // ещё не взята в работу — пунктирный круг
  "To Do": Circle, // запланирована — пустой круг
  Spec: CircleDot, // прорабатывается — точка в центре
  Planned: ListTodo, // запланирована с планом — список
  "In Progress": CircleDot, // в работе — точка в центре
  Review: CircleEllipsis, // на ревью — «ожидает»
  Done: CircleCheck, // завершена — галочка
  Blocked: Circle, // заблокирована (цвет/смысл даёт контекст строки)
};

/** Фолбэк для пользовательских статусов вне дефолтного конфига. */
export function statusIcon(status: string): LucideIcon {
  return statusIcons[status] ?? Circle;
}

/**
 * Бэйджи приоритетов — прямой аналог ref-2 task-priority.ts:
 * High → Flame/destructive, Medium → ChevronUp/amber, Low → Minus/slate.
 */
export const priorityBadgeConfig: Record<
  string,
  { icon: LucideIcon; variant: "destructive" | "secondary" | "outline"; className: string }
> = {
  High: {
    icon: Flame,
    variant: "destructive",
    className: "border-transparent",
  },
  Medium: {
    icon: ChevronUp,
    variant: "secondary",
    className: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  Low: {
    icon: Minus,
    variant: "secondary",
    className: "bg-slate-500/10 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  },
};

/**
 * Конфиг бэйджа приоритета; неизвестный приоритет (кастомный из конфига) —
 * нейтральный outline без иконки, чтобы не падать на пользовательских значениях.
 */
export function priorityBadge(priority: string): {
  icon: LucideIcon | null;
  variant: "destructive" | "secondary" | "outline";
  className: string;
} {
  const config = priorityBadgeConfig[priority];
  return config ?? { icon: null, variant: "outline", className: "" };
}

/**
 * Тон бэйджа лейбла — детерминированный по строке (hash → палитра),
 * аналог ref-2 tagTones (data.ts:13–23), но для произвольных labels
 * вместо фиксированного списка команд.
 */
const LABEL_TONES = [
  "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "bg-red-500/10 text-red-700 dark:text-red-300",
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
];

/** Простой FNV-подобный hash: стабилен между рендерами, быстрый. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Tone-класс для лейбла: один и тот же label всегда одного цвета. */
export function labelTone(label: string): string {
  return LABEL_TONES[hashString(label) % LABEL_TONES.length];
}

/**
 * Иконки заголовков колонок Table — аналог ref-2 kanban-table.tsx
 * headerIcons (title→ListTodo, status→CircleCheck, priority→Flame, …).
 */
export const headerIcons: Record<string, LucideIcon> = {
  id: Hash,
  title: ListTodo,
  status: CircleCheck,
  priority: Flame,
  type: Tag,
  labels: Tags,
  milestone: Flag,
  updated_date: CalendarDays,
};

/** Общая иконка строки-комментариев (insights-счётчик, как в ref-2). */
export const commentIcon = MessageSquare;
