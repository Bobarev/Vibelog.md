/**
 * Команда `vibelog doctor` — диагностика окружения.
 *
 * Проверяет: Node.js, PATH, симлинки, MCP-инструменты, backlog/,
 * конфиг, задачи, round-trip с Backlog.md.
 *
 * Отличие от оригинала Backlog.md: их doctor — про дубликаты ID,
 * наш — про окружение. Разные цели.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { listTools } from '../../mcp/tools.mjs';
import { findBacklogDir, tasksDir, configPath } from '../../core/paths.mjs';
import { loadConfig } from '../../core/config.mjs';
import { listTasks } from '../../core/store.mjs';
import { markdownToTask, taskToMarkdown } from '../../core/task.mjs';
import { parseYaml } from '../../core/yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Является ли stdout TTY (для цветов) */
const isTTY = process.stdout.isTTY;

/**
 * Оборачивает текст в ANSI-цвет, если TTY.
 *
 * @param {string} text
 * @param {string} color
 * @returns {string}
 */
function colorize(text, color) {
  if (!isTTY) return text;
  const codes = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m' };
  return `${codes[color] || ''}${text}\x1b[0m`;
}

/**
 * Выполняет команду doctor.
 *
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runDoctor(positional, flags, cwd) {
  const checks = [];
  const warnings = [];

  // 1. Node.js
  checks.push(checkNode());

  // 2. PATH
  checks.push(checkPath());

  // 3. Симлинк
  checks.push(checkSymlink());

  // 4. Совпадение копий
  checks.push(checkSourcesMatch());

  // 5. MCP-инструменты (количество)
  checks.push(checkMcpToolsCount());

  // 6. Список MCP-инструментов
  checks.push(checkMcpToolsList());

  // 7. backlog/
  checks.push(checkBacklogDir(cwd));

  // 8. Конфиг
  checks.push(checkConfig(cwd));

  // 9. Задачи
  checks.push(checkTasks(cwd));

  // 10. Round-trip с Backlog.md
  checks.push(checkRoundtrip());

  // Предупреждение про кэш MCP
  warnings.push('Qwen Code: MCP-сервер мог быть закэширован. Если Qwen не видит новые инструменты — перезапусти Qwen.');

  // Обязательные проверки (влияют на exit code)
  const requiredNames = ['node', 'path', 'mcp_tools_count', 'mcp_tools_list', 'backlog_dir'];
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
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkNode() {
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
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkPath() {
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
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkSymlink() {
  try {
    const out = execSync('which vibelog 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim();
    if (!out) return { name: 'symlink', ok: false, value: null, hint: 'vibelog не найден в PATH' };

    const expected = join(__dirname, '..', '..', '..', 'bin', 'vibelog.mjs');

    // Проверяем, симлинк это или shell-скрипт pnpm
    const real = execSync(`realpath "${out}" 2>/dev/null || python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${out}" 2>/dev/null`, {
      encoding: 'utf-8', timeout: 2000,
    }).trim();

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
 * Проверка 4: PATH и process.argv[1] — одна копия.
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkSourcesMatch() {
  try {
    const srcPath = realpathSync(process.argv[1]);
    let binPath = null;
    try {
      const out = execSync('which vibelog 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim();
      if (out) {
        binPath = execSync(`realpath "${out}" 2>/dev/null || python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${out}" 2>/dev/null`, {
          encoding: 'utf-8', timeout: 2000,
        }).trim();
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
 * Проверка 5: количество MCP-инструментов.
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkMcpToolsCount() {
  const tools = listTools();
  const expected = 11;
  const ok = tools.length === expected;
  return {
    name: 'mcp_tools_count',
    ok,
    value: tools.length,
    expected,
    hint: ok ? undefined : `Ожидалось ${expected} инструментов, получено ${tools.length}. Проверьте, что запущена актуальная копия.`,
  };
}

/**
 * Проверка 6: список MCP-инструментов совпадает с ожидаемым.
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkMcpToolsList() {
  const tools = listTools();
  const actual = tools.map(t => t.name).sort();
  const expected = [
    'backlog_add_comment',
    'backlog_create_task',
    'backlog_list_tasks',
    'backlog_manage_ac',
    'backlog_manage_dod',
    'backlog_ready',
    'backlog_search',
    'backlog_update_dependencies',
    'backlog_update_status',
    'backlog_update_task',
    'backlog_view_task',
  ].sort();

  const missing = expected.filter(e => !actual.includes(e));
  const ok = missing.length === 0;
  return {
    name: 'mcp_tools_list',
    ok,
    value: actual,
    expected,
    hint: ok ? undefined : `Отсутствуют инструменты: ${missing.join(', ')}`,
  };
}

/**
 * Проверка 7: backlog/ найден.
 *
 * @param {string} cwd
 * @returns {{name, ok, value, expected, hint}}
 */
function checkBacklogDir(cwd) {
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
 * Проверка 8: конфиг читается.
 *
 * @param {string} cwd
 * @returns {{name, ok, value, expected, hint}}
 */
function checkConfig(cwd) {
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
      hint: err.message,
    };
  }
}

/**
 * Проверка 9: задачи парсятся.
 *
 * @param {string} cwd
 * @returns {{name, ok, value, expected, hint}}
 */
function checkTasks(cwd) {
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
      hint: err.message,
    };
  }
}

/**
 * Проверка 10: round-trip с Backlog.md (опциональная).
 *
 * @returns {{name, ok, value, expected, hint}}
 */
function checkRoundtrip() {
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
 * Печатает результаты в человекочитаемом виде.
 *
 * @param {Array} checks
 * @param {string[]} warnings
 */
function printHuman(checks, warnings) {
  console.log('\nVibelog.md doctor');
  console.log('────────────────\n');

  for (const check of checks) {
    const icon = check.ok ? colorize('✓', 'green') : colorize('✗', 'red');
    let line = `${icon} ${check.name}: `;

    if (check.ok) {
      if (typeof check.value === 'object' && check.value !== null) {
        line += JSON.stringify(check.value);
      } else if (check.value !== null && check.value !== undefined) {
        line += check.value;
      } else {
        line += 'ok';
      }
    } else {
      line += check.value ?? 'ошибка';
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
