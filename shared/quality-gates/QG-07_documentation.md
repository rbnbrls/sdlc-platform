# QG-07: Documentation Gate

**Fase:** Na Documenter Agent, afrondend voor het backlog item
**Evalueert:** n8n + OpenRouter API

## Verplichte criteria

### PROJECT.md aanwezig en bijgewerkt
- Bestand `projects/{project}/docs/PROJECT.md` bestaat
- Sectie `## Recente wijzigingen` bevat een entry met de datum van vandaag of gisteren
- Het voltooide item (ID) wordt ten minste één keer vermeld in PROJECT.md

### CHANGELOG.md aanwezig en bijgewerkt
- Bestand `projects/{project}/docs/CHANGELOG.md` bestaat
- Bovenste entry heeft een datum ≤ vandaag
- Het item-ID wordt vermeld in de bovenste changelog-entry

### Inhoudelijke volledigheid (per type)
- **Bug:** sectie `## Bekende issues` of `## Recente wijzigingen` bevat de fix
- **Feature/Story:** sectie `## Functionaliteiten` bevat de nieuwe functionaliteit
- **Epic:** sectie `## Mijlpalen` bevat de epic met afrondingsdatum
- **Issue:** sectie `## Recente wijzigingen` bevat de verbetering

### Commits
- Er is een commit aanwezig met `` in de message
- De commit raakt uitsluitend bestanden in `projects/{project}/docs/`

## Bij falen
- Retry Documenter Agent met de gefaalde criteria als extra context
- Maximum retry_count: 2
- Bij retry_count ≥ 2: zet status op `needs-human` (en bewaar de huidige status in `previous_status`), stuur notificatie
  "⚠️ Documentatie incompleet na {id}: {gefaalde criteria}"
