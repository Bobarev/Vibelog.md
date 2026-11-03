// VL-329: остаточные правки после typecheck.
import { readFileSync, writeFileSync } from 'node:fs';

const edits = [];
const add = (file, old, neu) => edits.push({ file, old, neu });

add(
  'src/bot/auto-runner.ts',
  `/** Уведомление во все привязанные чаты (loadBotSettings.chats). */
function notifyAllChats(bot: Bot, cwd: string, text: string): void {
  for (const chatId of loadBotSettings(cwd).chats) {`,
  `/** Уведомление во все привязанные чаты (VL-329: TELEGRAM_CHAT_IDS из .env). */
function notifyAllChats(bot: Bot, cwd: string, text: string): void {
  void cwd;
  for (const chatId of readBotChats()) {`,
);

add(
  'src/web/setup-api.ts',
  `  const proxy = typeof body?.proxy === 'string' && body.proxy !== ''
    ? body.proxy
    : process.env.TELEGRAM_PROXY ?? readSettingsEnv(cwd).TELEGRAM_PROXY ?? '';`,
  `  void cwd;
  const proxy = typeof body?.proxy === 'string' && body.proxy !== ''
    ? body.proxy
    : process.env.TELEGRAM_PROXY ?? '';`,
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
