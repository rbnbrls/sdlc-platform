# QG-06: Deploy Gate

**Fase:** Na DevOps Agent (deployment verificatie)
**Evalueert:** n8n + Coolify API

## Verplichte criteria

### Deployment succes
- Coolify deployment status is `finished` (niet `failed` of `cancelled`)
- Deployment duurde niet langer dan 10 minuten

### Post-deployment verificatie
- Health check endpoint reageert met HTTP 200 (indien geconfigureerd in CLAUDE.md)
- Geen error logs in de eerste 60 seconden na deployment

### Frontmatter
- `deployed_at` is ingevuld met ISO timestamp
- `status` is bijgewerkt naar `done`

## Bij falen
- Trigger rollback via Coolify API (vorige deployment herstellen)
- `status` zetten op `deploy-failed`
- Telegram: "💥 Deploy gefaald: {id} — rollback uitgevoerd"
- Notificeer: menselijke interventie vereist

## Rollback procedure
1. Haal vorige deployment ID op via Coolify API
2. Trigger rollback deployment
3. Verifieer rollback succesvol (health check)
4. Update frontmatter: `status: deploy-failed`, `deployed_at: ""`
