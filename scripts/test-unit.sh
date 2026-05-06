#!/usr/bin/env bash
# Run vitest with the Node version specified in .nvmrc.
# System node may be too old; nvm is used when available.
unset npm_config_prefix  # nvm requires this to be unset
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use --silent 2>/dev/null || true
fi
exec node node_modules/.bin/vitest "$@"
