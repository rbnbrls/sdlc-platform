# QG-04: Review Gate

**Fase:** Na Reviewer Agent, vóór Tester Agent
**Evalueert:** n8n + Claude API

## Verplichte criteria

### Review output
- `approved` is `true` in de Reviewer Agent output
- Geen `blocking_issues` aanwezig
- `status` is bijgewerkt naar `testing`

### Code kwaliteit (via Reviewer Agent beoordeling)
- Geen hardcoded secrets of credentials
- Input validatie aanwezig waar relevant
- Auth checks aanwezig waar relevant
- Geen `TODO` of `FIXME` in productie code

### PR aanwezig (optioneel maar aanbevolen)
- `pr_number` ingevuld als PR-flow gebruikt wordt

## Bij falen (approved: false)
- `status` terugzetten naar `in-progress`
- `blocking_issues` als commentaar toevoegen aan .md bestand
- Telegram: "🔍 Review afgekeurd: {id} — {aantal} blocking issues"
- Retry Developer Agent met blocking_issues als extra context
