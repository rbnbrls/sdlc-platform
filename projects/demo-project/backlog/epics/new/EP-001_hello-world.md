---
id: EP-001
type: epic
project: demo-project
title: "Hello World API"
status: new
priority: medium
created: 2026-03-21
updated: 2026-03-22
target_version: ""
features: []
triage_notes: ""
---

## Doel
Een simpele REST API met één endpoint als smoke test voor het SDLC systeem.

## Achtergrond
Dit is het eerste werkitem in de pipeline, bedoeld om de end-to-end flow te valideren.

## Scope
- GET /hello endpoint dat {"message": "Hello, World!"} retourneert
- API draait in Docker container
- Deployed via Coolify

## Buiten scope
- Authenticatie
- Database integratie

## Acceptatiecriteria (op epic-niveau)
- [ ] GET /hello geeft {"message": "Hello, World!"} terug
- [ ] API draait in Docker container
- [ ] Deployed via Coolify

## Gerelateerde epics
<!-- Geen -->
