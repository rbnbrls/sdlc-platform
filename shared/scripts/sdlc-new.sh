#!/bin/bash
# sdlc-new — SDLC werkitem aanmaak CLI
# Gebruik: ./sdlc-new.sh <type> <project> "<title>" [priority]
# Voorbeeld: ./sdlc-new.sh bug spaartrack "Login crasht bij leeg wachtwoord" high
#
# Vereisten: git, curl, jq
# Stel in: GITEA_URL, GITEA_TOKEN, GITEA_ORG als env vars of in ~/.sdlc.conf

set -euo pipefail

# --- Configuratie ---
CONF_FILE="$HOME/.sdlc.conf"
if [[ -f "$CONF_FILE" ]]; then
  source "$CONF_FILE"
fi

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
GITEA_TOKEN="${GITEA_TOKEN:-}"
GITEA_ORG="${GITEA_ORG:-sdlc-platform}"
SDLC_REPO="${GITEA_ORG}/sdlc-platform"
TODAY=$(date +%Y-%m-%d)

# --- Kleuren voor output ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1"; exit 1; }

# --- Argumenten valideren ---
if [[ $# -lt 3 ]]; then
  echo "Gebruik: $0 <type> <project> \"<title>\" [priority]"
  echo "Types:    bug | issue | epic | feature | story"
  echo "Priority: low | medium | high | critical (standaard: medium)"
  exit 1
fi

TYPE="$1"
PROJECT="$2"
TITLE="$3"
PRIORITY="${4:-medium}"

# Valideer type
case "$TYPE" in
  bug|issue|epic|feature|story) ;;
  *) error "Ongeldig type: $TYPE. Kies: bug | issue | epic | feature | story" ;;
esac

# Valideer priority
case "$PRIORITY" in
  low|medium|high|critical) ;;
  *) error "Ongeldige priority: $PRIORITY. Kies: low | medium | high | critical" ;;
esac

# --- ID prefix bepalen ---
case "$TYPE" in
  bug)     PREFIX="BUG" ;;
  issue)   PREFIX="ISS" ;;
  epic)    PREFIX="EP" ;;
  feature) PREFIX="FE" ;;
  story)   PREFIX="US" ;;
esac

# --- Controleer GITEA_TOKEN ---
if [[ -z "$GITEA_TOKEN" ]]; then
  error "GITEA_TOKEN niet ingesteld. Stel in via ~/.sdlc.conf of env var."
fi

# --- Haal hoogste ID op via Gitea API ---
echo "🔍 Hoogste bestaande ${PREFIX}-ID ophalen..."
SEARCH_PATH="projects/${PROJECT}/backlog"

# Haal directory listing op
TREE_JSON=$(curl -sf \
  -H "Authorization: token ${GITEA_TOKEN}" \
  "${GITEA_URL}/api/v1/repos/${SDLC_REPO}/git/trees/main?recursive=1" \
  2>/dev/null || echo '{"tree":[]}')

# Extraheer hoogste ID nummer
HIGHEST=$(echo "$TREE_JSON" | \
  jq -r ".tree[].path" 2>/dev/null | \
  grep "${SEARCH_PATH}.*${PREFIX}-[0-9]" | \
  grep -oE "${PREFIX}-[0-9]+" | \
  grep -oE "[0-9]+" | \
  sort -n | tail -1 || echo "0")

NEXT_NUM=$(printf "%03d" $((HIGHEST + 1)))
ITEM_ID="${PREFIX}-${NEXT_NUM}"

# --- Slug genereren uit title ---
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9 ]//g' | \
  sed 's/ \+/-/g' | \
  cut -c1-40 | \
  sed 's/-$//')

# --- Bestandsnaam en pad ---
case "$TYPE" in
  bug)     SUBDIR="bugs" ;;
  issue)   SUBDIR="issues" ;;
  epic)    SUBDIR="epics" ;;
  feature) SUBDIR="features" ;;
  story)   SUBDIR="stories" ;;
esac

FILENAME="${ITEM_ID}_${SLUG}.md"
FILEPATH="projects/${PROJECT}/backlog/${SUBDIR}/${FILENAME}"

# --- Template ophalen van Gitea ---
echo "📄 Template ophalen..."
TEMPLATE_PATH="shared/templates/${TYPE^^}.md"
case "$TYPE" in
  bug)     TEMPLATE_PATH="shared/templates/BUG.md" ;;
  issue)   TEMPLATE_PATH="shared/templates/ISS.md" ;;
  epic)    TEMPLATE_PATH="shared/templates/EP.md" ;;
  feature) TEMPLATE_PATH="shared/templates/FE.md" ;;
  story)   TEMPLATE_PATH="shared/templates/US.md" ;;
esac

TEMPLATE_RESP=$(curl -sf \
  -H "Authorization: token ${GITEA_TOKEN}" \
  "${GITEA_URL}/api/v1/repos/${SDLC_REPO}/contents/${TEMPLATE_PATH}" \
  2>/dev/null || echo "")

if [[ -z "$TEMPLATE_RESP" ]]; then
  error "Template niet gevonden: ${TEMPLATE_PATH}"
fi

TEMPLATE_CONTENT=$(echo "$TEMPLATE_RESP" | jq -r '.content' | base64 -d)

# --- Frontmatter invullen ---
CONTENT=$(echo "$TEMPLATE_CONTENT" | \
  sed "s/^id: ${PREFIX}-XXX/id: ${ITEM_ID}/" | \
  sed "s/^project: PROJECTNAAM/project: ${PROJECT}/" | \
  sed "s/^title: \"\"/title: \"${TITLE}\"/" | \
  sed "s/^priority: medium/priority: ${PRIORITY}/" | \
  sed "s/^created: YYYY-MM-DD/created: ${TODAY}/" | \
  sed "s/^updated: YYYY-MM-DD/updated: ${TODAY}/" \
)

# --- Schrijf naar Gitea ---
echo "📝 Aanmaken: ${FILEPATH}..."
CONTENT_B64=$(echo "$CONTENT" | base64)

RESPONSE=$(curl -sf -X POST \
  -H "Authorization: token ${GITEA_TOKEN}" \
  -H "Content-Type: application/json" \
  "${GITEA_URL}/api/v1/repos/${SDLC_REPO}/contents/${FILEPATH}" \
  -d "{
    \"message\": \"feat(backlog): add ${ITEM_ID} — ${TITLE}\",
    \"content\": \"${CONTENT_B64}\"
  }" 2>/dev/null)

if [[ -z "$RESPONSE" ]]; then
  error "Aanmaken mislukt. Controleer Gitea URL, token en of het project bestaat."
fi

# --- Succes ---
echo ""
info "Werkitem aangemaakt: ${ITEM_ID}"
info "Bestand: ${FILEPATH}"
info "Gitea: ${GITEA_URL}/${SDLC_REPO}/src/branch/main/${FILEPATH}"
echo ""
echo "🚀 De SDLC pipeline start automatisch zodra de Gitea Action triggert."
echo "   Volg de voortgang via Telegram of in n8n Executions."
