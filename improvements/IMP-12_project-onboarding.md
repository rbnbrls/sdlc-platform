# IMP-12 — Project onboarding: geautomatiseerd nieuw project toevoegen

**Status:** open  
**Prioriteit:** 🟠 Hoog  
**Geschatte tijd:** 3-4 uur  
**Afhankelijk van:** IMP-04  
**Raakt aan:** Nieuwe n8n workflow (`SDLC Project Setup`), Gitea API, Coolify API

---

## Probleem

Een nieuw project toevoegen vereist nu 6+ handmatige stappen (Fase 4 in de readme):

1. Gitea: repo aanmaken in de `sdlc-platform` organisatie
2. Gitea: branch protection instellen op `main`
3. `projects/{naam}/CLAUDE.md` schrijven met stack-info
4. `projects/{naam}/backlog/{bugs,issues,epics,features,stories}/` mappen aanmaken
5. `.gitea/workflows/project-webhook.yml` kopiëren naar de project-repo
6. Coolify: resource toevoegen, domein instellen, UUIDs noteren
7. CLAUDE.md bijwerken met Coolify UUIDs

Dit is foutgevoelig en wordt vergeten (bijv. webhook ontbreekt, CLAUDE.md incompleet).

---

## Oplossing

Een `SDLC Project Setup` n8n workflow die via Telegram of een webhook wordt aangestuurd.

---

## Stap 1 — Trigger: Telegram commando of webhook

### Via Telegram
```
/newproject {naam} {repo-url-of-stack}
```

### Via webhook
```
POST /sdlc-project-setup
{
  "name": "mijn-app",
  "description": "React app voor budgetbeheer",
  "stack": {
    "frontend": "React 18, TypeScript",
    "backend": "FastAPI, Python 3.12",
    "database": "PostgreSQL 16",
    "testing": "pytest, Vitest",
    "package_manager": "pnpm"
  },
  "domain_production": "mijn-app.7rb.nl",
  "domain_staging": "staging-mijn-app.7rb.nl"
}
```

---

## Stap 2 — n8n workflow: `SDLC Project Setup`

```
Webhook/Telegram Trigger
  → [Code] Valideer input (naam, stack)
  
  → [HTTP] Maak Gitea repo aan
      POST /api/v1/orgs/{{ $env.GITEA_ORG }}/repos
      Body: { name, auto_init: true, default_branch: "main" }
  
  → [HTTP] Stel branch protection in
      POST /api/v1/repos/{{ $env.GITEA_ORG }}/{name}/branch_protections
      Body: { branch_name: "main", enable_push: false, enable_merge: true }
  
  → [Code] Genereer CLAUDE.md vanuit shared/templates/CLAUDE.md
      Vul in: projectnaam, stack, Gitea URL, paden
  
  → [HTTP] Schrijf CLAUDE.md naar sdlc-platform repo
      PUT /contents/projects/{name}/CLAUDE.md
  
  → [HTTP] Maak backlog mappen aan met .gitkeep
      PUT /contents/projects/{name}/backlog/bugs/.gitkeep
      PUT /contents/projects/{name}/backlog/issues/.gitkeep
      PUT /contents/projects/{name}/backlog/epics/.gitkeep
      PUT /contents/projects/{name}/backlog/features/.gitkeep
      PUT /contents/projects/{name}/backlog/stories/.gitkeep
  
  → [HTTP] Maak docs en decisions mappen aan
      PUT /contents/projects/{name}/docs/.gitkeep
      PUT /contents/projects/{name}/decisions/.gitkeep
  
  → [HTTP] Kopieer project-webhook.yml naar project-repo
      GET /contents/.gitea/workflows/project-webhook.yml (uit sdlc-platform)
      PUT /repos/{{ $env.GITEA_ORG }}/{name}/contents/.gitea/workflows/project-webhook.yml
  
  → [HTTP] Stel Gitea secrets in op project-repo
      PUT /repos/.../actions/secrets/N8N_SECRET
      PUT /repos/.../actions/secrets/N8N_PROJECT_WEBHOOK
  
  → [IF] Coolify integratie gewenst?
      ja → [HTTP] Maak Coolify resource aan (POST /applications)
           [HTTP] Stel domein in
           [Code] Update CLAUDE.md met Coolify UUIDs
           [HTTP] Schrijf bijgewerkte CLAUDE.md naar Gitea
  
  → Telegram: "🆕 Project '{name}' aangemaakt!
      📦 Repo: {gitea_url}
      📋 Backlog: sdlc-platform/projects/{name}/
      🔗 Coolify: {coolify_url of 'handmatig instellen'}
      
      Volgende stap: voeg een EP-001 epic toe aan de backlog."
```

---

## Stap 3 — Project configuratie validatie

Voeg een validatie-node toe die controleert of een bestaand project correct is geconfigureerd:

```javascript
// Code node: Validate Project Config
async function validateProject(projectName) {
  const checks = [];
  
  // 1. CLAUDE.md bestaat en is compleet
  const claude = await getFile(`projects/${projectName}/CLAUDE.md`);
  if (!claude) {
    checks.push({ check: 'CLAUDE.md', status: 'fail', msg: 'Bestand ontbreekt' });
  } else {
    const content = decodeBase64(claude.content);
    const required = ['coolify_staging_uuid', 'coolify_production_uuid', 'staging_url', 'production_url'];
    required.forEach(field => {
      if (!content.includes(field) || content.includes(`${field}: ""`)) {
        checks.push({ check: field, status: 'warn', msg: `${field} niet ingevuld` });
      }
    });
  }
  
  // 2. Backlog mappen bestaan
  const dirs = ['bugs', 'issues', 'epics', 'features', 'stories'];
  for (const dir of dirs) {
    const exists = await getFile(`projects/${projectName}/backlog/${dir}/.gitkeep`);
    checks.push({ check: `backlog/${dir}`, status: exists ? 'ok' : 'fail' });
  }
  
  // 3. Project-repo bestaat in Gitea
  const repo = await getRepo(projectName);
  checks.push({ check: 'Gitea repo', status: repo ? 'ok' : 'fail' });
  
  // 4. Webhook actief op project-repo
  const webhookFile = await getFile(`${projectName}/.gitea/workflows/project-webhook.yml`, projectName);
  checks.push({ check: 'project-webhook.yml', status: webhookFile ? 'ok' : 'fail' });
  
  return checks;
}
```

### Telegram commando
```
/checkproject {naam}
→ "🔍 Project check: {naam}
   ✅ CLAUDE.md aanwezig
   ⚠️ coolify_production_uuid niet ingevuld
   ✅ Gitea repo bestaat
   ✅ project-webhook.yml aanwezig
   ❌ backlog/decisions/ ontbreekt"
```

---

## Stap 4 — Dashboard: project management sectie

Voeg aan het dashboard een "Projecten beheren" pagina toe met:

- Lijst van alle geconfigureerde projecten
- Health status per project (IMP-10)
- "Nieuw project" knop → POST naar setup webhook
- "Check project" knop → toont validatie-resultaat

---

## Verificatie

1. `/newproject test-app` via Telegram
2. Controleer: Gitea repo `test-app` bestaat met branch protection
3. Controleer: `projects/test-app/CLAUDE.md` is aangemaakt
4. Controleer: backlog mappen bestaan
5. Controleer: `project-webhook.yml` aanwezig in test-app repo
6. `/checkproject test-app` → alle checks groen
