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

- Токен: `TELEGRAM_BOT_TOKEN` (env) → `telegram_token` в настройках. Хранить в gitignored-файле (`.vibelog/bot.yml`), НЕ в backlog/config.yml: (1) config.yml коммитится → утечка токена; (2) Backlog.md saveConfig вычищает посторонние поля при записи.
- **Привязка чата через пин-код**: при старте бот генерирует 6-значный пин (node:crypto randomInt), печатает ТОЛЬКО в консоль; /start → бот просит код → верный код → chat_id в настройки. Пин однорожден на сессию. Защита: без пина любой мог бы привязать свой чат.

## 3. Grammy: middleware и ловушки

- **Порядок регистрации критичен**: `bot.on('message:text')` (catch-all) перехватывает ЛЮБОЕ текстовое сообщение, включая команды; без вызова `next()` цепочка останавливается. Если catch-all зарегистрирован раньше `bot.command('tasks')` — /tasks молчит без ошибок. Правило: ВСЕ bot.command ПЕРВЫМИ, catch-all ПОСЛЕДНИМ.
- Текст сообщения в обработчике `message:text`: `ctx.message.text` (typings фильтруют; `ctx.text` в FilteredContext не типизирован).
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
| Токен в git | `.vibelog/bot.yml` gitignored + .env gitignored |
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

Запуск: `vibelog bot` (токен/прокси — из .env проекта автоматически).