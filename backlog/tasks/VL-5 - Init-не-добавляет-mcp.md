---
id: VL-5
title: Init не добавляет mcp
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 21:56'
updated_date: '2026-10-01 13:38'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
vibelog init должен добавлять в .qwen/settings.json секцию:

  "mcpServers": {
    "vibelog": {
      "command": "vibelog",
      "args": ["mcp", "start"],
      "trust": true
    }
  }
<!-- SECTION:DESCRIPTION:END -->