---
id: decision-3
title: LLM-клиент Cloud.ru — OpenAI-совместимый через undici fetch (без openai-SDK)
date: 2026-10-04
status: proposed
---
## Context

VL-75: LLM-клиент для Cloud.ru. Ресёрч (docs.cloud.ru недоступен, собрано с cloud.ru): Evolution Foundation Models — публичный OpenAI-совместимый API; base URL https://foundation-models.api.cloud.ru/v1 (quickstart, client = OpenAI(api_key, base_url=url), endpoint chat/completions); аутентификация — API-ключ сервисного аккаунта (Консоль → Пользователи → Сервисные аккаунты → Учетные данные → Создать API-ключ, сервис Foundation Models, Key Secret один раз), библиотека openai шлёт его как Authorization: Bearer; модели — namespace/model (ai-sage/GigaChat3.5-432B-A28B-Reasoning, moonshotai/Kimi-K2.6, zai-org/GLM-5.1, deepseek-ai/DeepSeek-V4-Pro; каталог cloud.ru/products/evolution-ai-factory/catalog-foundation-models); Function Calling и Structured Output заявлены явно; rate limit — 20 RPS на ключ; streaming (SSE) на странице не подтверждён явно (OpenAI-совместимость предполагает stream=true).
## Decision

LLM-клиент агента — тонкая обёртка над undici fetch (уже в зависимостях проекта): POST {base}/chat/completions, headers Authorization: Bearer <API_KEY>, body {model, messages, tools, tool_choice?, stream?}. Без npm-пакета openai — весь формат OpenAI chat/completions реализуется напрямую (undici покрывает fetch/SSE-стриминг через ReadableStream). Ключ и base URL — в конфиге агента/окружении (не в git).
## Consequences

Ноль новых runtime-зависимостей; полный контроль над стримингом и tool-calling. Риск: streaming Cloud.ru не подтверждён документацией явно — проверить на фактическом запросе до интеграции в TUI; при отказе стриминга — non-streaming fallback.
## Alternatives

openai-SDK (npm) — готовый клиент с retry/стримингом, но новая runtime-зависимость против минимализма проекта; LiteLLM-шлюз (в облаке) — лишняя точка отказа и промежуточный аккаунт; собственный HTTP поверх node:https — дублирует уже имеющийся undici.