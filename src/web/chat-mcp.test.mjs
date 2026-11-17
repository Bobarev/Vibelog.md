/**
 * Тесты VL-422 — слэш-команда `/mcp`: сторонние MCP-серверы в веб-чате.
 *
 * Проверяемые AC:
 * - `/mcp on` подключает серверы из mcpServers settings.json, флаг треда
 *   поднимается, инструменты видны модели со следующего хода;
 * - `/mcp off` снимает единицу refcount: на нуле клиенты закрыты, specs
 *   пусты, chatToolDefs без внешних;
 * - refcount двух тредов: off в одном не разрывает соединение другого;
 * - `/mcp status` показывает настроенные и подключённые серверы с числом
 *   инструментов;
 * - проект без mcpServers → ошибка «не настроены», ничего не спавнится;
 * - shutdownExternalChatMcp и остановка startWebServer закрывают клиенты;
 * - внешний инструмент классифицируется как write (→ Allow/Deny);
 * - `/mcp` есть в CHAT_COMMANDS и в helpText.
 *
 * Фейковый stdio-сервер — паттерн src/agent/external-mcp.test.mjs; имя
 * сервера «echo-server» намеренно с дефисом — проверяем префикс
 * `echo_server__` (toolPrefixFor). Упоминаний конкретных сторонних серверов
 * в коде и тестах нет (AC7) — только общий mcpServers и toolPrefixFor.
 */

import { describe, it, beforeAll, afterAll, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearPhaseEnv } from '../test-env.mjs';
import {
  connectExternalForChat,
  releaseExternalForChat,
  getExternalSpecs,
  externalChatMcpStatus,
  shutdownExternalChatMcp,
} from '../../dist/web/external-chat-mcp.js';
import { chatToolDefs, isWriteOperation } from '../../dist/web/tool-policy.js';
import { CHAT_COMMANDS, findCommand, helpText } from '../../dist/web/chat-commands.js';
import { runChat, readThreadMcp } from '../../dist/web/chat.js';
import { startWebServer } from '../../dist/web/server.js';
import { zeroUsage } from '../../dist/agent/llm.js';

/** Проект с настроенным mcpServers (echo-server) и проект без них. */
let cwd;
let bare;
/** Снятие env агентской сессии (VL-286/lesson-254): VIBELOG_CWD и пр. */
let restorePhaseEnv;

/** Пишет .vibelog/settings.json проекту. */
function writeSettings(dir, data) {
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify(data, null, 2), 'utf-8');
}

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();

  cwd = mkdtempSync(join(tmpdir(), 'vibelog-vl422-mcp-'));
  bare = mkdtempSync(join(tmpdir(), 'vibelog-vl422-bare-'));

  // Минимальный проект: задачи/конфиг — чтобы chat-пути не падали на
  // отсутствии backlog/ (паттерн persona-allow-tools.test.mjs)
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    'project_name: VL422 Test\ntask_prefix: vl\ndefault_status: To Do\nstatuses: [To Do, Done]\ndefinition_of_done: []\n',
    'utf-8',
  );

  // Фейковый stdio MCP-сервер: handshake + tools/list + echo-инструмент
  writeFileSync(join(cwd, 'fake-mcp.mjs'), `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize' && msg.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-server', version: '1.0.0' },
      },
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/list' && msg.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'echo', description: 'echo message', inputSchema: { type: 'object' } }] },
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/call' && msg.id !== undefined) {
    const text = String(msg.params?.arguments?.message ?? '');
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { content: [{ type: 'text', text }] },
    }) + '\\n');
    return;
  }
  // notifications и прочее — молчим
});
rl.on('close', () => process.exit(0));
`, 'utf-8');

  // Имя сервера с дефисом — префикс инструментов «echo_server__»
  writeSettings(cwd, {
    mcpServers: {
      'echo-server': {
        command: process.execPath,
        args: [join(cwd, 'fake-mcp.mjs')],
        timeoutMs: 5000,
      },
    },
  });

  // Проект БЕЗ mcpServers (AC4)
  writeSettings(bare, {});
});

afterEach(async () => {
  // Изоляция тестов: процессный кэш не должен течь между кейсами
  await shutdownExternalChatMcp();
});

afterAll(async () => {
  await shutdownExternalChatMcp();
  restorePhaseEnv();
  rmSync(cwd, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

/** Собрать события runChat (в проекте dir, по умолчанию — основной). */
async function collect(body, deps = {}, dir = cwd) {
  const events = [];
  for await (const ev of runChat({ ...body }, dir, deps)) events.push(ev);
  return events;
}

/** Склейка text-дельт события в полный текст ответа. */
function textOf(events) {
  return events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
}

/** Фейковый LLM: запоминает переданные модели tools, отвечает одним токеном. */
function fakeLlm() {
  const state = { tools: null };
  return {
    state,
    llm: {
      async streamChat(_messages, tools, opts) {
        state.tools = tools;
        opts?.onToken?.('ок');
        return { text: 'ок', toolCalls: [], usage: zeroUsage() };
      },
    },
  };
}

describe('VL-422 — /mcp on: подключение и видимость инструментов (AC1)', () => {
  it('AC1: команда подключает серверы, ставит флаг треда, инструменты видны со следующего хода', async () => {
    const events = await collect({ threadId: 'ac1', message: '/mcp on' });
    const text = textOf(events);
    assert.match(text, /Подключено серверов: 1/, `текст ответа: ${text}`);
    assert.match(text, /инструментов: 1/);
    assert.equal(readThreadMcp(cwd, 'ac1'), true, 'флаг треда поднят');

    // Спецификации в кэше — с префиксом echo_server__ (дефис → _)
    const specs = getExternalSpecs(cwd);
    assert.deepEqual(specs.map((s) => s.name), ['echo_server__echo']);
    // chatToolDefs подхватывает внешние (порядок и allow — в tool-policy.test)
    const names = chatToolDefs(cwd, null, getExternalSpecs(cwd)).map((d) => d.name);
    assert.ok(names.includes('echo_server__echo'), 'внешний инструмент в chatToolDefs');
    // Вызов handler доходит до сервера (имя уходит без префикса)
    const echo = specs.find((s) => s.name === 'echo_server__echo');
    assert.equal(await echo.handler({ message: 'привет' }), 'привет');

    // Следующий ход: модель ВИДИТ внешний инструмент в tools wire-запроса
    const { llm, state } = fakeLlm();
    const turn2 = await collect({ threadId: 'ac1', message: 'скажи ок' }, { llm });
    assert.ok(state.tools !== null, 'LLM-запрос состоялся');
    assert.ok(
      state.tools.some((t) => t.name === 'echo_server__echo'),
      'внешний инструмент присутствует в tools следующего хода',
    );
    assert.ok(textOf(turn2).includes('ок'), 'ход завершился ответом модели');
  });

  it('повторный /mcp on в том же треде не дублирует refcount', async () => {
    await collect({ threadId: 'ac1b', message: '/mcp on' });
    assert.equal(externalChatMcpStatus(cwd).refcount, 1);
    const second = textOf(await collect({ threadId: 'ac1b', message: '/mcp on' }));
    assert.match(second, /уже подключены/);
    assert.equal(externalChatMcpStatus(cwd).refcount, 1, 'refcount не вырос');
  });
});

describe('VL-422 — /mcp off: refcount и закрытие (AC2)', () => {
  it('AC2: off при нулевом refcount закрывает клиенты и убирает инструменты', async () => {
    await collect({ threadId: 'ac2', message: '/mcp on' });
    const specsBefore = getExternalSpecs(cwd);
    assert.ok(specsBefore.length > 0);

    const events = await collect({ threadId: 'ac2', message: '/mcp off' });
    assert.match(textOf(events), /отключены/);
    assert.equal(externalChatMcpStatus(cwd), null, 'состояние удалено (refcount 0)');
    assert.deepEqual(getExternalSpecs(cwd), [], 'specs пусты');
    assert.equal(readThreadMcp(cwd, 'ac2'), false, 'флаг треда снят');
    assert.ok(
      !chatToolDefs(cwd, null, getExternalSpecs(cwd)).some((d) => d.name === 'echo_server__echo'),
      'chatToolDefs без внешних',
    );
    // Клиент реально закрыт: прежний spec отвечает отказом протокола
    const out = await specsBefore[0].handler({ message: 'x' });
    assert.match(out, /не выполнен/, `ожидался отказ закрытого клиента, получено: ${out}`);
  });

  it('off без предшествующего on — безобидный отказ, состояние не трогается', async () => {
    const events = await collect({ threadId: 'ac2b', message: '/mcp off' });
    assert.match(textOf(events), /не подключались/);
    assert.equal(externalChatMcpStatus(cwd), null);
    assert.equal(readThreadMcp(cwd, 'ac2b'), false);
  });
});

describe('VL-422 — refcount двух тредов (AC5)', () => {
  it('AC5: off в одном треде не разрывает соединение другого', async () => {
    await collect({ threadId: 'ac5a', message: '/mcp on' });
    await collect({ threadId: 'ac5b', message: '/mcp on' });
    assert.equal(externalChatMcpStatus(cwd).refcount, 2);

    await collect({ threadId: 'ac5a', message: '/mcp off' });
    const mid = externalChatMcpStatus(cwd);
    assert.ok(mid !== null, 'соединение второго треда живо');
    assert.equal(mid.refcount, 1);
    assert.ok(getExternalSpecs(cwd).length > 0, 'specs на месте');

    await collect({ threadId: 'ac5b', message: '/mcp off' });
    assert.equal(externalChatMcpStatus(cwd), null, 'последний off закрыл соединение');
  });

  it('AC5: остановка startWebServer закрывает все клиенты', async () => {
    const res = await connectExternalForChat(cwd);
    assert.ok(!('error' in res), 'подключились до старта сервера');
    const specs = getExternalSpecs(cwd);
    assert.ok(specs.length > 0);

    const server = startWebServer(cwd, 0, false);
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    await new Promise((resolve) => server.close(resolve));
    // Дренаж асинхронный: карта чистится синхронно при закрытии, а клиенты —
    // чуть позже; ждём фактического закрытия, а не только очистки map
    for (let i = 0; i < 100; i++) {
      const out = await specs[0].handler({ message: 'ping' });
      if (/не выполнен/.test(out)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const out = await specs[0].handler({ message: 'ping' });
    assert.match(out, /не выполнен/, 'клиенты закрыты вместе с сервером');
    assert.equal(externalChatMcpStatus(cwd), null);
  });
});

describe('VL-422 — /mcp status (AC3)', () => {
  it('AC3: показывает настроенные и подключённые серверы с числом инструментов', async () => {
    const before = textOf(await collect({ threadId: 'ac3', message: '/mcp status' }));
    assert.match(before, /Настроенные серверы \(1\)/, `текст: ${before}`);
    assert.match(before, /echo-server/, 'имя настроенного сервера из конфига');
    assert.match(before, /Подключение: не подключено/);
    assert.match(before, /В этом треде: не подключено/);

    await collect({ threadId: 'ac3', message: '/mcp on' });
    const after = textOf(await collect({ threadId: 'ac3', message: '/mcp status' }));
    assert.match(after, /подключено серверов 1, инструментов 1/);
    assert.match(after, /В этом треде: подключено/);
  });

  it('неизвестный аргумент → подсказка формата', async () => {
    const text = textOf(await collect({ threadId: 'ac3b', message: '/mcp banana' }));
    assert.match(text, /\/mcp on\|off\|status/);
  });
});

describe('VL-422 — проект без mcpServers (AC4)', () => {
  it('AC4: on отвечает «не настроены», ничего не спавнится, map пуст', async () => {
    const res = await connectExternalForChat(bare);
    assert.ok('error' in res, 'connectExternalForChat вернул ошибку');
    assert.ok(res.error.includes('внешние серверы не настроены'), res.error);
    assert.equal(externalChatMcpStatus(bare), null, 'в map ничего не записано');
    assert.deepEqual(getExternalSpecs(bare), []);

    // То же через команду — флаг треда НЕ поднимается
    const text = textOf(await collect({ threadId: 'ac4', message: '/mcp on' }, {}, bare));
    assert.ok(text.includes('внешние серверы не настроены'), `текст: ${text}`);
    assert.equal(readThreadMcp(bare, 'ac4'), false);
    assert.equal(externalChatMcpStatus(bare), null);
  });

  it('AC3: status в проекте без mcpServers — «не настроены», без ошибок', async () => {
    const text = textOf(await collect({ threadId: 'ac4b', message: '/mcp status' }, {}, bare));
    assert.match(text, /не настроены/);
    assert.match(text, /Подключение: не подключено/);
  });
});

describe('VL-422 — shutdownExternalChatMcp (AC5)', () => {
  it('дренаж закрывает все клиенты и чистит map', async () => {
    const res = await connectExternalForChat(cwd);
    assert.ok(!('error' in res));
    const specs = getExternalSpecs(cwd);
    assert.ok(specs.length > 0);

    await shutdownExternalChatMcp();
    assert.equal(externalChatMcpStatus(cwd), null);
    assert.deepEqual(getExternalSpecs(cwd), []);
    const out = await specs[0].handler({ message: 'y' });
    assert.match(out, /не выполнен/, 'клиенты реально закрыты');
  });
});

describe('VL-422 — классификация и реестр команд (AC6, AC7, AC8)', () => {
  it('AC6: внешний инструмент → write (fail-safe → Allow/Deny с always-allow)', () => {
    // Неизвестное имя внешнего сервера классификатору → write по природе;
    // компенсация — существующая allow-list «Always allow» по имени треда
    assert.equal(isWriteOperation('echo_server__echo'), true);
    assert.equal(isWriteOperation('some_server__navigate_page'), true);
  });

  it('AC7: /mcp описан в реестре и попадает в /help', () => {
    const cmd = findCommand('mcp');
    assert.ok(cmd !== null, '/mcp есть в CHAT_COMMANDS');
    assert.equal(cmd.usage, '/mcp on|off|status');
    assert.ok(cmd.description.includes('mcpServers'));
    assert.ok(helpText().includes('/mcp on|off|status'), 'helpText собирается из реестра');
    // Метаданные сериализуются в GET /api/chat/commands (без обработчиков)
    assert.ok(CHAT_COMMANDS.some((c) => c.name === 'mcp'));
  });
});
