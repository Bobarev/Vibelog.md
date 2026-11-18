/**
 * Тесты VL-329 — `.env` как единственный источник секретов и привязок чатов:
 * upsertDotEnv (атомарная точечная запись), parseChatIds, readBotChats и
 * git-политика `.vibelog/` (check-ignore).
 *
 * Каталоги — только mkdtemp (AGENTS.md): фиксированные пути ломаются при
 * параллельных прогонах в разных worktree.
 */

import { describe, it, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { upsertDotEnv, parseChatIds } from '../../dist/core/env-file.js';
import { readBotChats, loadProjectEnv } from '../../dist/bot/env.js';

const root = mkdtempSync(join(tmpdir(), 'vibelog-envfile-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('upsertDotEnv (VL-329)', () => {
  it('вставляет новую строку в конец, сохраняя комментарии и прочие ключи', () => {
    const dir = join(root, 'insert');
    mkdirSync(dir, { recursive: true });
    const original = '# шапка\nOTHER=1\n\n# комментарий в конце\n';
    writeFileSync(join(dir, '.env'), original, 'utf-8');

    const changed = upsertDotEnv(dir, 'TELEGRAM_CHAT_IDS', '1,2');
    assert.equal(changed, true);
    const content = readFileSync(join(dir, '.env'), 'utf-8');
    assert.ok(content.startsWith('# шапка\nOTHER=1\n'), content);
    assert.ok(content.includes('# комментарий в конце'), content);
    assert.ok(content.includes('TELEGRAM_CHAT_IDS=1,2'), content);
    // process.env обновлён — боту не нужен перезапуск
    assert.equal(process.env.TELEGRAM_CHAT_IDS, '1,2');
    delete process.env.TELEGRAM_CHAT_IDS;
  });

  it('заменяет существующую строку и сохраняет `export`-префикс', () => {
    const dir = join(root, 'replace');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '.env'),
      'export TELEGRAM_CHAT_IDS=old\nKEEP=me\n',
      'utf-8',
    );
    assert.equal(upsertDotEnv(dir, 'TELEGRAM_CHAT_IDS', '7,8', { overwrite: true }), true);
    const content = readFileSync(join(dir, '.env'), 'utf-8');
    assert.ok(content.includes('export TELEGRAM_CHAT_IDS=7,8'), content);
    assert.ok(content.includes('KEEP=me'), content);
    assert.equal(content.split('TELEGRAM_CHAT_IDS').length - 1, 1, 'ключ не дублируется');
    delete process.env.TELEGRAM_CHAT_IDS;
  });

  it('без overwrite существующий ключ не меняется (значение пользователя цело)', () => {
    const dir = join(root, 'no-overwrite');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), 'TELEGRAM_CHAT_IDS=keep\n', 'utf-8');
    assert.equal(upsertDotEnv(dir, 'TELEGRAM_CHAT_IDS', '1'), false);
    assert.equal(readFileSync(join(dir, '.env'), 'utf-8'), 'TELEGRAM_CHAT_IDS=keep\n');
    delete process.env.TELEGRAM_CHAT_IDS;
  });

  it('значение со спецсимволами оборачивается в кавычки, файл читается обратно', () => {
    const dir = join(root, 'quotes');
    mkdirSync(dir, { recursive: true });
    upsertDotEnv(dir, 'PROXY_URL', 'socks5://127.0.0.1:1080');
    upsertDotEnv(dir, 'WITH_HASH', 'a#b');
    const content = readFileSync(join(dir, '.env'), 'utf-8');
    assert.ok(content.includes('WITH_HASH="a#b"'), content);
    delete process.env.PROXY_URL;
    delete process.env.WITH_HASH;
  });

  it('создаёт .env, если файла нет; временный файл не остаётся', () => {
    const dir = join(root, 'create');
    mkdirSync(dir, { recursive: true });
    upsertDotEnv(dir, 'A', '1');
    assert.ok(existsSync(join(dir, '.env')));
    assert.ok(!existsSync(join(dir, '.env.vibelog-tmp')), 'temp-файл убран rename-ом');
    delete process.env.A;
  });
});

describe('parseChatIds / readBotChats (VL-329)', () => {
  // VL-429: изоляция от host-машины — readBotChats (VL-428) сначала читает
  // comms.yaml из process.cwd(): локальный comms реального проекта (чаты
  // перенесены при ручном тесте VL-428) утекал в тест. cwd → пустой tmp без
  // .vibelog, comms-ветка возвращает [] и тест проверяет .env-логику
  const origCwd = process.cwd;
  beforeEach(() => {
    process.cwd = () => root;
  });
  afterEach(() => {
    process.cwd = origCwd;
  });

  it('parseChatIds: пробелы, мусор и дубли', () => {
    assert.deepEqual(parseChatIds('1, 2 ,3'), [1, 2, 3]);
    assert.deepEqual(parseChatIds('1,мусор,2'), [1, 2]);
    assert.deepEqual(parseChatIds('5,5,6'), [5, 6]);
    // 0 и дробные — мусор; отрицательные валидны: так выглядят id групп
    assert.deepEqual(parseChatIds('0,1.5'), []);
    assert.deepEqual(parseChatIds('-1001234567890'), [-1001234567890]);
    assert.deepEqual(parseChatIds(undefined), []);
    assert.deepEqual(parseChatIds('   '), []);
  });

  it('readBotChats: пусто / валидно / бито', () => {
    const saved = process.env.TELEGRAM_CHAT_IDS;
    try {
      delete process.env.TELEGRAM_CHAT_IDS;
      assert.deepEqual(readBotChats(), []);
      process.env.TELEGRAM_CHAT_IDS = '10, 20';
      assert.deepEqual(readBotChats(), [10, 20]);
      process.env.TELEGRAM_CHAT_IDS = 'abc';
      assert.deepEqual(readBotChats(), [], 'битое значение не роняет бота');
    } finally {
      if (saved === undefined) delete process.env.TELEGRAM_CHAT_IDS;
      else process.env.TELEGRAM_CHAT_IDS = saved;
    }
  });

  it('loadProjectEnv грузит chats из .env (а не из settings.json)', () => {
    const dir = join(root, 'loadenv');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.env'), 'TELEGRAM_CHAT_IDS=100,200\n', 'utf-8');
    writeFileSync(
      join(dir, '.vibelog', 'settings.json'),
      JSON.stringify({ chats: [999] }),
      'utf-8',
    );
    delete process.env.TELEGRAM_CHAT_IDS;
    loadProjectEnv(dir);
    assert.deepEqual(readBotChats(), [100, 200]);
    delete process.env.TELEGRAM_CHAT_IDS;
  });
});

describe('git-политика .vibelog/ (VL-329)', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /**
   * Набор игнорируемых путей по `git check-ignore -v`.
   *
   * Важная деталь: git печатает и совпадения по ОТРИЦАЮЩИМ правилам
   * (`!config.json`), где путь как раз НЕ игнорируется. Поэтому решает
   * не факт вывода, а сам паттерн: ведущий `!` → путь коммитится.
   */
  function checkIgnore(paths) {
    const res = spawnSync('git', ['check-ignore', '--no-index', '-v', ...paths], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    const ignored = new Set();
    for (const line of (res.stdout || '').split('\n')) {
      if (line.trim() === '') continue;
      const tab = line.lastIndexOf('\t');
      if (tab === -1) continue;
      const pattern = line.slice(0, tab).split(':').slice(2).join(':');
      if (pattern.startsWith('!')) continue;
      ignored.add(line.slice(tab + 1).trim());
    }
    return ignored;
  }

  it('конфигурация коммитится, локальные артефакты игнорируются', () => {
    const ignored = checkIgnore([
      '.vibelog/config.json',
      '.vibelog/installed.lock.json',
      '.vibelog/settings.json',
      '.vibelog/prompts/personas/x.md',
      '.vibelog/billing/VL-1.json',
      '.vibelog/agent-sessions/a.jsonl',
      '.vibelog/tmp/x',
      '.vibelog/idempotency.json',
    ]);
    for (const keep of [
      '.vibelog/config.json',
      '.vibelog/installed.lock.json',
      '.vibelog/settings.json',
      '.vibelog/prompts/personas/x.md',
      '.vibelog/billing/VL-1.json',
    ]) {
      assert.ok(!ignored.has(keep), `${keep} должен коммититься`);
    }
    for (const skip of [
      '.vibelog/agent-sessions/a.jsonl',
      '.vibelog/tmp/x',
      '.vibelog/idempotency.json',
    ]) {
      assert.ok(ignored.has(skip), `${skip} должен игнорироваться`);
    }
  });

  it('корневой .gitignore не игнорирует .vibelog/ целиком', () => {
    const rootIgnore = readFileSync(join(repoRoot, '.gitignore'), 'utf-8');
    const lines = rootIgnore.split('\n').map((l) => l.trim());
    assert.ok(!lines.includes('.vibelog/'), 'строка .vibelog/ удалена из корневого .gitignore');
    assert.ok(lines.includes('.env'), '.env остаётся заигноренным в корне');
  });
});
