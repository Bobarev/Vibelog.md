# PLAN-01: Scaffold проекта

## Задача

Создать структуру проекта Vibelog.md, настроить `package.json`, pnpm, базовые файлы.

## Шаги

1. **Создать `package.json`:**

```json
{
  "name": "vibelog.md",
  "version": "0.1.0",
  "description": "Markdown-нативный таск-менеджер для git-репозиториев, совместимый с Backlog.md. Чистый Node.js, без нативных зависимостей.",
  "type": "module",
  "bin": {
    "vibelog": "./bin/vibelog.mjs"
  },
  "scripts": {
    "test": "node --test",
    "lint": "node --check bin/vibelog.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "packageManager": "pnpm@10.7.1",
  "license": "MIT",
  "private": true
}
```

2. **Создать `bin/vibelog.mjs`** — точка входа:

```javascript
#!/usr/bin/env node
/**
 * Точка входа CLI Vibelog.md.
 *
 * Задача: принять аргументы командной строки и передать их роутеру.
 * Роутер сам разберётся, какую команду выполнять.
 *
 * Ошибки ловим здесь, чтобы показать пользователю понятное сообщение
 * (а не стектрейс Node.js), и выйти с ненулевым кодом.
 */
import { route } from '../src/cli/router.mjs';

route(process.argv.slice(2)).catch(err => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
```

Сделать исполняемым: `chmod +x bin/vibelog.mjs`

3. **Создать пустые директории:**
   - `src/cli/commands/`
   - `src/core/`
   - `src/mcp/`
   - `src/web/`
   - `templates/`
   - `example-backlog/tasks/`

4. **Настроить pnpm:**
   ```bash
   pnpm install
   ```
   Убедиться, что `pnpm-lock.yaml` создан.

5. **Создать `README.md`** — краткое описание проекта на русском:
   - Что такое Vibelog.md
   - Зачем (Catalina + Qwen Code)
   - Установка (`pnpm install`, `pnpm link --global`)
   - Быстрый старт (`vibelog init`, `vibelog task create`, `vibelog board`, `vibelog browser`)
   - Совместимость с Backlog.md
   - Лицензия MIT

6. **Создать `.gitignore`:**
   ```
   node_modules/
   .DS_Store
   *.log
   ```

7. **Первый коммит:**
   ```bash
   git add -A
   git commit -m "chore: скаффолд проекта Vibelog.md"
   ```

## Acceptance Criteria

- [ ] `package.json` создан с `"name": "vibelog.md"`, `"type": "module"`, `bin`, `engines.node >= 20`, `packageManager: "pnpm@10.7.1"`
- [ ] `bin/vibelog.mjs` создан, исполняемый, импортирует `router.mjs`, с русскими комментариями
- [ ] Директории созданы
- [ ] `pnpm install` проходит без ошибок
- [ ] `README.md` создан на русском
- [ ] `.gitignore` создан
- [ ] Первый коммит сделан

## Definition of Done

- [ ] Все файлы на месте
- [ ] `pnpm install` работает
- [ ] `node bin/vibelog.mjs` запускается (даже если роутер — заглушка)
- [ ] Комментарии в коде — на русском