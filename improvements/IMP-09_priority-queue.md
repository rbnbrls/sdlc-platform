# IMP-09 — Prioriteit-gestuurde queue: productieverstoringen eerst

**Status:** implemented  
**Prioriteit:** 🔴 Kritiek  
**Geschatte tijd:** 1-2 uur  
**Afhankelijk van:** IMP-01, IMP-02  
**Raakt aan:** QUEUE.json, SDLC Router, SDLC Queue Processor, sdlc-router-workflow.json, sdlc-queue-processor-workflow.json

---

## Probleem

De huidige queue sorteert alleen op het `priority` veld uit de frontmatter (critical/high/medium/low). Dit houdt geen rekening met het **type werkitem**: een `medium`-priority bug in productie is urgenter dan een `high`-priority nieuwe feature. Daarnaast verwerkt de queue items al in de juiste volgorde (FIFO met priority), maar de prioriteit-berekening is te simpel.

De beheerder wil:
1. **Eén taak tegelijk** (globale lock — al geïmplementeerd via IMP-01)
2. **Items worden gesorteerd op urgentie**, niet alleen op het priority-veld
3. **Productieverstoringen, (security)issues en bugs** hebben altijd voorrang op nieuwe user stories of feature requests

---

## Oplossing: Gewogen prioriteit-score

### Prioriteitsmodel

Elk queue-item krijgt een **queue_score** die wordt berekend uit drie factoren:

```
queue_score = type_weight + priority_weight + status_weight
```

#### Factor 1: Type gewicht (`type_weight`)

| Type | Gewicht | Toelichting |
|------|---------|-------------|
| `bug` (severity: critical) | 100 | Productieverstoring |
| `bug` (severity: major) | 90 | Ernstige fout |
| `issue` (category: security) | 95 | Beveiligingsprobleem |
| `bug` (severity: minor) | 70 | Kleinere fout |
| `issue` (category: performance) | 65 | Performance issue |
| `issue` (overig) | 60 | Overig issue |
| `bug` (severity: trivial) | 50 | Triviale fout |
| `feature` | 30 | Nieuwe functionaliteit |
| `story` | 20 | Implementatie-eenheid |
| `epic` | 10 | Overzichtsitem |

#### Factor 2: Priority gewicht (`priority_weight`)

| Priority | Gewicht |
|----------|---------|
| `critical` | 40 |
| `high` | 30 |
| `medium` | 20 |
| `low` | 10 |

#### Factor 3: Status gewicht (`status_weight`)

Items die al verder in de pipeline zijn krijgen een bonus om te voorkomen dat ze worden ingehaald door nieuwe items.

| Status | Gewicht |
|--------|---------|
| `staging-verified` | 15 |
| `testing` | 12 |
| `review` | 10 |
| `in-progress` | 8 |
| `planned` | 5 |
| `triaged` | 3 |
| `new` | 0 |

#### Voorbeelden

| Item | Type | Priority | Status | Score | Volgorde |
|------|------|----------|--------|-------|----------|
| BUG-005 (critical, productie down) | bug/critical | critical | new | 100+40+0 = **140** | 🥇 1e |
| ISS-012 (security vuln) | issue/security | high | triaged | 95+30+3 = **128** | 🥈 2e |
| BUG-003 (major bug) | bug/major | high | in-progress | 90+30+8 = **128** | 🥈 2e (FIFO tiebreak) |
| BUG-007 (minor bug) | bug/minor | medium | review | 70+20+10 = **100** | 4e |
| FE-002 (nieuwe feature) | feature | critical | planned | 30+40+5 = **75** | 5e |
| US-015 (user story) | story | high | new | 20+30+0 = **50** | 6e |

> **Conclusie:** Zelfs een `critical` feature (score 75) komt na een `medium` bug in review (score 100).

---

## Stap 1 — Pas QUEUE.json structuur aan

Voeg extra velden toe aan elk queue-item:

```json
{
  "queue": [
    {
      "item_id": "BUG-002",
      "file_path": "projects/spaartrack/backlog/bugs/BUG-002_crash.md",
      "status": "new",
      "project": "spaartrack",
      "type": "bug",
      "priority": "critical",
      "severity": "major",
      "category": "",
      "queue_score": 130,
      "queued_at": "2026-03-24T20:05:00Z",
      "commit_sha": "abc123"
    }
  ],
  "last_updated": "2026-03-24T20:05:00Z"
}
```

**Nieuwe velden ten opzichte van IMP-02:**
- `type` — het type werkitem (bug, issue, feature, story, epic)
- `severity` — alleen voor bugs (trivial/minor/major/critical)
- `category` — alleen voor issues (security/performance/ux/technical-debt/dependency)
- `queue_score` — de berekende prioriteitscore

---

## Stap 2 — Score-berekeningsfunctie (herbruikbaar)

Deze functie wordt gebruikt in zowel de Router (bij enqueue) als de Queue Processor (bij het ophalen van het volgende item).

```javascript
// Code node: Calculate Queue Score
// Herbruikbaar in Router enqueue en Queue Processor

function calculateQueueScore(item) {
  // Factor 1: Type gewicht
  const TYPE_WEIGHTS = {
    'bug': { 'critical': 100, 'major': 90, 'minor': 70, 'trivial': 50, '_default': 70 },
    'issue': { 'security': 95, 'performance': 65, '_default': 60 },
    'feature': { '_default': 30 },
    'story': { '_default': 20 },
    'epic': { '_default': 10 }
  };

  let typeWeight = 30; // fallback
  const typeConfig = TYPE_WEIGHTS[item.type];
  if (typeConfig) {
    if (item.type === 'bug') {
      typeWeight = typeConfig[item.severity] || typeConfig['_default'];
    } else if (item.type === 'issue') {
      typeWeight = typeConfig[item.category] || typeConfig['_default'];
    } else {
      typeWeight = typeConfig['_default'];
    }
  }

  // Factor 2: Priority gewicht
  const PRIORITY_WEIGHTS = { 'critical': 40, 'high': 30, 'medium': 20, 'low': 10 };
  const priorityWeight = PRIORITY_WEIGHTS[item.priority] || 20;

  // Factor 3: Status gewicht (verder in pipeline = hogere bonus)
  const STATUS_WEIGHTS = {
    'staging-verified': 15, 'testing': 12, 'review': 10,
    'in-progress': 8, 'planned': 5, 'triaged': 3, 'new': 0
  };
  const statusWeight = STATUS_WEIGHTS[item.status] || 0;

  return typeWeight + priorityWeight + statusWeight;
}
```

---

## Stap 3 — Pas de SDLC Router aan (enqueue met score)

Wijzig de "Parse + append item" Code node in de Router workflow.

### Huidige logica (IMP-02):
```javascript
queue.queue.push({
  item_id: item.id,
  file_path: item.filePath,
  status: item.status,
  project: item.project,
  priority: item.priority || 'medium',
  queued_at: new Date().toISOString(),
  commit_sha: ...
});

// Simpele priority sort
const PRIORITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };
queue.queue.sort((a, b) => { ... });
```

### Nieuwe logica:
```javascript
// In de Parse + append Code node van de Router:

function calculateQueueScore(item) {
  const TYPE_WEIGHTS = {
    'bug': { 'critical': 100, 'major': 90, 'minor': 70, 'trivial': 50, '_default': 70 },
    'issue': { 'security': 95, 'performance': 65, '_default': 60 },
    'feature': { '_default': 30 },
    'story': { '_default': 20 },
    'epic': { '_default': 10 }
  };
  let typeWeight = 30;
  const typeConfig = TYPE_WEIGHTS[item.type];
  if (typeConfig) {
    if (item.type === 'bug') typeWeight = typeConfig[item.severity] || typeConfig['_default'];
    else if (item.type === 'issue') typeWeight = typeConfig[item.category] || typeConfig['_default'];
    else typeWeight = typeConfig['_default'];
  }
  const PRIORITY_WEIGHTS = { 'critical': 40, 'high': 30, 'medium': 20, 'low': 10 };
  const priorityWeight = PRIORITY_WEIGHTS[item.priority] || 20;
  const STATUS_WEIGHTS = {
    'staging-verified': 15, 'testing': 12, 'review': 10,
    'in-progress': 8, 'planned': 5, 'triaged': 3, 'new': 0
  };
  const statusWeight = STATUS_WEIGHTS[item.status] || 0;
  return typeWeight + priorityWeight + statusWeight;
}

const file = $input.first().json;
const queue = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
const item = $('Parse Frontmatter').first().json;

// Deduplicatie
const alreadyQueued = queue.queue.find(q => q.item_id === item.id);
if (alreadyQueued) {
  return [{ json: { enqueued: false, reason: 'already_in_queue' } }];
}

// Bouw queue entry met volledige metadata
const queueEntry = {
  item_id: item.id,
  file_path: item.filePath,
  status: item.status,
  project: item.project,
  type: item.type || 'story',
  priority: item.priority || 'medium',
  severity: item.severity || '',
  category: item.category || '',
  queue_score: 0,
  queued_at: new Date().toISOString(),
  commit_sha: $('Webhook').first().json?.body?.after || ''
};

// Bereken score
queueEntry.queue_score = calculateQueueScore(queueEntry);

// Voeg toe en sorteer op score (hoog → laag), daarna FIFO
queue.queue.push(queueEntry);
queue.queue.sort((a, b) => {
  if (b.queue_score !== a.queue_score) return b.queue_score - a.queue_score;
  return new Date(a.queued_at) - new Date(b.queued_at);
});

queue.last_updated = new Date().toISOString();

return [{
  json: {
    content: Buffer.from(JSON.stringify(queue, null, 2)).toString('base64'),
    sha: file.sha,
    item_id: item.id,
    queue_score: queueEntry.queue_score,
    locked_by: $('Acquire Lock').first().json.locked_by || 'unknown',
    enqueued: true
  }
}];
```

---

## Stap 4 — Pas de Queue Processor aan

De Queue Processor (`sdlc-queue-processor-workflow.json`) pakt het eerste item van de queue — dat is al correct omdat de queue op `queue_score` is gesorteerd bij elke enqueue.

Als extra veiligheid: **herbereken de score bij ophalen** zodat status-wijzigingen die tussentijds zijn opgepikt correct worden meegewogen.

### Wijzig de "Pop item from queue" Code node:

```javascript
const file = $input.first().json;
const queue = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

if (!queue.queue || queue.queue.length === 0) {
  return [{ json: { empty: true } }];
}

// Herbereken scores (status kan tussentijds veranderd zijn)
function calculateQueueScore(item) {
  const TYPE_WEIGHTS = {
    'bug': { 'critical': 100, 'major': 90, 'minor': 70, 'trivial': 50, '_default': 70 },
    'issue': { 'security': 95, 'performance': 65, '_default': 60 },
    'feature': { '_default': 30 },
    'story': { '_default': 20 },
    'epic': { '_default': 10 }
  };
  let typeWeight = 30;
  const typeConfig = TYPE_WEIGHTS[item.type];
  if (typeConfig) {
    if (item.type === 'bug') typeWeight = typeConfig[item.severity] || typeConfig['_default'];
    else if (item.type === 'issue') typeWeight = typeConfig[item.category] || typeConfig['_default'];
    else typeWeight = typeConfig['_default'];
  }
  const PRIORITY_WEIGHTS = { 'critical': 40, 'high': 30, 'medium': 20, 'low': 10 };
  const priorityWeight = PRIORITY_WEIGHTS[item.priority] || 20;
  const STATUS_WEIGHTS = {
    'staging-verified': 15, 'testing': 12, 'review': 10,
    'in-progress': 8, 'planned': 5, 'triaged': 3, 'new': 0
  };
  const statusWeight = STATUS_WEIGHTS[item.status] || 0;
  return typeWeight + priorityWeight + statusWeight;
}

// Herbereken en hersorteer
queue.queue.forEach(item => {
  item.queue_score = calculateQueueScore(item);
});
queue.queue.sort((a, b) => {
  if (b.queue_score !== a.queue_score) return b.queue_score - a.queue_score;
  return new Date(a.queued_at) - new Date(b.queued_at);
});

// Pak het hoogst geprioriteerde item
const item = queue.queue.shift();
queue.last_updated = new Date().toISOString();

return [{
  json: {
    empty: false,
    next_item: item,
    remaining_queue: queue,
    queue_sha: file.sha,
    updated_queue_content: Buffer.from(JSON.stringify(queue, null, 2)).toString('base64')
  }
}];
```

---

## Stap 5 — Pas de Telegram notificatie aan

Update het enqueue-bericht zodat de score en het type zichtbaar zijn:

**Huidige tekst:**
```
⏳ BUG-002 in wachtrij geplaatst (pipeline bezet door US-001)
```

**Nieuwe tekst:**
```
⏳ BUG-002 in wachtrij geplaatst
📊 Score: 130 (bug/critical) — positie 1 van 3
🔒 Pipeline bezet door: US-001
```

---

## Stap 6 — Hotfix express lane

Voor `deploy-failed` items die opnieuw in de pipeline worden gezet (via Watchdog of handmatig):

- `deploy-failed` items krijgen een extra bonus van **+50** op hun score
- Dit zorgt dat een rollback-situatie altijd als eerste wordt opgepakt

Voeg toe aan `calculateQueueScore`:
```javascript
// Bonus voor deploy-failed items (express lane)
if (item.status === 'deploy-failed') {
  return typeWeight + priorityWeight + 50;
}
```

---

## Verificatie

### Test 1: Bug verslaat feature in queue
1. Start een feature (FE-001, priority: high) → lock actief
2. Push een bug (BUG-001, severity: critical, priority: critical) → gaat in queue
3. Push nog een feature (FE-002, priority: critical) → gaat in queue
4. Controleer QUEUE.json: BUG-001 (score 140) staat vóór FE-002 (score 75)

### Test 2: Security issue verslaat alles behalve critical bug
1. Queue bevat: US-001 (score 50), FE-003 (score 50)
2. Push ISS-001 (category: security, priority: high) → score 128
3. Controleer: ISS-001 staat vooraan

### Test 3: In-progress items krijgen bonus
1. Queue bevat: BUG-002 (minor, medium, new → score 90), BUG-003 (minor, medium, in-progress → score 98)
2. BUG-003 wordt als eerste opgepakt ondanks dezelfde base-prioriteit

---

## Compatibiliteit

- **Backward compatible:** bestaande queue-items zonder `type`/`severity`/`category` krijgen default waarden
- **LOCK.json ongewijzigd** — de globale lock blijft werken zoals in IMP-01
- **Alle projecten delen dezelfde queue** — bugs uit project A hebben voorrang op features uit project B, ongeacht welk project het is
