/**
 * Тесты трейлера Co-authored-by (VL-302).
 *
 * Проверяем чистую склейку сообщения (пустая строка + трейлер, идемпотентность,
 * выключение) и резолв настройки `commit_coauthor` из `.vibelog/settings.json`
 * (дефолт — включено; выключает только явное false).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  COMMIT_TRAILER,
  appendCommitTrailer,
  commitMessageArgs,
  resolveCommitCoauthor,
} from '../../dist/core/commit-trailer.js';

const roots = [];

/** Временный каталог проекта с необязательным settings.json. */
function makeRoot(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'vibelog-commit-trailer-'));
  roots.push(dir);
  if (settings !== undefined) {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(dir, '.vibelog', 'settings.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings),
      'utf-8',
    );
  }
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('appendCommitTrailer', () => {
  it('добавляет пустую строку и трейлер', () => {
    assert.equal(
      appendCommitTrailer('feat: VL-1 — суть', true),
      `feat: VL-1 — суть\n\n${COMMIT_TRAILER}`,
    );
  });

  it('выключенная настройка — сообщение без изменений', () => {
    assert.equal(appendCommitTrailer('feat: VL-1 — суть', false), 'feat: VL-1 — суть');
  });

  it('идемпотентен: повторный вызов не дублирует трейлер', () => {
    const once = appendCommitTrailer('feat: VL-1 — суть', true);
    assert.equal(appendCommitTrailer(once, true), once);
  });

  it('сохраняет тело коммита и срезает хвостовые переводы строк', () => {
    const msg = appendCommitTrailer('feat: тема\n\nтело коммита\n\n', true);
    assert.equal(msg, `feat: тема\n\nтело коммита\n\n${COMMIT_TRAILER}`);
  });
});

describe('resolveCommitCoauthor', () => {
  it('нет settings.json → включено (дефолт)', () => {
    assert.equal(resolveCommitCoauthor(makeRoot()), true);
  });

  it('нет ключа → включено', () => {
    assert.equal(resolveCommitCoauthor(makeRoot({ chats: [] })), true);
  });

  it('явное false → выключено', () => {
    assert.equal(resolveCommitCoauthor(makeRoot({ commit_coauthor: false })), false);
  });

  it('мусор в значении (строка/число) → включено', () => {
    assert.equal(resolveCommitCoauthor(makeRoot({ commit_coauthor: 'no' })), true);
    assert.equal(resolveCommitCoauthor(makeRoot({ commit_coauthor: 0 })), true);
  });

  it('битый JSON → включено (настройка не роняет чтение)', () => {
    assert.equal(resolveCommitCoauthor(makeRoot('{ битый json')), true);
  });
});

describe('commitMessageArgs', () => {
  it('аргументы git commit содержат трейлер при включённой настройке', () => {
    const args = commitMessageArgs(makeRoot(), 'docs(task): VL-1 — token_usage (close)');
    assert.deepEqual(args, ['-m', `docs(task): VL-1 — token_usage (close)\n\n${COMMIT_TRAILER}`]);
  });

  it('аргументы без трейлера при commit_coauthor: false', () => {
    const args = commitMessageArgs(makeRoot({ commit_coauthor: false }), 'feat: VL-1');
    assert.deepEqual(args, ['-m', 'feat: VL-1']);
  });
});
