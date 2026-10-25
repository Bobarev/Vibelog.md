/**
 * Хранение сессий vibelog-agent (VL-95).
 *
 * Транскрипт диалога (LoopResult.messages) сохраняется JSONL в
 * `.vibelog/agent-sessions/<sessionId>.jsonl` — по строке на сообщение.
 * Формат session_id — прежний `agent-<Date.now()>`: его матчит
 * extractSessionRef бота (commands.ts) и рендерится с префиксом `vb:` —
 * менять нельзя, иначе бот определит сессию как qwen-сессию и спавнит
 * не тот агент. Каталог `.vibelog/` покрыт .gitignore.
 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from './llm.js';

/** Каталог хранения сессий агента: `<cwd>/.vibelog/agent-sessions`. */
export function agentSessionsDir(cwd: string): string {
  return join(cwd, '.vibelog', 'agent-sessions');
}

/** Идентификатор новой сессии: `agent-<мс epoch>` (формат бота VL-95). */
export function createSessionId(): string {
  return `agent-${Date.now()}`;
}

/**
 * Сохраняет транскрипт сессии (полная перезапись файла).
 *
 * @throws Error при ошибке mkdir/записи — вызывающий решает, фатальна ли она
 */
export async function saveSession(dir: string, sessionId: string, messages: ChatMessage[]): Promise<void> {
  assertSafeSessionId(sessionId);
  await mkdir(dir, { recursive: true });
  // JSONL: по строке на сообщение — чтение/запись линейные
  const body = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  await writeFile(join(dir, `${sessionId}.jsonl`), body, 'utf-8');
}

/**
 * Дописывает одно сообщение в конец JSONL-файла сессии (VL-103).
 *
 * Инкрементальная запись: каждое сообщение цикла уходит в файл сразу, а не
 * по завершении фазы — при обрыве процесса (SIGKILL/таймаут оркестратора)
 * транскрипт сохранён до последнего дописанного сообщения. Финальный
 * saveSession остаётся нормализацией: полная перезапись идемпотентна и
 * подчищает любые расхождения append'ов.
 *
 * @throws Error при невалидном sessionId (path traversal) либо ошибке записи
 */
export async function appendSessionMessage(
  dir: string,
  sessionId: string,
  message: ChatMessage,
): Promise<void> {
  assertSafeSessionId(sessionId);
  // mkdir recursive: файл сессии может создаваться до первого saveSession
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${sessionId}.jsonl`), JSON.stringify(message) + '\n', 'utf-8');
}

/**
 * Загружает транскрипт сессии по идентификатору.
 *
 * @throws Error «Сессия <id> не найдена: <path>» либо «битая строка N»
 */
export async function loadSession(dir: string, sessionId: string): Promise<ChatMessage[]> {
  assertSafeSessionId(sessionId);
  const path = join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new Error(`Сессия ${sessionId} не найдена: ${path}`);
  }
  const messages: ChatMessage[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue; // хвостовой перевод строки — не сообщение
    try {
      messages.push(JSON.parse(line));
    } catch {
      throw new Error(`Сессия ${sessionId}: битая строка ${i + 1} в ${path}`);
    }
  }
  return messages;
}

/**
 * Последняя сессия каталога — *.jsonl с максимальным mtime.
 *
 * @returns sessionId либо null, если сессий нет (нет каталога — тоже null)
 */
export async function latestSession(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null; // каталога ещё нет — сессий не было
  }
  const jsonl = entries.filter((e) => e.endsWith('.jsonl'));
  if (jsonl.length === 0) return null;
  let latest: { id: string; mtime: number } | null = null;
  for (const entry of jsonl) {
    const mtime = (await stat(join(dir, entry))).mtimeMs;
    if (!latest || mtime > latest.mtime) {
      latest = { id: entry.slice(0, -'.jsonl'.length), mtime };
    }
  }
  return latest?.id ?? null;
}

/**
 * Метаданные сессии (VL-110): задача-владелец и cwd создания.
 *
 * Пишутся CLI при создании задачной сессии — в режиме `<фаза> <taskId>`
 * (прямой CLI-запуск) и по env оркестратора VIBELOG_PHASE_TASK_ID/NAME
 * (боевой путь спавна готовым промптом, VL-114) — в `<id>.meta.json`
 * рядом с jsonl. По ним оркестратор возобновляет сессию
 * задачи в её worktree (инцидент VL-98: resume из главного cwd патчил
 * главный репозиторий вместо worktree vb/vl-N). Отсутствие меты (/prompt,
 * интерактивные и старые сессии) — не ошибка.
 */
export interface SessionMeta {
  /** ID задачи-владельца (VL-N); undefined у /prompt и интерактивных сессий. */
  taskId?: string;
  /** Фаза сессии (spec/plan/code/close/comment). */
  phase?: string;
  /** Рабочая директория агента при создании сессии (worktree или главный cwd). */
  cwd: string;
}

/**
 * Сохраняет метаданные сессии (<id>.meta.json).
 *
 * @throws Error при невалидном sessionId (path traversal) либо ошибке записи
 */
export async function saveSessionMeta(dir: string, sessionId: string, meta: SessionMeta): Promise<void> {
  assertSafeSessionId(sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.meta.json`), JSON.stringify(meta), 'utf-8');
}

/**
 * Синхронное чтение метаданных сессии (VL-110).
 *
 * Синхронная форма нужна оркестратору: startResume — синхронная точка
 * входа, spawnCwd должен определиться до spawn. Любая ошибка (нет файла,
 * битый JSON, небезопасный id) — null: вызывающий продолжает по прежнему
 * пути resume без worktree.
 */
export function loadSessionMetaSync(dir: string, sessionId: string): SessionMeta | null {
  try {
    assertSafeSessionId(sessionId);
    const parsed: unknown = JSON.parse(readFileSync(join(dir, `${sessionId}.meta.json`), 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as SessionMeta;
  } catch {
    return null;
  }
}

/**
 * Сессия задачи для фазы (VL-147): ищет в *.meta.json совпадение по
 * meta.taskId (регистронезависимо) И meta.phase. Возвращает sessionId с
 * максимальным mtime jsonl-файла сессии (или meta-файла, если jsonl ещё
 * нет/пропал) — «последняя» сессия фазы. Null, если совпадений нет (нет
 * каталога — тоже null, как у latestSession).
 *
 * Sync-форма нужна startPhase (sync-точка входа оркестратора): при запуске
 * code в той же сессии, что plan (VL-147), sessionId уходит в --resume.
 */
export function findTaskPhaseSessionSync(dir: string, taskId: string, phase: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null; // каталога ещё нет — сессий не было
  }
  const wanted = taskId.toUpperCase();
  let best: { id: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    const sessionId = entry.slice(0, -'.meta.json'.length);
    // loadSessionMetaSync глотает битые меты и path-traversal — мусор пропускаем
    const meta = loadSessionMetaSync(dir, sessionId);
    if (!meta?.taskId || meta.taskId.toUpperCase() !== wanted || meta.phase !== phase) continue;
    // mtime берём у jsonl (транскрипт растёт при каждом append'е сообщений);
    // нет jsonl — mtime меты (сессия может быть только что создана)
    let mtime: number;
    try {
      mtime = statSync(join(dir, `${sessionId}.jsonl`)).mtimeMs;
    } catch {
      try {
        mtime = statSync(join(dir, entry)).mtimeMs;
      } catch {
        continue; // файл меты исчез между readdir и stat — пропуск
      }
    }
    if (!best || mtime > best.mtime) {
      best = { id: sessionId, mtime };
    }
  }
  return best?.id ?? null;
}

/**
 * Диагностическая сводка метсессий задачи (VL-187): «sessionId:phase, …» для
 * всех *.meta.json с meta.taskId (регистронезависимо). Пустая строка, если
 * каталога нет/мет нет. Используется в fallback-логе startPhase, чтобы причина
 * «план-сессия не найдена» читалась из лога оркестратора.
 */
export function listTaskSessionMetas(dir: string, taskId: string): string {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return '';
  }
  const wanted = taskId.toUpperCase();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    const sessionId = entry.slice(0, -'.meta.json'.length);
    const meta = loadSessionMetaSync(dir, sessionId);
    if (!meta?.taskId || meta.taskId.toUpperCase() !== wanted) continue;
    out.push(`${sessionId}:${meta.phase ?? '?'}`);
  }
  return out.join(', ');
}

/**
 * sessionId приходит извне (--resume из CLI, ref бота) — без проверки
 * `..` в имени вышел бы за пределы каталога сессий (path traversal).
 */
function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error(`Недопустимый идентификатор сессии: ${sessionId}`);
  }
}
