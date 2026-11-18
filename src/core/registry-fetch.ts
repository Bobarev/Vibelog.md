/**
 * Сетевой слой реестра компонентов (VL-335, doc-25 §4.3 шаги 3–4, §5.1).
 *
 * Задача модуля — одна операция: скачать JSON элемента реестра из GitVerse
 * (`public/r/<name>.json`) и отдать его как проверенный `RegistryItem`.
 * Разбор `alias/repo/name`, запись файлов, lock-файл и кэш — не здесь.
 *
 * Почему модуль отдельный. Поведение GitVerse непривычно и проверено спайком
 * (doc-25 §10): отсутствующий файл отдаёт **400** (а не 404) с телом
 * `{"code":4305,"message":"File: ... not found"}`, успешный ответ приходит с
 * `content-type: text/plain` (JSON приходится валидировать только парсингом
 * тела), а HEAD-запросы запрещены (403). Если оставить это в `vb install`,
 * каждая особенность обрастёт частной обработкой на месте.
 *
 * VL-380: транспорт (таймаут, лимит тела, сетевые коды, разбор тела ошибки,
 * цикл ретраев с учётом 429 и `Retry-After`) вынесен в `gitverse-http.ts` и
 * общий с Issues-клиентом. Здесь остаётся только семантика реестра: какие
 * статусы означают «не найдено», какой текст подсказать и что скачать.
 *
 * VL-382 — ДВЕ СХЕМЫ ДОСТУПА. Замеры 2026-11-09 (curl, один и тот же URL
 * `gitverse.ru/api/repos/Vibelog-md/ui/raw/branch/master/public/r/base.json`,
 * интервал минуты, три разных IP):
 * - БЕЗ токена → **200** `text/plain` с полным JSON элемента;
 * - с `Authorization: Bearer <token>` → **429** «Unauthenticated requests
 *   rate-limit exceeded» (всегда, при любом валидном токене);
 * - через прокси (2 разных IP) → 429, прямой IP через 6 минут → 200.
 *
 * Вывод: raw-эндпоинт GitVerse НЕ принимает `Authorization`. Ранний 429 без
 * токена был временным IP-лимитом и сбросился. Поэтому:
 * - токена нет → raw, ТОЛЬКО `accept`, анонимно;
 * - токен есть → Публичный API (`api.gitverse.ru`): `Authorization: Bearer`
 *   + `Accept: application/vnd.gitverse.object+json;version=1`, содержимое
 *   файла приходит JSON-конвертом с `content` в base64 и декодируется здесь.
 *
 * НЕ «УЛУЧШАТЬ» raw добавлением `Authorization` — дефект уже был (VL-380
 * добавила туда Bearer и `vb install` в проекте с токеном падал всегда).
 * Защита: тест-регрессия «в raw-запросе нет заголовка authorization» и эта
 * шапка с датой и кодами.
 *
 * Жёсткие инварианты:
 * - только GET (никаких HEAD — тест-страховка в registry-fetch.test.mjs);
 * - тело читается чанками с подсчётом байт: лимит 5 МБ (8 МБ для contents —
 *   base64 удваивает размер) — реальная защита от подмены реестра, а не
 *   проверка `content-length` (его может не быть);
 * - базовый URL приходит параметром или из env (`VIBELOG_REGISTRY_BASE_URL`
 *   для raw, `VIBELOG_GITVERSE_API_BASE` для Contents API, алиас
 *   `GITVERSE_REGISTRY_BASE_URL` подменяет оба) — домены захардкожены в
 *   `gitverse-http.ts`, не здесь;
 * - токен не попадает в тексты ошибок: `mask` из `gitverse-http` вырезает его
 *   из каждого сообщения;
 * - оба транспорта возвращают один и тот же `string` (текст файла), поэтому
 *   классификация статусов, ретраи, маскирование и разбор JSON — одни.
 */

import { isAbsolute } from 'node:path';

import { readToken, maskToken } from './gitverse-auth.js';
import {
  ACCEPT,
  API_BASE_ENV,
  DEFAULT_API_BASE,
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_RATE_LIMIT_DELAYS_MS,
  DEFAULT_TIMEOUT_MS,
  GitverseHttpError,
  extractErrorMessage,
  parseJson,
  requestWithRetries,
  resolveBase,
  type HttpErrorFactory,
  type ProgressCallback,
  type StatusClassification,
  type TransportContext,
} from './gitverse-http.js';

/**
 * База raw-эндпоинтов реестра по умолчанию (веб-хост, не `api.`).
 *
 * Единственное место, где встречается домен `gitverse.ru`: всё остальное
 * получает базу параметром (иначе e2e и юнит-тесты невозможны — кэша нет, а
 * шаблон URL зашит). Имя оставлено ради существующих импортёров; смысл —
 * именно raw-база (VL-382).
 */
export const DEFAULT_REGISTRY_BASE = 'https://gitverse.ru';

/** Явный алиас: смысл тот же, что у `DEFAULT_REGISTRY_BASE` (VL-382). */
export const REGISTRY_RAW_BASE = DEFAULT_REGISTRY_BASE;

/** Переменная окружения, подменяющая raw-базу целиком (только для тестов). */
export const REGISTRY_BASE_ENV = 'VIBELOG_REGISTRY_BASE_URL';

/**
 * Имя переменной, которым raw-базу подменяют снаружи (VL-382, AC9).
 *
 * `GITVERSE_REGISTRY_BASE_URL` — новое имя (одно семейство с
 * `GITVERSE_TOKEN`), `VIBELOG_REGISTRY_BASE_URL` поддержано как алиас: оно
 * уже используется тестами install и не должно сломаться.
 */
export const REGISTRY_BASE_ENV_ALIAS = 'GITVERSE_REGISTRY_BASE_URL';

/** Переменная окружения с базой Публичного API (contents-транспорт). */
export const REGISTRY_API_BASE_ENV = API_BASE_ENV;

/**
 * Re-export базы Публичного API: реестру она нужна как `API_BASE` (VL-382).
 * Само значение живёт в `gitverse-http.ts` — второй копии домена нет.
 */
export { DEFAULT_API_BASE, DEFAULT_API_BASE as API_BASE } from './gitverse-http.js';

/** Таймаут одного запроса, мс. */
export const REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

/** Максимальный размер тела ответа, байт (5 МБ) для raw-транспорта. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Лимит тела для contents-транспорта, байт (8 МБ).
 *
 * Base64 удваивает размер: файл 2.6 МБ в конверте занимает ~3.5 МБ, а 5 МБ
 * могло бы отсечь легитимный компонент (риск из плана VL-382).
 */
export const CONTENTS_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Паузы между повторами: до двух повторов, только 5xx и сетевые ошибки. */
export const RETRY_DELAYS_MS: readonly number[] = DEFAULT_RETRY_DELAYS_MS;

/** Паузы для 429 без заголовка `Retry-After` (VL-380). */
export const RATE_LIMIT_DELAYS_MS: readonly number[] = DEFAULT_RATE_LIMIT_DELAYS_MS;

/** Код выхода CLI для сетевых/данных ошибок (doc-25 §5.2). */
export const REGISTRY_ERROR_EXIT_CODE = 3;

/** Ветка реестра по умолчанию: в репозиториях GitVerse ветки `main` нет. */
export const DEFAULT_REGISTRY_BRANCH = 'master';

/**
 * Поддерживаемые типы элементов реестра (формат shadcn, VL-426, doc-25 §3.3).
 *
 * Сверено с официальной схемой `$schema` из `registry.json`
 * (`https://ui.shadcn.com/schema/registry-item.json`): её enum шире — там ещё
 * `registry:theme`, `registry:page`, `registry:file`, `registry:style`,
 * `registry:base`, `registry:font`, `registry:item`. Эти типы НЕ поддерживаются
 * v1 и отклоняются валидацией осознанно (не молча): белый список — контракт.
 */
export const REGISTRY_ITEM_TYPES = [
  'registry:ui',
  'registry:lib',
  'registry:hook',
  'registry:component',
  /** Installable-сборка «копируй и правь» (VL-426, doc-25 §3.3). */
  'registry:block',
] as const;

/** Тип элемента реестра. */
export type RegistryItemType = (typeof REGISTRY_ITEM_TYPES)[number];

/** Вид сетевой/данных-ошибки: от него зависит и текст, и ретрай. */
export type RegistryFetchErrorKind =
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'bad_accept'
  | 'rate_limited'
  | 'bad_request'
  | 'timeout'
  | 'server'
  | 'network'
  | 'too_large'
  | 'invalid_json'
  | 'invalid_schema';

/**
 * Ошибка загрузки элемента реестра.
 *
 * `code` 3 — «сеть/данные» по doc-25 §5.2 (все виды, включая 429 и 401: для
 * `vb install` это одинаково «не удалось скачать»); CLI печатает `message`
 * одной строкой с подсказкой действия, поэтому текст самодостаточен и без
 * стектрейса.
 */
export class RegistryFetchError extends GitverseHttpError<RegistryFetchErrorKind> {
  constructor(
    message: string,
    kind: RegistryFetchErrorKind,
    url: string,
    details: { status?: number; attempts?: number } = {},
  ) {
    super(message, kind, url, { ...details, code: REGISTRY_ERROR_EXIT_CODE });
    this.name = 'RegistryFetchError';
  }
}

/** Фабрика ошибок этого модуля — её получает общий транспорт. */
const makeRegistryError: HttpErrorFactory = (message, kind, url, details) =>
  new RegistryFetchError(message, kind as RegistryFetchErrorKind, url, details ?? {});

/** Один файл элемента реестра. */
export interface RegistryFileEntry {
  /** Путь файла внутри репозитория реестра. */
  path: string;
  /** Путь относительно `aliases.ui` в проекте-получателе. */
  target: string;
  /** Тип файла (`registry:ui`, `registry:lib`, …). */
  type: string;
}

/** Проверенный элемент реестра. */
export interface RegistryItem {
  name: string;
  type: RegistryItemType;
  version: string;
  dependencies: string[];
  registryDependencies: string[];
  files: RegistryFileEntry[];
}

/** Схема доступа к реестру (VL-382): анонимный raw либо Contents API. */
export type RegistryTransportKind = 'raw' | 'contents';

/** Выбранная схема доступа: вид, токен и база. */
export interface RegistryTransport {
  kind: RegistryTransportKind;
  /** Токен (пустая строка для raw — raw всегда анонимный). */
  token: string;
  baseUrl: string;
}

/** Опции выбора схемы доступа (VL-382). */
export interface ResolveRegistryTransportOptions {
  /** Явная база (тесты/фикстуры): переопределяет env-резолв. */
  baseUrl?: string;
  /** Готовый токен (приоритетнее `cwd`). */
  token?: string;
  /** Каталог проекта для чтения токена из `.env` (shell env → `.env`). */
  cwd?: string;
  /** Окружение (по умолчанию `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Явный транспорт (тесты/отладка): переопределяет выбор по токену. */
  transport?: RegistryTransportKind;
}

/** Общие опции сетевых запросов реестра. */
interface RegistryFetchCommonOptions {
  /** База; по умолчанию — резолв по схеме доступа (VL-382). */
  baseUrl?: string;
  owner: string;
  repo: string;
  /** Ветка; по умолчанию `master` (проверено спайком). */
  branch?: string;
  /** Таймаут запроса, мс (инъекция нужна тестам: 30 с в тесте неприемлемо). */
  timeoutMs?: number;
  /** Лимит тела, байт (инъекция для тестов). */
  maxBodyBytes?: number;
  /** Паузы между повторами (инъекция для тестов: не ждать 0.5 + 1.5 с). */
  retryDelaysMs?: readonly number[];
  /** Паузы для 429 без `Retry-After` (инъекция для тестов). */
  rateLimitDelaysMs?: readonly number[];
  /** Суммарный бюджет ожидания на 429, мс (инъекция для тестов). */
  rateLimitBudgetMs?: number;
  /** Окружение для резолва баз (по умолчанию `process.env`). */
  env?: NodeJS.ProcessEnv;
  /**
   * Каталог проекта для чтения токена из `.env` (VL-380). Токен необязателен:
   * нет каталога/токена — запрос уходит анонимно через raw (VL-382).
   */
  cwd?: string;
  /** Готовый токен (инъекция для тестов; приоритетнее `cwd`). */
  token?: string;
  /** Подписка на прогресс сетевых операций (VL-381; по умолчанию — молчание). */
  onProgress?: ProgressCallback;
  /** Явная схема доступа (тесты/отладка): переопределяет выбор по токену. */
  transport?: RegistryTransportKind;
}

/** Опции загрузки элемента. */
export interface FetchRegistryItemOptions extends RegistryFetchCommonOptions {
  /** Имя элемента реестра (без `.json`). */
  name: string;
  /** Инъекция пауз: тесты не должны ждать настоящие секунды. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Опции загрузки произвольного файла репозитория реестра (VL-337). */
export interface FetchRegistryFileOptions extends RegistryFetchCommonOptions {
  /** Путь файла в репозитории реестра (`files[].path` манифеста). */
  path: string;
  /** Инъекция пауз: тесты не должны ждать настоящие секунды. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Регулярка версии элемента: X.Y.Z (prerelease-суффикс допускается). */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Ссылка на зависимость реестра: `<alias>/<repo>/<name>`. */
const REGISTRY_DEP_RE = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/;

/** Объект (не null и не массив). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Резолвит raw-базу реестра.
 *
 * Подменяют два имени (VL-382, AC9): `GITVERSE_REGISTRY_BASE_URL` (новое
 * семейство `GITVERSE_*`) и `VIBELOG_REGISTRY_BASE_URL` (историческое, его
 * используют тесты install). Приоритет у нового; если оба заданы — берётся
 * новое, чтобы поведение было предсказуемым. Значение проверяется: молча
 * ходить не туда хуже, чем упасть в тесте. Трейлинг `/` снимается, чтобы не
 * получить `//api`.
 */
export function resolveRegistryBase(env: NodeJS.ProcessEnv = process.env): string {
  const aliasValue = env[REGISTRY_BASE_ENV_ALIAS];
  const envName =
    typeof aliasValue === 'string' && aliasValue.trim() !== ''
      ? REGISTRY_BASE_ENV_ALIAS
      : REGISTRY_BASE_ENV;
  return resolveBase(env, {
    envName,
    defaultBase: DEFAULT_REGISTRY_BASE,
    // Для реестра битая база — сетевая/данные-ошибка (код 3), как и раньше.
    fail: (message, url) => new RegistryFetchError(message, 'network', url),
  });
}

/**
 * Резолвит базу Публичного API (contents-транспорт, VL-382).
 *
 * Подмены: `GITVERSE_REGISTRY_BASE_URL` (общая для обеих схем) →
 * `VIBELOG_GITVERSE_API_BASE` (историческая, её использует Issues-клиент) →
 * `https://api.gitverse.ru`.
 */
export function resolveRegistryApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const registryOverride = env[REGISTRY_BASE_ENV_ALIAS];
  if (typeof registryOverride === 'string' && registryOverride.trim() !== '') {
    return resolveBase(env, {
      envName: REGISTRY_BASE_ENV_ALIAS,
      defaultBase: DEFAULT_API_BASE,
      fail: (message, url) => new RegistryFetchError(message, 'network', url),
    });
  }
  return resolveBase(env, {
    envName: REGISTRY_API_BASE_ENV,
    defaultBase: DEFAULT_API_BASE,
    fail: (message, url) => new RegistryFetchError(message, 'network', url),
  });
}

/**
 * Выбирает схему доступа (VL-382).
 *
 * Правило простое и не подлежит «оптимизации»: нет токена → raw (единственный
 * режим, в котором raw работает), есть токен → Contents API (raw с
 * `Authorization` отвечает 429 всегда). `transport` в опциях переопределяет
 * выбор — нужен тестам и отладке.
 *
 * Явный `baseUrl` переопределяет базу выбранной схемы (фикстуры тестов).
 */
export function resolveRegistryTransport(
  options: ResolveRegistryTransportOptions = {},
): RegistryTransport {
  const env = options.env ?? process.env;
  const token =
    options.token !== undefined ? options.token.trim() : options.cwd !== undefined ? readToken(options.cwd) : '';
  const kind: RegistryTransportKind = options.transport ?? (token === '' ? 'raw' : 'contents');
  const baseUrl =
    options.baseUrl ??
    (kind === 'raw' ? resolveRegistryBase(env) : resolveRegistryApiBase(env));
  return { kind, token: kind === 'raw' ? '' : token, baseUrl };
}

/**
 * Собирает URL raw-файла репозитория GitVerse.
 *
 * Сегменты owner/repo/branch кодируются (в них допустимы пробелы/кириллица),
 * а `/` внутри `path` сохраняется — это путь файла в репозитории.
 */
export function buildRawUrl(
  base: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string {
  const encoded = (segment: string): string => encodeURIComponent(segment);
  const cleanPath = path
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseUrl = base.replace(/\/+$/, '');
  return `${baseUrl}/api/repos/${encoded(owner)}/${encoded(repo)}/raw/branch/${encoded(branch)}/${cleanPath}`;
}

/** Собирает URL JSON элемента реестра (raw-транспорт, VL-335). */
export function buildRegistryItemUrl(
  base: string,
  owner: string,
  repo: string,
  branch: string,
  name: string,
): string {
  return buildRawUrl(base, owner, repo, branch, `public/r/${name}.json`);
}

/**
 * Собирает URL файла через Публичный API GitVerse (VL-382).
 *
 * `GET {api}/repos/{owner}/{repo}/contents/{path}?ref={branch}` — контракт из
 * ref-32. Сегменты пути кодируются по одному, `/` сохраняется (это путь в
 * репозитории). `scope=full` — не «для красоты»: при `fast` сервер может
 * отдать метаданные без содержимого, а нам нужен именно `content`.
 */
export function buildContentsUrl(
  base: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string {
  const cleanPath = path
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseUrl = base.replace(/\/+$/, '');
  return (
    `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath}` +
    `?ref=${encodeURIComponent(branch)}&scope=full`
  );
}

/**
 * Достаёт `message` из тела ошибки GitVerse (`{"code":4305,"message":"..."}`).
 *
 * Реэкспорт общего `extractErrorMessage` из `gitverse-http` — оставлен ради
 * существующих импортёров и тестов VL-335. HTML (типичный ответ на 429)
 * превращается в текст, а не обрезается до 200 символов тегов.
 */
export { extractErrorMessage };

/**
 * Семантика статусов реестра (VL-380, VL-382 — два транспорта).
 *
 * Семантика РАЗНАЯ у двух схем доступа, поэтому `transport` — параметр:
 * - raw (веб-хост): `400`/`404` = «нет файла», `429` — анонимный IP-лимит
 *   (подсказка «задай GITVERSE_TOKEN, пойдёшь через API»);
 * - contents (Публичный API): `401` — токен отвергнут, `403` — нет прав,
 *   `404` — нет файла/ветки, `415` — неверный `Accept` (дефект CLI, а не
 *   пользователя), `429` — лимит API (ретраи по `Retry-After`).
 */
function classifyRegistryStatus(
  status: number,
  text: string,
  what: string,
  branch: string,
  url: string,
  transport: RegistryTransportKind,
): StatusClassification {
  const detail = extractErrorMessage(text);
  const suffix = detail ? `: ${detail}` : '';
  const contents = transport === 'contents';

  if (status === 400 || status === 404) {
    return {
      kind: 'not_found',
      message: contents
        ? `${what} не найден${suffix} (${url}); проверьте имя элемента и ветку «${branch}» (нет файла или ветки)`
        : `${what} не найден${suffix} (${url}); проверьте имя и ветку «${branch}»`,
      retryable: false,
    };
  }

  if (status === 401) {
    return {
      kind: 'unauthorized',
      message: contents
        ? `GitVerse не принял токен (HTTP 401)${suffix} (${url}); проверьте GITVERSE_TOKEN в .env ` +
          `и права «Чтение» на репозиторий реестра (${DEFAULT_REGISTRY_BASE}/settings/tokens); ` +
          'либо убери токен из .env, чтобы запрос шёл анонимно через raw'
        : `GitVerse отклонил токен (HTTP 401)${suffix} (${url}); ` +
          'проверьте GITVERSE_TOKEN в .env',
      retryable: false,
    };
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      message: contents
        ? `GitVerse запретил доступ (HTTP 403)${suffix} (${url}); у токена нет прав «Чтение» ` +
          'на репозиторий реестра — проверьте GITVERSE_TOKEN'
        : `GitVerse запретил доступ (HTTP 403)${suffix} (${url}); ` +
          'проверьте GITVERSE_TOKEN в .env',
      retryable: false,
    };
  }

  if (status === 415) {
    return {
      kind: 'bad_accept',
      message:
        `GitVerse не принял тип ответа (HTTP 415)${suffix} (${url}); ` +
        `Публичный API требует Accept: ${ACCEPT} — это дефект CLI, сообщите о нём`,
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      kind: 'rate_limited',
      message: `GitVerse ограничил запросы (HTTP 429)${suffix} (${url})`,
      retryable: true,
      retryHint: (nextDelayMs) => {
        const seconds = Math.round((nextDelayMs ?? 60_000) / 1000);
        if (contents) {
          return `следующая попытка через ${seconds} с; лимит Публичного API исчерпан — повтори позже`;
        }
        return (
          `следующая попытка через ${seconds} с; GitVerse ограничил анонимные запросы — ` +
          `задай GITVERSE_TOKEN в .env, тогда запросы пойдут через API с более высоким лимитом ` +
          `(${DEFAULT_REGISTRY_BASE}/settings/tokens)`
        );
      },
    };
  }

  if (status >= 500) {
    return {
      kind: 'server',
      message: `реестр ответил ошибкой ${status}${suffix}; повторите позже`,
      retryable: true,
    };
  }

  return {
    kind: 'bad_request',
    message: `реестр ответил ошибкой ${status}${suffix} (${url}); проверьте доступ к реестру`,
    retryable: false,
  };
}

/**
 * Один GET с ретраями, авторизацией и семантикой реестра.
 *
 * Политика ретраев (VL-380):
 * - `5xx` и сетевые ошибки — 2 повтора (`RETRY_DELAYS_MS`);
 * - `429` — отдельная, более длинная политика: пауза из `Retry-After`
 *   (потолок 120 с), иначе `RATE_LIMIT_DELAYS_MS`, суммарно не дольше
 *   3 минут; после исчерпания — подсказка про токен;
 * - `400`/`404` — «не найдено», повторов нет.
 */
async function fetchTextWithRetries(
  url: string,
  what: string,
  branch: string,
  settings: {
    kind: RegistryTransportKind;
    timeoutMs: number;
    maxBodyBytes: number;
    retryDelaysMs: readonly number[];
    rateLimitDelaysMs: readonly number[];
    rateLimitBudgetMs?: number;
    token: string;
  },
  sleepFn?: (ms: number) => Promise<void>,
  onProgress?: ProgressCallback,
): Promise<string> {
  const ctx: TransportContext = {
    what: 'реестр',
    makeError: makeRegistryError,
    mask: (text: string) => maskToken(text, settings.token),
  };

  // Две схемы — два набора заголовков. В raw `authorization` НЕ добавляется
  // ни при каких условиях: raw с Bearer отвечает 429 всегда (замеры
  // 2026-11-09, см. шапку модуля). Токен идёт только в Публичный API.
  const headers: Record<string, string> =
    settings.kind === 'contents'
      ? { accept: ACCEPT, authorization: `Bearer ${settings.token}` }
      : {
          // content-type намеренно игнорируется: GitVerse отдаёт JSON как text/plain.
          accept: 'application/json, text/plain, */*',
        };

  const response = await requestWithRetries({
    ...ctx,
    url,
    method: 'GET',
    headers,
    timeoutMs: settings.timeoutMs,
    maxBodyBytes: settings.maxBodyBytes,
    retryDelaysMs: settings.retryDelaysMs,
    rateLimitDelaysMs: settings.rateLimitDelaysMs,
    ...(settings.rateLimitBudgetMs !== undefined
      ? { rateLimitBudgetMs: settings.rateLimitBudgetMs }
      : {}),
    ...(sleepFn !== undefined ? { sleepFn } : {}),
    ...(onProgress !== undefined ? { onProgress } : {}),
    classify: (status, text) =>
      classifyRegistryStatus(status, text, what, branch, url, settings.kind),
  });

  if (settings.kind === 'raw') return response.text;
  return decodeContentsPayload(response.text, url, what);
}

/**
 * Достаёт текст файла из ответа Contents API (VL-382).
 *
 * Контракт (ref-32): `{type, encoding, content, size, sha, …}`, где `content` —
 * base64. Директория приходит МАССИВОМ без обёртки — это ошибка запроса, а не
 * «пустой файл»: сообщение должно прямо говорить, что получена директория.
 *
 * Валидация жёсткая: молча отдать пустую строку значит записать компонент из
 * нуля байт. Битый base64 ловится проверкой алфавита и длины — Node декодирует
 * мусор без исключения и вернул бы «текст с символами замены».
 */
export function decodeContentsPayload(text: string, url: string, what: string): string {
  const fail = (message: string): never => {
    throw new RegistryFetchError(
      `${what}: ${message} (${url}); проверьте реестр и ветку`,
      'invalid_schema',
      url,
    );
  };

  if (text.trim().startsWith('[')) {
    fail('ответ Contents API — массив (директория), ожидался файл');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('ответ Contents API не является корректным JSON');
  }

  if (!isPlainObject(parsed)) {
    return fail('ответ Contents API не является JSON-объектом файла');
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (type !== undefined && type !== 'file') {
    return fail(`ожидался файл (type: "file"), получено type: «${String(type)}»`);
  }
  const encoding = obj.encoding;
  if (encoding !== 'base64') {
    return fail(`ожидалась кодировка base64 (encoding: "base64"), получено «${String(encoding)}»`);
  }
  const content = obj.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return fail('поле content пустое — сервер не отдал содержимое файла');
  }

  // Переводы строк в base64 допустимы (сервер может резать строку) — убираем.
  const base64 = content.replace(/\s+/g, '');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return fail('поле content не является корректным base64');
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Валидирует форму элемента реестра (doc-25 §3.3).
 *
 * Проверяются только типы полей и абсолютность путей. Переходы вверх («..»)
 * здесь намеренно НЕ проверяются (VL-383): легальность `..` зависит от типа
 * алиаса (для алиасов-файлов `utils`/`css` база — каталог файла, поэтому
 * `../utils.ts` законен; для алиасов-каталогов — запрещён). Алиас на этом
 * слое неизвестен, поэтому единственное место такой проверки —
 * `resolveAliasPath` в `components-config.ts`: там же есть финальная проверка
 * «путь остался внутри корня проекта». Дублировать её в валидации формы
 * нельзя — две проверки одного и того же расходятся (так и появился VL-383).
 */
export function validateRegistryItem(raw: unknown, expectedName?: string): RegistryItem {
  const failed: string[] = [];

  if (!isPlainObject(raw)) {
    throw new RegistryFetchError(
      'ответ реестра не является JSON-объектом элемента; проверьте реестр',
      'invalid_schema',
      '',
      {},
    );
  }

  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '') {
    failed.push('name (ожидалась непустая строка)');
  } else if (expectedName !== undefined && name !== expectedName) {
    failed.push(`name («${name}» не совпадает с запрошенным «${expectedName}»)`);
  }

  const type = raw.type;
  if (typeof type !== 'string' || !(REGISTRY_ITEM_TYPES as readonly string[]).includes(type)) {
    failed.push(`type (ожидалось одно из ${REGISTRY_ITEM_TYPES.join(', ')})`);
  }

  const version = raw.version;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    failed.push('version (ожидался формат X.Y.Z)');
  }

  const dependencies = raw.dependencies;
  if (
    !Array.isArray(dependencies) ||
    dependencies.some((dep) => typeof dep !== 'string' || dep.trim() === '')
  ) {
    failed.push('dependencies (ожидался массив строк)');
  }

  const registryDependencies = raw.registryDependencies;
  if (
    !Array.isArray(registryDependencies) ||
    registryDependencies.some(
      (dep) => typeof dep !== 'string' || !REGISTRY_DEP_RE.test(dep.trim()),
    )
  ) {
    failed.push('registryDependencies (ожидался массив строк вида <alias>/<repo>/<name>)');
  }

  const files = raw.files;
  if (!Array.isArray(files) || files.length === 0) {
    failed.push('files (ожидался непустой массив)');
  } else {
    files.forEach((file, index) => {
      if (!isPlainObject(file)) {
        failed.push(`files[${index}] (ожидался объект {path, target, type})`);
        return;
      }
      if (typeof file.path !== 'string' || file.path.trim() === '') {
        failed.push(`files[${index}].path (ожидалась непустая строка)`);
      }
      if (typeof file.type !== 'string' || file.type.trim() === '') {
        failed.push(`files[${index}].type (ожидалась непустая строка)`);
      }
      const target = file.target;
      if (typeof target !== 'string' || target.trim() === '') {
        failed.push(`files[${index}].target (ожидалась непустая строка)`);
      } else if (isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('~')) {
        failed.push(`files[${index}].target («${target}» не должен быть абсолютным путём)`);
      }
    });
  }

  if (failed.length > 0) {
    const shownName = typeof name === 'string' && name !== '' ? name : (expectedName ?? '?');
    throw new RegistryFetchError(
      `элемент реестра «${shownName}» не прошёл валидацию: ${failed.join('; ')}`,
      'invalid_schema',
      '',
    );
  }

  return {
    name: name as string,
    type: type as RegistryItemType,
    version: version as string,
    dependencies: dependencies as string[],
    registryDependencies: registryDependencies as string[],
    files: (files as Record<string, unknown>[]).map((file) => ({
      path: file.path as string,
      target: file.target as string,
      type: file.type as string,
    })),
  };
}

/**
 * Скачивает сырой файл репозитория реестра (VL-337).
 *
 * Нужен `vb install`: манифест элемента (doc-25 §3.3) содержит только
 * `path`/`target`/`type`, а сам код файла лежит отдельно и забирается тем же
 * GET-ом. Ретраи и коды ошибок — общие с `fetchRegistryItem` (одна политика
 * на весь сетевой слой).
 */
export async function fetchRegistryFile(
  options: FetchRegistryFileOptions,
): Promise<string> {
  const {
    owner,
    repo,
    path,
    branch = DEFAULT_REGISTRY_BRANCH,
    timeoutMs = REQUEST_TIMEOUT_MS,
    retryDelaysMs = RETRY_DELAYS_MS,
    rateLimitDelaysMs = RATE_LIMIT_DELAYS_MS,
    rateLimitBudgetMs,
    env,
  } = options;
  const transport = resolveTransportFor(options);
  const maxBodyBytes =
    options.maxBodyBytes ?? (transport.kind === 'contents' ? CONTENTS_MAX_BODY_BYTES : MAX_BODY_BYTES);
  const url = buildTransportUrl(transport, owner, repo, branch, path);
  return fetchTextWithRetries(
    url,
    path,
    branch,
    {
      kind: transport.kind,
      timeoutMs,
      maxBodyBytes,
      retryDelaysMs,
      rateLimitDelaysMs,
      ...(rateLimitBudgetMs !== undefined ? { rateLimitBudgetMs } : {}),
      token: transport.token,
    },
    options.sleepFn,
    options.onProgress,
  );
}

/** Решение по схеме доступа для конкретного вызова (VL-382). */
function resolveTransportFor(options: RegistryFetchCommonOptions): RegistryTransport {
  return resolveRegistryTransport({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.token !== undefined ? { token: options.token } : {}),
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
  });
}

/** URL файла по выбранной схеме доступа. */
function buildTransportUrl(
  transport: RegistryTransport,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string {
  return transport.kind === 'contents'
    ? buildContentsUrl(transport.baseUrl, owner, repo, branch, path)
    : buildRawUrl(transport.baseUrl, owner, repo, branch, path);
}

/**
 * Скачивает и валидирует JSON элемента реестра.
 *
 * Ретраи — 5xx, сетевые ошибки и 429 (VL-380: 429 по определению «повтори
 * позже», пауза берётся из `Retry-After`). `400`/`404` — «не найдено»,
 * повтор бессмысленен; `401`/`403` — сразу ошибка с подсказкой проверить
 * токен. В финальном сообщении указывается число попыток: ретраи не должны
 * маскировать реальную поломку реестра.
 */
export async function fetchRegistryItem(
  options: FetchRegistryItemOptions,
): Promise<RegistryItem> {
  const {
    owner,
    repo,
    name,
    branch = DEFAULT_REGISTRY_BRANCH,
    timeoutMs = REQUEST_TIMEOUT_MS,
    retryDelaysMs = RETRY_DELAYS_MS,
    rateLimitDelaysMs = RATE_LIMIT_DELAYS_MS,
    rateLimitBudgetMs,
    sleepFn,
  } = options;
  const transport = resolveTransportFor(options);
  const maxBodyBytes =
    options.maxBodyBytes ?? (transport.kind === 'contents' ? CONTENTS_MAX_BODY_BYTES : MAX_BODY_BYTES);
  const token = transport.token;
  const url = buildTransportUrl(transport, owner, repo, branch, `public/r/${name}.json`);
  const text = await fetchTextWithRetries(
    url,
    `элемент реестра «${name}»`,
    branch,
    {
      kind: transport.kind,
      timeoutMs,
      maxBodyBytes,
      retryDelaysMs,
      rateLimitDelaysMs,
      ...(rateLimitBudgetMs !== undefined ? { rateLimitBudgetMs } : {}),
      token,
    },
    sleepFn,
    options.onProgress,
  );

  const ctx: TransportContext = {
    what: 'реестр',
    makeError: makeRegistryError,
    mask: (value: string) => maskToken(value, token),
  };

  let parsed: unknown;
  try {
    parsed = parseJson(text, url, ctx);
  } catch (err) {
    if (err instanceof RegistryFetchError) {
      throw new RegistryFetchError(
        `ответ реестра не является корректным JSON (${url}); проверьте реестр`,
        'invalid_json',
        url,
      );
    }
    throw err;
  }
  try {
    return validateRegistryItem(parsed, name);
  } catch (err) {
    if (err instanceof RegistryFetchError) {
      // Дополняем пустой url из валидатора адресом запроса.
      throw new RegistryFetchError(err.message, err.kind, url);
    }
    throw err;
  }
}
