/**
 * HTTP-клиент GitVerse Issues (VL-363) — транспорт баг-репортов между
 * проектами Vibelog.
 *
 * Зачем модуль. Дочерние проекты (`Vibelog-md/ui`, `Vibelog-md/templates`) —
 * самостоятельные проекты со своими `backlog/`; инструменты агента ограничены
 * корнем проекта, поэтому завести задачу в родительском репозитории оттуда
 * физически нельзя. Обход «сформулируй баг промптом, человек скопирует» —
 * ручной шаг. GitVerse Issues даёт номер issue как естественный ack и дедуп.
 *
 * Почему не переиспользуем `registry-fetch.ts` (VL-335). Там другой хост
 * (`gitverse.ru/api/repos/.../raw/...`), `text/plain` в успешном ответе и
 * 400 вместо 404 на отсутствующий файл. Здесь — `api.gitverse.ru`, обычный
 * JSON, стандартные HTTP-статусы и кастомный `Accept`. Общими остаются только
 * приёмы: таймаут через `AbortController`, ретраи на 5xx/сетевые, лимит тела.
 *
 * Жёсткие инварианты:
 * - токен НИКОГДА не попадает в текст ошибки/ack — только через `maskToken`;
 * - таймер таймаута гасится в `finally` (живой `setTimeout` держит event loop
 *   и ломает vitest);
 * - ретраи только на 5xx и сетевые ошибки: 4xx повторять бессмысленно;
 * - базовый URL приходит параметром или из `VIBELOG_GITVERSE_API_BASE`
 *   (подмена базы для тестов), домен захардкожен ровно один раз.
 */

import { fetch as undiciFetch } from 'undici';
import { loadConfig } from './config.js';
import { loadSettings, saveSettingsPatch } from './settings.js';
import { readEnvFile } from './setup-secrets.js';
import { resolveGitUpstreamConfig, reportId, sourceProjectName, writeReport } from './upstream-git.js';
import type { UpstreamGitConfig } from './upstream-git.js';

/** База API GitVerse по умолчанию (не `gitverse.ru` — именно `api.`). */
export const DEFAULT_API_BASE = 'https://api.gitverse.ru';

/** Переменная окружения, подменяющая базу целиком (только для тестов). */
export const API_BASE_ENV = 'VIBELOG_GITVERSE_API_BASE';

/** Имя переменной `.env` с токеном GitVerse (зафиксировано, VL-363). */
export const GITVERSE_TOKEN_ENV = 'GITVERSE_TOKEN';

/** Обязательный заголовок Accept Публичного API GitVerse. */
export const ACCEPT = 'application/vnd.gitverse.object+json;version=1';

/** Таймаут одного запроса, мс. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Максимальный размер тела ответа, байт (1 МБ — с запасом для issues). */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Паузы между повторами: до двух повторов, только 5xx и сетевые ошибки. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1500];

/** Допустимые типы задач GitVerse. */
export const ISSUE_TYPES = ['task', 'bug', 'story', 'epic'] as const;

/** Тип задачи GitVerse. */
export type IssueType = (typeof ISSUE_TYPES)[number];

/** Максимальная длина имени метки в GitVerse. */
export const LABEL_NAME_MAX = 20;

/**
 * Вид ошибки. От него зависят и текст, и ретрай, и код выхода CLI.
 *
 * `config`/`no_token` — не сетевые: это «не настроено», код 2 и 4.
 */
export type GitverseErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid_json'
  | 'config'
  | 'no_token';

/** Код выхода CLI по виду ошибки (0 — успех, 1 — использование). */
const EXIT_CODES: Record<GitverseErrorKind, number> = {
  unauthorized: 3,
  forbidden: 3,
  not_found: 3,
  bad_request: 3,
  server: 3,
  network: 3,
  timeout: 3,
  invalid_json: 3,
  config: 2,
  no_token: 4,
};

/**
 * Ошибка работы с GitVerse Issues.
 *
 * `code` — код выхода CLI (AC2): 2 — конфиг, 3 — сеть/данные, 4 — нет токена.
 * `message` самодостаточен (печатается одной строкой, без стектрейса) и
 * всегда прошёл через `maskToken`.
 */
export class GitverseError extends Error {
  /** Код выхода CLI. */
  readonly code: number;
  readonly kind: GitverseErrorKind;
  /** HTTP-статус, если ошибка пришла от сервера. */
  readonly status?: number;
  /** URL запроса (для диагностики). */
  readonly url: string;
  /** Сколько попыток сделали до отказа. */
  readonly attempts: number;

  constructor(
    message: string,
    kind: GitverseErrorKind,
    url = '',
    details: { status?: number; attempts?: number } = {},
  ) {
    super(message);
    this.name = 'GitverseError';
    this.kind = kind;
    this.code = EXIT_CODES[kind];
    this.url = url;
    this.status = details.status;
    this.attempts = details.attempts ?? 1;
  }
}

/** Разрешённая конфигурация upstream (секция `upstream` + токен). */
export interface UpstreamConfig {
  /** Транспорт: GitVerse Issues (для `git` — см. `UpstreamGitConfig`). */
  mode?: 'api';
  /** `owner/name` как в настройках. */
  repo: string;
  owner: string;
  name: string;
  /** Токен GitVerse (никогда не печатать). */
  token: string;
  /** Метки, которые вешаются на issue (создаются при отсутствии). */
  labels: string[];
  /** Тип задачи GitVerse. */
  type: IssueType;
  /** id проекта GitVerse (нужен следующей задаче — закрытие). */
  projectId?: number;
  /** Колонка «Done» проекта (нужна следующей задаче). */
  doneColumn?: string;
  /** База API (по умолчанию `DEFAULT_API_BASE`). */
  apiBase: string;
}

/** Параметры создания issue. */
export interface CreateIssueInput {
  title: string;
  body?: string;
  type?: IssueType;
  labels?: string[];
}

/** Созданная задача GitVerse. */
export interface CreatedIssue {
  number: number;
  id: number | string;
  html_url: string;
}

/** Задача GitVerse в списке (минимально нужный набор полей). */
export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  labels: string[];
  html_url: string;
}

/** Результат `listIssues`. */
export interface IssueList {
  issues: IssueSummary[];
  /** Есть ли следующая страница (заголовок `Link` с `rel="next"`). */
  hasMore: boolean;
  /** URL следующей страницы, если есть. */
  nextUrl?: string;
}

/** Фильтры списка задач (подмножество query-параметров API). */
export interface IssueQuery {
  state?: 'open' | 'closed';
  labels?: string[];
  q?: string;
  type?: IssueType;
  perPage?: number;
  page?: number;
}

/** Опции запроса (инъекция для тестов). */
export interface RequestOptions {
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  maxBodyBytes?: number;
  /** Окружение для `resolveApiBase` (по умолчанию `process.env`). */
  env?: NodeJS.ProcessEnv;
}

/** Объект (не null и не массив). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Вырезает токен из произвольного текста (AC4).
 *
 * Токен может попасть в текст ошибки двумя путями: сервер вернул его в теле
 * (маловероятно, но бывает в эхе запроса) или мы сами вставили URL с query.
 * Маскирование — последняя линия: даже если кто-то забудет вызвать функцию,
 * `GitverseError` создаётся только через `fail()` ниже.
 */
export function maskToken(text: string, token: string): string {
  if (!token || token.length < 4) return text;
  return text.split(token).join('***');
}

/**
 * Резолвит базу API.
 *
 * `VIBELOG_GITVERSE_API_BASE` подменяет `https://api.gitverse.ru` целиком
 * (схема + хост + порт) — иначе юнит-тесты ходили бы в реальную сеть.
 */
export function resolveApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[API_BASE_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_API_BASE;
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GitverseError(
      `переменная ${API_BASE_ENV} содержит некорректный URL «${value}»; ожидался полный адрес вида https://<хост>`,
      'config',
      value,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new GitverseError(
      `переменная ${API_BASE_ENV} должна содержать http(s)-адрес, получено «${parsed.protocol}//…»`,
      'config',
      value,
    );
  }
  return value.replace(/\/+$/, '');
}

/**
 * Читает токен: приоритет shell env → `.env` (VL-329).
 *
 * Используется `readEnvFile` из core, а не `loadDotEnv` из `bot/env.ts`:
 * последний пишет в `process.env` и тянет за собой bot-слой, которому в core
 * не место. Парсер тот же (комментарии, `export KEY=`, кавычки).
 */
export function readToken(cwd: string, envName: string = GITVERSE_TOKEN_ENV): string {
  const fromShell = process.env[envName];
  if (typeof fromShell === 'string' && fromShell.trim() !== '') return fromShell.trim();
  const fromFile = readEnvFile(cwd)[envName];
  return typeof fromFile === 'string' ? fromFile.trim() : '';
}

/** Подсказка «как завести токен» — единый текст для CLI и MCP (AC3). */
export function tokenHint(envName: string = GITVERSE_TOKEN_ENV): string {
  return (
    `добавь ${envName}=<токен> в .env (создать: https://gitverse.ru/settings/tokens, ` +
    'права: Запись на репозиторий)'
  );
}

/** Подсказка «как настроить секцию upstream» — единый текст (AC5). */
export function configHint(): string {
  return (
    'добавь в .vibelog/settings.json секцию upstream: ' +
    '{"mode": "git", "inbox": "git@gitverse.ru:owner/inbox.git", "prefix": "vl"} ' +
    'либо {"mode": "api", "repo": "owner/name", "labels": ["upstream"], "type": "bug"}'
  );
}

/** Режим транспорта: `git` (по умолчанию, VL-375) или `api` (GitVerse Issues, VL-363). */
export type UpstreamMode = 'git' | 'api';

/** Разрешённая конфигурация любого транспорта (discriminated union по `mode`). */
export type UpstreamTransportConfig = UpstreamGitConfig | UpstreamConfig;

/**
 * Читает режим транспорта из секции `upstream`.
 *
 * Поле `mode` отсутствует → `git`: основной транспорт (API «Задачи 2.0»
 * закрыт, см. doc-28). Невалидное значение → `config`.
 */
function upstreamMode(raw: Record<string, unknown>): UpstreamMode {
  const mode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : '';
  if (mode === '') return 'git';
  if (mode !== 'git' && mode !== 'api') {
    throw new GitverseError(
      `поле upstream.mode: ожидалось «git» или «api», получено ${JSON.stringify(raw.mode)} — ${configHint()}`,
      'config',
    );
  }
  return mode;
}

/**
 * Настроен ли upstream: `true` только при валидной секции (fail-closed).
 *
 * Нужен условной видимости MCP-инструмента `upstream_report_bug`: если
 * инструмент всё равно не сработает (нет `inbox`/`repo`), клиент не должен
 * даже видеть его существование. Любая ошибка чтения настроек → `false`.
 */
export function isUpstreamConfigured(cwd: string): boolean {
  try {
    const raw = loadSettings(cwd).upstream;
    if (!isPlainObject(raw)) return false;
    if (upstreamMode(raw) === 'git') {
      return typeof raw.inbox === 'string' && raw.inbox.trim() !== '';
    }
    const repo = typeof raw.repo === 'string' ? raw.repo.trim() : '';
    const parts = repo.split('/');
    return parts.length === 2 && parts[0].trim() !== '' && parts[1].trim() !== '';
  } catch {
    return false;
  }
}

/**
 * Разрешает и валидирует конфигурацию upstream (AC5).
 *
 * Discriminated union по `mode` (VL-375):
 * - `git` (по умолчанию) — требует `inbox`, `prefix` опционален (дефолт из
 *   `task_prefix`);
 * - `api` — требует `repo` + токен, читаются `labels`/`type`/`token_env`.
 *
 * Ошибки: нет секции → `kind:'config'` с подсказкой; нет токена →
 * `kind:'no_token'` с подсказкой. `token_env` переопределяет имя переменной
 * (нестандартный случай: отдельный токен на другой репозиторий).
 */
export function resolveUpstreamConfig(cwd: string, opts: RequestOptions = {}): UpstreamTransportConfig {
  const raw = loadSettings(cwd).upstream;
  if (!isPlainObject(raw)) {
    throw new GitverseError(`секция upstream не настроена — ${configHint()}`, 'config');
  }
  // VL-375: основным транспортом стал git-инбокс — ветвление по mode
  if (upstreamMode(raw) === 'git') return resolveGitUpstreamConfig(cwd, raw);

  const repo = typeof raw.repo === 'string' ? raw.repo.trim() : '';
  const parts = repo.split('/');
  if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') {
    throw new GitverseError(
      `поле upstream.repo: ожидался «owner/name», получено ${JSON.stringify(raw.repo)} — ${configHint()}`,
      'config',
    );
  }
  const [owner, name] = parts.map((part) => part.trim());

  const typeRaw = typeof raw.type === 'string' ? raw.type.trim() : 'bug';
  if (!(ISSUE_TYPES as readonly string[]).includes(typeRaw)) {
    throw new GitverseError(
      `поле upstream.type: ожидалось одно из ${ISSUE_TYPES.join(', ')}, получено ${JSON.stringify(raw.type)}`,
      'config',
    );
  }

  let labels: string[] = [];
  if (raw.labels !== undefined) {
    if (!Array.isArray(raw.labels) || raw.labels.some((l) => typeof l !== 'string' || l.trim() === '')) {
      throw new GitverseError('поле upstream.labels: ожидался массив непустых строк', 'config');
    }
    labels = (raw.labels as string[]).map((l) => l.trim());
  }
  if (labels.length === 0) {
    // Дефолт: `upstream` + `from-<prefix>` — по ним родитель фильтрует импорт.
    let prefix = 'vl';
    try {
      const rawPrefix = loadConfig(cwd).task_prefix;
      if (typeof rawPrefix === 'string' && rawPrefix.trim() !== '') prefix = rawPrefix.trim().toLowerCase();
    } catch {
      // нет backlog/config.yml — дефолтный префикс
    }
    labels = ['upstream', `from-${prefix}`];
  }

  let projectId: number | undefined;
  if (raw.project_id !== undefined) {
    if (typeof raw.project_id !== 'number' || !Number.isInteger(raw.project_id)) {
      throw new GitverseError('поле upstream.project_id: ожидалось целое число', 'config');
    }
    projectId = raw.project_id;
  }

  let doneColumn: string | undefined;
  if (raw.done_column !== undefined) {
    if (typeof raw.done_column !== 'string' || raw.done_column.trim() === '') {
      throw new GitverseError('поле upstream.done_column: ожидалась непустая строка', 'config');
    }
    doneColumn = raw.done_column.trim();
  }

  const envName =
    typeof raw.token_env === 'string' && raw.token_env.trim() !== ''
      ? raw.token_env.trim()
      : GITVERSE_TOKEN_ENV;
  const token = readToken(cwd, envName);
  if (token === '') {
    throw new GitverseError(`токен GitVerse не задан — ${tokenHint(envName)}`, 'no_token');
  }

  return {
    mode: 'api',
    repo,
    owner,
    name,
    token,
    labels,
    type: typeRaw as IssueType,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(doneColumn !== undefined ? { doneColumn } : {}),
    apiBase: resolveApiBase(opts.env),
  };
}

/**
 * Записывает секцию `upstream` в `.vibelog/settings.json` (AC5).
 *
 * Read-modify-write через `saveSettingsPatch`: чужие секции (`chats`,
 * `models`, `providers`, `components`) сохраняются байт-в-байт.
 */
export function saveUpstreamConfig(cwd: string, section: Record<string, unknown>): void {
  saveSettingsPatch(cwd, { upstream: section });
}

/**
 * Разбирает тело ошибки GitVerse (AC2).
 *
 * Поддерживаются ОБЕ формы, встречающиеся в документации:
 * - `{"error": {"code": "BAD_REQUEST", "message": "...", "status": 400}}`;
 * - `{"message": "...", "documentation_url": "..."}` (раздел проектов).
 *
 * Чистая функция: тестируется без сети. Не-JSON тело обрезается до одной
 * строки — сообщение об ошибке должно печататься одной строкой.
 */
export function parseGitverseError(
  status: number,
  bodyText: string,
): { code?: string; message: string; documentationUrl?: string } {
  const trimmed = (bodyText ?? '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isPlainObject(parsed)) {
        const nested = parsed.error;
        if (isPlainObject(nested)) {
          const message =
            typeof nested.message === 'string' && nested.message.trim() !== ''
              ? nested.message.trim()
              : `HTTP ${status}`;
          return {
            ...(typeof nested.code === 'string' ? { code: nested.code } : {}),
            message,
            ...(typeof nested.documentation_url === 'string'
              ? { documentationUrl: nested.documentation_url }
              : {}),
          };
        }
        if (typeof parsed.message === 'string' && parsed.message.trim() !== '') {
          return {
            message: parsed.message.trim(),
            ...(typeof parsed.documentation_url === 'string'
              ? { documentationUrl: parsed.documentation_url }
              : {}),
          };
        }
      }
    } catch {
      // не JSON — падаем в обрезку сырого текста
    }
  }
  const oneLine = trimmed.replace(/\s+/g, ' ');
  return { message: oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine || `HTTP ${status}` };
}

/** Вид ошибки по HTTP-статусу. */
function kindByStatus(status: number): GitverseErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Человеческая подсказка по виду ошибки. */
function hintByKind(kind: GitverseErrorKind): string {
  switch (kind) {
    case 'unauthorized':
      return 'проверь токен: он недействителен или истёк (https://gitverse.ru/settings/tokens)';
    case 'forbidden':
      return 'у токена нет прав на репозиторий — нужны права Запись';
    case 'not_found':
      return 'проверь upstream.repo (owner/name) и права токена на репозиторий';
    case 'bad_request':
      return 'проверь поля запроса (title непустой, метки существуют в репозитории)';
    case 'server':
      return 'GitVerse ответил ошибкой — повтори позже';
    case 'network':
      return 'проверь сеть и повтори';
    case 'timeout':
      return 'GitVerse не ответил вовремя — повтори позже';
    case 'invalid_json':
      return 'ответ GitVerse не разобрался как JSON — повтори позже';
    default:
      return '';
  }
}

/** Собирает URL запроса с query-параметрами. */
function buildUrl(base: string, path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${base.replace(/\/+$/, '')}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
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

/** Достаёт машинный код сетевой ошибки (undici складывает его в cause). */
function networkErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === 'string') return e.code;
  const cause = e?.cause as { code?: unknown } | undefined;
  if (cause && typeof cause.code === 'string') return cause.code;
  return undefined;
}

/** Текст сетевой ошибки для сообщения об одной строке. */
function networkErrorMessage(err: unknown): string {
  const code = networkErrorCode(err);
  if (code) return code;
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 200);
}

/** Пауза между повторами. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Читает тело ответа чанками с лимитом байт. */
async function readBodyLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
  url: string,
  token: string,
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
        await reader.cancel().catch(() => undefined);
        throw new GitverseError(
          maskToken(`ответ GitVerse больше лимита ${maxBodyBytes} байт (${url})`, token),
          'invalid_json',
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

/** Минимальный интерфейс заголовков ответа (нужен только `Link`). */
interface ResponseHeaders {
  get(name: string): string | null;
}

/** Результат одной попытки. */
interface AttemptResult {
  status: number;
  text: string;
  headers: ResponseHeaders;
}

/**
 * Одна попытка запроса с таймаутом.
 *
 * Таймер обязательно гасится в `finally`: живой `setTimeout` держит event loop
 * и vitest сообщает о висящем хендлере.
 */
async function fetchOnce(
  url: string,
  token: string,
  method: string,
  body: unknown,
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
          new GitverseError(
            maskToken(`GitVerse не ответил за ${Math.round(timeoutMs / 1000)} с (${url}); повтори позже`, token),
            'timeout',
            url,
          ),
        ),
      { once: true },
    );
  });

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: ACCEPT,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const work = (async (): Promise<AttemptResult> => {
    const response = await undiciFetch(url, {
      method,
      signal: controller.signal,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await readBodyLimited(
      response.body as unknown as ReadableStream<Uint8Array> | null,
      maxBodyBytes,
      url,
      token,
    );
    return { status: response.status, text, headers: response.headers as unknown as ResponseHeaders };
  })();

  try {
    return await Promise.race([work, timeoutReject]);
  } catch (err) {
    if (err instanceof GitverseError) throw err;
    if (timedOut || controller.signal.aborted) {
      throw new GitverseError(
        maskToken(`GitVerse не ответил за ${Math.round(timeoutMs / 1000)} с (${url}); повтори позже`, token),
        'timeout',
        url,
      );
    }
    throw new GitverseError(
      maskToken(`не удалось связаться с GitVerse (${networkErrorMessage(err)}): ${url}; проверь сеть`, token),
      'network',
      url,
    );
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined);
  }
}

/**
 * Запрос с ретраями и классификацией ответа.
 *
 * Ретраи — только 5xx и сетевые ошибки (до двух повторов, паузы
 * `RETRY_DELAYS_MS`). 4xx не повторяются: 401/403/404 не «моргнули».
 */
async function request(
  cfg: UpstreamConfig,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  opts: {
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    timeoutMs?: number;
    retryDelaysMs?: readonly number[];
    maxBodyBytes?: number;
  } = {},
): Promise<AttemptResult> {
  const url = buildUrl(cfg.apiBase, path, opts.query);
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const attemptsMax = retryDelays.length + 1;

  for (let attempt = 1; attempt <= attemptsMax; attempt += 1) {
    let result: AttemptResult;
    try {
      result = await fetchOnce(url, cfg.token, method, opts.body, timeoutMs, maxBodyBytes);
    } catch (err) {
      const failure = err instanceof GitverseError ? err : undefined;
      // timeout/invalid_json — не ретраим: повтор даст тот же результат.
      if (!failure || (failure.kind !== 'server' && failure.kind !== 'network')) throw err;
      const delay = retryDelays[attempt - 1];
      if (delay !== undefined) {
        await sleep(delay);
        continue;
      }
      throw new GitverseError(
        maskToken(`${failure.message} — попыток: ${attempt}`, cfg.token),
        failure.kind,
        url,
        { attempts: attempt },
      );
    }

    if (result.status >= 200 && result.status < 300) return result;

    if (result.status >= 500) {
      const delay = retryDelays[attempt - 1];
      if (delay !== undefined) {
        await sleep(delay);
        continue;
      }
      const parsed = parseGitverseError(result.status, result.text);
      throw new GitverseError(
        maskToken(
          `GitVerse ответил ошибкой ${result.status}${parsed.message ? `: ${parsed.message}` : ''} — попыток: ${attempt}; ${hintByKind('server')}`,
          cfg.token,
        ),
        'server',
        url,
        { status: result.status, attempts: attempt },
      );
    }

    const kind = kindByStatus(result.status);
    const parsed = parseGitverseError(result.status, result.text);
    const codePart = parsed.code ? ` [${parsed.code}]` : '';
    throw new GitverseError(
      maskToken(
        `GitVerse ответил ошибкой ${result.status}${codePart}: ${parsed.message} (${url}); ${hintByKind(kind)}`,
        cfg.token,
      ),
      kind,
      url,
      { status: result.status },
    );
  }

  // Недостижимо: цикл либо возвращает значение, либо бросает ошибку.
  throw new GitverseError(
    maskToken(`не удалось выполнить запрос к GitVerse — попыток: ${attemptsMax}`, cfg.token),
    'server',
    url,
    { attempts: attemptsMax },
  );
}

/** Разбирает JSON-тело успешного ответа. */
function parseJson(text: string, url: string, token: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new GitverseError(
      maskToken(`ответ GitVerse не является корректным JSON (${url})`, token),
      'invalid_json',
      url,
    );
  }
}

/** Путь к задачам репозитория. */
function issuesPath(cfg: UpstreamConfig): string {
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.name)}/issues`;
}

/** Путь к меткам репозитория. */
function labelsPath(cfg: UpstreamConfig): string {
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.name)}/labels`;
}

/**
 * Создаёт задачу (AC1).
 *
 * `labels` — массив строк, метки ДОЛЖНЫ уже существовать в репозитории:
 * поэтому вызывающий сначала зовёт `ensureLabels`.
 */
export async function createIssue(
  cfg: UpstreamConfig,
  input: CreateIssueInput,
  opts: RequestOptions = {},
): Promise<CreatedIssue> {
  const title = (input.title ?? '').trim();
  if (title === '') {
    throw new GitverseError('поле title обязательно: заголовок issue не может быть пустым', 'bad_request');
  }
  const type = input.type ?? cfg.type;
  const labels = input.labels ?? cfg.labels;
  const body: Record<string, unknown> = { title, type };
  if (input.body !== undefined && input.body !== '') body.body = input.body;
  if (labels.length > 0) body.labels = labels;

  const url = buildUrl(cfg.apiBase, issuesPath(cfg));
  const result = await request(cfg, 'POST', issuesPath(cfg), { body, ...opts });
  const parsed = parseJson(result.text, url, cfg.token);
  if (!isPlainObject(parsed)) {
    throw new GitverseError(
      maskToken(`ответ GitVerse на создание issue не является объектом (${url})`, cfg.token),
      'invalid_json',
      url,
    );
  }
  const number = parsed.number;
  if (typeof number !== 'number' || !Number.isInteger(number)) {
    throw new GitverseError(
      maskToken(`ответ GitVerse не содержит номера issue (${url})`, cfg.token),
      'invalid_json',
      url,
    );
  }
  return {
    number,
    id: typeof parsed.id === 'number' || typeof parsed.id === 'string' ? parsed.id : number,
    html_url: typeof parsed.html_url === 'string' ? parsed.html_url : '',
  };
}

/**
 * Список меток репозитория (AC1).
 *
 * Пагинация не разворачивается: меток в репозитории единицы, а `limit=100`
 * покрывает реальный случай. ВАЖНО: у `/labels` параметр называется `limit`,
 * а не `per_page` (у `/issues` — наоборот, см. `listIssues`). GitVerse
 * отвечает 400 VALIDATION_ERROR на неизвестный query-параметр (VL-367).
 */
export async function listLabels(cfg: UpstreamConfig, opts: RequestOptions = {}): Promise<string[]> {
  const url = buildUrl(cfg.apiBase, labelsPath(cfg), { limit: 100 });
  const result = await request(cfg, 'GET', labelsPath(cfg), { query: { limit: 100 }, ...opts });
  const parsed = parseJson(result.text, url, cfg.token);
  if (!Array.isArray(parsed)) {
    throw new GitverseError(
      maskToken(`ответ GitVerse со списком меток не является массивом (${url})`, cfg.token),
      'invalid_json',
      url,
    );
  }
  const out: string[] = [];
  for (const item of parsed) {
    if (isPlainObject(item) && typeof item.name === 'string' && item.name.trim() !== '') {
      out.push(item.name.trim());
    }
  }
  return out;
}

/**
 * Создаёт отсутствующие метки (AC7).
 *
 * Идемпотентно: сначала `GET /labels`, создаются только те, которых нет.
 * Повторный вызов не создаёт дублей и не падает на уже существующей метке.
 */
export async function ensureLabels(
  cfg: UpstreamConfig,
  names: string[],
  opts: RequestOptions = {},
): Promise<{ created: string[]; existing: string[] }> {
  const wanted: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === '' || wanted.includes(name)) continue;
    if (name.length > LABEL_NAME_MAX) {
      throw new GitverseError(
        `имя метки «${name}» длиннее ${LABEL_NAME_MAX} символов — GitVerse такую метку не создаст`,
        'bad_request',
      );
    }
    wanted.push(name);
  }
  if (wanted.length === 0) return { created: [], existing: [] };

  const current = await listLabels(cfg, opts);
  const created: string[] = [];
  const existing: string[] = [];
  for (const name of wanted) {
    if (current.includes(name)) {
      existing.push(name);
      continue;
    }
    await request(cfg, 'POST', labelsPath(cfg), {
      body: { name, color: 'ededed', description: 'Vibelog upstream report' },
      ...opts,
    });
    created.push(name);
  }
  return { created, existing };
}

/** Разбирает заголовок `Link` и достаёт URL с `rel="next"`. */
export function parseNextLink(linkHeader: string | null | undefined): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Список задач репозитория (AC1) — закладывается сразу для следующей задачи
 * (импорт issues в задачи Vibelog).
 *
 * Пагинация — по заголовку `Link` (документация рекомендует ходить по URL из
 * него, а не собирать параметры вручную).
 *
 * ВНИМАНИЕ: здесь `per_page` (как в документации `/issues`), а в `listLabels` —
 * `limit`. Параметры у эндпоинтов разные, перепутать легко (VL-367).
 */
export async function listIssues(
  cfg: UpstreamConfig,
  query: IssueQuery = {},
  opts: RequestOptions = {},
): Promise<IssueList> {
  const params: Record<string, string | number | undefined> = {
    state: query.state,
    labels: query.labels && query.labels.length > 0 ? query.labels.join(',') : undefined,
    q: query.q,
    type: query.type,
    per_page: query.perPage,
    page: query.page,
  };
  const url = buildUrl(cfg.apiBase, issuesPath(cfg), params);
  const result = await request(cfg, 'GET', issuesPath(cfg), { query: params, ...opts });
  const parsed = parseJson(result.text, url, cfg.token);
  if (!Array.isArray(parsed)) {
    throw new GitverseError(
      maskToken(`ответ GitVerse со списком задач не является массивом (${url})`, cfg.token),
      'invalid_json',
      url,
    );
  }
  const issues: IssueSummary[] = [];
  for (const item of parsed) {
    if (!isPlainObject(item)) continue;
    const number = item.number;
    if (typeof number !== 'number') continue;
    const labels: string[] = [];
    if (Array.isArray(item.labels)) {
      for (const label of item.labels) {
        if (typeof label === 'string') labels.push(label);
        else if (isPlainObject(label) && typeof label.name === 'string') labels.push(label.name);
      }
    }
    issues.push({
      number,
      title: typeof item.title === 'string' ? item.title : '',
      state: typeof item.state === 'string' ? item.state : '',
      labels,
      html_url: typeof item.html_url === 'string' ? item.html_url : '',
    });
  }
  const nextUrl = parseNextLink(result.headers?.get?.('link') ?? null);
  return { issues, hasMore: nextUrl !== undefined, ...(nextUrl ? { nextUrl } : {}) };
}

/** Поля для детерминированного тела issue (AC6). */
export interface IssueBodyInput {
  title: string;
  body?: string;
  severity?: string;
  area?: string;
  sourceTask?: string;
  /** Имя проекта-источника (для секции «Источник»). */
  project?: string;
  /** Версия Vibelog (для секции «Окружение»). */
  version?: string;
}

/**
 * Собирает тело issue детерминированно (AC6).
 *
 * Почему не отдаём тело на волю модели: формат поедет — у каждого вызова
 * будет своя структура, и импорт в родителе не сможет разобрать секции.
 * Секции фиксированы: «Что произошло», «Воспроизведение», «Окружение»,
 * «Источник».
 */
export function buildIssueBody(input: IssueBodyInput): string {
  const lines: string[] = [];
  lines.push('## Что произошло', '', (input.body ?? '').trim() || input.title.trim(), '');

  lines.push('## Воспроизведение', '');
  lines.push('1. Открыть проект и выполнить действие, описанное выше.');
  lines.push('2. Наблюдать поведение из раздела «Что произошло».');
  lines.push('');

  lines.push('## Окружение', '');
  if (input.severity) lines.push(`- severity: ${input.severity}`);
  if (input.area) lines.push(`- area: ${input.area}`);
  if (input.version) lines.push(`- vibelog: ${input.version}`);
  lines.push('');

  lines.push('## Источник', '');
  if (input.project) lines.push(`- проект: ${input.project}`);
  if (input.sourceTask) lines.push(`- задача: ${input.sourceTask}`);
  lines.push('- отчёт создан автоматически (vibelog upstream report)');
  lines.push('');
  return lines.join('\n');
}

/** Вход общего пути репорта (MCP-инструмент и CLI идут одним кодом). */
export interface ReportBugInput {
  title: string;
  body?: string;
  severity?: string;
  area?: string;
  sourceTask?: string;
  /** Дополнительные метки поверх `upstream.labels`. */
  labels?: string[];
  /** Версия Vibelog для секции «Окружение». */
  version?: string;
  /** Имя проекта-источника для секции «Источник». */
  project?: string;
  /** Получатель отчёта: для git-транспорта — префикс проекта-получателя (VL-375). */
  target?: string;
}

/** Результат репорта через GitVerse Issues (mode: api). */
export interface ReportBugResult {
  number: number;
  url: string;
  labels: string[];
  /** Метки, созданные этим вызовом (для сообщения). */
  createdLabels: string[];
}

/** Результат репорта через git-инбокс (mode: git). */
export interface ReportGitResult {
  /** false — отчёт с таким report_id уже был (идемпотентность). */
  created: boolean;
  /** Путь отчёта в инбоксе (`reports/<prefix>/<файл>.md`). */
  path: string;
  /** Детерминированный id отчёта (sha1) — ack получателя. */
  reportId: string;
  /** Получатель отчёта. */
  target: string;
}

/** Единый результат репорта: транспорт виден по `mode` (VL-375). */
export type ReportResult =
  | ({ mode: 'api' } & ReportBugResult)
  | ({ mode: 'git' } & ReportGitResult);

/**
 * Полный путь репорта: конфиг → транспорт (AC6/AC8).
 *
 * Один код на MCP-инструмент и CLI — иначе два пути разойдутся в деталях
 * (какие поля, какой ack), и «через CLI работает, через MCP нет» станет
 * обычным делом.
 *
 * VL-375: ветвится по `upstream.mode` — `git` (по умолчанию) пишет отчёт в
 * общий репозиторий-инбокс, `api` создаёт issue в GitVerse Issues.
 */
export async function reportBug(
  cwd: string,
  input: ReportBugInput,
  opts: RequestOptions = {},
): Promise<ReportResult> {
  const cfg = resolveUpstreamConfig(cwd, opts);
  const title = (input.title ?? '').trim();
  if (title === '') {
    throw new GitverseError('поле title обязательно: заголовок issue не может быть пустым', 'bad_request');
  }

  if (cfg.mode === 'git') {
    const target = (input.target ?? '').trim();
    if (target === '') {
      throw new GitverseError(
        'поле target обязательно для git-транспорта: укажи получателя отчёта (например --target vl)',
        'config',
      );
    }
    const result = writeReport(cwd, cfg, {
      source_task: (input.sourceTask ?? '').trim(),
      title,
      target,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.area !== undefined ? { area: input.area } : {}),
    });
    return {
      mode: 'git',
      created: result.created,
      path: result.path,
      reportId: reportId({
        source_project: sourceProjectName(cwd, cfg.prefix),
        source_task: (input.sourceTask ?? '').trim(),
        title,
      }),
      target,
    };
  }

  const labels: string[] = [...cfg.labels];
  for (const raw of input.labels ?? []) {
    const name = raw.trim();
    if (name !== '' && !labels.includes(name)) labels.push(name);
  }

  const { created } = await ensureLabels(cfg, labels, opts);
  const issue = await createIssue(
    cfg,
    {
      title,
      body: buildIssueBody({
        title,
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.sourceTask !== undefined ? { sourceTask: input.sourceTask } : {}),
        ...(input.project !== undefined ? { project: input.project } : {}),
        ...(input.version !== undefined ? { version: input.version } : {}),
      }),
      type: cfg.type,
      labels,
    },
    opts,
  );

  return {
    mode: 'api',
    number: issue.number,
    url: issue.html_url,
    labels,
    createdLabels: created,
  };
}
