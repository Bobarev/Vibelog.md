/**
 * Тесты-инварианты страницы «Каналы» (VL-438, AC4/AC5).
 *
 * В web/ нет DOM-тестов (vitest гоняет только src/**), поэтому проверки —
 * по исходникам компонентов и роутера (паттерн personas-page-ui.test):
 * порядок маршрутов, пункт сайдбара, рендер в App, секции детальной
 * страницы, отсутствие редактирования секретов.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...parts) => readFileSync(join(...parts), 'utf8');

const hashRoute = read('web', 'src', 'lib', 'use-hash-route.ts');
const sidebar = read('web', 'src', 'components', 'layout', 'app-sidebar.tsx');
const app = read('web', 'src', 'App.tsx');
const listPage = read('web', 'src', 'components', 'channels', 'channels-page.tsx');
const detailPage = read('web', 'src', 'components', 'channels', 'channel-detail.tsx');
const clientApi = read('web', 'src', 'components', 'channels', 'api.ts');

describe('VL-438 AC4: роуты #/channels и #/channel/<id>', () => {
  it('Route union содержит channels и channel', () => {
    assert.match(hashRoute, /\|\s*'channels'/);
    assert.match(hashRoute, /\|\s*'channel'/);
  });

  it('список распознаётся точным совпадением ДО детального префикса', () => {
    const listIdx = hashRoute.indexOf("if (path === 'channels') return 'channels'");
    const detailIdx = hashRoute.indexOf("if (path.startsWith('channel/')) return 'channel'");
    assert.ok(listIdx > 0, 'нет точного маршрута channels');
    assert.ok(detailIdx > 0, 'нет префиксного маршрута channel/');
    assert.ok(listIdx < detailIdx, 'channels должен проверяться ДО channel/ (lesson-22)');
  });

  it('useChannelId парсит #/channel/<id>', () => {
    assert.match(hashRoute, /export function useChannelId\(/);
    assert.match(hashRoute, /#\\\/channel\\\/\(\[\^\/\]\+\)/);
  });

  it('пункт «Каналы» в сайдбаре в группе «Настройки»', () => {
    assert.match(sidebar, /id: "channels"/);
    assert.match(sidebar, /title: "Каналы"/);
    assert.match(sidebar, /url: "channels"/);
    assert.match(sidebar, /activeWhen: \["channels", "channel"\]/);
    // Пункт живёт в массиве subItems группы settings (Настройки)
    const settingsIdx = sidebar.indexOf('id: "settings"');
    const channelsIdx = sidebar.indexOf('id: "channels"');
    assert.ok(settingsIdx > 0 && channelsIdx > settingsIdx, 'пункт после группы settings');
  });

  it('App рендерит обе страницы по маршруту', () => {
    assert.match(app, /route === "channels" \? \(\s*<ChannelsPage \/>/);
    assert.match(app, /route === "channel" \? \(\s*<ChannelDetail id=\{channelId \?\? ""\} \/>/);
  });
});

describe('VL-438 AC4: список каналов', () => {
  it('колонки: id/label, group_id, addressing, approval, admin_chat, лимиты', () => {
    assert.match(listPage, /c\.label \|\| c\.id/);
    assert.match(listPage, /c\.id/);
    assert.match(listPage, /c\.group_id/);
    assert.match(listPage, /c\.addressing/);
    assert.match(listPage, /c\.approval/);
    assert.match(listPage, /c\.admin_chat/);
    assert.match(listPage, /переопределение/);
    assert.match(listPage, /default/); // бейдж default-канала
  });

  it('признак секретов: только статус «настроен», подсказка про comms.yaml', () => {
    assert.match(listPage, /secrets\.bot_token/);
    assert.match(listPage, /secrets\.proxy/);
    assert.match(listPage, /настроен/);
    assert.match(listPage, /\.vibelog\/comms\.yaml/);
  });

  it('клик по строке ведёт на детальную страницу', () => {
    assert.match(listPage, /#\/channel\/\$\{encodeURIComponent\(c\.id\)\}/);
  });

  it('секция глобальных параметров: sync_timeout, default_channel, лимиты', () => {
    assert.match(listPage, /sync_timeout_sec/);
    assert.match(listPage, /default_channel/);
    assert.match(listPage, /interbot_limits/);
    assert.match(listPage, /gate_timeout_sec/);
    assert.match(listPage, /updateSettings/);
  });
});

describe('VL-438 AC4/AC5: детальная страница', () => {
  it('секция «Лимиты и таймауты» с per-channel полями', () => {
    assert.match(detailPage, /Лимиты и таймауты/);
    for (const key of [
      'dedup_ttl_sec',
      'bot_rate_per_min',
      'human_rate_per_min',
      'global_runs_per_hour',
      'max_depth',
      'gate_timeout_sec',
    ]) {
      assert.ok(detailPage.includes(key), `нет поля ${key}`);
    }
    assert.match(detailPage, /handleSaveLimits|updateChannel\(id, \{ limits/);
  });

  it('секция «Промпты»: редактирование и сброс на дефолт', () => {
    assert.match(detailPage, /Промпты/);
    assert.match(detailPage, /savePrompt/);
    assert.match(detailPage, /resetPrompt/);
    assert.match(detailPage, /Сброс на дефолт/);
    assert.match(detailPage, /incoming/);
    assert.match(detailPage, /gate/);
  });

  it('секреты не редактируются: только статус + подсказка comms.yaml', () => {
    assert.match(detailPage, /secrets\.bot_token/);
    assert.match(detailPage, /правьте\s*<code>\.vibelog\/comms\.yaml<\/code> руками|редактирование секретов из UI\s*недоступно/i);
    // Нет полей ввода токена/прокси (Input рядом с bot_token/proxy в одном теге)
    assert.ok(!/<Input[^>]*(bot_token|proxy)/s.test(detailPage), 'нет ввода bot_token/proxy');
    assert.ok(!/type="password"/.test(detailPage), 'нет password-поля');
  });

  it('удаление default-канала: предупреждение и force только после confirm', () => {
    assert.match(detailPage, /is_default/);
    assert.match(detailPage, /default_channel/);
    assert.match(detailPage, /window\.confirm/);
    assert.match(detailPage, /deleteChannel\(id, true\)/); // force после confirm
  });
});

describe('VL-438 AC1: клиент API', () => {
  it('все endpoints', () => {
    for (const path of [
      '/api/comms/channels',
      '/api/comms/channels/${encodeURIComponent(id)}',
      '/api/comms/settings',
      '/api/comms/prompts',
    ]) {
      assert.ok(clientApi.includes(path), `нет пути ${path}`);
    }
    assert.match(clientApi, /method: "POST"/);
    assert.match(clientApi, /method: "PUT"/);
    assert.match(clientApi, /method: "DELETE"/);
  });

  it('интерфейс SecretFlags — только булевы флаги', () => {
    assert.match(clientApi, /interface SecretsFlags/);
    assert.match(clientApi, /bot_token: boolean/);
    assert.match(clientApi, /proxy: boolean/);
    assert.ok(!/bot_token: string/.test(clientApi), 'строки секретов в типах нет');
  });
});
