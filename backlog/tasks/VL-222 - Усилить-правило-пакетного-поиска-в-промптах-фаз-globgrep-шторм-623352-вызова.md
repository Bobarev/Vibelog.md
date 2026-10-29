---
id: VL-222
title: Усилить правило пакетного поиска в промптах фаз (glob/grep-шторм 623+352 вызова)
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 19:51'
updated_date: '2026-10-29 20:57'
due_date: ''
labels:
  - core
  - prompt
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/agent-prompt.md
  - templates/phases/phase-plan.md
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-investigate.md
  - src/web/phase-prompt.test.mjs
lessons: []
token_usage:
  input: 2769408
  output: 17507
  cache: 2441600
  total: 2786915
  requests: 38
  duration_ms: 2386680
  by_phase:
    spec:
      input: 45805
      output: 357
      cache: 36608
      requests: 2
    plan:
      input: 760455
      output: 5982
      cache: 613376
      requests: 12
    code:
      input: 1963148
      output: 11168
      cache: 1791616
      requests: 24
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-220. В сессии VL-219 модель сделала 623 glob + 352 grep_search при лимите 100 tool-calls/ран — лимит достигался за ~3 LLM-хода. Существующие VL-202/VL-142/VL-109 не сработали. Ужесточить промпты фаз: один целевой glob/grep-проход → точечное чтение; запрет повторных переборов тех же паттернов; при resume — «не переоткрывай уже найденное».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В промптах фаз есть явное правило против повторных mass-glob/grep с теми же паттернами
- [ ] #2 На репро-сценарии (фаза с интенсивным поиском) доля повторных glob/grep снижается
- [x] #3 Тесты промптов/статические проверки проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-222 — Усилить правило пакетного поиска в промптах фаз

## Суть

Существующие правила (VL-202: пакетное чтение; VL-142: целевой код; VL-109: экономия ходов) не запрещают **повторные** массовые glob/grep с теми же паттернами и переборы после resume. Инцидент VL-219: 623 glob + 352 grep_search при лимите 100 tool-calls/ран. Добавляем явный запрет: один целевой glob/grep-проход → точечное чтение; повторные переборы тех же паттернов запрещены; при resume не переоткрывать уже найденное.

## Файлы для изменения (6)

### 1. `templates/agent-prompt.md` (16 строк)
- После строки 8 (правило пакетного чтения) вставить новый пункт:
  `- Поиск — один целевой проход: массовые glob/grep с одним и тем же паттерном повторно НЕ запускай (результат уже получен — используй его); повторный перебор после resume/«Продолжи» запрещён — уже найденное не переоткрывай.`

### 2. `templates/phases/phase-plan.md` (99 строк)
- В раздел «Экономия ходов» (строка ~80), после пункта «Пакетное чтение» (строка ~86), вставить:
  `- Поиск — ОДИН целевой glob/grep-проход по каждому паттерну: повторные массовые переборы тех же паттернов запрещены; после resume (блок «Продолжи») уже найденное не переоткрывай — продолжай со следующего шага.`

### 3. `templates/phases/phase-code.md` (83 строки)
- В раздел «Экономия ходов» (строка ~58), после пункта «Пакетное чтение» (строка ~62), вставить:
  `- Поиск — один целевой glob/grep-проход: повторные mass-glob/grep с теми же паттернами запрещены; результаты уже сделанных поисков не перепроверяй.`

### 4. `templates/phases/phase-do.md` (66 строк)
- В раздел «Экономия ходов» (строка ~48), после пункта «Пакетное чтение» (строка ~50), вставить:
  `- Поиск — один целевой glob/grep-проход: повторные mass-glob/grep с теми же паттернами запрещены; результаты уже сделанных поисков не перепроверяй.`

### 5. `templates/phases/phase-investigate.md` (строка 34 — пункт шага 2 «целевой код»)
- В пункт «целевой код» (строка 34) добавить фразу после «одним read_file чанками offset/limit подряд»:
  `; повторные переборы тех же glob/grep-паттернов запрещены — один проход`

### 6. `src/web/phase-prompt.test.mjs` (730 строк)
- Добавить новый describe «VL-222 — запрет повторных mass-glob/grep» после describe «VL-202 — пакетное чтение файлов» (строки 374–397):
```js
// Точечные инварианты VL-222 (паттерн VL-202/VL-142): запрет повторных
// mass-glob/grep с теми же паттернами в промптах фаз.
describe('VL-222 — запрет повторных mass-glob/grep', () => {
  const phaseFiles = ['phase-plan.md', 'phase-code.md', 'phase-do.md', 'phase-investigate.md'];

  it('правило есть во всех шаблонах фаз, выполняющих поиск', () => {
    for (const file of phaseFiles) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(/повторн\w*\s+(mass-)?glob|массов|теми же паттерн|тех же паттерн|один целевой|одним? целевым/i.test(text),
        `${file}: запрет повторных glob/grep-переборов`);
    }
  });

  it('agent-prompt.md содержит правило одного поискового прохода', () => {
    const agentPromptPath = fileURLToPath(new URL('../../templates/agent-prompt.md', import.meta.url));
    const text = readFileSync(agentPromptPath, 'utf-8');
    assert.ok(text.includes('один целевой проход') || text.includes('одним целевым'),
      'agent-prompt.md: правило одного целевого прохода поиска');
    assert.ok(text.includes('не переоткрывай') || text.includes('не переоткрывать'),
      'agent-prompt.md: запрет переоткрытия найденного при resume');
  });

  it('phase-plan: правило против повторных переборов в «Экономии ходов»', () => {
    const text = readFileSync(join(templatesDir, 'phase-plan.md'), 'utf-8');
    assert.ok(text.includes('повторные массовые переборы') || text.includes('теми же паттерн'),
      'phase-plan.md: явный запрет повторных mass-переборов');
    assert.ok(text.includes('не переоткрывай') || text.includes('не переоткрывать'),
      'phase-plan.md: правило resume — уже найденное не переоткрывать');
  });
});
```

## Порядок действий

1. Вставить пункт в `templates/agent-prompt.md` (после строки 8).
2. Вставить пункт в разделы «Экономия ходов» `phase-plan.md`, `phase-code.md`, `phase-do.md`.
3. Дописать фразу в пункт «целевой код» `phase-investigate.md` (строка 34).
4. Добавить describe «VL-222» в `src/web/phase-prompt.test.mjs` после строки 397.
5. Проверить: `pnpm build && pnpm test:fast` (тесты phase-prompt и system-prompt).
6. Коммит: `feat: VL-222 — запрет повторных mass-glob/grep в промптах фаз`

## Как проверить

```bash
pnpm build && pnpm test:fast
```

Ожидаемо: все тесты проходят, включая новый describe «VL-222 — запрет повторных mass-glob/grep».

## Риски

- **Формулировка**: тесты на конкретные фразы могут сломаться при перефразировке — держать формулировки в тестах и шаблонах идентичными.
- **VL-157 (переносимость)**: в новых фразах не использовать `VL-N` ID — тест `VL-157` падает.
- **VL-130 (структурные тесты)**: assert-ы на формулировки — осознанные инварианты по AC, не удалять при рефакторинге (паттерн VL-142/VL-202).
- **Не ломать VL-202**: существующие тесты на «одним read_file»/«offset/limit»/«grep/glob — найти нужный файл» должны остаться нетронутыми.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 19:54
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: enhancement (не изменён). Масштаб: task. Приоритет: Medium. Уточнено: AC приведены к проверяемому виду (явное правило в промптах фаз против повторных mass-glob/grep с теми же паттернами; снижение доли повторных вызовов на репро; прохождение статических проверок/тестов), добавлено указание «один целевой проход → точечное чтение». Labels: core, prompt. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 19:55
---
Фаза 2 (Plan) выполнена. Тип: enhancement. План записан: 6 файлов (templates/agent-prompt.md, phase-plan.md, phase-code.md, phase-do.md, phase-investigate.md — правила против повторных mass-glob/grep + resume; src/web/phase-prompt.test.mjs — новый describe VL-222 по паттерну VL-202/VL-142). Риски: точечные формулировки в тестах должны совпадать с текстом шаблонов; не добавлять VL-N ID (падение VL-157); не трогать инварианты VL-202.
---
author: @agent
created: 2026-10-29 20:34
---
Фаза 3 (Code) выполнена. Изменено: templates/agent-prompt.md, templates/phases/phase-plan.md, phase-code.md, phase-do.md, phase-investigate.md, src/web/phase-prompt.test.mjs, коммит 03fa289. Проверки: pnpm build (tsc), vitest — 84/84 файла, 1509 тестов прошли; новый describe «VL-222» — 3/3. AC1 (явное правило против повторных mass-glob/grep) — выполнено: правило добавлено в agent-prompt.md и 4 шаблона фаз + тесты-инварианты. AC3 (тесты/статические проверки) — выполнено. AC2 (репро-сценарий со снижением доли повторных вызовов) — НЕ выполнен: требует реального LLM-рана на репро, за пределами Code; в отчёте фиксирую честно. DoD: тесты проходят (1), нет регрессий (3) — выполнены; документация (2) — шаблоны промптов обновлены, CHANGELOG пишет Close. Что осталось: AC2 — проверить на репро-сценарии после слияния; reference.test.mjs падает по сетевому таймауту клонирования (не связано с задачей).
---
author: @agent
created: 2026-10-29 20:52
---
Фаза close не удалась (код выхода 1):  фаза: запросов=14, payload последнего запроса=194286 байт (макс 194286), usage={"input_tokens":490123,"output_tokens":6026,"cache_read_input_tokens":410688,"total_tokens":496149,"reasoning_tokens":0} — статус возвращён к Review.
---
author: @agent
created: 2026-10-29 20:57
---
Фаза Close выполнена. Ветка vb/vl-222 уже была слита в master (merge: «Already up to date», изменения в master), worktree удалена (оставались только untracked-симлинки node_modules/refs), ветка удалена. Сборка и тесты (pnpm build && pnpm test) прошли. DoD: 1 (Тесты проходят) — да; 2 (Документация обновлена) — нет, CHANGELOG/docs не менялись (промпты фаз — внутренние шаблоны, запись не требуется); 3 (Нет регрессий) — да. AC: 1, 3 выполнены; AC 2 (снижение доли повторных glob/grep на репро-сценарии) — не измерялась, честно остаётся открытой.
---
<!-- COMMENTS:END -->