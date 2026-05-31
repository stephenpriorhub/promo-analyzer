#!/bin/bash
set -e

# Clone or update the brain vault from GitHub so tag scanning works on Railway.
# Requires BRAIN_GITHUB_REPO (e.g. "stephenpriorhub/brain") and GITHUB_TOKEN.
if [ -n "$BRAIN_GITHUB_REPO" ] && [ -n "$GITHUB_TOKEN" ]; then
  REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${BRAIN_GITHUB_REPO}.git"
  VAULT_PATH="/tmp/brain"

  if [ -d "$VAULT_PATH/.git" ]; then
    echo "[brain] Pulling latest vault..."
    git -C "$VAULT_PATH" pull --quiet origin main 2>/dev/null || true
  else
    echo "[brain] Cloning vault..."
    git clone --depth 1 "$REPO_URL" "$VAULT_PATH" --quiet
  fi

  # Ensure the Promo Analysis Tool folder exists
  mkdir -p "$VAULT_PATH/Resources/Promo Analysis/Promo Analysis Tool"

  export BRAIN_VAULT_DIR="$VAULT_PATH"
  export BRAIN_DIR="$VAULT_PATH/Resources/Promo Analysis/Promo Analysis Tool"
  echo "[brain] Vault ready at $VAULT_PATH"
fi

exec npm start
