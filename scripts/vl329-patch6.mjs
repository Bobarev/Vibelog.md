// VL-329: правка тестов setup/setup-api/init-wizard под chats в .env.
import { readFileSync, writeFileSync } from 'node:fs';

const edits = [];
const add = (file, old, neu) => edits.push({ file, old, neu });

// --- src/core/setup.test.mjs ---
add(
  'src/core/setup.test.mjs',
  `        env: { TELEGRAM_BOT_TOKEN: 'x' },
        chats: [1, 2],
      }),`,
  `      }),`,
);
add(
  'src/core/setup.test.mjs',
  `    const state = readSetupState(testDir);
    assert.equal(state.mode, 'upgrade');`,
  `    // VL-329: чаты и токен читаются из .env, а не из settings.json
    writeFileSync(
      join(testDir, '.env'),
      'TELEGRAM_BOT_TOKEN=x\\nTELEGRAM_CHAT_IDS=1, 2\\n',
      'utf-8',
    );

    const state = readSetupState(testDir);
    assert.equal(state.mode, 'upgrade');`,
);

// --- src/web/setup-api.test.mjs ---
add(
  'src/web/setup-api.test.mjs',
  `    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_BOT_TOKEN=bot-secret-token'), env);
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.deepEqual(settings.chats, [42]);`,
  `    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_BOT_TOKEN=bot-secret-token'), env);
    // VL-329: chat_id — личная привязка, пишется в .env (TELEGRAM_CHAT_IDS)
    assert.ok(env.includes('TELEGRAM_CHAT_IDS=42'), env);
    const settingsRaw = readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8');
    assert.ok(!settingsRaw.includes('chats'), 'chats не попадают в settings.json');
    assert.ok(!settingsRaw.includes('bot-secret-token'), 'секретов в settings.json нет');`,
);
add(
  'src/web/setup-api.test.mjs',
  `  it('AC5: legacy-локации settings/both по-прежнему принимаются API', () => {
    for (const loc of ['settings', 'both']) {
      fresh();
      const res = handleSetupApi('POST', '/api/setup', body({ secretsLocation: loc }), testDir);
      assert.equal(res.status, 200, \`\${loc}: \${JSON.stringify(res.body)}\`);
    }
  });`,
  `  it('VL-329: legacy-локации settings/both отвергаются (секция env удалена)', () => {
    for (const loc of ['settings', 'both']) {
      fresh();
      const res = handleSetupApi('POST', '/api/setup', body({ secretsLocation: loc }), testDir);
      assert.equal(res.status, 400, \`\${loc}: \${JSON.stringify(res.body)}\`);
      assert.ok(res.body.error.includes('secretsLocation'), res.body.error);
    }
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
