# QG-05: Testing Gate

**Fase:** Na Tester Agent, vóór DevOps Agent
**Evalueert:** n8n + Claude API

## Verplichte criteria

### Test resultaten
- Alle bestaande tests groen (0 failures)
- Nieuwe tests groen
- Geen test errors (crashes/import failures)

### Coverage
- Test coverage op nieuwe code ≥ 80%
- Coverage rapport aanwezig

### Test scenarios
- Alle scenario's uit de story/bug zijn afgedekt
- Happy path getest
- Fout scenario's getest
- Edge cases getest

### Dependency Vulnerability Scan (QG-05b)
- `vulnerability_scan.critical` = 0
- `vulnerability_scan.high` = 0
- Scan uitgevoerd en geparsed zonder errors

### Staging Health Check
- `staging_health` = "ok"
- Staging URL reageert met HTTP 200

### Frontmatter
- `test_result` is ingevuld (`pass`)
- `vulnerability_scan` ingevuld (`ok` of `moderate`)
- `status` bijgewerkt naar `staging-verified`

### Gitea Commit Status
- Commit status `SDLC: QG-05 Tests` is `success`

## Bij falen
- `status` terugzetten naar `in-progress`
- `test_result` zetten op `fail`
- Telegram: "🧪 Tests gefaald: {id} — {failed_tests}"
- Retry Developer Agent met failed_tests en missing_scenarios als context
