# CLAUDE.md — Demo Project

## Beschrijving
Demo project voor het testen van de volledige SDLC pipeline. Wordt gebruikt
om alle agents, quality gates en workflows end-to-end te valideren.

## Tech stack
- **Frontend:** Nog te bepalen
- **Backend:** Nog te bepalen
- **Database:** Nog te bepalen
- **Testing:** Nog te bepalen
- **Package manager:** npm

## Repo locatie
- **Gitea URL:** https://git.7rb.nl/sdlc-platform/demo-project
- **Lokaal pad (VSCode Server):** /workspace/demo-project

## Mapstructuur
```
demo-project/
├── src/          ← broncode (nog leeg)
└── tests/        ← tests (nog leeg)
```

## Code conventies
- Commit messages: Conventional Commits (feat/fix/chore/docs/test)
- Branch namen: feature/FE-XXX-slug of fix/BUG-XXX-slug
- Max regels per bestand: 200
- Gebruik altijd `[sdlc-skip]` tag in agent-commits

## Test commando's
- Unit tests: `npm test`
- Coverage rapport: `npm run test:coverage`
- Lint: `npm run lint`
- Dependency scan: `npm audit --omit=dev --json`

## Deployment
- **Coolify staging app UUID:** <!-- invullen na setup in Coolify -->
- **Coolify productie app UUID:** <!-- invullen na setup in Coolify -->
- **Staging URL:** https://staging-demo.7rb.nl
- **Productie URL:** https://demo.7rb.nl
- **Health check pad:** `/health`
- **Smoke test URL:**
- **rotate_secrets_on_deploy:** false

## Gitea Milestones (sprints)
- **Huidige sprint milestone ID:**

## Quality gate drempels
- Test coverage: ≥ 80%
- Linter: 0 errors
- Vulnerability scan: geen critical/high in productie dependencies

## API Endpoints
<!-- Automatisch bijgehouden door SDLC Context Updater -->
| Methode | Pad | Beschrijving | Auth |
|---------|-----|-------------|------|
| *(nog geen endpoints gedocumenteerd)* | | | |

## Dependencies (notable)
<!-- Automatisch bijgehouden door SDLC Context Updater -->
*(nog geen notable dependencies gedocumenteerd)*

## Lessons Learned
<!-- Automatisch bijgehouden door SDLC Context Updater — max 10 entries -->
*(nog geen lessen geleerd)*
