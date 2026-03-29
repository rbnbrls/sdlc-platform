# n8n Workflow Specificaties — SDLC Platform v2

Dit document bevat de volledige specificaties voor alle n8n workflows.
Importeer de bijbehorende JSON bestanden vanuit `workflows/n8n/`.

---

## Workflow Overzicht

| # | Naam | Trigger | Beschrijving |
|---|------|---------|-------------|
| 1 | SDLC Router | Webhook | Ontvang Gitea push, routeer op status |
| 2 | SDLC Triage Agent | Execute | Analyseer en prioriteer nieuw item |
| 3 | SDLC Planner Agent | Execute | Maak plan, branch en PR aan |
| 4 | SDLC Developer Agent | Execute | Implementeer story/bug (parallel) |
| 5 | SDLC Secret Scanner | Execute | Scan git diff op secrets |
| 6 | SDLC Reviewer Agent | Execute | Review code, post PR comments |
| 7 | SDLC Tester Agent | Execute | Run tests + dep vuln scan |
| 8 | SDLC DevOps Agent | Execute | Deploy staging → productie |
| 9 | SDLC Documenter Agent | Execute | Update docs + CHANGELOG |
| 10 | SDLC Context Updater | Execute | Verrijk CLAUDE.md |
| 11 | SDLC Quality Gate Checker | Execute | Evalueer QG criteria (herbruikbaar) |
| 12 | SDLC Dead Letter Queue | Error | Opvang gefaalde workflows |
| 13 | SDLC Staleness Monitor | Schedule | Detecteer vastgelopen items |
| 14 | SDLC Daily Standup | Schedule | Dagelijks status overzicht |
| 15 | SDLC Dashboard Generator | Schedule | Genereer DASHBOARD.md |
| 16 | SDLC Coolify Event Handler | Webhook | Verwerk Coolify deployment events |
| 17 | SDLC Project Event Handler | Webhook | Verwerk project-repo events |
| 18 | SDLC Telegram Bot | Webhook | Verwerk Telegram commando's |
| 19 | SDLC Sprint Planner | Manual/Schedule | Genereer sprint voorstel |
| 20 | SDLC Product Owner Intake | Form/Webhook | Beoordeel user feature request |

---

## Workflow 1: SDLC Router (herzien)

```
Webhook (POST /sdlc-router)
  → [Code: Verify HMAC] Verifieer HMAC-SHA256 handtekening
      Split pipe-separated file paths in losse items per bestand

  → [HTTP: Fetch File from Gitea] Per item:
      GET /api/v1/repos/{{ GITEA_ORG }}/sdlc-platform/contents/{filePath}
      Authorization: token {{ GITEA_BOT_TOKEN }}

  → [Code: Parse Frontmatter]
      Decodeer base64 → extract YAML frontmatter → parse velden
      Fout (404, geen frontmatter): skip_parse=true

  → [IF: If Parse Skip]
      skip_parse = true → Telegram parse-fout melding → stop
      skip_parse = false → ga door

  → [Code: Deduplication Check]
      Als processing_started < 5 min geleden → skip=true (al in verwerking)

  → [IF: Is Duplicate?]
      skip = true → stop (geen verdere actie)
      skip = false → ga door

  → [Execute: Acquire Lock] → SDLC Lock Manager
      action: "acquire", item_id: {id}, pipeline_step: {status}

  → [Code: Merge Lock Result]
      Combineer lock-resultaat met item-data

  → [IF: Is Acquired?]
      acquired = true:
          → [HTTP: Write Processing Started]
              PUT frontmatter: processing_started=now, processing_updated=now, current_agent="router"
          → [Switch: Route by Status]
              new              → Execute: SDLC Triage Agent
              triaged          → Execute: SDLC Planner Agent
              planned / in-progress → Execute: SDLC Developer Agent
              review           → Execute: SDLC Secret Scanner
              testing          → Execute: SDLC Tester Agent
              staging-verified → Execute: SDLC DevOps Agent
              done             → Execute: SDLC Documenter Agent
              documented       → Execute: SDLC Context Updater
              needs-human      → Telegram: "⚠️ Menselijke input vereist: {id}"
              deploy-failed    → Telegram: "💥 Deploy gefaald: {id}"
      acquired = false (pipeline bezet):
          → [HTTP: GET QUEUE.json]
          → [Code: Parse + append item] (prioriteitsscoring)
          → [IF: Is Enqueued?]
              true  → [HTTP: PUT QUEUE.json] → Telegram: item in wachtrij
              false → (al in queue, stilte)
```

**Nieuwe status `staging-verified`** vervangt `deploy-ready` om de staging/productie splitsing uit te drukken.

> ⚠️ **De Router zelf krijgt GEEN n8n concurrency-limiet** ("Single"). Alleen de sub-workflows krijgen dit. De Router is stateless en levert items af via het lock-mechanisme.

### V-01 — Router: fout-isolatie Code node

Vervang de loop in de Router door een try/catch per item zodat één falend bestand de rest niet stopt:

```javascript
// Code node: Parse en isoleer items (V-01)
const body = $input.first().json.body;
const files = body.files.split('|').filter(Boolean);

const results = [];
for (const filePath of files) {
  try {
    results.push({
      json: {
        filePath: filePath.trim(),
        commit_sha: body.commit_sha,
        pusher: body.pusher,
        error: null
      }
    });
  } catch (err) {
    results.push({
      json: {
        filePath: filePath.trim(),
        error: err.message,
        skip: true
      }
    });
  }
}

return results;
```

Voeg daarna een **IF node** toe: `skip = true` → Telegram foutmelding → stop voor dit item, andere items gaan door.

---

## sdlc-bot Commit Patroon — Verplicht in elke agent-workflow (IMP-04)

Elke HTTP Request node die een Gitea API `PUT /contents` aanroept (frontmatter updates, bestand aanmaken) **moet**:

1. `Authorization: token {{ $env.GITEA_BOT_TOKEN }}` gebruiken (niet `GITEA_TOKEN`)
2. De `author` en `committer` velden meesturen zodat Gitea de commit koppelt aan `sdlc-bot`
3. **Geen** `[sdlc-skip]` tag meer in de commit message — de committer-filter in de Gitea Action vervangt dit

### Request body patroon:

```json
{
  "message": "chore(sdlc): update {id} status → {status}",
  "content": "{{ $json.content_base64 }}",
  "sha": "{{ $json.sha }}",
  "author": {
    "name": "sdlc-bot",
    "email": "sdlc-bot@7rb.nl"
  },
  "committer": {
    "name": "sdlc-bot",
    "email": "sdlc-bot@7rb.nl"
  }
}
```

**Workflows die `GITEA_BOT_TOKEN` + author/committer gebruiken:**
- SDLC Router (processing_started write)
- SDLC Triage Agent (status update)
- SDLC Planner Agent (status update + story bestanden)
- SDLC Developer Agent (status update)
- SDLC Reviewer Agent (status update)
- SDLC Tester Agent (status update)
- SDLC DevOps Agent (status update)
- SDLC Documenter Agent (status update + PROJECT.md + CHANGELOG.md)
- SDLC Lock Manager (LOCK.json writes)
- SDLC Queue Processor (QUEUE.json writes)

---

## Lock Integratie — Verplicht in elke agent-workflow (IMP-01)

Elke sub-workflow (Triage, Planner, Developer, Reviewer, Tester, DevOps, Documenter, Context Updater) **moet** aan het eind de lock vrijgeven. Dit geldt ook bij alle **foutpaden** (needs-human, retry-exhausted, etc.).

### Patroon: Lock Release na status-update

```
[Na de laatste Gitea API PUT (status-update)]:
  → [Execute Workflow: SDLC Lock Manager]
      { action: "release", item_id: {{ $json.id }}, pipeline_step: {{ $json.status }} }

[Op elk foutpad (needs-human, Error node, etc.)]:
  → [Execute Workflow: SDLC Lock Manager]
      { action: "release", item_id: {{ $json.id }} }
```

### Patroon: processing_updated bijwerken

Elke agent schrijft bij elke Gitea PUT (status-update) ook `processing_updated` bij:

```javascript
// Voeg toe aan frontmatter update payload
processing_updated: new Date().toISOString(),
current_agent: '<agent-naam>'  // bijv. 'triage', 'planner', 'developer'
```

### n8n Concurrency instelling

Zet **Settings → Execution order → "Single"** op:
- SDLC Triage Agent
- SDLC Planner Agent
- SDLC Developer Agent
- SDLC Reviewer Agent
- SDLC Tester Agent
- SDLC DevOps Agent
- SDLC Documenter Agent
- SDLC Quality Gate Checker

> Dit zorgt dat als een tweede executie binnenkomt terwijl de eerste nog loopt, n8n de tweede in de wachtrij plaatst.

---

---

## V-05 — Reviewer: gesplitste diff-verwerking

Haal de diff per bestand op (niet als totale patch), filter lockfiles en begrens tot 20 bestanden × 500 regels:

```javascript
// Code node: Prioriteer relevante bestanden (V-05)
const files = $input.first().json.files;

const skipPatterns = ['package-lock.json', '.lock', 'dist/', 'build/', '.min.js'];
const relevantFiles = files.filter(f =>
  !skipPatterns.some(p => f.filename.includes(p))
);

// Testbestanden eerst
relevantFiles.sort((a, b) => {
  const aIsTest = a.filename.includes('.test.') || a.filename.includes('.spec.');
  const bIsTest = b.filename.includes('.test.') || b.filename.includes('.spec.');
  return bIsTest - aIsTest;
});

// Maximaal 20 bestanden, max 500 regels per bestand
return relevantFiles.slice(0, 20).map(f => ({
  json: {
    filename: f.filename,
    patch: f.patch?.split('\n').slice(0, 500).join('\n') || '',
    additions: f.additions,
    deletions: f.deletions
  }
}));
```

Combineer alle patches in één prompt:

```javascript
// Code node: Bouw reviewer diff-prompt (V-05)
const files = $input.all().map(f => f.json);
const diffSummary = files.map(f =>
  `### ${f.filename} (+${f.additions}/-${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``
).join('\n\n');

const prompt = `${reviewerPrompt}\n\n## Te reviewen wijzigingen\n\n${diffSummary}`;
```

---

## V-07 — Tester: begrensde test output

SSH command in n8n SSH node (gebruik `tail -300` om output te begrenzen):

```bash
cd /workspace/{{ $json.project }} && \
git checkout {{ $json.branch }} && git pull && \
npm test -- --coverage 2>&1 | tail -300
```

Parseer de output in een Code node:

```javascript
// Code node: Extraheer relevante test-info (V-07)
const output = $input.first().json.stdout;

const summaryMatch = output.match(/Tests?\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
const coverageMatch = output.match(/All files[^\n]*\|\s*([\d.]+)/);
const failedTests = [];

const failedMatchAll = [...output.matchAll(/✗\s+(.+)|FAIL\s+(.+)|● (.+)/g)];
failedMatchAll.slice(0, 20).forEach(m => {
  failedTests.push(m[1] || m[2] || m[3]);
});

return [{
  json: {
    raw_summary: summaryMatch ? summaryMatch[0] : 'Geen samenvatting gevonden',
    coverage_pct: coverageMatch ? parseFloat(coverageMatch[1]) : null,
    failed_tests: failedTests,
    passed: !output.includes('failed') && !output.includes('FAIL'),
    full_output_truncated: output.slice(-5000)
  }
}];
```

---

## V-09 — DevOps: rollback-verificatie met health check

Na rollback naar vorige deploymentversie: controleer of de vorige versie ook gezond is.

```javascript
// Code node: Verwerk rollback health check resultaat (V-09)
const response = $input.first().json;
const statusCode = response.$response?.statusCode;
const rollbackHealthy = statusCode >= 200 && statusCode < 300;

return [{
  json: {
    rollback_healthy: rollbackHealthy,
    status_code: statusCode,
    production_url: $('Get CLAUDE.md').first().json.production_url
  }
}];
```

Telegram node (na rollback):

```javascript
const item = $('Get Item Frontmatter').first().json;
const health = $('Rollback Health Check').first().json;

const emoji = health.rollback_healthy ? '⚠️' : '🚨';
const healthStatus = health.rollback_healthy
  ? 'Vorige versie is gezond en actief.'
  : `KRITIEK: vorige versie reageert ook niet (HTTP ${health.status_code})! Handmatige interventie vereist!`;

return [{
  json: {
    text: `${emoji} Rollback uitgevoerd: ${item.id}\n\n${healthStatus}\nURL: ${health.production_url}`
  }
}];
```

---

## V-11 — CHANGELOG: automatisch versienummer

Genereer een versienummer op basis van datum + dagelijks volgnummer (`YYYY.MM.DD-N`):

```javascript
// Code node: Genereer versienummer (V-11)
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const version = today.replace(/-/g, '.'); // YYYY.MM.DD

const changelog = $('Get CHANGELOG.md').first().json.decoded || '';
const todayEntries = (changelog.match(new RegExp(`## \\[${version}`, 'g')) || []).length;
const versionNumber = `${version}-${todayEntries + 1}`;

return [{
  json: {
    version: versionNumber,  // bijv. "2026.03.29-2"
    date: today,
    changelog_content: changelog
  }
}];
```

**CHANGELOG entry formaat:**
```markdown
## [2026.03.29-1] — 2026-03-29

### Features
- FE-001: Login form toegevoegd met OAuth2 ondersteuning

### Bug fixes
- BUG-003: Crash bij leeg wachtwoord opgelost

### Technische wijzigingen
- Dependency updates: react 18.3.1

---
```

## Workflow 3: SDLC Planner Agent (herzien)

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op (Gitea API)
  → [HTTP] Haal shared/agents/planner.md op
  → [HTTP] Haal directorylijst van projectrepo op (Gitea API /git/trees/main?recursive=1)
  → [HTTP] Haal hoogste bestaande story-ID op (scan stories/ map)
  → [HTTP] Haal actieve milestone op (Gitea API /milestones?state=open)
  → [HTTP] OpenRouter API: maak plan (model: OPENROUTER_MODEL_DEV, max 4000 tokens)
  → [Code] Parse JSON response
  → [HTTP] Check of branch al bestaat (GET /branches/{branch_name})
  → [IF] Branch bestaat niet?
      ja → [HTTP] Maak branch aan in projectrepo (Gitea API POST /branches)
  → [HTTP] Maak draft PR aan (Gitea API POST /pulls)
      Body: { title, head, base: "main", draft: true, body, milestone_id }
  → [HTTP] Sla PR number op in frontmatter: pr_number=X
  → [IF] type = feature?
      ja → [Code] Maak tijdelijke branch aan voor stories: sdlc-planner-temp-{timestamp}
           [HTTP] Maak tijdelijke branch aan van main (Gitea API)
           [Loop] Per story in plan (volgorde op depends_on DAG):
               [Code] Genereer US .md vanuit template
               [HTTP] Schrijf story naar tijdelijke branch (bouwt voort op vorige commit)
           [HTTP] Merge tijdelijke branch naar main en verwijder
           [HTTP] Update features[] in parent epic frontmatter
  → [HTTP] Update frontmatter: status=planned, branch={name}
  → Telegram: "📋 Plan: {id} → {n} stories, branch: {branch}, PR: #{pr_number}"
```

---

## Workflow 4: SDLC Developer Agent (parallel verwerking)

```
Execute Workflow Trigger (input: feature met status=planned)

  PARALLEL STORY VERWERKING:
  → [HTTP] Haal alle stories op voor deze feature (status=new of in-progress)
  → [Code] Sorteer stories op depends_on (topologische sortering)
  → [Split In Batches] Per onafhankelijke story-laag:
      → [Execute Workflow: Developer Story Runner] × parallel (max 3 gelijktijdig)
          Input: story .md, CLAUDE.md, context_files, plan, retry_context
          → Implementeer + commit
          → Execute: SDLC Quality Gate Checker (QG-03)
          → IF gate passed: update story status=review
          → IF gate failed: retry_count+1, max 3
  → [Wacht] Tot alle stories in huidige laag status=review hebben
  → [Ga naar volgende laag] (stories die depends_on vorige laag)
  
  → [HTTP] Update feature status=review (als alle stories=review)
  → Telegram: "👨‍💻 Dev: {feature_id} — {n}/{total} stories geïmplementeerd"
```

---

## Workflow 5: SDLC Secret Scanner

```
Execute Workflow Trigger
  → [HTTP] Haal git diff op (Gitea API: /compare/main...{branch})
  → [HTTP] Haal shared/agents/secret-scanner.md op
  → [HTTP] OpenRouter API: scan diff op secrets (model: OPENROUTER_MODEL_SCAN, snel en goedkoop)
  → [Code] Parse JSON response
  → [Execute] SDLC Quality Gate Checker (QG-03b)
  → [IF] scan_passed?
      ja  → [HTTP] Update commit status: SDLC Secret Scan → success
            → Trigger SDLC Reviewer Agent (volgende stap in pipeline)
      nee → [HTTP] Update frontmatter: status=in-progress
            → [HTTP] Update commit status: SDLC Secret Scan → failure
            → Voeg finding toe als commentaar aan .md werkitem
            → Telegram: "🔐 Secret gevonden: {id} — {bestand} [details in Gitea]"
```

---

## Workflow 8: SDLC DevOps Agent (push-based, herzien)

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op (staging_uuid, production_uuid, health_url)
  → [HTTP] Compare branch met main (GET /compare/main...{branch})
  → [Code] Check merge conflicten (diffstat.behind > 0)
  → [IF] Kan mergen zonder conflict?
      nee → Update frontmatter: status=needs-human, last_error="Merge conflict..."
          → Telegram: "⚠️ Merge conflict voor {id}: handmatige rebase vereist"
      ja  → [HTTP] Merge PR via Gitea API (POST /pulls/{pr}/merge)
  → [HTTP] Trigger staging deployment (Coolify API POST /applications/{staging_uuid}/start)
  
  WACHT OP COOLIFY STAGING WEBHOOK (niet pollen!):
  → [Wait] Tot SDLC Coolify Event Handler een 'finished' event stuurt voor staging_uuid
      Timeout: 10 minuten → bij timeout: rollback + needs-human
  
  → [Execute] SDLC Quality Gate Checker (QG-06b: staging verificatie)
      → Health check staging URL (2x met 15s interval)
      → Log check via Coolify API
  
  → [IF] staging OK?
      ja  → [HTTP] Trigger productie deployment (Coolify API POST /applications/{prod_uuid}/start)
            WACHT OP COOLIFY PROD WEBHOOK:
            → [Wait] Tot event handler 'finished' meldt voor prod_uuid
            → [Execute] SDLC Quality Gate Checker (QG-06: productie verificatie)
            → [IF] prod health OK?
                ja  → [HTTP] Update frontmatter: status=done, deployed_at=[timestamp]
                      → [HTTP] Gitea commit status: success
                      → Telegram: "🚀 {id} live in productie!"
                nee → [HTTP] Rollback productie (GET previous deployment, POST restart)
                      → [HTTP] Rollback Health Check (GET production_url)
                      → [HTTP] Update frontmatter: status=deploy-failed
                      → Telegram: "💥 Productie deploy gefaald: {id} — rollback uitgevoerd (health: {health})"
      nee → [HTTP] Rollback staging
            → [HTTP] Update frontmatter: status=deploy-failed
            → Telegram: "🚧 Staging verificatie gefaald: {id} — productie NIET gestart"
```

---

## Workflow 12: SDLC Dead Letter Queue

```
Error Trigger (ingesteld als Error Workflow op alle andere workflows)
  → [Code] Extraheer: workflow naam, item ID, error message, retry_count
  → [HTTP] Haal huidig item op uit sdlc-platform repo
  → [Code] retry_count + 1
  → [IF] retry_count >= 3?
      ja  → [HTTP] Update frontmatter: status=needs-human
            → Telegram: "🚨 SDLC Error (3x geprobeerd)\nWorkflow: {naam}\nItem: {id}\nFout: {error}"
      nee → [Code] Wacht 5 minuten (delay node)
            → [HTTP] Update frontmatter: retry_count={N}
            → Telegram: "🔄 Retry {N}/3: {id} (fout: {error})"
            → [Execute] Herstart de gefaalde workflow met dezelfde input
```

---

## Workflow 13: SDLC Staleness Monitor

```
Schedule Trigger: ma-vr 08:00 en 15:00
  → [HTTP] Haal alle .md bestanden op in projects/*/backlog/**/*.md (Gitea API tree)
  → [Loop] Per bestand: parse frontmatter
  → [Code] Filter: status IN (in-progress, review, testing, staging-verified)
            EN updated < vandaag - 2 dagen
  → [IF] stale items gevonden?
      ja  → [HTTP] OpenRouter API: genereer samenvatting van stale items
            → Telegram: "⚠️ {n} items staan > 48u vast:\n{lijst met id en status}"
      nee → (stilte — niet spammen)
```

---

## Workflow 14: SDLC Daily Standup

```
Schedule Trigger: ma-vr 09:00
  → [HTTP] Scan alle backlog bestanden (Gitea API)
  → [Code] Verdeel in categorieën:
    - Gisteren afgerond (documented, datum = gisteren)
    - Nu actief (in-progress, review, testing)
    - Geblokkeerd (needs-human > 4u)
    - Gepland voor vandaag (planned, priority=high/critical)
  → [IF] Niets te melden?
      ja  → Telegram: "☀️ SDLC Status: rust. Geen actieve items."
  → Telegram bericht:
    "🌅 SDLC Standup — {datum}
    
    ✅ Gisteren gereed: {lijst of 'niets'}
    🔄 In progress: {lijst}
    🚦 Review/testing: {lijst}
    🔴 Geblokkeerd: {lijst}
    📋 Gepland (hoge prio): {lijst}"
```

---

## Workflow 15: SDLC Dashboard Generator

```
Schedule Trigger: elke 2 uur
  → [HTTP] Scan alle backlog bestanden (Gitea API)
  → [Code] Aggregeer statistieken:
    - Per status: count
    - Critical needs-human items
    - Gemiddelde cycle time (new → documented) per type
    - Items per project
  → [Code] Genereer DASHBOARD.md content
  → [HTTP] Haal huidige DASHBOARD.md SHA op
  → [HTTP] Schrijf DASHBOARD.md naar sdlc-platform root
```

**DASHBOARD.md formaat:**
```markdown
# SDLC Dashboard — {datum} {tijd}

## 📊 Pipeline Status
| Status | Totaal | Spaartrack | Demo |
|--------|--------|------------|------|
| 🆕 new | 2 | 1 | 1 |
| ⚙️ in-progress | 3 | 2 | 1 |
| 🔍 review | 1 | 1 | 0 |
| 🧪 testing | 0 | 0 | 0 |
| ✅ done | 12 | 8 | 4 |

## ⚠️ Aandacht vereist
- 🔴 US-003 — retry_count: 2 (bijna max, project: spaartrack)
- 🚨 BUG-007 — needs-human > 24u (project: spaartrack)

## 📈 Gemiddelde cycle time (afgelopen 30 dagen)
| Type | Gemiddeld |
|------|-----------|
| bug | 4.2 uur |
| feature | 18.7 uur |
| story | 2.1 uur |
```

---

## SDLC Dashboard API & Action Webhook

```
Webhook GET /sdlc-dashboard
  → [Code] Valideer X-Dashboard-Secret
  → [HTTP] Haal alle backlog items op uit Gitea
  → [HTTP] Haal health.json op (uit sdlc-platform root of n8n static data)
  → [Code] Parse frontmatters en aggregeer
  → Respond: JSON data (items, stats, lock, queue, health, snapshots)

Webhook POST /sdlc-dashboard-action (IMP-10)
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

## Workflow 16: SDLC Coolify Event Handler

```
Webhook (POST /coolify-deploy-event)
  Configureer als webhook in Coolify → Application → Webhooks

  → [Code] Parse event: { application_uuid, status, deployment_id, environment }
  → [Code] Zoek in n8n Static Data: welke SDLC workflow wacht op dit UUID?
  → [IF] Wachtende workflow gevonden?
      ja  → Stuur event door naar wachtende workflow (via n8n workflow resume)
            of: schrijf status naar Static Data zodat polling workflow het oppikt
      nee  → Sla event op voor auditing, negeer
  → [IF] status = failed?
      → Telegram: "⚠️ Coolify deployment event: {uuid} is FAILED"
```

---

## Workflow 17: SDLC Project Event Handler

```
Webhook (POST /project-event)
  Ontvangen van project-repo Gitea Action (project-webhook.yml)

  → [Code] Verifieer HMAC handtekening
  → [Switch op event type]
      push (naar main)  → Log: directe push op main (buiten SDLC pipeline)
                          → IF actor != 'sdlc-agent':
                            Telegram: "⚠️ Directe push op main: {project} door {actor}"
      pull_request.closed + merged = true
                        → Log: PR gemerged — deployment is gestart via DevOps Agent
      pull_request.opened
                        → Log: nieuwe PR (kan extern zijn, buiten SDLC)
```

---

## Workflow 18: SDLC Telegram Bot

```
Webhook (POST /telegram-bot)
  Registreer bij Telegram Bot API: setWebhook

  → [Code] Parse Telegram update: message.text, chat_id, from.username
  → [Switch op commando]
      /status {id}   → [HTTP] Haal frontmatter op van {id}.md
                        → Telegram: "📋 {id}: {status} | prio: {priority} | retry: {retry_count}"
      
      /list {status} → [HTTP] Scan backlog, filter op status
                        → Telegram: "🔍 {n} items op {status}:\n{lijst}"
      
      /approve {id}  → [HTTP] Haal frontmatter op
                        → IF status == 'needs-human':
                          [HTTP] Update status terug naar vorige status
                          Telegram: "✅ {id} goedgekeurd — pipeline hervat"
                        → ELSE:
                          Telegram: "❌ {id} staat niet op needs-human (staat op: {status})"
      
      /skip {id}     → [HTTP] Update frontmatter: status=documented
                        → Telegram: "⏭️ {id} overgeslagen → documented"
      
      /retry {id}    → [HTTP] Haal frontmatter op
                        → [HTTP] Update retry_count=0
                        → Trigeer SDLC Router voor dit item
                        → Telegram: "🔄 {id} herstart (retry_count gereset)"
      
      /sprint {project}
                     → Execute: SDLC Sprint Planner voor project
                        → Telegram: sprint voorstel als reply
      
      /help          → Telegram: overzicht van alle commando's
```

---

## Workflow 19: SDLC Sprint Planner

```
Manual Trigger / Execute Workflow Trigger / Telegram command
  Input: project naam (optioneel: max_stories per sprint)

  → [HTTP] Haal alle triaged items op voor het project
  → [Code] Sorteer op: priority (critical > high > medium > low), dan estimate (XS/S eerst)
  → [HTTP] OpenRouter API: genereer sprint voorstel
      Input: gesorteerde items + CLAUDE.md (team velocity uit vorige sprints)
      Output: aanbevolen sprint inhoud + totale estimate + risico's
  → [Code] Genereer sprint markdown
  → [HTTP] Maak Gitea Milestone aan voor de sprint:
      POST /api/v1/repos/{owner}/{repo}/milestones
      Body: { "title": "Sprint {N}", "due_on": "{2 weken vanaf nu}" }
  → Telegram: "📅 Sprint voorstel voor {project}:\n{inhoud}\nVerifieer in Gitea Milestones"
```

---

## Workflow 20: SDLC Product Owner Intake

```
Form Trigger / Webhook (https://n8n.7rb.nl/webhook/feature-request)
  Input: Gebruiker vult in: Naam/Email, Project, Feature Titel, Beschrijving/Use-case

  → [HTTP] Haal actuele backlog inhoud / titles op via Gitea API (https://git.7rb.nl/api/...)
  → [HTTP] Haal shared/agents/product-owner.md op
  → [HTTP] OpenRouter API: Product Owner Agent prompt (gpt-4o / claude / etc.)
      Input: Feature Request (gebruiker), Bestaande Backlog Lijst
      Taak: Kijk of er al een feature request is met (deels) overlappende requirements.
      Output JSON: 
      {
        "bestaat_al": boolean,
        "matching_ticket_id": "string (indien true)",
        "reden": "Waarom wel of niet?",
        "geoptimaliseerde_titel": "Aangescherpte feature titel",
        "markdown_body": "Volledige geparseerde markdown conform SDLC structuur"
      }
  
  → [Switch op bestaat_al]
      true  → [HTTP] Maak commentaar aan in het bestaande ticket / voeg input toe
            → [Email/SMTP] Mail gebruiker: "Bedankt! Jouw feature wens is toegevoegd aan een bestaand ticket ({matching_ticket_id})."
            → Telegram: "🔁 Duplicate feature verzoek door PO toegevoegd aan {matching_ticket_id}"
      false → [Code] Genereer frontmatter en inhoud (status=new)
            → [HTTP] Push nieuw bestand naar Gitea repo (projects/{project}/backlog/features/FEAT-XXX.md)
            → [Email/SMTP] Mail gebruiker: "Bedankt! Je ticket is in behandeling. ID: FEAT-XXX"
            → Telegram: "💡 Nieuwe Feature Aanvraag van gebruiker! Titel: {geoptimaliseerde_titel} — door PO in triage geplaatst."
```

---

## n8n Environment Variabelen (bijgewerkt)

| Variabele | Beschrijving |
|-----------|-------------|
| `GITEA_URL` | `https://git.7rb.nl` |
| `GITEA_TOKEN` | Gitea API token (persoonlijk, admin — voor repo-aanmaak e.d.) |
| `GITEA_BOT_TOKEN` | sdlc-bot API token (repo read+write — voor alle agent-commits) |
| `GITEA_ORG` | `sdlc-platform` |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL_TRIAGE` | Default OpenRouter model (goedkoop) |
| `OPENROUTER_MODEL_DEV` | Default OpenRouter model (balans) |
| `OPENROUTER_MODEL_REVIEW` | Default OpenRouter model (krachtigst) |
| `OPENROUTER_MODEL_SCAN` | Default OpenRouter model (snel) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Telegram chat ID |
| `COOLIFY_URL` | `https://coolify.7rb.nl` |
| `COOLIFY_TOKEN` | Coolify API token |
| `N8N_SECRET` | Webhook HMAC secret (32 bytes hex) |
| `N8N_BASE_URL` | `https://n8n.7rb.nl` |

---

## Generieke Cost Tracker helper (toe te passen in alle Agent workflows)

Voeg direct na elke OpenRouter HTTP call ('chat completion') in een Agent workflow de volgende Node toe:

### Code node: `Extract API Cost`

```javascript
// Voeg toe na elke OpenRouter API call
const response = $input.first().json;

// OpenRouter kosten
const thisCost = response.usage?.total_cost || 0;

// Haal huidige cumulatieve kosten op uit de frontmatter
const currentCost = parseFloat($('Parse Frontmatter').first().json.api_cost_usd) || 0;
const newTotalCost = currentCost + thisCost;

return [{
  json: {
    ...response,
    _cost_this_call: thisCost,
    _cost_cumulative: Math.round(newTotalCost * 100000) / 100000,
    _tokens_used: response.usage?.total_tokens || 0
  }
}];
```

Integreer vervolgens deze geüpdatete cost en de tokens in de Frontmatter builder:
```javascript
// Code node: Bouw frontmatter updates
const updates = {
  // ... andere status updates ...
  api_cost_usd: $('Extract API Cost').first().json._cost_cumulative
};
```

---

## Log Writer helper (herbruikbaar in elke agent-workflow)

Voeg aan het einde van **elke** agent sub-workflow een `Write Agent Log` Code node toe, gevolgd door een HTTP PUT naar de Gitea API om het logbestand te schrijven.

### Code node: `Write Agent Log`
```javascript
const item = $('Parse Frontmatter').first().json;
const agentName = 'triage'; // pas aan per workflow
const startTime = $('Execute Workflow Trigger').first().json._start_time || new Date().toISOString();
const endTime = new Date().toISOString();

// Haal sequence nummer op (vereist een 'List Existing Logs' HTTP node hiervoor)
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

---

## Workflow 21: SDLC Health Check

```text
Schedule Trigger: elke 15 minuten

  → [HTTP] Ping Gitea API
      GET {{ $env.GITEA_URL }}/api/v1/version
      Timeout: 10s → status: ok/fail

  → [HTTP] Ping n8n zelf
      GET {{ $env.N8N_BASE_URL }}/healthz
      Timeout: 5s → status: ok/fail

  → [HTTP] Ping OpenRouter API
      POST https://openrouter.ai/api/v1/chat/completions
      Body: { model: "openai/gpt-3.5-turbo", messages: [{role:"user",content:"ping"}], max_tokens: 1 }
      Headers: Authorization: Bearer {{ $env.OPENROUTER_API_KEY }}
      Timeout: 15s → status: ok/fail

  → [HTTP] Ping Coolify API
      GET {{ $env.COOLIFY_URL }}/api/v1/healthcheck
      Headers: Authorization: Bearer {{ $env.COOLIFY_TOKEN }}
      Timeout: 10s → status: ok/fail

  → [HTTP] Ping Telegram Bot API
      GET https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/getMe
      Timeout: 10s → status: ok/fail

  → [Code] Aggregeer resultaten + Per-project checks
      (Voor elk project, controleer: Project-repo API, Coolify App, Staging en Production HTTP GET 200 checks)

  → [IF] failed.length > 0 of project_failed.length > 0
      ja → Telegram: "🚨 SDLC Health Check FAILED..."
      nee → (stilte)

  → [HTTP] Schrijf resultaat naar health.json (voor dashboard)
```
