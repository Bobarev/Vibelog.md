/**
 * Тесты VL-427 — команда `vb up`: веб и бот в одном процессе.
 *
 * Контракты процесса (AC1/AC3) проверяются spawn'ом настоящего CLI
 * в tmp-проекте: без токена сервер поднимается и отвечает, ошибка токена
 * в stderr, процесс жив до kill; занятый порт — ошибка веба печатается,
 * бот-часть всё равно стартует, ни одна часть не роняет другую.
 *
 * Маркеры режима (VIBELOG_UP / VIBELOG_UP_PORT) и реестр команд —
 * чистые тесты с явными env-объектами (паттерн VL-140: без глобальных
 * мутаций process.env при fileParallelism).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { route } from '../../dist/cli/router.js';
import { CLI_COMMANDS } from '../../dist/cli/command-registry.js';
import { STARTUP_NOTIFY_COMMANDS } from '../../dist/cli/update-check.js';
import { upWebReply } from '../../dist/bot/web.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

/** Ожидание условия по накопленному выводу дочернего процесса. */
async function waitFor(cond, what, child, getOut, ms = 20_000) {
  const start = Date.now();
  while (!cond()) {
    if (child.exitCode !== null) break;
    if (Date.now() - start > ms) {
      throw new Error(`Таймаут ожидания: ${what}\n${getOut()}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Спавн `vb up` в tmp-проекте с чистым env (без токена и фазового env). */
function spawnUp(cwd, extraArgs = []) {
  const env = testSpawnEnv();
  delete env.TELEGRAM_BOT_TOKEN;
  const child = spawn(process.execPath, [cliPath, 'up', '--no-open', ...extraArgs], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, getOut: () => out };
}

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-up-'));

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-427: vb up — один процесс (AC1, AC3)', () => {
  it('без токена: сервер поднимается и отвечает, ошибка токена в stderr, процесс жив', async () => {
    const proj = join(testRoot, 'no-token');
    mkdirSync(proj, { recursive: true });
    const { child, getOut } = spawnUp(proj, ['--port', '0']);
    try {
      // URL веба печатается до старта бота (порядок из плана), ошибка токена — сразу после
      await waitFor(
        () => /Веб-интерфейс Vibelog\.md: http:\/\/127\.0\.0\.1:\d+/.test(getOut())
          && /Токен Telegram-бота не найден/.test(getOut()),
        'URL веба + ошибка токена', child, getOut
      );
      const port = /Веб-интерфейс Vibelog\.md: http:\/\/127\.0\.0\.1:(\d+)/.exec(getOut())[1];
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert.ok(res.status === 200 || res.status === 404, `ответ сервера: ${res.status}`);
      // итог: бот упал, веб объявлен работающим (runUp печатает после runBot)
      assert.match(getOut(), /Веб-интерфейс работает на http:\/\/127\.0\.0\.1:\d+; бот не запущен/);
      // процесс жив — event loop держит сервер (не завершился сам)
      assert.equal(child.exitCode, null, `процесс не должен был завершиться: ${getOut()}`);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  });

  it('занятый порт: ошибка веба печатается, бот-часть стартует (AC3)', async () => {
    const proj = join(testRoot, 'busy-port');
    mkdirSync(proj, { recursive: true });
    // Занимаем эфемерный порт мок-сервером и не закрываем до конца теста
    const blocker = createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const busyPort = blocker.address().port;
    const { child, getOut } = spawnUp(proj, ['--port', String(busyPort)]);
    try {
      await waitFor(
        () => /уже занят/.test(getOut()) && /Токен Telegram-бота не найден/.test(getOut()),
        'ошибка порта + старт бота', child, getOut
      );
      // обе части отработали сбой независимо: нет process.exit веба (режим up)
      assert.match(getOut(), /Веб-интерфейс не поднялся — команда продолжает работу/);
      assert.match(getOut(), /Бот не запущен, веб-интерфейс не поднялся/);
      // выход возможен только после того, как обе части отчитались
      await new Promise((r) => child.once('exit', r));
      assert.equal(child.exitCode, 1, `ожидался exit 1: ${getOut()}`);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => { if (child.exitCode !== null) r(); else child.once('exit', r); });
      await new Promise((r) => blocker.close(r));
    }
  });
});

describe('VL-427: маркеры режима для /web (AC5)', () => {
  it('без маркера → null (спавн дочернего browser не блокируется)', () => {
    assert.equal(upWebReply('start', '/tmp/x', {}), null);
    assert.equal(upWebReply('stop', '/tmp/x', {}), null);
  });

  it('VIBELOG_UP=1: start → «уже запущен» с портом из VIBELOG_UP_PORT', () => {
    const reply = upWebReply('start', '/tmp/x', { VIBELOG_UP: '1', VIBELOG_UP_PORT: '4123' });
    assert.match(reply, /Веб уже запущен в этом процессе: http:\/\/127\.0\.0\.1:4123/);
  });

  it('VIBELOG_UP=1: stop → остановка только Ctrl+C', () => {
    const reply = upWebReply('stop', '/tmp/x', { VIBELOG_UP: '1' });
    assert.match(reply, /Ctrl\+C/);
    assert.match(reply, /режиме vb up/);
  });

  it('VIBELOG_UP_PORT битый → фолбэк на дефолт (3030 без конфига)', () => {
    const reply = upWebReply('start', join(testRoot, 'no-config'), { VIBELOG_UP: '1', VIBELOG_UP_PORT: 'abc' });
    assert.match(reply, /http:\/\/127\.0\.0\.1:3030/);
  });
});

describe('VL-427: реестр, роутер и update-check (AC7)', () => {
  it("'up' есть в CLI_COMMANDS и в STARTUP_NOTIFY_COMMANDS", () => {
    assert.ok(CLI_COMMANDS.some((c) => c.name === 'up'), 'нет записи в реестре');
    assert.ok(STARTUP_NOTIFY_COMMANDS.includes('up'), 'нет в STARTUP_NOTIFY_COMMANDS');
  });

  it('route(["up", "--help"]) печатает справку команды', async () => {
    const chunks = [];
    const orig = console.log;
    console.log = (...a) => { chunks.push(a.join(' ')); };
    try {
      await route(['up', '--help']);
    } finally {
      console.log = orig;
    }
    const out = chunks.join('\n');
    assert.match(out, /vibelog up/i);
    assert.match(out, /в ОДНОМ процессе/);
  });
});

describe('VL-427: инвариант общего activeRuns (AC4)', () => {
  it('комментарий-инвариант зафиксирован в src/cli/commands/up.ts', () => {
    // Активировать ран из бота в юнит-тесте CLI непропорционально (по плану):
    // инвариант фиксируется текстом в коде, ручная проверка — в инструкции AC
    const src = readFileSync(join(__dirname, '..', 'cli', 'commands', 'up.ts'), 'utf8');
    assert.match(src, /INVARIANT AC4.*activeRuns/s, 'инвариант AC4 отсутствует в up.ts');
  });
});
