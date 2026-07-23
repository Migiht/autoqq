#!/bin/sh
# autoqq installer — Linux only.
# Usage: curl -fsSL https://raw.githubusercontent.com/Migiht/autoqq/refs/heads/main/install.sh | sh
set -eu

NODE_MIN_MAJOR=20
NODE_INSTALL_DIR="$HOME/.local/share/autoqq/node"

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33mwarn:\033[0m %s\n' "$1"; }
error() {
  printf '\033[31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

# Prompts on the controlling terminal even when this script itself arrived
# via `curl | sh` (stdin is occupied by the piped script, not the keyboard).
# Enter continues; Ctrl+C cancels (the shell's normal SIGINT handling exits
# the script). If no terminal is attached at all (e.g. a non-interactive
# CI/container build), skips the prompt and proceeds automatically.
confirm_or_skip() {
  message="$1"
  if ( printf '%s [Enter to continue, Ctrl+C to cancel] ' "$message" > /dev/tty ) 2>/dev/null; then
    # shellcheck disable=SC3045
    ( read -r _ans < /dev/tty ) 2>/dev/null || true
  else
    info "$message (no terminal attached — continuing automatically)"
  fi
}

[ "$(uname -s)" = "Linux" ] || error "autoqq only supports Linux."
command -v systemctl >/dev/null 2>&1 || error "autoqq requires systemd (systemctl not found)."
command -v curl >/dev/null 2>&1 || error "curl is required but was not found."
command -v tar >/dev/null 2>&1 || error "tar is required but was not found."

node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || return 1
  major=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null) || return 1
  [ "$major" -ge "$NODE_MIN_MAJOR" ]
}

# Downloads and unpacks the official Node.js LTS build from nodejs.org (the
# project's own distribution, not a third-party version manager) into a
# per-user directory — no root required, doesn't touch any system Node.
install_node() {
  arch=$(uname -m)
  case "$arch" in
    x86_64) node_arch="x64" ;;
    aarch64 | arm64) node_arch="arm64" ;;
    *) error "Unsupported architecture \"$arch\". Install Node.js >= 20.12 manually from https://nodejs.org/en/download and re-run." ;;
  esac

  info "Looking up the latest Node.js LTS release from nodejs.org..."
  index_json=$(curl -fsSL https://nodejs.org/dist/index.json) \
    || error "Could not reach nodejs.org to look up Node.js releases."
  node_version=$(printf '%s\n' "$index_json" | grep -m1 '"lts":"' \
    | sed -n 's/.*"version":"v\([0-9.]*\)".*/\1/p')
  [ -n "$node_version" ] || error "Could not determine the latest Node.js LTS version."

  filename="node-v${node_version}-linux-${node_arch}.tar.gz"
  url="https://nodejs.org/dist/v${node_version}/${filename}"
  tmpfile=$(mktemp)
  trap 'rm -f "$tmpfile"' EXIT

  info "Downloading Node.js v${node_version} (${node_arch}) from nodejs.org..."
  curl -fsSL "$url" -o "$tmpfile" || error "Failed to download $url"

  info "Installing Node.js into $NODE_INSTALL_DIR..."
  rm -rf "$NODE_INSTALL_DIR"
  mkdir -p "$NODE_INSTALL_DIR"
  tar -xzf "$tmpfile" -C "$NODE_INSTALL_DIR" --strip-components=1
  rm -f "$tmpfile"
  trap - EXIT

  export PATH="$NODE_INSTALL_DIR/bin:$PATH"

  path_line="export PATH=\"$NODE_INSTALL_DIR/bin:\$PATH\""
  # .bashrc/.profile are created if missing — this is the only thing that
  # makes node/npm/autoqq reachable in the *next* shell session on a fresh
  # server that had no Node.js at all. .zshrc is only touched if it already
  # exists, since creating one would be presumptuous for a non-zsh user.
  for rc in "$HOME/.bashrc" "$HOME/.profile"; do
    touch "$rc"
    if ! grep -qF "$NODE_INSTALL_DIR/bin" "$rc" 2>/dev/null; then
      printf '\n# Added by the autoqq installer\n%s\n' "$path_line" >> "$rc"
    fi
  done
  if [ -f "$HOME/.zshrc" ] && ! grep -qF "$NODE_INSTALL_DIR/bin" "$HOME/.zshrc" 2>/dev/null; then
    printf '\n# Added by the autoqq installer\n%s\n' "$path_line" >> "$HOME/.zshrc"
  fi

  node_ok || error "Node.js install appears to have failed. Try https://nodejs.org/en/download manually."
  info "Node.js $(node -v) installed."
}

if ! node_ok; then
  if command -v node >/dev/null 2>&1; then
    if command -v npm >/dev/null 2>&1; then
      warn "Found Node.js $(node -v), but autoqq needs >= v$NODE_MIN_MAJOR.12."
    else
      warn "Found Node.js $(node -v), but npm is missing (some distros package them separately)."
    fi
  else
    warn "Node.js >= v$NODE_MIN_MAJOR.12 was not found."
  fi
  confirm_or_skip "Install Node.js + npm now via the official nodejs.org build (no root required, won't touch the system Node)?"
  install_node
fi

info "Installing autoqq globally via npm..."
npm install -g @migiht/autoqq

if ! command -v autoqq >/dev/null 2>&1; then
  error "autoqq installed but isn't on PATH. Check npm's global bin dir with: npm bin -g"
fi

info "autoqq installed: $(autoqq --version)"
info "Next: run 'autoqq init' to configure your schedule."
