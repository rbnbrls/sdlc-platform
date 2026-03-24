# QG-05b: Dependency Vulnerability Gate

**Fase:** Onderdeel van Tester Agent, tijdens QG-05
**Evalueert:** npm audit / pip-audit output (via SSH)

## Verplichte criteria

### Scan uitvoering
- Scan is uitgevoerd: `npm audit --json` of `pip-audit --format json`
- Scan output is succesvol geparsed (geen tooling errors)

### Severity drempels

| Severity | Actie |
|----------|-------|
| Critical (CVSS ≥ 9.0) | 🚫 **Blokkeer** — status → `needs-human` |
| High (CVSS 7.0–8.9) | 🚫 **Blokkeer** — status → `needs-human` |
| Moderate (CVSS 4.0–6.9) | ⚠️ Waarschuw, blokkeer NIET |
| Low (CVSS < 4.0) | ✅ Negeer |

### Scope beperking
- Scan alleen **productie dependencies** (niet devDependencies)
- Bij Node.js: `npm audit --omit=dev`
- Bij Python: controleer of de vulnerability in de productie virtual env zit

### Uitzondering
- Als de vulnerability geen risico vormt voor dit project (bijv. DoS in CLI-only tool
  die niet als server draait): documenteer dit in `triage_notes` en laat de Triage Agent
  beoordelen. Blokkeer dan NIET automatisch.

## Bij falen (critical of high)
- `status` → `needs-human` (en bewaar de huidige status in `previous_status`)
- Telegram: "🔒 Kritieke vulnerability in {project}: {package}@{versie} — CVE-{id} ({severity})"
- Voeg vulnerability details toe aan het .md werkitem
- Menselijke actie vereist: dependency updaten of vulnerability documenteren als uitzondering

## Bij waarschuwingen (moderate)
- Pipeline loopt door naar deployment
- Voeg toe aan `projects/{project}/docs/PROJECT.md` onder `## Bekende kwetsbaarheden`
- Telegram: "⚠️ Moderate vulnerability: {package} — niet blokkerend, zie PROJECT.md"
