# IMP-10 — Dashboard v2: cross-project overzicht en inline acties

**Status:** gesloten  
**Prioriteit:** 🟠 Hoog  
**Geschatte tijd:** 4-6 uur  
**Afhankelijk van:** IMP-08  
**Raakt aan:** `dashboard/index.html`, `dashboard/style.css`, `dashboard/app.js`, SDLC Dashboard API workflow

---

## Probleem

Het huidige dashboard (IMP-08) toont een globaal overzicht met kanban-bord, attention-sectie en per-project voortgang. Maar het mist drie essentiële functies voor beheer van meerdere projecten:

1. **Geen project-filter**: je kunt niet filteren op één project of projecten vergelijken
2. **Geen inline acties**: approve, retry, skip kan alleen via Telegram — niet vanuit het dashboard
3. **Geen zoek/filter**: geen mogelijkheid om items te zoeken op ID, titel, status of project
4. **Geen project health indicator**: geen rood/geel/groen per project

---

## Stap 1 — Project filter & switcher

### HTML: filter balk toevoegen

Voeg toe boven de stats-grid in `dashboard/index.html`:

```html
<section class="filter-bar" id="filter-bar">
  <div class="filter-group">
    <label class="filter-label">Project</label>
    <select id="project-filter" class="filter-select" onchange="applyFilters()">
      <option value="all">Alle projecten</option>
      <!-- Dynamisch gevuld door app.js -->
    </select>
  </div>
  <div class="filter-group">
    <label class="filter-label">Status</label>
    <select id="status-filter" class="filter-select" onchange="applyFilters()">
      <option value="all">Alle statussen</option>
      <option value="active">Actief in pipeline</option>
      <option value="needs-human">Needs human</option>
      <option value="deploy-failed">Deploy gefaald</option>
    </select>
  </div>
  <div class="filter-group">
    <input type="text" id="search-input" class="filter-input" 
           placeholder="Zoek op ID of titel..." oninput="applyFilters()">
  </div>
</section>
```

### CSS: filter balk styling

```css
.filter-bar {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.filter-select, .filter-input {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Inter', sans-serif;
  min-width: 160px;
}

.filter-select:focus, .filter-input:focus {
  outline: none;
  border-color: var(--accent-blue);
}
```

### JavaScript: filter logica

```javascript
let allItems = []; // cache van alle items na API call

function applyFilters() {
  const project = document.getElementById('project-filter').value;
  const status = document.getElementById('status-filter').value;
  const search = document.getElementById('search-input').value.toLowerCase();

  let filtered = allItems;

  if (project !== 'all') {
    filtered = filtered.filter(i => i.project === project);
  }
  if (status === 'active') {
    filtered = filtered.filter(i => !['new', 'documented'].includes(i.status));
  } else if (status !== 'all') {
    filtered = filtered.filter(i => i.status === status);
  }
  if (search) {
    filtered = filtered.filter(i =>
      (i.id || '').toLowerCase().includes(search) ||
      (i.title || '').toLowerCase().includes(search)
    );
  }

  renderKanban(filtered);
  renderProjects(groupByProject(filtered));
}

function populateProjectFilter(items) {
  const select = document.getElementById('project-filter');
  const projects = [...new Set(items.map(i => i.project).filter(Boolean))].sort();
  // Behoud huidige selectie
  const current = select.value;
  select.innerHTML = '<option value="all">Alle projecten</option>';
  projects.forEach(p => {
    select.innerHTML += `<option value="${p}">${p}</option>`;
  });
  select.value = projects.includes(current) ? current : 'all';
}
```

---

## Stap 2 — Project health indicator

### Health score berekening

Per project wordt een **health score** bepaald op basis van:

| Indicator | Impact |
|-----------|--------|
| ≥1 items `needs-human` > 4 uur | 🔴 Rood |
| ≥1 items `deploy-failed` | 🔴 Rood |
| ≥1 items stale > 30 min | 🟡 Geel |
| retry_count ≥ 2 op een item | 🟡 Geel |
| Alles normaal | 🟢 Groen |

### HTML: health badge in project card

```javascript
function getProjectHealth(items) {
  const now = new Date();
  let health = 'green';

  for (const item of items) {
    if (item.status === 'deploy-failed') return 'red';
    if (item.status === 'needs-human') {
      const ageMs = item.processing_updated ? now - new Date(item.processing_updated) : 0;
      if (ageMs > 4 * 3600000) return 'red';
      health = 'yellow';
    }
    if (item.retry_count >= 2) health = 'yellow';
    if (!['new', 'documented', 'needs-human', 'deploy-failed'].includes(item.status) && item.processing_updated) {
      const ageMs = now - new Date(item.processing_updated);
      if (ageMs > 30 * 60000) health = health === 'green' ? 'yellow' : health;
    }
  }
  return health;
}

// In renderProjects():
const health = getProjectHealth(projectItems);
const healthEmoji = health === 'red' ? '🔴' : health === 'yellow' ? '🟡' : '🟢';
```

---

## Stap 3 — Inline acties vanuit dashboard

### Actie-knoppen toevoegen aan attention cards

Voeg toe aan elke attention card:
```html
<div class="attention-actions">
  <button class="btn-action btn-approve" onclick="actionApprove('${item.id}')">✅ Approve</button>
  <button class="btn-action btn-retry" onclick="actionRetry('${item.id}')">🔄 Retry</button>
  <button class="btn-action btn-skip" onclick="actionSkip('${item.id}')">⏭️ Skip</button>
</div>
```

### CSS: actieknoppen

```css
.attention-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.btn-action {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.btn-approve:hover { border-color: var(--accent-green); color: var(--accent-green); }
.btn-retry:hover { border-color: var(--accent-orange); color: var(--accent-orange); }
.btn-skip:hover { border-color: var(--accent-blue); color: var(--accent-blue); }
```

### JavaScript: actie-functies

```javascript
async function performAction(itemId, action) {
  try {
    const response = await fetch(CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-dashboard-action'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dashboard-Secret': CONFIG.dashboardSecret
      },
      body: JSON.stringify({ item_id: itemId, action: action })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    
    // Feedback tonen
    showToast(`${action === 'approve' ? '✅' : action === 'retry' ? '🔄' : '⏭️'} ${itemId}: ${result.message}`);
    
    // Dashboard verversen
    loadData();
  } catch (err) {
    showToast(`❌ Fout bij ${action}: ${err.message}`, 'error');
  }
}

function actionApprove(itemId) { performAction(itemId, 'approve'); }
function actionRetry(itemId) { performAction(itemId, 'retry'); }
function actionSkip(itemId) { performAction(itemId, 'skip'); }
```

### n8n: Dashboard Action webhook

Voeg een nieuwe webhook toe aan de `SDLC Dashboard API` workflow:

```
Webhook POST /sdlc-dashboard-action
  → [Code] Valideer X-Dashboard-Secret
  → [Switch op action]
      approve → [HTTP] Haal frontmatter op
               → [Code] Zet status terug naar previous_status
               → [HTTP] Update frontmatter in Gitea
      retry   → [HTTP] Haal frontmatter op
               → [Code] Reset retry_count naar 0
               → [HTTP] Update frontmatter in Gitea
               → Trigger SDLC Router voor dit item
      skip    → [HTTP] Haal frontmatter op
               → [Code] Zet status naar documented
               → [HTTP] Update frontmatter in Gitea
  → Respond: { success: true, message: "..." }
```

---

## Stap 4 — Item detail view (modal)

### Klik op kanban card → detail modal

```javascript
function showItemDetail(item) {
  const modal = document.getElementById('item-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="item-id">${item.id}</span>
          <span class="badge badge-priority-${item.priority}">${item.priority}</span>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <h3>${item.title}</h3>
        <div class="detail-grid">
          <div class="detail-row"><span>Project</span><span>${item.project}</span></div>
          <div class="detail-row"><span>Status</span><span>${item.status}</span></div>
          <div class="detail-row"><span>Type</span><span>${item.type}</span></div>
          <div class="detail-row"><span>Agent</span><span>${item.current_agent || '—'}</span></div>
          <div class="detail-row"><span>Retry</span><span>${item.retry_count}/3</span></div>
          <div class="detail-row"><span>Kosten</span><span>$${(item.api_cost_usd || 0).toFixed(4)}</span></div>
          <div class="detail-row"><span>Gestart</span><span>${item.processing_started || '—'}</span></div>
          <div class="detail-row"><span>Laatst bijgewerkt</span><span>${item.processing_updated || '—'}</span></div>
          ${item.last_error ? `<div class="detail-error">⚠️ ${item.last_error}</div>` : ''}
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'block';
}
```

---

## Verificatie

1. Filter op project: kanban toont alleen items van dat project
2. Zoek op ID: "BUG-001" filtert direct
3. Health indicator: project met needs-human item toont 🔴
4. Inline approve: attention card → Approve → item verlaat needs-human
5. Item detail: klik op kanban card → modal met volledige metadata
