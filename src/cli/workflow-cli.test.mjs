/**
 * Тесты команды `vibelog workflow` (VL-398).
 *
 * Чистая логика проверяется прямым вызовом runWorkflow с перехватом
 * console.log (стиль `src/cli/capabilities-cli.test.mjs`): без спавна.
 * Каталог — mkdtemp (AGENTS.md: фиксированные пути запрещены).
 *
 * Сквозной сценарий AC6: пустой проект → apply workflow spec→code →
 * `workflow show` отражает применённое → getAvailablePhases даёт фазы из
 * новых статусов.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkflow } from '../../dist/cli/commands/workflow.js';
import { getAvailablePhases, getWorkflowForTask } from '../../dist/core/workflow.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'vibelog-workflow-cli-'));
let cwd;

/** Перехватывает console.log команды и возвращает склеенный вывод. */
async function capture(fn) {
  const chunks = [];
  const orig = console.log;
  const origErr = console.error;
  console.log = (...args) => { chunks.push(args.join(' ')); };
  console.error = (...args) => { chunks.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = orig;
    console.error = origErr;
  }
  return chunks.join('\n');
}

/** Минимальный проект: backlog/config.yml + пустой .vibelog/. */
function seedProject(name, statuses = ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked', 'Rejected']) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(join(dir, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'WF CLI',
    task_prefix: 'WF',
    default_status: 'To Do',
    statuses,
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  }), 'utf-8');
  return dir;
}

/** Workflow из AC6: To Do --spec--> Spec --code--> In Progress --close--> Done. */
const AC6_WORKFLOW = {
  workflows: {
    default: {
      initial_status: 'To Do',
      transitions: [
        { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
        { status: 'Spec', phase: 'code', produces_status: 'In Progress' },
        { status: 'In Progress', phase: 'close', produces_status: 'Done' },
        { status: 'Done', phase: null, produces_status: null },
      ],
    },
  },
};

beforeEach(() => {
  cwd = seedProject(`p-${Math.random().toString(36).slice(2)}`);
  process.exitCode = 0;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('VL-398 — workflow show', () => {
  it('без settings: помечает «дефолт в коде» и печатает переходы', async () => {
    const out = await capture(() => runWorkflow('show', [], {}, cwd));
    assert.match(out, /ДЕФОЛТ В КОДЕ/);
    assert.match(out, /To Do --spec--> Spec/);
    assert.match(out, /task_workflows/);
    assert.match(out, /completeness/);
  });

  it('--json: {schemaVersion, kind, data} с источником', async () => {
    const out = await capture(() => runWorkflow('show', [], { json: true }, cwd));
    const parsed = JSON.parse(out);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.kind, 'workflow');
    assert.equal(parsed.data.source, 'default-in-code');
    assert.ok(Array.isArray(parsed.data.transitions));
  });
});

describe('VL-398 — workflow validate', () => {
  it('согласованная конфигурация → успех, exit code 0', async () => {
    const out = await capture(() => runWorkflow('validate', [], {}, cwd));
    assert.match(out, /согласована/);
    assert.equal(process.exitCode, 0);
  });

  it('неизвестная фаза → ошибка и exit code 1', async () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [{ status: 'To Do', phase: 'нетакой', produces_status: 'Done' }],
        },
      },
    }), 'utf-8');
    const out = await capture(() => runWorkflow('validate', [], {}, cwd));
    assert.match(out, /неизвестна/);
    assert.equal(process.exitCode, 1);
  });

  it('--json: ok=false при ошибке', async () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [{ status: 'To Do', phase: 'нетакой', produces_status: 'Done' }],
        },
      },
    }), 'utf-8');
    const out = await capture(() => runWorkflow('validate', [], { json: true }, cwd));
    const parsed = JSON.parse(out);
    assert.equal(parsed.kind, 'workflow-validate');
    assert.equal(parsed.data.ok, false);
  });
});

describe('VL-398 — workflow apply', () => {
  it('AC6: сквозной сценарий — apply → show → фазы из новых статусов', async () => {
    // Пустой проект ровно с теми статусами, что в AC6
    cwd = seedProject(`ac6-${Math.random().toString(36).slice(2)}`, ['To Do', 'Spec', 'In Progress', 'Done']);
    const file = join(cwd, 'wf.json');
    writeFileSync(file, JSON.stringify(AC6_WORKFLOW), 'utf-8');

    const applyOut = await capture(() => runWorkflow('apply', [file], {}, cwd));
    assert.match(applyOut, /записан/);
    assert.equal(process.exitCode, 0);

    const showOut = await capture(() => runWorkflow('show', [], {}, cwd));
    assert.match(showOut, /settings\.json/);
    assert.match(showOut, /To Do --spec--> Spec/);
    assert.match(showOut, /Spec --code--> In Progress/);

    const task = { id: 'WF-1', type: 'feature', status: 'To Do' };
    const workflow = getWorkflowForTask(cwd, task);
    assert.deepEqual(getAvailablePhases(workflow, 'To Do'), ['spec']);
    assert.deepEqual(getAvailablePhases(workflow, 'Spec'), ['code']);
    assert.deepEqual(getAvailablePhases(workflow, 'In Progress'), ['close']);
  });

  it('--dry-run: файл не создан', async () => {
    const file = join(cwd, 'wf.json');
    writeFileSync(file, JSON.stringify(AC6_WORKFLOW), 'utf-8');
    const out = await capture(() => runWorkflow('apply', [file], { 'dry-run': true }, cwd));
    assert.match(out, /dry-run/);
    assert.throws(() => readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
  });

  it('повторный apply → noop', async () => {
    const file = join(cwd, 'wf.json');
    writeFileSync(file, JSON.stringify(AC6_WORKFLOW), 'utf-8');
    await capture(() => runWorkflow('apply', [file], {}, cwd));
    const out = await capture(() => runWorkflow('apply', [file], {}, cwd));
    assert.match(out, /Изменений нет/);
  });

  it('невалидный вход → exit code 1, файл не создан', async () => {
    const file = join(cwd, 'bad.json');
    writeFileSync(file, JSON.stringify({
      workflows: { default: { initial_status: 'To Do', transitions: [{ status: 'To Do', phase: 'нетакой', produces_status: 'Done' }] } },
    }), 'utf-8');
    const out = await capture(() => runWorkflow('apply', [file], {}, cwd));
    assert.match(out, /неизвестна/);
    assert.equal(process.exitCode, 1);
    assert.throws(() => readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
  });

  it('--sync-statuses дополняет config.yml', async () => {
    cwd = seedProject(`sync-${Math.random().toString(36).slice(2)}`, ['To Do', 'Spec', 'In Progress', 'Done']);
    const file = join(cwd, 'wf.json');
    writeFileSync(file, JSON.stringify({
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'code', produces_status: 'Review' },
            { status: 'Review', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    }), 'utf-8');
    const out = await capture(() => runWorkflow('apply', [file], { 'sync-statuses': true }, cwd));
    assert.match(out, /Статусы дописаны/);
    assert.match(readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8'), /Review/);
  });

  it('без аргумента файла → ошибка и exit code 1', async () => {
    const out = await capture(() => runWorkflow('apply', [], {}, cwd));
    assert.match(out, /Укажите файл/);
    assert.equal(process.exitCode, 1);
  });

  it('неизвестная подкоманда → ошибка', async () => {
    const out = await capture(() => runWorkflow('nope', [], {}, cwd));
    assert.match(out, /Неизвестная подкоманда/);
    assert.equal(process.exitCode, 1);
  });
});
