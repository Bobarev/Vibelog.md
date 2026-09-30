# PLAN-07: Тесты

## Задача

Покрыть ядро и CLI тестами.

## Фреймворк

Встроенный `node:test` + `node:assert`. Без внешних зависимостей.

```bash
pnpm test
```

## Файлы

- `src/core/yaml.test.mjs`
- `src/core/frontmatter.test.mjs`
- `src/core/task.test.mjs`
- `src/core/store.test.mjs`
- `src/core/deps.test.mjs`
- `src/core/search.test.mjs`
- `src/cli/commands/task.test.mjs`
- `src/mcp/server.test.mjs`

## Тесты совместимости

Отдельный файл `src/core/compat.test.mjs`:
- Читает реальные файлы из `/Users/bob/Dev/ton/ai/Backlog.md/backlog/tasks/`
- Проверяет, что все поля frontmatter распарсились
- Проверяет, что AC и DoD распарсились
- Проверяет, что сериализация обратно даёт тот же результат (round-trip)

**Важно:** это статический тест — оригинал Backlog.md **не запускается** (Catalina).

## Acceptance Criteria

- [ ] Тесты покрывают yaml, frontmatter, task, store, deps, search
- [ ] CLI-тесты
- [ ] MCP-тесты
- [ ] Тесты совместимости с реальными файлами
- [ ] Все тесты проходят
- [ ] Описания тестов на русском

## Definition of Done

- [ ] `pnpm test` проходит
- [ ] Если расхождения — план обновлён