#!/bin/bash

# Clone or update the brain vault from GitHub so tag scanning works on Railway.
# This is non-fatal — if it fails, the app still starts without brain features.
if [ -n "$BRAIN_GITHUB_REPO" ] && [ -n "$GITHUB_TOKEN" ]; then
  REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${BRAIN_GITHUB_REPO}.git"
  VAULT_PATH="/tmp/brain"

  if [ -d "$VAULT_PATH/.git" ]; then
    echo "[brain] Pulling latest vault..."
    git -C "$VAULT_PATH" pull --quiet origin main 2>/dev/null || echo "[brain] Pull failed — using existing vault"
  else
    echo "[brain] Cloning vault..."
    git clone --depth 1 "$REPO_URL" "$VAULT_PATH" --quiet 2>/dev/null || echo "[brain] Clone failed — brain features unavailable"
  fi

  if [ -d "$VAULT_PATH/.git" ]; then
    mkdir -p "$VAULT_PATH/Resources/Promo Analysis/Promo Analysis Tool"
    export BRAIN_VAULT_DIR="$VAULT_PATH"
    export BRAIN_DIR="$VAULT_PATH/Resources/Promo Analysis/Promo Analysis Tool"
    echo "[brain] Vault ready at $VAULT_PATH"
  fi
else
  echo "[brain] BRAIN_GITHUB_REPO or GITHUB_TOKEN not set — brain features disabled"
fi

echo "[app] Starting Next.js standalone on port ${PORT:-3000}..."
export HOSTNAME=0.0.0.0
exec node .next/standalone/server.js
