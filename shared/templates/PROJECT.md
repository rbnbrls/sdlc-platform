# PROJECT.md — {Projectnaam}

> **Dit bestand is de gezaghebbende, actuele documentatie van dit project.**
> Het wordt automatisch bijgewerkt door de Documenter Agent wanneer backlog items
> de status `done` bereiken. Verander het niet handmatig, tenzij je een correctie
> wilt doen die nog niet door een agent is opgepikt.
>
> **Laatste update:** {YYYY-MM-DD} door {item-id}

---

## Overzicht

{Korte beschrijving van het project: wat het doet, voor wie, en waarom het bestaat.}

- **Status:** actief in ontwikkeling / stabiel / gearchiveerd
- **Versie:** {versienummer of "zie CHANGELOG.md"}
- **Gedeployed op:** {URL of "n.v.t."}
- **Tech stack:** {bijv. Next.js 14, TypeScript, PostgreSQL}

---

## Functionaliteiten

> Wat het systeem nu *kan*. Schrijf gebruikersgericht.

- {Functionaliteit 1}: {Beschrijving}
- {Functionaliteit 2}: {Beschrijving}

---

## Technische architectuur

### Mapstructuur (relevante delen)
```
{project-naam}/
├── {map}/          ← {uitleg}
└── {map}/          ← {uitleg}
```

### API endpoints
| Methode | Pad | Beschrijving | Auth |
|---------|-----|-------------|------|
| `GET` | `/api/...` | {beschrijving} | Ja/Nee |

### Datamodel (kernentiteiten)
```
{Entiteit}: {velden en types}
```

### Integraties
- {Externe service}: {wat het doet in dit project}

---

## Mijlpalen

| Epic | Titel | Afgerond op |
|------|-------|------------|
| EP-XXX | {Titel} | {YYYY-MM-DD} |

---

## Bekende issues

### Open
| ID | Beschrijving | Priority |
|----|-------------|---------|
| BUG-XXX | {Beschrijving} | high |

### Opgelost
| ID | Beschrijving | Opgelost op |
|----|-------------|------------|
| BUG-XXX | {Beschrijving} | {YYYY-MM-DD} |

---

## Recente wijzigingen

| Datum | ID | Wijziging |
|-------|----|-----------|
| {YYYY-MM-DD} | {ID} | {Korte beschrijving} |

---

## Veiligheid

{Relevante veiligheidsinformatie: auth mechanisme, permissiemodel, gevoelige data}

---

## Performance

{Relevante performance-karakteristieken, caching-strategie, bekende bottlenecks}

---

## Deployment

- **Productie:** {URL / Coolify project}
- **Staging:** {URL of "n.v.t."}
- **Deploy-procedure:** {Hoe deployen? Automatisch via Coolify / handmatig}
- **Rollback:** {Hoe terugdraaien?}

---

## Bekende kwetsbaarheden

<!-- Automatisch bijgehouden door SDLC Tester Agent (QG-05b) -->
| Package | CVE | Severity | Toegevoegd | Status |
|---------|-----|----------|------------|--------|
| *(geen bekende kwetsbaarheden)* | | | | |

---

## Voor AI agents

> Deze sectie bevat informatie specifiek nuttig voor AI agents die aan dit project werken.

- **Conventies:** zie `CLAUDE.md` in dezelfde map
- **Lessons Learned:** zie `CLAUDE.md` sectie Lessons Learned
- **Niet aanpassen zonder context:** {bestanden of patronen die speciale aandacht verdienen}
- **Bekende valkuilen:** {edge cases, gotchas, of niet-voor-de-hand-liggende keuzes}
- **Testcommando's:** zie `CLAUDE.md`
- **Staging URL:** {URL of "n.v.t."}
