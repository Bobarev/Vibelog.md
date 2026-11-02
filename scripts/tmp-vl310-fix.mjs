/**
 * Временный патч VL-310: разнообразные аргументы read-вызова в регресс-тесте.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'src/agent/loop.test.mjs';
let s = readFileSync(p, 'utf-8');

const old = `      const name = i % 3 === 2 ? 'backlog_view_task' : 'document_update';
      script.push({ text: '', toolCalls: [{ id: \`c\${i + 1}\`, name, arguments: name === 'document_update' ? args : { id: 'VL-124' } }] });`;
const neu = `      const name = i % 3 === 2 ? 'backlog_view_task' : 'document_update';
      // Аргументы read-вызова разные: guard повторов (VL-284) иначе блокирует
      // серию чтений, и она перестаёт «разрывать» серию повторов.
      script.push({ text: '', toolCalls: [{ id: \`c\${i + 1}\`, name, arguments: name === 'document_update' ? args : { id: 'VL-124', n: i } }] });`;
if (!s.includes(old)) {
  console.error('anchor miss');
  process.exit(1);
}
s = s.replace(old, neu);
writeFileSync(p, s, 'utf-8');
console.log('ok');
