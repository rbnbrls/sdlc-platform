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
pr_url: ""              # Gitea PR URL (ingevuld door Planner Agent)
staging_url: ""         # ingevuld door DevOps Agent
preview_url: ""         # Coolify preview/staging URL
test_result: ""         # pass | fail
vulnerability_scan: ""  # ok | moderate | blocked
staging_deployed_at: "" # ingevuld door DevOps Agent
deployed_at: ""         # productie-deployment timestamp
documented_at: ""
retry_count: 0
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
- [ ] Geen secrets in code (secret scan passed)
- [ ] Code review gedaan (PR approved in Gitea)
- [ ] Integration tests groen
- [ ] Dependency vulnerability scan: geen critical/high
- [ ] Deployed naar staging — staging health check OK
- [ ] Deployed naar productie — productie health check OK
