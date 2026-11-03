/**
 * Единый источник пресетов LLM-шлюзов (VL-328).
 *
 * Зачем отдельный модуль: до VL-328 хардкод-список шлюзов жил только в
 * консольном wizard-е (`src/cli/commands/init-wizard.ts`, VL-324), а веб-мастер
 * `#/setup` спрашивал id и base_url сырыми текстовыми полями. Два фронта
 * неизбежно разъезжаются (AC9): пользователь в браузере видел другие варианты,
 * чем в терминале. Теперь перечень, вывод id шлюза из домена и вывод имени
 * env-переменной с ключом живут здесь, а CLI-wizard и веб-слой их импортируют.
 *
 * Семантика записи в settings.json не меняется: пресет — это подсказка
 * (`id`, `base_url`, `api_key_env`), а не отдельная сущность. Пользователь
 * может переопределить base_url/имя переменной, и это останется обычным
 * шлюзом в `gateways`.
 */

/** Описание хардкод-шлюза LLM (пресет визарда). */
export interface GatewayPreset {
  /** id в settings.gateways. */
  id: string;
  label: string;
  /** base_url пресета; у openai-совместимого пустой — спрашиваем у пользователя. */
  base_url?: string;
  /** Дефолтное имя env-переменной с ключом ('' — выводится из id). */
  api_key_env: string;
  /** true — модель/вендор вводит пользователь (Selectel, openai-совместимый). */
  manualModel?: boolean;
  /** true — можно загрузить каталог моделей шлюза (RouterAI). */
  catalog?: boolean;
}

/**
 * Хардкод-список шлюзов LLM (AC1, AC4 VL-324).
 *
 * Почему хардкод, а не ввод id текстом: пользователь (см. описание VL-324)
 * не знает id/base_url шлюза наизусть — три реально используемых варианта
 * покрывают практику, а кастомный base_url остаётся третьим пунктом.
 */
export const LLM_GATEWAY_PRESETS: GatewayPreset[] = [
  {
    id: 'routerai',
    label: 'RouterAI (агрегатор моделей)',
    base_url: 'https://routerai.ru/api/v1',
    api_key_env: 'ROUTERAI_API_KEY',
    catalog: true,
  },
  {
    id: 'selectel_router',
    label: 'Selectel ИИ-роутер',
    base_url: 'https://api.selectel.ru/aig/v1',
    api_key_env: 'SELECTEL_ROUTER_API_KEY',
    manualModel: true,
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-совместимый (свой base_url)',
    api_key_env: '',
    manualModel: true,
  },
];

/** id пресета «свой base_url» — для него id шлюза выводится из домена. */
export const CUSTOM_GATEWAY_PRESET_ID = 'openai_compatible';

/**
 * Находит пресет по id шлюза.
 *
 * @returns пресет либо undefined (шлюз настроен вручную/из settings.json)
 */
export function findGatewayPreset(id: string): GatewayPreset | undefined {
  return LLM_GATEWAY_PRESETS.find((p) => p.id === id);
}

/** Служебные поддомены, которые не являются брендом (api.example.ru → example_ru). */
const SERVICE_LABELS = new Set(['api', 'www', 'aig', 'v1', 'llm', 'gateway', 'openai']);

/**
 * Выводит id шлюза из домена base_url (AC1): `https://api.cloud.ru/aig/v1`
 * → `cloud_ru`.
 *
 * Берём имя домена без служебных меток (`api`, `www`, `aig` — это
 * поддомены-функции, а не бренд), склеиваем через `_` и чистим до
 * [a-z0-9_]. Так `api.cloud.ru` и `cloud.ru` дают один id.
 */
export function deriveGatewayId(baseUrl: string): string {
  let host = '';
  try {
    host = new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    // Не URL — попробуем вытащить домен регуляркой, чтобы не падать
    const m = /^(?:https?:\/\/)?([^/?#]+)/i.exec(baseUrl.trim());
    host = m ? m[1].toLowerCase() : '';
  }
  // Отрезаем порт: localhost:8080 → localhost (id не должен содержать ':')
  const noPort = host.includes(':') ? host.slice(0, host.indexOf(':')) : host;
  const parts = noPort
    .split('.')
    .filter((p) => p !== '')
    .filter((p) => !SERVICE_LABELS.has(p));
  // Последний элемент — доменная зона (ru/com/ai); «ru» сам по себе не
  // осмысленный id, но если ничего не осталось — используем, что есть
  const usable = parts.length > 0 ? parts : noPort.split('.').filter((p) => p !== '');
  const id = usable
    .join('_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return id || 'custom';
}

/**
 * Дефолтное имя env-переменной с ключом для произвольного шлюза (AC2).
 *
 * Для пресетов возвращает их `api_key_env` (RouterAI → ROUTERAI_API_KEY),
 * иначе `<ID_В_ВЕРХНЕМ_РЕГИСТРЕ>_API_KEY`.
 */
export function deriveApiKeyEnv(gatewayId: string): string {
  const preset = findGatewayPreset(gatewayId);
  if (preset && preset.api_key_env !== '') return preset.api_key_env;
  const upper = gatewayId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${upper || 'LLM'}_API_KEY`;
}