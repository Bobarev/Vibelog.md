import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/web/chat.ts';
let src = readFileSync(path, 'utf-8');

// 1. appendDriftLog: журнал решений по цене (AC6/AC7)
const importAnchor = `import { createCallGuard, formatChatLimitsErrors, resolveChatLimits } from './chat-limits.js';`;
if (!src.includes(importAnchor)) throw new Error('import anchor not found');

const driftLogFn = `
/**
 * VL-317: дописывает строку в журнал решений по цене треда (AC6/AC7).
 *
 * Отдельный файл (\`<threadId>.pricing.log\`), а не jsonl истории: решения по
 * цене — диагностика для человека, они не должны попадать в контекст модели
 * (иначе каждый следующий ход «видел» бы старые предупреждения).
 */
export function appendDriftLog(cwd: string, threadId: string, text: string): void {
  try {
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, \`\${threadId}.pricing.log\`), \`\${new Date().toISOString()} \${text}\\n\`, 'utf-8');
  } catch {
    // Нет прав/диска — журнал не критичен: предупреждение уже ушло в ленту
  }
}
`;

// Ставим после блока импортов: перед первым \`/** SSE-событие чата\`
const sseAnchor = '/** SSE-событие чата (data-строка — JSON с полем type). */';
if (!src.includes(sseAnchor)) throw new Error('sse anchor not found');
src = src.replace(sseAnchor, `${driftLogFn}\n${sseAnchor}`);

// 2. hasMessage внутри produce: вычисляем из body.message
const produceAnchor = `  // --- роль (VL-283: фиксируется за тредом) ---------------------------------`;
if (!src.includes(produceAnchor)) throw new Error('produce anchor not found');
src = src.replace(
  produceAnchor,
  `  // VL-317: новый ход (не resume/continue) — точка сверки цены
  const hasMessage =
    typeof body.message === 'string' && (body.message as string).trim().length > 0;

${produceAnchor}`,
);

writeFileSync(path, src, 'utf-8');
console.log('chat.ts patched (appendDriftLog, hasMessage)');
