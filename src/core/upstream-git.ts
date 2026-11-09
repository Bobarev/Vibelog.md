/**
 * Git-транспорт баг-репортов между проектами Vibelog (VL-375).
 *
 * Зачем модуль. HTTP-транспорт через GitVerse Issues (`gitverse-issues.ts`,
 * VL-363) упирается в закрытый доступ: `GET/POST /issues` отдают `403` при
 * рабочих `/repos` и `/labels` — это API «Задачи 2.0», доступ к которому
 * аккаунту не выдан. Основной транспорт поэтому — **общий git-репозиторий-инбокс**:
 * разделяемое состояние для mesh-топологии «многие ко многим» (до 20 проектов).
 *
 * Модель доступа (в git нет прав на подкаталог — права даются на репозиторий):
 *   1. права репозитория: Write — своим проектам, внешние — fork + PR;
 *   2. branch protection на `main`: прямой push только боту-мейнтейнеру;
 *   3. CI-валидация путей: `reports/<prefix>/**` — только свои файлы, в чужих
 *      разрешено менять лишь `status`/`accepted_as` (ack).
 * Третий слой — главный: он ловит типовые аварии агентов (`git add -A` с
 * мусором, коммит чужих файлов).
 *
 * Архитектурное ограничение: агент не может пушить в инбокс сам — файловые
 * инструменты агента ограничены корнем своего проекта. Поэтому клон инбокса
 * живёт ВНУТРИ проекта-источника (`.vibelog/upstream-inbox/`, в .gitignore), а
 * пишет и пушит CLI `vibelog upstream report` (или MCP-сервер, работающий в
 * том же процессе, что и пользователь) — границы агента на него не действуют.
 *
 * Жёсткие инварианты:
 * - `git add` только явным путём файла отчёта: никогда `-A`, `.`, маски
 *   (тот же инвариант, что у `git_commit`, VL-311/VL-360);
 * - slug имени файла строго латиница `[a-z0-9-]`: не-ASCII имена ломали
 *   сравнение путей в git-инструментах (VL-360);
 * - `ackReport` правит РОВНО две строки фронтматтера (`status`, `accepted_as`),
 *   остальной файл остаётся байт-в-байт — иначе проверка CI «менять можно
 *   только ack-поля» падает;
 * - сеть — только `git clone/pull/push`; никакого HTTP.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadConfig } from './config.js';
import { parseYaml } from './yaml.js';

/** Каталог клона инбокса внутри проекта-источника (в .gitignore). */
export const INBOX_DIR = '.vibelog/upstream-inbox';

/** Каталог отчётов в инбоксе. */
export const REPORTS_DIR = 'reports';

/** Статусы отчёта: open → accepted → done. */
export const REPORT_STATUSES = ['open', 'accepted', 'done'] as const;

/** Порядок полей фронтматтера — источник истины формата (README инбокса сверяется тестом). */
export const REPORT_FIELDS = [
  'report_id',
  'source_project',
  'source_prefix',
  'source_task',
  'title',
  'target',
  'severity',
  'area',
  'created',
  'status',
  'accepted_as',
] as const;

/** Вид ошибки git-транспорта (от него зависит код выхода CLI). */
export type UpstreamGitErrorKind = 'config' | 'usage' | 'network' | 'auth' | 'conflict' | 'git';

/**
 * Код выхода CLI по виду ошибки: 1 — ошибка использования аргументов
 * (`--as` не по формату), 2 — конфиг, 3 — сеть/git (как у GitverseError).
 *
 * `usage` отделён от `config` (VL-388): неверный формат `--as` — это ошибка
 * вызова, а не настройки проекта; AC5 требует код 1.
 */
const EXIT_CODES: Record<UpstreamGitErrorKind, number> = {
  config: 2,
  usage: 1,
  network: 3,
  auth: 3,
  conflict: 3,
  git: 3,
};

/**
 * Ошибка git-транспорта.
 *
 * `code` совпадает по смыслу с `GitverseError.code`, поэтому CLI обрабатывает
 * оба класса одинаково, не зная, какой транспорт был выбран.
 */
export class UpstreamGitError extends Error {
  /** Код выхода CLI. */
  readonly code: number;
  readonly kind: UpstreamGitErrorKind;

  constructor(message: string, kind: UpstreamGitErrorKind) {
    super(message);
    this.name = 'UpstreamGitError';
    this.kind = kind;
    this.code = EXIT_CODES[kind];
  }
}

/** Разрешённая конфигурация git-транспорта (mode: 'git'). */
export interface UpstreamGitConfig {
  mode: 'git';
  /** URL/путь репозитория-инбокса (git@… или https://…). */
  inbox: string;
  /** Префикс проекта-источника = каталог верхнего уровня в `reports/`. */
  prefix: string;
}

/**
 * Отчёт об ошибке в инбоксе.
 *
 * `title`/`body` живут в том же файле: заголовок — во фронтматтере (из него
 * строится имя файла и `report_id`), тело — markdown после `---`.
 */
export interface UpstreamReport {
  report_id: string;
  source_project: string;
  source_prefix: string;
  source_task: string;
  title: string;
  target: string;
  severity: string;
  area: string;
  created: string;
  status: string;
  accepted_as: string;
  body: string;
}

/** Вход создания отчёта: `report_id`/`status`/`accepted_as` считаются внутри. */
export interface NewReportInput {
  /** ID задачи проекта-источника (например VL-375). */
  source_task: string;
  /** Заголовок отчёта (он же — slug имени файла и слагаемое `report_id`). */
  title: string;
  /** Кому адресован отчёт (префикс получателя: ui, tpl, vl…). */
  target: string;
  body?: string;
  severity?: string;
  area?: string;
  /** Дата (YYYY-MM-DD); по умолчанию — сегодня. */
  created?: string;
}

/** Результат записи отчёта. */
export interface WriteReportResult {
  /** false — отчёт с таким `report_id` уже был (идемпотентность). */
  created: boolean;
  /** Путь относительно корня инбокса (`reports/<prefix>/<file>.md`). */
  path: string;
}

/** Итог git-вызова. */
interface GitOut {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Синхронный git без shell (аргументы — массивом, инъекция невозможна).
 *
 * `-c core.quotepath=false` — как в `core/git.ts` и `mcp/git-commit.ts`:
 * иначе не-ASCII пути приходят в octal-экранировании (VL-360).
 */
function git(cwd: string, args: string[], timeoutMs = 120_000): GitOut {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return {
    ok: !res.error && res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

/** Классифицирует текст ошибки git: вид + человеческая подсказка. */
function classifyGitError(text: string): { kind: UpstreamGitErrorKind; hint: string } {
  if (/conflict|CONFLICT|needs merge|Automatic merge failed|не удалось применить/i.test(text)) {
    return {
      kind: 'conflict',
      hint:
        'конфликт при rebase — разреши вручную в .vibelog/upstream-inbox/ ' +
        '(git status, правка конфликтных файлов, git rebase --continue) и повтори',
    };
  }
  if (
    /Authentication failed|Permission denied|could not read Username|Access denied|fatal: 403|not authorized|invalid username or password/i.test(
      text,
    )
  ) {
    return {
      kind: 'auth',
      hint: 'нет прав на инбокс: проверь SSH-ключ/токен и доступ (Write) к репозиторию upstream.inbox',
    };
  }
  if (/Please tell me who you are|empty ident name|unable to auto-detect email/i.test(text)) {
    return {
      kind: 'git',
      hint: 'в git не задан user.name/user.email — выполни git config user.name/user.email (в клоне инбокса)',
    };
  }
  return { kind: 'network', hint: 'проверь сеть и адрес upstream.inbox, затем повтори' };
}

/** Ошибка по результату git-вызова с классификацией и подсказкой. */
function gitFailure(res: GitOut, action: string): UpstreamGitError {
  const text = res.stderr || res.stdout || 'git завершился с ошибкой';
  const { kind, hint } = classifyGitError(text);
  return new UpstreamGitError(`${action}: ${text}; ${hint}`, kind);
}

/** Транслитерация кириллицы (без внешних рантаймов и зависимостей). */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Slug для имени файла: только латиница `[a-z0-9-]` (VL-360).
 *
 * Кириллица транслитерируется, всё остальное не-ASCII выпадает; несколько
 * подряд идущих разделителей склеиваются. Пустой результат → `report`
 * (иначе получили бы файл `2026-11-08-VL-1-.md`).
 */
export function slugify(text: string, maxLength = 60): string {
  let out = '';
  for (const char of (text ?? '').toLowerCase()) {
    const lower = char.toLowerCase();
    if (TRANSLIT[lower] !== undefined) {
      out += TRANSLIT[lower];
      continue;
    }
    if (/[a-z0-9]/.test(char)) {
      out += char;
      continue;
    }
    out += '-';
  }
  out = out.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > maxLength) out = out.slice(0, maxLength).replace(/-+$/, '');
  return out === '' ? 'report' : out;
}

/**
 * Детерминированный id отчёта: sha1(source_project + source_task + title).
 *
 * Дедуп: повторный `writeReport` с теми же полями не создаёт второй файл.
 */
export function reportId(input: { source_project: string; source_task: string; title: string }): string {
  return createHash('sha1')
    .update(`${input.source_project}\u0000${input.source_task}\u0000${input.title}`, 'utf8')
    .digest('hex');
}

/** Безопасный сегмент имени файла: буквы/цифры/`-`/`_`, остальное → `-`. */
function fileSegment(value: string, fallback = 'task'): string {
  const out = (value ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out === '' ? fallback : out;
}

/** Нужно ли заключать значение фронтматтера в двойные кавычки. */
function needsQuotes(value: string): boolean {
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true;
  // parseScalar из yaml.ts превращает эти литералы в boolean/null/число
  if (/^(true|false|yes|no|on|off|null|~)$/i.test(value)) return true;
  if (/^-?\d+(\.\d+)?$/.test(value)) return true;
  return /[:#\[\]{}&*!|>'"%@`,\n]/.test(value);
}

/** Значение фронтматтера: с кавычками и экранированием при необходимости. */
function yamlValue(value: string): string {
  if (!needsQuotes(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Сериализует отчёт в markdown (фронтматтер + тело).
 *
 * Чистая функция: тест-паритет с образцом `reports/vl/…-example.md` держит
 * код и README инбокса в согласии (источник истины — код).
 */
export function serializeReport(report: UpstreamReport): string {
  const lines: string[] = ['---'];
  for (const field of REPORT_FIELDS) {
    lines.push(`${field}: ${yamlValue(String(report[field] ?? ''))}`);
  }
  lines.push('---', '');
  const body = (report.body ?? '').replace(/\r\n/g, '\n').trimEnd();
  lines.push(body, '');
  return lines.join('\n');
}

/** Разбивает markdown на YAML-фронтматтер и тело. */
function splitFrontmatter(text: string): { yaml: string; body: string } {
  const normalized = (text ?? '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new UpstreamGitError('файл отчёта не содержит YAML-фронтматтера (ожидался первый строка «---»)', 'git');
  }
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    throw new UpstreamGitError('файл отчёта содержит незакрытый YAML-фронтматтер', 'git');
  }
  const yaml = normalized.slice(4, end + 1);
  // Тело без завершающих пустых строк: serializeReport сам добавляет их,
  // иначе round-trip parse↔serialize не совпадает байт-в-байт.
  const body = normalized.slice(end + 4).replace(/^\n+/, '').replace(/\s+$/, '');
  return { yaml, body };
}

/** Адресат совпадает с префиксом: токены `target` против префикса. */
export function targetMatches(target: string, prefix: string): boolean {
  const want = (prefix ?? '').trim().toLowerCase();
  if (want === '') return false;
  const value = (target ?? '').trim().toLowerCase();
  if (value === want) return true;
  // «Vibelog UI» адресуется префиксу `ui`: сравниваем токены, а не подстроки
  return value.split(/[^a-z0-9]+/).filter(Boolean).includes(want);
}

/**
 * Парсит отчёт из markdown.
 *
 * Чистая функция (без git): фронтматтер читается общим `parseYaml`, тело —
 * как есть. Обязательные поля в id не проверяются «мягко»: отчёт без
 * `report_id`/`source_task` — ошибка формата, а не пустая строка.
 */
export function parseReport(text: string): UpstreamReport {
  const { yaml, body } = splitFrontmatter(text);
  const data = parseYaml(yaml);
  const str = (key: string): string => {
    const value = data[key];
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
  };
  const report: UpstreamReport = {
    report_id: str('report_id'),
    source_project: str('source_project'),
    source_prefix: str('source_prefix'),
    source_task: str('source_task'),
    title: str('title'),
    target: str('target'),
    severity: str('severity'),
    area: str('area'),
    created: str('created'),
    status: str('status') || 'open',
    accepted_as: str('accepted_as'),
    body,
  };
  if (report.report_id === '') {
    throw new UpstreamGitError('отчёт без поля report_id — файл не из инбокса или повреждён', 'git');
  }
  return report;
}

/** Путь клона инбокса внутри проекта-источника. */
export function inboxPath(cwd: string): string {
  return join(cwd, INBOX_DIR);
}

/** Префикс проекта-источника по умолчанию (task_prefix из backlog/config.yml). */
function defaultPrefix(cwd: string): string {
  try {
    const prefix = loadConfig(cwd).task_prefix;
    if (typeof prefix === 'string' && prefix.trim() !== '') return prefix.trim().toLowerCase();
  } catch {
    // нет backlog/config.yml — дефолт
  }
  return 'vl';
}

/** Имя проекта-источника (project_name из backlog/config.yml). */
export function sourceProjectName(cwd: string, fallbackPrefix?: string): string {
  try {
    const name = loadConfig(cwd).project_name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  } catch {
    // нет конфига — падаем на префикс
  }
  return fallbackPrefix ?? defaultPrefix(cwd);
}

/**
 * Разрешает и валидирует конфигурацию git-транспорта.
 *
 * @throws UpstreamGitError kind:'config' — нет `inbox` (обязательное поле)
 */
export function resolveGitUpstreamConfig(cwd: string, raw: Record<string, unknown>): UpstreamGitConfig {
  const inbox = typeof raw.inbox === 'string' ? raw.inbox.trim() : '';
  if (inbox === '') {
    throw new UpstreamGitError(
      'поле upstream.inbox обязательно для mode: "git" — укажи URL репозитория-инбокса, ' +
        'например "git@gitverse.ru:Vibelog-md/upstream-reports.git"',
      'config',
    );
  }
  const prefixRaw = typeof raw.prefix === 'string' ? raw.prefix.trim().toLowerCase() : '';
  if (raw.prefix !== undefined && prefixRaw === '') {
    throw new UpstreamGitError('поле upstream.prefix: ожидалась непустая строка', 'config');
  }
  return { mode: 'git', inbox, prefix: prefixRaw === '' ? defaultPrefix(cwd) : prefixRaw };
}

/**
 * Клон инбокса (при отсутствии) или `pull --rebase` (при наличии).
 *
 * Ошибки сети/прав/конфликта → `UpstreamGitError` с `kind`, чтобы CLI отдал
 * правильный код выхода и понятную подсказку.
 */
export function ensureInboxClone(cwd: string, cfg: UpstreamGitConfig): { path: string; created: boolean } {
  const dir = inboxPath(cwd);
  if (existsSync(join(dir, '.git'))) {
    const res = git(dir, ['pull', '--rebase', '--quiet']);
    if (!res.ok) throw gitFailure(res, 'не удалось обновить клон инбокса (git pull --rebase)');
    return { path: dir, created: false };
  }
  mkdirSync(dirname(dir), { recursive: true });
  const res = git(cwd, ['clone', '--quiet', cfg.inbox, dir]);
  if (!res.ok) throw gitFailure(res, `не удалось клонировать инбокс «${cfg.inbox}»`);
  return { path: dir, created: true };
}

/** Минимальная длина префикса `report_id` (git-стиль): короче — слишком много ложных совпадений. */
export const MIN_REPORT_ID_PREFIX = 4;

/**
 * Находит путь файла отчёта по `report_id` или его префиксу.
 *
 * Принимает полный sha1 ИЛИ уникальный префикс (>= `MIN_REPORT_ID_PREFIX`
 * символов, регистр hex не важен): `pull` печатает первые 8 символов и
 * предлагает скопировать их в `ack` — значит `ack` обязан их принимать.
 *
 * Неоднозначный префикс — ошибка со списком кандидатов, а не «не найден» и не
 * молчаливый выбор первого совпадения: иначе `ack` подтвердил бы не тот отчёт.
 *
 * `exact: true` — только точное сравнение (режим `writeReport`: идемпотентность
 * не должна склеивать разные отчёты с общим префиксом id).
 *
 * @throws UpstreamGitError kind:'config' — префикс короче минимума или неоднозначен
 */
function findReportById(
  cwd: string,
  id: string,
  opts: { exact?: boolean } = {},
): string | undefined {
  const needle = id.trim().toLowerCase();
  if (needle === '') return undefined;
  if (opts.exact !== true && needle.length < MIN_REPORT_ID_PREFIX) {
    throw new UpstreamGitError(
      `report_id «${id.trim()}» слишком короткий: нужно не меньше ${MIN_REPORT_ID_PREFIX} символов ` +
        '(полный id или префикс из «vibelog upstream pull»)',
      'config',
    );
  }
  const root = join(inboxPath(cwd), REPORTS_DIR);
  if (!existsSync(root)) return undefined;
  const matches: Array<{ rel: string; report: UpstreamReport }> = [];
  for (const prefix of readdirSync(root, { withFileTypes: true })) {
    if (!prefix.isDirectory()) continue;
    const dir = join(root, prefix.name);
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const rel = `${REPORTS_DIR}/${prefix.name}/${file.name}`;
      try {
        const parsed = parseReport(readFileSync(join(dir, file.name), 'utf-8'));
        const actual = parsed.report_id.toLowerCase();
        if (opts.exact === true ? actual === needle : actual.startsWith(needle)) {
          matches.push({ rel, report: parsed });
        }
      } catch {
        // битый файл не должен ломать поиск по id
      }
    }
  }
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].rel;
  // >1 совпадение возможно только для префикса: полный sha1 уникален по построению
  throw new UpstreamGitError(
    `report_id «${id.trim()}» совпал с ${matches.length} отчётами — уточни id: ` +
      matches.map((m) => `${m.report.report_id} (${m.report.source_task})`).join(', '),
    'config',
  );
}

/** Путь отчёта в инбоксе: `reports/<prefix>/<дата>-<source_task>-<slug>.md`. */
export function reportRelPath(report: UpstreamReport): string {
  const prefix = fileSegment(report.source_prefix.toLowerCase(), 'misc').toLowerCase();
  const file = `${report.created}-${fileSegment(report.source_task, 'task')}-${slugify(report.title)}.md`;
  return `${REPORTS_DIR}/${prefix}/${file}`;
}

/** Сегодняшняя дата в формате YYYY-MM-DD (локальная, без UTC-сдвига). */
export function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Проверка пути перед `git add`: никаких масок, флагов и переходов вверх. */
function assertExplicitPath(rel: string): void {
  if (rel.trim() === '' || rel.startsWith('-') || /[*?[\]]/.test(rel) || rel.split('/').includes('..')) {
    throw new UpstreamGitError(`путь отчёта «${rel}» недопустим: git add только явным путём файла`, 'git');
  }
}

/** Коммит и push одного файла отчёта (только явный путь). */
function commitAndPush(cwd: string, rel: string, message: string): void {
  assertExplicitPath(rel);
  const dir = inboxPath(cwd);
  const add = git(dir, ['add', '--', rel]);
  if (!add.ok) throw gitFailure(add, `не удалось добавить в git «${rel}»`);
  // `-- <path>` ограничивает коммит ровно этим файлом даже при чужом индексе
  const commit = git(dir, ['commit', '--quiet', '-m', message, '--', rel]);
  if (!commit.ok) throw gitFailure(commit, `не удалось закоммитить «${rel}»`);
  const push = git(dir, ['push', '--quiet']);
  if (!push.ok) throw gitFailure(push, 'не удалось отправить отчёт в инбокс (git push)');
}

/**
 * Записывает отчёт в инбокс: файл + `git add` только этого файла + commit + push.
 *
 * Идемпотентность по `report_id`: если отчёт с теми же source_project/
 * source_task/title уже есть — ничего не пишется, возвращается его путь.
 */
export function writeReport(cwd: string, cfg: UpstreamGitConfig, input: NewReportInput): WriteReportResult {
  const source_project = sourceProjectName(cwd, cfg.prefix);
  const report: UpstreamReport = {
    report_id: reportId({ source_project, source_task: input.source_task, title: input.title }),
    source_project,
    source_prefix: cfg.prefix,
    source_task: input.source_task,
    title: input.title,
    target: input.target,
    severity: input.severity ?? '',
    area: input.area ?? '',
    created: input.created ?? today(),
    status: 'open',
    accepted_as: '',
    body: input.body ?? '',
  };
  if (report.target.trim() === '') {
    throw new UpstreamGitError('поле target обязательно: укажи получателя отчёта (префикс проекта)', 'config');
  }

  ensureInboxClone(cwd, cfg);
  // Только точное сравнение: префиксный поиск склеил бы разные отчёты с общим
  // началом id и превратил бы идемпотентность в ложное «уже есть».
  const existing = findReportById(cwd, report.report_id, { exact: true });
  if (existing !== undefined) return { created: false, path: existing };

  const rel = reportRelPath(report);
  const abs = join(inboxPath(cwd), rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, serializeReport(report), 'utf-8');
  commitAndPush(cwd, rel, `report(${report.source_prefix}): ${report.source_task} — ${report.title}`);
  return { created: true, path: rel };
}

/**
 * Входящие отчёты для своего префикса: `target` совпадает и `status: open`.
 *
 * Чтение идёт из уже склонированного инбокса (обновление — `ensureInboxClone`),
 * сортировка по `created` (старые первыми).
 */
export function listIncoming(cwd: string, targetPrefix: string): UpstreamReport[] {
  const root = join(inboxPath(cwd), REPORTS_DIR);
  if (!existsSync(root)) {
    throw new UpstreamGitError(
      `клон инбокса не найден (${INBOX_DIR}) — выполни «vibelog upstream pull»`,
      'config',
    );
  }
  const out: UpstreamReport[] = [];
  for (const prefix of readdirSync(root, { withFileTypes: true })) {
    if (!prefix.isDirectory()) continue;
    const dir = join(root, prefix.name);
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      let report: UpstreamReport;
      try {
        report = parseReport(readFileSync(join(dir, file.name), 'utf-8'));
      } catch {
        continue; // битый файл пропускаем: один отчёт не должен ломать список
      }
      if (report.status !== 'open') continue;
      if (!targetMatches(report.target, targetPrefix)) continue;
      out.push(report);
    }
  }
  out.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  return out;
}

/** Формат ID задачи получателя: `<PREFIX>-<число>`, регистр префикса не важен. */
const ACCEPTED_AS_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;

/**
 * Валидирует и нормализует `--as`: префикс → верхний регистр, номер как есть.
 *
 * Существование задачи НЕ проверяется и не может проверяться: CLI работает в
 * дочернем проекте и не имеет доступа к backlog получателя — это осознанное
 * архитектурное ограничение (VL-388). Проверяется только формат, чтобы опечатка
 * (`VL_388`, `VL388`, `vl 388`) не попала молча в `accepted_as` отчёта.
 *
 * @throws UpstreamGitError kind:'usage' — пустое значение или формат не `<PREFIX>-<число>`
 */
export function normalizeAcceptedAs(value: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw new UpstreamGitError(
      'не указан --as: укажи ID задачи получателя, например --as VL-367',
      'usage',
    );
  }
  if (!ACCEPTED_AS_RE.test(trimmed)) {
    throw new UpstreamGitError(
      `--as «${trimmed}»: ожидался ID задачи вида <PREFIX>-<номер>, например VL-367`,
      'usage',
    );
  }
  const [prefix, num] = trimmed.split('-');
  return `${prefix.toUpperCase()}-${num}`;
}

/**
 * Подтверждает получение отчёта: правит ТОЛЬКО `status` и `accepted_as`.
 *
 * Правка построчная — остальной файл (включая порядок и форматирование
 * полей) остаётся байт-в-байт, чтобы CI-проверка «в чужих файлах меняются
 * только ack-поля» проходила.
 *
 * @throws UpstreamGitError kind:'usage' — неверный формат `--as`
 * @throws UpstreamGitError kind:'config' — отчёт не найден
 */
export function ackReport(
  cwd: string,
  id: string,
  acceptedAs: string,
): { path: string; report: UpstreamReport } {
  if (id.trim() === '') {
    throw new UpstreamGitError('не указан report_id — передай id отчёта из «vibelog upstream pull»', 'config');
  }
  const normalized = normalizeAcceptedAs(acceptedAs);
  const rel = findReportById(cwd, id.trim());
  if (rel === undefined) {
    throw new UpstreamGitError(`отчёт с report_id «${id.trim()}» не найден в инбоксе`, 'config');
  }
  const abs = join(inboxPath(cwd), rel);
  const text = readFileSync(abs, 'utf-8');
  const updated = replaceAckFields(text, normalized);
  const report = parseReport(updated);
  writeFileSync(abs, updated, 'utf-8');
  commitAndPush(cwd, rel, `ack(${report.source_prefix}): ${report.report_id} → ${normalized}`);
  return { path: rel, report };
}

/**
 * Заменяет во фронтматтере ровно две строки: `status` и `accepted_as`.
 *
 * Чистая функция: тестируется без git. Обе строки обязаны существовать —
 * «дописать от себя» нельзя, иначе CI увидит изменение чужого файла за
 * пределами ack-полей.
 */
export function replaceAckFields(text: string, acceptedAs: string): string {
  const normalized = (text ?? '').replace(/\r\n/g, '\n');
  const { yaml } = splitFrontmatter(normalized);
  const lines = normalized.split('\n');
  // Первая строка фронтматтера — `---`, дальше ровно столько строк, сколько в yaml
  const yamlLineCount = yaml.split('\n').length;
  let statusDone = false;
  let ackDone = false;
  for (let i = 1; i <= yamlLineCount && i < lines.length; i += 1) {
    if (/^status:/.test(lines[i])) {
      lines[i] = 'status: accepted';
      statusDone = true;
    } else if (/^accepted_as:/.test(lines[i])) {
      lines[i] = `accepted_as: ${yamlValue(acceptedAs)}`;
      ackDone = true;
    }
  }
  if (!statusDone || !ackDone) {
    throw new UpstreamGitError(
      'во фронтматтере отчёта нет полей status/accepted_as — файл не по схеме инбокса',
      'git',
    );
  }
  return lines.join('\n');
}
