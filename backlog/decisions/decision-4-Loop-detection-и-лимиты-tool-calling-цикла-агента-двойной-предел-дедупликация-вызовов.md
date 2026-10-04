---
id: decision-4
title: Loop detection и лимиты tool-calling цикла агента — двойной предел + дедупликация вызовов
date: 2026-10-04
status: proposed
---
## Context

VL-75: лимиты --max-tool-calls/--max-wall-time (AC#2). Референсы loop detection: refs/opencode packages/core/src/v1/config/agent.ts:37-79 — шаги агента (steps/maxSteps); packages/core/src/session/runner/llm.ts:38,90,202,254 — MAX_STEPS_PROMPT, isLastStep по agent.info.steps, после предела инструменты отключаются с сообщением; refs/cline sdk/packages/agents/src/agent-runtime.ts:61-89 — MAX_TOKENS_RECOVERY_LIMIT=3 (надбавка «будь краток» после обрыва по токенам) и PROVIDER_ERROR_MAX_RETRIES=3 (retry с backoff на ошибки провайдера, retry на уровне внешнего цикла); refs/pi packages/agent/src/agent-loop.ts:161-260 — двойной цикл (внешний: follow-up сообщения/steering; внутренний: tool calls), стоп по stopReason error/aborted, AbortSignal; refs/hermes-agent agent/anthropic_adapter.py:360,508 — retry/rate-limit делегируются внешнему conversation loop (Retry-After), SDK-retry выключен (max_retries=0).
## Decision

Tool-calling loop агента Vibelog: (1) жёсткий лимит --max-tool-calls (счётчик вызовов инструментов за сессию, по умолчанию например 50) и --max-wall-time (таймаут по wall-clock); по достижении — корректное завершение цикла с partial-результатом и сообщением в ответ (по образцу opencode: «инструменты отключены после предела шагов»); (2) дедупликация-детектор: подсчёт повторяющихся идентичных tool-call (одинаковые name+аргументы подряд N раз, N≥3) — при срабатывании цикл прерывается с диагностикой для модели (по мотивам cline recovery-nudge: одна устаревшая резаная реплика восстанавливается, серия — нет); (3) ошибки провайдера (429/5xx/сеть) — retry с экспоненциальной паузой и уважением Retry-After, максимум 3 попытки на запрос, без вложений в лимит --max-tool-calls; (4) стоп-сигналы цикла — error/aborted/лимиты/detector; AbortSignal прокидывается во все I/O.
## Consequences

Цикл гарантированно завершается (защита от зависаний и счётчиков токенов); диагностика причины остановки доступна оркестратору/пользователю. Нюанс: параметры уточняются при реализации (значения по умолчанию), схема CLI-флагов --max-tool-calls/--max-wall-time фиксируется AC VL-75.
## Alternatives

Только счётчики без детектора дублей — серия идентичных вызовов сжигает лимит без полезного результата; только AbortSignal без лимитов — не защищает от «медленного» зацикливания (каждый шаг уникален); попытка LLM-based detection (вторая модель следит) — избыточная стоимость и задержка.