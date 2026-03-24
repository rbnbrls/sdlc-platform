# IMP-04 — sdlc-bot: dedicated Gitea account voor agent-commits

**Status:** open  
**Prioriteit:** 🟡 Normaal  
**Geschatte tijd:** 30 minuten  
**Raakt aan:** Gitea configuratie, n8n env variabelen, sdlc-trigger.yml

---

## Probleem

Alle agent-commits worden nu gefilterd via `[sdlc-skip]` in de commit message. Dit werkt, maar is fragiel:
- Als één agent de tag vergeet → ongewenste loop
- Force-pushes negeren de commit message filter
- In Gitea's commit-log is niet duidelijk welke commits menselijk zijn en welke automatisch

---

## Oplossing

Een dedicated Gitea-account `sdlc-bot` dat uitsluitend door n8n gebruikt wordt. De Gitea Action filtert op de committer, niet op de commit message. De `[sdlc-skip]` tag kan dan vervallen.

---

## Stap 1 — Maak het sdlc-bot account aan in Gitea

```
Gitea → Site Administration → User Management → Create User

Gebruikersnaam: sdlc-bot
E-mail:         sdlc-bot@7rb.nl (fictief, hoeft niet te bestaan)
Wachtwoord:     [sterk willekeurig wachtwoord - sla niet op]
```

> ⚠️ Dit is een **machine account**. Geen admin-rechten. Geen interactief gebruik.

---

## Stap 2 — Genereer een API token voor sdlc-bot

```
Log in als sdlc-bot → Settings → Applications → Generate Token

Naam: n8n-sdlc-agent
Rechten: repository (read + write)
```

Sla het token op als n8n environment variabele:

```
n8n → Settings → Variables → Toevoegen:
Naam: GITEA_BOT_TOKEN
Waarde: [het gegenereerde token]
```

> **Verschil met `GITEA_TOKEN`:**  
> - `GITEA_TOKEN` = jouw persoonlijke token (admin-rechten, voor repo-aanmaak etc.)  
> - `GITEA_BOT_TOKEN` = sdlc-bot token (alleen repo read/write, voor agent-commits)

---

## Stap 3 — Geef sdlc-bot schrijfrechten op de sdlc-platform repo

```
Gitea → sdlc-platform organisation → sdlc-platform repo → Settings → Collaborators

Voeg toe: sdlc-bot
Rol: Write
```

Voor project-repos (waar de Developer Agent commits naar schrijft):
```
Gitea → sdlc-platform organisation → [project-naam] → Settings → Collaborators

Voeg toe: sdlc-bot
Rol: Write
```

Herhaal dit voor elk project-repo dat je toevoegt.

---

## Stap 4 — Pas alle n8n agent-workflows aan

In **elke** HTTP Request node die een Gitea API PUT /contents aanroept (frontmatter updates, story-bestanden aanmaken, etc.):

Verander de Authorization header:
```
VOOR:   Authorization: token {{ $env.GITEA_TOKEN }}
NA:     Authorization: token {{ $env.GITEA_BOT_TOKEN }}
```

Voeg de `author` en `committer` velden toe aan de request body:
```json
{
  "message": "chore(sdlc): update BUG-001 status → triaged",
  "content": "base64-inhoud",
  "sha": "huidige-sha",
  "author": {
    "name": "sdlc-bot",
    "email": "sdlc-bot@7rb.nl"
  },
  "committer": {
    "name": "sdlc-bot",
    "email": "sdlc-bot@7rb.nl"
  }
}
```

**Workflows om aan te passen:**
- [ ] SDLC Triage Agent (status update)
- [ ] SDLC Planner Agent (status update + story bestanden)
- [ ] SDLC Developer Agent (status update)
- [ ] SDLC Reviewer Agent (status update)
- [ ] SDLC Tester Agent (status update)
- [ ] SDLC DevOps Agent (status update)
- [ ] SDLC Documenter Agent (status update + PROJECT.md + CHANGELOG.md)
- [ ] SDLC Lock Manager (LOCK.json writes)
- [ ] SDLC Queue Processor (QUEUE.json writes)

---

## Stap 5 — Pas de Gitea Action aan: filter op committer

Vervang de `[sdlc-skip]` tag-filter door een committer-naam filter:

```yaml
# .gitea/workflows/sdlc-trigger.yml

jobs:
  trigger-n8n:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Controleer committer
        id: check_committer
        run: |
          COMMITTER="${{ github.event.head_commit.committer.name }}"
          if [[ "$COMMITTER" == "sdlc-bot" ]]; then
            echo "skip=true" >> $GITHUB_OUTPUT
            echo "Skipping: commit van sdlc-bot"
          else
            echo "skip=false" >> $GITHUB_OUTPUT
          fi

      - name: Detecteer gewijzigde backlog bestanden
        id: changed
        if: steps.check_committer.outputs.skip == 'false'
        run: |
          FILES=$(git diff --name-only HEAD~1 HEAD \
            | grep 'projects/.*/backlog/.*\.md$' \
            | tr '\n' '|')
          echo "files=${FILES%|}" >> $GITHUB_OUTPUT

      - name: Stuur naar n8n
        if: steps.check_committer.outputs.skip == 'false' && steps.changed.outputs.files != ''
        run: |
          PAYLOAD=$(jq -n \
            --arg files "${{ steps.changed.outputs.files }}" \
            --arg sha "${{ github.sha }}" \
            --arg pusher "${{ github.actor }}" \
            '{files: $files, commit_sha: $sha, pusher: $pusher}')
          
          curl -sf -X POST "${{ secrets.N8N_SDLC_WEBHOOK }}" \
            -H "Content-Type: application/json" \
            -H "X-Secret: ${{ secrets.N8N_SECRET }}" \
            -d "$PAYLOAD"
```

> **Merk op:** de `[sdlc-skip]` tags in commit messages kunnen nu **vervallen**. De filter op committer-naam is robuuster.

---

## Stap 6 — Verwijder [sdlc-skip] tags uit alle agent-workflows (optioneel cleanup)

Nu de filter op committer-naam werkt, kunnen de `[sdlc-skip]` suffixes worden verwijderd uit alle commit messages in n8n. Dit maakt de commit messages schoner:

**Voor:**
```
chore(sdlc): update BUG-001 status → triaged [sdlc-skip]
```

**Na:**
```
chore(sdlc): update BUG-001 status → triaged
```

> ⚠️ Doe dit pas **nadat** stap 5 getest en geverifieerd is. Als de committer-filter niet correct werkt, heb je anders een pipeline-loop.

---

## Verificatie

1. Maak een test-commit als sdlc-bot via de Gitea API (pas een backlog `.md` aan)
2. Controleer Gitea Actions: de Action moet NIET getriggerd worden
3. Maak een handmatige commit als jezelf (of via de Gitea UI)
4. Controleer Gitea Actions: de Action MOET nu WEL triggeren
5. Controleer in n8n dat de Webhook binnenkomt met de juiste data
