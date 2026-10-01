/**
 * Inline HTML/CSS/JS для веб-интерфейса Vibelog.md.
 *
 * Весь UI в одном HTML-блоке: стили, скрипты, разметка.
 * Без CDN, без внешних зависимостей.
 *
 * Фичи:
 * - Канбан-доска с drag-and-drop
 * - Форма создания/редактирования задач
 * - Редактор AC (чеклисты)
 * - Тёмная/светлая тема
 * - Всё на русском
 */

export function getAssetsHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vibelog.md — Доска задач</title>
<style>
:root {
  --bg: #f5f5f5; --bg2: #fff; --text: #1a1a1a; --text2: #666;
  --border: #ddd; --accent: #2563eb; --accent2: #1d4ed8;
  --green: #16a34a; --red: #dc2626; --yellow: #ca8a04;
  --card-shadow: 0 1px 3px rgba(0,0,0,.1);
}
[data-theme="dark"] {
  --bg: #111; --bg2: #1e1e1e; --text: #e5e5e5; --text2: #999;
  --border: #333; --accent: #3b82f6; --accent2: #60a5fa;
  --green: #22c55e; --red: #ef4444; --yellow: #eab308;
  --card-shadow: 0 1px 3px rgba(0,0,0,.4);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:var(--bg); color:var(--text); }
.header { display:flex; justify-content:space-between; align-items:center; padding:12px 20px; background:var(--bg2); border-bottom:1px solid var(--border); }
.header h1 { font-size:18px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.btn { padding:6px 14px; border:1px solid var(--border); border-radius:6px; background:var(--bg2); color:var(--text); cursor:pointer; font-size:13px; }
.btn:hover { background:var(--accent); color:#fff; border-color:var(--accent); }
.btn-primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.btn-primary:hover { background:var(--accent2); }
.board { display:flex; gap:12px; padding:16px; overflow-x:auto; min-height:calc(100vh - 56px); }
.column { min-width:260px; max-width:320px; flex:1; background:var(--bg2); border-radius:8px; border:1px solid var(--border); display:flex; flex-direction:column; }
.column-header { padding:10px 14px; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:var(--text2); border-bottom:1px solid var(--border); display:flex; justify-content:space-between; }
.column-header .count { background:var(--border); border-radius:10px; padding:1px 8px; font-size:11px; }
.column-body { padding:8px; flex:1; min-height:100px; }
.card { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; margin-bottom:8px; cursor:grab; box-shadow:var(--card-shadow); transition:box-shadow .15s; }
.card:hover { box-shadow:0 2px 8px rgba(0,0,0,.15); }
.card.dragging { opacity:.5; }
.card-id { font-size:11px; color:var(--text2); font-weight:600; }
.card-title { font-size:14px; margin:4px 0; }
.card-meta { display:flex; gap:4px; flex-wrap:wrap; }
.tag { font-size:11px; padding:1px 6px; border-radius:4px; background:var(--border); color:var(--text2); }
.tag-priority-high { background:#fecaca; color:#991b1b; }
.tag-priority-medium { background:#fef3c7; color:#92400e; }
.tag-priority-low { background:#d1fae5; color:#065f46; }
[data-theme="dark"] .tag-priority-high { background:#7f1d1d; color:#fca5a5; }
[data-theme="dark"] .tag-priority-medium { background:#78350f; color:#fcd34d; }
[data-theme="dark"] .tag-priority-low { background:#064e3b; color:#6ee7b7; }
.modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:100; justify-content:center; align-items:center; }
.modal-overlay.active { display:flex; }
.modal { background:var(--bg2); border-radius:10px; padding:24px; width:500px; max-width:90vw; max-height:85vh; overflow-y:auto; }
.modal h2 { margin-bottom:16px; font-size:18px; }
.form-group { margin-bottom:12px; }
.form-group label { display:block; font-size:13px; font-weight:600; margin-bottom:4px; color:var(--text2); }
.form-group input, .form-group textarea, .form-group select { width:100%; padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:14px; }
.form-group textarea { min-height:80px; resize:vertical; font-family:inherit; }
.ac-list { list-style:none; }
.ac-list li { display:flex; align-items:center; gap:8px; padding:4px 0; }
.ac-list li input[type="checkbox"] { width:auto; }
.ac-list li input[type="text"] { flex:1; }
.ac-list li button { background:none; border:none; color:var(--red); cursor:pointer; font-size:16px; }
.modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; }
.drop-zone { border:2px dashed transparent; border-radius:6px; min-height:60px; transition:border-color .2s; }
.drop-zone.drag-over { border-color:var(--accent); }
</style>
</head>
<body>
<div class="header">
  <h1>📋 Vibelog.md</h1>
  <div class="header-actions">
    <button class="btn" onclick="toggleTheme()" id="themeBtn">🌙</button>
    <button class="btn btn-primary" onclick="openCreateModal()">+ Создать задачу</button>
  </div>
</div>
<div class="board" id="board"></div>

<!-- Модалка создания/редактирования -->
<div class="modal-overlay" id="modal">
  <div class="modal">
    <h2 id="modalTitle">Новая задача</h2>
    <input type="hidden" id="editId">
    <div class="form-group">
      <label>Заголовок</label>
      <input type="text" id="fTitle" placeholder="Что нужно сделать?">
    </div>
    <div class="form-group">
      <label>Описание</label>
      <textarea id="fDesc" placeholder="Подробности..."></textarea>
    </div>
    <div class="form-group" style="display:flex;gap:8px">
      <div style="flex:1"><label>Приоритет</label>
        <select id="fPriority"><option value="">—</option><option>High</option><option>Medium</option><option>Low</option></select></div>
      <div style="flex:1"><label>Статус</label>
        <select id="fStatus"></select></div>
    </div>
    <div class="form-group">
      <label>Метки (через запятую)</label>
      <input type="text" id="fLabels" placeholder="bug, feature">
    </div>
    <div class="form-group">
      <label>Критерии приёмки</label>
      <ul class="ac-list" id="acList"></ul>
      <button class="btn" onclick="addAc()" style="margin-top:4px">+ Критерий</button>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-primary" onclick="saveTask()">Сохранить</button>
    </div>
  </div>
</div>

<script>
let tasks = [];
let config = { statuses: ['To Do','In Progress','Review','Done','Blocked'] };
let draggedId = null;

// --- Загрузка данных ---
async function loadData() {
  const [tasksRes, configRes] = await Promise.all([
    fetch('/api/tasks'), fetch('/api/config')
  ]);
  tasks = await tasksRes.json();
  config = await configRes.json();
  renderBoard();
}

// --- Рендер доски ---
function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const statuses = config.statuses || ['To Do','In Progress','Done'];
  for (const status of statuses) {
    const col = document.createElement('div');
    col.className = 'column';
    const items = tasks.filter(t => t.status === status);
    col.innerHTML = '<div class="column-header"><span>' + esc(status) + '</span><span class="count">' + items.length + '</span></div>';
    const body = document.createElement('div');
    body.className = 'column-body drop-zone';
    body.dataset.status = status;
    body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag-over'); });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', e => { e.preventDefault(); body.classList.remove('drag-over'); dropTask(status); });
    for (const task of items) {
      body.appendChild(createCard(task));
    }
    col.appendChild(body);
    board.appendChild(col);
  }
}

function createCard(task) {
  const card = document.createElement('div');
  card.className = 'card';
  card.draggable = true;
  card.dataset.id = task.id;
  card.addEventListener('dragstart', e => { draggedId = task.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); draggedId = null; });
  card.addEventListener('click', () => openEditModal(task.id));
  let priorityTag = '';
  if (task.priority) {
    const cls = task.priority === 'High' ? 'tag-priority-high' : task.priority === 'Medium' ? 'tag-priority-medium' : 'tag-priority-low';
    priorityTag = '<span class="tag ' + cls + '">' + esc(task.priority) + '</span>';
  }
  let labelsHtml = '';
  if (task.labels && task.labels.length) {
    labelsHtml = task.labels.map(l => '<span class="tag">' + esc(l) + '</span>').join('');
  }
  card.innerHTML = '<div class="card-id">' + esc(task.id) + '</div><div class="card-title">' + esc(task.title) + '</div><div class="card-meta">' + priorityTag + labelsHtml + '</div>';
  return card;
}

// --- Drag & Drop ---
async function dropTask(newStatus) {
  if (!draggedId) return;
  await fetch('/api/tasks/' + draggedId, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:newStatus}) });
  loadData();
}

// --- Тема ---
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
  document.getElementById('themeBtn').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}
(function(){ const t = localStorage.getItem('theme'); if(t==='dark'){ document.documentElement.setAttribute('data-theme','dark'); document.getElementById('themeBtn').textContent='☀️'; }})();

// --- Модалка ---
function openCreateModal() {
  document.getElementById('modalTitle').textContent = 'Новая задача';
  document.getElementById('editId').value = '';
  document.getElementById('fTitle').value = '';
  document.getElementById('fDesc').value = '';
  document.getElementById('fPriority').value = '';
  document.getElementById('fLabels').value = '';
  populateStatusSelect();
  document.getElementById('fStatus').value = config.default_status || 'To Do';
  document.getElementById('acList').innerHTML = '';
  document.getElementById('modal').classList.add('active');
  document.getElementById('fTitle').focus();
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('modalTitle').textContent = 'Редактировать: ' + task.title;
  document.getElementById('editId').value = task.id;
  document.getElementById('fTitle').value = task.title;
  document.getElementById('fDesc').value = task.description || '';
  document.getElementById('fPriority').value = task.priority || '';
  document.getElementById('fLabels').value = (task.labels || []).join(', ');
  populateStatusSelect();
  document.getElementById('fStatus').value = task.status;
  const acList = document.getElementById('acList');
  acList.innerHTML = '';
  for (const ac of (task.acceptanceCriteria || [])) {
    addAc(ac.text, ac.checked);
  }
  document.getElementById('modal').classList.add('active');
}

function closeModal() { document.getElementById('modal').classList.remove('active'); }

function populateStatusSelect() {
  const sel = document.getElementById('fStatus');
  sel.innerHTML = '';
  for (const s of (config.statuses || [])) {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  }
}

function addAc(text, checked) {
  const li = document.createElement('li');
  li.innerHTML = '<input type="checkbox"' + (checked ? ' checked' : '') + '><input type="text" value="' + esc(text||'') + '" placeholder="Критерий..."><button onclick="this.parentElement.remove()">×</button>';
  document.getElementById('acList').appendChild(li);
}

async function saveTask() {
  const id = document.getElementById('editId').value;
  const title = document.getElementById('fTitle').value.trim();
  if (!title) { alert('Введите заголовок'); return; }
  const acItems = [];
  document.querySelectorAll('#acList li').forEach(li => {
    const text = li.querySelector('input[type="text"]').value.trim();
    const checked = li.querySelector('input[type="checkbox"]').checked;
    if (text) acItems.push({ text, checked });
  });
  const body = {
    title,
    description: document.getElementById('fDesc').value,
    priority: document.getElementById('fPriority').value,
    status: document.getElementById('fStatus').value,
    labels: document.getElementById('fLabels').value.split(',').map(s=>s.trim()).filter(Boolean),
    acceptanceCriteria: acItems,
  };
  if (id) {
    await fetch('/api/tasks/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  } else {
    await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  }
  closeModal();
  loadData();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// --- Клавиатура ---
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// --- Старт ---
loadData();
</script>
</body>
</html>`;
}
