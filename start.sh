#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node || { printf '%s\n' 'Install Node.js 22.13 or newer first.'; exit 1; }
if [ ! -d node_modules ]; then npm ci --omit=dev; fi
exec node app/main.js
