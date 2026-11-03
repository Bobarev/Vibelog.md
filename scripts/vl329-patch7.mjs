// VL-329: тесты init-wizard — локация settings больше не поддерживается.
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'src/cli/init-wizard.test.mjs';
let s = readFileSync(p, 'utf-8');

const a = `  it('init --secrets-location settings --bot-token пишет env-секцию settings.json', () => {
    runCli(
      'init', 'Secrets', '--prefix', 'sc', '--yes',
      '--agents', '', '--secrets-location', 'settings',
      '--bot-token', '123:abc', '--skip-bot-check',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.TELEGRAM_BOT_TOKEN, '123:abc');
    assert.ok(!existsSync(join(testDir, '.env')), '.env не создаётся в режиме settings');
  });`;
const aNew = `  it('VL-329: --secrets-location settings отвергается с понятной ошибкой', () => {
    const out = runCli(
      'init', 'Secrets', '--prefix', 'sc', '--yes',
      '--agents', '', '--secrets-location', 'settings',
      '--bot-token', '123:abc', '--skip-bot-check',
    );
    // Секция env в settings.json удалена: значения пишутся только в .env
    assert.ok(out.includes('больше не поддерживается'), out);
    // Никаких секретов в settings.json и никакого файла .env не создаётся
    const settingsPath2 = join(testDir, '.vibelog', 'settings.json');
    if (existsSync(settingsPath2)) {
      const settings = JSON.parse(readFileSync(settingsPath2, 'utf-8'));
      assert.equal(settings.env, undefined, 'секция env не пишется');
    }
    assert.ok(!existsSync(join(testDir, '.env')), '.env не создаётся при отказе');
  });`;

const b = `  it('VL-327: флаг --secrets-location settings по-прежнему работает (старые проекты)', () => {
    runCli(
      'init', 'Legacy', '--prefix', 'lg', '--yes',
      '--agents', '', '--secrets-location', 'settings',
      '--bot-token', '7:q', '--skip-bot-check',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.TELEGRAM_BOT_TOKEN, '7:q');
  });`;
const bNew = `  it('VL-327/329: --secrets-location both тоже отвергается (секция env удалена)', () => {
    const out = runCli(
      'init', 'Legacy', '--prefix', 'lg', '--yes',
      '--agents', '', '--secrets-location', 'both',
      '--bot-token', '7:q', '--skip-bot-check',
    );
    assert.ok(out.includes('больше не поддерживается'), out);
  });`;

let failed = 0;
for (const [oldS, newS] of [[a, aNew], [b, bNew]]) {
  if (!s.includes(oldS)) {
    console.error('ЯКОРЬ НЕ НАЙДЕН:', oldS.slice(0, 60));
    failed++;
    continue;
  }
  s = s.replace(oldS, newS);
}
writeFileSync(p, s, 'utf-8');
console.log(`применено: ${2 - failed} из 2`);
if (failed > 0) process.exitCode = 1;
