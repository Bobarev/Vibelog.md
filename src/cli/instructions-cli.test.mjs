/**
 * Тесты команды `vibelog instructions` (VL-396).
 *
 * Проверяется то, что задача добавляет: темы `workflow`, `mcp`, `settings`,
 * переписанный `overview` (фазовый процесс вместо «To Do → In Progress → Done»),
 * листинг тем без аргумента и в ошибке, и главное — что MCP-группы собираются
 * из РЕЕСТРА `listTools()`, а не из литерала (AC6).
 *
 * Стиль `src/cli/capabilities-cli.test.mjs`: прямой вызов dist-модуля с
 * перехватом console (спавна нет → testSpawnEnv не нужен), каталог — mkdtemp
 * (AGENTS.md: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  runInstructions,
  buildInstructions,
  groupMcpTools,
  MCP_GROUPS,
  INSTRUCTION_TOPICS,
} from '../../dist/cli/commands/instructions.js';
import { listTools } from '../../dist/mcp/tools.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

let testRoot;

/** Перехватывает console.log/console.error и возвращает оба потока. */
async function capture(fn) {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(' ')); };
  console.error = (...args) => { err.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out: out.join('\n'), err: err.join('\n') };
}

/** Создаёт минимальный проект в подкаталоге testRoot и возвращает путь. */
function makeProject(name, settingsJson) {
  const dir = join(testRoot, name);
  mkdirSync(join(dir, 'backlog'), { recursive: true });
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(
    join(dir, 'backlog', 'config.yml'),
    'project_name: Test\ntask_prefix: TS\nstatuses:\n  - To Do\n  - Done\n',
    'utf8',
  );
  if (settingsJson !== undefined) {
    writeFileSync(join(dir, '.vibelog', 'settings.json'), settingsJson, 'utf8');
  }
  return dir;
}

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'vibelog-instructions-'));
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-396 — темы instructions', () => {
  it('список тем содержит workflow, mcp, settings сверх прежних четырёх', () => {
    for (const topic of ['overview', 'workflow', 'mcp', 'settings',
      'task-creation', 'task-execution', 'task-finalization']) {
      assert.ok(INSTRUCTION_TOPICS.includes(topic), `тема ${topic} в списке`);
    }
    assert.equal(INSTRUCTION_TOPICS.length, 7);
  });

  it('workflow: фазы, ветки, дефолт в коде, пример секций', async () => {
    const dir = makeProject('wf-default');
    const { out } = await capture(() => runInstructions(['workflow'], {}, dir));

    for (const needle of ['To Do', 'spec', 'plan', 'code', 'close', 'Review', 'reject',
      'task_workflows', 'completeness', '.vibelog/prompts/phases', 'DEFAULT_WORKFLOW']) {
      assert.ok(out.includes(needle), `workflow упоминает ${needle}`);
    }
    assert.ok(out.includes('ДЕФОЛТ В КОДЕ'), 'источник — дефолт в коде');
    assert.ok(out.includes('Review --code--> Review'), 'fix-цикл Review → code');
    assert.ok(out.includes('"workflows"'), 'пример секции workflows в JSON');
  });

  it('workflow: при секции workflows в settings — источник «из settings»', async () => {
    const dir = makeProject('wf-settings', JSON.stringify({
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'do', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    }));
    const { out } = await capture(() => runInstructions(['workflow'], {}, dir));
    assert.ok(out.includes('переопределяет'), 'источник — settings.json');
    assert.ok(out.includes('To Do --do--> Done'), 'переходы взяты из settings');
  });

  it('mcp: группы из реестра и правила применения', async () => {
    const dir = makeProject('mcp');
    const { out } = await capture(() => runInstructions(['mcp'], {}, dir));

    for (const needle of ['Задачи и чеклисты', 'Документы', 'Вехи', 'Lessons', 'References',
      'Фазы и супервизор', 'backlog_create_task', 'idempotencyKey', 'applied', 'skipped',
      'Allow/Deny', 'backlog/']) {
      assert.ok(out.includes(needle), `mcp упоминает ${needle}`);
    }
  });

  it('settings: ключи обоих конфигов и git-политика', async () => {
    const dir = makeProject('settings');
    const { out } = await capture(() => runInstructions(['settings'], {}, dir));

    for (const needle of ['workflows', 'task_workflows', 'completeness', 'statuses',
      'task_prefix', '.env', 'billing/']) {
      assert.ok(out.includes(needle), `settings упоминает ${needle}`);
    }
  });

  it('overview: фазовый процесс вместо «To Do → In Progress → Done»', async () => {
    const dir = makeProject('overview');
    const { out } = await capture(() => runInstructions(['overview'], {}, dir));

    for (const needle of ['Vibelog.md', 'vibelog task create', 'spec', 'plan', 'code',
      'close', 'vibelog capabilities']) {
      assert.ok(out.includes(needle), `overview упоминает ${needle}`);
    }
    assert.ok(!out.includes('To Do → In Progress → Done'), 'устаревшая картина убрана');
  });

  it('без темы: печатает overview и полный список тем', async () => {
    const dir = makeProject('no-topic');
    const { out } = await capture(() => runInstructions([], {}, dir));
    for (const topic of INSTRUCTION_TOPICS) {
      assert.ok(out.includes(topic), `листинг содержит тему ${topic}`);
    }
  });

  it('неизвестная тема: ошибка в stderr и список тем в stdout', async () => {
    const dir = makeProject('bad-topic');
    const { out, err } = await capture(() => runInstructions(['нет-такой'], {}, dir));
    assert.ok(err.includes('Неизвестная тема'), `stderr: ${err}`);
    for (const topic of INSTRUCTION_TOPICS) {
      assert.ok(out.includes(topic), `список тем содержит ${topic}`);
    }
  });

  it('каждая тема укладывается в лимит tool-ответа (≤ 12000 символов)', () => {
    const dir = makeProject('sizes');
    const instructions = buildInstructions(dir);
    for (const topic of INSTRUCTION_TOPICS) {
      const text = instructions[topic];
      assert.ok(typeof text === 'string' && text.length > 0, `тема ${topic} непуста`);
      assert.ok(text.length <= 12000, `тема ${topic}: ${text.length} символов`);
    }
  });
});

describe('VL-396 — партиционирование MCP-инструментов (AC6)', () => {
  it('объединение групп равно множеству имён реестра, без дублей', () => {
    const registry = listTools().map((t) => t.name);
    const groups = groupMcpTools(listTools());
    const flat = groups.flatMap((g) => g.tools);

    assert.equal(new Set(flat).size, flat.length, 'дублей между группами нет');
    assert.deepEqual([...flat].sort(), [...registry].sort(), 'все инструменты реестра разложены');
  });

  it('новый инструмент реестра попадает в группу «прочее», а не теряется', () => {
    const tools = [...listTools(), { name: 'backlog_new_thing' }];
    const groups = groupMcpTools(tools);
    const other = groups.find((g) => g.title.startsWith('Прочее'));
    assert.ok(other, 'группа «прочее» появилась');
    assert.deepEqual(other.tools, ['backlog_new_thing']);
  });

  it('в MCP_GROUPS нет протухших имён (каждое есть в реестре)', () => {
    const registry = new Set(listTools().map((t) => t.name));
    const stale = MCP_GROUPS.flatMap((g) => g.names).filter((name) => !registry.has(name));
    assert.deepEqual(stale, [], `имён нет в реестре: ${stale.join(', ')}`);
  });
});

/**
 * Контракт САМОГО процесса CLI: тема должна доходить до команды через роутер.
 * Проверка спавном (как остальные контракты bin/vibelog.mjs в
 * src/cli/cli.test.mjs): прямой вызов runInstructions этого не поймал бы —
 * первый позиционный аргумент парсер кладёт в `subcommand`, и без склейки
 * любая тема печатала `overview` (дефект, найденный при VL-396).
 */
describe('VL-396 — тема доходит через роутер (спавн bin/vibelog.mjs)', () => {
  function runCli(...args) {
    return spawnSync('node', [cliPath, ...args], {
      cwd: testRoot,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testSpawnEnv(),
    });
  }

  it('instructions workflow — печатает тему workflow, а не overview', () => {
    const res = runCli('instructions', 'workflow');
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Ключи `.vibelog/settings.json`'), res.stdout.slice(0, 400));
    assert.ok(res.stdout.includes('task_workflows'), 'тема workflow, не overview');
  });

  it('instructions mcp — печатает группы, а не overview', () => {
    const res = runCli('instructions', 'mcp');
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Правила применения'), res.stdout.slice(0, 400));
  });

  it('vibelog --help перечисляет полный список тем', () => {
    const res = runCli('help');
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('overview|workflow|mcp|settings|task-*'), 'строка справки с темами');
  });
});
