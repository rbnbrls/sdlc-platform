# IMP-11 — Execution logs: agent-historie en audit trail

**Status:** done  
**Prioriteit:** 🟠 Hoog  
**Geschatte tijd:** 6-8 uur  
**Afhankelijk van:** IMP-06  
**Raakt aan:** Alle agent-workflows, Dashboard API, `agent_logs/` map, dashboard

---

## Probleem

Er is geen persistente opslag van wat elke AI agent heeft gedaan. Het enige spoor is:
- Telegram-berichten (niet doorzoekbaar, niet gestructureerd)
- n8n Execution history (verdwijnt na retentieperiode, niet per werkitem gegroepeerd)
- Frontmatter velden (alleen de huidige status, geen historie)

De beheerder kan niet:
- Zien welke agents wanneer hebben gedraaid voor een werkitem
- Terugvinden waarom een agent een bepaalde beslissing maakte
- Kosten uitsplitsen per agent-stap
- Een audit trail raadplegen van status-transities

---

## Oplossing

### Structuur: `agent_logs/` map in sdlc-platform repo

```
sdlc-platform/
└── agent_logs/
    └── {project}/
        └── {item_id}/
            ├── 001_triage_2026-03-29T20:00:00Z.json
            ├── 002_planner_2026-03-29T20:05:00Z.json
            ├── 003_developer_2026-03-29T20:15:00Z.json
            └── 004_reviewer_2026-03-29T20:30:00Z.json
```

### Log entry formaat

```json
{
  "item_id": "BUG-001",
  "project": "spaartrack",
  "agent": "triage",
  "sequence": 1,
  "timestamp_start": "2026-03-29T20:00:00Z",
  "timestamp_end": "2026-03-29T20:00:12Z",
  "duration_seconds": 12,
  "status_before": "new",
  "status_after": "triaged",
  "model_used": "google/gemini-2.5-pro",
  "tokens_used": 1245,
  "api_cost_usd": 0.0024,
  "result": "success",
  "retry_count": 0,
  "quality_gate": {
    "gate_id": "QG-01",
    "passed": true,
    "failed_criteria": []
  },
  "output_summary": "Severity: major, priority verhoogd naar high",
  "error": null,
  "n8n_execution_id": "abc123"
}
```

---

## Stap 1 — Log Writer helper (herbruikbaar Code node)

Voeg aan het einde van **elke** agent sub-workflow een `Write Agent Log` Code node toe:

```javascript
// Code node: Write Agent Log
const item = $('Parse Frontmatter').first().json;
const agentName = 'triage'; // pas aan per workflow
const startTime = $('Execute Workflow Trigger').first().json._start_time || new Date().toISOString();
const endTime = new Date().toISOString();

// Haal sequence nummer op
const existingLogs = $('List Existing Logs').first().json.files || [];
const sequence = existingLogs.length + 1;
const paddedSeq = String(sequence).padStart(3, '0');

const logEntry = {
  item_id: item.id,
  project: item.project,
  agent: agentName,
  sequence: sequence,
  timestamp_start: startTime,
  timestamp_end: endTime,
  duration_seconds: Math.round((new Date(endTime) - new Date(startTime)) / 1000),
  status_before: item._status_before || item.status,
  status_after: item._status_after || 'unknown',
  model_used: $env.OPENROUTER_MODEL_TRIAGE || 'unknown',
  tokens_used: $('Extract API Cost').first().json._tokens_used || 0,
  api_cost_usd: $('Extract API Cost').first().json._cost_this_call || 0,
  result: item._gate_passed === false ? 'failed' : 'success',
  retry_count: parseInt(item.retry_count) || 0,
  quality_gate: {
    gate_id: item._gate_id || '',
    passed: item._gate_passed !== false,
    failed_criteria: item._failed_criteria || []
  },
  output_summary: item._agent_summary || '',
  error: item._error || null,
  n8n_execution_id: $execution.id
};

const fileName = `${paddedSeq}_${agentName}_${endTime.replace(/:/g, '-')}.json`;
const filePath = `agent_logs/${item.project}/${item.id}/${fileName}`;

return [{
  json: {
    filePath: filePath,
    content: Buffer.from(JSON.stringify(logEntry, null, 2)).toString('base64'),
    message: `log(${item.id}): ${agentName} → ${logEntry.status_after}`
  }
}];
```

Gevolgd door een HTTP PUT naar Gitea API om het logbestand te schrijven.

---

## Stap 2 — Dashboard API uitbreiden

Voeg aan de `SDLC Dashboard API` een optionele `?item_id=BUG-001` query parameter toe die de logs voor dat item ophaalt:

```javascript
// In de Dashboard API:
const itemId = $input.first().json.query?.item_id;
if (itemId) {
  // Haal logs op voor specifiek item
  const project = items.find(i => i.id === itemId)?.project;
  if (project) {
    const logsPath = `agent_logs/${project}/${itemId}`;
    // GET tree voor deze map
    // Parse alle JSON bestanden
    // Return gesorteerd op sequence
  }
}
```

---

## Stap 3 — Dashboard: execution timeline

In de item detail modal (IMP-10) een timeline tonen:

```javascript
// Na laden van item logs:
function renderTimeline(logs) {
  return logs.map(log => `
    <div class="timeline-entry ${log.result}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <span class="timeline-agent">${log.agent}</span>
          <span class="timeline-status">${log.status_before} → ${log.status_after}</span>
          <span class="timeline-time">${formatTime(log.timestamp_end)}</span>
        </div>
        <div class="timeline-meta">
          ⏱️ ${log.duration_seconds}s · 💰 $${log.api_cost_usd.toFixed(4)} · 🔤 ${log.tokens_used} tokens
        </div>
        ${log.error ? `<div class="timeline-error">⚠️ ${log.error}</div>` : ''}
        ${log.output_summary ? `<div class="timeline-summary">${log.output_summary}</div>` : ''}
      </div>
    </div>
  `).join('');
}
```

---

## Stap 4 — Gitea Action uitsluiting

Voeg toe aan `paths-ignore` in `.gitea/workflows/sdlc-trigger.yml`:

```yaml
paths-ignore:
  - 'LOCK.json'
  - 'QUEUE.json'
  - 'dashboard/**'
  - 'agent_logs/**'   # ← NIEUW
```

---

## Verificatie

1. Verwerk een item door de volledige pipeline (new → documented)
2. Check `agent_logs/{project}/{item_id}/` — bevat JSON per stap
3. Dashboard item detail: timeline toont alle stappen met tijden en kosten
4. Fout-scenario: agent faalt → log bevat `result: "failed"` en `error`
