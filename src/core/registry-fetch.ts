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
 * Жёсткие инварианты:
 * - только GET (никаких HEAD — тест-страховка в registry-fetch.test.mjs);
 * - таймаут 30 с через `AbortController`, таймер гасится в `finally` (иначе
 *   висящий `setTimeout` держит процесс и ломает vitest);
 * - тело читается чанками с подсчётом байт: лимит 5 МБ — реальная защита от
 *   подмены реестра, а не проверка `content-length` (его может не быть);
 * - базовый URL приходит параметром или из `VIBELOG_REGISTRY_BASE_URL`;
 *   домен gitverse.ru захардкожен ровно один раз — в `DEFAULT_REGISTRY_BASE`.
 */

import { fetch as undiciFetch } from 'undici';

/**
 * База реестра по умолчанию. Единственное место, где встречается домен:
 * всё остальное получает базу параметром (иначе e2e и юнит-тесты
 * невозможны — кэша нет, а шаблон URL зашит).
 */
export const DEFAULT_REGISTRY_BASE = 'https://gitverse.ru';

/** Переменная окружения, подменяющая базу целиком (только для тестов). */
export const REGISTRY_BASE_ENV = 'VIBELOG_REGISTRY_BASE_URL';

/** Таймаут одного запроса, мс. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Максимальный размер тела ответа, байт (5 МБ). */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Паузы между повторами: до двух повторов, только 5xx и сетевые ошибки. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1500];

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
  | 'timeout'
  | 'server'
  | 'network'
  | 'too_large'
  | 'invalid_json'
  | 'invalid_schema';

/**
 * Ошибка загрузки элемента реестра.
 *
 * `code` 3 — «сеть/данные» по doc-25 §5.2; CLI печатает `message` одной
 * строкой с подсказкой действия, поэтому текст самодостаточен и без
 * стектрейса.
 */
export class RegistryFetchError extends Error {
  /** Код выхода CLI. */
  readonly code = REGISTRY_ERROR_EXIT_CODE;
  readonly kind: RegistryFetchErrorKind;
  /** HTTP-статус, если ошибка пришла от сервера. */
  readonly status?: number;
  /** URL запроса (для диагностики). */
  readonly url: string;
  /** Сколько попыток сделали до отказа (для ретраев). */
  readonly attempts: number;

  constructor(
    message: string,
    kind: RegistryFetchErrorKind,
    url: string,
    details: { status?: number; attempts?: number } = {},
  ) {
    super(message);
    this.name = 'RegistryFetchError';
    this.kind = kind;
    this.url = url;
    this.status = details.status;
    this.attempts = details.attempts ?? 1;
  }
}

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

/** Опции загрузки элемента. */
export interface FetchRegistryItemOptions {
  /** База реестра; по умолчанию — `resolveRegistryBase()`. */
  baseUrl?: string;
  owner: string;
  repo: string;
  /** Ветка; по умолчанию `master` (проверено спайком). */
  branch?: string;
  /** Имя элемента реестра (без `.json`). */
  name: string;
  /** Таймаут запроса, мс (инъекция нужна тестам: 30 с в тесте неприемлемо). */
  timeoutMs?: number;
  /** Лимит тела, байт (инъекция для тестов). */
  maxBodyBytes?: number;
  /** Паузы между повторами (инъекция для тестов: не ждать 0.5 + 1.5 с). */
  retryDelaysMs?: readonly number[];
  /** Окружение для `resolveRegistryBase` (по умолчанию `process.env`). */
  env?: NodeJS.ProcessEnv;
}

/** Опции загрузки произвольного файла репозитория реестра (VL-337). */
export interface FetchRegistryFileOptions {
  /** База реестра; по умолчанию — `resolveRegistryBase()`. */
  baseUrl?: string;
  owner: string;
  repo: string;
  /** Путь файла в репозитории реестра (`files[].path` манифеста). */
  path: string;
  /** Ветка; по умолчанию `master`. */
  branch?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  retryDelaysMs?: readonly number[];
  env?: NodeJS.ProcessEnv;
}

/** Коды сетевых ошибок, на которых имеет смысл повторять запрос. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

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
  const raw = env[REGISTRY_BASE_ENV];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_REGISTRY_BASE;
  }
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RegistryFetchError(
      `переменная ${REGISTRY_BASE_ENV} содержит некорректный URL «${value}»; ожидался полный адрес вида https://<хост>:<порт>`,
      'network',
      value,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RegistryFetchError(
      `переменная ${REGISTRY_BASE_ENV} должна содержать http(s)-адрес, получено «${parsed.protocol}//…»`,
      'network',
      value,
    );
  }
  return value.replace(/\/+$/, '');
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

/** Достаёт машинный код сетевой ошибки (undici складывает его в cause). */
function networkErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown }; name?: unknown };
  if (typeof e?.code === 'string') return e.code;
  const cause = e?.cause as { code?: unknown } | undefined;
  if (cause && typeof cause.code === 'string') return cause.code;
  return undefined;
}

/** Текст сетевой ошибки для сообщения об одной строке. */
function networkErrorMessage(err: unknown): string {
  const code = networkErrorCode(err);
  if (code) return code;
  const errno = (err as { cause?: { errno?: unknown }; errno?: unknown })?.cause?.errno;
  if (typeof errno === 'string') return errno;
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 200);
}

/** Ошибка «сервер закрыл соединение», которую undici отдаёт без кода. */
function isSocketHangUp(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /socket hang up|other side closed|aborted/i.test(message);
}

/**
 * Читает тело ответа чанками, считая байты.
 *
 * Стриминг, а не `await response.text()`: 5 МБ-лимит должен срабатывать ДО
 * буферизации всего тела — иначе защита от подмены реестра превращается в
 * способ съесть память.
 */
async function readBodyLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
  url: string,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        // Прерываем загрузку: остаток тела не нужен и не должен скачиваться.
        await reader.cancel().catch(() => undefined);
        throw new RegistryFetchError(
          `ответ реестра больше лимита ${maxBodyBytes} байт (${url}); установка остановлена — проверьте источник`,
          'too_large',
          url,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Результат одной попытки: либо ответ сервера, либо ошибка классифицирована. */
interface AttemptResult {
  status: number;
  text: string;
}

/**
 * Одна попытка GET с таймаутом.
 *
 * Таймер обязательно гасится в `finally`: живой `setTimeout` держит event loop
 * и vitest сообщает о висящем хендле (в проде процесс просто не завершается).
 */
async function fetchOnce(
  url: string,
  timeoutMs: number,
  maxBodyBytes: number,
): Promise<AttemptResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const timeoutReject = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () =>
        reject(
          new RegistryFetchError(
            `реестр не ответил за ${Math.round(timeoutMs / 1000)} с (${url}); проверьте сеть и повторите`,
            'timeout',
            url,
          ),
        ),
      { once: true },
    );
  });

  const work = (async (): Promise<AttemptResult> => {
    const response = await undiciFetch(url, {
      method: 'GET',
      signal: controller.signal,
      // content-type намеренно игнорируется: GitVerse отдаёт JSON как text/plain.
      headers: { accept: 'application/json, text/plain, */*' },
    });
    const text = await readBodyLimited(
      response.body as unknown as ReadableStream<Uint8Array> | null,
      maxBodyBytes,
      url,
    );
    return { status: response.status, text };
  })();

  try {
    return await Promise.race([work, timeoutReject]);
  } catch (err) {
    if (err instanceof RegistryFetchError) throw err;
    if (timedOut || controller.signal.aborted) {
      throw new RegistryFetchError(
        `реестр не ответил за ${Math.round(timeoutMs / 1000)} с (${url}); проверьте сеть и повторите`,
        'timeout',
        url,
      );
    }
    const code = networkErrorCode(err);
    const retryable = (code && RETRYABLE_NETWORK_CODES.has(code)) || isSocketHangUp(err);
    if (retryable || code) {
      throw new RegistryFetchError(
        `не удалось связаться с реестром (${networkErrorMessage(err)}): ${url}; проверьте сеть и повторите`,
        'network',
        url,
      );
    }
    throw new RegistryFetchError(
      `ошибка сети при запросе к реестру (${networkErrorMessage(err)}): ${url}`,
      'network',
      url,
    );
  } finally {
    clearTimeout(timer);
    // Работа могла остаться в фоне после гонки с таймаутом — не оставляем
    // необработанный rejection.
    work.catch(() => undefined);
  }
}

/** Пауза между повторами. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Достаёт `message` из тела ошибки GitVerse (`{"code":4305,"message":"..."}`).
 *
 * Сырой HTML/текст тоже допустим, но обрезается: сообщение об ошибке должно
 * печататься одной строкой.
 */
export function extractErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isPlainObject(parsed) && typeof parsed.message === 'string' && parsed.message.trim() !== '') {
        return parsed.message.trim();
      }
    } catch {
      // не JSON — падаем в обрезку сырого текста
    }
  }
  const oneLine = trimmed.replace(/\s+/g, ' ');
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * Валидирует форму элемента реестра (doc-25 §3.3).
 *
 * Проверяется только форма (типы полей и их наличие): бизнес-логика
 * (`target` внутри проекта, конфликты файлов) — этап установки. Единственное
 * смысловое исключение — `name`: расхождение с запрошенным именем означает
 * подмену или опечатку в реестре.
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
      } else if (target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)) {
        failed.push(`files[${index}].target («${target}» не должен быть абсолютным путём)`);
      } else if (target.split(/[\\/]/).includes('..')) {
        failed.push(`files[${index}].target («${target}» не должен содержать «..»)`);
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
    env,
  } = options;
  const baseUrl = options.baseUrl ?? resolveRegistryBase(env);
  const url = buildRawUrl(baseUrl, owner, repo, branch, path);
  return fetchTextWithRetries(url, path, branch, timeoutMs, maxBodyBytes, retryDelaysMs);
}

/**
 * Скачивает и валидирует JSON элемента реестра.
 *
 * Ретраи — только на 5xx и сетевые ошибки (до двух повторов, паузы
 * `RETRY_DELAYS_MS`). `400`/`404` — это «не найдено», повтор бессмысленен;
 * прочие `4xx` — сразу ошибка. В финальном сообщении указывается число
 * попыток: ретраи не должны маскировать реальную поломку реестра.
 */
export async function fetchRegistryItem(options: FetchRegistryItemOptions): Promise<RegistryItem> {
  const {
    owner,
    repo,
    name,
    branch = DEFAULT_REGISTRY_BRANCH,
    timeoutMs = REQUEST_TIMEOUT_MS,
    maxBodyBytes = MAX_BODY_BYTES,
    retryDelaysMs = RETRY_DELAYS_MS,
    env,
  } = options;
  const baseUrl = options.baseUrl ?? resolveRegistryBase(env);
  const url = buildRegistryItemUrl(baseUrl, owner, repo, branch, name);
  const text = await fetchTextWithRetries(
    url,
    `элемент реестра «${name}»`,
    branch,
    timeoutMs,
    maxBodyBytes,
    retryDelaysMs,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RegistryFetchError(
      `ответ реестра не является корректным JSON (${url}); проверьте реестр`,
      'invalid_json',
      url,
    );
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

/**
 * Общий цикл GET с ретраями и классификацией ответов.
 *
 * Вынесен из `fetchRegistryItem`, чтобы скачивание файла компонента
 * (`fetchRegistryFile`) не дублировало политику ретраев: расхождение в
 * поведении двух сетевых путей — источник трудноуловимых багов.
 *
 * @param what — человекочитаемое описание объекта («элемент реестра «button»»)
 */
async function fetchTextWithRetries(
  url: string,
  what: string,
  branch: string,
  timeoutMs: number,
  maxBodyBytes: number,
  retryDelaysMs: readonly number[],
): Promise<string> {
  const attemptsMax = retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= attemptsMax; attempt += 1) {
    let result: AttemptResult;
    try {
      result = await fetchOnce(url, timeoutMs, maxBodyBytes);
    } catch (err) {
      const failure = err instanceof RegistryFetchError ? err : undefined;
      // timeout/too_large/invalid_* — не ретраим: повтор даст тот же результат.
      if (!failure || (failure.kind !== 'server' && failure.kind !== 'network')) {
        throw err;
      }
      const delay = retryDelaysMs[attempt - 1];
      if (delay !== undefined) {
        await sleep(delay);
        continue;
      }
      const attempts = attempt;
      if (failure.kind === 'network') {
        throw new RegistryFetchError(
          `не удалось связаться с реестром (${failure.message}) — попыток: ${attempts}; проверьте сеть и повторите`,
          'network',
          url,
          { attempts },
        );
      }
      throw failure;
    }

    const { status, text } = result;

    // 400 — штатный ответ GitVerse на отсутствующий файл (спайк, doc-25 §10).
    // 404 принимаем тоже: на других хостах «не найдено» выглядит привычно.
    if (status === 400 || status === 404) {
      const detail = extractErrorMessage(text);
      throw new RegistryFetchError(
        `${what} не найден${detail ? `: ${detail}` : ''} (${url}); проверьте имя и ветку «${branch}»`,
        'not_found',
        url,
        { status },
      );
    }

    if (status >= 200 && status < 300) return text;

    if (status >= 500) {
      const delay = retryDelaysMs[attempt - 1];
      if (delay !== undefined) {
        await sleep(delay);
        continue;
      }
      throw new RegistryFetchError(
        `реестр ответил ошибкой ${status} — попыток: ${attempt}; повторите позже`,
        'server',
        url,
        { status, attempts: attempt },
      );
    }

    // Прочие 4xx (401, 403, 429 …) — ретраить нечего, это не «не найдено».
    const detail = extractErrorMessage(text);
    throw new RegistryFetchError(
      `реестр ответил ошибкой ${status}${detail ? `: ${detail}` : ''} (${url}); проверьте доступ к реестру`,
      'server',
      url,
      { status },
    );
  }

  // Недостижимо: цикл либо возвращает значение, либо бросает ошибку.
  throw new RegistryFetchError(
    `не удалось загрузить ${what} — попыток: ${attemptsMax}`,
    'server',
    url,
    { attempts: attemptsMax },
  );
}
