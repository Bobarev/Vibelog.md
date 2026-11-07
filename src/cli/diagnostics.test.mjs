/**
 * Тесты PLAN-09.1 — диагностика (--version, doctor).
 *
 * Проверяет:
 * - vibelog --version выводит имя, версию, пути
 * - vibelog --version --json выводит JSON
 * - vibelog -v выводит только версию
 * - vibelog doctor выполняет проверки окружения
 * - vibelog doctor --json выводит структурированный результат
 * - Exit code при провале обязательных проверок
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { testSpawnEnv } from '../test-env.mjs';
import { checkMcpToolsInvariants } from '../../dist/cli/commands/doctor.js';
import { listTools } from '../../dist/mcp/tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-diagnostics-'));

/**
 * Ожидаемый перечень MCP-инструментов (VL-340).
 *
 * Раньше этот массив жил в `doctor.ts` и требовал правки кода при каждом
 * новом инструменте. Теперь это фикстура теста: новый инструмент добавляется
 * сюда осознанно (проверка «инструмент не пропал»), а инварианты реестра
 * (непустота, дубли, префиксы, inputSchema) проверяются в самом doctor.
 */
const EXPECTED_MCP_TOOLS = [
  'backlog_add_comment',
  'backlog_auto_queue',
  'backlog_create_task',
  'backlog_finish_phase',
  'backlog_list_tasks',
  'backlog_manage_ac',
  'backlog_manage_dod',
  'backlog_phase_status',
  'backlog_ready',
  'backlog_search',
  'backlog_supervisor',
  'backlog_trigger_phase',
  'backlog_update_dependencies',
  'backlog_update_status',
  'backlog_update_task',
  'backlog_view_task',
  'document_create',
  'document_list',
  'document_search',
  'document_update',
  'document_view',
  'git_commit',
  'lesson_audit',
  'lesson_classify',
  'lesson_create',
  'lesson_link',
  'lesson_list',
  'lesson_search_lessons',
  'lesson_supersede',
  'lesson_update',
  'lesson_view',
  'milestone_add',
  'milestone_archive',
  'milestone_list',
  'milestone_remove',
  'milestone_rename',
  'project_map',
  'reference_add',
  'reference_link',
  'reference_list',
  'reference_remove',
  'reference_search',
  'reference_sync',
  'reference_update',
  'reference_view',
];

// Читаем версию динамически из package.json, чтобы тесты не ломались при бампе
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version;

/**
 * Извлекает первый JSON-объект из строки.
 *
 * @param {string} out
 * @returns {object}
 */
function extractJson(out) {
  const start = out.indexOf('{');
  assert.ok(start >= 0, 'должен быть JSON');
  // Находим matching closing brace
  let depth = 0;
  let end = start;
  for (let i = start; i < out.length; i++) {
    if (out[i] === '{') depth++;
    if (out[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return JSON.parse(out.slice(start, end));
}

function runCli(args, opts = {}) {
  let raw;
  try {
    raw = execFileSync('node', [cliPath, ...args], {
      cwd: opts.cwd || testDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      // VL-132: без гарда каждый spawn CLI уходил бы npm view в реальный registry
      env: testSpawnEnv(),
    });
  } catch (err) {
    raw = (err.stdout || '') + (err.stderr || '');
  }
  // Фильтруем dyld-ошибки Catalina и пустые строки
  return raw.split('\n').filter(line =>
    line.trim() !== '' &&
    !line.includes('dyld:') && !line.includes('pwritev') && !line.includes('libSystem') &&
    !line.includes('Referenced from') && !line.includes('Expected in') &&
    !line.includes('Abort trap')
  ).join('\n');
}

describe('Диагностика — --version', () => {
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });
  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('--version выводит имя, версию, пути, node', () => {
    const out = runCli(['--version']);
    assert.ok(out.includes('vibelog.md'), 'должно содержать имя');
    assert.ok(out.includes(VERSION), `должно содержать версию ${VERSION}`);
    assert.ok(out.includes('src:'), 'должно содержать src');
    assert.ok(out.includes('node:'), 'должно содержать node');
    assert.ok(out.includes('vibelog.mjs'), 'src должен указывать на bin/vibelog.mjs');
  });

  it('--version --json выводит JSON', () => {
    const out = runCli(['--version', '--json']);
    const json = extractJson(out);
    assert.equal(json.name, 'vibelog.md');
    assert.equal(json.version, VERSION);
    assert.ok(json.src.includes('vibelog.mjs'));
    assert.ok(json.node.startsWith('v'));
    assert.ok(json.engines.node >= '20');
  });

  it('-v выводит только номер версии', () => {
    const out = runCli(['-v']).trim();
    assert.equal(out, VERSION);
  });

  it('Версия читается из package.json (не 0.0.0)', () => {
    const out = runCli(['--version']);
    assert.ok(!out.includes('0.0.0'), 'версия не должна быть 0.0.0');
  });
});

describe('Диагностика — doctor', () => {
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });
  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('doctor выполняет все проверки', () => {
    const out = runCli(['doctor']);
    assert.ok(out.includes('node'), 'проверка node');
    assert.ok(out.includes('mcp_tools_invariants'), 'проверка инвариантов MCP');
  });

  it('doctor --json выводит структурированный результат', () => {
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    assert.ok(json.ok !== undefined, 'поле ok');
    assert.ok(Array.isArray(json.checks), 'checks — массив');
    assert.ok(Array.isArray(json.warnings), 'warnings — массив');

    const names = json.checks.map(c => c.name);
    assert.ok(names.includes('node'), 'проверка node');
    assert.ok(names.includes('mcp_tools_invariants'), 'проверка инвариантов MCP');
  });

  it('doctor --json: инварианты реестра MCP проходят', () => {
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    const mcpCheck = json.checks.find(c => c.name === 'mcp_tools_invariants');
    assert.ok(mcpCheck, 'проверка mcp_tools_invariants присутствует');
    assert.equal(mcpCheck.ok, true, 'инварианты реестра должны проходить');
    assert.ok(mcpCheck.value.count > 0, 'реестр непуст');
    assert.deepEqual(mcpCheck.value.problems, []);
  });

  it('doctor --json: ожидаемый список MCP-инструментов присутствует в реестре', () => {
    // VL-340: перечень имён живёт в тесте (фикстура), а не в doctor.ts —
    // новый инструмент требует правки теста, но не кода проверки.
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    const mcpCheck = json.checks.find(c => c.name === 'mcp_tools_invariants');
    assert.ok(mcpCheck);
    const actual = listTools().map(t => t.name);
    const missing = EXPECTED_MCP_TOOLS.filter(n => !actual.includes(n));
    assert.deepEqual(missing, [], `отсутствуют инструменты: ${missing.join(', ')}`);
  });

  it('инварианты ловят дубль имени в реестре', () => {
    const tools = [
      { name: 'backlog_list_tasks', inputSchema: { type: 'object' } },
      { name: 'backlog_list_tasks', inputSchema: { type: 'object' } },
    ];
    const res = checkMcpToolsInvariants(tools);
    assert.equal(res.ok, false, 'дубль имени — нарушение инварианта');
    assert.ok(res.value.problems.some(p => p.includes('дубли имён')), 'проблема про дубли');
  });

  it('инварианты ловят пустой реестр, чужой префикс и отсутствие inputSchema', () => {
    assert.equal(checkMcpToolsInvariants([]).ok, false, 'пустой реестр');
    assert.equal(
      checkMcpToolsInvariants([{ name: 'foreign_tool', inputSchema: { type: 'object' } }]).ok,
      false,
      'имя вне политики префиксов'
    );
    assert.equal(
      checkMcpToolsInvariants([{ name: 'backlog_list_tasks' }]).ok,
      false,
      'нет inputSchema'
    );
    assert.equal(
      checkMcpToolsInvariants([{ name: 'backlog_list_tasks', inputSchema: { type: 'array' } }]).ok,
      false,
      'inputSchema не object'
    );
  });

  it('doctor: exit code 0 при успехе (с backlog)', () => {
    // Инициализируем backlog, чтобы обязательная проверка backlog_dir прошла
    runCli(['init', 'Test', '--prefix', 'tst']);
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    assert.equal(json.ok, true, 'ok должен быть true при наличии backlog');
  });

  it('doctor: ok=false без backlog (обязательная проверка)', () => {
    // Используем директорию ВНЕ проекта, чтобы findBacklogDir не поднялся вверх
    const emptyDir = mkdtempSync(join(tmpdir(), 'vibelog-doctor-empty-'));
    const out = runCli(['doctor', '--json'], { cwd: emptyDir });
    rmSync(emptyDir, { recursive: true, force: true });
    const json = extractJson(out);
    assert.equal(json.ok, false, 'ok должен быть false без backlog');
  });
});

describe('Диагностика — git-политика .vibelog/ (VL-340)', () => {
  // lesson-104: фикстура — собственный mkdtemp-каталог с git init, а не живой
  // репозиторий: в worktree задачи .gitignore другой, и тест был бы ложным.
  const dirs = [];

  function makeFixture({ git = true, gitignore = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-doctor-gitpolicy-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    if (gitignore) {
      writeFileSync(join(dir, '.vibelog', '.gitignore'), '*\n!*/\n!.gitignore\n!settings.json\n!billing/\n!billing/**\n');
    }
    if (git) {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    }
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('нет .vibelog/.gitignore → проверка не ok', () => {
    const dir = makeFixture({ git: true, gitignore: false });
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'vibelog_gitignore');
    assert.ok(check, 'проверка vibelog_gitignore присутствует');
    assert.equal(check.ok, false, 'отсутствие файла политики — не ok');
    assert.ok(check.hint, 'есть подсказка');
  });

  it('есть .vibelog/.gitignore → проверка ok', () => {
    const dir = makeFixture({ git: true, gitignore: true });
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'vibelog_gitignore');
    assert.equal(check.ok, true);
  });

  it('вне git-репозитория проверки git-политики не падают', () => {
    const dir = makeFixture({ git: false, gitignore: true });
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    for (const name of ['vibelog_settings_tracked', 'vibelog_billing_tracked', 'env_ignored', 'vibelog_root_ignored']) {
      const check = json.checks.find(c => c.name === name);
      assert.ok(check, `проверка ${name} присутствует`);
      assert.equal(check.ok, true, `${name} не должна падать вне git`);
      assert.equal(check.value, 'не git-репозиторий');
    }
  });

  it('регресс: .vibelog/ в корневом .gitignore → vibelog_root_ignored не ok', () => {
    const dir = makeFixture({ git: true, gitignore: true });
    writeFileSync(join(dir, '.gitignore'), '.vibelog/\n');
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'vibelog_root_ignored');
    assert.equal(check.ok, false, 'корневой .gitignore не должен игнорировать .vibelog/');
  });

  // VL-348: корневой .gitignore при существующем .env
  it('VL-348: нет корневого .gitignore при существующем .env → root_gitignore_exists не ok', () => {
    const dir = makeFixture({ git: true, gitignore: true });
    writeFileSync(join(dir, '.env'), 'A=1\n');
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'root_gitignore_exists');
    assert.ok(check, 'проверка root_gitignore_exists присутствует');
    assert.equal(check.ok, false, 'без .gitignore секреты не защищены');
    assert.ok(check.hint, 'есть подсказка');
  });

  it('VL-348: корневой .gitignore есть → root_gitignore_exists ok', () => {
    const dir = makeFixture({ git: true, gitignore: true });
    writeFileSync(join(dir, '.env'), 'A=1\n');
    writeFileSync(join(dir, '.gitignore'), '.env\n');
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'root_gitignore_exists');
    assert.equal(check.ok, true);
  });

  it('VL-348: без .env отсутствие .gitignore проверку не валит', () => {
    const dir = makeFixture({ git: true, gitignore: true });
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'root_gitignore_exists');
    assert.equal(check.ok, true, 'секретов нет — правило не требуется');
  });
});

describe('Диагностика — незакоммиченные billing/settings (VL-352)', () => {
  const dirs = [];

  /** Фикстура: git-репозиторий с политикой `.vibelog/.gitignore` (VL-329). */
  function makeFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-doctor-dirty-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(dir, '.vibelog', '.gitignore'),
      '*\n!*/\n!.gitignore\n!settings.json\n!billing/\n!billing/**\n',
    );
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('грязный .vibelog/billing/ → предупреждение с подсказкой', () => {
    const dir = makeFixture();
    mkdirSync(join(dir, '.vibelog', 'billing'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'billing', 'VL-1.json'), '{"taskId":"VL-1","sessions":[]}\n', 'utf-8');
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'vibelog_billing_clean');
    assert.ok(check, 'проверка vibelog_billing_clean присутствует');
    assert.equal(check.ok, false, 'грязный billing — не ok');
    assert.ok(Array.isArray(check.value), 'перечень файлов');
    assert.ok(check.value.some(f => f.includes('VL-1.json')), 'файл billing в перечне');
    assert.match(check.hint, /git add \.vibelog\/billing/, 'подсказка закоммитить вручную');
  });

  it('грязный settings.json → предупреждение', () => {
    const dir = makeFixture();
    writeFileSync(join(dir, '.vibelog', 'settings.json'), '{"commit_coauthor":false}\n', 'utf-8');
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    const check = json.checks.find(c => c.name === 'vibelog_settings_clean');
    assert.ok(check, 'проверка vibelog_settings_clean присутствует');
    assert.equal(check.ok, false, 'изменённый settings.json — не ok');
    assert.match(check.hint, /вручную/, 'подсказка про ручной коммит');
  });

  it('чистое дерево → обе проверки ok', () => {
    const dir = makeFixture();
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    for (const name of ['vibelog_billing_clean', 'vibelog_settings_clean']) {
      const check = json.checks.find(c => c.name === name);
      assert.ok(check, `проверка ${name} присутствует`);
      assert.equal(check.ok, true, `${name} ok на чистом дереве`);
    }
  });

  it('вне git-репозитория проверки не падают', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-doctor-dirty-nogit-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.vibelog', 'billing'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'billing', 'VL-1.json'), '{}\n', 'utf-8');
    const out = runCli(['doctor', '--json'], { cwd: dir });
    const json = extractJson(out);
    for (const name of ['vibelog_billing_clean', 'vibelog_settings_clean']) {
      const check = json.checks.find(c => c.name === name);
      assert.equal(check.ok, true, `${name} не падает вне git`);
      assert.equal(check.value, 'не git-репозиторий');
    }
  });
});
