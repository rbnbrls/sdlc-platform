# QG-03b: Secret Scan Gate

**Fase:** Na Developer Agent, vóór Reviewer Agent (onderdeel van QG-03 pipeline)
**Evalueert:** Secret Scanner Agent

## Verplichte criteria

### Scan volledigheid
- Alle gewijzigde bestanden zijn gescand (files_scanned > 0)
- Scan is uitgevoerd op de **volledige diff** van de branch vs main
- Geen scan errors of timeouts

### Bevindingen
- Geen `critical` findings in productie code
- Geen hardcoded API keys, passwords, tokens, private keys
- Geen database connection strings met credentials
- Geen private keys of certificaten in code

### Uitzonderingen (zijn toegestaan)
- Placeholder/voorbeeld waarden in `.env.example`
- Dummy waarden in test bestanden (worden als `warning` gerapporteerd, niet geblokkeerd)
- Versleutelde secrets (bijv. Ansible Vault formaat)

## Bij falen (scan_passed: false)
- `status` terugzetten naar `in-progress`
- Telegram: "🔐 Secret scanner geblokkeerd: {id} — {bestand}:{lijn}"
- Voeg finding toe als commentaar in het .md werkitem
- **Nooit** de gevonden waarde in Telegram of bestanden vermelden
- Retry Developer Agent met de finding als extra context

## Bij warnings (scan_passed: true maar warnings aanwezig)
- Pipeline loopt door
- Telegram: "⚠️ Secret scanner waarschuwing: {id} — {n} warnings in testbestanden"
- Voeg warnings toe in het .md werkitem als commentaar
