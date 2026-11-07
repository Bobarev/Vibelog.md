/**
 * Команда `vibelog doctor` — диагностика окружения.
 *
 * Проверяет: Node.js, PATH, симлинки, MCP-инструменты, backlog/,
 * конфиг, задачи, round-trip с Backlog.md.
 *
 * Отличие от оригинала Backlog.md: их doctor — про дубликаты ID,
 * наш — про окружение. Разные цели.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

import { listTools } from '../../mcp/tools.js';
import { findBacklogDir } from '../../core/paths.js';
import { loadConfig } from '../../core/config.js';
import { listTasks } from '../../core/store.js';
import { markdownToTask } from '../../core/task.js';
import { checkTaskIntegrity } from '../../core/integrity.js';
import type { FlagValues } from '../args.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Является ли stdout TTY (для цветов) */
const isTTY = process.stdout.isTTY;

/** Результат одной проверки doctor. */
interface CheckResult {
  name: string;
  ok: boolean;
  value: unknown;
  expected?: unknown;
  hint?: string;
}

/**
 * Оборачивает текст в ANSI-цвет, если TTY.
 */
function colorize(text: string, color: 'green' | 'yellow' | 'red' | 'dim'): string {
  if (!isTTY) return text;
  const codes: Record<string, string> = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m' };
  return `${codes[color] || ''}${text}\x1b[0m`;
}

/**
 * Выполняет команду doctor.
 */
export async function runDoctor(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const checks: CheckResult[] = [];
  const warnings: string[] = [];

  // 1. Node.js
  checks.push(checkNode());

  // 2. PATH
  checks.push(checkPath());

  // 3. Симлинк
  checks.push(checkSymlink());

  // 4. Совпадение копий
  checks.push(checkSourcesMatch());

  // 5. Инварианты реестра MCP-инструментов (VL-340)
  checks.push(checkMcpToolsInvariants());

  // 6. backlog/
  checks.push(checkBacklogDir(cwd));

  // 7. Конфиг
  checks.push(checkConfig(cwd));

  // 8. Задачи
  checks.push(checkTasks(cwd));

  // 9. Round-trip с Backlog.md
  checks.push(checkRoundtrip());

  // 10. Git-политика `.vibelog/` (VL-340, ROADMAP «Переносимый .vibelog/»)
  checks.push(...checkGitPolicy(cwd));

  // 10.5. Незакоммиченные billing/settings (VL-352): billing уходит в коммит
  // файла задачи только в фазе close — задача, не дошедшая до close, оставляет
  // его грязным; settings.json правится вручную по определению.
  checks.push(...checkVibelogDirty(cwd));

  // 11. Целостность ссылок задач (VL-342): не блокирующая проверка —
  // битые ссылки в легаси-задачах не должны делать doctor красным.
  checks.push(checkTaskIntegrityReport(cwd));

  // 12. Корневой `.gitignore` при существующем `.env` (VL-348): без него
  // секреты уезжают в git первым же `git add -A`.
  checks.push(checkRootGitignore(cwd));

  // Предупреждение про кэш MCP
  warnings.push('Qwen Code: MCP-сервер мог быть закэширован. Если Qwen не видит новые инструменты — перезапусти Qwen.');

  // Обязательные проверки (влияют на exit code).
  // vibelog_gitignore обязательна только при существующем `.vibelog/` — сама
  // проверка возвращает ok:true, если каталога нет (VL-340).
  const requiredNames = ['node', 'path', 'mcp_tools_invariants', 'backlog_dir', 'vibelog_gitignore'];
  const hasErrors = checks.some(c => requiredNames.includes(c.name) && !c.ok);

  if (flags.json) {
    const result = {
      ok: !hasErrors,
      checks: checks.map(c => ({ name: c.name, ok: c.ok, value: c.value, expected: c.expected, hint: c.hint })),
      warnings,
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(checks, warnings);
  }

  if (hasErrors) process.exitCode = 1;
}

/**
 * Проверка 1: версия Node.js >= 20.
 */
function checkNode(): CheckResult {
  const major = parseInt(process.version.replace('v', '').split('.')[0], 10);
  const ok = major >= 20;
  return {
    name: 'node',
    ok,
    value: process.version,
    expected: '>=20',
    hint: ok ? undefined : `Установите Node.js 20+. Текущая: ${process.version}`,
  };
}

/**
 * Проверка 2: vibelog резолвится в PATH.
 */
function checkPath(): CheckResult {
  try {
    const out = execSync('which vibelog 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim();
    return {
      name: 'path',
      ok: !!out,
      value: out,
      hint: out ? undefined : 'Выполните: pnpm link --global',
    };
  } catch {
    return {
      name: 'path',
      ok: false,
      value: null,
      hint: 'Выполните: pnpm link --global',
    };
  }
}

/**
 * Проверка 3: симлинк ведёт на реальный bin/vibelog.mjs.
 */
function checkSymlink(): CheckResult {
  try {
    const out = execSync('which vibelog 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim();
    if (!out) return { name: 'symlink', ok: false, value: null, hint: 'vibelog не найден в PATH' };

    const expected = join(__dirname, '..', '..', '..', 'bin', 'vibelog.mjs');

    // Проверяем, симлинк это или shell-скрипт pnpm
    const real = realpathSync(out);

    // Если это симлинк — сравниваем напрямую
    if (real === expected) {
      return { name: 'symlink', ok: true, value: real, expected };
    }

    // Если это shell-скрипт (pnpm shim) — ищем путь к bin/vibelog.mjs внутри
    try {
      const content = readFileSync(out, 'utf-8');
      if (content.includes('vibelog.mjs') && content.includes(expected.split('/').slice(-3).join('/'))) {
        return { name: 'symlink', ok: true, value: `${out} (pnpm shim → ${expected})`, expected };
      }
      // pnpm shim может ссылаться на node_modules/.bin или pkg dir
      const pkgDir = join(__dirname, '..', '..', '..');
      if (content.includes(pkgDir) || content.includes('vibelog.md')) {
        return { name: 'symlink', ok: true, value: `${out} (pnpm shim)`, expected };
      }
    } catch { /* не shell-скрипт */ }

    return {
      name: 'symlink',
      ok: false,
      value: real,
      expected,
      hint: 'Симлинк ведёт на другую копию. Выполните: pnpm link --global',
    };
  } catch {
    return { name: 'symlink', ok: false, value: null, hint: 'Не удалось проверить симлинк' };
  }
}

/**
 * Определяет реальный путь к bin/vibelog.mjs, учитывая симлинки и pnpm shims.
 *
 * @param binPath — путь из PATH (симлинк или shell-скрипт)
 */
function resolveBinTarget(binPath: string): string {
  const expected = join(__dirname, '..', '..', '..', 'bin', 'vibelog.mjs');

  // Симлинк — realpath резолвит напрямую
  const real = realpathSync(binPath);
  if (real === expected) return real;

  // pnpm shim (shell-скрипт) — ищем путь к целевому файлу внутри
  try {
    const content = readFileSync(binPath, 'utf-8');
    // pnpm shim содержит exec node "$basedir/..." или подобное
    const match = content.match(/exec\s+node\s+["']?\$basedir\/([^"'\s]+)/);
    if (match) {
      const target = join(dirname(binPath), match[1]);
      return realpathSync(target);
    }
    // Fallback: если shim ссылается на известный путь
    if (content.includes('vibelog.mjs')) return expected;
  } catch { /* не shell-скрипт */ }

  return real;
}

/**
 * Проверка 4: PATH и process.argv[1] — одна копия.
 */
function checkSourcesMatch(): CheckResult {
  try {
    const srcPath = realpathSync(process.argv[1]);
    let binPath: string | null = null;
    try {
      const out = execSync('which vibelog 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim();
      if (out) {
        binPath = resolveBinTarget(out);
      }
    } catch { /* PATH не найден */ }

    const ok = binPath === null || binPath === srcPath;
    return {
      name: 'sources_match',
      ok,
      value: { src: srcPath, path: binPath },
      hint: ok ? undefined : 'Запущена не та копия, что в PATH. Перезапустите pnpm link --global',
    };
  } catch {
    return { name: 'sources_match', ok: true, value: null };
  }
}

/**
 * Известные префиксы имён MCP-инструментов Vibelog.
 *
 * Список — политика именования, а не перечень инструментов: новый инструмент
 * с известным префиксом не требует правки doctor (VL-340). Инструмент с чужим
 * префиксом — сигнал, что в реестр попал сторонний/опечатанный инструмент.
 */
const MCP_TOOL_PREFIXES = [
  'backlog_',
  'milestone_',
  'reference_',
  'document_',
  'lesson_',
  'project_map',
  'git_commit',
];

/**
 * Проверка 5: инварианты реестра MCP-инструментов (VL-340).
 *
 * Вместо хардкода числа инструментов (36→37→…→45 в CHANGELOG) проверяются
 * свойства, которые действительно ломают MCP-клиент: пустой реестр, дубли
 * имён (клиент не различит инструменты), имя вне политики префиксов и
 * инструмент без inputSchema типа object (агент не сможет его вызвать).
 *
 * Экспортируется для юнит-тестов: тест подаёт синтетический реестр и
 * проверяет, что инварианты ловят дефект.
 *
 * @param tools — реестр инструментов (по умолчанию listTools())
 */
export function checkMcpToolsInvariants(
  tools: Array<{ name: string; inputSchema?: unknown }> = listTools()
): CheckResult {
  const names = tools.map(t => t.name);
  const problems: string[] = [];

  if (tools.length === 0) {
    problems.push('реестр пуст');
  }

  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    problems.push(`дубли имён: ${[...new Set(dupes)].join(', ')}`);
  }

  const badPrefix = names.filter(n => !MCP_TOOL_PREFIXES.some(p => n === p || n.startsWith(p)));
  if (badPrefix.length > 0) {
    problems.push(`имена вне политики префиксов: ${badPrefix.join(', ')}`);
  }

  const badSchema = tools
    .filter(t => {
      const s = t.inputSchema as Record<string, unknown> | undefined;
      return !s || typeof s !== 'object' || s.type !== 'object';
    })
    .map(t => t.name);
  if (badSchema.length > 0) {
    problems.push(`нет inputSchema типа object: ${badSchema.join(', ')}`);
  }

  const ok = problems.length === 0;
  return {
    name: 'mcp_tools_invariants',
    ok,
    value: { count: tools.length, problems },
    expected: { prefixes: MCP_TOOL_PREFIXES },
    hint: ok ? undefined : `Нарушены инварианты реестра MCP: ${problems.join('; ')}`,
  };
}

/**
 * Проверка 6: backlog/ найден.
 */
function checkBacklogDir(cwd: string): CheckResult {
  const dir = findBacklogDir(cwd);
  const ok = !!dir;
  return {
    name: 'backlog_dir',
    ok,
    value: dir || null,
    hint: ok ? undefined : 'Backlog не найден. Выполните: vibelog init',
  };
}

/**
 * Проверка 7: конфиг читается.
 */
function checkConfig(cwd: string): CheckResult {
  try {
    const config = loadConfig(cwd);
    return {
      name: 'config',
      ok: true,
      value: { project_name: config.project_name, task_prefix: config.task_prefix },
    };
  } catch (err) {
    return {
      name: 'config',
      ok: false,
      value: null,
      hint: (err as Error).message,
    };
  }
}

/**
 * Проверка 8: задачи парсятся.
 */
function checkTasks(cwd: string): CheckResult {
  try {
    const tasks = listTasks(cwd);
    return {
      name: 'tasks_count',
      ok: true,
      value: tasks.length,
    };
  } catch (err) {
    return {
      name: 'tasks_count',
      ok: false,
      value: null,
      hint: (err as Error).message,
    };
  }
}

/**
 * Проверка 9: round-trip с Backlog.md (опциональная).
 */
function checkRoundtrip(): CheckResult {
  const backlogRoot = join(__dirname, '..', '..', '..', '..', 'Backlog.md');
  const tasksDirPath = join(backlogRoot, 'backlog', 'tasks');

  if (!existsSync(tasksDirPath)) {
    return { name: 'roundtrip', ok: true, value: null, hint: undefined };
  }

  try {
    const files = readdirSync(tasksDirPath).filter(f => f.endsWith('.md') && f !== 'readme.md').slice(0, 5);
    let parsed = 0;
    for (const file of files) {
      const content = readFileSync(join(tasksDirPath, file), 'utf-8');
      const task = markdownToTask(content);
      if (task.id) parsed++;
    }
    return { name: 'roundtrip', ok: true, value: parsed };
  } catch {
    return { name: 'roundtrip', ok: true, value: null };
  }
}

/**
 * Спрашивает у git, игнорируется ли путь (VL-340).
 *
 * Только `git check-ignore` — никакого парсинга `.gitignore` регулярками:
 * правила git (вложенные файлы, `!`-исключения, `**`) регуляркой не
 * воспроизвести, а ошибка здесь означает утечку сессий или ключей в git.
 *
 * @param cwd — каталог проекта
 * @param path — путь относительно cwd
 * @returns ignored: true/false, либо null — «git не дал ответа»
 *          (не репозиторий, git недоступен, код 128)
 */
function gitCheckIgnore(cwd: string, path: string): boolean | null {
  const res = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd, encoding: 'utf-8' });
  if (res.error || res.status === null) return null;
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  // 128 — не git-репозиторий (или иная ошибка git): проверку не валим
  return null;
}

/**
 * Проверяет, находится ли каталог внутри git-репозитория (VL-340).
 *
 * Нужна, чтобы git-политика `.vibelog/` не давала ложных провалов вне git:
 * там понятия «игнорируется» нет, и требовать файл политики бессмысленно.
 *
 * @param cwd — каталог проекта
 */
function isGitRepo(cwd: string): boolean {
  const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf-8' });
  return !res.error && res.status === 0 && String(res.stdout).trim() === 'true';
}

/**
 * Проверки 10–14: git-политика `.vibelog/` (VL-340, ROADMAP «Переносимый .vibelog/»).
 *
 * Регресс политики VL-329 (вернуть `.vibelog/` в корневой `.gitignore`,
 * уронить `!settings.json`) иначе обнаруживается только когда в git уже
 * уехали транскрипты сессий или ключи. Все проверки, кроме отсутствия
 * `.vibelog/.gitignore` при существующем `.vibelog/` в git-репозитории, —
 * предупреждающие.
 *
 * @param cwd — каталог проекта
 */
function checkGitPolicy(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const vibelogDir = join(cwd, '.vibelog');
  const hasVibelog = existsSync(vibelogDir);
  const inGit = isGitRepo(cwd);

  // 1. Файл политики существует (единственная обязательная из этой группы).
  // Вне git политика не имеет смысла — проверка проходит.
  const gitignorePath = join(vibelogDir, '.gitignore');
  const hasGitignore = existsSync(gitignorePath);
  const gitignoreOk = !hasVibelog || hasGitignore || !inGit;
  results.push({
    name: 'vibelog_gitignore',
    ok: gitignoreOk,
    value: !hasVibelog
      ? 'нет .vibelog/'
      : hasGitignore
        ? gitignorePath
        : inGit
          ? null
          : 'не git-репозиторий',
    expected: '.vibelog/.gitignore',
    hint: gitignoreOk
      ? undefined
      : 'Нет .vibelog/.gitignore: локальные сессии и кэши могут уехать в git. Создайте файл политики (VL-329).',
  });

  // 2–5. Проверки через git check-ignore; вне git-репозитория — ok:true
  const policyChecks: Array<{ name: string; path: string; shouldIgnore: boolean; hint: string }> = [
    {
      name: 'vibelog_settings_tracked',
      path: '.vibelog/settings.json',
      shouldIgnore: false,
      hint: 'settings.json игнорируется — конфигурация проекта должна жить в git (VL-329).',
    },
    {
      name: 'vibelog_billing_tracked',
      path: '.vibelog/billing/',
      shouldIgnore: false,
      hint: 'billing/ игнорируется — история трат должна жить в git (VL-329).',
    },
    {
      name: 'env_ignored',
      path: '.env',
      shouldIgnore: true,
      hint: '.env НЕ игнорируется — токены и API-ключи могут уехать в git (VL-329).',
    },
    {
      name: 'vibelog_root_ignored',
      path: '.vibelog/',
      shouldIgnore: false,
      hint: '.vibelog/ игнорируется корневым .gitignore — регресс VL-329: конфигурация и промпты не попадут в git.',
    },
  ];

  for (const spec of policyChecks) {
    const ignored = gitCheckIgnore(cwd, spec.path);
    if (ignored === null) {
      results.push({ name: spec.name, ok: true, value: 'не git-репозиторий' });
      continue;
    }
    const ok = ignored === spec.shouldIgnore;
    results.push({
      name: spec.name,
      ok,
      value: ignored ? 'игнорируется' : 'в git',
      expected: spec.shouldIgnore ? 'игнорируется' : 'в git',
      hint: ok ? undefined : spec.hint,
    });
  }

  return results;
}

/**
 * Проверки 15–16: незакоммиченные `.vibelog/billing/` и `.vibelog/settings.json`
 * (VL-352).
 *
 * Billing коммитится вместе с файлом задачи, но только в фазе close: задача,
 * не дошедшая до close (отменена, брошена), оставляет файл грязным навсегда —
 * без напоминания это возвращает исходную жалобу «рабочее дерево вечно
 * грязное». settings.json правится вручную (тарифы/модели — осознанное
 * действие), поэтому doctor только предупреждает.
 *
 * Обе проверки предупреждающие (в `requiredNames` не входят) и вне
 * git-репозитория дают `ok: true` — как остальные проверки git-политики.
 *
 * @param cwd — каталог проекта
 */
function checkVibelogDirty(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  if (!isGitRepo(cwd)) {
    return [
      { name: 'vibelog_billing_clean', ok: true, value: 'не git-репозиторий' },
      { name: 'vibelog_settings_clean', ok: true, value: 'не git-репозиторий' },
    ];
  }

  // 1. billing: грязный каталог = задача не дошла до close
  const billingDirty = gitStatusPorcelain(cwd, '.vibelog/billing/');
  if (billingDirty === null) {
    results.push({ name: 'vibelog_billing_clean', ok: true, value: 'git не дал ответа' });
  } else {
    const files = billingDirty
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    const ok = files.length === 0;
    results.push({
      name: 'vibelog_billing_clean',
      ok,
      value: ok ? 'чисто' : files.slice(0, 5),
      expected: 'чисто',
      hint: ok
        ? undefined
        : 'Billing не закоммичен: задача не дошла до close — billing закоммитится вместе с файлом задачи. ' +
          'Закоммитить сейчас: git add .vibelog/billing && git commit -m "chore(billing): …"',
    });
  }

  // 2. settings.json: правки тарифов/моделей коммитятся вручную
  const settingsDirty = gitStatusPorcelain(cwd, '.vibelog/settings.json');
  if (settingsDirty === null) {
    results.push({ name: 'vibelog_settings_clean', ok: true, value: 'git не дал ответа' });
  } else {
    const ok = settingsDirty === '';
    results.push({
      name: 'vibelog_settings_clean',
      ok,
      value: ok ? 'чисто' : 'изменён',
      expected: 'чисто',
      hint: ok
        ? undefined
        : 'settings.json изменён — правки тарифов/моделей коммитятся вручную (git add .vibelog/settings.json).',
    });
  }

  return results;
}

/**
 * `git status --porcelain` по явному пути (VL-352).
 *
 * @returns вывод git (пустая строка — чисто) либо null, если git не ответил
 *          (не репозиторий, git недоступен)
 */
function gitStatusPorcelain(cwd: string, path: string): string | null {
  const res = spawnSync('git', ['status', '--porcelain', '--', path], { cwd, encoding: 'utf-8' });
  if (res.error || res.status !== 0) return null;
  return String(res.stdout ?? '').trim();
}

/**
 * Проверка 12: корневой `.gitignore` существует при существующем `.env` (VL-348).
 *
 * Смысл: `.env` с токенами и API-ключами не должен попадать в git. Проверка
 * срабатывает только когда `.env` реально есть — в проекте без секретов
 * отсутствие `.gitignore` не проблема. Подсказка перечисляет минимальный
 * набор правил из `ROOT_GITIGNORE_TEMPLATE` (один источник правды с init).
 *
 * @param cwd — каталог проекта
 */
function checkRootGitignore(cwd: string): CheckResult {
  const hasEnv = existsSync(join(cwd, '.env'));
  const hasGitignore = existsSync(join(cwd, '.gitignore'));
  const ok = !hasEnv || hasGitignore;
  return {
    name: 'root_gitignore_exists',
    ok,
    value: hasGitignore ? join(cwd, '.gitignore') : null,
    expected: '.gitignore',
    hint: ok
      ? undefined
      : 'Нет корневого .gitignore при существующем .env: секреты могут уехать в git. Запустите vibelog init (создаст правила) или добавьте вручную: .env, node_modules/, dist/',
  };
}

/**
 * Проверка 11: целостность ссылок задач (VL-342).
 *
 * `ok = findings.length === 0`, но в `requiredNames` проверка НЕ входит:
 * битые ссылки — не поломка окружения, иначе doctor красный на легаси-ссылках.
 * В `--json` отдаём только первые 20 находок — на 300 задачах вывод не должен
 * раздуваться; подробности — `vibelog task check`.
 */
function checkTaskIntegrityReport(cwd: string): CheckResult {
  try {
    const report = checkTaskIntegrity(cwd);
    const ok = report.findings.length === 0;
    return {
      name: 'task_integrity',
      ok,
      value: {
        total: report.total,
        count: report.findings.length,
        findings: report.findings.slice(0, 20),
      },
      hint: ok ? undefined : 'Запустите `vibelog task check` для подробностей',
    };
  } catch (err) {
    return {
      name: 'task_integrity',
      ok: false,
      value: null,
      hint: (err as Error).message,
    };
  }
}

/**
 * Печатает результаты в человекочитаемом виде.
 */
function printHuman(checks: CheckResult[], warnings: string[]): void {
  console.log('\nVibelog.md doctor');
  console.log('────────────────\n');

  for (const check of checks) {
    const icon = check.ok ? colorize('✓', 'green') : colorize('✗', 'red');
    let line = `${icon} ${check.name}: `;

    if (check.ok) {
      if (typeof check.value === 'object' && check.value !== null) {
        line += JSON.stringify(check.value);
      } else if (check.value !== null && check.value !== undefined) {
        line += String(check.value);
      } else {
        line += 'ok';
      }
    } else {
      line += String(check.value ?? 'ошибка');
      if (check.hint) {
        console.log(line);
        console.log(`  ${colorize(check.hint, 'yellow')}`);
        continue;
      }
    }
    console.log(line);
  }

  if (warnings.length > 0) {
    console.log('');
    for (const w of warnings) {
      console.log(`${colorize('⚠', 'yellow')} ${w}`);
    }
  }
  console.log('');
}
