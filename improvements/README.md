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

## Totale schatting

| Fase | Inhoud | Tijd |
|------|--------|------|
| A | Stabiele basis | ~5 uur |
| B | Robuustheid | ~4 uur |
| C | Monitoring | ~6 uur |
| **Totaal** | | **~15 uur** |

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
- `paths-ignore` uitbreiden met `LOCK.json`, `QUEUE.json`, `dashboard/**`

### Nieuwe bestanden in sdlc-platform repo

```
sdlc-platform/
├── LOCK.json              ← IMP-01
├── QUEUE.json             ← IMP-02
├── dashboard/
│   ├── index.html         ← IMP-08
│   ├── style.css          ← IMP-08
│   └── app.js             ← IMP-08
└── improvements/
    ├── README.md           ← dit bestand
    ├── IMP-01_concurrency-lock.md
    ├── IMP-02_queue-manager.md
    ├── IMP-03_watchdog.md
    ├── IMP-04_sdlc-bot-account.md
    ├── IMP-05_agent-overgang-verbeteringen.md
    ├── IMP-06_kosten-tracking.md
    ├── IMP-07_telegram-monitor.md
    └── IMP-08_dashboard.md
```

### Nieuwe n8n workflows

| Naam | Plan | Trigger |
|------|------|---------|
| SDLC Lock Manager | IMP-01 | Execute Workflow |
| SDLC Queue Processor | IMP-02 | Schedule (elke 1 min) |
| SDLC Watchdog | IMP-03 | Schedule (elke 15 min) |
| SDLC Dashboard API | IMP-08 | Webhook GET /sdlc-dashboard |
| SDLC Daily Report | IMP-07 | Schedule (08:00 dagelijks) |
| SDLC Telegram Handler | IMP-07 | Webhook POST /telegram-handler |
| SDLC Restart Item | IMP-03 | Webhook POST /sdlc-restart |

### Nieuwe n8n environment variabelen

| Variabele | Waarde | Plan |
|-----------|--------|------|
| `GITEA_BOT_TOKEN` | sdlc-bot API token | IMP-04 |
| `DASHBOARD_SECRET` | `openssl rand -hex 24` | IMP-08 |

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
- [ ] IMP-03: `SDLC Watchdog` workflow gebouwd in n8n
- [ ] IMP-03: `current_agent` veld aan templates
- [ ] IMP-03: `SDLC Restart Item` webhook gebouwd

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
