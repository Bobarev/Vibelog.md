// VL-329: правка тестов под новую политику (секреты только .env, chats → .env).
import { readFileSync, writeFileSync } from 'node:fs';

const edits = [];
const add = (file, old, neu) => edits.push({ file, old, neu });

// --- src/core/settings.test.mjs ---
add(
  'src/core/settings.test.mjs',
  `import {
  settingsPath,
  loadSettings,
  saveSettingsPatch,
  migrateLegacyConfig,
  readSettingsEnv,
  applySettingsEnv,
} from '../../dist/core/settings.js';`,
  `import {
  settingsPath,
  loadSettings,
  saveSettingsPatch,
  migrateLegacyConfig,
  readSettingsEnv,
  detectLegacyEnvSection,
} from '../../dist/core/settings.js';`,
);
add(
  'src/core/settings.test.mjs',
  `  it('applySettingsEnv: заполняет пустые ключи, не затирает реальный env', () => {
    const dir = join(testRoot, 'applyenv');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ env: { VL143_A: 'from-settings', VL143_B: 'fill-me' } }),
      'utf-8'
    );
    process.env.VL143_A = 'from-real-env';
    delete process.env.VL143_B;
    try {
      const written = applySettingsEnv(dir);
      assert.equal(process.env.VL143_A, 'from-real-env', 'реальный env не должен затираться');
      assert.equal(process.env.VL143_B, 'fill-me');
      assert.deepEqual([...written], ['VL143_B']);
    } finally {
      delete process.env.VL143_A;
      delete process.env.VL143_B;
    }
  });`,
  `  it('VL-329: секция env в settings.json игнорируется, detectLegacyEnvSection её видит', () => {
    const dir = join(testRoot, 'legacy-env');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ env: { VL329_LEGACY: 'from-settings' } }),
      'utf-8'
    );
    delete process.env.VL329_LEGACY;
    try {
      // loadProjectEnv грузит только .env — ключ из секции env не появляется
      loadProjectEnv(dir);
      assert.equal(
        process.env.VL329_LEGACY,
        undefined,
        'секция env больше не попадает в process.env',
      );
      // Признак legacy-секции нужен для одноразового предупреждения при старте
      assert.equal(detectLegacyEnvSection(dir), true);
      assert.equal(detectLegacyEnvSection(join(testRoot, 'no-env')), false);
    } finally {
      delete process.env.VL329_LEGACY;
    }
  });`,
);
add(
  'src/core/settings.test.mjs',
  `import { join } from 'node:path';`,
  `import { join } from 'node:path';
import { loadProjectEnv } from '../../dist/bot/env.js';`,
);
// миграция: секреты теперь в .env, chats → TELEGRAM_CHAT_IDS
add(
  'src/core/settings.test.mjs',
  `  it('bot.yml + settings.yml → settings.json, секреты в env-секцию, legacy удалён', () => {`,
  `  it('bot.yml + settings.yml → settings.json, секреты и чаты в .env, legacy удалён', () => {`,
);
add(
  'src/core/settings.test.mjs',
  `    const raw = JSON.parse(readFileSync(settingsPath(dir), 'utf-8'));
    assert.deepEqual(raw.chats, [111, 222]);
    assert.equal(raw.default_agent, 'vb');
    assert.equal(raw.max_wall_time, 1800);
    assert.equal(raw.branch_mode, true);
    assert.deepEqual(raw.task_type_styles, { bug: 'success' });
    assert.equal(raw.git_user_name, 'Pavel');
    // Секреты — только в env-секции, на топ-уровне их больше нет
    assert.equal(raw.env.TELEGRAM_BOT_TOKEN, 'tok-abc');
    assert.equal(raw.env.TELEGRAM_PROXY, 'http://127.0.0.1:7070');
    assert.ok(!('telegram_token' in raw));
    assert.ok(!('telegram_proxy' in raw));`,
  `    const raw = JSON.parse(readFileSync(settingsPath(dir), 'utf-8'));
    assert.equal(raw.default_agent, 'vb');
    assert.equal(raw.max_wall_time, 1800);
    assert.equal(raw.branch_mode, true);
    assert.deepEqual(raw.task_type_styles, { bug: 'success' });
    assert.equal(raw.git_user_name, 'Pavel');
    // VL-329: секретов и чатов в settings.json больше нет — они в .env
    assert.ok(!('env' in raw), 'секция env не пишется');
    assert.ok(!('chats' in raw), 'chats не пишутся в settings.json');
    assert.ok(!('telegram_token' in raw));
    assert.ok(!('telegram_proxy' in raw));
    const env = readFileSync(join(dir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_BOT_TOKEN=tok-abc'), env);
    assert.ok(env.includes('TELEGRAM_PROXY=http://127.0.0.1:7070'), env);
    assert.ok(env.includes('TELEGRAM_CHAT_IDS=111,222'), env);`,
);
add(
  'src/core/settings.test.mjs',
  `  it('readSettings после миграции видит токен через resolve-секцию', () => {
    const dir = join(migRoot, 'tok');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'bot.yml'), 'telegram_token: secret\\n', 'utf-8');
    // loadSettings запускает ленивую миграцию сам
    loadSettings(dir);
    assert.equal(readSettingsEnv(dir).TELEGRAM_BOT_TOKEN, 'secret');
    assert.ok(!existsSync(join(dir, '.vibelog', 'bot.yml')));
  });`,
  `  it('после миграции токен лежит в .env, а не в settings.json', () => {
    const dir = join(migRoot, 'tok');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'bot.yml'), 'telegram_token: secret\\n', 'utf-8');
    // loadSettings запускает ленивую миграцию сам
    loadSettings(dir);
    assert.deepEqual(readSettingsEnv(dir), {}, 'секция env не создаётся');
    assert.ok(readFileSync(join(dir, '.env'), 'utf-8').includes('TELEGRAM_BOT_TOKEN=secret'));
    assert.ok(!existsSync(join(dir, '.vibelog', 'bot.yml')));
  });`,
);

let failed = 0;
for (const e of edits) {
  const src = readFileSync(e.file, 'utf-8');
  if (!src.includes(e.old)) {
    console.error(`ЯКОРЬ НЕ НАЙДЕН: ${e.file} :: ${e.old.slice(0, 70).replace(/\n/g, '\\n')}`);
    failed++;
    continue;
  }
  writeFileSync(e.file, src.replace(e.old, e.neu), 'utf-8');
}
console.log(`применено: ${edits.length - failed} из ${edits.length}`);
if (failed > 0) process.exitCode = 1;
