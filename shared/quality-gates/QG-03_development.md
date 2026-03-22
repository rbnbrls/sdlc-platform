# QG-03: Development Gate

**Fase:** Na Developer Agent, vóór Reviewer Agent
**Evalueert:** n8n + Claude API

## Verplichte criteria

### Code aanwezig
- Minstens één bestand gewijzigd of aangemaakt
- Geen syntax errors (gecontroleerd door linter output)

### Tests aanwezig
- Test bestand aanwezig voor elke nieuwe module
- Tests kunnen uitgevoerd worden (geen import errors)

### Git
- Commit aanwezig op de branch
- Commit message volgt patroon: `feat(US-XXX):` of `fix(BUG-XXX):`

### Story volledigheid
- Alle acceptance criteria zijn geïmplementeerd (zelfrapportage developer agent)
- `status` veld is bijgewerkt naar `review`
- `commit` veld is ingevuld

## Bij falen
- Retry Developer Agent met gefaalde criteria als extra context
- Maximum retry_count: 3
- Bij retry_count ≥ 3: zet status op `needs-human`, stuur notificatie
