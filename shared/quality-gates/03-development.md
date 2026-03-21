# Quality Gate 3: Development

## ID: QG-03
## Fase: Na Developer Agent, voor Reviewer Agent

## Criteria (alle verplicht)

### Code kwaliteit
- [ ] Geen syntax errors (linter geeft 0 errors)
- [ ] Alle geïmporteerde modules bestaan
- [ ] Geen hardcoded credentials of secrets

### Tests
- [ ] Unit test bestanden aanwezig voor alle nieuwe functies
- [ ] Tests runnen zonder errors
- [ ] Coverage ≥ 80% op nieuwe code

### Git
- [ ] Commit message volgt conventie: type(scope): beschrijving
- [ ] Branch naam matcht patroon: feature/US-XXX-*
- [ ] Geen merge conflicts

### Story completeness
- [ ] Alle acceptance criteria zijn geïmplementeerd
- [ ] Story frontmatter: status = "review"
- [ ] Story frontmatter: commit veld is ingevuld

## Actie bij falen
n8n herstart de Developer Agent met de gefaalde criteria als extra context.
Maximum 3 pogingen, daarna: notificatie naar beheerder.