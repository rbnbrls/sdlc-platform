# QG-02: Planning Gate

**Fase:** Na Triage Agent, vóór Planner Agent
**Evalueert:** n8n + Claude API

## Verplichte criteria

### Status correct
- `status` is `triaged`
- `triage_notes` niet leeg (Triage Agent heeft analyse gedaan)

### Priority en severity (bugs)
- `priority` is een geldige waarde
- `severity` is ingevuld voor bugs (trivial | minor | major | critical)

### Volledigheid na triage
- Geen `needs_human_input: true` meer open
- Voor epics: `features` lijst aanwezig (mag leeg zijn bij klein epic)

## Bij falen
- Zet `status: needs-human`
- Telegram: "⚠️ QG-02 falen: {id} — triage onvolledig: {reden}"
