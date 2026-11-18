---
id: doc-1
title: 'Telegram Bot API и grammy — практика Vibelog.md (прокси, пин-код, MarkdownV2, Rich Messages)'
type: guide
created_date: 2026-10-02
tags:
  - telegram
  - grammy
  - rich-messages
  - markdownv2
  - proxy
  - vl-34
  - vl-39
---
# Telegram Bot API и grammy — практика Vibelog.md

Документ собран по итогам реализации Telegram-бота Vibelog (VL-34..39, октябрь 2026). Источники: core.telegram.org/bots/api (доступен через прокси), grammy@1.46.0 (node_modules), ручная проверка на реальном боте.

## 1. Сеть: блокировки и прокси

- `api.telegram.org` и `core.telegram.org` могут быть заблокированы напрямую (TCP 443 timeout при живом DNS). Симптом: `fetch failed` / `UND_ERR_CONNECT_TIMEOUT`, при этом npm-registry доступен.
- Диагностика: `dns.lookup` (резолвится) → `net.connect(443)` (таймаут) → блокировка на уровне IP.
- **Node fetch и grammy НЕ читают системный прокси macOS** (`scutil --proxy`). Решение: undici `ProxyAgent` + кастомный fetch в клиенте grammy.
- Grammy: `new Bot(token, { client: { fetch: customFetch } })` — клиент принимает свой fetch (api.d.ts: `client.fetch?: typeof fetch`).
- **undici v8 несовместим с Node 20.19** (`webidl.util.markAsUncloneable is not a function`) — использовать undici ^6.
- `.env` с токеном/прокси: грузить в коде (loadDotEnv), НЕ полагаться на `node --env-file` (удобство запуска). dotenv-поведение: реальный env приоритетнее файла; дописка в .env без завершающего `\n` склеивается со строкой токена.

## 2. Аутентификация и привязка чатов

- Токен: `TELEGRAM_BOT_TOKEN` — секрет (VL-143): хранить в `.env` или в секции `env` gitignored-файла `.vibelog/settings.json` (приоритет: реальное окружение → `.env` → `env`-секция settings.json), НЕ в backlog/config.yml: (1) config.yml коммитится → утечка токена; (2) Backlog.md saveConfig вычищает посторонние поля при записи.
- **Привязка чата через пин-код**: при старте бот генерирует 6-значный пин (node:crypto randomInt), печатает ТОЛЬКО в консоль; /start → бот просит код → верный код → chat_id в настройки. Пин однорожден на сессию. Защита: без пина любой мог бы привязать свой чат.

## 3. Grammy: middleware и ловушки

- **Порядок регистрации критичен**: `bot.on('message:text')` (catch-all) перехватывает ЛЮБОЕ текстовое сообщение, включая команды; без вызова `next()` цепочка останавливается. Если catch-all зарегистрирован раньше `bot.command('tasks')` — /tasks молчит без ошибок. Правило: ВСЕ bot.command ПЕРВЫМИ, catch-all ПОСЛЕДНИМ.
- **Перехват пересылки в веб-чат (VL-408)**: обработчик `message:text` режима `/chat` стоит строго между обработчиком `awaitingComment` и reply-resume — режим комментария должен выигрывать у пересылки, а reply на сообщение бота при активной пересылке обязан уходить в чат, а не запускать resume-сессию. `/cancel` намеренно НЕ регистрируется как `bot.command`: он перехватил бы `/cancel` у режима комментария; выход из режима пересылки обрабатывается внутри двух `message:text`-обработчиков, порядок которых уже задан.
- Текст сообщения в обработчике `message:text`: `ctx.message.text` (typings фильтруют; `ctx.text` в FilteredContext не типизирован).
- **Фильтр `message:text` не пропускает rich-сообщения** (VL-430): у ответа чужого бота через `sendRichMessage` поля `text` нет — только `rich_message`, и leaf-предикат фильтра (`e[l3] || e.type === 'text'`) такое сообщение отбрасывает молча, минуя все ветки ниже. Ветка, обязана видеть rich (interbot-тикеты), регистрируется на `bot.on('message')`: текст вычисляется `m.text ?? (m.rich_message ? richToText(m.rich_message) : undefined)` ДО trace и веток, при `undefined` — `next()` (фото/стикер ведут себя как раньше). Пустой `text` при наличии свойства проходит в ветку — как и старый фильтр; пустой `richToText` (rich без текста) — нет.
- **Патч own-свойств `bot.api` не видит ctx-вызовы** (VL-430): grammy в `bot.handleUpdate` создаёт новый экземпляр `Api` на каждый update и передаёт его в Context — `ctx.reply` / `ctx.api.sendMessage` зовут per-update `Api`, а не наше покаченное `bot.api` (прямые вызовы `bot.api.*`, в т.ч. `sendRichMessage` из `chat-answer`, наоборот, видят). Перехват исходящих в `--trace` — через transformer `bot.api.config.use((prev, method, payload, signal) => ...)`: трансформеры копируются в каждый per-update `Api` (`api.config.use(...installedTransformers)`). Фильтр по именам методов обязателен — иначе лог заливает `getUpdates` (long polling).
- Long polling автоматически переподключается при сетевых сбоях; 401 (битый токен) — grammy ретраит бесконечно, процесс не падает и не логирует. Проверять токен заранее: `getMe` через curl/undici.
- Ответы: `ctx.reply(text)`; при пустом/битом parse_mode — бот молчит для юзера, исключение уходит в bot.catch. Поэтому все ответы — через хелпер с try/catch и фолбэком.

## 4. Форматирование сообщений

### 4.1. MarkdownV2 (sendMessage, parse_mode)

- Спецсимволы ОБЯЗАНЫ экранироваться: `_ * [ ] ( ) ~ \` > # + - = | { } . !` и `\`. Неэкранированный текст из данных (заголовки задач) ломает парсинг → Telegram отвечает 400 "can't parse entities".
- Экранирование: `text.replace(/([_*\[\]()~\`>#+\-=|{}.!\\])/g, '\\$1')`.
- Лимит сообщения: 4096 символов.
- Подходит для КОРОТКИХ ответов: /tasks (список), /board (сводка), системные сообщения.

### 4.2. Rich Messages (sendRichMessage) — для полного контента

- **Отдельный метод** `sendRichMessage(chat_id, rich_message)`, НЕ sendMessage с parse_mode.
- `InputRichMessage`: ровно одно из полей `markdown` | `html` | `blocks`; плюс `media`, `skip_entity_detection`.
- **Rich Markdown = GFM**: `**bold**`, `# заголовки`, `~~strike~~`, `==marked==`, task lists (`- [x]`), таблицы, blockquotes, LaTeX. Синтаксис ОТЛИЧАЕТСЯ от MarkdownV2 (жирный — `**` вместо `*`).
- **Лимит 32768 символов** (вместо 4096), до 500 блоков, 16 уровней вложенности.
- **Ключевое преимущество для Vibelog**: markdown-файлы задач уже GFM-совместимы — тело показывается почти без потерь (секции = `##`, AC/DoD = `- [x]`).
- grammy 1.46.0 имеет метод **нативно**: `ctx.api.sendRichMessage(chatId, { markdown })` (api.d.ts:167).
- Фолбэк обязателен: старые клиенты Telegram могут не поддерживать rich — catch → sendMessage MarkdownV2.
- Ловушка GFM: последовательность ``` внутри контента ломает блоки кода — экранировать (замена на `` ` ` ` ``).

## 5. Практические решения Vibelog.md

| Проблема | Решение |
|----------|---------|
| Telegram заблокирован напрямую | undici ProxyAgent + TELEGRAM_PROXY env |
| Токен в git | `.vibelog/settings.json` (секция `env`) gitignored + .env gitignored |
| Чужие могли привязать чат | Пин-код из консоли запущенного бота |
| /tasks молчит | Порядок middleware: команды до catch-all |
| Длинное описание задачи | Rich Messages, лимит 32768 |
| Спецсимволы в заголовках | escapeMarkdownV2 для динамического текста |
| Старые клиенты без rich | Фолбэк на MarkdownV2-summary |

## 6. Команды бота (текущее состояние)

- `/start` — привязка чата (пин-код)
- `/tasks` — список активных задач (MarkdownV2)
- `/task <id>` — карточка задачи **Rich Message**: все секции, AC/DoD-чек-листы, комментарии (VL-39)
- `/board` — сводка по колонкам (MarkdownV2)

Запуск: `vibelog bot` (токен/прокси — из .env проекта или секции `env` `.vibelog/settings.json` автоматически, VL-143).