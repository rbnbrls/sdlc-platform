# IMP-05 — Agent-overgang verbeteringen: Router t/m Documenter

**Status:** done  
**Prioriteit:** 🟠 Hoog  
**Geschatte tijd:** 3-4 uur  
**Raakt aan:** Alle agent-workflows, templates

---

## Overzicht

Dit plan bundelt alle concrete verbeteringen per agent-overgang die geen eigen groot implementatieplan rechtvaardigen, maar wel essentieel zijn voor een robuuste pipeline.

---

## V-01 — Router: fout-isolatie bij meerdere items in één push

### Probleem
Als de Gitea Action meerdere bestanden pipe-separated doorstuurt (`BUG-001|FE-002|US-003`) en item 2 faalt, stopt de huidige Code node — item 3 wordt nooit verwerkt.

### Oplossing

Vervang de huidige loop in de Router door een try/catch per item:

```javascript
// Code node: Parse en isoleer items
const body = $input.first().json.body;
const files = body.files.split('|').filter(Boolean);

const results = [];
for (const filePath of files) {
  try {
    results.push({ 
      json: { 
        filePath: filePath.trim(),
        commit_sha: body.commit_sha,
        pusher: body.pusher,
        error: null
      } 
    });
  } catch (err) {
    // Log het probleem maar stop de rest niet
    results.push({ 
      json: { 
        filePath: filePath.trim(),
        error: err.message,
        skip: true
      } 
    });
  }
}

return results;
```

Voeg daarna een **IF node** toe: `skip = true` → Telegram foutmelding → stop voor dit item, andere items gaan door.

---

## V-02 — Planner: check of branch al bestaat

### Probleem
Als de Planner Agent twee keer voor dezelfde feature draait (bijv. na een retry), probeert hij een branch aan te maken die al bestaat → Gitea API geeft 422 terug → agent crasht.

### Oplossing

Voeg een branch-check toe vóór het aanmaken van de branch:

**Node: Check branch bestaat**
```
HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/{{ $json.project }}/branches/{{ $json.branch_name }}
```

**Node: IF branch bestaat**
```javascript
// Status 200 = branch bestaat, 404 = bestaat niet
const statusCode = $input.first().json.$response.statusCode;
return [{ json: { branch_exists: statusCode === 200 } }];
```

- **Bestaat al** → sla aanmaken over, gebruik de bestaande branch, ga verder
- **Bestaat niet** → maak branch aan zoals nu

---

## V-03 — Planner: bundel story-commits in één Gitea-operatie

### Probleem
De Planner schrijft elke user story als aparte commit → elke commit triggert de Gitea Action → maar de Action filtert op committer (`sdlc-bot`), dus dit is na IMP-04 geen loop meer.

Echter: bij 5 stories zijn er 5 API-calls + 5 Action-runs (die allemaal skippen). Dit is onnodig.

### Oplossing A — Sequential writes met een delay

Schrijf de bestanden sequentieel (niet parallel), waarbij elk bestand de SHA van de vorige commit gebruikt. Dit werkt al als je de Gitea API correct aanroept (elke response bevat de nieuwe commit SHA).

### Oplossing B — Gebruik een tijdelijke branch (aanbevolen)

```
1. Maak een tijdelijke branch aan: sdlc-planner-temp-{timestamp}
2. Schrijf alle US bestanden naar die branch (elke write bouwt voort op de vorige SHA)
3. Merge de tijdelijke branch naar main via één Gitea API call
4. Verwijder de tijdelijke branch
```

Voordeel: één commit op main in plaats van vijf.

**Implementatie:**

```javascript
// Na het genereren van alle story-objecten:
const stories = $json.stories; // array van { id, filename, content }
const tempBranch = `sdlc-planner-temp-${Date.now()}`;

// Stap 1: Maak tijdelijke branch aan (van main)
// POST /repos/{org}/{sdlc-platform}/branches
// { "new_branch_name": tempBranch, "old_branch_name": "main" }

// Stap 2: Haal tree SHA op van de tijdelijke branch
// GET /repos/{org}/{sdlc-platform}/branches/{tempBranch}
// → commit.id

// Stap 3: Loop door stories, schrijf elk bestand naar tempBranch
// Per story: POST /repos/{org}/{sdlc-platform}/contents/{path}
//   body: { branch: tempBranch, ... }

// Stap 4: Merge tempBranch naar main
// POST /repos/{org}/{sdlc-platform}/merges
// { "base": "main", "head": tempBranch, "commit_message": "..." }

// Stap 5: Verwijder tempBranch
// DELETE /repos/{org}/{sdlc-platform}/branches/{tempBranch}
```

---

## V-04 — Developer Agent: last_error context bij retry

### Probleem
Na een mislukte Developer Agent run staat `status: in-progress` in het bestand. Bij de volgende trigger weet de Developer Agent niet wat er eerder misging.

### Oplossing

Elke agent schrijft bij failure het `last_error` veld in de frontmatter:

```javascript
// Code node in fout-pad van elke agent:
const updates = {
  status: 'in-progress',      // terug naar developer
  retry_count: currentRetryCount + 1,
  last_error: `QG-03 mislukt: ${failedCriteria.join(', ')}`,
  processing_updated: new Date().toISOString()
};
```

De Developer Agent leest `last_error` en voegt het toe aan de LLM-prompt:

```javascript
// In de Developer Agent, bij het opbouwen van de prompt:
const lastError = frontmatter.last_error;
const retryContext = lastError 
  ? `\n\n## Vorige poging mislukt\nDe vorige run faalde met: ${lastError}\nZorg dat je dit specifiek aanpakt.`
  : '';

const prompt = `${agentPrompt}\n\n## Te implementeren story\n${storyContent}${retryContext}`;
```

---

## V-05 — Reviewer: gesplitste diff-verwerking

### Probleem
Bij grote features kan de git diff honderden kilobytes zijn. OpenRouter/LLM context windows zijn begrensd en dure modellen rekenen per token.

### Oplossing

Splits de diff per bestand en verwerk elk bestand apart:

**Stap A: Haal diff op per bestand (niet als totale diff)**

```
HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/{{ $json.project }}/compare/main...{{ $json.branch }}
```

Response bevat `files[]` array met per bestand: `filename`, `patch`, `additions`, `deletions`.

**Stap B: Sorteer en filter**

```javascript
// Code node: Prioriteer relevante bestanden
const files = $input.first().json.files;

// Skip lockfiles, package-lock, gegenereerde bestanden
const skipPatterns = ['package-lock.json', '*.lock', 'dist/', 'build/', '.min.js'];
const relevantFiles = files.filter(f => 
  !skipPatterns.some(p => f.filename.includes(p))
);

// Sorteer: testsbestanden eerst (reviewer wil tests zien)
relevantFiles.sort((a, b) => {
  const aIsTest = a.filename.includes('.test.') || a.filename.includes('.spec.');
  const bIsTest = b.filename.includes('.test.') || b.filename.includes('.spec.');
  return bIsTest - aIsTest;
});

// Begrens: max 20 bestanden, max 500 regels per bestand
return relevantFiles.slice(0, 20).map(f => ({
  json: {
    filename: f.filename,
    patch: f.patch?.split('\n').slice(0, 500).join('\n') || '',
    additions: f.additions,
    deletions: f.deletions
  }
}));
```

**Stap C: Stuur als één gecombineerde prompt**

```javascript
// Combineer alle patches in één overzichtelijke prompt
const files = $input.all().map(f => f.json);
const diffSummary = files.map(f => 
  `### ${f.filename} (+${f.additions}/-${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``
).join('\n\n');

const prompt = `${reviewerPrompt}\n\n## Te reviewen wijzigingen\n\n${diffSummary}`;
```

---

## V-06 — Reviewer: gestandaardiseerd feedback-formaat

### Probleem
De Reviewer schrijft `blocking_issues` vrij-tekst in het `.md` bestand, waardoor de Developer Agent de feedback inconsistent ontvangt.

### Oplossing

Voeg een vaste sectie toe aan alle templates:

```markdown
## Review Feedback
<!-- Ingevuld door Reviewer Agent. De Developer Agent verwijdert afgevinkte items. -->
```

De Reviewer schrijft:

```markdown
## Review Feedback
- [ ] `src/auth.ts:42` — Geen input validatie op email parameter (BLOCKING)
- [ ] `src/auth.ts:67` — Password wordt in plaintext gelogd (BLOCKING, SECURITY)
- [x] `src/auth.ts:15` — Magic number, gebruik een constante (SUGGESTION)
```

De Developer Agent prompt bevat de instructie:
> "Lees de `## Review Feedback` sectie. Los alle `- [ ]` items op die `(BLOCKING)` bevatten. Vink ze af met `- [x]` nadat je ze hebt opgelost."

Na de Developer Agent update vervang je de frontmatter-update code met:

```javascript
// Mark blocking items als opgelost in de ## Review Feedback sectie
// (de Developer zelf doet dit in de Kilo-Code stap)
// n8n update alleen status + retry_count
```

---

## V-07 — Tester: begrensde test output

### Probleem
`npm test --coverage` kan enorme output produceren (duizenden regels). n8n's SSH node heeft memory-limieten en de LLM kan de context niet verwerken.

### Oplossing

Begrens de output in de SSH-aanroep:

```bash
# SSH command in n8n SSH node:
cd /workspace/{{ $json.project }} && \
git fetch origin && \
git checkout {{ $json.branch }} && \
git pull && \
npm test -- --coverage --json 2>&1 | \
  node -e "
    const lines = require('fs').readFileSync('/dev/stdin', 'utf8').split('\n');
    const lastN = lines.slice(-300);
    console.log(lastN.join('\n'));
  "
```

Of eenvoudiger met `tail`:

```bash
cd /workspace/{{ $json.project }} && \
git checkout {{ $json.branch }} && git pull && \
npm test -- --coverage 2>&1 | tail -300
```

Voeg in de Code node na de SSH-stap een parser toe die alleen de relevante informatie extraheert:

```javascript
// Code node: Extraheer relevante test-info
const output = $input.first().json.stdout;

// Zoek naar test-samenvatting (Vitest/Jest patroon)
const summaryMatch = output.match(/Tests?\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
const coverageMatch = output.match(/All files[^\n]*\|\s*([\d.]+)/);
const failedTests = [];

// Extraheer mislukte tests
const failedMatchAll = [...output.matchAll(/✗\s+(.+)|FAIL\s+(.+)|● (.+)/g)];
failedMatchAll.slice(0, 20).forEach(m => {
  failedTests.push(m[1] || m[2] || m[3]);
});

return [{
  json: {
    raw_summary: summaryMatch ? summaryMatch[0] : 'Geen samenvatting gevonden',
    coverage_pct: coverageMatch ? parseFloat(coverageMatch[1]) : null,
    failed_tests: failedTests,
    passed: !output.includes('failed') && !output.includes('FAIL'),
    full_output_truncated: output.slice(-5000) // bewaar laatste 5KB voor LLM
  }
}];
```

---

## V-08 — DevOps: merge-conflict check vóór merge naar main

### Probleem
Als een developer handmatig wijzigingen heeft gemaakt op main terwijl de feature-branch in review was, kan er een merge-conflict ontstaan dat de DevOps Agent niet detecteert.

### Oplossing

Voeg een test-merge check toe vóór de echte merge:

```javascript
// Gitea API: Haal diff op tussen branch en main
// GET /repos/{org}/{project}/compare/main...{branch}
// Als diffstat.behind > 0: branch is achter op main → rebase nodig
```

**HTTP Request: Compare branch met main**
```
GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/{{ $json.project }}/compare/main...{{ $json.branch }}
```

**Code node: Check conflicten**
```javascript
const compare = $input.first().json;

// behind_by: aantal commits dat de branch achterloopt op main
// conflict: Gitea geeft merge_base informatie
const behindBy = compare.behind_by || 0;
const hasConflicts = behindBy > 0;

return [{
  json: {
    can_merge: !hasConflicts,
    behind_by: behindBy,
    ahead_by: compare.ahead_by || 0
  }
}];
```

**IF node: kan mergen?**
- **Ja** → ga verder met merge
- **Nee** → 
  - Update frontmatter: `status: needs-human`, `last_error: "Merge conflict: branch is ${behindBy} commits achter op main. Rebase vereist."`
  - Telegram: `⚠️ Merge conflict voor {{ item_id }}: handmatige rebase vereist`

---

## V-09 — DevOps: rollback-verificatie met health check

### Probleem
Na een rollback naar de vorige deploymentversie weet de DevOps Agent niet zeker of de vorige versie ook gezond is.

### Oplossing

Voeg na een rollback een health check toe:

**HTTP Request: Health check op production_url**
```javascript
// GET {{ $json.production_url }}/health (of /)
// Verwacht: HTTP 200 binnen 10 seconden
```

```javascript
// Code node: Verwerk health check resultaat
const response = $input.first().json;
const statusCode = response.$response?.statusCode;
const rollbackHealthy = statusCode >= 200 && statusCode < 300;

return [{
  json: {
    rollback_healthy: rollbackHealthy,
    status_code: statusCode,
    production_url: $('Get CLAUDE.md').first().json.production_url
  }
}];
```

**Telegram node (na rollback):**
```javascript
const item = $('Get Item Frontmatter').first().json;
const health = $('Rollback Health Check').first().json;

const emoji = health.rollback_healthy ? '⚠️' : '🚨';
const healthStatus = health.rollback_healthy 
  ? 'Vorige versie is gezond en actief.' 
  : `KRITIEK: vorige versie reageert ook niet (HTTP ${health.status_code})! Handmatige interventie vereist!`;

return [{
  json: {
    text: `${emoji} Rollback uitgevoerd: ${item.id}\n\n${healthStatus}\nURL: ${health.production_url}`
  }
}];
```

---

## V-10 — Documenter: sectie-gebaseerde merge van PROJECT.md

### Probleem
De Documenter Agent stuurt de volledige bestaande `PROJECT.md` + het voltooide item naar de LLM en vraagt om een bijgewerkt document. De LLM kan bestaande secties verwijderen of herschrijven.

### Oplossing

Definieer vaste, gemarkeerde secties in `PROJECT.md` die de Documenter **per sectie** bijwerkt:

**Vaste sectie-markers in `shared/templates/PROJECT.md`:**

```markdown
# PROJECT.md — {Projectnaam}

## Beschrijving
<!-- SECTION:description -->
{Projectbeschrijving}
<!-- /SECTION:description -->

## Actieve Features
<!-- SECTION:features -->
<!-- Automatisch bijgehouden door Documenter Agent -->
<!-- /SECTION:features -->

## Bekende Issues
<!-- SECTION:known-issues -->
<!-- /SECTION:known-issues -->

## Changelog Samenvatting
<!-- SECTION:changelog -->
<!-- /SECTION:changelog -->

## Technische Beslissingen
<!-- SECTION:decisions -->
<!-- Handmatig bijgehouden -->
<!-- /SECTION:decisions -->
```

**Code node in Documenter Agent: sectie-update logica**

```javascript
// Vervang alleen de relevante sectie op basis van item type
const itemType = $json.frontmatter.type;
const itemStatus = $json.frontmatter.status;

let sectionToUpdate;
if (itemType === 'feature' || itemType === 'story') {
  sectionToUpdate = 'features';
} else if (itemType === 'bug') {
  sectionToUpdate = 'known-issues';
} else if (itemType === 'issue') {
  sectionToUpdate = 'known-issues';
}

// Haal de huidige sectie-inhoud op
const projectMd = $('Get PROJECT.md').first().json.decoded;
const sectionRegex = new RegExp(
  `<!-- SECTION:${sectionToUpdate} -->([\\s\\S]*?)<!-- \\/SECTION:${sectionToUpdate} -->`,
  'g'
);
const currentSectionMatch = sectionRegex.exec(projectMd);
const currentSectionContent = currentSectionMatch ? currentSectionMatch[1].trim() : '';

// Stuur ALLEEN de sectie naar de LLM, niet het hele document
return [{
  json: {
    section_name: sectionToUpdate,
    current_content: currentSectionContent,
    item_summary: $json.llm_item_summary,
    full_document: projectMd
  }
}];
```

**Prompt voor de Documenter Agent LLM:**
```
Je ontvangt de huidige inhoud van de sectie "{{ section_name }}" uit PROJECT.md.
Voeg het voltooide item toe aan deze sectie.
Verwijder NIETS uit de bestaande inhoud.
Retourneer ALLEEN de nieuwe sectie-inhoud (tussen de markers), niet het hele document.

Huidige sectie-inhoud:
{{ current_content }}

Voltooid item:
{{ item_summary }}
```

**Code node: voeg sectie terug in document**
```javascript
const updatedSection = $('LLM Documenter').first().json.message.content;
const sectionName = $('Prepare Section Update').first().json.section_name;
const fullDocument = $('Prepare Section Update').first().json.full_document;

const sectionRegex = new RegExp(
  `(<!-- SECTION:${sectionName} -->)[\\s\\S]*?(<!-- \\/SECTION:${sectionName} -->)`,
  'g'
);

const updatedDocument = fullDocument.replace(
  sectionRegex,
  `$1\n${updatedSection}\n$2`
);

return [{ json: { updated_document: updatedDocument } }];
```

---

## V-11 — CHANGELOG: automatisch versienummer

### Probleem
CHANGELOG entries worden bovenaan ingevoegd zonder versienummer, wat het moeilijk maakt om versies te tracken.

### Oplossing

Genereer een versienummer op basis van datum + dagelijks volgnummer: `YYYY.MM.DD-N`

```javascript
// Code node: Genereer versienummer
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const version = today.replace(/-/g, '.'); // YYYY.MM.DD

// Haal bestaande CHANGELOG op en tel hoe vaak de huidige datum al voorkomt
const changelog = $('Get CHANGELOG.md').first().json.decoded || '';
const todayEntries = (changelog.match(new RegExp(`## \\[${version}`, 'g')) || []).length;
const versionNumber = `${version}-${todayEntries + 1}`;

return [{
  json: {
    version: versionNumber,  // bijv. "2026.03.24-2"
    date: today,
    changelog_content: changelog
  }
}];
```

**CHANGELOG entry formaat:**
```markdown
## [2026.03.24-1] — 2026-03-24

### Features
- FE-001: Login form toegevoegd met OAuth2 ondersteuning

### Bug fixes  
- BUG-003: Crash bij leeg wachtwoord opgelost

### Technische wijzigingen
- Dependency updates: react 18.3.1

---
```
