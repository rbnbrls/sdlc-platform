# QG-06b: Staging Verification Gate

**Fase:** Na staging deployment, vóór productie deployment
**Evalueert:** n8n + HTTP health check

## Verplichte criteria

### Deployment succes
- Coolify staging deployment status is `finished`
- Deployment duurde niet langer dan 10 minuten

### Health Check
- HTTP GET op `{staging_url}/health` of `{staging_url}/` antwoordt HTTP 200
- Response time < 5 seconden
- Minimaal 2 opeenvolgende succesvolle health checks (interval 15s)

### Smoke Tests (optioneel, aanbevolen)
Als CLAUDE.md een `smoke_test_url` bevat:
- HTTP GET op `{smoke_test_url}` antwoordt HTTP 200
- Response bevat verwachte content (bijv. niet een error pagina)

### Log verificatie
- Geen `ERROR` of `FATAL` level logs in de eerste 60 seconden na staging deployment
  (via Coolify API: `GET /api/v1/applications/{uuid}/logs`)

## Bij falen
- Blokkeer productie-deployment volledig
- Trigger automatische staging rollback via Coolify API
- `status` → `deploy-failed`
- Telegram: "🚧 Staging verificatie gefaald: {id} — productie deployment geblokkeerd\nReden: {reden}"

## Tijdlijn
- Start health check: 30 seconden na `deployment status: finished`
- Timeout: 3 minuten
- Polling interval: 15 seconden
