/**
 * Тесты единого источника пресетов LLM-шлюзов (VL-328, AC9).
 *
 * Модуль — общий для консольного wizard-а (`src/cli/commands/init-wizard.ts`) и
 * веб-мастера `#/setup` (`src/web/setup-api.ts`): дублирование перечня шлюзов
 * и правил вывода id/имени ключа как раз и было причиной расхождения фронтов.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  CUSTOM_GATEWAY_PRESET_ID,
  LLM_GATEWAY_PRESETS,
  deriveApiKeyEnv,
  deriveGatewayId,
  findGatewayPreset,
} from '../../dist/core/llm-presets.js';

describe('VL-328 — пресеты шлюзов LLM (ядро)', () => {
  it('AC1: содержит ровно три шлюза в порядке CLI-wizard-а', () => {
    assert.deepEqual(
      LLM_GATEWAY_PRESETS.map((p) => p.id),
      ['routerai', 'selectel_router', 'openai_compatible'],
    );
    const routerai = LLM_GATEWAY_PRESETS[0];
    assert.equal(routerai.base_url, 'https://routerai.ru/api/v1');
    assert.equal(routerai.api_key_env, 'ROUTERAI_API_KEY');
    assert.equal(routerai.catalog, true);
    const selectel = LLM_GATEWAY_PRESETS[1];
    assert.equal(selectel.base_url, 'https://api.selectel.ru/aig/v1');
    assert.equal(selectel.api_key_env, 'SELECTEL_ROUTER_API_KEY');
    // У «своего base_url» адреса нет — его вводит пользователь
    const custom = LLM_GATEWAY_PRESETS[2];
    assert.equal(custom.base_url, undefined);
    assert.equal(custom.api_key_env, '');
    assert.equal(CUSTOM_GATEWAY_PRESET_ID, custom.id);
  });

  it('AC1: findGatewayPreset находит пресет и возвращает undefined для ручного шлюза', () => {
    assert.equal(findGatewayPreset('routerai')?.id, 'routerai');
    assert.equal(findGatewayPreset('my_gateway'), undefined);
  });

  it('AC1: deriveGatewayId выводит id из домена и отбрасывает служебные метки', () => {
    assert.equal(deriveGatewayId('https://api.cloud.ru/aig/v1'), 'cloud_ru');
    assert.equal(deriveGatewayId('https://routerai.ru/api/v1'), 'routerai_ru');
    assert.equal(deriveGatewayId('http://localhost:8080/v1'), 'localhost');
    assert.equal(deriveGatewayId('https://api.example.com/v1'), 'example_com');
    assert.equal(deriveGatewayId('https://aig.selectel.ru/v1'), 'selectel_ru');
  });

  it('AC1: deriveGatewayId не падает на мусоре и на голом домене', () => {
    assert.ok(deriveGatewayId('не-url').length > 0);
    assert.equal(deriveGatewayId('api.cloud.ru'), 'cloud_ru');
    // Один служебный сегмент: осмысленного бренда нет, но id не должен быть
    // пустым — остаётся сам сегмент (поведение CLI-wizard-а VL-324 сохранено)
    assert.equal(deriveGatewayId('https://api/v1'), 'api');
    // Пустой ввод — fallback 'custom' (пустой id недопустим)
    assert.equal(deriveGatewayId(''), 'custom');
  });

  it('AC1: deriveGatewayId чистит спецсимволы из домена', () => {
    const id = deriveGatewayId('https://my-llm.host:8443/v1');
    assert.match(id, /^[a-z0-9_]+$/, `id должен быть slug-ом, получено: ${id}`);
    assert.ok(id.length > 0);
  });

  it('AC2: deriveApiKeyEnv берёт имя из пресета, иначе выводит из id', () => {
    assert.equal(deriveApiKeyEnv('routerai'), 'ROUTERAI_API_KEY');
    assert.equal(deriveApiKeyEnv('selectel_router'), 'SELECTEL_ROUTER_API_KEY');
    assert.equal(deriveApiKeyEnv('cloud_ru'), 'CLOUD_RU_API_KEY');
    assert.equal(deriveApiKeyEnv('my-gw.example'), 'MY_GW_EXAMPLE_API_KEY');
    // У custom пресета имя пустое — выводится из id шлюза
    assert.equal(deriveApiKeyEnv('openai_compatible'), 'OPENAI_COMPATIBLE_API_KEY');
    // Пустой id не даёт «_API_KEY» без префикса
    assert.equal(deriveApiKeyEnv(''), 'LLM_API_KEY');
  });
});