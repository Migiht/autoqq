#!/bin/sh
# autoqq installer — Linux only.
# Usage: curl -fsSL https://raw.githubusercontent.com/Migiht/autoqq/refs/heads/main/install.sh | sh
set -eu

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
error() {
  printf '\033[31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || error "autoqq only supports Linux."
command -v systemctl >/dev/null 2>&1 || error "autoqq requires systemd (systemctl not found)."

if ! command -v node >/dev/null 2>&1; then
  error "Node.js >= 20.12 is required. Install it (e.g. via nvm: https://github.com/nvm-sh/nvm) and re-run this script."
fi

node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 20 ]; then
  error "Node.js >= 20.12 is required (found $(node -v)). Upgrade and re-run."
fi

command -v npm >/dev/null 2>&1 || error "npm was not found alongside node. Install npm and re-run."

info "Installing autoqq globally via npm..."
npm install -g @migiht/autoqq

if ! command -v autoqq >/dev/null 2>&1; then
  error "autoqq installed but isn't on PATH. Check npm's global bin dir with: npm bin -g"
fi

info "autoqq installed: $(autoqq --version)"
info "Next: run 'autoqq init' to configure your schedule."
