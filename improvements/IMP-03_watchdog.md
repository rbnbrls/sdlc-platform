# IMP-03 — Watchdog: stale item detectie & automatisch herstel

**Status:** ✅ done  
**Prioriteit:** 🔴 Kritiek  
**Geschatte tijd:** 1 uur  
**Afhankelijk van:** IMP-01 (Lock Manager)  
**Raakt aan:** Nieuwe workflow SDLC Watchdog, alle templates (nieuwe velden)

---

## Probleem

Als n8n crasht, een HTTP request times out, of de Gitea API tijdelijk onbereikbaar is terwijl een agent bezig is, kan een item "vastlopen" in een status zonder dat de pipeline verder gaat. Erger: de LOCK.json blijft dan `locked: true` waardoor alle volgende items ook geblokkeerd zijn.

---

## Oplossing

Een **Watchdog workflow** die elke 15 minuten:
1. Alle actieve items (status ≠ `new`, `documented`, `needs-human`) inspecteert
2. Items ouder dan 30 minuten in dezelfde status rapporteert als stale
3. De lock vrijgeeft als het stale item de lock vasthoudt
4. Telegram-melding stuurt voor menselijke interventie

---

## Stap 1 — Voeg tracking-velden toe aan alle templates

Voeg de volgende velden toe aan **alle** templates in `shared/templates/`:

```yaml
# Pipeline tracking (ingevuld door n8n, niet door mens)
processing_started: ""   # timestamp waarop de Router dit item oppakte
processing_updated: ""   # timestamp van laatste agent-activiteit
current_agent: ""        # welke agent is/was bezig: triage | planner | developer | etc.
last_error: ""           # laatste foutmelding bij retry's
api_cost_usd: 0.00       # cumulatieve API-kosten (opgeteld door elke agent)
```

### Welke templates aanpassen:

- [x] `shared/templates/BUG.md`
- [x] `shared/templates/ISS.md`
- [x] `shared/templates/EP.md`
- [x] `shared/templates/FE.md`
- [x] `shared/templates/US.md`

### Integratie in agents

Elke agent voegt bij start toe aan de frontmatter update:

```yaml
processing_updated: "{{ $now.toISO() }}"
current_agent: "triage"   # pas aan per agent
```

Gebruik de bestaande frontmatter-update logica (regex per veld):

```javascript
// Voeg toe aan de updates-dict in elke agent
const updates = {
  status: 'triaged',
  processing_updated: new Date().toISOString(),
  current_agent: 'planner',  // volgende agent
  // ... andere velden ...
};
```

---

## Stap 2 — Nieuwe workflow: `SDLC Watchdog`

### Trigger
**Schedule Trigger**: elke 15 minuten

### Volledige workflow

```
Schedule Trigger (elke 15 min)

  → [HTTP] GET alle backlog bestanden (Gitea tree API, recursive)
  → [Code] Filter op .md bestanden in projects/*/backlog/
  → [Loop] Per bestand:
      [HTTP] GET bestandsinhoud (Gitea /contents/{path})
      [Code] Parse frontmatter
  → [Code] Detecteer stale items
  → [IF] Geen stale items:
      → Stop
  → [HTTP] GET LOCK.json
  → [Code] Verwerk stale items + lock-check
  → [IF] Lock vastgehouden door stale item:
      → [HTTP] PUT LOCK.json (release)
      → Telegram: "🔓 Watchdog: lock vrijgegeven (was vastgehouden door {{ item_id }})"
  → Telegram: Stale items rapport
```

### Node 1 — Haal alle backlog bestanden op

```javascript
// Gebruik Gitea Trees API voor efficiëntie (één call in plaats van één per bestand)
// GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=true
// sha = HEAD van main branch
```

**HTTP Request (2 calls):**

Call 1 — Haal main branch ref op:
```
GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/branches/main
```

Call 2 — Haal tree op:
```
GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/git/trees/{{ $json.commit.id }}?recursive=true
```

### Node 2 — Filter backlog bestanden

```javascript
const tree = $input.first().json.tree;
const STALE_THRESHOLD_MINUTES = 30;
const TERMINAL_STATUSES = ['new', 'documented', 'needs-human', 'deploy-failed'];

// Filter: alleen .md bestanden in backlog mappen
const backlogFiles = tree.filter(f => 
  f.type === 'blob' && 
  f.path.match(/^projects\/.+\/backlog\/.+\.md$/)
);

return backlogFiles.map(f => ({ json: { path: f.path } }));
```

### Node 3 — Loop: haal inhoud op per bestand

Gebruik **Split In Batches** node (batch size: 5) gevolgd door parallel HTTP calls:

```
HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/contents/{{ $json.path }}
```

### Node 4 — Parse frontmatter en detecteer stale

```javascript
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minuten
const TERMINAL_STATUSES = ['new', 'documented', 'needs-human', 'deploy-failed'];
const now = new Date();

const items = $input.all().map(item => {
  const file = item.json;
  const content = Buffer.from(file.content, 'base64').toString('utf8');
  
  // Simpele frontmatter parser
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!frontmatterMatch) return null;
  
  const fm = {};
  frontmatterMatch[1].split('\n').forEach(line => {
    const [key, ...vals] = line.split(':');
    if (key) fm[key.trim()] = vals.join(':').trim().replace(/^"(.*)"$/, '$1');
  });
  
  // Skip terminale statussen
  if (TERMINAL_STATUSES.includes(fm.status)) return null;
  
  // Check stale op basis van processing_updated
  const lastUpdate = fm.processing_updated 
    ? new Date(fm.processing_updated) 
    : (fm.processing_started ? new Date(fm.processing_started) : null);
  
  if (!lastUpdate) return null; // Nog nooit verwerkt
  
  const ageMs = now - lastUpdate;
  const isStale = ageMs > STALE_THRESHOLD_MS;
  
  if (!isStale) return null;
  
  return {
    item_id: fm.id,
    status: fm.status,
    current_agent: fm.current_agent || 'unknown',
    project: fm.project,
    processing_updated: fm.processing_updated,
    age_minutes: Math.round(ageMs / 1000 / 60),
    file_path: file.url.split('/contents/')[1]
  };
}).filter(Boolean);

return [{ json: { stale_items: items, count: items.length } }];
```

### Node 5 — IF: zijn er stale items?

`{{ $json.count > 0 }}`

**Nee** → Stop workflow

### Node 6 — Check lock

```
HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/.../contents/LOCK.json
```

```javascript
// Code node: Check of lock vastgehouden wordt door een stale item
const lock = JSON.parse(Buffer.from($input.first().json.content, 'base64').toString('utf8'));
const staleItems = $('Detect Stale Items').first().json.stale_items;
const staleIds = staleItems.map(i => i.item_id);

const lockHeldByStale = lock.locked && staleIds.includes(lock.locked_by);

return [{
  json: {
    lock,
    lock_sha: $input.first().json.sha,
    lockHeldByStale,
    stale_items: staleItems
  }
}];
```

### Node 7 — IF: lock vastgehouden door stale item?

`{{ $json.lockHeldByStale }}`

**Ja** → Schrijf lock vrij:

```javascript
const input = $input.first().json;
const emptyLock = {
  locked: false,
  locked_by: "",
  locked_at: "",
  pipeline_step: "",
  execution_id: ""
};
return [{
  json: {
    content: Buffer.from(JSON.stringify(emptyLock, null, 2)).toString('base64'),
    sha: input.lock_sha,
    released_from: input.lock.locked_by
  }
}];
```

Gevolgd door HTTP PUT LOCK.json.

### Node 8 — Telegram: stale items rapport

```javascript
const items = $('Check Lock').first().json.stale_items;
const lockReleased = $('Check Lock').first().json.lockHeldByStale;

let message = `⚠️ *SDLC Watchdog Rapport*\n`;
message += `${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}\n\n`;
message += `*Stale items (> 30 min geen activiteit):*\n\n`;

items.forEach(item => {
  message += `• \`${item.item_id}\` — status: ${item.status}\n`;
  message += `  Agent: ${item.current_agent} | Project: ${item.project}\n`;
  message += `  Vastgelopen: ${item.age_minutes} minuten geleden\n\n`;
});

if (lockReleased) {
  message += `🔓 Lock vrijgegeven (was bezet door \`${items.find(i => i).item_id}\`)\n\n`;
}

message += `Actie vereist: controleer de items en herstart indien nodig.`;

return [{ json: { text: message } }];
```

**Telegram node:**
```
Chat ID: {{ $env.TELEGRAM_CHAT_ID }}
Text: {{ $json.text }}
Parse mode: Markdown
```

---

## Stap 3 — Herstel-mechanisme: item handmatig herstart via Telegram

Voeg een extra n8n workflow toe: `SDLC Restart Item`

```
Webhook (POST /sdlc-restart?item_id=BUG-001)
  → [HTTP] GET bestand van item (Gitea API)
  → [Code] Parse frontmatter
  → [Code] Reset: processing_updated = now, last_error = "manually restarted"
  → [HTTP] PUT bestand (Gitea API)
  → Execute Workflow: SDLC Lock Manager (release)
  → [HTTP] Voeg item toe aan QUEUE.json (via IMP-02 logica)
  → Telegram: "🔄 {{ item_id }} handmatig herstart en in queue geplaatst"
```

Gebruik de webhook URL als Telegram-knop in het stale items rapport (zie IMP-07 voor inline keyboards).

---

## Verificatie

1. Laat een pipeline-item bewust vastlopen (bijv. zet `processing_updated` handmatig op 45 min geleden in Gitea)
2. Wacht op de volgende Watchdog run (of: activeer handmatig via n8n Test)
3. Controleer Telegram: rapport moet het stale item noemen
4. Controleer LOCK.json: moet vrijgegeven zijn als het stale item de lock hield
5. Controleer dat het item in QUEUE.json staat voor herverwerking
