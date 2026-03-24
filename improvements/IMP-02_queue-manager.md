# IMP-02 — Queue Manager: wachtrij voor items

**Status:** done  
**Prioriteit:** 🔴 Kritiek  
**Geschatte tijd:** 1-2 uur  
**Afhankelijk van:** IMP-01 (Lock Manager)  
**Raakt aan:** SDLC Router, nieuw bestand QUEUE.json, nieuwe workflow SDLC Queue Processor

---

## Probleem

Als de pipeline bezet is (lock actief) en er komt een nieuw item binnen, moet dat item ergens wachten tot de pipeline vrij is. Zonder een wachtrij gaat het item verloren of moet de menselijke eigenaar het handmatig opnieuw pushes.

---

## Oplossing

Een persistent `QUEUE.json` bestand in de repo als wachtrij, gecombineerd met een **Queue Processor** workflow die elke minuut controleert of er items klaarstaan.

---

## Stap 1 — QUEUE.json aanmaken

Maak het bestand `QUEUE.json` aan in de root van de `sdlc-platform` repo:

```json
{
  "queue": [],
  "last_updated": ""
}
```

Structuur van een queue-item:
```json
{
  "queue": [
    {
      "item_id": "BUG-002",
      "file_path": "projects/spaartrack/backlog/bugs/BUG-002_crash.md",
      "status": "new",
      "project": "spaartrack",
      "queued_at": "2026-03-24T20:05:00Z",
      "commit_sha": "abc123"
    }
  ],
  "last_updated": "2026-03-24T20:05:00Z"
}
```

Commit en push:
```bash
git add QUEUE.json
git commit -m "chore(sdlc): add pipeline queue file [sdlc-skip]"
git push origin main
```

---

## Stap 2 — Hulpfuncties in de SDLC Router

### Enqueue-functie (als lock bezet is)

Voeg toe aan de Router (na de mislukte lock-acquire poging):

```javascript
// Code node: Voeg item toe aan wachtrij
async function enqueueItem(item, filePath, commitSha) {
  // 1. Haal QUEUE.json op
  const queueFile = await getFileFromGitea('QUEUE.json');
  const queue = JSON.parse(Buffer.from(queueFile.content, 'base64').toString('utf8'));
  
  // 2. Check of item al in queue staat (deduplicatie)
  const alreadyQueued = queue.queue.find(q => q.item_id === item.id);
  if (alreadyQueued) {
    return { enqueued: false, reason: 'already_in_queue' };
  }
  
  // 3. Voeg toe
  queue.queue.push({
    item_id: item.id,
    file_path: filePath,
    status: item.status,
    project: item.project,
    queued_at: new Date().toISOString(),
    commit_sha: commitSha
  });
  queue.last_updated = new Date().toISOString();
  
  // 4. Schrijf terug
  await writeFileToGitea('QUEUE.json', JSON.stringify(queue, null, 2), queueFile.sha,
    `chore(queue): enqueue ${item.id} [sdlc-skip]`);
  
  return { enqueued: true };
}
```

Vereenvoudigd als n8n nodes:

**Node A: GET QUEUE.json**
```
HTTP GET {{ $env.GITEA_URL }}/api/v1/repos/{{ $env.GITEA_ORG }}/sdlc-platform/contents/QUEUE.json
```

**Node B: Parse + append**
```javascript
const file = $input.first().json;
const queue = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
const item = $('Parse Frontmatter').first().json;

const alreadyQueued = queue.queue.find(q => q.item_id === item.id);
if (alreadyQueued) {
  return [{ json: { enqueued: false, reason: 'already_in_queue' } }];
}

queue.queue.push({
  item_id: item.id,
  file_path: $('Parse Changed Files').first().json.filePath,
  status: item.status,
  project: item.project,
  queued_at: new Date().toISOString(),
  commit_sha: $('Webhook').first().json.commit_sha
});
queue.last_updated = new Date().toISOString();

return [{
  json: {
    content: Buffer.from(JSON.stringify(queue, null, 2)).toString('base64'),
    sha: file.sha,
    enqueued: true
  }
}];
```

**Node C: PUT QUEUE.json**
```
HTTP PUT {{ $env.GITEA_URL }}/api/v1/repos/.../contents/QUEUE.json
Body: { message: "chore(queue): enqueue {{ $json.item_id }} [sdlc-skip]", content: "...", sha: "..." }
```

---

## Stap 3 — Nieuwe workflow: `SDLC Queue Processor`

### Trigger
**Schedule Trigger**: elke 1 minuut

### Volledige workflow

```
Schedule Trigger (elke 1 min)
  
  → [HTTP] GET LOCK.json
  → [Code] Is locked?
  → [IF] locked = true:
      → Stop (pipeline is bezig, geen actie)
  
  → [HTTP] GET QUEUE.json
  → [Code] Is queue leeg?
  → [IF] queue leeg:
      → Stop (niets te doen)
  
  → [Code] Neem eerste item uit queue (FIFO)
  → [HTTP] GET frontmatter van het item (Gitea API)
  → [Code] Parse frontmatter: is status nog steeds hetzelfde als toen het in de queue ging?
  → [IF] status gewijzigd (item al verwerkt door iemand anders):
      → [Code] Verwijder item uit queue
      → [HTTP] PUT QUEUE.json (zonder dit item)
      → Stop (item hoeft niet meer verwerkt)
  
  → Execute Workflow: SDLC Lock Manager (acquire, item_id)
  → [IF] acquired = false:
      → Stop (toch bezet geworden, retry volgende minuut)
  
  → [IF] acquired = true:
      → [Code] Verwijder item uit queue
      → [HTTP] PUT QUEUE.json (zonder dit item)
      → [HTTP] Stuur item naar SDLC Router als Execute Workflow
         (of: roep direct de juiste agent aan op basis van status)
      → Telegram: "▶️ Queue: {{ item_id }} opgepakt ({{ queue.length }} items resterend)"
```

### Code node: Neem eerste item + verwijder uit queue

```javascript
const file = $input.first().json;
const queue = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

if (queue.queue.length === 0) {
  return [{ json: { empty: true } }];
}

// FIFO: neem het eerste item
const item = queue.queue.shift();
queue.last_updated = new Date().toISOString();

return [{
  json: {
    next_item: item,
    remaining_queue: queue,
    queue_sha: $input.first().json.sha,
    updated_queue_content: Buffer.from(JSON.stringify(queue, null, 2)).toString('base64'),
    empty: false
  }
}];
```

---

## Stap 4 — Integratie: Router schrijft naar queue bij lock-conflict

Voeg toe aan de SDLC Router (na maximaal aantal lock-pogingen):

```
[IF] lock nog steeds bezet na 10 pogingen:
  → Node A: GET QUEUE.json
  → Node B: Parse + append item
  → Node C: PUT QUEUE.json
  → Telegram: "⏳ {{ item_id }} in wachtrij geplaatst (pipeline bezet door {{ locked_by }})"
  → Stop verwerking dit item
```

---

## Stap 5 — Prioriteit-logica in de queue (optioneel)

Voeg een `priority_weight` toe aan queue-items voor FIFO met prioriteit:

```javascript
// Code node: Voeg toe voor sorting
const PRIORITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };

queue.queue.sort((a, b) => {
  const weightA = PRIORITY_WEIGHT[a.priority] || 2;
  const weightB = PRIORITY_WEIGHT[b.priority] || 2;
  if (weightB !== weightA) return weightB - weightA; // hoog priority eerst
  return new Date(a.queued_at) - new Date(b.queued_at); // anders: FIFO
});
```

Voeg `priority` toe als veld in het queue-item (kopieer uit de frontmatter).

---

## Verificatie

1. Start een lang-lopende pipeline (bijv. Developer Agent met complexe story)
2. Push een tweede `.md` bestand terwijl het eerste nog verwerkt wordt
3. Controleer Telegram: moet melding tonen dat item 2 in wachtrij staat
4. Controleer QUEUE.json in Gitea: bevat item 2
5. Na afloop van item 1: binnen 60 seconden moet item 2 automatisch starten
6. Controleer dat QUEUE.json daarna leeg is
