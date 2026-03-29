# SDLC Platform — Implementatie Verbeteringen: Overzicht

Dit document geeft een overzicht van alle verbeterplannen en de aanbevolen implementatievolgorde.

---

## Alle plannen

| ID | Titel | Prioriteit | Tijd | Afhankelijk van |
|----|-------|-----------|------|-----------------|
| [IMP-01](IMP-01_concurrency-lock.md) | Concurrency Lock: één taak tegelijk | 🔴 Kritiek | 2-3 uur | — |
| [IMP-02](IMP-02_queue-manager.md) | Queue Manager: wachtrij voor items | 🔴 Kritiek | 1-2 uur | IMP-01 |
| [IMP-03](IMP-03_watchdog.md) | Watchdog: stale item detectie & herstel | 🔴 Kritiek | 1 uur | IMP-01 |
| [IMP-04](IMP-04_sdlc-bot-account.md) | sdlc-bot: dedicated Gitea account | 🟡 Normaal | 30 min | — |
| [IMP-05](IMP-05_agent-overgang-verbeteringen.md) | Agent-overgang verbeteringen (11 punten) | 🟠 Hoog | 3-4 uur | IMP-04 |
| [IMP-06](IMP-06_kosten-tracking.md) | API Kosten-tracking per werkitem | 🟡 Normaal | 1 uur | — |
| [IMP-07](IMP-07_telegram-monitor.md) | Telegram: dagrapport + inline actieknoppen | 🟢 Wenselijk | 2 uur | IMP-03, IMP-06 |
| [IMP-08](IMP-08_dashboard.md) | Dashboard: voortgangsmonitor | 🟠 Hoog | 4-6 uur | IMP-01, IMP-03, IMP-06 |
| [IMP-09](IMP-09_priority-queue.md) | Prioriteit-gestuurde queue: bugs/issues eerst | 🔴 Kritiek | 1-2 uur | IMP-01, IMP-02 |
| [IMP-10](IMP-10_dashboard-v2.md) | Dashboard v2: cross-project, filters, inline acties | 🟠 Hoog | 4-6 uur | IMP-08 |
| [IMP-11](IMP-11_execution-logs.md) | Execution logs: agent-historie en audit trail | 🟠 Hoog | 6-8 uur | IMP-06 |
| [IMP-12](IMP-12_project-onboarding.md) | Project onboarding: geautomatiseerd project toevoegen | 🟠 Hoog | 3-4 uur | IMP-04 |
| [IMP-13](IMP-13_dashboard-auth.md) | Dashboard authenticatie: OAuth via Gitea | 🟡 Normaal | 3-4 uur | IMP-08, IMP-10 |
| [IMP-14](IMP-14_analytics.md) | Historische analytics en trend-grafieken | 🟡 Normaal | 6-8 uur | IMP-08, IMP-11 |
| [IMP-15](IMP-15_dashboard-create-item.md) | Werkitem aanmaken via dashboard | 🟡 Normaal | 2-3 uur | IMP-08, IMP-10 |
| [IMP-16](IMP-16_health-check.md) | Platform health check workflow | 🟢 Wenselijk | 1-2 uur | — |

---

## Aanbevolen implementatievolgorde

### Fase A — Stabiele basis (doe dit eerst)

```
IMP-04 (sdlc-bot, 30 min)
  → IMP-01 (Concurrency Lock, 2-3 uur)
    → IMP-02 (Queue Manager, 1-2 uur)
    → IMP-03 (Watchdog, 1 uur)
```

**Waarom deze volgorde?**
- IMP-04 eerst: de sdlc-bot is nodig om de [sdlc-skip] tag uit alle workflows te halen; doe dit vóór je andere workflows bouwt
- IMP-01: de lock is de fundering van alles; bouw niets anders totdat dit werkt
- IMP-02 + IMP-03 gaan parallel na IMP-01

**Totale tijd Fase A: ~5 uur**

---

### Fase B — Robuustheid (doe dit daarna)

```
IMP-05 (Agent-overgang verbeteringen, 3-4 uur)
IMP-06 (Kosten-tracking, 1 uur)  ← kan parallel met IMP-05
```

**Waarom?**
- IMP-05 bevat 11 verbeteringen die je werkflows robuuster maken. Doe dit voordat je het dashboard bouwt, zodat het dashboard correcte data toont (bijv. `last_error`, `current_agent`, `api_cost_usd`)
- IMP-06 (kosten) kan tegelijkertijd, het raakt andere zaken niet

**Totale tijd Fase B: ~4 uur**

---

### Fase C — Monitoring & Control (doe dit als laatste)

```
IMP-07 (Telegram monitor, 2 uur)
IMP-08 (Dashboard, 4-6 uur)  ← kan parallel met IMP-07
```

**Waarom?**
- De monitoring-tools zijn het meest waardevol als de onderliggende data (kosten, foutmeldingen, timestamps) al correct wordt bijgehouden
- IMP-07 en IMP-08 kunnen parallel worden gebouwd

**Totale tijd Fase C: ~6 uur**

---

### Fase D — Prioriteitslogica + Onboarding

```
IMP-09 (Prioriteit-gestuurde queue, 1-2 uur)  ← na IMP-01 + IMP-02
IMP-12 (Project onboarding, 3-4 uur)          ← na IMP-04
IMP-16 (Health check, 1-2 uur)                ← onafhankelijk
```

**Waarom?**
- IMP-09 maakt de queue intelligent: bugs en productieverstoringen worden altijd als eerste opgepakt
- IMP-12 automatiseert het toevoegen van nieuwe projecten
- IMP-16 is onafhankelijk en snel te bouwen

**Totale tijd Fase D: ~6 uur**

---

### Fase E — Dashboard uitbreiding

```
IMP-10 (Dashboard v2, 4-6 uur)          ← na IMP-08
IMP-11 (Execution logs, 6-8 uur)        ← na IMP-06
IMP-15 (Dashboard create item, 2-3 uur) ← na IMP-10
```

**Waarom?**
- Het dashboard wordt de centrale beheer-interface: filters, inline acties, item-aanmaak
- Execution logs geven inzicht in wat elke agent heeft gedaan

**Totale tijd Fase E: ~14 uur**

---

### Fase F — Productie-klaar

```
IMP-13 (Dashboard auth, 3-4 uur)     ← na IMP-10
IMP-14 (Analytics, 6-8 uur)          ← na IMP-11
```

**Waarom?**
- Auth is pas nodig als het dashboard voldoende waarde biedt om te beveiligen
- Analytics vereist execution logs als databron

**Totale tijd Fase F: ~10 uur**

---

## Totale schatting

| Fase | Inhoud | Tijd |
|------|--------|------|
| A | Stabiele basis | ~5 uur |
| B | Robuustheid | ~4 uur |
| C | Monitoring | ~6 uur |
| D | Prioriteitslogica + Onboarding | ~6 uur |
| E | Dashboard uitbreiding | ~14 uur |
| F | Productie-klaar | ~10 uur |
| **Totaal** | | **~45 uur** |

---

## Wijzigingen in bestaande bestanden

### Templates die moeten worden uitgebreid

Alle templates in `shared/templates/` krijgen extra velden:

```yaml
# Te voegen toe aan BUG.md, ISS.md, EP.md, FE.md, US.md

# Pipeline tracking (automatisch door n8n)
processing_started: ""
processing_updated: ""
current_agent: ""
previous_status: ""
last_error: ""
api_cost_usd: 0.0000
```

### Gitea Action die moet worden bijgewerkt

`/.gitea/workflows/sdlc-trigger.yml`:
- Filter op committer-naam (`sdlc-bot`) in plaats van `[sdlc-skip]` tag
- `paths-ignore` uitbreiden met `LOCK.json`, `QUEUE.json`, `dashboard/**`, `agent_logs/**`, `analytics/**`

### Nieuwe bestanden in sdlc-platform repo

```
sdlc-platform/
├── LOCK.json              ← IMP-01
├── QUEUE.json             ← IMP-02
├── dashboard/
│   ├── index.html         ← IMP-08, IMP-10
│   ├── style.css          ← IMP-08, IMP-10
│   └── app.js             ← IMP-08, IMP-10, IMP-15
├── agent_logs/            ← IMP-11
│   └── {project}/{item_id}/*.json
├── analytics/             ← IMP-14
│   └── snapshots/*.json
└── improvements/
    ├── README.md           ← dit bestand
    ├── IMP-01 t/m IMP-09   ← Fase A-D
    └── IMP-10 t/m IMP-16   ← Fase E-F
```

### Nieuwe n8n workflows

| Naam | Plan | Trigger |
|------|------|---------|
| SDLC Lock Manager | IMP-01 | Execute Workflow |
| SDLC Queue Processor | IMP-02 | Schedule (elke 1 min) |
| SDLC Watchdog | IMP-03 | Schedule (elke 15 min) |
| SDLC Dashboard API | IMP-08 | Webhook GET /sdlc-dashboard |
| SDLC Dashboard Action | IMP-10 | Webhook POST /sdlc-dashboard-action |
| SDLC Daily Report | IMP-07 | Schedule (08:00 dagelijks) |
| SDLC Telegram Handler | IMP-07 | Webhook POST /telegram-handler |
| SDLC Restart Item | IMP-03 | Webhook POST /sdlc-restart |
| SDLC Project Setup | IMP-12 | Webhook POST /sdlc-project-setup |
| SDLC Create Item | IMP-15 | Webhook POST /sdlc-create-item |
| SDLC Health Check | IMP-16 | Schedule (elke 15 min) |
| SDLC Analytics Snapshot | IMP-14 | Schedule (dagelijks 23:55) |
| SDLC Auth Login | IMP-13 | Webhook GET /sdlc-auth-login |
| SDLC Auth Callback | IMP-13 | Webhook GET /sdlc-auth-callback |

### Nieuwe n8n environment variabelen

| Variabele | Waarde | Plan |
|-----------|--------|------|
| `GITEA_BOT_TOKEN` | sdlc-bot API token | IMP-04 |
| `DASHBOARD_SECRET` | `openssl rand -hex 24` | IMP-08 |
| `GITEA_OAUTH_CLIENT_ID` | Gitea OAuth Client ID | IMP-13 |
| `GITEA_OAUTH_CLIENT_SECRET` | Gitea OAuth Client Secret | IMP-13 |
| `JWT_SECRET` | `openssl rand -hex 32` | IMP-13 |
| `DASHBOARD_ALLOWED_USERS` | Komma-gescheiden usernames | IMP-13 |

---

## Checklist

### Fase A
- [ ] IMP-04: sdlc-bot account aangemaakt in Gitea
- [ ] IMP-04: `GITEA_BOT_TOKEN` toegevoegd aan n8n
- [ ] IMP-04: Gitea Action bijgewerkt (committer-filter)
- [ ] IMP-04: alle agent-workflows bijgewerkt (gebruik `GITEA_BOT_TOKEN`)
- [ ] IMP-01: `LOCK.json` aangemaakt en gepusht
- [ ] IMP-01: `SDLC Lock Manager` workflow gebouwd in n8n
- [ ] IMP-01: n8n concurrency instelling "Single" op alle sub-workflows
- [ ] IMP-01: Lock Manager geïntegreerd in SDLC Router
- [ ] IMP-01: `processing_started` + `processing_updated` velden aan templates
- [ ] IMP-02: `QUEUE.json` aangemaakt en gepusht
- [ ] IMP-02: `SDLC Queue Processor` workflow gebouwd in n8n
- [ ] IMP-02: Queue-enqueue logica toegevoegd aan SDLC Router
- [x] IMP-03: `SDLC Watchdog` workflow gebouwd in n8n
- [x] IMP-03: `current_agent` veld aan templates
- [x] IMP-03: `SDLC Restart Item` webhook gebouwd

### Fase B
- [ ] IMP-05/V-01: Fout-isolatie in Router Code node
- [ ] IMP-05/V-02: Branch-exists check in Planner
- [ ] IMP-05/V-03: Story-bundeling in tijdelijke branch
- [ ] IMP-05/V-04: `last_error` aan templates + integratie in alle agents
- [ ] IMP-05/V-05: Gesplitste diff-verwerking in Reviewer
- [ ] IMP-05/V-06: `## Review Feedback` sectie aan US.md + BUG.md templates
- [ ] IMP-05/V-07: Begrenzing test output in Tester (tail -300)
- [ ] IMP-05/V-08: Merge-conflict check in DevOps
- [ ] IMP-05/V-09: Rollback health check in DevOps
- [ ] IMP-05/V-10: Sectie-gebaseerde PROJECT.md merge in Documenter
- [ ] IMP-05/V-11: Versienummer-logica CHANGELOG (YYYY.MM.DD-N)
- [ ] IMP-06: `api_cost_usd` aan alle templates
- [ ] IMP-06: Cost Tracker node toegevoegd na elke OpenRouter call

### Fase C
- [ ] IMP-07: Telegram webhook ingesteld (setWebhook API call)
- [ ] IMP-07: `SDLC Daily Report` workflow gebouwd
- [ ] IMP-07: `SDLC Telegram Handler` workflow gebouwd
- [ ] IMP-07: `previous_status` toegevoegd aan alle templates
- [ ] IMP-08: `DASHBOARD_SECRET` n8n variabele aangemaakt
- [ ] IMP-08: `SDLC Dashboard API` workflow gebouwd
- [ ] IMP-08: `dashboard/` map aangemaakt met index.html, style.css, app.js
- [ ] IMP-08: Dashboard secret ingevuld in `app.js`
- [ ] IMP-08: Coolify statische site geconfigureerd op `dashboard.7rb.nl`
- [ ] IMP-08: `dashboard/**` toegevoegd aan `paths-ignore` in Gitea Action

### Fase D
- [ ] IMP-09: `calculateQueueScore()` functie in Router "Parse + append" node
- [ ] IMP-09: Queue Processor herberekent scores bij ophalen
- [ ] IMP-09: `type`, `severity`, `category`, `queue_score` velden in queue-items
- [ ] IMP-09: Telegram notificatie toont score en positie
- [ ] IMP-09: Verificatie: bug met medium priority wordt vóór critical feature opgepakt
- [ ] IMP-12: `SDLC Project Setup` workflow gebouwd in n8n
- [ ] IMP-12: `/newproject` Telegram commando werkt
- [ ] IMP-12: `/checkproject` validatie commando werkt
- [ ] IMP-16: `SDLC Health Check` workflow gebouwd in n8n
- [ ] IMP-16: Health badge zichtbaar in dashboard header

### Fase E
- [ ] IMP-10: Project filter/switcher in dashboard
- [ ] IMP-10: Zoek- en filterfunctie op ID/titel
- [ ] IMP-10: Project health indicator (rood/geel/groen)
- [ ] IMP-10: Inline acties (approve/retry/skip) in attention cards
- [ ] IMP-10: Item detail modal bij klik op kanban card
- [ ] IMP-10: `SDLC Dashboard Action` webhook gebouwd
- [ ] IMP-11: `agent_logs/` map structuur opgezet
- [ ] IMP-11: Write Agent Log node in alle agent-workflows
- [ ] IMP-11: Dashboard API uitgebreid met logs endpoint
- [ ] IMP-11: Timeline weergave in item detail modal
- [ ] IMP-11: `agent_logs/**` toegevoegd aan `paths-ignore`
- [ ] IMP-15: "Nieuw item" formulier in dashboard
- [ ] IMP-15: `SDLC Create Item` webhook gebouwd

### Fase F
- [ ] IMP-13: Gitea OAuth2 applicatie aangemaakt
- [ ] IMP-13: Auth login/callback workflows gebouwd
- [ ] IMP-13: JWT validatie in Dashboard API
- [ ] IMP-13: Rol-gebaseerde toegang (admin/viewer)
- [ ] IMP-14: `SDLC Analytics Snapshot` workflow gebouwd
- [ ] IMP-14: Chart.js grafieken in dashboard (throughput, kosten, doorlooptijd)
- [ ] IMP-14: SLA tracking met drempels per type
- [ ] IMP-14: CSV export functie
- [ ] IMP-14: `analytics/**` toegevoegd aan `paths-ignore`
