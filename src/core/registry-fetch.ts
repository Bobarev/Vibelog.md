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
 * Авторизация: анонимные запросы GitVerse жёстко лимитируются (первый реальный
 * `vb install` упал на 429 с HTML-страницей), поэтому при наличии
 * `GITVERSE_TOKEN` (shell env → `.env`, читается `readToken`) уходит
 * `Authorization: Bearer`. Токен необязателен: без него запрос идёт анонимно,
 * как раньше.
 *
 * Жёсткие инварианты:
 * - только GET (никаких HEAD — тест-страховка в registry-fetch.test.mjs);
 * - тело читается чанками с подсчётом байт: лимит 5 МБ — реальная защита от
 *   подмены реестра, а не проверка `content-length` (его может не быть);
 * - базовый URL приходит параметром или из `VIBELOG_REGISTRY_BASE_URL`;
 *   домен gitverse.ru захардкожен ровно один раз — в `DEFAULT_REGISTRY_BASE`;
 * - токен не попадает в тексты ошибок: `mask` из `gitverse-http` вырезает его
 *   из каждого сообщения.
 */

import { isAbsolute } from 'node:path';

import { readToken, maskToken } from './gitverse-auth.js';
import {
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_RATE_LIMIT_DELAYS_MS,
  DEFAULT_TIMEOUT_MS,
  GitverseHttpError,
  extractErrorMessage,
  parseJson,
  requestWithRetries,
  resolveBase,
  type HttpErrorFactory,
  type StatusClassification,
  type TransportContext,
} from './gitverse-http.js';

/**
 * База реестра по умолчанию. Единственное место, где встречается домен:
 * всё остальное получает базу параметром (иначе e2e и юнит-тесты
 * невозможны — кэша нет, а шаблон URL зашит).
 */
export const DEFAULT_REGISTRY_BASE = 'https://gitverse.ru';

/** Переменная окружения, подменяющая базу целиком (только для тестов). */
export const REGISTRY_BASE_ENV = 'VIBELOG_REGISTRY_BASE_URL';

/** Таймаут одного запроса, мс. */
export const REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

/** Максимальный размер тела ответа, байт (5 МБ). */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Паузы между повторами: до двух повторов, только 5xx и сетевые ошибки. */
export const RETRY_DELAYS_MS: readonly number[] = DEFAULT_RETRY_DELAYS_MS;

/** Паузы для 429 без заголовка `Retry-After` (VL-380). */
export const RATE_LIMIT_DELAYS_MS: readonly number[] = DEFAULT_RATE_LIMIT_DELAYS_MS;

/** Код выхода CLI для сетевых/данных ошибок (doc-25 §5.2). */
export const REGISTRY_ERROR_EXIT_CODE = 3;

/** Ветка реестра по умолчанию: в репозиториях GitVerse ветки `main` нет. */
export const DEFAULT_REGISTRY_BRANCH = 'master';

/** Известные типы элементов реестра (формат shadcn). */
export const REGISTRY_ITEM_TYPES = [
  'registry:ui',
  'registry:lib',
  'registry:hook',
  'registry:component',
] as const;

/** Тип элемента реестра. */
export type RegistryItemType = (typeof REGISTRY_ITEM_TYPES)[number];

/** Вид сетевой/данных-ошибки: от него зависит и текст, и ретрай. */
export type RegistryFetchErrorKind =
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
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

/** Общие опции сетевых запросов реестра. */
interface RegistryFetchCommonOptions {
  /** База реестра; по умолчанию — `resolveRegistryBase()`. */
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
  /** Окружение для `resolveRegistryBase` (по умолчанию `process.env`). */
  env?: NodeJS.ProcessEnv;
  /**
   * Каталог проекта для чтения токена из `.env` (VL-380). Токен необязателен:
   * нет каталога/токена — запрос уходит анонимно.
   */
  cwd?: string;
  /** Готовый токен (инъекция для тестов; приоритетнее `cwd`). */
  token?: string;
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
 * Резолвит базу реестра.
 *
 * `VIBELOG_REGISTRY_BASE_URL` подменяет `https://gitverse.ru` целиком
 * (схема + хост + порт). Значение проверяется: молча ходить не туда хуже,
 * чем упасть в тесте. Трейлинг `/` снимается, чтобы не получить `//api`.
 */
export function resolveRegistryBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveBase(env, {
    envName: REGISTRY_BASE_ENV,
    defaultBase: DEFAULT_REGISTRY_BASE,
    // Для реестра битая база — сетевая/данные-ошибка (код 3), как и раньше.
    fail: (message, url) => new RegistryFetchError(message, 'network', url),
  });
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

/** Собирает URL JSON элемента реестра. */
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
 * Достаёт `message` из тела ошибки GitVerse (`{"code":4305,"message":"..."}`).
 *
 * Реэкспорт общего `extractErrorMessage` из `gitverse-http` — оставлен ради
 * существующих импортёров и тестов VL-335. HTML (типичный ответ на 429)
 * превращается в текст, а не обрезается до 200 символов тегов.
 */
export { extractErrorMessage };

/** Токен реестра: явный параметр либо `readToken(cwd)`; пустая строка — аноним. */
function resolveToken(options: RegistryFetchCommonOptions): string {
  if (options.token !== undefined) return options.token.trim();
  if (options.cwd !== undefined) return readToken(options.cwd);
  return '';
}

/**
 * Семантика статусов реестра (VL-380).
 *
 * Отличия от Issues-API: `400` здесь штатный ответ GitVerse на отсутствующий
 * файл (спайк, doc-25 §10), `404` принимаем тоже — на других хостах «не
 * найдено» выглядит привычно. `429` — ретраибельно (пауза из `Retry-After`),
 * `401`/`403` — отдельные виды с подсказкой про токен.
 */
function classifyRegistryStatus(
  status: number,
  text: string,
  what: string,
  branch: string,
  url: string,
): StatusClassification {
  const detail = extractErrorMessage(text);
  const suffix = detail ? `: ${detail}` : '';

  if (status === 400 || status === 404) {
    return {
      kind: 'not_found',
      message: `${what} не найден${suffix} (${url}); проверьте имя и ветку «${branch}»`,
      retryable: false,
    };
  }

  if (status === 401) {
    return {
      kind: 'unauthorized',
      message:
        `GitVerse отклонил токен (HTTP 401)${suffix} (${url}); ` +
        'проверьте GITVERSE_TOKEN в .env или уберите его, чтобы запрос шёл анонимно',
      retryable: false,
    };
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      message:
        `GitVerse запретил доступ (HTTP 403)${suffix} (${url}); ` +
        'проверьте GITVERSE_TOKEN в .env — у токена нет прав на репозиторий реестра',
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
        return (
          `следующая попытка через ${seconds} с; задай GITVERSE_TOKEN в .env — ` +
          `авторизованные запросы лимитируются выше (${DEFAULT_REGISTRY_BASE}/settings/tokens)`
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
    timeoutMs: number;
    maxBodyBytes: number;
    retryDelaysMs: readonly number[];
    rateLimitDelaysMs: readonly number[];
    rateLimitBudgetMs?: number;
    token: string;
  },
  sleepFn?: (ms: number) => Promise<void>,
): Promise<string> {
  const ctx: TransportContext = {
    what: 'реестр',
    makeError: makeRegistryError,
    mask: (text: string) => maskToken(text, settings.token),
  };

  const headers: Record<string, string> = {
    // content-type намеренно игнорируется: GitVerse отдаёт JSON как text/plain.
    accept: 'application/json, text/plain, */*',
  };
  // Только при непустом токене: без него запрос идёт анонимно, как раньше.
  if (settings.token !== '') headers.authorization = `Bearer ${settings.token}`;

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
    classify: (status, text) => classifyRegistryStatus(status, text, what, branch, url),
  });
  return response.text;
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
    maxBodyBytes = MAX_BODY_BYTES,
    retryDelaysMs = RETRY_DELAYS_MS,
    rateLimitDelaysMs = RATE_LIMIT_DELAYS_MS,
    rateLimitBudgetMs,
    env,
  } = options;
  const baseUrl = options.baseUrl ?? resolveRegistryBase(env);
  const url = buildRawUrl(baseUrl, owner, repo, branch, path);
  return fetchTextWithRetries(
    url,
    path,
    branch,
    {
      timeoutMs,
      maxBodyBytes,
      retryDelaysMs,
      rateLimitDelaysMs,
      ...(rateLimitBudgetMs !== undefined ? { rateLimitBudgetMs } : {}),
      token: resolveToken(options),
    },
    options.sleepFn,
  );
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
    maxBodyBytes = MAX_BODY_BYTES,
    retryDelaysMs = RETRY_DELAYS_MS,
    rateLimitDelaysMs = RATE_LIMIT_DELAYS_MS,
    rateLimitBudgetMs,
    env,
    sleepFn,
  } = options;
  const baseUrl = options.baseUrl ?? resolveRegistryBase(env);
  const url = buildRegistryItemUrl(baseUrl, owner, repo, branch, name);
  const token = resolveToken(options);
  const text = await fetchTextWithRetries(
    url,
    `элемент реестра «${name}»`,
    branch,
    {
      timeoutMs,
      maxBodyBytes,
      retryDelaysMs,
      rateLimitDelaysMs,
      ...(rateLimitBudgetMs !== undefined ? { rateLimitBudgetMs } : {}),
      token,
    },
    sleepFn,
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
