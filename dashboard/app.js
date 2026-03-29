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
let allItems = [];

async function loadData() {
  document.getElementById('last-updated').textContent = 'Laden...';
  
  try {
    const rangeSelect = document.getElementById('chart-range');
    const range = rangeSelect ? rangeSelect.value : 30;
    const url = new URL(CONFIG.apiUrl);
    url.searchParams.append('range', range);
    
    const response = await fetch(url.toString(), {
      credentials: 'include'
    });
    
    if (response.status === 401) {
      window.location.href = `${CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-auth-login')}`;
      return;
    }
    
    const data = await response.json();
    if (data.redirect) {
      window.location.href = `${CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-auth-login')}`;
      return;
    }
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    if (data.user) {
      renderAuthUI(data.user);
    }
    
    renderDashboard(data);
    
    const now = new Date().toLocaleTimeString('nl-NL');
    document.getElementById('last-updated').textContent = `Bijgewerkt: ${now}`;
    
  } catch (err) {
    document.getElementById('last-updated').textContent = `Fout: ${err.message}`;
    console.error('Dashboard load error:', err);
  }
}

function renderAuthUI(user) {
  const authStatus = document.getElementById('auth-status');
  if (authStatus) {
    authStatus.innerHTML = `
      <span class="user-badge" style="margin-right:8px; font-size:12px;">👤 ${user}</span>
      <button class="btn-refresh" onclick="logout()">Uitloggen</button>
    `;
  }
}

function logout() {
  document.cookie = 'sdlc_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  window.location.reload();
}

function renderDashboard(data) {
  const { items, stats, lock, queue, snapshots, health } = data;
  
  allItems = items;
  populateProjectFilter(items);
  
  renderLockStatus(lock, queue);
  renderHealthStatus(health);
  renderStats(stats, queue);
  renderAttention(stats.needs_attention);
  applyFilters();
  
  if (snapshots && snapshots.length > 0) {
    window.currentSnapshots = snapshots;
    renderChartThroughput(snapshots);
    renderChartCosts(snapshots);
    renderChartCycleTime(snapshots);
    renderAgentCostBreakdown(snapshots);
  }
}

function renderHealthStatus(health) {
  const el = document.getElementById('platform-health');
  if (!el) return;
  
  if (!health) {
    el.style.display = 'none';
    return;
  }
  
  el.style.display = 'inline-block';
  
  if (health.all_ok) {
    el.innerHTML = `✅ Alle services online`;
    el.className = 'health-badge health-ok';
  } else {
    const failedServices = (health.services || []).filter(s => s.status === 'fail').map(s => s.name);
    if (failedServices.length > 0) {
      el.innerHTML = `❌ ${failedServices.join(', ')} offline`;
      el.className = 'health-badge health-error';
    } else {
      el.innerHTML = `❌ Health waarschuwing`;
      el.className = 'health-badge health-error';
    }
    
    if (health.last_check) {
      const timeStr = new Date(health.last_check).toLocaleTimeString('nl-NL', { hour: '2-digit', minute:'2-digit' });
      el.innerHTML += ` (${timeStr})`;
    }
  }
}

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
  const current = select.value;
  select.innerHTML = '<option value="all">Alle projecten</option>';
  projects.forEach(p => {
    select.innerHTML += `<option value="${p}">${p}</option>`;
  });
  select.value = projects.includes(current) ? current : 'all';
}

function groupByProject(items) {
  const byProject = {};
  items.forEach(item => {
    const proj = item.project || 'Zonder project';
    if (!byProject[proj]) {
      byProject[proj] = { total: 0, completed: 0, active: 0, items: [] };
    }
    byProject[proj].total++;
    byProject[proj].items.push(item);
    if (['done', 'documented'].includes(item.status)) {
      byProject[proj].completed++;
    } else if (item.status !== 'new') {
      byProject[proj].active++;
    }
  });
  return byProject;
}

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
      <div class="attention-actions">
        <button class="btn-action btn-approve" onclick="actionApprove('${item.id}')">✅ Approve</button>
        <button class="btn-action btn-retry" onclick="actionRetry('${item.id}')">🔄 Retry</button>
        <button class="btn-action btn-skip" onclick="actionSkip('${item.id}')">⏭️ Skip</button>
      </div>
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
      card.setAttribute('onclick', `showItemDetail('${item.id}')`);
      
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
    const health = getProjectHealth(data.items || []);
    const healthEmoji = health === 'red' ? '🔴' : health === 'yellow' ? '🟡' : '🟢';
    
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-name" style="display:flex; justify-content:space-between; align-items:center;">
        <span>📦 ${name} ${healthEmoji}</span>
        <button class="btn-action" style="font-size:10px" onclick="checkProject('${name}')">🔍 Check</button>
      </div>
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

// Modal and Actions
async function performAction(itemId, action) {
  try {
    const response = await fetch(CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-dashboard-action'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ item_id: itemId, action: action })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    
    showToast(`${action === 'approve' ? '✅' : action === 'retry' ? '🔄' : '⏭️'} ${itemId}: ${result.message}`);
    loadData();
  } catch (err) {
    showToast(`❌ Fout bij ${action}: ${err.message}`, 'error');
  }
}

function actionApprove(itemId) { performAction(itemId, 'approve'); }
function actionRetry(itemId) { performAction(itemId, 'retry'); }
function actionSkip(itemId) { performAction(itemId, 'skip'); }

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  if (type === 'error') toast.style.borderLeft = '3px solid var(--accent-red)';
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

async function showItemDetail(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

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
          <div class="detail-row"><span>Project</span><span>${item.project || '—'}</span></div>
          <div class="detail-row"><span>Status</span><span>${item.status}</span></div>
          <div class="detail-row"><span>Type</span><span>${item.type}</span></div>
          <div class="detail-row"><span>Agent</span><span>${item.current_agent || '—'}</span></div>
          <div class="detail-row"><span>Retry</span><span>${item.retry_count || 0}/3</span></div>
          <div class="detail-row"><span>Kosten</span><span>$${(item.api_cost_usd || 0).toFixed(4)}</span></div>
          <div class="detail-row"><span>Gestart</span><span>${item.processing_started || '—'}</span></div>
          <div class="detail-row"><span>Laatst bijgewerkt</span><span>${item.processing_updated || '—'}</span></div>
          ${item.last_error ? `<div class="detail-error">⚠️ ${item.last_error}</div>` : ''}
        </div>
        
        <div class="timeline-container" id="execution-timeline" style="margin-top: 24px;">
          <div style="font-size:13px; color:var(--text-muted);">Logs laden...</div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'block';
  
  try {
    const url = new URL(CONFIG.apiUrl);
    url.searchParams.append('item_id', item.id);
    const response = await fetch(url.toString(), {
      credentials: 'include'
    });
    
    // De webhook in n8n stuurt { items: [], stats: {}, ... } als je geen item_id stuurt,
    // en waarschijnlijk array van logs als je item_id stuurt.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    let logs = [];
    if (Array.isArray(data)) {
        logs = data;
    } else if (data && data.logs) {
        logs = data.logs;
    }
    
    document.getElementById('execution-timeline').innerHTML = renderTimeline(logs);
  } catch (err) {
    document.getElementById('execution-timeline').innerHTML = `<div class="detail-error">Fout bij laden logs: ${err.message}</div>`;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return d.toLocaleTimeString('nl-NL');
}

function renderTimeline(logs) {
  if (!logs || logs.length === 0) return `<div style="font-size:13px; color:var(--text-muted);">Geen executie-logs gevonden.</div>`;
  
  let html = '<h4 style="margin-bottom: 12px; font-size: 14px; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 6px;">Executie Historie</h4>';
  html += '<div class="timeline">';
  
  html += logs.map(log => `
    <div class="timeline-entry ${log.result || 'success'}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <span class="timeline-agent">${log.agent}</span>
          <span class="timeline-status">${log.status_before} → ${log.status_after}</span>
          <span class="timeline-time">${formatTime(log.timestamp_end)}</span>
        </div>
        <div class="timeline-meta">
          ⏱️ ${log.duration_seconds || 0}s · 💰 $${(log.api_cost_usd || 0).toFixed(4)} · 🔤 ${log.tokens_used || 0} tokens
        </div>
        ${log.error ? `<div class="timeline-error-inline">⚠️ ${log.error}</div>` : ''}
        ${log.output_summary ? `<div class="timeline-summary">${log.output_summary}</div>` : ''}
      </div>
    </div>
  `).join('');
  
  html += '</div>';
  return html;
}

function closeModal() {
  const modal = document.getElementById('item-modal');
  if (modal) modal.style.display = 'none';
}

function checkProject(projectName) {
  showToast(`🔍 Checking project ${projectName}...`);
  performProjectAction(projectName, 'check');
}

async function performProjectAction(projectName, action, payload = {}) {
  try {
    const response = await fetch(CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-project-setup'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ project: projectName, action, ...payload })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    
    if (action === 'check') {
      showProjectCheckModal(projectName, result.checks || [{ check: 'Validatie', status: 'ok', msg: 'Aangevraagd' }]);
    } else {
      showToast(`✅ Project ${projectName} setup gestart!`);
    }
  } catch (err) {
    showToast(`❌ Fout bij project actie: ${err.message}`, 'error');
  }
}

function showProjectCheckModal(projectName, checks) {
  const modal = document.getElementById('item-modal');
  
  let rows = checks.map(c => {
    let icon = c.status === 'ok' ? '✅' : (c.status === 'warn' ? '⚠️' : '❌');
    return `<div class="detail-row"><span>${c.check}</span><span>${icon} ${c.msg || ''}</span></div>`;
  }).join('');
  
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="item-id">Project Check</span>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <h3>${projectName}</h3>
        <div class="detail-grid">
          ${rows}
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'block';
}

function showNewProjectModal() {
  const modal = document.getElementById('item-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="item-id">Nieuw Project</span>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <h3>Project Starten</h3>
        
        <form id="new-project-form" style="margin-top: 16px; display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Naam</label>
            <input type="text" id="np-name" class="filter-input" style="width:100%; box-sizing: border-box;" placeholder="mijn-app" required>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Beschrijving</label>
            <input type="text" id="np-desc" class="filter-input" style="width:100%; box-sizing: border-box;" placeholder="Korte omschrijving..." required>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Frontend stack</label>
            <input type="text" id="np-fe" class="filter-input" style="width:100%; box-sizing: border-box;" placeholder="React 18, TypeScript...">
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Backend stack</label>
            <input type="text" id="np-be" class="filter-input" style="width:100%; box-sizing: border-box;" placeholder="FastAPI, Python 3.12...">
          </div>
          <div style="margin-top: 12px; display:flex; gap:8px;">
            <button type="submit" class="btn-refresh" style="background:var(--accent-green); color:white; border:none; width:100%;">Aanmaken</button>
            <button type="button" class="btn-refresh" style="width:100%;" onclick="closeModal()">Annuleren</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.style.display = 'block';
  
  document.getElementById('new-project-form').onsubmit = (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('np-name').value,
      description: document.getElementById('np-desc').value,
      stack: {
        frontend: document.getElementById('np-fe').value,
        backend: document.getElementById('np-be').value
      }
    };
    performProjectAction(payload.name, 'create', payload);
    closeModal();
  };
}

let chartThroughput, chartCosts, chartCycletime, chartAgentCosts;

function renderChartThroughput(snapshots) {
  const ctx = document.getElementById('chart-throughput').getContext('2d');
  if (chartThroughput) chartThroughput.destroy();
  chartThroughput = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: snapshots.map(s => s.date),
      datasets: [{
        label: 'Voltooid',
        data: snapshots.map(s => s.completed_today || 0),
        backgroundColor: 'rgba(63, 185, 80, 0.6)',
        borderColor: '#3fb950',
        borderWidth: 1
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
  });
}

function renderChartCosts(snapshots) {
  const ctx = document.getElementById('chart-costs').getContext('2d');
  if (chartCosts) chartCosts.destroy();
  chartCosts = new Chart(ctx, {
    type: 'line',
    data: {
      labels: snapshots.map(s => s.date),
      datasets: [{
        label: 'Kosten ($)',
        data: snapshots.map(s => s.costs?.today || 0),
        borderColor: '#d29922',
        backgroundColor: 'rgba(210, 153, 34, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
  });
}

function renderChartCycleTime(snapshots) {
  const ctx = document.getElementById('chart-cycletime').getContext('2d');
  if (chartCycletime) chartCycletime.destroy();
  chartCycletime = new Chart(ctx, {
    type: 'line',
    data: {
      labels: snapshots.map(s => s.date),
      datasets: [{
        label: 'Gemiddelde doorlooptijd (u)',
        data: snapshots.map(s => s.performance?.avg_cycle_time_hours || 0),
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88, 166, 255, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
  });
}

function renderAgentCostBreakdown(snapshots) {
  const latest = snapshots[snapshots.length - 1];
  const agentsObj = latest?.costs?.by_agent || {};
  const agents = Object.entries(agentsObj);
  
  if (agents.length === 0) return;
  
  const ctx = document.getElementById('chart-agent-costs').getContext('2d');
  if (chartAgentCosts) chartAgentCosts.destroy();
  chartAgentCosts = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: agents.map(([name]) => name),
      datasets: [{
        data: agents.map(([, cost]) => cost),
        backgroundColor: ['#388bfd', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#58a6ff', '#e3b341', '#6e7681']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function exportCSV() {
  if (!window.currentSnapshots) return;
  const snapshots = window.currentSnapshots;
  const headers = ['Datum', 'Voltooid', 'Kosten', 'Gem. doorlooptijd', 'Needs Human', 'Deploy Failed'];
  const rows = snapshots.map(s => [
    s.date, 
    s.completed_today || 0, 
    (s.costs?.today || 0).toFixed(4),
    s.performance?.avg_cycle_time_hours || 0, 
    s.performance?.items_needs_human || 0,
    s.performance?.items_deploy_failed || 0
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sdlc-analytics-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

// New Item Modal
function showNewItemModal() {
  const modal = document.getElementById('item-modal');
  
  const projects = [...new Set(allItems.map(i => i.project).filter(Boolean))].sort();
  const projectOptions = projects.map(p => `<option value="${p}">${p}</option>`).join('');

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="item-id">Nieuw Item</span>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <h3>Nieuw Werkitem Aanmaken</h3>
        
        <form id="new-item-form" style="margin-top: 16px; display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Type *</label>
            <select id="ni-type" class="filter-select" style="width:100%; box-sizing: border-box;" required onchange="toggleItemTypeFields()">
              <option value="BUG">Bug (BUG)</option>
              <option value="ISS">Issue (ISS)</option>
              <option value="FE">Feature (FE)</option>
              <option value="US">User Story (US)</option>
              <option value="EP">Epic (EP)</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Project *</label>
            <select id="ni-project" class="filter-select" style="width:100%; box-sizing: border-box;" required>
              ${projectOptions || '<option value="" disabled>Geen projecten gevonden</option>'}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Titel *</label>
            <input type="text" id="ni-title" class="filter-input" style="width:100%; box-sizing: border-box;" placeholder="Korte en duidelijke titel" required>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Prioriteit *</label>
            <select id="ni-priority" class="filter-select" style="width:100%; box-sizing: border-box;" required>
              <option value="low">Low (1)</option>
              <option value="medium" selected>Medium (2)</option>
              <option value="high">High (3)</option>
              <option value="critical">Critical (4)</option>
            </select>
          </div>
          <div id="ni-severity-container">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Severity *</label>
            <select id="ni-severity" class="filter-select" style="width:100%; box-sizing: border-box;">
              <option value="minor">Minor</option>
              <option value="major" selected>Major</option>
              <option value="blocker">Blocker</option>
            </select>
          </div>
          <div id="ni-epic-container" style="display:none;">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Parent Epic (Optioneel)</label>
            <input type="text" id="ni-epic" class="filter-input" style="width:100%; box-sizing: border-box;" placeholder="Bijv. EP-001">
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Beschrijving</label>
            <textarea id="ni-description" class="filter-input" style="width:100%; height: 100px; box-sizing: border-box; resize: vertical;" placeholder="Uitgebreide beschrijving..."></textarea>
          </div>
          <div style="margin-top: 12px; display:flex; gap:8px;">
            <button type="submit" class="btn-refresh" style="background:var(--accent-blue); color:white; border:none; width:100%;">Item Aanmaken</button>
            <button type="button" class="btn-refresh" style="width:100%;" onclick="closeModal()">Annuleren</button>
          </div>
        </form>
      </div>
    </div>
  `;
  modal.style.display = 'block';
  
  toggleItemTypeFields();
  
  document.getElementById('new-item-form').onsubmit = (e) => {
    e.preventDefault();
    const payload = {
      type: document.getElementById('ni-type').value,
      project: document.getElementById('ni-project').value,
      title: document.getElementById('ni-title').value,
      priority: document.getElementById('ni-priority').value,
      description: document.getElementById('ni-description').value
    };
    
    if (payload.type === 'BUG') {
      payload.severity = document.getElementById('ni-severity').value;
    }
    if (['FE', 'US'].includes(payload.type)) {
      payload.parent_epic = document.getElementById('ni-epic').value;
    }
    
    performCreateItem(payload);
    closeModal();
  };
}

window.toggleItemTypeFields = function() {
  const type = document.getElementById('ni-type');
  if (!type) return;
  const severityContainer = document.getElementById('ni-severity-container');
  const epicContainer = document.getElementById('ni-epic-container');
  
  severityContainer.style.display = type.value === 'BUG' ? 'block' : 'none';
  epicContainer.style.display = ['FE', 'US'].includes(type.value) ? 'block' : 'none';
};

async function performCreateItem(payload) {
  try {
    showToast(`⏳ Item aanmaken...`);
    const response = await fetch(CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-create-item'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    
    if (result.success) {
      showToast(`✅ Item aangemaakt: ${result.item_id || 'Onbekend'}`);
      loadData();
    } else {
      throw new Error(result.error || 'Onbekende fout');
    }
  } catch (err) {
    showToast(`❌ Fout bij aanmaken item: ${err.message}`, 'error');
  }
}

// Start
loadData();
refreshTimer = setInterval(loadData, CONFIG.refreshInterval);
