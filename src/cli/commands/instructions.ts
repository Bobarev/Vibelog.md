/**
 * Команда `vibelog instructions` — инструкции для AI-агентов.
 *
 * Выводит справочную информацию по использованию Vibelog.md
 * в контексте AI-агентов (Qwen Code).
 */

import { printInfo, printError } from '../ui.js';
import type { FlagValues } from '../args.js';

/**
 * Тексты инструкций для агентов (на русском).
 */
const INSTRUCTIONS: Record<string, string> = {
  overview: `# Vibelog.md — Инструкция для AI-агента (Qwen Code)

## Обзор
Vibelog.md — markdown-нативный таск-менеджер. Задачи хранятся как markdown-файлы
в папке backlog/tasks/.

## Основные команды

### Создание задачи
\`\`\`bash
vibelog task create "Заголовок" -d "Описание" --ac "Критерий 1" --ac "Критерий 2"
\`\`\`

### Список задач
\`\`\`bash
vibelog task list
vibelog task list -s "To Do"
\`\`\`

### Просмотр задачи
\`\`\`bash
vibelog task view <id>
\`\`\`

### Редактирование задачи
\`\`\`bash
vibelog task edit <id> --status "In Progress"
vibelog task edit <id> --ac "Новый критерий"
vibelog task edit <id> --check-ac 1
\`\`\`

### Завершение задачи
\`\`\`bash
vibelog task complete <id>
\`\`\`

### Доска задач
\`\`\`bash
vibelog board
\`\`\`

### Поиск
\`\`\`bash
vibelog search "текст"
\`\`\`

## Формат задачи
Задачи — markdown-файлы с YAML-фронтматтером.
AC: \`- [ ] #1 Текст критерия\`
DoD: \`- [ ] #1 Текст\` внутри \`<!-- DOD:BEGIN -->...<!-- DOD:END -->\`

## Workflow
1. Найти задачу: \`vibelog task list -s "To Do"\`
2. Начать работу: \`vibelog task edit <id> -s "In Progress"\`
3. Отмечать AC: \`vibelog task edit <id> --check-ac <номер>\`
4. Завершить: \`vibelog task complete <id>\`
`,

  'task-creation': `# Создание задач в Vibelog.md

## Формат команды
\`\`\`bash
vibelog task create "Заголовок" [опции]
\`\`\`

## Опции
- \`-d "Описание"\` — описание задачи
- \`--ac "Критерий"\` — критерий приёмки (повторяется)
- \`--dod "Критерий"\` — критерий DoD (повторяется)
- \`--priority High\` — приоритет
- \`--labels bug,feature\` — метки
- \`--deps task-1,task-2\` — зависимости
- \`--milestone v1.0\` — веха
- \`--due-date 2025-12-31\` — срок
- \`-a @user\` — исполнитель

## Пример
\`\`\`bash
vibelog task create "Добавить авторизацию" \\
  -d "Реализовать JWT-авторизацию" \\
  --ac "Токен создаётся при логине" \\
  --ac "Токен обновляется" \\
  --priority High \\
  --labels backend,security
\`\`\`
`,

  'task-execution': `# Выполнение задач в Vibelog.md

## Workflow
1. **Найти задачу**: \`vibelog task list -s "To Do"\`
2. **Взять в работу**: \`vibelog task edit <id> -s "In Progress"\`
3. **Выполнять работу**, отмечая AC по мере готовности:
   \`vibelog task edit <id> --check-ac 1\`
4. **Добавлять заметки**: \`vibelog task edit <id> --append-notes "Сделано X"\`
5. **Завершить**: \`vibelog task complete <id>\`

## Проверка зависимостей
\`\`\`bash
vibelog task list  # убедиться, что зависимости выполнены
\`\`\`
`,

  'task-finalization': `# Завершение задач в Vibelog.md

## Проверка перед завершением
1. Все AC отмечены: \`vibelog task view <id>\`
2. DoD выполнен
3. Код протестирован

## Завершение
\`\`\`bash
vibelog task complete <id>
\`\`\`

Эта команда:
- Меняет статус на "Done"
- Перемещает файл из backlog/tasks/ в backlog/completed/
`,
};

/**
 * Выполняет команду instructions.
 *
 * @param positional — [topic]
 */
export async function runInstructions(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const topic = positional[0] || 'overview';

  const text = INSTRUCTIONS[topic];
  if (!text) {
    printError(`Неизвестная тема: ${topic}`);
    printInfo(`Доступные темы: ${Object.keys(INSTRUCTIONS).join(', ')}`);
    return;
  }

  console.log(text);
}
