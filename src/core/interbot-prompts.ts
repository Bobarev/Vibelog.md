/**
 * Шаблоны промптов interbot-связи (VL-438): markdown-файлы вместо хардкода.
 *
 * Паттерн промптов персон (src/web/personas.ts): проектное переопределение
 * `.vibelog/prompts/interbot/<name>.md` → встроенный шаблон пакета
 * `templates/prompts/interbot/<name>.md` → встроенная строка-фолбэк
 * (сломанная установка не роняет бота). Чтение на КАЖДЫЙ вызов
 * (buildIncomingPrompt/runGate) — настройка применяется горячо, без
 * перезапуска бота.
 *
 * Отдельный модуль (не core/prompts.ts — там резолв промптов экспериментов,
 * VL-296): имена не конфликтуют, но домены разные.
 *
 * Плейсхолдеры шаблона:
 * - `{channel}` — label (или id) канала;
 * - `{author}`, `{kind}` — автор и тип (бот/человек) для гейта;
 * - `{text}` — вопрос/текст сообщения;
 * - `{quote}`, `{context}`, `{history}` — опциональные секции на ОТДЕЛЬНОЙ
 *   строке: пустая секция → строка-плейсхолдер удаляется целиком (заголовок
 *   секции входит в подстановку сервера, в файле только каркас текста).
 *
 * Подстановка однопроходная (regex-колбэк): вставленное значение повторно
 * НЕ сканируется — текст вопроса может содержатьliteral '{...}'.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Имя промпта interbot: входящий ран либо гейт. */
export type InterbotPromptName = 'incoming' | 'gate';

/** Относительный путь проектного шаблона (для ответов API и подтверждений). */
export function interbotPromptRelPath(name: InterbotPromptName): string {
  return join('.vibelog', 'prompts', 'interbot', `${name}.md`);
}

/** Каталог встроенных шаблонов пакета (dist/core/interbot-prompts.js → ../../templates/...). */
const bundledPromptsDir = fileURLToPath(
  new URL('../../templates/prompts/interbot/', import.meta.url),
);

/**
 * Встроенные шаблоны-фолбэки: точная копия templates/prompts/interbot/*.md.
 *
 * Дрейф файла и строки ловит тест (content-равенство) — иначе два источника
 * дефолта разъезжаются (lesson-208).
 */
export const INTERBOT_FALLBACK_TEMPLATES: Record<InterbotPromptName, string> = {
  incoming: [
    'Ты отвечаешь на вопрос другой бот-проект в Telegram-канале «{channel}».',
    'Отвечай кратко и по делу. Используй ТОЛЬКО чтение файлов backlog/ и docs/ этого проекта.',
    'НИКОГДА не читай и не цитируй .env, .vibelog/settings.json, .vibelog/comms.yaml, секреты, токены и чужие проекты.',
    'Если вопрос требует архитектурного решения — начни ответ с метки [DECISION] в первой строке.',
    'Если отвечать нечего — верни ровно <no_answer>. В группу при этом ничего не отправляется.',
    '{quote}',
    '{context}',
    '{history}',
    '',
    'Вопрос:',
    '{text}',
  ].join('\n'),
  gate: [
    'Ты — фильтр входящих сообщений interbot-канала другого проекта. Реши, есть ли в сообщении что-то, требующее НАШЕЙ реакции.',
    'Верни ТОЛЬКО одно слово: react — если есть что отвечать; read_only — если отвечать нечего (прочитал и молчишь).',
    'react: вопрос к нам; реплика в нашу ветку; обращение к человеку в нашем присутствии; приветствие человеку (разовая вежливость допустима).',
    'read_only: отчёт или ответ другого бота о том же; служебная ошибка или статус; пустая вежливость либо уже отвеченное сообщение.',
    '',
    'Автор: {author} ({kind}):',
    '{text}',
  ].join('\n'),
};

/**
 * Читает шаблон: проект → пакет → встроенная строка-фолбэк.
 *
 * @param cwd — каталог проекта; undefined → только пакетный шаблон
 *   (вызовы без cwd — юнит-тесты — получают дефолт пакета)
 */
export function loadInterbotPrompt(name: InterbotPromptName, cwd?: string): string {
  if (cwd !== undefined) {
    try {
      return readFileSync(join(cwd, interbotPromptRelPath(name)), 'utf8').trimEnd();
    } catch {
      // Проектного файла нет — падаем на пакетный шаблон
    }
  }
  try {
    return readFileSync(join(bundledPromptsDir, `${name}.md`), 'utf8').trimEnd();
  } catch {
    return INTERBOT_FALLBACK_TEMPLATES[name];
  }
}

/** Есть ли проектное переопределение шаблона (для ответа API «source»). */
export function hasProjectInterbotPrompt(cwd: string, name: InterbotPromptName): boolean {
  return existsSync(join(cwd, interbotPromptRelPath(name)));
}

/** Секции, чья пустая подстановка удаляет строку-плейсхолдер целиком. */
const OPTIONAL_SECTIONS = new Set(['quote', 'context', 'history']);

/**
 * Рендер шаблона: подстановка плейсхолдеров.
 *
 * - строка, целиком состоящая из `{quote|context|history}`: пустое значение →
 *   строка удаляется (в промпте не остаётся голой строки), непустое →
 *   вставляется как есть (заголовок секции входит в значение);
 * - строка, целиком `{text}`: вставляется сырой вопрос;
 * - прочие строки: однопроходная замена `{key}` колбэком — вставленные
 *   значения повторно НЕ сканируются.
 *
 * @param vars — значения плейсхолдеров; опциональные секции — пустая строка,
 *   когда блок не нужен
 */
export function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  const out: string[] = [];
  for (const line of template.replace(/\n+$/, '').split('\n')) {
    const whole = /^\{(\w+)\}$/.exec(line.trim());
    if (whole !== null) {
      const key = whole[1]!;
      const value = vars[key] ?? '';
      if (value === '') {
        if (OPTIONAL_SECTIONS.has(key)) continue; // пустая секция → строка уходит
        out.push('');
        continue;
      }
      out.push(...value.split('\n'));
      continue;
    }
    out.push(line.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? vars[key]! : m)));
  }
  return out.join('\n');
}
