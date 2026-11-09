/**
 * Тесты команды `vibelog capabilities` (VL-394).
 *
 * Чистая логика проверяется прямым вызовом runCapabilities с перехватом
 * console.log (стиль `src/cli/map-cli.test.mjs`): без спавна. Каталог —
 * mkdtemp (AGENTS.md: фиксированные пути запрещены).
 *
 * Что проверяется: наличие ключевых секций в markdown и JSON, пометка
 * «workflow — дефолт в коде», сборка списков из РЕЕСТРОВ (`listTools`,
 * `CLI_COMMANDS`) а не из литералов, устойчивость к битому/отсутствующему
 * settings.json, инвариант шаблона AGENTS.md.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runCapabilities } from '../../dist/cli/commands/capabilities.js';
import { parseArgs } from '../../dist/cli/args.js';
import { buildCapabilities } from '../../dist/core/capabilities.js';
import { listTools } from '../../dist/mcp/tools.js';
import { CLI_COMMANDS } from '../../dist/cli/command-registry.js';
import { DEFAULT_WORKFLOW } from '../../dist/core/workflow.js';
import { applySetup } from '../../dist/core/setup.js';
import { AGENTS_MD_MAX_CHARS } from '../../dist/agent/system-prompt.js';

let testRoot;

/** Перехватывает console.log команды и возвращает склеенный вывод. */
async function capture(fn) {
  const chunks = [];
  const orig = console.log;
  const info = console.info;
  console.log = (...args) => { chunks.push(args.join(' ')); };
  console.info = (...args) => { chunks.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = orig;
    console.info = info;
  }
  return chunks.join('\n');
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
  testRoot = mkdtempSync(join(tmpdir(), 'vibelog-capabilities-'));
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-394 — vibelog capabilities: markdown', () => {
  it('печатает все ключевые секции справочника', async () => {
    const dir = makeProject('plain');
    const out = await capture(() => runCapabilities([], parseArgs(['capabilities']).flags, dir));

    assert.match(out, /справочник возможностей/i);
    // workflow + пометка о дефолте в коде (AC1, AC3)
    assert.match(out, /Workflow: статусы и фазы/);
    assert.match(out, /дефолт в коде/i);
    assert.match(out, /DEFAULT_WORKFLOW/);
    assert.match(out, /To Do --spec--> Spec/);
    // переопределение с примером секции (AC3)
    assert.match(out, /workflows/);
    assert.match(out, /\.vibelog\/settings\.json/);
    // task_workflows / completeness (AC1)
    assert.match(out, /task_workflows/);
    assert.match(out, /completeness/);
    assert.match(out, /implementationPlan/);
    // фазы + способ переопределения шаблона
    assert.match(out, /## Фазы/);
    assert.match(out, /\.vibelog\/prompts\/phases/);
    // MCP, CLI, ключи конфигов (AC1)
    assert.match(out, /MCP-инструменты/);
    assert.match(out, /CLI-команды/);
    assert.match(out, /backlog\/config\.yml/);
    assert.match(out, /settings\.json/);
    // доступ и контракт write-ответа (AC1)
    assert.match(out, /Allow\/Deny/);
    assert.match(out, /applied/);
    assert.match(out, /skipped/);
    // подсказка «что делать дальше»
    assert.match(out, /Что делать дальше/);
    assert.match(out, /НЕ обязательно/i);
  });

  it('размер markdown в разумных пределах (один tool-ответ)', async () => {
    const dir = makeProject('size');
    const out = await capture(() => runCapabilities([], parseArgs(['capabilities']).flags, dir));
    // Ориентир задачи — до ~8 КБ; держим мягкий потолок 12 КБ, чтобы список
    // инструментов не пришлось выкидывать целиком.
    assert.ok(Buffer.byteLength(out) < 12000, `markdown ${Buffer.byteLength(out)} байт`);
  });
});

describe('VL-394 — vibelog capabilities: --json', () => {
  it('возвращает {schemaVersion, kind, data} с машиночитаемыми секциями (AC2)', async () => {
    const dir = makeProject('json');
    const out = await capture(() => runCapabilities([], parseArgs(['capabilities', '--json']).flags, dir));
    const parsed = JSON.parse(out);

    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.kind, 'capabilities');
    const data = parsed.data;
    assert.equal(data.kind, 'capabilities');
    assert.equal(data.workflow.initial_status, DEFAULT_WORKFLOW.initial_status);
    assert.equal(data.workflow.source, 'default-in-code');
    assert.ok(Array.isArray(data.phases) && data.phases.length > 0);
    assert.ok(Array.isArray(data.mcpTools) && data.mcpTools.length > 0);
    assert.ok(Array.isArray(data.cliCommands) && data.cliCommands.length > 0);
    assert.ok(Array.isArray(data.configKeys) && data.configKeys.length > 0);
    assert.ok(Array.isArray(data.settingsKeys) && data.settingsKeys.length > 0);
    assert.ok(data.access.ack.includes('applied'));
    assert.ok(Array.isArray(data.nextSteps) && data.nextSteps.length > 0);
    // назначения фаз заполнены (не пустые строки)
    for (const phase of data.phases) {
      assert.ok(phase.purpose.length > 0, `${phase.name}: назначение не пустое`);
    }
  });

  it('AC4: списки берутся из реестров, а не из литералов', async () => {
    const dir = makeProject('registries');
    const data = buildCapabilities(dir);
    const registryTools = listTools();

    // Полное совпадение множеств и порядок — признак чтения из listTools()
    assert.deepEqual(data.mcpTools.map((t) => t.name), registryTools.map((t) => t.name));
    assert.deepEqual(data.cliCommands.map((c) => c.name), CLI_COMMANDS.map((c) => c.name));

    // Каждый инструмент и команда видны в markdown-выводе по имени
    const out = await capture(() => runCapabilities([], parseArgs(['capabilities']).flags, dir));
    for (const tool of registryTools) {
      assert.ok(out.includes(tool.name), `в выводе нет MCP-инструмента ${tool.name}`);
    }
    for (const cmd of CLI_COMMANDS) {
      assert.ok(new RegExp(`\`${cmd.name}\``).test(out) || out.includes(cmd.summary), `в выводе нет CLI-команды ${cmd.name}`);
    }
  });

  it('workflow из settings.json помечается как переопределённый', () => {
    const dir = makeProject('custom', JSON.stringify({
      workflows: {
        default: {
          initial_status: 'Backlog',
          transitions: [
            { status: 'Backlog', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'do', produces_status: 'Done' },
          ],
        },
      },
    }));
    const data = buildCapabilities(dir);
    assert.equal(data.workflow.source, 'settings');
    assert.equal(data.workflow.initial_status, 'Backlog');
    assert.equal(data.workflow.transitions.length, 2);
    assert.match(data.workflow.note, /workflows/);
  });
});

describe('VL-394 — устойчивость к settings.json (AC6)', () => {
  it('отсутствующий settings.json: команда работает на дефолтном workflow', async () => {
    const dir = makeProject('no-settings');
    assert.ok(!existsSync(join(dir, '.vibelog', 'settings.json')));
    const out = await capture(() => runCapabilities([], parseArgs(['capabilities']).flags, dir));
    assert.match(out, /To Do --spec--> Spec/);
    assert.match(out, /дефолт в коде/i);
  });

  it('битый settings.json: не падает, работает на дефолте', async () => {
    const dir = makeProject('broken', '{это не json');
    const data = buildCapabilities(dir);
    assert.equal(data.workflow.source, 'default-in-code');
    assert.equal(data.workflow.initial_status, DEFAULT_WORKFLOW.initial_status);
    const out = await capture(() => runCapabilities([], parseArgs(['capabilities']).flags, dir));
    assert.match(out, /To Do --spec--> Spec/);
  });

  it('пустой каталог без backlog/: справочник строится (проект не требуется)', () => {
    const dir = join(testRoot, 'empty');
    mkdirSync(dir, { recursive: true });
    const data = buildCapabilities(dir);
    assert.ok(data.mcpTools.length > 0);
    assert.ok(data.phases.length > 0);
    assert.equal(data.workflow.source, 'default-in-code');
  });
});

describe('VL-394 — реестр CLI-команд', () => {
  it('capabilities присутствует, имена и описания непустые, дублей нет', () => {
    assert.ok(CLI_COMMANDS.some((c) => c.name === 'capabilities'));
    const seen = new Set();
    for (const entry of CLI_COMMANDS) {
      assert.ok(entry.name.trim() !== '', 'пустое имя команды');
      assert.ok(entry.summary.trim() !== '', `пустое описание у ${entry.name}`);
      assert.ok(!seen.has(entry.name), `дубль команды ${entry.name}`);
      seen.add(entry.name);
    }
  });
});

describe('VL-394 — инвариант шаблона AGENTS.md (AC7, AC8)', () => {
  it('ссылается на vibelog capabilities, укладывается в лимит и остаётся коротким', () => {
    const dir = join(testRoot, 'agents-md');
    mkdirSync(dir, { recursive: true });
    applySetup(dir, {
      mode: 'fresh',
      projectName: 'Test Project',
      prefix: 'TP',
      agents: [{ id: 'vb', available: true, enabled: false }],
      defaultAgent: null,
      secrets: { location: 'env' },
      bot: { enabled: false, chats: [] },
      llm: { skip: true },
      git: { init: false },
      components: false,
    });

    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(content.includes('vibelog capabilities'), 'AGENTS.md ссылается на capabilities');
    assert.ok(content.includes('vibelog instructions'), 'краткая ссылка на instructions сохранена');
    const lines = content.split('\n');
    assert.ok(lines.length <= 30, `AGENTS.md: ${lines.length} строк`);
    assert.ok(
      content.length < AGENTS_MD_MAX_CHARS - 2000,
      `AGENTS.md ${content.length} символов — нужен запас под правила проекта`,
    );
    // Одна строка вместо прежней: новых разделов не появилось
    assert.equal((content.match(/vibelog capabilities/g) ?? []).length, 1);
  });
});
