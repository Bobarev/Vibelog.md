# PLAN-02: YAML и Frontmatter

## Задача

Написать мини-парсер YAML для frontmatter и парсер/сериализатор frontmatter задач. Всё на русском, с подробными комментариями.

## Перед началом

**Изучи оригинал:** `/Users/bob/Dev/ton/ai/Backlog.md`
- Как выглядит frontmatter реальной задачи (см. `backlog/tasks/*.md`).
- Какой YAML-диалект используется (скаляры, массивы, строки в кавычках).
- Как называется поле даты: `created_date` или `created`? Проверь в реальных файлах.
- Как хранятся зависимости: массив строк или массив объектов?

Если найдёшь расхождения с планом — **правь план** и коммить отдельно.

## Файлы

### `src/core/yaml.mjs`

Мини-парсер YAML. Поддержка:

- **Скаляры:** строка, число, boolean, null
- **Массивы:** `- item` на каждой строке
- **Вложенные объекты:** отступы (2 пробела)
- **Inline-массивы:** `[a, b, c]`
- **Строки в кавычках:** `"string"` и `'string'`
- **Экранирование:** `\"` внутри двойных кавычек

Экспорт:
- `parseYaml(text)` → JS-объект
- `stringifyYaml(obj)` → строка

**Не поддерживать:** anchors, multiline (`|`, `>`), сложные flow-style. Если в оригинале они используются — расширить парсер.

Каждая функция — с JSDoc на русском:
```javascript
/**
 * Парсит YAML-текст в JS-объект.
 *
 * Поддерживает подмножество YAML, достаточное для frontmatter задач
 * Backlog.md: скаляры, массивы через `-`, вложенные объекты по отступам.
 *
 * @param {string} text — YAML-текст без обрамляющих `---`
 * @returns {object} — распарсенный объект
 * @throws {Error} — если встречена неподдерживаемая конструкция
 */
export function parseYaml(text) { ... }
```

### `src/core/frontmatter.mjs`

- `parseFrontmatter(content)` → `{ data, body }`
- `serializeFrontmatter(data, body)` → строка

JSDoc на русском, комментарии объясняют, почему именно так режем строку.

## Тесты

`src/core/yaml.test.mjs`:
- Простой объект
- Массив строк
- Вложенный объект
- Inline-массив
- Экранированные кавычки
- Round-trip: parse → stringify → parse

`src/core/frontmatter.test.mjs`:
- Файл с frontmatter и телом
- Файл без frontmatter
- Round-trip

**Отдельный тест:** парсинг реального файла из `/Users/bob/Dev/ton/ai/Backlog.md/backlog/tasks/`. Взять 2-3 файла, проверить, что все поля распарсились.

## Acceptance Criteria

- [ ] `yaml.mjs` парсит и сериализует YAML для frontmatter
- [ ] `frontmatter.mjs` корректно разделяет frontmatter и тело
- [ ] Round-trip тесты проходят
- [ ] Парсинг реальных файлов Backlog.md работает без ошибок
- [ ] Все комментарии и JSDoc — на русском

## Definition of Done

- [ ] `node --test src/core/yaml.test.mjs src/core/frontmatter.test.mjs` проходит
- [ ] Реальные файлы Backlog.md парсятся
- [ ] Если обнаружены расхождения с планом — план обновлён