---
id: ref-19
title: MiMo — Deep Thinking
type: doc
url: 'https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking'
tags: []
created_date: 2026-10-26
linked_tasks:
  - mimo
  - reasoning
  - thinking
  - api
  - VL-205
cached_path: references/cache/ref-19.md
cached_at: '2026-10-26T19:32:02.035Z'
source_hash: 1e638b56694b38b8d55f43cba31d9bd703c4122d2dae8f6209a223326abe9be4
---
Deep Thinking: reasoning перед ответом. Включён по умолчанию для mimo-v2.6-*. Возвращает reasoning_content отдельно. В multi-turn с tool calls требует передавать reasoning_content обратно (иначе 400). reasoning_tokens в completion_tokens_details.