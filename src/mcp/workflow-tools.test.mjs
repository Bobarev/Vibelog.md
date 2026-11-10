/**
 * Тесты MCP-инструментов конструктора workflow (VL-398).
 *
 * Проверяем: регистрацию в реестре, схемы, чтение схемы (`workflow_get`),
 * запись с валидацией ДО записи (`workflow_apply`), noop при повторе и
 * отказ на невалидном патче без изменения файла.
 *
 * Каталог — mkdtemp (AGENTS.md: фиксированные пути запрещены).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'vibelog-workflow-tools-'));
let cwd;

/** Минимальный проект: backlog/config.yml + пустой .vibelog/. */
function seedProject(name, statuses = ['To Do', 'Spec', 'In Progress', 'Done']) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(join(dir, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'WF MCP',
    task_prefix: 'WF',
    default_status: 'To Do',
    statuses,
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  }), 'utf-8');
  return dir;
}

/** Workflow: To Do --spec--> Spec --code--> In Progress --close--> Done. */
const PATCH = {
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
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('VL-398 — регистрация и схемы', () => {
  it('workflow_get и workflow_apply есть в реестре', () => {
    const names = listTools().map((t) => t.name);
    assert.ok(names.includes('workflow_get'));
    assert.ok(names.includes('workflow_apply'));
  });

  it('описания на русском и непустые', () => {
    const tools = new Map(listTools().map((t) => [t.name, t]));
    for (const name of ['workflow_get', 'workflow_apply']) {
      const tool = tools.get(name);
      assert.ok(tool);
      assert.ok(tool.description.length > 40, `${name}: описание слишком короткое`);
      assert.match(tool.description, /[а-яА-ЯёЁ]/, `${name}: описание на русском`);
    }
  });

  it('inputSchema: workflow_apply требует patch', () => {
    const tool = listTools().find((t) => t.name === 'workflow_apply');
    assert.equal(tool.inputSchema.type, 'object');
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['dryRun', 'idempotencyKey', 'patch', 'syncStatuses']);
    assert.deepEqual(tool.inputSchema.required, ['patch']);
  });
});

describe('VL-398 — workflow_get', () => {
  it('отдаёт схему, источник и находки валидации', async () => {
    const ack = JSON.parse(await handleToolCall('workflow_get', {}, cwd));
    assert.equal(ack.ok, true);
    assert.equal(ack.read, true);
    assert.equal(ack.applied.workflow.source, 'default-in-code');
    assert.ok(Array.isArray(ack.applied.workflow.transitions));
    assert.ok(Array.isArray(ack.applied.findings));
    assert.equal(ack.applied.ok, true, 'дефолтный workflow без ошибок');
  });

  it('после apply источник становится settings', async () => {
    await handleToolCall('workflow_apply', { patch: PATCH }, cwd);
    const ack = JSON.parse(await handleToolCall('workflow_get', {}, cwd));
    assert.equal(ack.applied.workflow.source, 'settings');
    assert.deepEqual(ack.applied.workflow.transitions, PATCH.workflows.default.transitions);
  });
});

describe('VL-398 — workflow_apply', () => {
  it('записывает патч и сохраняет чужие ключи', async () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({ models: { default: 'm1' } }), 'utf-8');
    const ack = JSON.parse(await handleToolCall('workflow_apply', { patch: PATCH }, cwd));
    assert.equal(ack.ok, true);
    const saved = JSON.parse(readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
    assert.deepEqual(saved.workflows.default, PATCH.workflows.default);
    assert.deepEqual(saved.models, { default: 'm1' });
  });

  it('повтор того же патча → applied+unchanged', async () => {
    await handleToolCall('workflow_apply', { patch: PATCH }, cwd);
    const ack = JSON.parse(await handleToolCall('workflow_apply', { patch: PATCH }, cwd));
    // VL-413: неизменяющая запись — успех с перечнем неизменённых полей.
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(ack.outcome, 'applied');
    assert.ok(Array.isArray(ack.unchanged) && ack.unchanged.length > 0);
  });

  it('невалидный патч (неизвестная фаза) → ok:false, файл не создан', async () => {
    const ack = JSON.parse(await handleToolCall('workflow_apply', {
      patch: {
        workflows: {
          default: {
            initial_status: 'To Do',
            transitions: [{ status: 'To Do', phase: 'нетакой', produces_status: 'Done' }],
          },
        },
      },
    }, cwd));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /неизвестна/);
    assert.equal(existsSync(join(cwd, '.vibelog', 'settings.json')), false);
  });

  it('patch не объект → ok:false', async () => {
    const ack = JSON.parse(await handleToolCall('workflow_apply', { patch: 'строка' }, cwd));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /patch/);
  });

  it('dryRun: файл не создан, applied показан', async () => {
    const ack = JSON.parse(await handleToolCall('workflow_apply', { patch: PATCH, dryRun: true }, cwd));
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.dryRun, true);
    assert.equal(existsSync(join(cwd, '.vibelog', 'settings.json')), false);
  });

  it('syncStatuses дополняет config.yml', async () => {
    const ack = JSON.parse(await handleToolCall('workflow_apply', {
      patch: {
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
      },
      syncStatuses: true,
    }, cwd));
    assert.equal(ack.ok, true);
    assert.deepEqual(ack.applied.statusesAdded, ['Review']);
    assert.match(readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8'), /Review/);
  });
});
