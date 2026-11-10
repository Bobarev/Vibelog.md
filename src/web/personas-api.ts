/**
 * REST API страницы «Персоны» (VL-403): CRUD ролей веб-чата.
 *
 * Реестр ролей (VL-265) до этой задачи был доступен только на чтение:
 * `GET /api/personas` отдаёт сводки без текстов, а править промпт, память и
 * состав ролей можно было только руками в `.vibelog/settings.json` и
 * `.vibelog/prompts/personas/`. Страница «Персоны» закрывает это:
 *
 * - `GET    /api/personas/:id` — полные данные роли: метаданные, ТЕКСТ
 *   промпта и ТЕКСТ памяти (в списке их нет — там могут быть личные заметки);
 * - `PUT    /api/personas/:id` — правка label/description/default_status/
 *   allow_tools/промпта/памяти. Встроенную роль можно переопределить
 *   (запись в chat_personas), удалить — нельзя;
 * - `POST   /api/personas`     — создать проектную роль: запись в
 *   `chat_personas` + файл промпта `.vibelog/prompts/personas/<id>.md`;
 * - `DELETE /api/personas/:id` — удалить ТОЛЬКО проектную роль: запись из
 *   `chat_personas` уходит, файлы промпта и памяти остаются (сироту-файл
 *   пользователь удаляет сам — пути возвращаются в ответе и показываются в
 *   подтверждении).
 *
 * Почему отдельный модуль, а не ветки в `api.ts`: `api.ts` уже 1200+ строк,
 * а здесь своя валидация (лимит памяти, allow_tools, default_status) и своя
 * запись файлов. Регистрация — в `handleApi` ДО точного `GET /api/personas`
 * (паттерн `handleSetupApi`): `null` — URL не наш, роутинг продолжается.
 *
 * Валидация ДО записи (риск R2 плана): любая ошибка → 400 и НИ ОДНОГО
 * изменения на диске. Запись settings.json — только через `saveSettingsPatch`
 * (read-modify-write): чужие секции (models, workflows, mcpServers) целы.
 * Файлы промпта/памяти — атомарно (temp + rename), путь строится из
 * провалидированного id/prompt и не может выйти за каталог ролей.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadConfig } from '../core/config.js';
import { loadSettings, saveSettingsPatch } from '../core/settings.js';
import {
  PERSONA_MEMORY_SUFFIX,
  PROJECT_PERSONAS_DIR,
  readPersonaMemoryLimit,
} from '../core/persona-memory.js';
import {
  BUILTIN_PERSONAS,
  RETIRED_PERSONA_IDS,
  isBuiltinPersonaId,
  knownToolNames,
  loadPersonaMemory,
  loadPersonaPrompt,
  resolvePersona,
} from './personas.js';
import type { PersonaConfig } from './personas.js';
import type { ApiResponse } from './api.js';

/**
 * Допустимый id роли: строчная латиница/цифры/дефис, начинается с буквы или
 * цифры. Заодно защита от выхода за каталог: `/`, `\`, `..` в id невозможны,
 * поэтому имя файла промпта всегда лежит внутри `.vibelog/prompts/personas/`.
 */
const PERSONA_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Статусы проекта из backlog/config.yml (пусто — конфиг не прочитан). */
function projectStatuses(cwd: string): string[] {
  try {
    const raw = loadConfig(cwd).statuses;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Относительный путь файла промпта роли (для ответов и подтверждений). */
function promptRelPath(prompt: string): string {
  return join(PROJECT_PERSONAS_DIR, `${prompt}.md`);
}

/** Относительный путь файла памяти роли. */
function memoryRelPath(prompt: string): string {
  return join(PROJECT_PERSONAS_DIR, `${prompt}${PERSONA_MEMORY_SUFFIX}`);
}

/**
 * Атомарная запись текстового файла (temp + rename).
 *
 * `writeJsonAtomic` из components-config не подходит: он сериализует JSON, а
 * здесь markdown. Смысл тот же — читатель никогда не увидит полузаписанный
 * файл, а сбой записи не оставляет мусора (temp удаляется).
 */
function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const tmp = `${path}.tmp-${process.pid}-${rand}`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp мог не создаться — тогда и чистить нечего
    }
    throw err;
  }
}

/** Читает файл как текст; отсутствие файла — пустая строка (не ошибка). */
function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Тело GET /api/personas/:id — полные данные роли. */
function personaDetail(cwd: string, persona: PersonaConfig): Record<string, unknown> {
  const promptPath = promptRelPath(persona.prompt);
  const memoryPath = memoryRelPath(persona.prompt);
  const memory = loadPersonaMemory(cwd, persona);
  const limit = readPersonaMemoryLimit(cwd);
  // Текст памяти отдаём СЫРЫМ (без обрезки по лимиту): страница — редактор,
  // обрезанный текст при сохранении молча потерял бы хвост файла.
  const memoryText = readTextOrEmpty(join(cwd, memoryPath)).trim();
  let promptText = '';
  let promptError: string | null = null;
  try {
    promptText = loadPersonaPrompt(cwd, persona);
  } catch (err) {
    // Fail-closed резолвер: роль объявлена, а текста нет. Страница должна
    // показать это как предупреждение, а не 500 — иначе роль не починить.
    promptError = (err as Error).message;
  }
  return {
    persona: {
      id: persona.id,
      label: persona.label,
      description: persona.description ?? '',
      prompt: persona.prompt,
      defaultStatus: persona.defaultStatus ?? '',
      allowTools: persona.allowTools ?? [],
      builtin: isBuiltinPersonaId(persona.id),
    },
    promptText,
    promptError,
    memoryText,
    memory: {
      chars: memoryText.length,
      limit,
      truncated: memory.chars > limit,
    },
    promptPath,
    memoryPath,
    statuses: projectStatuses(cwd),
    tools: knownToolNames(),
  };
}

/** Разобранный и провалидированный патч роли (PUT). */
interface PersonaPatch {
  label?: string;
  description?: string;
  defaultStatus?: string;
  allowTools?: string[];
  promptText?: string;
  memoryText?: string;
}

/**
 * Валидирует тело PUT/POST до записи.
 *
 * @param partial — true для PUT (все поля необязательны), false для POST
 *   (обязательны id/label/promptText)
 * @returns патч либо {error} — при ошибке НИЧЕГО не пишется
 */
function validatePatch(
  cwd: string,
  body: Record<string, unknown> | null,
  partial: boolean,
): { patch: PersonaPatch } | { error: string } {
  const raw = body ?? {};
  const patch: PersonaPatch = {};

  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string' || raw.label.trim() === '') {
      return { error: 'label: ожидается непустая строка' };
    }
    patch.label = raw.label.trim();
  } else if (!partial) {
    return { error: 'label: обязательное поле' };
  }

  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      return { error: 'description: ожидается строка' };
    }
    patch.description = raw.description.trim();
  }

  if (raw.defaultStatus !== undefined) {
    if (typeof raw.defaultStatus !== 'string') {
      return { error: 'defaultStatus: ожидается строка' };
    }
    const status = raw.defaultStatus.trim();
    if (status !== '') {
      const statuses = projectStatuses(cwd);
      if (!statuses.includes(status)) {
        return {
          error: `defaultStatus "${status}" отсутствует в statuses backlog/config.yml${
            statuses.length > 0 ? ` [${statuses.join(', ')}]` : ''
          }`,
        };
      }
    }
    patch.defaultStatus = status;
  }

  if (raw.allowTools !== undefined) {
    if (!Array.isArray(raw.allowTools)) {
      return { error: 'allowTools: ожидается массив имён инструментов' };
    }
    const known = new Set(knownToolNames());
    const tools: string[] = [];
    for (const item of raw.allowTools) {
      if (typeof item !== 'string' || item.trim() === '') {
        return { error: 'allowTools: ожидаются непустые строки' };
      }
      const name = item.trim();
      if (!known.has(name)) {
        return { error: `allowTools: неизвестный инструмент "${name}"` };
      }
      if (!tools.includes(name)) tools.push(name);
    }
    patch.allowTools = tools;
  }

  if (raw.promptText !== undefined) {
    if (typeof raw.promptText !== 'string') {
      return { error: 'promptText: ожидается строка' };
    }
    if (raw.promptText.trim() === '') {
      return { error: 'promptText: текст промпта не может быть пустым' };
    }
    patch.promptText = raw.promptText;
  } else if (!partial) {
    return { error: 'promptText: обязательное поле' };
  }

  if (raw.memoryText !== undefined) {
    if (typeof raw.memoryText !== 'string') {
      return { error: 'memoryText: ожидается строка' };
    }
    // Лимит — жёсткий (AC7): превышение отклоняется с понятной ошибкой,
    // молчаливой обрезки нет (иначе пользователь теряет текст незаметно).
    const limit = readPersonaMemoryLimit(cwd);
    const chars = raw.memoryText.trim().length;
    if (chars > limit) {
      return {
        error: `memoryText: ${chars} символов превышает лимит ${limit} — сократите память (лимит задаётся persona_memory.max_chars в .vibelog/settings.json)`,
      };
    }
    patch.memoryText = raw.memoryText;
  }

  return { patch };
}

/**
 * Собирает запись chat_personas из текущей роли и патча.
 *
 * Запись всегда полная (label + prompt обязательны в формате секции), поэтому
 * переопределение встроенной роли сохраняет её prompt и незатронутые поля —
 * иначе `loadPersonas` отбросил бы запись как битую.
 */
function personaRecord(
  current: PersonaConfig,
  patch: PersonaPatch,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    label: patch.label ?? current.label,
    prompt: current.prompt,
  };
  const description = patch.description ?? current.description;
  if (description !== undefined && description !== '') record.description = description;
  const defaultStatus = patch.defaultStatus ?? current.defaultStatus;
  if (defaultStatus !== undefined && defaultStatus !== '') record.default_status = defaultStatus;
  const allowTools = patch.allowTools ?? current.allowTools;
  if (allowTools !== undefined && allowTools.length > 0) record.allow_tools = allowTools;
  return record;
}

/** Текущая секция chat_personas как объект (битую секцию заменяем пустой). */
function readPersonasSection(cwd: string): Record<string, unknown> {
  const raw = loadSettings(cwd).chat_personas;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

/**
 * Обрабатывает /api/personas/:id и /api/personas (write-методы).
 *
 * @returns ApiResponse либо null — URL не наш (роутинг продолжается)
 */
export function handlePersonasApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string,
): ApiResponse | null {
  // POST /api/personas — создание проектной роли (AC4)
  if (method === 'POST' && url === '/api/personas') {
    const raw = body ?? {};
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id === '') return { status: 400, body: { error: 'id: обязательное поле' } };
    if (!PERSONA_ID_RE.test(id)) {
      return {
        status: 400,
        body: {
          error: 'id: допустимы строчная латиница, цифры и дефис (например, psychologist)',
        },
      };
    }
    // Дубль: встроенные роли, RETIRED_PERSONA_IDS и уже существующие проектные
    if (isBuiltinPersonaId(id)) {
      return { status: 400, body: { error: `id "${id}" занят встроенной ролью` } };
    }
    if (RETIRED_PERSONA_IDS.includes(id)) {
      return { status: 400, body: { error: `id "${id}" зарезервирован (роль удалена)` } };
    }
    if (resolvePersona(cwd, id) !== null) {
      return { status: 400, body: { error: `роль "${id}" уже существует` } };
    }
    const validated = validatePatch(cwd, raw, false);
    if ('error' in validated) return { status: 400, body: { error: validated.error } };
    const patch = validated.patch;

    const record: Record<string, unknown> = {
      label: patch.label!,
      prompt: id,
    };
    if (patch.description !== undefined && patch.description !== '') {
      record.description = patch.description;
    }
    if (patch.defaultStatus !== undefined && patch.defaultStatus !== '') {
      record.default_status = patch.defaultStatus;
    }
    if (patch.allowTools !== undefined && patch.allowTools.length > 0) {
      record.allow_tools = patch.allowTools;
    }

    // Сначала файл промпта, потом settings.json: если запись настроек упадёт,
    // останется «сирота»-файл (безвреден), а не роль без текста (fail-closed
    // резолвер сломал бы чат).
    writeTextAtomic(join(cwd, promptRelPath(id)), `${patch.promptText!.trimEnd()}\n`);
    saveSettingsPatch(cwd, {
      chat_personas: { ...readPersonasSection(cwd), [id]: record },
    });

    const created = resolvePersona(cwd, id);
    return {
      status: 201,
      body: created
        ? personaDetail(cwd, created)
        : { persona: { id, label: patch.label, prompt: id, builtin: false } },
    };
  }

  const match = url.match(/^\/api\/personas\/([^/]+)$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]!);
  const persona = resolvePersona(cwd, id);
  if (persona === null) {
    return { status: 404, body: { error: `Роль "${id}" не найдена` } };
  }

  // GET /api/personas/:id — полные данные, включая тексты (AC8)
  if (method === 'GET') {
    return { status: 200, body: personaDetail(cwd, persona) };
  }

  // PUT /api/personas/:id — правка роли (AC3/AC6/AC7)
  if (method === 'PUT') {
    const validated = validatePatch(cwd, body, true);
    if ('error' in validated) return { status: 400, body: { error: validated.error } };
    const patch = validated.patch;

    // Файлы пишем ДО settings.json по той же причине, что и в POST.
    if (patch.promptText !== undefined) {
      writeTextAtomic(join(cwd, promptRelPath(persona.prompt)), `${patch.promptText.trimEnd()}\n`);
    }
    if (patch.memoryText !== undefined) {
      const text = patch.memoryText.trim();
      const path = join(cwd, memoryRelPath(persona.prompt));
      if (text === '') {
        // Пустая память = файла нет: удаляем, чтобы не оставлять пустышку
        try {
          unlinkSync(path);
        } catch {
          // файла не было — штатное «памяти нет»
        }
      } else {
        writeTextAtomic(path, `${text}\n`);
      }
    }

    const record = personaRecord(persona, patch);
    saveSettingsPatch(cwd, {
      chat_personas: { ...readPersonasSection(cwd), [id]: record },
    });

    const updated = resolvePersona(cwd, id) ?? persona;
    return { status: 200, body: personaDetail(cwd, updated) };
  }

  // DELETE /api/personas/:id — только проектные роли (AC5/AC6)
  if (method === 'DELETE') {
    if (isBuiltinPersonaId(id)) {
      return {
        status: 400,
        body: {
          error: `Роль "${id}" встроенная — её нельзя удалить, можно переопределить (label, промпт, default_status)`,
        },
      };
    }
    const section = readPersonasSection(cwd);
    if (!(id in section)) {
      return { status: 404, body: { error: `Роль "${id}" не найдена в chat_personas` } };
    }
    delete section[id];
    saveSettingsPatch(cwd, { chat_personas: section });
    // Файлы НЕ удаляем: пользователь решает сам (риск R4 плана). Пути
    // возвращаем, чтобы UI показал их в подтверждении.
    return {
      status: 200,
      body: {
        deleted: id,
        promptPath: promptRelPath(persona.prompt),
        memoryPath: memoryRelPath(persona.prompt),
        note: 'Файлы промпта и памяти не удалены — удалите их вручную, если они больше не нужны',
      },
    };
  }

  return null;
}

/** Встроенные роли — для тестов и UI (реэкспорт, чтобы не тянуть personas.ts). */
export { BUILTIN_PERSONAS };
