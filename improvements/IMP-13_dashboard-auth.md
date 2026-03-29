# IMP-13 — Dashboard authenticatie: OAuth via Gitea

**Status:** open  
**Prioriteit:** 🟡 Normaal  
**Geschatte tijd:** 3-4 uur  
**Afhankelijk van:** IMP-08, IMP-10  
**Raakt aan:** `dashboard/`, SDLC Dashboard API workflow, n8n environment variabelen

---

## Probleem

Het dashboard is beveiligd met een hardcoded secret in de JavaScript source (`CONFIG.dashboardSecret`). Dit is triviaal te omzeilen:
- Open DevTools → Network → kopieer de header
- De secret staat in de broncode van een statisch geserveerd bestand

Er is geen onderscheid tussen beheerder (volledige controle) en viewer (alleen lezen).

---

## Oplossing

OAuth2 authenticatie via Gitea als identity provider, met een dunne auth-proxy.

---

## Architectuur

```
Browser → dashboard.7rb.nl
       → /auth/login → redirect naar Gitea OAuth consent
       → Gitea authoriseert → redirect terug met code
       → n8n /auth/callback → exchanged code voor token, maakt JWT
       → Browser slaat JWT op in httpOnly cookie
       → API calls gaan met JWT → n8n valideert
```

---

## Stap 1 — Gitea OAuth2 applicatie aanmaken

```
Gitea → Settings → Applications → Create OAuth2 Application
  Name: SDLC Dashboard
  Redirect URI: https://n8n.7rb.nl/webhook/sdlc-auth-callback
  → Bewaar Client ID en Client Secret
```

### n8n environment variabelen toevoegen

| Variabele | Waarde |
|-----------|--------|
| `GITEA_OAUTH_CLIENT_ID` | Client ID uit Gitea |
| `GITEA_OAUTH_CLIENT_SECRET` | Client Secret uit Gitea |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `DASHBOARD_ALLOWED_USERS` | `ruben,admin` (komma-gescheiden) |

---

## Stap 2 — n8n auth workflows

### Workflow: `SDLC Auth Login`

```
Webhook GET /sdlc-auth-login
  → [Code] Genereer state parameter (random, sla op in static data)
  → Redirect naar: 
    {{ $env.GITEA_URL }}/login/oauth/authorize
    ?client_id={{ $env.GITEA_OAUTH_CLIENT_ID }}
    &redirect_uri={{ $env.N8N_BASE_URL }}/webhook/sdlc-auth-callback
    &response_type=code
    &state={{ state }}
```

### Workflow: `SDLC Auth Callback`

```
Webhook GET /sdlc-auth-callback
  → [Code] Valideer state parameter
  → [HTTP] Exchange code voor access token
      POST {{ $env.GITEA_URL }}/login/oauth/access_token
      Body: { client_id, client_secret, code, grant_type: "authorization_code", redirect_uri }
  → [HTTP] Haal user info op
      GET {{ $env.GITEA_URL }}/api/v1/user
      Headers: Authorization: token {{ access_token }}
  → [Code] Check of user in DASHBOARD_ALLOWED_USERS
  → [IF] Toegestaan?
      ja → [Code] Genereer JWT met { username, role: "admin", exp: 24h }
           → Redirect naar dashboard.7rb.nl met Set-Cookie: sdlc_token={jwt}; HttpOnly; Secure; SameSite=Strict
      nee → Redirect naar dashboard.7rb.nl/unauthorized
```

---

## Stap 3 — Dashboard API: JWT validatie

Wijzig de Dashboard API (IMP-08) om JWT te valideren in plaats van de X-Dashboard-Secret header:

```javascript
// In de Dashboard API, vervang secret check:
const crypto = require('crypto');

const token = $input.first().json.headers.cookie
  ?.split(';')
  ?.find(c => c.trim().startsWith('sdlc_token='))
  ?.split('=')[1];

if (!token) {
  return [{ json: { error: 'Unauthorized', redirect: '/auth/login' } }];
}

// Simpele JWT validatie (header.payload.signature)
const [header, payload, signature] = token.split('.');
const expectedSig = crypto
  .createHmac('sha256', $env.JWT_SECRET)
  .update(`${header}.${payload}`)
  .digest('base64url');

if (signature !== expectedSig) {
  return [{ json: { error: 'Invalid token' } }];
}

const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
if (data.exp < Date.now() / 1000) {
  return [{ json: { error: 'Token expired', redirect: '/auth/login' } }];
}

return [{ json: { authenticated: true, user: data.username, role: data.role } }];
```

---

## Stap 4 — Dashboard frontend: auth flow

```javascript
// app.js: check auth bij laden
async function checkAuth() {
  const response = await fetch(CONFIG.apiUrl, { credentials: 'include' });
  if (response.status === 401) {
    const data = await response.json();
    if (data.redirect) {
      window.location.href = `${CONFIG.apiUrl.replace('sdlc-dashboard', 'sdlc-auth-login')}`;
    }
    return false;
  }
  return true;
}

// Voeg login/logout knop toe aan header
function renderAuthUI(user) {
  document.getElementById('auth-status').innerHTML = `
    <span class="user-badge">👤 ${user}</span>
    <button class="btn-refresh" onclick="logout()">Uitloggen</button>
  `;
}
```

---

## Stap 5 — Rol-gebaseerde toegang (optioneel)

| Rol | Rechten |
|-----|---------|
| `admin` | Volledige toegang: dashboard, acties, project management |
| `viewer` | Alleen lezen: dashboard bekijken, geen acties |

In de Dashboard Action webhook (IMP-10 stap 3):
```javascript
if (role !== 'admin') {
  return [{ json: { error: 'Insufficient permissions' } }];
}
```

---

## Verificatie

1. Open `dashboard.7rb.nl` → redirect naar Gitea login
2. Login met toegestaan account → dashboard laadt
3. Login met niet-toegestaan account → "Unauthorized" pagina
4. JWT verloopt na 24u → automatische redirect naar login
5. Inline acties werken alleen voor `admin` rol
