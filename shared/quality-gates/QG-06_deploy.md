# QG-06: Deploy Gate

**Fase:** Na DevOps Agent (productie deployment verificatie)
**Evalueert:** n8n + Coolify API + HTTP health check

## Verplichte criteria

### Deployment succes
- Coolify productie deployment status is `finished` (niet `failed` of `cancelled`)
- Deployment duurde niet langer dan 10 minuten
- Voorgaande status was `staging-verified` (staging moet eerst OK zijn)

### Post-deployment verificatie
- Health check op `{production_url}/health` (of `/`) geeft HTTP 200 binnen 10s
- Minimaal 2 opeenvolgende succesvolle health checks (interval 15s)
- Geen ERROR/FATAL logs in de eerste 60 seconden (Coolify API logs endpoint)

### Frontmatter
- `deployed_at` is ingevuld met ISO timestamp
- `status` is bijgewerkt naar `done`

### Gitea Commit Status
- Commit status `SDLC: QG-06 Deploy` is `success`

## Bij falen
- Trigger rollback via Coolify API:
  ```
  GET /api/v1/deployments?application_uuid={uuid}&status=finished&per_page=5
  POST /api/v1/deployments/{previous_uuid}/restart
  ```
- `status` zetten op `deploy-failed`
- Telegram: "💥 Deploy gefaald: {id} — rollback naar vorige deployment uitgevoerd"
- Notificeer: menselijke interventie vereist om root cause te analyseren

## Rollback procedure
1. Haal vorige succesvolle deployment ID op via Coolify API
2. Trigger rollback deployment (POST restart)
3. Wacht op Coolify webhook: `status: finished`
4. Verifieer rollback health check (max 2 minuten)
5. Update frontmatter: `status: deploy-failed`, `rollback_performed: true`
