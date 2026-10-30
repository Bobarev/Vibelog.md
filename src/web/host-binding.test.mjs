/**
 * Тесты host-биндинга веб-сервера (VL-266).
 *
 * Модуль — чистые функции, поэтому тесты не поднимают сеть: адреса передаются
 * параметром (lanAddresses вызывается только там, где нужен реальный интерфейс
 * машины). Тесты по правилам AGENTS.md не используют фиксированные пути.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  DEFAULT_WEB_HOST,
  isWildcardHost,
  lanAddresses,
  resolveWebHost,
  startupLines,
  startupUrls,
} from '../../dist/web/host-binding.js';

describe('resolveWebHost (VL-266)', () => {
  it('без флага и без настройки — loopback по умолчанию', () => {
    assert.equal(DEFAULT_WEB_HOST, '127.0.0.1');
    assert.equal(resolveWebHost({}, {}), '127.0.0.1');
  });

  it('флаг приоритетнее настройки', () => {
    assert.equal(resolveWebHost({ host: '0.0.0.0' }, { web_host: '192.168.1.5' }), '0.0.0.0');
  });

  it('настройка web_host применяется без флага', () => {
    assert.equal(resolveWebHost({}, { web_host: '0.0.0.0' }), '0.0.0.0');
  });

  it('битые значения настройки игнорируются (не роняют запуск)', () => {
    assert.equal(resolveWebHost({}, { web_host: 42 }), '127.0.0.1');
    assert.equal(resolveWebHost({}, { web_host: '' }), '127.0.0.1');
    assert.equal(resolveWebHost({}, { web_host: '   ' }), '127.0.0.1');
    assert.equal(resolveWebHost({}, { web_host: null }), '127.0.0.1');
  });

  it('повтор флага --host a --host b — берётся первый', () => {
    assert.equal(resolveWebHost({ host: ['10.0.0.2', '0.0.0.0'] }, {}), '10.0.0.2');
  });

  it('значения обрезаются от пробелов', () => {
    assert.equal(resolveWebHost({ host: ' 0.0.0.0 ' }, {}), '0.0.0.0');
  });
});

describe('isWildcardHost (VL-266)', () => {
  it('0.0.0.0 / :: / пустая строка — wildcard', () => {
    assert.equal(isWildcardHost('0.0.0.0'), true);
    assert.equal(isWildcardHost('::'), true);
    assert.equal(isWildcardHost(''), true);
    assert.equal(isWildcardHost(' 0.0.0.0 '), true);
  });

  it('конкретные адреса — не wildcard', () => {
    assert.equal(isWildcardHost('127.0.0.1'), false);
    assert.equal(isWildcardHost('192.168.1.5'), false);
  });
});

describe('startupUrls (VL-266)', () => {
  it('wildcard: local — loopback, lan — все переданные адреса', () => {
    const { local, lan } = startupUrls('0.0.0.0', 3030, ['192.168.1.7', '10.0.0.2']);
    assert.equal(local, 'http://127.0.0.1:3030');
    assert.deepEqual(lan, ['http://192.168.1.7:3030', 'http://10.0.0.2:3030']);
  });

  it('loopback: LAN-строк нет', () => {
    const { local, lan } = startupUrls('127.0.0.1', 3030, ['192.168.1.7']);
    assert.equal(local, 'http://127.0.0.1:3030');
    assert.deepEqual(lan, []);
  });

  it('wildcard без адресов — не падаем, lan пуст', () => {
    const { local, lan } = startupUrls('::', 3030, []);
    assert.equal(local, 'http://127.0.0.1:3030');
    assert.deepEqual(lan, []);
  });

  it('конкретный адрес: local — он сам, lan пуст', () => {
    const { local, lan } = startupUrls('192.168.1.5', 3030, []);
    assert.equal(local, 'http://192.168.1.5:3030');
    assert.deepEqual(lan, []);
  });

  it('IPv6-литерал оборачивается в скобки', () => {
    const { local } = startupUrls('fe80::1', 3030, []);
    assert.equal(local, 'http://[fe80::1]:3030');
  });
});

describe('startupLines (VL-266)', () => {
  it('первая строка — прежний формат контракта бота (VL-161)', () => {
    const lines = startupLines('0.0.0.0', 3030, ['192.168.1.7']);
    assert.equal(lines[0], 'Веб-интерфейс Vibelog.md: http://127.0.0.1:3030');
    // регулярка парсера /web start бота не должна ловить LAN-строки как URL
    assert.match(lines[0], /Веб-интерфейс Vibelog\.md:\s*(\S+)/);
    assert.equal(lines.length, 2);
    assert.equal(lines[1], 'Доступ из локальной сети: http://192.168.1.7:3030');
  });

  it('без LAN-адресов — одна строка', () => {
    assert.deepEqual(startupLines('127.0.0.1', 6420, []), [
      'Веб-интерфейс Vibelog.md: http://127.0.0.1:6420',
    ]);
  });
});

describe('lanAddresses (VL-266)', () => {
  it('возвращает массив непустых не-loopback адресов', () => {
    const addrs = lanAddresses();
    assert.ok(Array.isArray(addrs));
    for (const a of addrs) {
      assert.equal(typeof a, 'string');
      assert.ok(a.length > 0);
      assert.notEqual(a, '127.0.0.1', 'internal-адреса отфильтрованы');
    }
    // дублей быть не должно
    assert.equal(new Set(addrs).size, addrs.length);
  });
});
