/**
 * Тесты VL-70 — самоперезапуск бота: spawn замещающего процесса и реестр.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vibelogCliPath, rootCliPath, spawnReplacementBot } from '../../dist/bot/restart.js';
import { loadDotEnv } from '../../dist/bot/env.js';
import { BOT_COMMANDS } from '../../dist/bot/registry.js';

describe('vibelogCliPath (VL-70)', () => {
  it('указывает на существующий bin/vibelog.mjs', () => {
    const p = vibelogCliPath();
    assert.match(p, /bin\/vibelog\.mjs$/);
    assert.ok(existsSync(p), `файл CLI не найден: ${p}`);
  });
});

describe('rootCliPath (VL-151): возврат в main после /restart VL-N', () => {
  it('строится от cwd, а не от import.meta.url текущего процесса', () => {
    // Симуляция бага VL-151: процесс живёт в worktree-dist, его
    // vibelogCliPath() указывает на worktree CLI. rootCliPath(tmp) при этом
    // обязан резолвиться от переданного cwd — пути не совпадают.
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-rootcli-'));
    try {
      const p = rootCliPath(cwd);
      assert.equal(p, join(cwd, 'bin', 'vibelog.mjs'));
      // cwd — tmp вне дерева процесса → rootCliPath и vibelogCliPath различны
      assert.notEqual(p, vibelogCliPath(), 'rootCliPath не должен зависеть от import.meta.url');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('корневой CLI от cwd проекта существует', () => {
    // Смоук: для реального корня проекта (src/bot/restart.test.mjs → ../..
    // после отбрасывания имени файла остаётся src/bot/) путь указывает на
    // существующий bin/vibelog.mjs
    const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
    const p = rootCliPath(projectRoot);
    assert.ok(existsSync(p), `файл CLI не найден: ${p}`);
  });
});

describe('spawnReplacementBot (VL-70)', () => {
  // Изоляция окружения (VL-140): TELEGRAM_BOT_TOKEN может быть задан глобально
  // на машине разработчика — дочерний процесс нашёл бы его в env и ушёл в
  // реальный long-polling: тест висел до таймаута и плодил живых ботов
  // (поймано 2026-10-03). Раньше — глобальный delete process.env (гонка при
  // fileParallelism); теперь — явный env-объект каждого спавна без токена.
  const spawnEnv = () => {
    const { TELEGRAM_BOT_TOKEN: _omit, ...env } = process.env;
    return env;
  };

  it('запускает новый vibelog bot; без токена — понятная ошибка в stderr', async () => {
    // tmp-каталог без .env/.vibelog: резолв токена падает — процесс бота
    // завершается с сообщением «Токен не найден» (fast-fail, без сети)
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-restart-'));
    const child = spawnReplacementBot(cwd, 'pipe', undefined, spawnEnv());
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (c) => resolve(c));
    });
    assert.match(stderr, /Токен Telegram-бота не найден/, `stderr: ${stderr}`);
    assert.equal(code, 0, `ожидался exit 0, получен: ${code}; stdout=${stdout}`);
  });

  it('процесс создаётся (событие spawn) — detached+unref не мешают старту', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-restart-'));
    const child = spawnReplacementBot(cwd, 'pipe', undefined, spawnEnv());
    const spawned = await new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(true));
      child.once('error', reject);
    });
    assert.equal(spawned, true);
  });
});

describe('фикс бага рестарта (VL-143): замещающий процесс без файловых ключей', () => {
  it('дефолтный env НЕ наследует ключи, записанные loadDotEnv', async () => {
    // Сценарий бага: родитель записал KEY из .env в process.env → дочерний
    // loadDotEnv по dotenv-семантике не перезаписывает унаследованное старое
    // значение → изменения .env не применяются никогда. Фикс: дефолтный env
    // замещающего процесса = process.env минус файловые ключи.
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-restart-strip-'));
    const KEY = 'VL143_RESTART_FILE_KEY';
    const saved = process.env[KEY];
    try {
      delete process.env[KEY];
      writeFileSync(join(cwd, '.env'), `${KEY}=from-file\n`, 'utf-8');
      loadDotEnv(cwd); // записывает KEY и регистрирует его как файловый
      assert.equal(process.env[KEY], 'from-file');

      // Заглушка вместо bin/vibelog.mjs: печатает env-ключ дочернего процесса
      const stub = join(cwd, 'stub-print-env.mjs');
      writeFileSync(
        stub,
        `console.log(process.env[${JSON.stringify(KEY)}] ?? 'UNSET');\n`,
        'utf-8'
      );

      // Без явного env → дефолтный env со стриппингом файловых ключей
      const child = spawnReplacementBot(cwd, 'pipe', stub);
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d; });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (c) => resolve(c));
      });
      assert.equal(code, 0, `заглушка завершилась с кодом: ${code}; stdout=${stdout}`);
      assert.equal(
        stdout.trim(),
        'UNSET',
        'дочерний процесс не должен унаследовать файловый ключ из .env'
      );
    } finally {
      if (saved === undefined) delete process.env[KEY];
      else process.env[KEY] = saved;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('shell-ключи (не файловые) наследуются дочерним процессом', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vibelog-restart-keep-'));
    const KEY = 'VL143_RESTART_SHELL_KEY';
    const saved = process.env[KEY];
    try {
      // Ключ задан в реальном окружении (не через loadDotEnv) — не файловый,
      // стриппингу не подлежит
      process.env[KEY] = 'from-shell';
      const stub = join(cwd, 'stub-print-env.mjs');
      writeFileSync(
        stub,
        `console.log(process.env[${JSON.stringify(KEY)}] ?? 'UNSET');\n`,
        'utf-8'
      );
      const child = spawnReplacementBot(cwd, 'pipe', stub);
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d; });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (c) => resolve(c));
      });
      assert.equal(code, 0, `заглушка завершилась с кодом: ${code}; stdout=${stdout}`);
      assert.equal(stdout.trim(), 'from-shell', 'shell-ключ должен наследоваться');
    } finally {
      if (saved === undefined) delete process.env[KEY];
      else process.env[KEY] = saved;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('реестр: команда restart (VL-70)', () => {
  it('команда restart в BOT_COMMANDS', () => {
    const cmd = BOT_COMMANDS.find((c) => c.command === 'restart');
    assert.ok(cmd, 'команда restart отсутствует в реестре');
    assert.match(cmd.description, /Перезапус/i);
  });
});
