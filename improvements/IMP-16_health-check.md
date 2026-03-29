# IMP-16 — Platform health check workflow

**Status:** open  
**Prioriteit:** 🟢 Wenselijk  
**Geschatte tijd:** 1-2 uur  
**Afhankelijk van:** —  
**Raakt aan:** Nieuwe n8n workflow, Telegram

---

## Probleem

Er is geen automatische controle of alle externe services bereikbaar zijn. Als Gitea, OpenRouter, Coolify of Telegram uitvalt, merkt de beheerder dit pas als een item faalt.

---

## Oplossing

Een `SDLC Health Check` workflow die periodiek alle services pingt.

---

## Stap 1 — n8n workflow: `SDLC Health Check`

```
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

  → [Code] Aggregeer resultaten
      const services = [
        { name: 'Gitea', status: giteaOk ? 'ok' : 'fail' },
        { name: 'n8n', status: n8nOk ? 'ok' : 'fail' },
        { name: 'OpenRouter', status: orOk ? 'ok' : 'fail' },
        { name: 'Coolify', status: coolifyOk ? 'ok' : 'fail' },
        { name: 'Telegram', status: telegramOk ? 'ok' : 'fail' }
      ];
      const allOk = services.every(s => s.status === 'ok');
      const failed = services.filter(s => s.status === 'fail');

  → [IF] failed.length > 0
      ja → Telegram: "🚨 SDLC Health Check FAILED
            ❌ {{ failed.map(f => f.name).join(', ') }}
            ✅ {{ services.filter(s => s.status === 'ok').map(s => s.name).join(', ') }}
            
            Pipeline kan niet correct functioneren!"
      nee → (stilte — geen spam bij alles-OK)

  → [Code] Schrijf resultaat naar static data (voor dashboard)
```

---

## Stap 2 — Dashboard: health status indicator

Voeg aan de Dashboard API toe:
```javascript
// Haal health status op uit n8n static data of een health.json bestand
const health = {
  services: [...],
  last_check: "2026-03-29T21:00:00Z",
  all_ok: true
};
```

Toon in de dashboard header een health badge:
```
✅ Alle services online  |  ❌ OpenRouter offline (15:32)
```

---

## Stap 3 — Per-project health checks

Voor elk geconfigureerd project, controleer:
- Project-repo bereikbaar via Gitea API
- Coolify staging/productie app status via Coolify API
- Staging URL health check (HTTP GET → 200)
- Production URL health check (HTTP GET → 200)

```javascript
for (const project of projects) {
  const claude = parseCLAUDE(project);
  if (claude.staging_url) {
    checks.push(await httpPing(claude.staging_url, `${project} staging`));
  }
  if (claude.production_url) {
    checks.push(await httpPing(claude.production_url, `${project} production`));
  }
}
```

---

## Verificatie

1. Alle services online → geen notificatie (stilte)
2. OpenRouter down → Telegram: "🚨 Health Check FAILED: OpenRouter"
3. Dashboard toont health badge met status per service
4. Per-project health: staging URL niet bereikbaar → melding
