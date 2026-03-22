# SDLC Platform v3 — Puur Markdown Werkvoorraad met Volledige STP

**Kernprincipe:** De volledige werkvoorraad leeft als `.md` bestanden in één centrale Git-repo.
Elk werkitem doorloopt de volledige SDLC pipeline automatisch — van `new` naar `documented`
zonder menselijke tussenkomst, tenzij een kwaliteitsgate dat vereist.

**Straight Through Processing (STP):**
```
new → triaged → planned → in-progress → review → testing → staging-verified → done → documented
```

Enige externe afhankelijkheden: Gitea, n8n, Anthropic API, Coolify v4.


## Mapstructuur van `sdlc-platform` repo

```
sdlc-platform/
│
├── README.md
│
├── projects/
│   └── {project-naam}/
│       ├── CLAUDE.md                    ← AI context: stack, conventies, paden
│       ├── backlog/
│       │   ├── bugs/
│       │   │   └── BUG-001_login-crash.md
│       │   ├── issues/
│       │   │   └── ISS-001_slow-query.md
│       │   ├── epics/
│       │   │   └── EP-001_authenticatie.md
│       │   ├── features/
│       │   │   └── FE-001_login-form.md
│       │   └── stories/
│       │       └── US-001_user-kan-inloggen.md
│       ├── docs/
│       │   ├── PROJECT.md              ← levende projectdocumentatie (mens + agent)
│       │   ├── CHANGELOG.md            ← release notes per versie/datum
│       │   └── AGENTS.md              ← optioneel: extra context voor AI agents
│       └── decisions/
│           └── ADR-001_jwt-vs-sessions.md   ← optioneel: architecture decisions
│
├── shared/
│   ├── agents/
│   │   ├── triage.md
│   │   ├── planner.md                 ← maakt branch + draft PR aan
│   │   ├── developer.md
│   │   ├── reviewer.md                ← post PR review comments in Gitea
│   │   ├── tester.md                  ← incl. dependency vulnerability scan
│   │   ├── devops.md                  ← staging → productie, auto-rollback
│   │   ├── documenter.md              ← bijwerkt docs + schrijft release notes
│   │   ├── secret-scanner.md          ← NEW: scant git diff op secrets
│   │   └── context-updater.md         ← NEW: verrijkt CLAUDE.md na elke cyclus
│   ├── quality-gates/
│   │   ├── QG-01_triage.md
│   │   ├── QG-02_planning.md
│   │   ├── QG-03_development.md
│   │   ├── QG-03b_secret-scan.md      ← NEW: secret scanning gate
│   │   ├── QG-04_review.md            ← incl. Gitea commit statuses
│   │   ├── QG-05_testing.md           ← incl. staging-verified status
│   │   ├── QG-05b_vuln-scan.md        ← NEW: dependency vulnerability gate
│   │   ├── QG-06_deploy.md            ← incl. auto-rollback
│   │   ├── QG-06b_staging-verify.md   ← NEW: staging verificatie gate
│   │   └── QG-07_documentation.md
│   ├── templates/
│   │   ├── BUG.md
│   │   ├── ISS.md
│   │   ├── EP.md
│   │   ├── FE.md                      ← incl. staging/preview URL velden
│   │   ├── US.md                      ← incl. depends_on veld
│   │   ├── CLAUDE.md                  ← NEW: project template
│   │   ├── PROJECT.md                 ← incl. bekende kwetsbaarheden sectie
│   │   └── CHANGELOG.md
│   └── scripts/
│       └── sdlc-new.sh                ← NEW: CLI voor aanmaken werkitems
│
├── workflows/
│   └── n8n-workflows.md               ← Volledige n8n workflow specificaties (19 workflows)
│
└── .gitea/
    └── workflows/
        ├── sdlc-trigger.yml            ← HMAC-signed Gitea Action → n8n
        └── project-webhook.yml         ← NEW: per project-repo event handler
```

**Wat Gitea doet:** alleen Git-hosting en het uitvoeren van één Action die gewijzigde bestanden
doorstuurt naar n8n. Verder niks.

---

## Bestandsformaat: frontmatter als state machine

Elk werkitem is een `.md` bestand met YAML frontmatter bovenaan.
De `status` in de frontmatter bepaalt waar het item zich in de pipeline bevindt.
n8n leest deze status en stuurt het item naar de juiste agent.

### Status-waarden per type

| Type | Mogelijke statussen |
|------|-------------------|
| bug | `new` → `triaged` → `planned` → `in-progress` → `review` → `testing` → `staging-verified` → `done` → `documented` |
| issue | `new` → `triaged` → `planned` → `in-progress` → `review` → `staging-verified` → `done` → `documented` |
| epic | `new` → `triaged` → `active` → `done` → `documented` |
| feature | `new` → `planned` → `in-progress` → `review` → `testing` → `staging-verified` → `done` → `documented` |
| story | `new` → `in-progress` → `review` → `testing` → `staging-verified` → `done` → `documented` |

**Extra statussen voor foutafhandeling:**
- `needs-human` — menselijke input vereist (pipeline gestopt)
- `deploy-failed` — deployment gefaald, rollback uitgevoerd

**Velden die door agents worden ingevuld** (beginnen leeg of als `""`)

```yaml
branch: ""              # ingevuld door Planner Agent
pr_number: ""           # ingevuld door Planner Agent (draft PR)
pr_url: ""              # ingevuld door Planner Agent
commit: ""              # ingevuld door Developer Agent
test_result: ""         # pass | fail — ingevuld door Tester Agent
vulnerability_scan: ""  # ok | moderate | blocked — ingevuld door Tester Agent
staging_url: ""         # ingevuld door DevOps Agent
staging_deployed_at: "" # ingevuld door DevOps Agent
deployed_at: ""         # productie timestamp — ingevuld door DevOps Agent
documented_at: ""       # ingevuld door Documenter Agent
retry_count: 0          # bijgehouden door n8n (max 3)
```

**Velden die door de mens worden ingevuld** (verplicht bij aanmaken)

```yaml
id: BUG-001
type: bug
project: spaartrack
title: "Login pagina crasht bij leeg wachtwoord"
status: new
priority: high
created: 2026-03-21
```

---

## Templates

### `shared/templates/BUG.md`

```markdown
---
id: BUG-XXX
type: bug
project: PROJECTNAAM
title: ""
status: new
priority: medium        # low | medium | high | critical
severity: minor         # trivial | minor | major | critical
created: YYYY-MM-DD
updated: YYYY-MM-DD
reported_by: ""         # optioneel
affects_version: ""     # optioneel
epic: ""                # optioneel: EP-XXX
branch: ""
pr_number: ""
commit: ""
test_result: ""
deployed_at: ""
triage_notes: ""
---

## Beschrijving
<!-- Wat gaat er mis? -->

## Stappen om te reproduceren
1. 
2. 
3. 

## Verwacht gedrag
<!-- Wat zou er moeten gebeuren? -->

## Werkelijk gedrag
<!-- Wat gebeurt er nu? -->

## Omgeving
- OS:
- Browser/versie:
- Relevante logs:

## Mogelijke oorzaak
<!-- Optioneel: eigen analyse -->
```

---

### `shared/templates/ISS.md`

```markdown
---
id: ISS-XXX
type: issue
project: PROJECTNAAM
title: ""
status: new
priority: medium        # low | medium | high | critical
category: performance   # performance | security | ux | technical-debt | dependency
created: YYYY-MM-DD
updated: YYYY-MM-DD
epic: ""                # optioneel: EP-XXX
branch: ""
pr_number: ""
commit: ""
triage_notes: ""
---

## Beschrijving
<!-- Wat is het probleem of de verbeterpunt? -->

## Impact
<!-- Wat is de impact op gebruikers of systeem als dit niet wordt opgepakt? -->

## Voorstel
<!-- Optioneel: eigen idee voor aanpak -->

## Acceptatiecriteria
- [ ] 
- [ ] 
```

---

### `shared/templates/EP.md`

```markdown
---
id: EP-XXX
type: epic
project: PROJECTNAAM
title: ""
status: new
priority: medium        # low | medium | high | critical
created: YYYY-MM-DD
updated: YYYY-MM-DD
target_version: ""      # optioneel
features: []            # wordt ingevuld door Triage/Planner: [FE-001, FE-002]
triage_notes: ""
---

## Doel
<!-- Wat willen we bereiken met dit epic? -->

## Achtergrond
<!-- Waarom is dit nodig? Context voor de AI agents. -->

## Scope
<!-- Wat valt WEL onder dit epic? -->

## Buiten scope
<!-- Wat valt NIET onder dit epic? -->

## Acceptatiecriteria (op epic-niveau)
- [ ] 
- [ ] 

## Gerelateerde epics
<!-- Optioneel: andere EP-XXX die afhankelijk zijn of overlappen -->
```

---

### `shared/templates/FE.md`

```markdown
---
id: FE-XXX
type: feature
project: PROJECTNAAM
title: ""
status: new
priority: medium        # low | medium | high | critical
epic: EP-XXX            # verplicht: parent epic
created: YYYY-MM-DD
updated: YYYY-MM-DD
stories: []             # wordt ingevuld door Planner Agent: [US-001, US-002]
branch: ""
pr_number: ""
test_result: ""
deployed_at: ""
plan: ""                # pad naar plan bestand of inline JSON
triage_notes: ""
---

## Beschrijving
<!-- Wat moet er gebouwd worden? -->

## Gebruikerswaarde
<!-- Wat levert dit de gebruiker op? -->

## Technische context
<!-- Relevante technische informatie voor de AI agents.
     Stack, bestaande componenten, API endpoints, etc. -->

## Acceptatiecriteria
- [ ] 
- [ ] 
- [ ] 

## Definition of Done
- [ ] Code geschreven en gecommit
- [ ] Unit tests aanwezig (≥ 80% coverage op nieuwe code)
- [ ] Code review gedaan
- [ ] Integration tests groen
- [ ] Deployed naar staging
```

---

### `shared/templates/US.md`

```markdown
---
id: US-XXX
type: story
project: PROJECTNAAM
title: ""
status: new
priority: medium
feature: FE-XXX         # verplicht: parent feature
estimate: M             # XS | S | M | L | XL
created: YYYY-MM-DD
updated: YYYY-MM-DD
branch: ""
commit: ""
pr_number: ""
test_result: ""
retry_count: 0          # wordt bijgehouden door n8n
---

## Story
**Als** [type gebruiker]
**wil ik** [actie]
**zodat** [doel/waarde]

## Acceptatiecriteria
- [ ] 
- [ ] 
- [ ] 

## Test scenarios
<!-- n8n geeft dit mee aan de Tester Agent -->
1. Happy path:
2. Fout scenario:
3. Edge case:

## Notities
<!-- Technische notities, UI mockup verwijzing, etc. -->
```

---

## Shared agents

### `shared/agents/triage.md`

```markdown
# Triage Agent

## Rol
Je analyseert nieuwe werkitems (bugs, issues, epics, features) op volledigheid
en prioriteit, en vult ontbrekende metadata in.

## Input
Je ontvangt:
1. Het volledige .md bestand van het item
2. De CLAUDE.md van het project

## Taken per type

**Bug:**
- Verifieer dat reproductiestappen aanwezig zijn
- Bepaal de severity (trivial/minor/major/critical) op basis van impact
- Bepaal of het een hotfix vereist (critical bugs → priority: critical)
- Vul `triage_notes` in met technische analyse

**Issue:**
- Categorie bepalen (performance/security/ux/technical-debt/dependency)
- Impact inschatten
- Koppelen aan bestaand epic als dat bestaat

**Epic:**
- Volledigheid checken: doel, scope, buiten-scope aanwezig?
- Opdelen in verwachte features (globale lijst in `features` veld)
- Priority valideren op basis van business impact

**Feature:**
- Koppeling aan epic verifiëren
- Acceptatiecriteria op volledigheid checken
- Definition of Done aanwezig?

## Output (JSON)
```json
{
  "status_update": "triaged",
  "priority": "high",
  "severity": "major",
  "triage_notes": "Analyse van het item...",
  "features": ["FE-001", "FE-002"],
  "suggested_estimate": "M",
  "needs_human_input": false,
  "needs_human_reason": ""
}
```

## Regels
- Als cruciale informatie ontbreekt die de AI niet zelf kan invullen:
  zet `needs_human_input: true` en beschrijf wat er ontbreekt.
- Wees bondig in `triage_notes` (max 3 zinnen).
- Pas `priority` alleen aan als je sterke reden hebt.
```

---

### `shared/agents/planner.md`

```markdown
# Planner Agent

## Rol
Je ontvangt een feature of bug met status `triaged` en maakt een concreet
implementatieplan. Voor features splits je op in user stories.

## Input
1. Het .md bestand van de feature of bug
2. CLAUDE.md van het project
3. Directorystructuur van de projectrepo (als tekst)

## Output voor een feature (JSON)
```json
{
  "status_update": "planned",
  "branch_name": "feature/FE-XXX-korte-slug",
  "stories": [
    {
      "id": "US-XXX",
      "title": "Korte beschrijving",
      "estimate": "S",
      "story_text": "Als ... wil ik ... zodat ...",
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "test_scenarios": ["scenario 1", "scenario 2"]
    }
  ],
  "implementation_notes": "Technische aanpak...",
  "risks": ["risico 1"]
}
```

## Output voor een bug (JSON)
```json
{
  "status_update": "planned",
  "branch_name": "fix/BUG-XXX-korte-slug",
  "root_cause": "Analyse van de oorzaak",
  "fix_approach": "Beschrijving van de fix",
  "files_likely_affected": ["pad/naar/bestand.ts"],
  "test_additions": ["wat er getest moet worden"]
}
```

## Regels
- Branch naam: lowercase, kebab-case, begint met `feature/` of `fix/`
- Story IDs: sequentieel binnen het project (haal hoogste bestaande ID op)
- Maximaal 5 stories per feature; splits bij grotere features in meerdere features
- Elke story is onafhankelijk implementeerbaar
```

---

### `shared/agents/developer.md`

```markdown
# Developer Agent

## Rol
Je implementeert één user story of bug fix per keer.

## Input
1. Het .md bestand van de story/bug (inclusief acceptatiecriteria)
2. Het plan van de Planner Agent (uit frontmatter `plan` veld van parent feature)
3. CLAUDE.md van het project
4. Inhoud van relevante bestaande bestanden (meegegeven door n8n)

## Werkwijze
1. Lees de acceptatiecriteria zorgvuldig
2. Implementeer de code
3. Schrijf unit tests
4. Controleer zelf: voldoe ik aan alle criteria?

## Output
- Geïmplementeerde bestanden (via Kilo-Code)
- Commit met message: `feat(US-XXX): beschrijving` of `fix(BUG-XXX): beschrijving`
- JSON output:
```json
{
  "status_update": "review",
  "commit": "<hash>",
  "files_created": [],
  "files_modified": [],
  "test_coverage": "82%",
  "notes": ""
}
```

## Harde regels
- Geen hardcoded secrets of credentials
- Geen TODO of FIXME in productie code
- Maximaal 200 regels per bestand; splits als het groter wordt
- Test coverage op nieuwe code ≥ 80%
- Geen `any` types in TypeScript tenzij absoluut onvermijdelijk
```

---

### `shared/agents/reviewer.md`

```markdown
# Reviewer Agent

## Rol
Je reviewt de geïmplementeerde code op kwaliteit, veiligheid en
correctheid ten opzichte van de acceptatiecriteria.

## Input
1. Git diff van de branch vs main
2. De story/bug .md (met acceptatiecriteria)
3. CLAUDE.md van het project

## Beoordeling op
- **Correctheid:** Voldoet de implementatie aan alle acceptatiecriteria?
- **Kwaliteit:** Zijn conventies gevolgd (zie CLAUDE.md)?
- **Veiligheid:** Input validatie, auth checks, geen secrets in code?
- **Tests:** Zijn tests zinvol en dekken ze de edge cases?
- **Leesbaarheid:** Is de code begrijpelijk voor een andere developer?

## Output (JSON)
```json
{
  "approved": true,
  "status_update": "testing",
  "comments": [],
  "blocking_issues": [],
  "suggestions": []
}
```

Als `approved: false`:
- `status_update`: terug naar `"in-progress"`
- `blocking_issues`: lijst van kritieke problemen die opgelost moeten worden
- `comments`: niet-kritieke opmerkingen

## Regels
- `approved: false` alleen bij: security issues, ontbrekende tests, niet-voldoen
  aan acceptatiecriteria, of ernstige conventies-overtredingen
- Stijl-opmerkingen zijn `suggestions`, niet `blocking_issues`
```

---

### `shared/agents/tester.md`

```markdown
# Tester Agent

## Rol
Je voert de test suite uit en valideert of de implementatie klaar is voor deployment.

## Input
1. Test output (stdout van de test runner, meegegeven door n8n via SSH)
2. De story/bug .md (met test scenarios)
3. Coverage rapport

## Beoordeling
- Alle bestaande tests groen?
- Nieuwe tests groen?
- Coverage ≥ 80% op nieuwe code?
- Test scenarios uit de story afgedekt?

## Output (JSON)
```json
{
  "passed": true,
  "status_update": "done",
  "test_summary": "45 passed, 0 failed",
  "coverage": "84%",
  "failed_tests": [],
  "missing_scenarios": []
}
```

Als `passed: false`: `status_update` → `"in-progress"` (terug naar Developer Agent)
```

---

### `shared/agents/devops.md`

```markdown
# DevOps Agent

## Rol
Je mergt de branch, triggert deployment via Coolify en verifieert het resultaat.

## Input
1. Feature/bug .md bestand (branch naam, pr_number)
2. CLAUDE.md (Coolify webhook URL, deployment config)
3. Deployment status van Coolify API

## Stappen
1. Merge branch naar main via Gitea API
2. Trigger Coolify deployment webhook
3. Poll Coolify API elke 15s op deployment status (max 10 minuten)
4. Bij succes: update `deployed_at` en `status: done`
5. Bij falen: trigger rollback, zet `status: deploy-failed`, notificeer

## Output (JSON)
```json
{
  "status_update": "done",
  "deployed_at": "2026-03-21T14:30:00Z",
  "deployment_id": "",
  "environment": "production"
}
```
```

---

## Quality Gates

### `shared/quality-gates/QG-03_development.md`

```markdown
# QG-03: Development Gate

**Fase:** Na Developer Agent, vóór Reviewer Agent
**Evalueert:** n8n + Claude API

## Verplichte criteria

### Code aanwezig
- Minstens één bestand gewijzigd of aangemaakt
- Geen syntax errors (gecontroleerd door linter output)

### Tests aanwezig
- Test bestand aanwezig voor elke nieuwe module
- Tests kunnen uitgevoerd worden (geen import errors)

### Git
- Commit aanwezig op de branch
- Commit message volgt patroon: `feat(US-XXX):` of `fix(BUG-XXX):`

### Story volledigheid
- Alle acceptance criteria zijn geïmplementeerd (zelfrapportage developer agent)
- `status` veld is bijgewerkt naar `review`
- `commit` veld is ingevuld

## Bij falen
- Retry Developer Agent met gefaalde criteria als extra context
- Maximum retry_count: 3
- Bij retry_count ≥ 3: zet status op `needs-human`, stuur notificatie
```

De andere quality gates (`QG-01` t/m `QG-06`) volgen hetzelfde formaat,
aangepast per fase.

---

## Gitea Action

### `.gitea/workflows/sdlc-trigger.yml`

```yaml
name: SDLC Trigger
on:
  push:
    branches: [main]
    paths:
      - 'projects/*/backlog/**/*.md'

jobs:
  trigger-n8n:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Detecteer gewijzigde backlog bestanden
        id: changed
        run: |
          FILES=$(git diff --name-only HEAD~1 HEAD \
            | grep 'projects/.*/backlog/.*\.md$' \
            | tr '\n' '|')
          echo "files=${FILES%|}" >> $GITHUB_OUTPUT

      - name: Stuur naar n8n
        if: steps.changed.outputs.files != ''
        run: |
          curl -sf -X POST "${{ secrets.N8N_SDLC_WEBHOOK }}" \
            -H "Content-Type: application/json" \
            -H "X-Secret: ${{ secrets.N8N_SECRET }}" \
            -d "{
              \"files\": \"${{ steps.changed.outputs.files }}\",
              \"commit_sha\": \"${{ github.sha }}\",
              \"pusher\": \"${{ github.actor }}\"
            }"
```

**Secrets die je instelt in Gitea → Repository Settings → Secrets:**
- `N8N_SDLC_WEBHOOK`: de webhook URL van de SDLC Router in n8n
- `N8N_SECRET`: een willekeurige geheime string

---

## n8n workflows

### Workflow 1: `SDLC Router`

```
Webhook (POST /sdlc-router)
  → [Code] Splits pipe-separated files in losse items
  → [HTTP] Haal bestandsinhoud op via Gitea API per item
  → [Code] Parse YAML frontmatter
  → [Switch op status]
      new           → Execute: SDLC Triage Agent
      triaged       → Execute: SDLC Planner Agent
      planned       → Execute: SDLC Developer Agent
      in-progress   → Execute: SDLC Developer Agent
      review        → Execute: SDLC Reviewer Agent
      testing       → Execute: SDLC Tester Agent
      deploy-ready  → Execute: SDLC DevOps Agent
      done          → Execute: SDLC Documenter Agent
      documented    → (geen actie: pipeline compleet)
      needs-human   → Telegram: notificatie menselijke input nodig
```

### Workflow 2: `SDLC Triage Agent`

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op (Gitea API)
  → [HTTP] Haal shared/agents/triage.md op (Gitea API)
  → [HTTP] Claude API: analyseer item
  → [Code] Parse JSON response
  → [IF] needs_human_input = true?
      ja  → [HTTP] Update frontmatter: status=needs-human
           → Telegram: "⚠️ Menselijke input vereist: {id} - {reden}"
      nee → [Code] Bouw nieuwe frontmatter op
           → [HTTP] Haal huidige bestand SHA op (Gitea API GET /contents)
           → [HTTP] Update bestand (Gitea API PUT /contents)
           → Telegram: "✅ Triage: {id} → {priority}"
```

### Workflow 3: `SDLC Planner Agent`

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op
  → [HTTP] Haal shared/agents/planner.md op
  → [HTTP] Haal directorylijst van projectrepo op (Gitea API)
  → [HTTP] Claude API: maak plan
  → [Code] Parse JSON response
  → [HTTP] Maak branch aan in projectrepo (Gitea API POST /branches)
  → [HTTP] Update frontmatter van feature/bug: branch, status=planned
  → [IF] type = feature?
      ja → [Loop] Per story in plan:
               [Code] Genereer US .md bestand vanuit template
               [HTTP] Schrijf story bestand naar sdlc-platform repo
           → Update features[] in parent epic frontmatter
  → Telegram: "📋 Plan: {id} → {n} stories, branch: {branch}"
```

### Workflow 4: `SDLC Developer Agent`

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op
  → [HTTP] Haal shared/agents/developer.md op
  → [HTTP] Haal plan op uit parent feature frontmatter
  → [HTTP] Kilo-Code API / SSH: voer implementatie uit
  → [HTTP] Execute: SDLC Quality Gate Checker (QG-03)
  → [IF] gate passed?
      ja  → [HTTP] Update frontmatter: status=review, commit=<hash>
            → Telegram: "👨‍💻 Dev: {id} geïmplementeerd"
      nee → [Code] retry_count + 1
           → [IF] retry_count >= 3?
               ja  → [HTTP] Update frontmatter: status=needs-human
                    → Telegram: "⚠️ Dev agent stuck: {id}"
               nee → [HTTP] Update frontmatter: retry_count=N
                    → Telegram: "🔄 Retry {retry_count}/3: {id}"
                    (nieuw commit → Gitea Action → Router → terug hier)
```

### Workflow 5: `SDLC Quality Gate Checker`

```
Execute Workflow Trigger (input: {project, gate_id, context})
  → [HTTP] Haal shared/quality-gates/{gate_id}.md op
  → [HTTP] Claude API: evalueer context tegen gate criteria
  → [Code] Parse {passed, failed_criteria}
  → Return {passed, failed_criteria}
```

### Workflow 6: `SDLC Reviewer Agent`

```
Execute Workflow Trigger
  → [HTTP] Haal git diff op (Gitea API: compare branch vs main)
  → [HTTP] Haal shared/agents/reviewer.md op
  → [HTTP] Claude API: review de diff
  → [HTTP] Execute: SDLC Quality Gate Checker (QG-04)
  → [IF] approved?
      ja  → [HTTP] Update frontmatter: status=testing
      nee → [HTTP] Update frontmatter: status=in-progress
            → Voeg blocking_issues toe als comment aan het .md bestand
  → Telegram: "🔍 Review: {id} → {approved/rejected}"
```

### Workflow 7: `SDLC Tester Agent`

```
Execute Workflow Trigger
  → [SSH] cd /workspace/{project} && git pull && npm test -- --coverage --json
  → [Code] Parse test output
  → [HTTP] Execute: SDLC Quality Gate Checker (QG-05)
  → [IF] passed?
      ja  → [HTTP] Update frontmatter: status=deploy-ready, test_result=pass
      nee → [HTTP] Update frontmatter: status=in-progress, test_result=fail
  → Telegram: "🧪 Test: {id} → {passed/failed} ({coverage})"
```

### Workflow 8: `SDLC DevOps Agent`

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op (voor Coolify webhook URL)
  → [HTTP] Merge branch via Gitea API
  → [HTTP] Trigger Coolify deployment webhook
  → [Loop] Poll Coolify deployment status (elke 15s, max 40x):
       [HTTP] GET Coolify /api/v1/deployments/{id}
       [IF] status = finished → break
       [IF] status = failed → rollback, break
  → [IF] deployment success?
      ja  → [HTTP] Update frontmatter: status=done, deployed_at=<timestamp>
            → Telegram: "🚀 Deploy: {id} → productie"
      nee → [HTTP] Update frontmatter: status=deploy-failed
            → Telegram: "💥 Deploy gefaald: {id}"
```

---

### Workflow 9: `SDLC Documenter Agent`

```
Execute Workflow Trigger
  → [HTTP] Haal CLAUDE.md op
  → [HTTP] Haal shared/agents/documenter.md op
  → [HTTP] Haal projects/{project}/docs/PROJECT.md op (Gitea API, 404 = nieuw)
  → [HTTP] Haal projects/{project}/docs/CHANGELOG.md op (Gitea API, 404 = nieuw)
  → [HTTP] Haal lijst van bestanden in projects/{project}/backlog/ op
  → [HTTP] Claude API: analyseer voltooid item + genereer doc-updates
  → [Code] Parse JSON response
  → [IF] PROJECT.md bestaat al?
      ja  → [Code] Merge updates in bestaand PROJECT.md
      nee → [Code] Genereer PROJECT.md vanuit shared/templates/PROJECT.md
  → [IF] CHANGELOG.md bestaat al?
      ja  → [Code] Voeg entry in boven de eerste bestaande entry
      nee → [Code] Genereer CHANGELOG.md vanuit shared/templates/CHANGELOG.md
  → [HTTP] Schrijf PROJECT.md naar sdlc-platform repo (Gitea API PUT/POST)
  → [HTTP] Schrijf CHANGELOG.md naar sdlc-platform repo (Gitea API PUT/POST)
  → [HTTP] Execute: SDLC Quality Gate Checker (QG-07)
  → [IF] gate passed?
      ja  → [HTTP] Update frontmatter item: status=documented
            → Telegram: "📝 Docs bijgewerkt: {id} — {summary}"
      nee → [Code] retry_count + 1
           → [IF] retry_count >= 2?
               ja  → [HTTP] Update frontmatter: status=needs-human
                    → Telegram: "⚠️ Documentatie incompleet: {id}"
               nee → Retry Documenter Agent met gefaalde criteria
```

---

## Hoe frontmatter updaten werkt in n8n (herbruikbaar patroon)

Elke agent die frontmatter moet updaten gebruikt dit patroon:

### Stap A: Haal het bestand en zijn SHA op

```
HTTP Request
GET http://{GITEA_URL}/api/v1/repos/sdlc-platform/sdlc-platform/contents/{filePath}
Headers: Authorization: token {GITEA_TOKEN}

Response bevat: { content: "<base64>", sha: "<sha>" }
```

### Stap B: Decodeer, update, re-encodeer

```javascript
// Code node
const file = $input.first().json;
const decoded = Buffer.from(file.content, 'base64').toString('utf8');

// Vervang specifieke frontmatter velden
// Gebruik een regex per veld zodat je niet de hele YAML hoeft te parsen
const updates = {
  status: 'review',
  commit: '<hash>',
  'updated': new Date().toISOString().split('T')[0]
};

let updated = decoded;
for (const [key, value] of Object.entries(updates)) {
  const regex = new RegExp(`^(${key}:).*$`, 'm');
  if (regex.test(updated)) {
    updated = updated.replace(regex, `$1 ${value}`);
  }
}

return [{
  json: {
    content: Buffer.from(updated).toString('base64'),
    sha: file.sha,
    filePath: $node['Parse Changed Files'].json.filePath
  }
}];
```

### Stap C: Schrijf terug naar Gitea

```
HTTP Request
PUT http://{GITEA_URL}/api/v1/repos/sdlc-platform/sdlc-platform/contents/{filePath}
Headers: Authorization: token {GITEA_TOKEN}
Body: {
  "message": "chore(sdlc): update {id} status → {nieuwe_status}",
  "content": "<base64>",
  "sha": "<sha>"
}
```

Dit commit automatisch naar `main` in `sdlc-platform`, wat de Gitea Action opnieuw triggert.
Zo loopt de pipeline automatisch door naar de volgende stap.

---

## n8n environment variabelen

Stel deze in via n8n → Settings → Variables:

| Variabele | Waarde |
|-----------|--------|
| `GITEA_URL` | `http://{unraid-ip}:3000` |
| `GITEA_TOKEN` | Gitea API token (read+write) |
| `GITEA_ORG` | `sdlc-platform` |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `CLAUDE_MODEL_TRIAGE` | `claude-haiku-3-20241022` (goedkoop, snel) |
| `CLAUDE_MODEL_DEV` | `claude-sonnet-4-5` (balans kwaliteit/kosten) |
| `CLAUDE_MODEL_REVIEW` | `claude-opus-4-5` (krachtigst voor security review) |
| `CLAUDE_MODEL_SCAN` | `claude-haiku-3-20241022` (snel voor patroonherkenning) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Telegram chat ID |
| `COOLIFY_URL` | `http://{unraid-ip}:8000` |
| `COOLIFY_TOKEN` | Coolify API token |
| `N8N_SECRET` | HMAC secret (32 bytes hex: `openssl rand -hex 32`) |
| `N8N_BASE_URL` | n8n externe URL (voor Coolify callbacks) |

---

## CLAUDE.md template per project

Zie `shared/templates/CLAUDE.md` voor het volledige template.
Sla op als `projects/{naam}/CLAUDE.md` en vul alle velden in.

**Verplichte velden voor volledige STP:**
- `coolify_staging_uuid` — Coolify staging application UUID
- `coolify_production_uuid` — Coolify productie application UUID
- `staging_url` — URL voor health check na staging deployment
- `production_url` — URL voor health check na productie deployment

---


## CLAUDE.md template per project

Sla op als `projects/{naam}/CLAUDE.md`:

```markdown
# CLAUDE.md — {Projectnaam}

## Beschrijving
{Korte beschrijving van het project}

## Tech stack
- **Frontend:** {bijv. React 18, TypeScript, Tailwind CSS}
- **Backend:** {bijv. FastAPI, Python 3.12}
- **Database:** {bijv. PostgreSQL 16}
- **Testing:** {bijv. pytest, Vitest}
- **Package manager:** {npm / pnpm / uv}

## Repo locatie
- **Gitea URL:** http://{unraid-ip}:3000/sdlc-platform/{project-naam}
- **Lokaal pad (VSCode Server):** /workspace/{project-naam}

## Mapstructuur
{Korte weergave van de mappenstructuur van de codebase}

## Code conventies
- Commit messages: Conventional Commits (feat/fix/chore/docs/test)
- Branch namen: feature/US-XXX-slug of fix/BUG-XXX-slug
- Max regels per bestand: 200
- {Taal-specifieke regels: Black/isort voor Python, ESLint voor TS, etc.}

## Test commando's
- Unit tests: `{commando}`
- Coverage rapport: `{commando}`
- Lint: `{commando}`

## Deployment
- Coolify webhook (staging): {URL}
- Coolify webhook (productie): {URL}
- Coolify project ID: {ID}

## Quality gate drempels
- Test coverage: ≥ 80%
- Linter: 0 errors
```

---

## Chronologisch stappenplan

### Fase 0 — Voorbereiding (15 min)

**0.1** Controleer dat deze containers actief zijn op Unraid:
   - `gitea` (poort 3000)
   - `n8n` (noteer poort)
   - `coolify` (poort 8000)

**0.2** Genereer een Gitea API token:
   Gitea → avatar → Settings → Applications → Generate Token
   Sla op als `GITEA_TOKEN`

**0.3** Genereer een Anthropic API key via console.anthropic.com

**0.4** Controleer of VSCode Server draait (`code-server` op Unraid)

---

### Fase 1 — sdlc-platform repo aanmaken (20 min)

**1.1** Open Gitea → New Organization → naam: `sdlc-platform`

**1.2** New Repository → naam: `sdlc-platform`, init with README, branch: `main`

**1.3** Clone de repo naar VSCode Server:
```bash
git clone http://{unraid-ip}:3000/sdlc-platform/sdlc-platform.git
cd sdlc-platform
```

**1.4** Maak de volledige mapstructuur aan:
```bash
mkdir -p projects/demo-project/backlog/{bugs,issues,epics,features,stories}
mkdir -p projects/demo-project/decisions
mkdir -p shared/{agents,quality-gates,templates}
mkdir -p .gitea/workflows
touch projects/demo-project/backlog/.gitkeep
touch projects/demo-project/CLAUDE.md
```

**1.5** Schrijf alle templates (zie Template sectie hierboven) naar `shared/templates/`:
   - `BUG.md`, `ISS.md`, `EP.md`, `FE.md`, `US.md`

**1.6** Schrijf alle agent-prompts naar `shared/agents/`:
   - `triage.md`, `planner.md`, `developer.md`, `reviewer.md`, `tester.md`, `devops.md`, `documenter.md`

**1.7** Schrijf alle quality gates naar `shared/quality-gates/`:
   - `QG-01_triage.md` t/m `QG-07_documentation.md`

**1.8** Schrijf `.gitea/workflows/sdlc-trigger.yml` (zie hierboven)

**1.9** Commit alles:
```bash
git add .
git commit -m "chore: initial sdlc-platform structure"
git push origin main
```

---

### Fase 2 — Gitea Actions runner (15 min)

**2.1** Gitea → Site Administration → Runners → Create Runner
   Kopieer het registratie-token

**2.2** Voeg de runner toe als Docker container (via Dockge op Unraid):
```yaml
services:
  gitea-runner:
    image: gitea/act_runner:latest
    restart: always
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /mnt/user/appdata/gitea-runner:/data
    environment:
      - GITEA_INSTANCE_URL=http://{unraid-ip}:3000
      - GITEA_RUNNER_REGISTRATION_TOKEN={token}
      - GITEA_RUNNER_NAME=unraid-runner
```

**2.3** Stel de secrets in op de `sdlc-platform` repo in Gitea:
   Gitea → sdlc-platform/sdlc-platform → Settings → Secrets:
   - `N8N_SDLC_WEBHOOK`: (laat tijdelijk leeg, vul in na Fase 3)
   - `N8N_SECRET`: `openssl rand -hex 32` → plak de output hier

---

### Fase 3 — n8n workflows bouwen (60 min)

**3.1** Open n8n, maak workflow: `SDLC Router`
   - Webhook node: path `sdlc-router`, method POST, Header Auth
   - Code node: splits files, parse frontmatter
   - Switch node: routing op `status`
   - Per status: Execute Workflow node naar de juiste sub-workflow
   - Activeer de workflow en kopieer de webhook URL

**3.2** Vul de webhook URL in als secret `N8N_SDLC_WEBHOOK` in Gitea (Fase 2.3)

**3.3** Stel n8n environment variabelen in (zie tabel hierboven)

**3.4** Maak workflow: `SDLC Triage Agent` (begin hier, meest eenvoudig)

**3.5** Maak workflow: `SDLC Planner Agent`

**3.6** Maak workflow: `SDLC Quality Gate Checker` (herbruikbaar door alle agents)

**3.7** Maak workflows: `SDLC Developer Agent`, `Reviewer Agent`, `Tester Agent`, `DevOps Agent`

**3.8** Maak workflow: `SDLC Error Handler`
   - Trigger: Error Workflow
   - Telegram bericht: `🚨 SDLC Error\nWorkflow: {workflowName}\nError: {error.message}\nItem: {filePath}`

---

### Fase 4 — Eerste project toevoegen (15 min)

**4.1** Schrijf `projects/demo-project/CLAUDE.md` met de stack van het project

**4.2** Maak de code-repo aan in Gitea:
   Gitea → sdlc-platform org → New Repository → naam: `demo-project`

**4.3** Stel branch protection in op `main`:
   Gitea → repo → Settings → Branches → Add rule → `main` → Require PRs

**4.4** Clone de code-repo naar VSCode Server:
```bash
cd /workspace
git clone http://{unraid-ip}:3000/sdlc-platform/demo-project.git
```

**4.5** Zet het project in Coolify:
   Coolify → New Service → koppel de Gitea repo → kopieer de webhook URL

**4.6** Vul de Coolify webhook URL in `projects/demo-project/CLAUDE.md`

---

### Fase 5 — End-to-end test (30 min)

**5.1** Maak het eerste werkitem aan. Schrijf naar `sdlc-platform` repo:
`projects/demo-project/backlog/epics/EP-001_hello-world.md`

Gebruik het EP template, vul in:
```yaml
id: EP-001
type: epic
project: demo-project
title: "Hello World API"
status: new
priority: medium
created: 2026-03-21
updated: 2026-03-21
```

```bash
git add projects/demo-project/backlog/epics/EP-001_hello-world.md
git commit -m "feat(backlog): add EP-001 hello world api"
git push origin main
```

**5.2** Controleer de flow:

| Wat te checken | Waar |
|----------------|------|
| Gitea Action triggered? | sdlc-platform repo → Actions tab |
| n8n SDLC Router execution? | n8n → Executions |
| Webhook ontvangen? | n8n → SDLC Router execution detail |
| Triage Agent uitgevoerd? | n8n → SDLC Triage Agent execution |
| Frontmatter geüpdated? | Gitea → EP-001 bestand |
| Telegram notificatie ontvangen? | Telegram |

**5.3** Verifieer dat het `EP-001` bestand nu heeft: `status: triaged`

**5.4** Maak een feature aan die het epic aanvult:
`projects/demo-project/backlog/features/FE-001_get-endpoint.md`

Dit triggert de Planner Agent.

---

### Fase 6 — Tweede project toevoegen (10 min)

Herhaal Fase 4 voor je volgende project (bijv. `spaartrack`).
De n8n workflows zijn project-agnostisch — ze lezen het `project` veld uit de frontmatter.
Geen aanpassingen nodig in n8n.

---

## Veelvoorkomende problemen en oplossingen

| Probleem | Oorzaak | Oplossing |
|----------|---------|-----------|
| Gitea Action triggert niet | Runner niet actief | Gitea → Admin → Runners: check status |
| n8n ontvangt webhook niet | Firewall of verkeerde URL | Test met `curl -X POST {webhook-url}` vanuit Unraid |
| Frontmatter update mislukt | Verkeerde SHA | Voeg altijd een GET /contents stap toe vóór de PUT |
| Claude API geeft 401 | API key verkeerd | Check n8n Variables: ANTHROPIC_API_KEY |
| Branch aanmaken mislukt | Repo bestaat niet | Zorg dat de code-repo bestaat in Gitea vóór de Planner |
| Loop door dubbele trigger | Agent commit triggert zichzelf | Gitea Action filtert op auteur: sla agent-commits over |

### Loop-preventie in de Gitea Action

Voeg toe aan `sdlc-trigger.yml` om te voorkomen dat agent-commits de pipeline opnieuw starten:

```yaml
      - name: Controleer auteur
        id: check_author
        run: |
          AUTHOR="${{ github.event.head_commit.author.name }}"
          if [[ "$AUTHOR" == "sdlc-agent" ]]; then
            echo "skip=true" >> $GITHUB_OUTPUT
          else
            echo "skip=false" >> $GITHUB_OUTPUT
          fi

      - name: Stuur naar n8n
        if: steps.changed.outputs.files != '' && steps.check_author.outputs.skip == 'false'
        run: |
          curl ...
```

Configureer in Gitea dat API-commits (vanuit n8n) de `sdlc-agent` gebruiker gebruiken,
of geef in de commit message een skip-tag mee: voeg `[sdlc-skip]` toe aan agent commit messages
en filter daarop:

```yaml
if [[ "${{ github.event.head_commit.message }}" == *"[sdlc-skip]"* ]]; then
  echo "skip=true" >> $GITHUB_OUTPUT
fi
```

En pas de commit message in alle n8n workflows aan:
```
"chore(sdlc): update {id} status → {status} [sdlc-skip]"
```
