# IMP-08 — Dashboard: voortgangsmonitor voor de eigenaar

**Status:** open  
**Prioriteit:** 🟠 Hoog  
**Geschatte tijd:** 4-6 uur  
**Afhankelijk van:** IMP-01, IMP-03, IMP-06  
**Raakt aan:** Nieuwe n8n workflow SDLC Dashboard API, nieuwe statische webpagina

---

## Probleem

Er is geen visueel overzicht van de pipeline-status. De eigenaar moet individuele bestanden in Gitea opzoeken of Telegram-berichten bijhouden om te weten wat er speelt. Er is geen historisch overzicht, geen doorlooptijd-inzicht, en geen centrale plek die de status van alle projecten combineert.

---

## Architectuur

```
Browser → Dashboard (Coolify statisch geserveerd)
       → JavaScript haalt data op via n8n webhook
       → n8n aggregeert data uit Gitea API
       → Dashboard rendert real-time status
```

Voordeel van n8n als tussenlaag:
- Geen Gitea API token in de browser
- Gecachede data (n8n kan cachen, Gitea API heeft rate limits)
- Eenvoudiger te beveiligen (n8n webhook met secret header)

---

## Stap 1 — n8n workflow: `SDLC Dashboard API`

### Trigger

**Webhook**: `GET /sdlc-dashboard`  
Authenticatie: Header `X-Dashboard-Secret: {{ $env.DASHBOARD_SECRET }}`

### Node 1 — Valideer secret

```javascript
const secret = $input.first().json.headers['x-dashboard-secret'];
if (secret !== $env.DASHBOARD_SECRET) {
  // Respond with 401
  return [{ json: { error: 'Unauthorized' } }];
}
return [{ json: { authenticated: true } }];
```

### Node 2 — Haal alle backlog bestanden op

```
HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/branches/main
→ Extract commit.id (tree SHA)

HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/git/trees/{{ tree_sha }}?recursive=true
→ Filter: path matches projects/*/backlog/**/*.md
```

### Node 3 — Haal inhoud op per bestand (parallel, gebatcht)

Gebruik **Split In Batches** (batch size 10) + parallel HTTP calls:
```
HTTP GET .../contents/{path}
Authorization: token {{ $env.GITEA_TOKEN }}
```

### Node 4 — Parse alle frontmatters

```javascript
const files = $input.all();
const items = [];

files.forEach(f => {
  const file = f.json;
  if (!file.content) return;
  
  const content = Buffer.from(file.content, 'base64').toString('utf8');
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fmMatch) return;
  
  const fm = {};
  fmMatch[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    fm[key] = val;
  });
  
  items.push({
    id: fm.id,
    type: fm.type,
    project: fm.project,
    title: fm.title,
    status: fm.status,
    priority: fm.priority,
    created: fm.created,
    processing_started: fm.processing_started || null,
    processing_updated: fm.processing_updated || null,
    current_agent: fm.current_agent || null,
    retry_count: parseInt(fm.retry_count) || 0,
    last_error: fm.last_error || null,
    api_cost_usd: parseFloat(fm.api_cost_usd) || 0,
    deployed_at: fm.deployed_at || null,
    file_path: file.path || file.url?.split('/contents/')[1]
  });
});

return [{ json: { items, generated_at: new Date().toISOString() } }];
```

### Node 5 — Haal LOCK.json op

```
HTTP GET .../contents/LOCK.json
→ Parse: { locked, locked_by, locked_at, pipeline_step }
```

### Node 6 — Haal QUEUE.json op

```
HTTP GET .../contents/QUEUE.json
→ Parse: { queue, last_updated }
```

### Node 7 — Aggregeer en respond

```javascript
const items = $('Parse Frontmatters').first().json.items;
const lock = $('Get Lock').first().json;
const queue = $('Get Queue').first().json;
const now = new Date();

// Statistieken
const STALE_MS = 30 * 60 * 1000;
const TERMINAL = ['documented', 'needs-human', 'deploy-failed'];

const stats = {
  total: items.length,
  by_status: {},
  by_project: {},
  needs_attention: [],
  throughput: {
    completed_today: 0,
    completed_this_week: 0,
    avg_cycle_time_hours: 0
  },
  costs: {
    total: 0,
    today: 0
  }
};

const today = now.toISOString().split('T')[0];
let cycleTimes = [];

items.forEach(item => {
  // Status verdeling
  stats.by_status[item.status] = (stats.by_status[item.status] || 0) + 1;
  
  // Project verdeling
  if (!stats.by_project[item.project]) {
    stats.by_project[item.project] = { total: 0, active: 0, completed: 0 };
  }
  stats.by_project[item.project].total++;
  
  if (item.status === 'documented') {
    stats.by_project[item.project].completed++;
    if (item.processing_updated?.startsWith(today)) {
      stats.throughput.completed_today++;
    }
    if (item.processing_started && item.processing_updated) {
      const cycleMs = new Date(item.processing_updated) - new Date(item.processing_started);
      cycleTimes.push(cycleMs / 3600000); // omzetten naar uren
    }
  } else if (!['new'].includes(item.status)) {
    stats.by_project[item.project].active++;
  }
  
  // Aandacht
  const attention = [];
  if (item.status === 'needs-human') attention.push({ type: 'needs_human', msg: item.last_error });
  if (item.retry_count >= 2) attention.push({ type: 'high_retry', msg: `${item.retry_count}x retry` });
  if (!TERMINAL.includes(item.status) && item.status !== 'new' && item.processing_updated) {
    const ageMs = now - new Date(item.processing_updated);
    if (ageMs > STALE_MS) {
      attention.push({ type: 'stale', msg: `${Math.round(ageMs / 60000)} min geen activiteit` });
    }
  }
  if (attention.length > 0) {
    stats.needs_attention.push({ ...item, attention });
  }
  
  // Kosten
  stats.costs.total += item.api_cost_usd;
  if (item.processing_updated?.startsWith(today)) {
    stats.costs.today += item.api_cost_usd;
  }
});

// Gemiddelde doorlooptijd
if (cycleTimes.length > 0) {
  stats.throughput.avg_cycle_time_hours = Math.round(
    cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length * 10
  ) / 10;
}

// Rond kosten af
stats.costs.total = Math.round(stats.costs.total * 10000) / 10000;
stats.costs.today = Math.round(stats.costs.today * 10000) / 10000;

return [{
  json: {
    items,
    stats,
    lock,
    queue: queue.queue || [],
    generated_at: new Date().toISOString()
  }
}];
```

### Node 8 — Respond met JSON

```
Respond to Webhook node:
Content-Type: application/json
Response: {{ $json }}
```

Voeg ook CORS-header toe:
```
Access-Control-Allow-Origin: https://dashboard.7rb.nl
```

---

## Stap 2 — n8n environment variabele toevoegen

```
n8n → Settings → Variables → Toevoegen:
Naam: DASHBOARD_SECRET
Waarde: openssl rand -hex 24  (genereer eenmalig)
```

---

## Stap 3 — Dashboard bestanden aanmaken

Maak de volgende mapstructuur aan in de `sdlc-platform` repo:

```
sdlc-platform/
└── dashboard/
    ├── index.html
    ├── style.css
    └── app.js
```

### `dashboard/index.html`

```html
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SDLC Pipeline Monitor</title>
  <meta name="description" content="Real-time voortgangsmonitor voor de SDLC pipeline">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <header class="header">
      <div class="header-inner">
        <div class="logo">
          <span class="logo-icon">⚡</span>
          <span class="logo-text">SDLC Monitor</span>
        </div>
        <div class="header-meta">
          <span id="lock-status" class="lock-badge lock-free">✅ Pipeline vrij</span>
          <span id="last-updated" class="meta-text">Laden...</span>
          <button id="refresh-btn" class="btn-refresh" onclick="loadData()">↻ Verversen</button>
        </div>
      </div>
    </header>

    <main class="main">
      <!-- Statistieken bovenaan -->
      <section class="stats-grid" id="stats-grid">
        <div class="stat-card" id="stat-active">
          <span class="stat-number">—</span>
          <span class="stat-label">Actief in pipeline</span>
        </div>
        <div class="stat-card" id="stat-attention">
          <span class="stat-number">—</span>
          <span class="stat-label">Aandacht vereist</span>
        </div>
        <div class="stat-card" id="stat-completed-today">
          <span class="stat-number">—</span>
          <span class="stat-label">Voltooid vandaag</span>
        </div>
        <div class="stat-card" id="stat-cost">
          <span class="stat-number">—</span>
          <span class="stat-label">API kosten vandaag</span>
        </div>
        <div class="stat-card" id="stat-queue">
          <span class="stat-number">—</span>
          <span class="stat-label">In wachtrij</span>
        </div>
        <div class="stat-card" id="stat-cycle-time">
          <span class="stat-number">—</span>
          <span class="stat-label">Gem. doorlooptijd</span>
        </div>
      </section>

      <!-- Aandacht sectie -->
      <section class="attention-section" id="attention-section" style="display:none">
        <h2 class="section-title">⚠️ Aandacht vereist</h2>
        <div id="attention-items" class="attention-grid"></div>
      </section>

      <!-- Kanban bord -->
      <section class="kanban-section">
        <h2 class="section-title">📋 Pipeline Status</h2>
        <div class="kanban-board" id="kanban-board">
          <!-- Dynamisch gevuld door app.js -->
        </div>
      </section>

      <!-- Per project overzicht -->
      <section class="projects-section">
        <h2 class="section-title">📦 Per Project</h2>
        <div id="projects-grid" class="projects-grid"></div>
      </section>
    </main>
  </div>

  <script>
    // Config — pas aan voor jouw omgeving
    const CONFIG = {
      apiUrl: 'https://n8n.7rb.nl/webhook/sdlc-dashboard',
      dashboardSecret: 'VERVANG_MET_JOUW_SECRET', // zelfde als DASHBOARD_SECRET in n8n
      refreshInterval: 60000 // 60 seconden auto-refresh
    };
  </script>
  <script src="app.js"></script>
</body>
</html>
```

### `dashboard/style.css`

```css
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-card: #1c2128;
  --bg-card-hover: #212830;
  --border: #30363d;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --accent-blue: #388bfd;
  --accent-green: #3fb950;
  --accent-orange: #d29922;
  --accent-red: #f85149;
  --accent-purple: #bc8cff;
  --accent-yellow: #e3b341;
  
  /* Status kleuren */
  --status-new: #6e7681;
  --status-triaged: #388bfd;
  --status-planned: #bc8cff;
  --status-in-progress: #d29922;
  --status-review: #e3b341;
  --status-testing: #58a6ff;
  --status-done: #3fb950;
  --status-documented: #238636;
  --status-needs-human: #f85149;
  --status-deploy-failed: #da3633;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
}

/* Header */
.header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-inner {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 16px;
}

.logo-icon { font-size: 20px; }

.header-meta {
  display: flex;
  align-items: center;
  gap: 16px;
}

.lock-badge {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid;
}

.lock-free {
  color: var(--accent-green);
  border-color: var(--accent-green);
  background: rgba(63, 185, 80, 0.1);
}

.lock-busy {
  color: var(--accent-orange);
  border-color: var(--accent-orange);
  background: rgba(210, 153, 34, 0.1);
}

.meta-text { font-size: 12px; color: var(--text-muted); }

.btn-refresh {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-refresh:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

/* Main */
.main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text-primary);
}

/* Stats grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: border-color 0.2s;
}

.stat-card:hover { border-color: var(--accent-blue); }

.stat-number {
  font-size: 28px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  color: var(--accent-blue);
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Attention section */
.attention-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.attention-card {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 16px;
  border-left: 3px solid;
}

.attention-card.needs-human { border-color: var(--accent-red); }
.attention-card.high-retry { border-color: var(--accent-orange); }
.attention-card.stale { border-color: var(--accent-yellow); }

.attention-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.item-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.attention-reason {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Kanban board */
.kanban-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.kanban-column {
  min-width: 180px;
  flex: 1;
}

.kanban-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px 6px 0 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-bottom: none;
}

.kanban-items {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 6px 6px;
  padding: 8px;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kanban-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  cursor: default;
  transition: all 0.2s;
}

.kanban-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent-blue);
}

.kanban-card-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--accent-blue);
  font-weight: 600;
}

.kanban-card-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kanban-card-meta {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.badge-priority-critical { background: rgba(248,81,73,0.2); color: var(--accent-red); }
.badge-priority-high { background: rgba(210,153,34,0.2); color: var(--accent-orange); }
.badge-priority-medium { background: rgba(88,166,255,0.2); color: var(--accent-blue); }
.badge-priority-low { background: rgba(110,118,129,0.2); color: var(--text-muted); }

/* Projects grid */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}

.project-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
}

.project-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
}

.project-bar {
  height: 8px;
  background: var(--bg-primary);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.project-bar-fill {
  height: 100%;
  background: var(--accent-green);
  border-radius: 4px;
  transition: width 0.5s ease;
}

.project-stats {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}

/* Loading state */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted);
  font-size: 14px;
}
```

### `dashboard/app.js`

```javascript
const STATUSES = [
  'new', 'triaged', 'planned', 'in-progress',
  'review', 'testing', 'staging-verified', 'done', 'documented'
];

const STATUS_LABELS = {
  'new': 'Nieuw',
  'triaged': 'Triaged',
  'planned': 'Gepland',
  'in-progress': 'In uitvoering',
  'review': 'Review',
  'testing': 'Testing',
  'staging-verified': 'Staging OK',
  'done': 'Klaar',
  'documented': 'Gedocumenteerd',
  'needs-human': 'Menselijke input',
  'deploy-failed': 'Deploy gefaald'
};

let refreshTimer = null;

async function loadData() {
  document.getElementById('last-updated').textContent = 'Laden...';
  
  try {
    const response = await fetch(CONFIG.apiUrl, {
      headers: {
        'X-Dashboard-Secret': CONFIG.dashboardSecret
      }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    renderDashboard(data);
    
    const now = new Date().toLocaleTimeString('nl-NL');
    document.getElementById('last-updated').textContent = `Bijgewerkt: ${now}`;
    
  } catch (err) {
    document.getElementById('last-updated').textContent = `Fout: ${err.message}`;
    console.error('Dashboard load error:', err);
  }
}

function renderDashboard(data) {
  const { items, stats, lock, queue } = data;
  
  renderLockStatus(lock, queue);
  renderStats(stats, queue);
  renderAttention(stats.needs_attention);
  renderKanban(items);
  renderProjects(stats.by_project);
}

function renderLockStatus(lock, queue) {
  const el = document.getElementById('lock-status');
  if (lock?.locked) {
    el.textContent = `🔒 Bezig: ${lock.locked_by}`;
    el.className = 'lock-badge lock-busy';
  } else {
    el.textContent = '✅ Pipeline vrij';
    el.className = 'lock-badge lock-free';
  }
}

function renderStats(stats, queue) {
  const inPipeline = STATUSES
    .filter(s => !['new', 'documented'].includes(s))
    .reduce((sum, s) => sum + (stats.by_status[s] || 0), 0);
  
  setStatCard('stat-active', inPipeline, '');
  setStatCard('stat-attention', stats.needs_attention.length, '');
  setStatCard('stat-completed-today', stats.throughput.completed_today, '');
  setStatCard('stat-cost', `$${stats.costs.today.toFixed(4)}`, '');
  setStatCard('stat-queue', queue?.length || 0, '');
  setStatCard('stat-cycle-time', 
    stats.throughput.avg_cycle_time_hours > 0 
      ? `${stats.throughput.avg_cycle_time_hours}u` 
      : '—', '');
}

function setStatCard(id, value, suffix) {
  const card = document.getElementById(id);
  if (card) {
    card.querySelector('.stat-number').textContent = value + suffix;
  }
}

function renderAttention(items) {
  const section = document.getElementById('attention-section');
  const container = document.getElementById('attention-items');
  
  if (!items || items.length === 0) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  container.innerHTML = '';
  
  items.forEach(item => {
    const card = document.createElement('div');
    const attentionType = item.attention[0]?.type || 'unknown';
    const cssClass = attentionType === 'needs_human' ? 'needs-human' 
                   : attentionType === 'high_retry' ? 'high-retry' 
                   : 'stale';
    
    card.className = `attention-card ${cssClass}`;
    card.innerHTML = `
      <div class="attention-card-header">
        <span class="item-id">${item.id}</span>
        <span class="badge badge-priority-${item.priority}">${item.priority}</span>
      </div>
      <div style="font-size:13px;margin-bottom:4px">${item.title || ''}${item.title?.length > 50 ? '...' : ''}</div>
      ${item.attention.map(a => `
        <div class="attention-reason">
          ${a.type === 'needs_human' ? '🔴' : a.type === 'high_retry' ? '🟠' : '🟡'}
          ${a.msg}
        </div>
      `).join('')}
    `;
    container.appendChild(card);
  });
}

function renderKanban(items) {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';
  
  const SHOW_STATUSES = ['new', 'triaged', 'planned', 'in-progress', 'review', 'testing', 'done'];
  
  SHOW_STATUSES.forEach(status => {
    const statusItems = items.filter(i => i.status === status);
    
    const column = document.createElement('div');
    column.className = 'kanban-column';
    
    const color = getStatusColor(status);
    column.innerHTML = `
      <div class="kanban-header" style="border-top: 2px solid ${color}">
        <span>${STATUS_LABELS[status] || status}</span>
        <span style="background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:10px">${statusItems.length}</span>
      </div>
      <div class="kanban-items" id="kanban-${status}"></div>
    `;
    
    board.appendChild(column);
    
    const itemsContainer = column.querySelector(`#kanban-${status}`);
    statusItems.slice(0, 10).forEach(item => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      
      const ageText = getAgeText(item.processing_updated);
      
      card.innerHTML = `
        <div class="kanban-card-id">${item.id}</div>
        <div class="kanban-card-title" title="${item.title}">${item.title || ''}</div>
        <div class="kanban-card-meta">
          <span class="badge badge-priority-${item.priority}">${item.priority}</span>
          ${item.current_agent ? `<span class="badge" style="background:rgba(110,118,129,0.2);color:#8b949e">${item.current_agent}</span>` : ''}
          ${ageText ? `<span style="font-size:10px;color:#6e7681;margin-left:auto">${ageText}</span>` : ''}
        </div>
      `;
      itemsContainer.appendChild(card);
    });
    
    if (statusItems.length > 10) {
      const more = document.createElement('div');
      more.style = 'font-size:11px;color:#6e7681;text-align:center;padding:4px';
      more.textContent = `+ ${statusItems.length - 10} meer`;
      itemsContainer.appendChild(more);
    }
  });
}

function renderProjects(byProject) {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '';
  
  Object.entries(byProject).sort((a, b) => b[1].total - a[1].total).forEach(([name, data]) => {
    const pct = data.total > 0 ? Math.round(data.completed / data.total * 100) : 0;
    
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-name">📦 ${name}</div>
      <div class="project-bar">
        <div class="project-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="project-stats">
        <span>${data.active} actief</span>
        <span>${data.completed}/${data.total} voltooid (${pct}%)</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function getStatusColor(status) {
  const colors = {
    'new': '#6e7681',
    'triaged': '#388bfd',
    'planned': '#bc8cff',
    'in-progress': '#d29922',
    'review': '#e3b341',
    'testing': '#58a6ff',
    'staging-verified': '#79c0ff',
    'done': '#3fb950',
    'documented': '#238636',
    'needs-human': '#f85149',
    'deploy-failed': '#da3633'
  };
  return colors[status] || '#6e7681';
}

function getAgeText(timestamp) {
  if (!timestamp) return null;
  const ageMs = new Date() - new Date(timestamp);
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(ageMs / 3600000);
  if (hours < 24) return `${hours}u`;
  return `${Math.round(hours / 24)}d`;
}

// Start
loadData();
refreshTimer = setInterval(loadData, CONFIG.refreshInterval);
```

---

## Stap 4 — Deploy als statische site via Coolify

```
Coolify → New Resource → Static Site

Bron: Gitea repo sdlc-platform/sdlc-platform
Branch: main
Build directory: /dashboard
Publish directory: / (of: /dashboard)
Domein: dashboard.7rb.nl
```

> **Let op:** pas `CONFIG.dashboardSecret` in `index.html` aan naar jouw werkelijke secret. Commit dit bestand **niet** publiek als de repo publiek is. Gebruik eventueel een `.env` inject via Coolify environment variables en server-side rendering als je meer security wilt.

---

## Stap 5 — Voeg dashboard map toe aan sdlc-trigger.yml uitzonderingen

```yaml
# .gitea/workflows/sdlc-trigger.yml
paths-ignore:
  - 'LOCK.json'
  - 'QUEUE.json'
  - 'dashboard/**'  ← NEU
```

---

## Verificatie

1. Open `https://dashboard.7rb.nl` in de browser
2. Dashboard moet laden (geen CORS-errors, data verschijnt)
3. Kanban-bord toont items per status
4. Lock-status reflecteert LOCK.json inhoud
5. Statistieken kloppen met handmatig tellen in Gitea
6. Auto-refresh werkt elke 60 seconden (check timestamp)
