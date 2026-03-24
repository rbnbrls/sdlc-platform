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
