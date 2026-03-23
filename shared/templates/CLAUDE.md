# CLAUDE.md — {Projectnaam}

## Beschrijving
{Korte beschrijving van het project}

## Tech stack
- **Frontend:** {bijv. React 18, TypeScript, Tailwind CSS}
- **Backend:** {bijv. FastAPI, Python 3.12}
- **Database:** {bijv. PostgreSQL 16}
- **Testing:** {bijv. pytest, Vitest}
- **Package manager:** {npm / pnpm / uv}

## Repo locatie
- **Gitea URL:** https://git.7rb.nl/sdlc-platform/{project-naam}
- **Lokaal pad (VSCode Server):** /workspace/{project-naam}

## Mapstructuur
{Korte weergave van de mappenstructuur van de codebase}

## Code conventies
- Commit messages: Conventional Commits (feat/fix/chore/docs/test)
- Branch namen: feature/FE-XXX-slug of fix/BUG-XXX-slug
- Max regels per bestand: 200
- Gebruik altijd `[sdlc-skip]` tag in agent-commits
- {Taal-specifieke regels: Black/isort voor Python, ESLint voor TS, etc.}

## Test commando's
- Unit tests: `{commando}`
- Coverage rapport: `{commando}`
- Lint: `{commando}`
- Dependency scan: `npm audit --omit=dev --json` of `pip-audit --format json`

## Deployment
- **Coolify staging app UUID:** {UUID}
- **Coolify productie app UUID:** {UUID}
- **Staging URL:** {URL}
- **Productie URL:** {URL}
- **Health check pad:** `/health` (of `/` als er geen health endpoint is)
- **Smoke test URL:** {URL of leeg}
- **rotate_secrets_on_deploy:** false

## Gitea Milestones (sprints)
- **Huidige sprint milestone ID:** {ID of leeg}

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
