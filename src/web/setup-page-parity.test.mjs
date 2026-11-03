/**
 * Тесты паритета веб-мастера `#/setup` с CLI-wizard-ом (VL-328).
 *
 * Почему статические: в проекте нет рендер-тестов React (проверять нечего —
 * ни @testing-library, ни jsdom), а регрессия здесь — это возврат формы к
 * сырым текстовым полям и устаревшим дефолтам, то есть к ТЕКСТУ исходника.
 * Поведение API проверяется в src/web/setup-api.test.mjs, здесь — что UI
 * действительно использует общее ядро и показывает нужные элементы.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const setupDir = join(here, '../../web/src/components/setup');

const page = readFileSync(join(setupDir, 'setup-page.tsx'), 'utf8');
const api = readFileSync(join(setupDir, 'api.ts'), 'utf8');

/** Убирает блочные и строчные комментарии: контракт — код, а не пояснения. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const pageCode = stripComments(page);
const apiCode = stripComments(api);

describe('VL-328 — веб-мастер #/setup', () => {
  it('AC1: шлюз выбирается из пресетов сервера, а не вводится текстом', () => {
    // Список шлюзов приходит из GET /api/setup (ядро core/llm-presets.ts)
    assert.match(apiCode, /gatewayPresets/);
    assert.match(pageCode, /state\.gatewayPresets/);
    assert.match(pageCode, /onValueChange=\{choosePreset\}/);
    // Старые сырые поля «Провайдер (id)» и «base_url» на месте только для
    // custom-шлюза, где base_url действительно вводит пользователь
    assert.ok(
      !pageCode.includes('Провайдер (id)'),
      'поле «Провайдер (id)» должно быть заменено выбором пресета',
    );
    assert.match(pageCode, /isCustomGateway/, 'base_url спрашиваем только у custom');
  });

  it('AC2: api_key_env подставляется по шлюзу и остаётся редактируемым', () => {
    assert.match(pageCode, /preset\.api_key_env/);
    assert.match(pageCode, /id="setup-key-env"/);
  });

  it('AC3: модель и вендор выбираются из каталога (двухступенчато)', () => {
    assert.match(apiCode, /fetchCatalogModels/);
    assert.match(apiCode, /fetchCatalogVendors/);
    assert.match(pageCode, /fetchCatalogModels/);
    assert.match(pageCode, /fetchCatalogVendors/);
    // Двухступенчатый выбор: автор → модели автора
    assert.match(pageCode, /function authorOf/);
    assert.match(pageCode, /modelAuthors/);
    assert.match(pageCode, /authorModels/);
    // «Без вендора» — штатный вариант (поле vendor необязательно, VL-315)
    assert.match(pageCode, /без вендора/);
    // Ручной ввод остаётся на случай недоступного каталога (риск R2 VL-316)
    assert.match(pageCode, /Ввести вручную/);
    // Обрезка по CATALOG_SEARCH_LIMIT не должна применяться в мастере
    assert.ok(!pageCode.includes('CATALOG_SEARCH_LIMIT'), 'мастер не режет список моделей');
  });

  it('AC4: дефолт api_mode — responses', () => {
    assert.match(pageCode, /apiMode: defaultModel\?\.api_mode \?\? "responses"/);
  });

  it('AC5: локации секретов берутся из сервера (два пункта)', () => {
    assert.match(apiCode, /secretsLocations/);
    assert.match(pageCode, /state\.secretsLocations/);
    // Legacy-пункты не должны вернуться в разметку
    assert.ok(!pageCode.includes('settings.json (секция env)'), 'settings-локация не предлагается');
    assert.ok(!pageCode.includes('Оба (.env + fallback'), 'both-локация не предлагается');
  });

  it('AC6: есть поле TELEGRAM_PROXY, пустое не отправляется', () => {
    assert.match(pageCode, /id="setup-bot-proxy"/);
    assert.match(pageCode, /botProxy/);
    // Прокси отправляется только непустым — пустой ключ в .env сломал бы grammY
    assert.match(pageCode, /proxy !== "" \? \{ proxy \}/);
    // GET отдаёт факт наличия прокси
    assert.match(apiCode, /proxySet: boolean/);
  });

  it('AC7: ключ вводится с маскировкой и подтверждением перезаписи', () => {
    assert.match(pageCode, /id="setup-key"[\s\S]{0,120}type="password"/);
    assert.match(pageCode, /secretsOverwrite/);
    assert.match(pageCode, /Перезаписать существующие секреты/);
    assert.match(apiCode, /secretsOverwrite\?: boolean/);
  });

  it('AC8: проверки идут после сохранения — с перечитыванием env на сервере', () => {
    // Кнопка «Проверить» после сохранения видит свежие ключи (серверный тест
    // setup-api.test.mjs), здесь фиксируем, что UI не шлёт ключ в проверки:
    // ping/check-bot берут секреты из окружения сервера, а не из тела запроса
    assert.match(pageCode, /pingLlm\(form\.modelId/);
    assert.match(pageCode, /checkBot\(form\.botToken/);
    assert.ok(
      !/pingLlm\([^)]*apiKey/.test(pageCode),
      'ключ не должен уходить в ping отдельным полем',
    );
    assert.ok(
      !/checkBot\([^)]*apiKey/.test(pageCode),
      'ключ не должен уходить в check-bot отдельным полем',
    );
  });
});