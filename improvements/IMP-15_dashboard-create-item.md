# IMP-15 — Werkitem aanmaken via dashboard

**Status:** open  
**Prioriteit:** 🟡 Normaal  
**Geschatte tijd:** 2-3 uur  
**Afhankelijk van:** IMP-08, IMP-10  
**Raakt aan:** Dashboard, n8n webhook, Gitea API

---

## Probleem

Werkitems aanmaken kan nu alleen via CLI (`sdlc-new.sh`) of handmatig Git. Er is geen web-interface.

---

## Oplossing

Een "Nieuw item" formulier in het dashboard met een n8n webhook backend.

---

## Stap 1 — Dashboard: formulier

Voeg een "➕ Nieuw item" knop toe aan de header. Bij klik opent een modal met:
- Type (bug/issue/feature/epic/story)
- Project (dropdown, dynamisch gevuld)
- Titel (tekst)
- Prioriteit (low/medium/high/critical)
- Severity (alleen bij bugs)
- Beschrijving (textarea)
- Parent epic (optioneel, bij features/stories)

Na submit: POST naar `/sdlc-create-item` webhook.

---

## Stap 2 — n8n webhook: `SDLC Create Item`

```
Webhook POST /sdlc-create-item
  → [Code] Valideer auth
  → [Code] Valideer input (type, project, title vereist)
  → [HTTP] Haal hoogste ID op voor dit type/project (Gitea tree API)
  → [HTTP] Haal template op (shared/templates/{TYPE}.md)
  → [Code] Vul frontmatter in (id, type, project, title, priority, created, status: new)
  → [Code] Voeg beschrijving toe aan markdown body
  → [HTTP] Schrijf bestand naar Gitea (PUT /contents/...)
  → Respond: { success: true, item_id: "BUG-003" }
  → Telegram: "➕ {item_id} aangemaakt via dashboard: {title}"
```

---

## Verificatie

1. Klik "➕ Nieuw item" → formulier verschijnt
2. Vul in en submit → item in kanban onder "Nieuw"
3. Controleer Gitea: `.md` correct aangemaakt
4. Pipeline start automatisch via Gitea Action
