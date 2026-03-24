# IMP-06 — API Kosten-tracking per werkitem

**Status:** done  
**Prioriteit:** 🟡 Normaal  
**Geschatte tijd:** 1 uur  
**Raakt aan:** Alle templates, alle agent-workflows, Watchdog (voor rapportage)

---

## Probleem

Er is momenteel geen inzicht in hoeveel elke agent-run kost qua OpenRouter API-kosten. Je weet niet welke items duur zijn, welke modellen de meeste kosten maken, of wat de totale maandelijkse uitgaven zijn. Dit maakt het onmogelijk om gerichte beslissingen te maken over model-keuze per agent.

---

## Oplossing

Elke OpenRouter API-call retourneert kosteninformatie in de response. Sla deze cumulatief op per werkitem in de frontmatter, en aggregeer voor rapportages.

---

## Stap 1 — Voeg `api_cost_usd` toe aan alle templates

Voeg toe aan **alle** templates in `shared/templates/`:

```yaml
# Automatisch bijgehouden door n8n
api_cost_usd: 0.0000     # cumulatieve OpenRouter API-kosten voor dit item
```

Voeg toe aan: `BUG.md`, `ISS.md`, `EP.md`, `FE.md`, `US.md`

---

## Stap 2 — OpenRouter response bevat kosteninformatie

OpenRouter retourneert in elke chat completion response:

```json
{
  "id": "gen-...",
  "choices": [...],
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 456,
    "total_tokens": 1690,
    "total_cost": 0.002340
  }
}
```

> **Belangrijk:** `usage.total_cost` is het bedrag in USD voor deze specifieke call.

---

## Stap 3 — Generieke Cost Tracker helper

Voeg aan **elke** agent-workflow een Cost Tracker stap toe, direct na elke OpenRouter HTTP call:

### Code node: `Extract API Cost`

```javascript
// Voeg toe na elke OpenRouter API call
const response = $input.first().json;

// OpenRouter kosten
const thisCost = response.usage?.total_cost || 0;

// Haal huidige cumulatieve kosten op uit de frontmatter
// (meegegeven als context vanuit de eerder opgehaalde frontmatter)
const currentCost = parseFloat($('Parse Frontmatter').first().json.api_cost_usd) || 0;
const newTotalCost = currentCost + thisCost;

return [{
  json: {
    ...response,
    _cost_this_call: thisCost,
    _cost_cumulative: Math.round(newTotalCost * 100000) / 100000, // 5 decimalen
    _tokens_used: response.usage?.total_tokens || 0
  }
}];
```

### Integreer in de frontmatter-update

Voeg `api_cost_usd` toe aan de updates-dict in elke agent:

```javascript
// Code node: Bouw frontmatter updates
const updates = {
  status: 'triaged',
  processing_updated: new Date().toISOString(),
  current_agent: 'planner',
  api_cost_usd: $('Extract API Cost').first().json._cost_cumulative,
  // ... andere velden ...
};
```

---

## Stap 4 — Kosten-aggregatie in Watchdog / Dagrapport

### Code node in Watchdog: Aggregeer kosten

```javascript
// Voeg toe aan de Watchdog workflow (IMP-03) na het parsen van alle frontmatters
const allItems = $input.all().map(i => i.json);

const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

let totalCostAllTime = 0;
let totalCostToday = 0;
let totalCostYesterday = 0;
const costByProject = {};
const costByAgent = {};

allItems.forEach(item => {
  const cost = parseFloat(item.api_cost_usd) || 0;
  totalCostAllTime += cost;
  
  // Kosten per project
  if (!costByProject[item.project]) costByProject[item.project] = 0;
  costByProject[item.project] += cost;
  
  // Kosten vandaag (op basis van processing_updated datum)
  if (item.processing_updated?.startsWith(today)) {
    totalCostToday += cost;
  }
  if (item.processing_updated?.startsWith(yesterday)) {
    totalCostYesterday += cost;
  }
});

// Top 5 duurste actieve items
const activeItems = allItems
  .filter(i => !['documented', 'new'].includes(i.status))
  .sort((a, b) => (parseFloat(b.api_cost_usd) || 0) - (parseFloat(a.api_cost_usd) || 0))
  .slice(0, 5);

return [{
  json: {
    total_all_time: Math.round(totalCostAllTime * 10000) / 10000,
    total_today: Math.round(totalCostToday * 10000) / 10000,
    total_yesterday: Math.round(totalCostYesterday * 10000) / 10000,
    by_project: costByProject,
    top_expensive_active: activeItems.map(i => ({
      id: i.id,
      cost: i.api_cost_usd,
      status: i.status
    }))
  }
}];
```

---

## Stap 5 — Kosten-drempelwaarde alarm

Voeg een alarm toe als een enkel item te duur wordt:

```javascript
// Code node: Check drempel per item
const MAX_COST_PER_ITEM_USD = 0.50; // configurable

const expensiveItems = allItems
  .filter(i => parseFloat(i.api_cost_usd) > MAX_COST_PER_ITEM_USD)
  .filter(i => !['documented'].includes(i.status)); // alleen actieve items

if (expensiveItems.length > 0) {
  // Trigger Telegram alarm
}
```

**Telegram alarm:**
```
💰 Kosten-alarm: {{ item_id }} heeft ${{ api_cost_usd }} gekost (limiet: $0.50)
Status: {{ status }} | Project: {{ project }}
Overweeg: goedkoper model voor deze agent, of check of er een loop is.
```

---

## Stap 6 — Maandelijks kosten-overzicht (optioneel)

Voeg een **Schedule Trigger** toe op de 1e van elke maand:

```
Schedule Trigger (1e van de maand, 08:00)
  → [HTTP] Haal alle .md bestanden op (Gitea API)
  → [Code] Parse alle frontmatters + aggregeer kosten
  → [Code] Genereer maandrapport
  → Telegram: maandrapport
```

**Maandrapport formaat:**
```
📊 SDLC Maandrapport — maart 2026

💰 API Kosten:
Totaal deze maand:    $4.23
Gemiddeld per item:   $0.15
Duurste item:         FE-007 ($0.89)

📦 Per project:
spaartrack:   $2.10 (14 items)
demo-project: $2.13 (13 items)

🤖 Per agent (schatting o.b.v. model):
Triage:    $0.12 (goedkoopste model)
Developer: $3.45 (duurste model)
Review:    $0.66

✅ Voltooide items: 27
🔄 In pipeline: 2
```

> **Opmerking over per-agent kosten:** OpenRouter geeft alleen de totaalkosten per call terug, niet per agent. Schat de verdeling door model × tokens bij te houden per agent-call. Of: bewaar een JSON array van calls per item in een apart veld `cost_breakdown: []`.

---

## Verificatie

1. Verwerk een testitem door de volledige pipeline
2. Check `api_cost_usd` in de frontmatter van het item na `documented`
3. Vergelijk met de OpenRouter billing dashboard (openrouter.ai/activity)
4. Controleer of het Watchdog dagrapport de kostenoverzicht bevat
