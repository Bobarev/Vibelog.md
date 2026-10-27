/**
 * REST API хендлеры для веб-интерфейса Vibelog.md.
 *
 * Эндпоинты:
 * - GET  /api/tasks          — список задач
 * - POST /api/tasks          — создать задачу
 * - GET  /api/search         — глобальный поиск по 4 типам сущностей (VL-185)
 * - GET  /api/chat/threads   — список тредов чата без тел сообщений (VL-207)
 * - GET  /api/chat/threads/:id — история треда (messages) для восстановления (VL-207)
 * - GET  /api/tasks/:id      — детали задачи
 * - PATCH /api/tasks/:id     — обновить задачу
 * - DELETE /api/tasks/:id    — архивировать задачу
 * - GET  /api/config         — конфиг проекта
 * - PUT  /api/config         — патч конфига проекта с валидацией (VL-165)
 * - GET  /api/settings       — настройки бота/settings.json без секретов (VL-156)
 * - PUT  /api/settings       — патч настроек с валидацией (VL-156)
 * - POST /api/tasks/:id/trigger — запуск фазы оркестратора (VL-28); поле
 *   comment (VL-172) — сначала addComment в задачу, затем {{comment}} промпта;
 *   общий с ботом хелпер startTaskPhase + агент default_agent (VL-180)
 * - GET  /api/tasks/:id/trigger — состояние запуска фазы
 * - POST /api/tasks/:id/reject — отклонить задачу (VL-144)
 * - GET  /api/references      — список references без тел (VL-174)
 * - GET  /api/references/:id  — детали reference (метаданные + тело)
 * - PATCH /api/references/:id — обновление title/tags/url/тела (VL-174)
 * - POST /api/references/sync — клонировать отсутствующие репо (VL-174)
 * - GET  /api/documents      — список документов без тел (VL-181)
 * - POST /api/documents      — создать документ (VL-181)
 * - GET  /api/documents/:id  — детали документа (метаданные + body + path)
 * - PATCH /api/documents/:id — обновление title/type/tags/content (VL-181)
 * - GET  /api/lessons        — список lessons без тел (VL-182)
 * - GET  /api/lessons/:id    — детали lesson (метаданные + body + path)
 * - PATCH /api/lessons/:id   — обновление title/tags/status/content (VL-182)
 */

import { listTasks, getTask, createTaskFile, updateTaskFile, archiveTaskFile } from '../core/store.js';
import type { CreateTaskFileInput } from '../core/store.js';
import type { Task } from '../core/task.js';
import {
  listReferences,
  getReference,
  updateReference,
  syncReferenceRepos,
  REFERENCE_TYPES,
} from '../core/reference.js';
import type { UpdateReferenceInput } from '../core/reference.js';
import { findBacklogDir } from '../core/paths.js';
import {
  listDocuments,
  getDocument,
  writeDocument,
  updateDocument,
  DOCUMENT_TYPES,
} from '../core/document.js';
import type { UpdateDocumentInput } from '../core/document.js';
import {
  listLessons,
  getLesson,
  updateLesson,
  LESSON_STATUSES,
} from '../core/lesson.js';
import type { UpdateLessonInput } from '../core/lesson.js';
import { loadConfig, saveConfig, defaultConfig } from '../core/config.js';
import { getAvailablePhases, getWorkflowForTask, canMoveTo, loadWorkflows } from '../core/workflow.js';
import { loadPhaseStyles } from '../core/phase-styles.js';
import { globalSearch } from '../core/search.js';
import { listChatThreads, getChatThread } from './chat.js';
import { resolveGitUserName } from '../core/project-settings.js';
import { loadBotSettings, saveBotSettings } from '../bot/settings.js';
import type { BotSettings } from '../bot/settings.js';
import { startTaskPhase, getRun, rejectTask } from './orchestrator.js';

/** HTTP-ответ API. */
export interface ApiResponse {
  status: number;
  body: object | string;
}

/**
 * Обрабатывает REST-запрос.
 *
 * @param method — HTTP-метод
 * @param url — путь URL (без query string)
 * @param body — тело запроса (для POST/PATCH)
 * @param cwd — рабочая директория
 * @param queryString — строка запроса после '?' (VL-185; '' по умолчанию —
 *   обратная совместимость: существующие вызовы передают 4 аргумента)
 */
export function handleApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string,
  queryString: string = ''
): ApiResponse {
  try {
    // GET /api/tasks — с availablePhases по workflow (VL-188): веб-клиент
    // рендерит кнопки фаз и валидирует drop на канбане без импорта fs-модуля
    if (method === 'GET' && url === '/api/tasks') {
      return { status: 200, body: listTasks(cwd).map((t) => enrichWithWorkflow(cwd, t)) };
    }

    // GET /api/search — глобальный поиск по задачам/lessons/references/
    // documents (VL-185). Вся логика группировки и лимитов — в core
    // globalSearch (lesson-37: хендлер только валидирует и отдаёт).
    // Пустой q → 200 с пустыми группами (не ошибка); без backlog → 400
    // (паттерн VL-182: предпроверка findBacklogDir вместо 500 от
    // requireBacklogDir в searchLessons/searchReferences).
    if (method === 'GET' && url === '/api/search') {
      if (!findBacklogDir(cwd)) {
        return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      }
      const q = new URLSearchParams(queryString).get('q') ?? '';
      return { status: 200, body: globalSearch(cwd, q) };
    }

    // GET /api/chat/threads — список тредов чата (VL-207): сайдбар тредов и
    // восстановление последнего при входе на #/chat. Только метаданные
    // (title/updatedAt/messageCount), тела сообщений — в GET :id ниже.
    if (method === 'GET' && url === '/api/chat/threads') {
      return { status: 200, body: listChatThreads(cwd) };
    }

    // GET /api/chat/threads/:id — история треда (VL-207): клиент подгружает
    // её при навигации в существующий тред (AC1). Валидация threadId —
    // внутри getChatThread (тот же THREAD_ID_RE, что и в runChat): мусор или
    // отсутствующий файл → 404, без чтения за пределы chat-sessions.
    const chatThreadMatch = url.match(/^\/api\/chat\/threads\/([^/]+)$/);
    if (chatThreadMatch && method === 'GET') {
      const messages = getChatThread(cwd, chatThreadMatch[1]);
      if (!messages) return { status: 404, body: { error: 'Тред не найден' } };
      return { status: 200, body: { threadId: chatThreadMatch[1], messages } };
    }

    // GET /api/config
    if (method === 'GET' && url === '/api/config') {
      const config = loadConfig(cwd);
      // initialStatus — статус «Взять в работу» (Backlog → …) из default
      // workflow (VL-188): кнопка в модалке задачи не хардкодит 'To Do'
      const initialStatus = loadWorkflows(cwd).workflows.default.initial_status;
      return { status: 200, body: { ...config, initialStatus } };
    }

    // PUT /api/config — патч конфига проекта backlog/config.yml (VL-165).
    // Валидация зеркалит CLI `config set`: whitelist ключей defaultConfig,
    // строгие типы (массивы непустых строк / boolean / числа). Неизвестный
    // ключ или мусор → 400, файл не меняется. Запись read-modify-write через
    // saveConfig — как у CLI, комментарии YAML не сохраняются (известное
    // ограничение stringifyYaml).
    if (method === 'PUT' && url === '/api/config') {
      const validated = validateConfigPatch(body);
      if ('error' in validated) return { status: 400, body: { error: validated.error } };
      const config = loadConfig(cwd);
      Object.assign(config, validated.patch);
      // Связка default_status ∈ statuses проверяется по ИТОГОВОМУ конфигу
      // (патч может менять оба поля разом)
      const consistency = checkConfigConsistency(config);
      if (consistency) return { status: 400, body: { error: consistency } };
      saveConfig(cwd, config);
      return { status: 200, body: loadConfig(cwd) };
    }

    // GET /api/settings — настройки для веб-страницы (VL-156).
    // loadBotSettings отдаёт ТОЛЬКО валидированные несекретные поля; env-секция
    // (TELEGRAM_BOT_TOKEN и др.) сюда не попадает — секреты не должны утекать
    // в браузер даже на localhost.
    if (method === 'GET' && url === '/api/settings') {
      // git_user_name (VL-166): резолвим из кэша .vibelog/settings.json или
      // git config → '@agent'. Нужен юзер-меню шапки. resolveGitUserName
      // никогда не бросает (git-спавн в try/catch внутри getGitUserName).
      return {
        status: 200,
        body: { settings: loadBotSettings(cwd), git_user_name: resolveGitUserName(cwd) },
      };
    }

    // PUT /api/settings — патч настроек, зеркало валидации команды /set (VL-156).
    // Неизвестный ключ или битое значение → 400, файл не меняется: веб не должен
    // писать в settings.json мусор, который проигнорирует бот. Запись через
    // saveBotSettings (read-modify-write) сохраняет env-секцию и chats (VL-143).
    if (method === 'PUT' && url === '/api/settings') {
      const validated = validateSettingsPatch(body);
      if ('error' in validated) return { status: 400, body: { error: validated.error } };
      const settings = loadBotSettings(cwd);
      Object.assign(settings, validated.patch);
      saveBotSettings(cwd, settings);
      return { status: 200, body: { settings: loadBotSettings(cwd) } };
    }

    // GET /api/references — список references (VL-174).
    // Тела (body) НЕ отдаём: список показывает только метаданные
    // (type, url/path, tags, linked_tasks); тело грузится на детальной
    // странице через GET /api/references/:id — экономим трафик на больших
    // внешних источниках (тело README у repo-референса может быть мегабайтным).
    if (method === 'GET' && url === '/api/references') {
      const entries = listReferences(cwd);
      return {
        status: 200,
        body: entries.map(e => ({ reference: e.reference, path: e.path })),
      };
    }

    // POST /api/references/sync — клонирование отсутствующих репо (VL-174).
    // ВАЖНО: точное совпадение ДО regex ниже — иначе 'sync' матчится как id.
    // syncReferenceRepos синхронный (spawnSync git clone) — долгое клонирование
    // блокирует event loop; для локального инструмента это приемлемо (как CLI).
    if (method === 'POST' && url === '/api/references/sync') {
      return { status: 200, body: syncReferenceRepos(cwd) };
    }

    // GET/PATCH /api/references/:id — детали и обновление reference (VL-174).
    const refMatch = url.match(/^\/api\/references\/([^/]+)$/);
    if (refMatch && method === 'GET') {
      const entry = getReference(cwd, refMatch[1]);
      if (!entry) return { status: 404, body: { error: 'Reference не найден' } };
      return { status: 200, body: entry };
    }
    if (refMatch && method === 'PATCH') {
      // Предвалидация до updateReference: некорректный type бросил бы
      // normalizeReferenceType → 500, а мусор в tags/link_tasks ушёл бы
      // в md-файл. Ошибки валидации — 400, файл не меняется.
      const updates: UpdateReferenceInput = {};
      if (body?.type !== undefined) {
        const type = String(body.type).toLowerCase();
        if (!REFERENCE_TYPES.includes(type as (typeof REFERENCE_TYPES)[number])) {
          return {
            status: 400,
            body: { error: `Недопустимый тип reference "${body.type}". Допустимые: ${REFERENCE_TYPES.join(', ')}` },
          };
        }
        updates.type = type;
      }
      for (const key of ['tags', 'linked_tasks'] as const) {
        const value = body?.[key];
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
          return { status: 400, body: { error: `${key} — массив строк` } };
        }
        updates[key] = value as string[];
      }
      if (body?.title !== undefined) updates.title = String(body.title);
      if (body?.url !== undefined) updates.url = String(body.url);
      // 'content' — wire-поле тела (совпадает с UpdateReferenceInput)
      if (body?.content !== undefined) updates.content = String(body.content);
      const updated = updateReference(cwd, refMatch[1], updates);
      if (!updated) return { status: 404, body: { error: 'Reference не найден' } };
      return { status: 200, body: updated };
    }

    // GET /api/documents — список документов (VL-181).
    // ВАЖНО: listDocuments/getDocument/writeDocument/updateDocument принимают
    // backlogDir, а НЕ cwd (в отличие от listReferences) — резолвим через
    // findBacklogDir, без backlog отвечаем 400 (паттерн CLI doc/bot handlers).
    // Тела (body) НЕ отдаём: список — только метаданные (title/type/tags/
    // created_date); тело грузится на детальной через GET /api/documents/:id.
    if (method === 'GET' && url === '/api/documents') {
      const backlogDir = findBacklogDir(cwd);
      if (!backlogDir) return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      const entries = listDocuments(backlogDir);
      return {
        status: 200,
        body: entries.map(e => ({ document: e.document, path: e.path })),
      };
    }

    // POST /api/documents — создать документ (VL-181).
    // Точное совпадение ДО regex :id ниже — иначе POST матчится как id.
    // Предвалидация до writeDocument: мусор в type/tags ушёл бы в md-файл
    // (normalizeDocumentType бросил бы → 500). Ошибки валидации — 400.
    if (method === 'POST' && url === '/api/documents') {
      const backlogDir = findBacklogDir(cwd);
      if (!backlogDir) return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      if (!title) return { status: 400, body: { error: 'Укажите заголовок' } };
      if (body?.type !== undefined && body.type !== null && body.type !== '') {
        const type = String(body.type).toLowerCase();
        if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
          return {
            status: 400,
            body: { error: `Недопустимый тип документа "${body.type}". Допустимые: ${DOCUMENT_TYPES.join(', ')}` },
          };
        }
      }
      if (body?.tags !== undefined && body.tags !== null) {
        if (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== 'string')) {
          return { status: 400, body: { error: 'tags — массив строк' } };
        }
      }
      const doc = writeDocument(backlogDir, {
        title,
        type: typeof body?.type === 'string' ? body.type : undefined,
        tags: Array.isArray(body?.tags) ? (body.tags as string[]) : undefined,
        content: typeof body?.content === 'string' ? body.content : '',
      });
      return { status: 201, body: doc };
    }

    // GET/PATCH /api/documents/:id — детали и обновление документа (VL-181).
    const docMatch = url.match(/^\/api\/documents\/([^/]+)$/);
    if (docMatch && method === 'GET') {
      const backlogDir = findBacklogDir(cwd);
      if (!backlogDir) return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      const entry = getDocument(backlogDir, docMatch[1]);
      if (!entry) return { status: 404, body: { error: 'Документ не найден' } };
      return { status: 200, body: entry };
    }
    if (docMatch && method === 'PATCH') {
      const backlogDir = findBacklogDir(cwd);
      if (!backlogDir) return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      // Предвалидация до updateDocument (паттерн PATCH references): некорректный
      // type бросил бы normalizeDocumentType → 500, мусор в tags ушёл бы в файл.
      const updates: UpdateDocumentInput = {};
      if (body?.type !== undefined) {
        const type = String(body.type).toLowerCase();
        if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
          return {
            status: 400,
            body: { error: `Недопустимый тип документа "${body.type}". Допустимые: ${DOCUMENT_TYPES.join(', ')}` },
          };
        }
        updates.type = type;
      }
      if (body?.tags !== undefined) {
        if (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== 'string')) {
          return { status: 400, body: { error: 'tags — массив строк' } };
        }
        updates.tags = body.tags as string[];
      }
      if (body?.title !== undefined) updates.title = String(body.title);
      // 'content' — wire-поле тела (совпадает с UpdateDocumentInput)
      if (body?.content !== undefined) updates.content = String(body.content);
      const updated = updateDocument(backlogDir, docMatch[1], updates);
      if (!updated) return { status: 404, body: { error: 'Документ не найден' } };
      return { status: 200, body: updated };
    }

    // GET /api/lessons — список lessons (VL-182).
    // Паттерн documents (VL-181): core-функции lessons сами резолвят backlog
    // и бросают без него → предпроверка findBacklogDir, 400 вместо 500.
    // Тела (body) НЕ отдаём: список — только метаданные (id/title/status/
    // tags/source_tasks/linked_tasks); тело грузится на детальной странице
    // через GET /api/lessons/:id — экономим трафик (как у references).
    if (method === 'GET' && url === '/api/lessons') {
      if (!findBacklogDir(cwd)) {
        return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      }
      const entries = listLessons(cwd);
      return {
        status: 200,
        body: entries.map(e => ({ lesson: e.lesson, path: e.path })),
      };
    }

    // GET/PATCH /api/lessons/:id — детали и обновление lesson (VL-182).
    const lessonMatch = url.match(/^\/api\/lessons\/([^/]+)$/);
    if (lessonMatch && method === 'GET') {
      if (!findBacklogDir(cwd)) {
        return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      }
      const entry = getLesson(cwd, lessonMatch[1]);
      if (!entry) return { status: 404, body: { error: 'Lesson не найден' } };
      return { status: 200, body: entry };
    }
    if (lessonMatch && method === 'PATCH') {
      if (!findBacklogDir(cwd)) {
        return { status: 400, body: { error: 'Backlog не найден. Выполните: vibelog init' } };
      }
      // Предвалидация до updateLesson (паттерн PATCH references): некорректный
      // status бросил бы normalizeLessonStatus → 500, а мусор в tags ушёл бы
      // в md-файл. Ошибки валидации — 400, файл не меняется.
      // PATCH принимает только редактируемые по AC поля: title/tags/status/
      // content; source_tasks/linked_tasks — read-only из frontmatter.
      const updates: UpdateLessonInput = {};
      if (body?.status !== undefined) {
        const status = String(body.status).toLowerCase();
        if (!LESSON_STATUSES.includes(status)) {
          return {
            status: 400,
            body: { error: `Недопустимый статус lesson "${body.status}". Допустимые: ${LESSON_STATUSES.join(', ')}` },
          };
        }
        updates.status = status;
      }
      if (body?.tags !== undefined) {
        if (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== 'string')) {
          return { status: 400, body: { error: 'tags — массив строк' } };
        }
        updates.tags = body.tags as string[];
      }
      if (body?.title !== undefined) updates.title = String(body.title);
      // 'content' — wire-поле тела (совпадает с UpdateLessonInput)
      if (body?.content !== undefined) updates.content = String(body.content);
      const updated = updateLesson(cwd, lessonMatch[1], updates);
      if (!updated) return { status: 404, body: { error: 'Lesson не найден' } };
      return { status: 200, body: updated };
    }

    // POST /api/tasks — тело приходит из HTTP без гарантий типов
    if (method === 'POST' && url === '/api/tasks') {
      const task = createTaskFile(cwd, (body || {}) as unknown as CreateTaskFileInput);
      return { status: 201, body: task };
    }

    // POST /api/tasks/:id/trigger — запуск фазы (VL-28).
    // ВАЖНО: роут обязан стоять ДО общего getMatch ниже — иначе
    // 'VL-28/trigger' матчится как id задачи.
    const triggerMatch = url.match(/^\/api\/tasks\/([^/]+)\/trigger$/);
    if (triggerMatch && method === 'POST') {
      const task = getTask(cwd, triggerMatch[1]);
      if (!task) return { status: 404, body: { error: 'Задача не найдена' } };
      const phase = typeof body?.phase === 'string' ? body.phase : '';
      // VL-172: комментарий пользователя к запуску фазы (как в боте:
      // /plan VL-1 текст или кнопка «Комментарий»). Фаза comment без текста —
      // ошибка 400 (шаблон phase-comment требует {{comment}}).
      const comment =
        typeof body?.comment === 'string' ? body.comment.trim() : '';
      if (phase === 'comment' && !comment) {
        return { status: 400, body: { error: 'Требуется комментарий' } };
      }
      // Порядок как в commitComment бота (VL-60): комментарий пишется ДО
      // запуска — taskExtraVars(startPhase) перечитывает задачу, поэтому
      // {{taskLastComment}} close-промпта уже содержит его; при ошибке
      // запуска комментарий НЕ откатывается (семантика бота).
      //
      // VL-147: sameSession — явное переопределение настройки code_same_session
      // для фазы code (продолжение plan-сессии через --resume)
      const sameSession = typeof body?.sameSession === 'boolean' ? body.sameSession : undefined;
      // VL-180: общий хелпер бота и веб (startTaskPhase): addComment до старта
      // внутри, агент — default_agent из .vibelog/settings.json (без хардкода
      // 'qwen' — запуск фаз из браузера использует настройки проекта)
      const result = startTaskPhase(cwd, triggerMatch[1], phase, { comment, sameSession });
      if ('error' in result) {
        return {
          status: 409,
          body: {
            error: comment
              ? `Комментарий добавлен, но запуск не удался: ${result.error}`
              : result.error,
          },
        };
      }
      return { status: 202, body: result };
    }

    // GET /api/tasks/:id/trigger — состояние запуска фазы
    if (triggerMatch && method === 'GET') {
      return { status: 200, body: getRun(triggerMatch[1]) ?? { running: false } };
    }

    // POST /api/tasks/:id/reject — отклонить задачу (VL-144).
    // Матч ДО общего getMatch ниже (иначе 'VL-N/reject' — id задачи).
    // Никогда не бывшая в Code: синхронная механика → 200 {rejected:true}.
    // Была в Code: запуск LLM-фазы reject → 202 {started,pid}; статус+архив
    // применяются в onExit завершения фазы ( rejectTask сам ). Ошибка
    // валидации/guard (задача не найдена, запуск уже выполняется) → 404/409.
    const rejectMatch = url.match(/^\/api\/tasks\/([^/]+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      const comment = typeof body?.comment === 'string' ? body.comment : '';
      const result = rejectTask(cwd, rejectMatch[1], comment);
      if ('rejected' in result) return { status: 200, body: { rejected: true } };
      if ('error' in result) {
        const status = result.error.startsWith('Задача не найдена') ? 404 : 409;
        return { status, body: { error: result.error } };
      }
      return { status: 202, body: result };
    }

    // GET /api/tasks/:id
    const getMatch = url.match(/^\/api\/tasks\/(.+)$/);
    if (method === 'GET' && getMatch) {
      const task = getTask(cwd, getMatch[1]);
      if (!task) return { status: 404, body: { error: 'Задача не найдена' } };
      // availablePhases/startTo по workflow задачи (VL-188) — кнопки модалки
      return { status: 200, body: enrichWithWorkflow(cwd, task) }; 
    }

    // PATCH /api/tasks/:id
    if (method === 'PATCH' && getMatch) {
      const current = getTask(cwd, getMatch[1]);
      if (!current) return { status: 404, body: { error: 'Задача не найдена' } };
      const patch = (body || {}) as Partial<Task>;
      // Предвалидация перехода статуса ДО записи файла (VL-188, lesson-36):
      // канбан-доска/модалка не должны двигать задачу без транзита workflow.
      // Смена НЕ статуса (title, priority, …) не проверяется.
      if (typeof patch.status === 'string' && patch.status !== current.status) {
        const workflow = getWorkflowForTask(cwd, current);
        if (!canMoveTo(workflow, current.status, patch.status)) {
          return {
            status: 400,
            body: { error: `Переход «${current.status}» → «${patch.status}» недоступен по workflow задачи` },
          };
        }
      }
      const task = updateTaskFile(cwd, getMatch[1], patch);
      // triggerPhase — фаза, производящая новый статус (канбан запускает её
      // после успешного переноса; смена статуса мимо перехода сюда не попадает)
      const produced = getWorkflowForTask(cwd, task).transitions.find(
        (t) => t.status === current.status && t.produces_status === task.status
      );
      return {
        status: 200,
        body: { ...task, triggerPhase: typeof patch.status === 'string' ? (produced?.phase ?? null) : undefined },
      };
    }

    // DELETE /api/tasks/:id
    if (method === 'DELETE' && getMatch) {
      archiveTaskFile(cwd, getMatch[1]);
      return { status: 200, body: { success: true } };
    }

    return { status: 404, body: { error: 'Не найдено' } };
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } };
  }
}

/**
 * Валидация патча настроек из PUT /api/settings (VL-156) — зеркало команды /set.
 *
 * Правила (как в bot/handlers.ts и loadBotSettings):
 * - default_agent: только 'qwen' | 'vb';
 * - max_wall_time / max_requests: положительное целое; 0 или null — явный
 *   сброс (undefined → saveBotSettings удалит ключ, дефолт агента);
 * - branch_mode / compact / code_same_session: строго boolean;
 * - неизвестные ключи → 400: веб не пишет в settings.json то, что бот
 *   проигнорирует или сломает.
 *
 * @returns patch — валидированные поля для Object.assign в BotSettings,
 *   либо error — текст ошибки (HTTP 400, файл не меняется)
 */
/**
 * Обогащение задачи полями workflow (VL-188): availablePhases — кнопки фаз;
 * startTo — целевой статус ручного «Взятия в работу» (Backlog → initial_status),
 * null — кнопка не нужна. Веб не импортирует fs-модуль workflow — считает сервер.
 */
function enrichWithWorkflow(cwd: string, task: Task): Record<string, unknown> {
  const workflow = getWorkflowForTask(cwd, task);
  const canStart =
    task.status !== workflow.initial_status && canMoveTo(workflow, task.status, workflow.initial_status);
  // VL-195: phaseLabels/phaseEmojis — подписи/эмодзи кнопок из настроек
  // (settings > хардкод phase-buttons > имя фазы — fallback считает клиент)
  const styles = loadPhaseStyles(cwd);
  return {
    ...task,
    availablePhases: getAvailablePhases(workflow, task.status),
    startTo: canStart ? workflow.initial_status : null,
    phaseLabels: styles.labels,
    phaseEmojis: styles.emojis,
  };
}

function validateSettingsPatch(
  body: Record<string, unknown> | null
): { patch: Partial<BotSettings> } | { error: string } {
  const patch: Partial<BotSettings> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    switch (key) {
      case 'default_agent':
        // Discriminated union как в /set: известные значения фиксируем
        if (value !== 'qwen' && value !== 'vb') {
          return { error: `default_agent: ожидается 'qwen' или 'vb', получено ${JSON.stringify(value)}` };
        }
        patch.default_agent = value;
        break;
      case 'max_wall_time':
      case 'max_requests': {
        // 0/null — сброс (undefined удалит ключ); иначе положительное целое.
        // Number(null) === 0 и Number('') === 0 — оба идут в сброс
        if (value === null || value === 0) {
          patch[key] = undefined;
          break;
        }
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          return { error: `${key}: ожидается положительное целое (или 0/null — сброс), получено ${JSON.stringify(value)}` };
        }
        patch[key] = n;
        break;
      }
      case 'branch_mode':
      case 'compact':
      case 'code_same_session':
        // Строго boolean: строка 'true' или мусор → 400, а не молчаливый off
        if (typeof value !== 'boolean') {
          return { error: `${key}: ожидается boolean, получено ${JSON.stringify(value)}` };
        }
        patch[key] = value;
        break;
      default:
        return { error: `Неизвестный ключ настройки: ${key}` };
    }
  }
  return { patch };
}

/** Типы ключей конфига — как в CLI config set (ARRAY/BOOLEAN/NUMBER_KEYS). */
const CONFIG_ARRAY_KEYS = ['statuses', 'labels', 'priorities', 'types', 'definition_of_done'];
const CONFIG_BOOLEAN_KEYS = [
  'auto_open_browser',
  'remote_operations',
  'auto_commit',
  'bypass_git_hooks',
  'check_active_branches',
];
const CONFIG_NUMBER_KEYS = ['default_port', 'active_branch_days', 'max_column_width'];
const CONFIG_STRING_KEYS = [
  'project_name',
  'task_prefix',
  'default_status',
  'date_format',
  'default_editor',
];

/**
 * Валидация патча конфига из PUT /api/config (VL-165) — зеркало CLI config set.
 *
 * Whitelist ключей — Object.keys(defaultConfig): веб не пишет в config.yml
 * то, что доска/CLI проигнорируют. Строгие типы: массивы — только непустые
 * строки, boolean-ключи — строго true/false, числа — Number.isFinite,
 * строки — непустые. default_editor допускает пустую строку (дефолт —
 * «открывать системный»).
 *
 * @returns patch — валидированные поля для Object.assign в конфиг,
 *   либо error — текст ошибки (HTTP 400, файл не меняется)
 */
function validateConfigPatch(
  body: Record<string, unknown> | null
): { patch: Record<string, unknown> } | { error: string } {
  const allowed = Object.keys(defaultConfig('x', 'x'));
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (!allowed.includes(key)) return { error: `Неизвестный ключ конфига: ${key}` };
    if (CONFIG_ARRAY_KEYS.includes(key)) {
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || v.trim() === '')) {
        return { error: `${key}: ожидается массив непустых строк, получено ${JSON.stringify(value)}` };
      }
      patch[key] = value.map(v => String(v).trim());
    } else if (CONFIG_BOOLEAN_KEYS.includes(key)) {
      if (typeof value !== 'boolean') {
        return { error: `${key}: ожидается boolean, получено ${JSON.stringify(value)}` };
      }
      patch[key] = value;
    } else if (CONFIG_NUMBER_KEYS.includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `${key}: ожидается положительное число, получено ${JSON.stringify(value)}` };
      }
      patch[key] = n;
    } else if (CONFIG_STRING_KEYS.includes(key)) {
      if (typeof value !== 'string' || (value.trim() === '' && key !== 'default_editor')) {
        return { error: `${key}: ожидается непустая строка, получено ${JSON.stringify(value)}` };
      }
      patch[key] = value.trim();
    }
  }
  return { patch };
}

/**
 * Связки итогового конфига после патча (VL-165): default_status ∈ statuses.
 *
 * Без проверки доска получит колонку-призрак: карточки со статусом вне
 * списка statuses не отображаются на канбане.
 *
 * @returns текст ошибки (HTTP 400) либо null, если конфиг консистентен
 */
function checkConfigConsistency(config: Record<string, unknown>): string | null {
  const statuses = Array.isArray(config.statuses) ? config.statuses.map(String) : [];
  const defaultStatus = typeof config.default_status === 'string' ? config.default_status : '';
  if (defaultStatus && !statuses.includes(defaultStatus)) {
    return `default_status "${defaultStatus}" отсутствует в statuses [${statuses.join(', ')}]`;
  }
  return null;
}
