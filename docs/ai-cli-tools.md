# AI Coding CLI Tools — Reference for `autoqq`

Research notes for building `autoqq install <tool>`, which needs to: detect
install state, run login, verify auth succeeded via a detectable signal, and
later invoke the tool non-interactively on a cron schedule to send one
"keep-alive" message that starts the tool's rate-limit clock.

Last researched: 2026-07-23.

---

## 1. Claude Code (Anthropic)

**Docs:** https://code.claude.com/docs/en/headless.md ,
https://code.claude.com/docs/en/cli-reference ,
https://code.claude.com/docs/en/authentication

### Install
```bash
npm install -g @anthropic-ai/claude-code
```
Binary name: **`claude`**.

### Login / auth
- Interactive OAuth flow: `claude auth login` (flags: `--email`, `--sso`,
  `--console`). Historically exposed as the in-app `/login` slash command;
  `claude auth login` is the standalone CLI equivalent for scripting the
  initial sign-in.
- Check status: `claude auth status`.
- Log out: `claude auth logout`.
- For long-lived, non-interactive auth (ideal for autoqq's cron use case):
  `claude setup-token` generates a long-lived OAuth token you export as
  `CLAUDE_CODE_OAUTH_TOKEN`. Claude Code prioritizes this env var over the
  Keychain/credentials file, which is useful when a login session (e.g. SSH,
  cron with no active desktop session) can't unlock the Keychain.
- API-key alternative: set `ANTHROPIC_API_KEY` (bypasses OAuth entirely;
  required in `--bare` mode, see below).

### Non-interactive / headless invocation
```bash
claude -p "qq"                     # print mode: run to completion, print result, exit
claude --bare -p "qq"              # faster startup; skips hooks/MCP/CLAUDE.md discovery
echo "qq" | claude -p              # stdin piping also supported
claude -p "qq" --output-format json   # structured output w/ session_id, cost, etc.
```
- `-p` / `--print` is the flag family autoqq needs — it's the exact "one-shot
  prompt in, response out, process exits" mechanism.
- Built-in interactive-only commands (like `/login`) are unavailable inside
  `-p` mode, so login must happen as a separate step before automation starts.
- `--bare` is recommended for scripted calls (skips OAuth/keychain reads
  unless `ANTHROPIC_API_KEY` or `apiKeyHelper` supplies auth) and Anthropic
  says it will become the default for `-p` in a future release.

### Config / session files that indicate logged-in state (Linux)
- `~/.claude/.credentials.json` — OAuth token JSON (`claudeAiOauth` key with
  `accessToken`/`refreshToken`), file mode `0600`. This is the strongest
  Linux "is this tool authenticated" signal `autoqq` can stat/parse.
  (On macOS, the same data lives in the macOS Keychain under service name
  `Claude Code-credentials` instead of a file — not applicable on our
  Linux-only target, but worth noting the platform difference doesn't affect
  us.)
- `~/.claude.json` — project entries / session tracking metadata.
- `~/.claude/` more broadly holds settings, transcripts, and per-project
  history.
- Presence of a valid `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` env
  var is an equally valid "authenticated" signal for headless/bare usage.

### Rate-limit window (why autoqq exists for this tool)
- Claude Code enforces a **rolling 5-hour usage window**: usage from a
  request expires exactly 5 hours after that request, so capacity restores
  continuously rather than resetting at a fixed clock time. The window
  starts ticking from your **first prompt**.
- There is also a **rolling 7-day weekly cap** measured from the first
  prompt of that week (not a fixed Monday reset).
- Usage is a shared pool across claude.ai, Claude Desktop, and Claude Code —
  all count against the same meter.
- Practical implication for autoqq: firing `claude -p "qq"` starts the
  5-hour window immediately, before the user's real work session, so by the
  time they start working the window has already been "pre-warmed."

Sources: https://code.claude.com/docs/en/headless.md ,
https://code.claude.com/docs/en/cli-reference ,
https://code.claude.com/docs/en/authentication ,
https://www.truefoundry.com/blog/claude-code-limits-explained ,
https://bestagent.dev/claude-code-usage-limits/ ,
https://sessionwatcher.com/guides/claude-code-rate-limits-explained

---

## 2. OpenAI Codex CLI (`openai/codex`)

**Docs:** https://github.com/openai/codex , https://learn.chatgpt.com/docs/auth ,
https://developers.openai.com/codex/cli/reference

### Install
```bash
npm install -g @openai/codex
# or
brew install --cask codex
# or
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```
Binary name: **`codex`**.

### Login / auth
- Default interactive flow: run `codex` (or `codex login`) and choose
  "Sign in with ChatGPT" — opens a browser OAuth flow, usable with
  Plus/Pro/Business/Edu/Enterprise ChatGPT plans.
- API-key alternative (no browser needed, good for headless boxes):
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```
- Device-code flow for headless/remote machines without a local browser:
  ```bash
  codex login --device-auth
  ```
- Check auth state: `codex login status`. Sign out: `codex logout`.

### Non-interactive / headless invocation
```bash
codex exec --skip-git-repo-check "qq"
printf '%s\n' "qq" | codex exec -           # prompt piped via stdin (use "-" placeholder)
codex exec --ephemeral --sandbox read-only "qq"   # don't persist a session/rollout file
```
- `codex exec` is the one-shot non-interactive subcommand: runs a single
  task and exits — exactly the CI/cron-friendly primitive autoqq needs.
- `--skip-git-repo-check` is needed if invoked outside a git repo (likely,
  since autoqq just wants to ping the model, not edit code).
- `--ephemeral` avoids leaving session/rollout artifacts behind for a
  keep-alive ping that doesn't need history.
- `-s`/`--sandbox` and `-m`/`--model` are available to control execution
  permissions and model choice.

### Config / session files that indicate logged-in state (Linux)
- `~/.codex/` (override via `CODEX_HOME` env var) is the config root.
- `~/.codex/auth.json` — plaintext credentials file (access tokens); this is
  the default location when `cli_auth_credentials_store = "file"` in
  `config.toml`. Best Linux signal to check for "logged in."
  - Note: `cli_auth_credentials_store` can instead be `"keyring"` (OS
    credential store) or `"auto"` (prefers keyring, falls back to file) —
    autoqq should treat a missing `auth.json` as inconclusive if the config
    specifies keyring storage, and fall back to running `codex login status`.
- `~/.codex/config.toml` — global configuration.
- `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — per-session transcripts;
  a recently-modified rollout file is a good secondary "tool was actually
  invoked and used successfully" signal.
- `~/.codex/history.jsonl` — command/session history.

### Rate-limit window
- Codex historically enforced a **rolling 5-hour usage window** shared
  between local CLI usage and cloud tasks, plus a weekly cap, on Plus/Pro/
  Business plans. As of **July 12, 2026**, OpenAI temporarily removed the
  5-hour window for Plus/Pro/Business/ChatGPT-Work plans, leaving the
  weekly limit (and a shared credit pool) as the operative ceiling — so this
  is in flux and autoqq should not hardcode "5 hours" for Codex the way it
  can for Claude Code.
- Enterprise/Edu plans have no fixed rate limit — usage scales with
  purchased credits instead.

Sources: https://github.com/openai/codex ,
https://www.npmjs.com/package/@openai/codex ,
https://learn.chatgpt.com/docs/auth ,
https://inventivehq.com/knowledge-base/openai/where-configuration-files-are-stored ,
https://gist.github.com/alexfazio/359c17d84cb6a5af12bac88fa1db9770 ,
https://explainx.ai/blog/chatgpt-codex-5-hour-limit-removed-weekly-reset-july-2026 ,
https://github.com/openai/codex/discussions/2251

---

## 3. opencode (SST, `opencode.ai`)

**Docs:** https://opencode.ai/docs/cli/ , https://opencode.ai/docs/

### Install
```bash
curl -fsSL https://opencode.ai/install | bash
# or
npm i -g opencode-ai@latest
# or (macOS)
brew install sst/tap/opencode
```
Binary name: **`opencode`**.

### Login / auth
- `opencode auth login` — interactive provider picker; opencode is a
  provider-agnostic client (any provider listed at models.dev), so "login"
  configures API keys/OAuth per-provider rather than a single fixed auth
  flow. Flags `--provider` and `--method` can target a specific provider and
  skip the interactive picker (useful for scripting the install step).
- Credentials are written to `~/.local/share/opencode/auth.json`.

### Non-interactive / headless invocation
```bash
opencode run "qq"
opencode run --format json "qq"
```
- `opencode run <prompt>` executes a single prompt without launching the
  TUI and exits — the mechanism autoqq needs.
- `opencode serve` / `opencode web` start a long-running HTTP API/UI server
  instead — not needed for a simple keep-alive ping, but confirms opencode
  supports fully headless operation, protected by `OPENCODE_SERVER_PASSWORD`
  if used.

### Config / session files that indicate logged-in state (Linux)
- `~/.local/share/opencode/auth.json` — presence + non-empty content is the
  clearest "logged in" signal.
- Config file/dir overridable via `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`,
  or `OPENCODE_CONFIG_CONTENT` env vars — default follows XDG conventions
  under `~/.local/share/opencode/` and `~/.config/opencode/` on Linux (the
  tool's name was explicitly given by the user as an example of this
  pattern: `~/.config/opencode/`).

### Rate-limit window
- opencode itself imposes no fixed rate-limit window — it's a thin client
  over whichever provider/model you configure, so rate limits are whatever
  that upstream provider enforces (Anthropic, OpenAI, etc. via API key, or
  opencode's own **OpenCode Zen** model gateway).
- OpenCode Zen's free tier is documented as **100 requests/day**, separate
  from any host-model rate limit. Because opencode doesn't have its own
  fixed pre-warming window the way Claude Code does, the keep-alive value of
  pinging opencode on a schedule is really about pre-warming whatever
  upstream provider/API key it's configured to use.

Sources: https://opencode.ai/docs/cli/ , https://opencode.ai/docs/ ,
https://opencode.ai/docs/zen/ , https://open-code.ai/en/docs/zen ,
https://freellm.net/providers/opencode

---

## Summary table

| Tool | Install | Binary | Login | Headless one-shot | Linux auth-signal file/env | Documented rolling rate-limit window |
|---|---|---|---|---|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude` | `claude auth login` (or OAuth token via `claude setup-token`) | `claude -p "qq"` / `claude --bare -p "qq"` | `~/.claude/.credentials.json`, or `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` | **Yes** — rolling 5-hour window + rolling 7-day cap |
| Codex CLI | `npm install -g @openai/codex` | `codex` | `codex login` (browser) / `codex login --with-api-key` / `codex login --device-auth` | `codex exec "qq"` | `~/.codex/auth.json` (or OS keyring) | Was rolling 5-hour window; **temporarily removed as of 2026-07-12** for Plus/Pro/Business, weekly cap remains |
| opencode | `curl -fsSL https://opencode.ai/install \| bash` or `npm i -g opencode-ai@latest` | `opencode` | `opencode auth login` (per-provider) | `opencode run "qq"` | `~/.local/share/opencode/auth.json` | No — depends entirely on configured upstream provider (or Zen free tier: 100 req/day) |

## What this means for `autoqq`

- **Claude Code and Codex** both have a first-class, documented
  one-shot non-interactive flag (`-p`/`--print`, `codex exec`, `-p`/
  `--prompt` respectively) — these are drop-in for the cron "send one qq and
  exit" job.
- **opencode** has the same shape via `opencode run "qq"`.
- Only **Claude Code** has a clearly documented, currently-active rolling
  multi-hour rate-limit window (5 hours) that a scheduled keep-alive message
  meaningfully "pre-warms" before the user starts working — this is the
  strongest and cleanest case for `autoqq`. Codex had the same shape until
  OpenAI temporarily removed it in July 2026 (worth re-checking before
  launch, since it could return). opencode benefits similarly but
  indirectly, through whichever backing model/provider enforces limits.
