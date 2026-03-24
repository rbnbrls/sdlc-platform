# IMP-01 — Concurrency Lock: één taak tegelijk

**Status:** done  
**Prioriteit:** 🔴 Kritiek  
**Geschatte tijd:** 2-3 uur  
**Raakt aan:** SDLC Router, alle agent-workflows, sdlc-trigger.yml, LOCK.json

---

## Probleem

Meerdere `.md` bestanden kunnen in één push of via snelle opeenvolgende pushes de pipeline gelijktijdig doorlopen. Dit veroorzaakt:

- **SHA-conflicten** bij Gitea API PUT /contents als twee agents tegelijk hetzelfde bestand proberen te updaten
- **Gelijktijdige SSH-sessies** op dezelfde workspace (test-runner druist door elkaar)
- **Dubbele Coolify deployments** van hetzelfde project
- **Story ID-botsingen** als de Planner twee features parallel verwerkt

---

## Oplossing

Twee complementaire mechanismen:

1. **n8n Workflow Concurrency** (onmiddellijk toe te passen, geen code)
2. **LOCK.json in de repo** (voor cross-workflow en cross-execution locking)

---

## Stap 1 — n8n Concurrency instelling (15 min)

Pas de instelling aan op **elke** SDLC sub-workflow:

```
n8n → open workflow → ⚙️ Settings → Execution order → "Single"
```

Dit zorgt dat als een tweede executie binnenkomt terwijl de eerste nog loopt, n8n de tweede in de wachtrij plaatst en pas start na afloop van de eerste.

**Zet dit in op de volgende workflows:**
- [ ] SDLC Triage Agent
- [ ] SDLC Planner Agent
- [ ] SDLC Developer Agent
- [ ] SDLC Reviewer Agent
- [ ] SDLC Tester Agent
- [ ] SDLC DevOps Agent
- [ ] SDLC Documenter Agent
- [ ] SDLC Quality Gate Checker

> ⚠️ De **SDLC Router** zelf krijgt deze instelling NIET — die moet snel kunnen ontvangen. De routing-logica is stateless en levert items af bij de child-workflows die wél queuen.

---

## Stap 2 — LOCK.json aanmaken in de repo

Maak het bestand `LOCK.json` aan in de root van de `sdlc-platform` repo:

```json
{
  "locked": false,
  "locked_by": "",
  "locked_at": "",
  "pipeline_step": "",
  "execution_id": ""
}
```

Commit als:
```bash
git add LOCK.json
git commit -m "chore(sdlc): add pipeline lock file [sdlc-skip]"
git push origin main
```

> **Belangrijk:** voeg `LOCK.json` toe aan de `.gitea/workflows/sdlc-trigger.yml` path-filter als **exclusie**, zodat wijzigingen aan dit bestand de pipeline NIET opnieuw triggeren:

```yaml
# .gitea/workflows/sdlc-trigger.yml
on:
  push:
    branches: [main]
    paths:
      - 'projects/*/backlog/**/*.md'
    paths-ignore:
      - 'LOCK.json'
      - 'QUEUE.json'
      - 'dashboard/**'
```

---

## Stap 3 — n8n workflow: `SDLC Lock Manager` (nieuw)

Maak een nieuwe n8n workflow genaamd `SDLC Lock Manager`.

### Trigger
**Execute Workflow Trigger** (wordt aangeroepen door andere workflows)

Input-parameters:
```json
{
  "action": "acquire | release | status",
  "item_id": "BUG-001",
  "pipeline_step": "triage",
  "execution_id": "{{ $execution.id }}"
}
```

### Node 1 — Haal LOCK.json op

```
HTTP Request
Methode: GET
URL: {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/contents/LOCK.json
Headers:
  Authorization: token {{ $env.GITEA_TOKEN }}
```

### Node 2 — Parse lock-bestand

```javascript
// Code node: Parse LOCK.json
const file = $input.first().json;
const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
const sha = file.sha;

return [{
  json: {
    lock: content,
    sha: sha,
    action: $('Execute Workflow Trigger').first().json.action,
    item_id: $('Execute Workflow Trigger').first().json.item_id,
    pipeline_step: $('Execute Workflow Trigger').first().json.pipeline_step,
    execution_id: $('Execute Workflow Trigger').first().json.execution_id
  }
}];
```

### Node 3 — Switch op actie

**Switch node** op `{{ $json.action }}`:
- `acquire` → ga naar Node 4
- `release` → ga naar Node 6
- `status` → ga naar Node 7

### Node 4 — Check: is de lock vrij?

**IF node**: `{{ $json.lock.locked }}` is `false`

- **Ja (vrij)** → ga naar Node 5 (schrijf lock)
- **Nee (bezet)** → Return: `{ acquired: false, locked_by: "..." }`

### Node 5 — Schrijf lock (acquire)

```javascript
// Code node: Bouw nieuwe LOCK.json
const input = $input.first().json;
const newLock = {
  locked: true,
  locked_by: input.item_id,
  locked_at: new Date().toISOString(),
  pipeline_step: input.pipeline_step,
  execution_id: input.execution_id
};

return [{
  json: {
    content: Buffer.from(JSON.stringify(newLock, null, 2)).toString('base64'),
    sha: input.sha,
    message: `chore(lock): acquire for ${input.item_id} [sdlc-skip]`,
    acquired: true
  }
}];
```

Gevolgd door een **HTTP Request** (PUT):
```
PUT {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/contents/LOCK.json
Headers:
  Authorization: token {{ $env.GITEA_TOKEN }}
  Content-Type: application/json
Body:
{
  "message": "{{ $json.message }}",
  "content": "{{ $json.content }}",
  "sha": "{{ $json.sha }}"
}
```

Return: `{ acquired: true }`

### Node 6 — Schrijf lock vrij (release)

```javascript
// Code node: Bouw lege LOCK.json
const input = $input.first().json;
const newLock = {
  locked: false,
  locked_by: "",
  locked_at: "",
  pipeline_step: "",
  execution_id: ""
};

return [{
  json: {
    content: Buffer.from(JSON.stringify(newLock, null, 2)).toString('base64'),
    sha: input.sha,
    message: `chore(lock): release after ${input.lock.locked_by} [sdlc-skip]`
  }
}];
```

Gevolgd door HTTP PUT (zelfde als Node 5).

Return: `{ released: true }`

### Node 7 — Return lock status

Direct terugsturen: `{ locked: ..., locked_by: ..., locked_at: ... }`

---

## Stap 4 — Integreer Lock Manager in de SDLC Router

Voeg aan het begin van de SDLC Router de volgende logica toe (na het parsen van de frontmatter, vóór de Switch op status):

```
[Per item in de pipeline]:

  → Execute Workflow: SDLC Lock Manager
    (action: "acquire", item_id: {{ $json.id }}, pipeline_step: {{ $json.status }})
  
  → [IF] acquired = false:
      → [Wait] 30 seconden
      → [Loop] Max 10 pogingen:
            Execute: Lock Manager (acquire)
            [IF] acquired = true → break
      → [IF] nog steeds geblokkeerd:
            → Telegram bericht: "⏳ {{ $json.id }} staat in de wachtrij (pipeline bezet door {{ $json.locked_by }})"
            → Voeg item toe aan QUEUE.json (zie IMP-02)
            → Stop verwerking van dit item
  
  → [IF] acquired = true:
      → Verwijs item door naar de juiste agent (Switch op status, zoals nu)
```

### Zorg dat lock vrijgegeven wordt na elke status-update

In **elke** sub-workflow, direct na de laatste Gitea API PUT (de status-update):

```
→ Execute Workflow: SDLC Lock Manager (action: "release", item_id: {{ $json.id }})
```

Dit geldt ook bij alle fout-paden: als een agent `needs-human` schrijft, moet de lock ook vrijgegeven worden.

---

## Stap 5 — Voeg `processing_started` toe aan alle templates

Voeg dit veld toe aan alle `.md` templates in `shared/templates/`:

```yaml
processing_started: ""   # ingevuld door SDLC Router bij start verwerking
processing_updated: ""   # bijgewerkt door elke agent
```

De Router schrijft bij het starten:
```yaml
processing_started: "2026-03-24T20:00:00Z"
processing_updated: "2026-03-24T20:00:00Z"
```

Elke sub-workflow schrijft `processing_updated` bij met de huidige timestamp.

Dit veld gebruikt de Watchdog (IMP-03) om stale items te detecteren.

---

## Stap 6 — Deduplicatie in de Router

Voeg aan het begin van de SDLC Router (ná het ophalen van de frontmatter) een deduplicatiecheck toe:

```javascript
// Code node: Deduplicatiecheck
const item = $input.first().json;
const processingStarted = item.processing_started;

if (processingStarted) {
  const startedAt = new Date(processingStarted);
  const now = new Date();
  const minutesSinceStart = (now - startedAt) / 1000 / 60;
  
  // Als het item minder dan 5 minuten geleden in verwerking is gegaan → skip
  if (minutesSinceStart < 5) {
    return [{ json: { skip: true, reason: 'already_processing', item_id: item.id } }];
  }
}

return [{ json: { ...item, skip: false } }];
```

Gevolgd door een **IF node**: als `skip = true` → stop (geen verdere verwerking).

---

## Verificatie

Na implementatie, test met twee gelijktijdige pushes:

1. Commit twee verschillende `.md` bestanden tegelijk naar main
2. Observeer in n8n → Executions: het tweede item moet wachten tot het eerste klaar is
3. Controleer LOCK.json in Gitea: toont de juiste `locked_by` tijdens verwerking
4. Controleer dat LOCK.json leeg is na voltooiing

---

## Rollback

Als de lock door een crash niet wordt vrijgegeven:
- Open Gitea → `LOCK.json` → Edit → zet `locked: false` → commit handmatig
- Of: roep de Lock Manager aan via n8n Test-modus met `action: "release"`
