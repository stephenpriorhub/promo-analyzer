#!/bin/bash

# Seed data volume from repo on first deploy (when volume is empty)
if [ -n "$DATA_DIR" ] && [ ! -f "$DATA_DIR/reviews.json" ]; then
  echo "[data] First run — seeding $DATA_DIR from repo..."
  mkdir -p "$DATA_DIR/files"
  [ -f "data/reviews.json" ] && cp data/reviews.json "$DATA_DIR/reviews.json" && echo "[data] reviews.json seeded"
fi

echo "[app] Starting Next.js on port 3000..."
exec npm start
