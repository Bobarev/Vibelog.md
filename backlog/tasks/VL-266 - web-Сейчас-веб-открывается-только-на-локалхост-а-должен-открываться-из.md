---
id: VL-266
title: Веб-сервер должен слушать 0.0.0.0 для доступа из локальной сети
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 17:51'
updated_date: '2026-10-30 19:24'
due_date: ''
labels:
  - web
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
  - src/web/host-binding.ts
  - src/web/host-binding.test.mjs
  - src/web/server.ts
  - src/web/static.test.mjs
  - src/cli/commands/browser.ts
  - src/cli/router.ts
  - README.md
lessons:
  - lesson-113
  - lesson-114
token_usage:
  input: 8602214
  output: 59198
  cache: 8360960
  total: 8661412
  requests: 142
  duration_ms: 2852063
  reasoning: 28041
  by_phase:
    spec:
      input: 336618
      output: 5789
      cache: 310784
      requests: 13
    plan:
      input: 1103310
      output: 14168
      cache: 1042432
      requests: 22
    code:
      input: 5654242
      output: 30407
      cache: 5550080
      requests: 74
    close:
      input: 1508044
      output: 8834
      cache: 1457664
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#web Сейчас веб открывается только на локалхост, а должен открываться из локальной сети тоже (то есть на 0.0.0.0)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 vibelog browser поддерживает флаг --host <addr>: по умолчанию слушает 127.0.0.1, с --host 0.0.0.0 сервер доступен из локальной сети
- [x] #2 Значение host можно задать и в .vibelog/settings.json (флаг приоритетнее настройки)
- [x] #3 При старте в консоль выводятся и локальный URL, и LAN-адрес машины (http://<ip>:<port>)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Реализация: host-биндинг веб-сервера (`--host`, `web_host` в settings.json, вывод LAN-URL)

### Изучено
- `src/web/server.ts:35` — `startWebServer(cwd, port=3030, openBrowser=true, staticDir=webDistDir)`; жёсткий `server.listen(port, '127.0.0.1', cb)` на строке 133, единственная строка старта `console.log(\`Веб-интерфейс Vibelog.md: ${url}\`)` (135), авто-открытие браузера (137-141), EADDRINUSE (144-153). `url` формируется как `http://127.0.0.1:${port}`.
- `src/cli/commands/browser.ts:22-45` — `runBrowser(positional, flags, cwd)`: порт из `--port` → `loadConfig(cwd).default_port || 3030`, `openBrowser = !flags['no-open'] && !flags.nopen`, `loadProjectEnv(cwd)`, затем `startWebServer(cwd, port, openBrowser)`.
- `src/core/settings.ts:47` — `loadSettings(cwd)`: читает `.vibelog/settings.json`, битый/отсутствующий файл → `{}` (безопасно, без throw).
- `src/bot/web.ts:57-97` — бот спавнит `vibelog browser --no-open` и парсит stdout регуляркой `/Веб-интерфейс Vibelog\.md:\s*(\S+)/` (handlers.ts ~1340) и `webServerUrl(port)` → `http://127.0.0.1:<port>`. **Формат первой строки менять нельзя** — иначе сломается `/web start`.
- Вызовы `startWebServer` в тестах (позиционные, 4 аргумента): `src/web/static.test.mjs:107,129`, `src/web/chat.test.mjs:692`.
- Документация: `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` (раздел `browser`, ~стр. 152-157), `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` (~стр. 398), `README.md:46` (раздел «Веб-интерфейс»).

### Решение
1. `startWebServer` получает **5-й позиционный параметр** `host = '127.0.0.1'` (обратная совместимость: существующие 4-аргументные вызовы не меняются — TS default-параметр). Сигнатура: `startWebServer(cwd, port, openBrowser, staticDir, host)`.
2. Новый модуль **`src/web/host-binding.ts`** (чистые функции — легко тестировать без сети):
   - `DEFAULT_WEB_HOST = '127.0.0.1'`;
   - `isWildcardHost(host)` — `0.0.0.0` / `::` / `''`;
   - `lanAddresses(): string[]` — `os.networkInterfaces()`, IPv4 только, `!internal`, дедуп (возвращает адреса; сортировка стабильная);
   - `startupUrls(host, port, addresses)` → `{ local: string; lan: string[] }`: для wildcard `local = http://127.0.0.1:<port>`, `lan = addresses.map(ip => http://ip:port)`; для конкретного адреса — `local = http://<host>:<port>`, `lan = []`; IPv6 в URL оборачивается в `[...]`;
   - `startupLines(host, port, addresses): string[]` — строки для stdout: **первая строка ровно** `Веб-интерфейс Vibelog.md: <local>` (контракт бота), далее (если есть LAN) `Доступ из локальной сети: http://<ip>:<port>` по строке на адрес;
   - `resolveWebHost(flags, settings)`: приоритет CLI-флаг `--host` → `settings.web_host` → `DEFAULT_WEB_HOST`; пустая строка/не-строка значения настройки игнорируется (не роняет запуск — паттерн `loadSettings`/lesson конфиг-фейлов).
3. `src/cli/commands/browser.ts`: `const host = resolveWebHost(flags, loadSettings(cwd))` (loadSettings в try/catch — файла может не быть), передать 5-м аргументом в `startWebServer`; JSDoc флагов дополнить `host`.
4. `src/web/server.ts`: заменить `server.listen(port, '127.0.0.1', ...)` на `server.listen(port, host, ...)`; в колбэке — `startupLines(host, port, lanAddresses())` и `console.log` по строкам; авто-открытие браузера использовать `urls.local` (никогда не `0.0.0.0`); обновить шапку модуля (слушает host, по умолчанию 127.0.0.1) и JSDoc `@param host`.
5. `src/bot/web.ts` / `webServerUrl` — **не меняем**: бот парсит первую (local) строку, поведение сохраняется (риск регрессии VL-161 закрыт контрактом формата).

### Файлы
| Файл | Действие |
|---|---|
| `src/web/host-binding.ts` | NEW — `DEFAULT_WEB_HOST`, `isWildcardHost`, `lanAddresses`, `startupUrls`, `startupLines`, `resolveWebHost` |
| `src/web/server.ts` | 5-й параметр `host`; строка 133 `listen(port, host)`; строки 133-141 — вывод `startupLines(...)` и `open` по local-URL; шапка + JSDoc |
| `src/cli/commands/browser.ts` | `resolveWebHost` + `loadSettings`; передача host в `startWebServer`; JSDoc флагов |
| `src/cli/router.ts` | справка: `browser [--port N] [--host ADDR] [--no-open]` (строка ~143) + блок `showCommandHelp('browser')` (`browser: \`...\``) |
| `src/web/host-binding.test.mjs` | NEW — unit-тесты |
| `src/web/static.test.mjs` | +1 тест: `startWebServer(cwd, 0, false, dist, '0.0.0.0')` → `server.address().address === '0.0.0.0'`, в консоли (spy) есть local-строка и хотя бы одна LAN-строка формата `Доступ из локальной сети: http://…:<port>`; закрыть сервер |
| `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` | раздел `browser`: `--host`, дефолт 127.0.0.1, `web_host` в `.vibelog/settings.json`, вывод LAN-адресов |
| `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` | ~стр. 398: подраздел «Доступ из локальной сети» — пример `vibelog browser --host 0.0.0.0`, настройка `web_host`, предупреждение про отсутствие аутентификации (не выставлять в интернет) |
| `README.md` | ~стр. 46: одна строка про `--host 0.0.0.0` для доступа из локальной сети |

### Тесты (новый файл `src/web/host-binding.test.mjs`, mkdtemp-правила AGENTS.md не требуются — чистая логика + временный cwd через `mkdtempSync` для `resolveWebHost`)
1. `resolveWebHost({}, {})` → `'127.0.0.1'`.
2. `resolveWebHost({ host: '0.0.0.0' }, { web_host: '192.168.1.5' })` → `'0.0.0.0'` (флаг приоритетнее).
3. `resolveWebHost({}, { web_host: '0.0.0.0' })` → `'0.0.0.0'` (настройка).
4. `resolveWebHost({}, { web_host: 42 })` и `{ web_host: '' }` → дефолт (мусор не роняет).
5. `startupUrls('0.0.0.0', 3030, ['192.168.1.7','10.0.0.2'])` → local `http://127.0.0.1:3030`, lan 2 адреса.
6. `startupUrls('127.0.0.1', 3030, ['192.168.1.7'])` → lan пуст (не wildcard — LAN не печатаем).
7. `startupUrls('::', 3030, [])` → local IPv4-loopback, lan пуст (нет адресов — не падаем).
8. `startupUrls('192.168.1.5', 3030, [])` → local `http://192.168.1.5:3030`, lan пуст.
9. `startupLines(...)` — первая строка строго `Веб-интерфейс Vibelog.md: http://127.0.0.1:3030` (контракт парсера бота), затем строки LAN.
10. IPv6-адрес в `startupUrls` → `http://[fe80::1]:3030`.
11. `lanAddresses()` — результат массив строк, все элементы непустые, нет `127.0.0.1` (internal отфильтрован).

### Порядок действий
1. `src/web/host-binding.ts` (чистые функции).
2. `src/web/server.ts` — параметр `host`, `listen`, вывод, браузер.
3. `src/cli/commands/browser.ts` — резолв host.
4. `src/cli/router.ts` — справка (общий + `showCommandHelp`).
5. Тесты: новый `host-binding.test.mjs` + кейс в `static.test.mjs`.
6. Документация: doc-7, doc-6, README.
7. Проверки: `pnpm build && pnpm test` (полный прогон — DoD), плюс ручной smoke.

### Как проверить
```bash
pnpm build
pnpm test:fast                       # быстрая итерация по src/web/*
node bin/vibelog.mjs browser --no-open --port 3033                 # → только 127.0.0.1
node bin/vibelog.mjs browser --no-open --port 3033 --host 0.0.0.0  # → local + LAN-адреса
curl -s http://127.0.0.1:3033/api/tasks | head -c 100              # сервер жив
# LAN-проверка (с другого устройства): http://<ip>:3033
# настройка: node -e "..." записать web_host в .vibelog/settings.json → без флага печатается LAN
pnpm test                            # финальный полный прогон перед DoD
```

### Риски
1. **Контракт stdout с ботом (VL-161)**: бот парсит `/Веб-интерфейс Vibelog\.md:\s*(\S+)/` из stdout. Первая строка обязана остаться в прежнем формате с local-URL — покрыто тестом №9 (`startupLines`). Дополнительные строки префиксом не совпадают → бот не словит ложный URL.
2. **Безопасность**: `0.0.0.0` открывает API (`/api/tasks`, `/api/chat`, триггеры фаз) всей локальной сети без аутентификации. Дефолт остаётся `127.0.0.1`; в документации — предупреждение не выставлять наружу.
3. **Безопасность в авто-открытии браузера**: `open http://0.0.0.0:3033` не работает в некоторых окружениях — открываем `urls.local`.
4. **Источник LAN-адреса**: `os.networkInterfaces()` может вернуть несколько адресов (Wi-Fi + VPN + docker bridge) — печатаем все, чтобы пользователь выбрал нужный; фильтр IPv4+не-internal убирает мусор.
5. **IPv6**: `::` (dual-stack) может не поддерживаться на некоторых машинах → `server.on('error')` уже печатает понятную ошибку; в документации основной путь — IPv4.
6. **Тесты с фиксированным портом**: только `port = 0` (эфемерный), правило AGENTS.md/lesson-89 соблюдено.
7. **Смена сигнатуры `startWebServer`**: добавление параметра в конец не ломает существующие вызовы (`static.test.mjs`, `chat.test.mjs`, `browser.ts`); проверяется сборкой `pnpm build` (tsc strict).
8. **`web_host` в `.vibelog/settings.json` не валидируется веб-API** (`validateSettingsPatch` в `src/web/api.ts` знает только bot-ключи) — вне скоупа AC; значение читается только CLI и не ломает `/api/settings`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 17:51
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Веб-сервер должен слушать 0.0.0.0 для доступа из локальной сети» (исходный был обрезан). Тип: enhancement. Масштаб: task (описание неполное — ожидаю уточнений по режиму запуска и безопасности). Приоритет: Medium. Labels: web. References: нет. Жду ответов на вопросы:
### 1. Режим прослушивания по умолчанию
- [ ] Всегда слушать 0.0.0.0 (без выбора)
- [ ] По умолчанию 127.0.0.1, доступ из сети — флагом/опцией (`--host 0.0.0.0`)
- [ ] По умолчанию 0.0.0.0 с предупреждением в консоли
- [ ] Другое → 
### 2. Как задавать хост/адрес?
- [ ] CLI-флаг `--host <addr>` (и порт `--port`)
- [ ] Настройка в `.vibelog/settings.json`
- [ ] И то, и другое
- [ ] Другое → 
### 3. Что печатать в консоли при старте?
- [ ] Только текущий URL (как сейчас)
- [ ] Текущий URL + LAN-адрес машины (например http://192.168.x.x:PORT)
- [ ] Другое → 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-30 17:54
---
Уточнения по Spec получены от пользователя и внесены в AC:
1. Режим прослушивания — по умолчанию 127.0.0.1, доступ из сети через флаг `--host 0.0.0.0`.
2. Хост задаётся и CLI-флагом, и настройкой в `.vibelog/settings.json` (флаг приоритетнее).
3. При старте печатать локальный URL и LAN-адрес машины.
Тип: enhancement; Labels: web; Приоритет: Medium; Масштаб: task. Вопросов нет.
---
author: @agent
created: 2026-10-30 18:11
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, план в этой же задаче).
Изучено: `src/web/server.ts` (жёсткий `server.listen(port, '127.0.0.1')` — стр. 133, вывод URL — 135, авто-браузер — 137-141, EADDRINUSE — 144-153), `src/cli/commands/browser.ts` (резолв порта `--port` → `default_port`, `loadProjectEnv`), `src/core/settings.ts` (`loadSettings` — читает `.vibelog/settings.json`, фейл-сейф `{}`), `src/bot/web.ts` + `handlers.ts:1301-1362` (бот парсит stdout регуляркой `/Веб-интерфейс Vibelog\.md:\s*(\S+)/` — контракт формата первой строки), `src/cli/router.ts` (справка), вызовы `startWebServer` в тестах.
Решение: (1) 5-й параметр `host = '127.0.0.1'` у `startWebServer` — обратная совместимость с 4-аргументными вызовами; (2) новый модуль `src/web/host-binding.ts` с чистыми функциями `DEFAULT_WEB_HOST`/`isWildcardHost`/`lanAddresses` (os.networkInterfaces, IPv4, !internal)/`startupUrls`/`startupLines`/`resolveWebHost` (приоритет флага над `web_host` из settings.json, мусор → дефолт); (3) первая строка stdout сохраняет прежний формат с local-URL, LAN-адреса печатаются дополнительными строками «Доступ из локальной сети: http://<ip>:<port>»; (4) браузер открывается по local-URL, не по 0.0.0.0; (5) `/web start` бота не меняется.
Файлов в плане: 9 (2 новых — `src/web/host-binding.ts`, `src/web/host-binding.test.mjs`; правки — `src/web/server.ts`, `src/cli/commands/browser.ts`, `src/cli/router.ts`, `src/web/static.test.mjs` + 1 тест, документация doc-7 + doc-6 + README). Все пути проверены на существование.
Риски: контракт stdout с ботом VL-161 (снят тестом на формат первой строки), безопасность `0.0.0.0` без аутентификации (дефолт 127.0.0.1 остаётся + предупреждение в доках), IPv6/dual-stack, несколько LAN-адресов (Wi-Fi/VPN/docker) — печатаем все, порт 0 в тестах. Проверка: `pnpm build && pnpm test` (полный прогон) + ручной smoke с `--host 0.0.0.0`.
---
author: @agent
created: 2026-10-30 19:18
---
Фаза 3 (Code) выполнена. Изменено 7 файлов, коммит c242268 (ветка vb/vl-266):
- `src/web/host-binding.ts` (NEW) — `DEFAULT_WEB_HOST`, `isWildcardHost` (0.0.0.0/::/''), `lanAddresses()` (os.networkInterfaces, IPv4, !internal, дедуп), `startupUrls(host,port,addresses)` → {local,lan} с IPv6-скобками, `startupLines()` (первая строка — прежний формат `Веб-интерфейс Vibelog.md: <local>`, далее `Доступ из локальной сети: http://<ip>:<port>`), `resolveWebHost(flags, settings)` (флаг → `web_host` → 127.0.0.1; мусор/пустая строка игнорируются);
- `src/web/server.ts` — 5-й параметр `host = DEFAULT_WEB_HOST`, `server.listen(port, host)`, вывод `startupLines(...)`, авто-открытие браузера всегда по local-URL; фактический порт берётся у сокета (важно для port=0); шапка модуля + JSDoc;
- `src/cli/commands/browser.ts` — `loadSettings(cwd)` + `resolveWebHost` (обработка отсутствия/битого settings.json), host передаётся 5-м аргументом; JSDoc флагов;
- `src/cli/router.ts` — справка `browser [--port N] [--host ADDR]` (общая + `showCommandHelp('browser')` с описанием `web_host`);
- `src/web/host-binding.test.mjs` (NEW) — 16 тестов: резолв хоста и приоритеты, wildcard, LAN-адреса, IPv6, формат первой строки контракта бота;
- `src/web/static.test.mjs` — +1 тест: host='0.0.0.0' → `server.address().address === '0.0.0.0'`, local-строка в прежнем формате, LAN-строки только с префиксом «Доступ из локальной сети:», сервер отвечает по loopback;
- `README.md` — строка про `vibelog browser --host 0.0.0.0`.
Контракт stdout с ботом VL-161 сохранён (`/web start` парсит первую строку), `src/bot/web.ts` не менялся.
Проверки: `pnpm build` (tsc strict — 0 ошибок); целевые vitest (host-binding + static) — 24 passed; **полный `pnpm test`** — 98 файлов + `static.test.mjs` отдельно (8 тестов), все зелёные, 0 падений; ручной smoke: `node bin/vibelog.mjs browser --no-open --port 3033 --host 0.0.0.0` → напечатаны `Веб-интерфейс Vibelog.md: http://127.0.0.1:3033` и `Доступ из локальной сети: http://192.168.3.10:3033`, `curl 127.0.0.1:3033/api/tasks` → 200; проверка настройки: `web_host: 0.0.0.0` в settings.json → хост 0.0.0.0, флаг `--host 127.0.0.1` перекрывает настройку.
Нюанс прогона: первый полный `pnpm test` в этой сессии падал на `src/mcp/server.test.mjs` («fallback: meta без usage → jsonl») — причина НЕ в правках задачи: спавненный MCP-сервер наследует env текущей агентской сессии (`VIBELOG_PHASE_NAME/VIBELOG_RUN_PHASE/VIBELOG_CWD/…`), из-за чего meta новой сессии получает поле phase. С `env -u` этих переменных тест и полный прогон зелёные (98+1 файлов). MCP я не трогал.
Что осталось: DoD2 «Документация обновлена» — README обновлён, но `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` и `doc-6-Руководство-пользователя-Vibelogmd.md` по правилам фазы Code в backlog/docs не правятся — оставлено Фазе Close (в плане описано, что писать: `--host`, `web_host`, предупреждение про отсутствие аутентификации). AC1-AC3 закрыты.
---
author: @agent
created: 2026-10-30 19:24
---
Фаза Close выполнена.
**Merge**: ветка `vb/vl-266` слита в master (`--no-ff`, 1 коммит c242268 + merge), изменения: 7 файлов (+337/−12) — `src/web/host-binding.ts` (NEW), `src/web/host-binding.test.mjs` (NEW), `src/web/server.ts`, `src/cli/commands/browser.ts`, `src/cli/router.ts`, `src/web/static.test.mjs`, `README.md`. Worktree `.vibelog/worktrees/vl-266` удалена (были только untracked-симлинки `node_modules`/`backlog/references/data` → `--force`), ветка `vb/vl-266` удалена (`git branch -d`).
**Проверки на master после merge**: `pnpm build` (tsc strict) — 0 ошибок; ранний точечный прогон затронутого diff'ом (`src/web/host-binding.test.mjs` + `src/web/static.test.mjs`) — 24 passed; **полный `pnpm test` — 98 файлов, 1830 passed, 4 skipped, 0 падений** (один прогон, повторов не потребовалось; параллельного vitest в других worktree не было). Регрессий нет.
**DoD**: 1 «Тесты проходят» — да (полный прогон на master); 2 «Документация обновлена» — да, выполнено в этой фазе: doc-7 (раздел `browser`: `--host`, дефолт 127.0.0.1, `web_host`, LAN-вывод, предупреждение об отсутствии аутентификации), doc-6 §10 «Доска и веб-интерфейс» (пример `--host 0.0.0.0`, настройка `web_host`, предупреждение не выставлять в интернет), README (строка про `--host 0.0.0.0` — в ветке), CHANGELOG (Unreleased) — docs-коммит 06f3d00; 3 «Нет регрессий» — да (контракт stdout бота VL-161 сохранён, первая строка прежнего формата, `src/bot/web.ts` не менялся; покрыто тестом на точный формат первой строки).
**Lessons**: lesson-113 (MCP-тесты в агентской сессии требуют `env -u VIBELOG_*`: первый полный прогон в Code-фазе падал на `src/mcp/server.test.mjs` из-за наследования env — не регрессия задачи), lesson-114 (расширяя stdout, который парсит бот, оставляй первую строку с URL неизменной). Оба связаны с VL-266; refs-коммит 8da2b1f.
---
<!-- COMMENTS:END -->