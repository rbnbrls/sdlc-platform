# IMP-14 — Historische analytics en trend-grafieken

**Status:** open  
**Prioriteit:** 🟡 Normaal  
**Geschatte tijd:** 6-8 uur  
**Afhankelijk van:** IMP-08, IMP-11  
**Raakt aan:** Dashboard, SDLC Dashboard API, `analytics/` map, Chart.js

---

## Probleem

Het dashboard toont alleen de **huidige** staat van de pipeline. Er is geen inzicht in:
- Trends over tijd (items voltooid per week, kosten per week)
- Agent performance (welke agent faalt het vaakst, gemiddelde retry-count)
- Kosten-breakdown (per agent, per project, per dag)
- Velocity tracking (items per sprint)
- SLA/doorlooptijd trends

---

## Oplossing

Een dagelijks snapshot-mechanisme gecombineerd met Chart.js visualisatie in het dashboard.

---

## Stap 1 — Dagelijkse snapshot workflow

### Nieuwe workflow: `SDLC Analytics Snapshot`

```
Schedule Trigger: dagelijks om 23:55
  → [HTTP] Haal alle backlog bestanden op (Gitea API tree)
  → [Code] Parse alle frontmatters
  → [Code] Aggregeer statistieken:
      {
        "date": "2026-03-29",
        "total_items": 45,
        "by_status": { "new": 5, "in-progress": 3, "documented": 30, ... },
        "by_project": { "spaartrack": { "total": 25, "completed": 18, "active": 4 }, ... },
        "by_type": { "bug": 8, "feature": 12, "story": 20, ... },
        "completed_today": 3,
        "costs": {
          "total": 2.4567,
          "today": 0.1234,
          "by_agent": { "triage": 0.02, "developer": 0.08, ... },
          "by_project": { "spaartrack": 0.09, "demo": 0.03 }
        },
        "performance": {
          "avg_cycle_time_hours": 4.2,
          "avg_retry_count": 0.8,
          "agent_fail_rate": { "developer": 0.15, "tester": 0.10, ... },
          "items_needs_human": 2,
          "items_deploy_failed": 0
        },
        "throughput": {
          "completed_this_week": 12,
          "completed_this_month": 35
        }
      }
  → [HTTP] Schrijf naar analytics/snapshots/2026-03-29.json
```

### Map structuur

```
sdlc-platform/
└── analytics/
    └── snapshots/
        ├── 2026-03-01.json
        ├── 2026-03-02.json
        └── ...
```

---

## Stap 2 — Dashboard API: analytics endpoint

### Nieuwe query parameter

```
GET /sdlc-dashboard?range=30d     → laatste 30 snapshots
GET /sdlc-dashboard?range=7d      → laatste 7 snapshots
GET /sdlc-dashboard?range=90d     → laatste 90 snapshots
```

```javascript
// In Dashboard API:
const range = parseInt($json.query?.range) || 30;
const snapshots = [];
for (let i = 0; i < range; i++) {
  const date = new Date();
  date.setDate(date.getDate() - i);
  const dateStr = date.toISOString().split('T')[0];
  const file = await getFile(`analytics/snapshots/${dateStr}.json`);
  if (file) snapshots.push(JSON.parse(decodeBase64(file.content)));
}
// Return gesorteerd op datum
```

---

## Stap 3 — Chart.js integratie in dashboard

### HTML: analytics tab toevoegen

```html
<section class="analytics-section">
  <h2 class="section-title">📈 Trends</h2>
  <div class="chart-controls">
    <select id="chart-range" onchange="loadAnalytics()">
      <option value="7">7 dagen</option>
      <option value="30" selected>30 dagen</option>
      <option value="90">90 dagen</option>
    </select>
  </div>
  <div class="chart-grid">
    <div class="chart-card">
      <h3 class="chart-title">Items voltooid per dag</h3>
      <canvas id="chart-throughput"></canvas>
    </div>
    <div class="chart-card">
      <h3 class="chart-title">API kosten per dag</h3>
      <canvas id="chart-costs"></canvas>
    </div>
    <div class="chart-card">
      <h3 class="chart-title">Gemiddelde doorlooptijd</h3>
      <canvas id="chart-cycletime"></canvas>
    </div>
    <div class="chart-card">
      <h3 class="chart-title">Agent faalpercentage</h3>
      <canvas id="chart-agent-fails"></canvas>
    </div>
  </div>
</section>
```

### JavaScript: Chart.js rendering

```javascript
// Voeg Chart.js toe aan index.html:
// <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>

function renderThroughputChart(snapshots) {
  const ctx = document.getElementById('chart-throughput').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: snapshots.map(s => s.date),
      datasets: [{
        label: 'Voltooid',
        data: snapshots.map(s => s.completed_today),
        backgroundColor: 'rgba(63, 185, 80, 0.6)',
        borderColor: '#3fb950',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

function renderCostsChart(snapshots) {
  const ctx = document.getElementById('chart-costs').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: snapshots.map(s => s.date),
      datasets: [{
        label: 'Kosten ($)',
        data: snapshots.map(s => s.costs.today),
        borderColor: '#d29922',
        backgroundColor: 'rgba(210, 153, 34, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
}
```

---

## Stap 4 — Agent performance metrics

### Kosten-breakdown

```javascript
function renderAgentCostBreakdown(snapshots) {
  // Neem de meest recente snapshot
  const latest = snapshots[0];
  const agents = Object.entries(latest.costs.by_agent || {});
  
  const ctx = document.getElementById('chart-agent-costs').getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: agents.map(([name]) => name),
      datasets: [{
        data: agents.map(([, cost]) => cost),
        backgroundColor: [
          '#388bfd', '#3fb950', '#d29922', '#f85149',
          '#bc8cff', '#58a6ff', '#e3b341', '#6e7681'
        ]
      }]
    }
  });
}
```

### SLA tracking

Definieer SLA-drempels in de Dashboard API:

```javascript
const SLA_THRESHOLDS = {
  bug: { critical: 4, high: 8, medium: 24, low: 48 },    // uren
  issue: { critical: 8, high: 16, medium: 48, low: 72 },
  feature: { critical: 24, high: 48, medium: 96, low: 168 },
  story: { critical: 8, high: 16, medium: 24, low: 48 }
};

// In de analytics: tel items die SLA overschrijden
items.forEach(item => {
  if (item.processing_started && !['documented', 'new'].includes(item.status)) {
    const hoursElapsed = (now - new Date(item.processing_started)) / 3600000;
    const threshold = SLA_THRESHOLDS[item.type]?.[item.priority];
    if (threshold && hoursElapsed > threshold) {
      slaBreached.push({ ...item, hours: Math.round(hoursElapsed), threshold });
    }
  }
});
```

---

## Stap 5 — Export functie

```javascript
function exportCSV() {
  const headers = ['Datum', 'Voltooid', 'Kosten', 'Gem. doorlooptijd', 'Needs Human', 'Deploy Failed'];
  const rows = snapshots.map(s => [
    s.date, s.completed_today, s.costs.today.toFixed(4),
    s.performance.avg_cycle_time_hours, s.performance.items_needs_human,
    s.performance.items_deploy_failed
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sdlc-analytics-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}
```

---

## Gitea Action uitsluiting

```yaml
paths-ignore:
  - 'analytics/**'   # ← NIEUW
```

---

## Verificatie

1. Snapshot workflow draait om 23:55 → JSON bestand aanwezig
2. Dashboard analytics tab toont grafieken met historische data
3. Range switcher (7d/30d/90d) werkt correct
4. Export CSV downloadbaar met correcte data
5. SLA-overtredingen zichtbaar in analytics
