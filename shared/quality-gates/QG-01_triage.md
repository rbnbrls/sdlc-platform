# QG-01: Triage Gate

**Fase:** Na aanmaken werkitem, vóór Triage Agent
**Evalueert:** n8n + OpenRouter API

## Verplichte criteria

### Frontmatter volledigheid
- `id` aanwezig en volgt patroon (BUG-XXX / ISS-XXX / EP-XXX / FE-XXX / US-XXX)
- `type` aanwezig en is één van: bug | issue | epic | feature | story
- `project` aanwezig en verwijst naar een bekend project
- `title` niet leeg
- `status` is `new`
- `priority` aanwezig en geldig (low | medium | high | critical)
- `created` aanwezig en geldig datumformaat (YYYY-MM-DD)

### Type-specifieke vereisten

**Bug:**
- Sectie "Stappen om te reproduceren" bevat minimaal 1 stap
- Sectie "Verwacht gedrag" niet leeg
- Sectie "Werkelijk gedrag" niet leeg

**Epic:**
- Sectie "Doel" niet leeg
- Sectie "Scope" niet leeg

**Feature:**
- `epic` veld ingevuld (verwijst naar EP-XXX)
- Minimaal 2 acceptatiecriteria aanwezig

**Story:**
- `feature` veld ingevuld (verwijst naar FE-XXX)
- Story-tekst ("Als ... wil ik ... zodat ...") aanwezig

## Bij falen
- Zet `status: needs-human` (en bewaar de huidige status in `previous_status`)
- Telegram: "⚠️ QG-01 falen: {id} — ontbrekende velden: {velden}"
- Geen verdere verwerking
