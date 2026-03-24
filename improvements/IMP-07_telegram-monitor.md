# IMP-07 — Telegram Monitor: dagrapport + inline actieknoppen

**Status:** open  
**Prioriteit:** 🟢 Wenselijk  
**Geschatte tijd:** 2 uur  
**Afhankelijk van:** IMP-03 (Watchdog), IMP-06 (Kosten-tracking)  
**Raakt aan:** Nieuwe workflow SDLC Daily Report, nieuwe workflow SDLC Telegram Handler

---

## Probleem

De huidige Telegram-notificaties zijn reactief (je krijgt een bericht als iets gebeurt), maar er is:
- Geen dagelijkse samenvatting van de projectstatus
- Geen mogelijkheid om actie te nemen vanuit Telegram (bijv. needs-human items afhandelen)
- Geen overzichtelijk dagrapport met kosten en statistieken

---

## Oplossing

Twee nieuwe workflows:
1. **SDLC Daily Report** — dagelijkse samenvatting via Schedule Trigger
2. **SDLC Telegram Handler** — verwerkt inline keyboard callbacks van de Telegram bot

---

## Stap 1 — Telegram bot instellen met inline keyboards

De huidige Telegram-integratie in n8n gebruikt alleen de `sendMessage` actie. Voor inline keyboards gebruik je de Telegram API direct via HTTP:

### Controleer dat de Telegram bot webhook actief is

Telegram bot updates moeten als webhook naar n8n gestuurd worden:

```bash
curl -X POST "https://api.telegram.org/bot{{ TELEGRAM_BOT_TOKEN }}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://n8n.7rb.nl/webhook/telegram-handler"}'
```

Verificeer:
```bash
curl "https://api.telegram.org/bot{{ TELEGRAM_BOT_TOKEN }}/getWebhookInfo"
```

---

## Stap 2 — Nieuwe workflow: `SDLC Daily Report`

### Trigger
**Schedule Trigger**: elke dag om 08:00 (Europe/Amsterdam)

### Volledige workflow

```
Schedule Trigger (08:00)
  → [HTTP] Haal alle backlog .md op (Gitea tree API)
  → [Code] Parse alle frontmatters in batch
  → [Code] Bereken statistieken
  → [HTTP] Stuur dagrapport via Telegram (met inline keyboard bij action items)
```

### Code node: Bereken statistieken

```javascript
const allItems = $input.all().map(i => i.json);
const now = new Date();
const yesterday = new Date(now - 86400000);
const weekAgo = new Date(now - 7 * 86400000);

const todayStr = now.toISOString().split('T')[0];
const yesterdayStr = yesterday.toISOString().split('T')[0];

// Categoriseer items
const stats = {
  // Status verdeling
  by_status: {},
  
  // Voltooide items
  completed_today: [],
  completed_this_week: [],
  
  // Aandacht-items
  needs_human: [],
  high_retry: [],        // retry_count >= 2
  stale: [],             // pipeline_updated > 30 min geleden, niet terminaal
  
  // Pipeline-items (actief in verwerking)
  in_pipeline: [],
  
  // Kosten
  total_cost_today: 0,
  total_cost_this_week: 0,
  total_cost_all: 0
};

const TERMINAL = ['documented', 'needs-human', 'deploy-failed'];
const STALE_MS = 30 * 60 * 1000;

allItems.forEach(item => {
  // Status verdeling
  stats.by_status[item.status] = (stats.by_status[item.status] || 0) + 1;
  
  // Voltooide items
  if (item.status === 'documented') {
    if (item.processing_updated?.startsWith(todayStr)) {
      stats.completed_today.push(item);
    }
    if (new Date(item.processing_updated) > weekAgo) {
      stats.completed_this_week.push(item);
    }
  }
  
  // Aandacht: needs-human
  if (item.status === 'needs-human') {
    stats.needs_human.push(item);
  }
  
  // Aandacht: hoge retry
  if (parseInt(item.retry_count) >= 2 && !TERMINAL.includes(item.status)) {
    stats.high_retry.push(item);
  }
  
  // Aandacht: stale (actief maar al lang niet bijgewerkt)
  if (!TERMINAL.includes(item.status) && item.status !== 'new' && item.processing_updated) {
    const lastUpdate = new Date(item.processing_updated);
    if (now - lastUpdate > STALE_MS) {
      stats.stale.push(item);
    }
  }
  
  // In pipeline (actief)
  if (!TERMINAL.includes(item.status) && item.status !== 'new') {
    stats.in_pipeline.push(item);
  }
  
  // Kosten
  const cost = parseFloat(item.api_cost_usd) || 0;
  stats.total_cost_all += cost;
  if (item.processing_updated?.startsWith(todayStr)) {
    stats.total_cost_today += cost;
  }
  if (new Date(item.processing_updated) > weekAgo) {
    stats.total_cost_this_week += cost;
  }
});

return [{ json: stats }];
```

### Code node: Formatteer dagrapport bericht

```javascript
const s = $input.first().json;
const date = new Date().toLocaleDateString('nl-NL', { 
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  timeZone: 'Europe/Amsterdam'
});

let msg = `📊 *SDLC Dagrapport*\n_${date}_\n\n`;

// Pipeline status
const pipelineStatuses = ['triaged', 'planned', 'in-progress', 'review', 'testing', 'staging-verified', 'done'];
const pipelineItems = pipelineStatuses
  .map(st => s.by_status[st] ? `${st}: ${s.by_status[st]}` : null)
  .filter(Boolean);

msg += `🔄 *Pipeline:* ${s.in_pipeline.length} actief\n`;
if (pipelineItems.length) {
  msg += pipelineItems.map(p => `  • ${p}`).join('\n') + '\n';
}
msg += '\n';

// Voltooide items
msg += `✅ *Voltooid:*\n`;
msg += `  Vandaag: ${s.completed_today.length} items\n`;
msg += `  Deze week: ${s.completed_this_week.length} items\n\n`;

// Nieuwe items
msg += `🆕 *Nieuw (wachten):* ${s.by_status['new'] || 0} items\n\n`;

// Kosten
msg += `💰 *API Kosten:*\n`;
msg += `  Vandaag: $${s.total_cost_today.toFixed(4)}\n`;
msg += `  Deze week: $${s.total_cost_this_week.toFixed(4)}\n\n`;

// Aandacht
const attentionCount = s.needs_human.length + s.high_retry.length + s.stale.length;
if (attentionCount > 0) {
  msg += `⚠️ *Aandacht vereist (${attentionCount} items):*\n`;
  
  s.needs_human.forEach(i => {
    msg += `  🔴 \`${i.id}\` — needs-human\n`;
    msg += `     ${i.last_error || 'Geen reden opgegeven'}\n`;
  });
  
  s.high_retry.forEach(i => {
    msg += `  🟠 \`${i.id}\` — ${i.retry_count}x retry (status: ${i.status})\n`;
  });
  
  s.stale.forEach(i => {
    const ageMin = Math.round((new Date() - new Date(i.processing_updated)) / 60000);
    msg += `  🟡 \`${i.id}\` — stale (${ageMin} min, agent: ${i.current_agent})\n`;
  });
} else {
  msg += `✨ *Geen aandacht vereist*\n`;
}

return [{ json: { text: msg, needs_human_items: s.needs_human } }];
```

### HTTP Request: Verstuur bericht met Telegram API

Voor berichten zonder inline keyboard (geen needs-human items):
```
POST https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage
Body:
{
  "chat_id": "{{ $env.TELEGRAM_CHAT_ID }}",
  "text": "{{ $json.text }}",
  "parse_mode": "Markdown"
}
```

### Loop: Stuur inline keyboard per needs-human item

Voor elk needs-human item een apart bericht met actieknoppen:

```javascript
// Code node: Genereer inline keyboard bericht per needs-human item
const item = $input.first().json; // één needs-human item

return [{
  json: {
    chat_id: $env.TELEGRAM_CHAT_ID,
    text: `🔴 *Actie vereist: ${item.id}*\n\n` +
          `Project: ${item.project}\n` +
          `Reden: ${item.last_error || 'Niet gespecificeerd'}\n` +
          `Status was: ${item.status}`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        {
          text: '✅ Goedkeuren & hervat',
          callback_data: `approve:${item.id}:${item.file_path}`
        },
        {
          text: '❌ Afwijzen & archiveer',
          callback_data: `reject:${item.id}:${item.file_path}`
        }
      ], [
        {
          text: '🔄 Herstart agent',
          callback_data: `restart:${item.id}:${item.file_path}`
        },
        {
          text: '📄 Bekijk item',
          url: `https://git.7rb.nl/sdlc-platform/sdlc-platform/src/branch/main/${item.file_path}`
        }
      ]]
    }
  }
}];
```

```
HTTP POST https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage
Body: {{ $json }}
```

---

## Stap 3 — Nieuwe workflow: `SDLC Telegram Handler`

Verwerkt de callback_data van inline keyboard knoppen.

### Trigger

**Webhook**: `POST /telegram-handler`  
(Dit is de URL die je bij Telegram als webhook hebt ingesteld in stap 1)

### Node 1 — Parse Telegram update

```javascript
const update = $input.first().json;

// Telegram stuurt een 'callback_query' voor inline button clicks
const callbackQuery = update.callback_query;
if (!callbackQuery) {
  // Gewoon bericht, geen actie nodig
  return [{ json: { skip: true } }];
}

const [action, itemId, ...pathParts] = callbackQuery.data.split(':');
const filePath = pathParts.join(':'); // herstel het pad

return [{
  json: {
    action,           // approve | reject | restart
    item_id: itemId,
    file_path: filePath,
    callback_query_id: callbackQuery.id,
    from_user: callbackQuery.from.username || callbackQuery.from.first_name,
    message_id: callbackQuery.message.message_id,
    chat_id: callbackQuery.message.chat.id
  }
}];
```

### Node 2 — Beantwoord de callback query (verwijder de laadanimatie)

```
HTTP POST https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/answerCallbackQuery
Body:
{
  "callback_query_id": "{{ $json.callback_query_id }}",
  "text": "Actie ontvangen..."
}
```

### Node 3 — Switch op actie

**Switch node** op `{{ $json.action }}`:
- `approve` → ga naar Approve-flow
- `reject` → ga naar Reject-flow
- `restart` → ga naar Restart-flow

### Node 4a — Approve-flow

```javascript
// Haal frontmatter op + bepaal volgende status
// Voor needs-human items: zet terug naar de status vóór needs-human
// Dit vereist dat we bijhouden wat de vorige status was

// Optie A: Sla 'previous_status' op in frontmatter bij elke needs-human update
// Optie B: Hardcode: needs-human → triaged (begin opnieuw)

const updates = {
  status: 'triaged',  // of: $json.previous_status
  last_error: '',
  processing_updated: new Date().toISOString(),
  current_agent: ''
};
```

Gevolgd door: frontmatter update (Gitea API PUT) + Lock Manager release + item in Queue plaatsen.

**Telegram bevestiging:**
```
HTTP POST .../sendMessage
{
  "chat_id": "{{ $json.chat_id }}",
  "text": "✅ {{ $json.item_id }} goedgekeurd door {{ $json.from_user }}. Item hervat.",
  "reply_to_message_id": "{{ $json.message_id }}"
}
```

### Node 4b — Reject-flow

```javascript
const updates = {
  status: 'needs-human',
  last_error: `Afgewezen door ${$json.from_user} via Telegram`,
  processing_updated: new Date().toISOString()
};
// Optioneel: verplaats .md bestand naar backlog/archived/
```

**Telegram bevestiging:**
```
❌ {{ item_id }} afgewezen door {{ from_user }}. Status blijft needs-human.
```

### Node 4c — Restart-flow

```javascript
const updates = {
  status: 'planned',  // terug naar het begin van de developer cyclus
  retry_count: 0,
  last_error: `Handmatig herstart door ${$json.from_user}`,
  processing_updated: new Date().toISOString(),
  current_agent: ''
};
```

Gevolgd door: Lock Manager release + item in Queue.

**Telegram bevestiging:**
```
🔄 {{ item_id }} herstart door {{ from_user }}. Item staat in de wachtrij.
```

---

## Stap 4 — Voeg `previous_status` toe aan templates

Om de Approve-flow te laten werken (herstel naar vorige status), voeg toe aan alle templates:

```yaml
previous_status: ""   # ingevuld door n8n bij elke status-overgang
```

In **elke** agent, vóór het schrijven van de nieuwe status:

```javascript
// Code node: bewaar vorige status
const currentStatus = frontmatter.status;
const updates = {
  previous_status: currentStatus,  // bewaar de huidige status voordat we updaten
  status: 'needs-human',
  // ...
};
```

---

## Verificatie

1. Activeer de Daily Report workflow handmatig (n8n → Test run)
2. Controleer Telegram: moet een geformatteerd dagrapport sturen
3. Zet een item handmatig op `status: needs-human` in Gitea
4. Activeer Daily Report opnieuw: moet inline knoppen tonen voor het needs-human item
5. Klik op "✅ Goedkeuren" in Telegram
6. Controleer dat het item in de queue komt en weer verwerkt wordt
7. Controleer dat de Telegram bot de callback bevestigt (laad-animatie verdwijnt)
