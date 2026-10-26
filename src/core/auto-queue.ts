/**
 * Автоочередь фаз — `.vibelog/auto-queue.json` (VL-191).
 *
 * Персистентная очередь задач для автономного прохождения фаз ботом:
 * файл переживает рестарт процесса (running + статусы элементов), формат
 * продиктован спецификацией:
 *
 *   { "running": bool,
 *     "max_retries": 1,
 *     "tasks": [{ "id": "VL-N", "status": "pending|running|done|failed",
 *                 "added_at": "...", "started_at": "...", "attempts": 0 }] }
 *
 * Поля `max_retries`/`attempts` — расширение спецификации (retry N по
 * умолчанию 1): не противоречат AC1 и позволяют переживать рестарт счётчика
 * попыток. Файл лежит в gitignored `.vibelog/` (как settings.json).
 *
 * Модуль fs-only (по образцу core/settings.ts): не импортирует бота и
 * оркестратор — логика выбора следующей задачи тестируется без Telegram.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getTask } from './store.js';
import { isReady } from './deps.js';
import type { Task } from './task.js';

/** Статус элемента очереди (спецификация VL-191). */
export type AutoQueueStatus = 'pending' | 'running' | 'done' | 'failed';

/** Элемент автоочерери. */
export interface AutoQueueTask {
  /** ID задачи (VL-N). */
  id: string;
  /** Статус в очереди — не путать со статусом workflow задачи. */
  status: AutoQueueStatus;
  /** ISO-время добавления в очередь — база FIFO внутри приоритета. */
  added_at: string;
  /** ISO-время последнего запуска фазы; null/отсутствует — ещё не запускалась. */
  started_at?: string | null;
  /** Сколько раз фаза текущей задачи уже падала (retry-счётчик). */
  attempts?: number;
}

/** Документ автоочерери. */
export interface AutoQueue {
  /** true ⇔ автопрогон включён (/auto start; false — stop/пустая очередь). */
  running: boolean;
  /** Максимум повторов фазы после ошибки (default 1 — из спецификации). */
  max_retries?: number;
  /** Элементы очереди в порядке добавления. */
  tasks: AutoQueueTask[];
}

/** Порядок приоритетов для выбора следующей задачи (High → Medium → Low). */
const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/** Дефолт: файл отсутствует/битый — очередь остановлена, задач нет. */
const EMPTY_QUEUE: AutoQueue = { running: false, tasks: [] };

/**
 * Монотонный ISO-время для added_at: в одном вызове add несколько задач
 * получают одну и ту же миллисекунду → сравнение added_at стало бы равенством
 * и FIFO зависел бы от порядка сортировки. Счётчик гарантирует строгое
 * увеличение внутри процесса (лексикографическое сравнение ISO совпадает
 * с хронологией).
 */
let lastAddedAtMs = 0;
function nextIsoDate(): string {
  let ms = Date.now();
  if (ms <= lastAddedAtMs) ms = lastAddedAtMs + 1;
  lastAddedAtMs = ms;
  return new Date(ms).toISOString();
}

/** Путь к файлу очереди в директории проекта. */
export function autoQueuePath(cwd: string): string {
  return join(cwd, '.vibelog', 'auto-queue.json');
}

/**
 * Читает очередь. Отсутствие/битый JSON/не-объект → дефолт остановленной
 * очереди (авто не должно ронять бота при повреждённом файле).
 */
export function loadAutoQueue(cwd: string): AutoQueue {
  const path = autoQueuePath(cwd);
  if (!existsSync(path)) return { ...EMPTY_QUEUE, tasks: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...EMPTY_QUEUE, tasks: [] };
    }
    const raw = parsed as Partial<AutoQueue>;
    // Нормализация: running — bool, элементы с валидным status, иначе отбрасываем
    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks.filter(
          (t): t is AutoQueueTask =>
            t !== null &&
            typeof t === 'object' &&
            typeof (t as AutoQueueTask).id === 'string' &&
            ['pending', 'running', 'done', 'failed'].includes((t as AutoQueueTask).status) &&
            typeof (t as AutoQueueTask).added_at === 'string'
        )
      : [];
    const max_retries =
      typeof raw.max_retries === 'number' && Number.isInteger(raw.max_retries) && raw.max_retries >= 0
        ? raw.max_retries
        : 1;
    return { running: raw.running === true, max_retries, tasks };
  } catch {
    return { ...EMPTY_QUEUE, tasks: [] };
  }
}

/**
 * Записывает очередь (создаёт .vibelog/ при необходимости).
 * Формат: JSON с отступом 2 + завершающий перевод строки (как settings.json).
 */
export function saveAutoQueue(cwd: string, queue: AutoQueue): void {
  const path = autoQueuePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
}

/**
 * Добавляет задачи в очередь (идемпотентно).
 *
 * Правила: уже pending/running → skip («уже в очереди»); done/failed →
 * сброс в pending (повторный /auto add реанимирует элемент); дубли в одном
 * вызове схлопываются. Порядок добавления сохраняется (FIFO-база).
 *
 * @returns added — реально добавленные/реанимированные ID; skipped — уже queued
 */
export function addQueueTasks(cwd: string, ids: string[]): { added: string[]; skipped: string[] } {
  const queue = loadAutoQueue(cwd);
  const added: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const existing = queue.tasks.find((t) => t.id === id);
    if (existing) {
      if (existing.status === 'pending' || existing.status === 'running') {
        skipped.push(id);
        continue;
      }
      // done/failed → пере-add возвращает в pending (attempts обнуляется)
      existing.status = 'pending';
      existing.attempts = 0;
      added.push(id);
      continue;
    }
    queue.tasks.push({ id, status: 'pending', added_at: nextIsoDate(), attempts: 0 });
    added.push(id);
  }
  if (added.length > 0) saveAutoQueue(cwd, queue);
  return { added, skipped };
}

/** Переключает running (start/stop); записывает файл. */
export function setQueueRunning(cwd: string, running: boolean): AutoQueue {
  const queue = loadAutoQueue(cwd);
  queue.running = running;
  saveAutoQueue(cwd, queue);
  return queue;
}

/**
 * Патчит элемент очереди по ID. Элемент не найден — no-op.
 *
 * @returns обновлённая очередь (для дальнейшей работы без повторного чтения)
 */
export function updateQueueTask(
  cwd: string,
  id: string,
  patch: Partial<Omit<AutoQueueTask, 'id'>>
): AutoQueue {
  const queue = loadAutoQueue(cwd);
  const item = queue.tasks.find((t) => t.id === id);
  if (item) Object.assign(item, patch);
  saveAutoQueue(cwd, queue);
  return queue;
}

/**
 * Снимает элемент из очереди (для /auto remove, если появится) — не
 * используется в VL-191, оставлено для симметрии API.
 */
export function removeQueueTask(cwd: string, id: string): AutoQueue {
  const queue = loadAutoQueue(cwd);
  queue.tasks = queue.tasks.filter((t) => t.id !== id);
  saveAutoQueue(cwd, queue);
  return queue;
}

/** Терминальные статусы workflow, в которых задаче фазы больше не нужны. */
function isTerminalStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'done' || s === 'rejected' || s === 'completed';
}

/**
 * Приводит очередь в соответствие состоянию задач (sweep перед выбором).
 *
 * - элемент running → pending при остановленной очереди НЕ трогаем здесь
 *   (это делает resumeAutoRunner — рестарт);
 * - задача Done/Completed → done; Rejected → failed; задача удалена → failed.
 *
 * @returns true, если что-то изменилось (нужна запись файла)
 */
export function sweepQueue(cwd: string, queue: AutoQueue): boolean {
  let changed = false;
  for (const item of queue.tasks) {
    if (item.status === 'done' || item.status === 'failed') continue;
    const task = getTask(cwd, item.id);
    if (!task) {
      item.status = 'failed';
      changed = true;
      continue;
    }
    if (isTerminalStatus(task.status)) {
      item.status = task.status.toLowerCase() === 'rejected' ? 'failed' : 'done';
      changed = true;
    }
  }
  return changed;
}

/**
 * Выбирает следующую задачу для автопрогона (AC2).
 *
 * Цепочка: только pending → задача существует и не в терминальном статусе →
 * все зависимости Done (isReady) → сортировка по priority High→Medium→Low,
 * внутри приоритета FIFO по added_at. Задачи, не прошедшие фильтр, остаются
 * pending (блокировка зависимостями — «пока пропустить», а не failed).
 *
 * @returns элемент очереди или null (нечего запускать сейчас)
 */
export function pickNextQueueTask(cwd: string, queue: AutoQueue): AutoQueueTask | null {
  const candidates: { item: AutoQueueTask; task: Task }[] = [];
  for (const item of queue.tasks) {
    if (item.status !== 'pending') continue;
    const task = getTask(cwd, item.id);
    if (!task || isTerminalStatus(task.status)) continue;
    if (!isReady(cwd, task)) continue;
    candidates.push({ item, task });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.task.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.task.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    // FIFO внутри приоритета: added_at, при равенстве — исходный порядок
    // (Array.sort стабилен в V8/Node 20)
    return a.item.added_at < b.item.added_at ? -1 : a.item.added_at > b.item.added_at ? 1 : 0;
  });
  return candidates[0].item;
}

/**
 * Текст статуса очереди для /auto status: running-флаг + по строке на элемент
 * (id — статус — дата добавления).
 *
 * @param queue — очередь; пустая → «Очередь пуста»
 */
export function formatAutoQueue(queue: AutoQueue): string {
  const header = `Auto: ${queue.running ? 'запущена' : 'остановлена'}, retries: ${queue.max_retries ?? 1}`;
  if (queue.tasks.length === 0) return `${header}\nОчередь пуста`;
  const lines = queue.tasks.map((t) => {
    const started = t.started_at ? `, запущена ${t.started_at}` : '';
    return `${t.id} — ${t.status} (добавлена ${t.added_at}${started})`;
  });
  return [header, ...lines].join('\n');
}
