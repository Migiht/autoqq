# autoqq — Combined Research Reference

Compiled 2026-07-23. This file merges four research passes done ahead of building `autoqq`,
a Linux-only TypeScript CLI that pre-warms AI coding CLI rate-limit windows on a schedule.
Each source file is kept standalone in this `docs/` folder; this document stitches them into
one linear reference plus a cross-cutting decisions summary.

**Source files** (unchanged, kept for detailed lookup):
- [`clack-prompts.md`](./clack-prompts.md) — interactive wizard UI library
- [`ai-cli-tools.md`](./ai-cli-tools.md) — target CLIs to install/authenticate/ping (Claude Code, Codex, opencode, Gemini CLI, Aider)
- [`linux-scheduling.md`](./linux-scheduling.md) — systemd timers, timezone/DST, logging, install.sh patterns
- [`ts-cli-tooling.md`](./ts-cli-tooling.md) — arg parsing, bundling, project structure, config storage

---

## 0. Top-level architecture decisions (read this first)

| Concern | Choice | Why |
|---|---|---|
| Interactive prompts | `@clack/prompts` v1.7.0, incl. `autocomplete` / `autocompleteMultiselect` | Both exist as first-class exports, exactly matching the timezone-picker and tool-picker UX requested |
| Arg/subcommand parsing | **Commander.js** | Zero deps, ~35M weekly downloads, standard for public npm CLIs |
| Bundler | **tsdown** (tsup's maintained successor, Rolldown-based) | ESM-first, preserves shebang, matches Node 20+ LTS default |
| Package format | ESM (`"type": "module"`), `bin` → `dist/cli.js` | Required by `@clack/prompts` (ESM-only) anyway |
| Scheduler | **systemd user timers** (`~/.config/systemd/user/*.timer`) + `loginctl enable-linger` | No root needed, native reboot survival, native journald logging, DST-correct `OnCalendar=` |
| Timezone picker data | `Intl.supportedValuesOf('timeZone')` + `Intl.DateTimeFormat().resolvedOptions().timeZone` for default | Built into Node ≥18, no dependency |
| Logging | `pino` + `pino-roll`, two log files | No root-owned logrotate dependency; separate CLI log vs scheduler log as requested |
| Config storage | `conf` (→ `~/.config/autoqq/config.json`) | Atomic JSON, schema/defaults built in |
| State/log storage | `env-paths` (→ `~/.local/state/autoqq/logs/`) | XDG-correct, matches spec's own "logs belong in state" example |
| PATH detection | `which` npm package, `{ nothrow: true }` | Standard, avoids fragile shell-outs |
| Programmatic installs | spawn `npm install -g <pkg>` via `execa`, `stdio: "inherit"` | Streams real npm output instead of hanging silently |
| First target tool for the core pitch | **Claude Code** (`claude -p "qq"`) | Only tool with a clearly documented, currently-active rolling 5-hour window — the strongest case for autoqq's value prop |

**Supported tools (v1 scope): Claude Code, Codex CLI, opencode.** Gemini CLI and Aider were
researched but are out of scope and excluded from this doc set.

**Open risks to verify before/at launch:**
- clack `autocomplete` has an open upstream rendering bug ([#439](https://github.com/bombshell-dev/clack/issues/439), typed input not shown) — smoke-test on the pinned version.
- OpenAI removed Codex's rolling 5-hour window on 2026-07-12 (weekly cap remains) — re-check before promoting Codex support, this could change again.
- opencode has no rolling-window of its own — its "pre-warm" benefit is indirect (via whichever backing provider is configured), so messaging in the README should be honest about this.

---

## 1. Interactive CLI UI — `@clack/prompts`

- Current version `1.7.0`, **ESM-only**, `engines.node >= 20.12.0`. Install: `npm install @clack/prompts picocolors`.
- Confirmed exports needed by autoqq's spec: `intro`, `outro`, `text`, `confirm`, `select`, `multiselect`, `autocomplete`, `autocompleteMultiselect`, `spinner`, `note`, `log`, `tasks`, `group`, `cancel`, `isCancel`.
- `autocomplete({ message, options: {value,label,hint}[], maxItems, placeholder, initialValue, initialUserInput })` → single searchable pick, exactly the timezone picker UX (arrow nav + type-to-filter + Enter). Default filter is case-insensitive substring match across label/hint/value.
- `autocompleteMultiselect({ ..., initialValues, required })` → searchable multi-pick (tools list), `Space`/`Tab` toggles, `Enter` confirms.
- Cancellation: every prompt resolves to the value **or** a cancellation `symbol`; check with `isCancel()`, then call `cancel(msg)` + `process.exit(0)` yourself (clack does not auto-exit). Use `p.group()` to centralize this across a multi-step wizard like `autoqq init` instead of checking after every call.
- No native "orange" color — use `picocolors` for text outside clack's own prompt chrome, or raw ANSI 256 (`\x1b[38;5;208m`) for a precise orange (needed for the "this is YOUR timezone, not the server's" warning called out in the spec).
- Full type signatures, all other prompt types (`password`, `groupMultiselect`, `spinner`, `tasks`, etc.), and code examples: see [`clack-prompts.md`](./clack-prompts.md).

---

## 2. Target AI coding CLIs — install / auth / headless ping

Summary table (full per-tool detail incl. citations in [`ai-cli-tools.md`](./ai-cli-tools.md)):

| Tool | Install | Binary | Login | Headless one-shot ping | Linux auth-signal | Rolling rate-limit window |
|---|---|---|---|---|---|---|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude` | `claude auth login` (browser) or `claude setup-token` for long-lived non-interactive token | `claude -p "qq"` / `claude --bare -p "qq"` | `~/.claude/.credentials.json`, or `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` env | **Yes — rolling 5h + rolling 7-day cap**, starts from first prompt |
| **Codex CLI** | `npm install -g @openai/codex` | `codex` | `codex login` (browser) / `--with-api-key` / `--device-auth` | `codex exec --skip-git-repo-check "qq"` | `~/.codex/auth.json` (or OS keyring) | Was rolling 5h, **removed 2026-07-12** for Plus/Pro/Business; weekly cap remains |
| **opencode** | `curl -fsSL https://opencode.ai/install \| bash` or `npm i -g opencode-ai@latest` | `opencode` | `opencode auth login` (per-provider) | `opencode run "qq"` | `~/.local/share/opencode/auth.json` | No own window — inherits configured provider (or Zen free tier: 100 req/day) |

Key implementation notes for `autoqq install <tool>`:
- Detection → auth → verify → schedule, per the spec's flow. Use `which` to detect the binary; for Claude/Codex prefer running the real login flow interactively then verifying via each tool's status command or credential file; for opencode check `auth.json`.
- All three tools support a genuine one-shot non-interactive invocation that runs to completion and exits — this is the mechanism the scheduler calls. Claude Code and Codex additionally support `--bare`/`--ephemeral` flags to skip unnecessary session/hook overhead for a pure keep-alive ping.

---

## 3. Scheduling architecture (Linux, always-on server)

Full detail with unit-file examples in [`linux-scheduling.md`](./linux-scheduling.md). Key points:

- **systemd user timers** over cron or an in-process Node scheduler: get free reboot catch-up (`Persistent=true`), no-double-fire guarantees, fleet jitter (`RandomizedDelaySec=`), and zero idle resource use (vs. a resident Node process). Install path: `~/.config/systemd/user/*.service` + `*.timer`, activated via `systemctl --user enable --now`.
- **`loginctl enable-linger "$USER"` is mandatory** — without it, user timers stop firing the moment the installing SSH session ends. This is the single most commonly-missed step and must be part of `autoqq init`.
- Two timers needed per the product spec: one for the daily "start the window" ping at the user's configured start time, one for the "renewal" ping N-hours-minus-buffer later (the spec's 5h window / keep 2h logic). Model the renewal either as a second `OnCalendar=`-style timer computed at config time, or via `OnUnitActiveSec=` chaining from the first job — needs to account for the exact "leave 2h" cool-down math from the product spec.
- Let systemd's own `OnCalendar=` engine handle the user's IANA timezone and DST — it's natively DST-aware once the timer inherits the correct TZ. Use `Intl.supportedValuesOf('timeZone')` (Node ≥18) purely to populate the `autocomplete` timezone picker at setup time, with `Intl.DateTimeFormat().resolvedOptions().timeZone` as the pre-filled default (satisfies "Enter picks current system timezone").
- Logging: `pino` for both the CLI log and the scheduler/service log, `pino-roll` for rotation (self-contained, no root-owned `/etc/logrotate.d` dependency). Store at `~/.local/state/autoqq/logs/cli.log` and `.../logs/scheduler.log` (XDG state dir — the spec explicitly names logs as its own worked example of what belongs there).
- `install.sh` should follow the bun/deno/rustup pattern: `set -euo pipefail`, detect Node presence/version (not OS/arch, since npm packages are architecture-agnostic), `npm install -g autoqq`, verify `PATH`, then hand off to `autoqq init` to install the systemd units and run `enable-linger`.

---

## 4. TypeScript CLI implementation baseline

Full detail in [`ts-cli-tooling.md`](./ts-cli-tooling.md). Key points:

- **Commander.js** for `autoqq init` / `autoqq install <tool>` (single positional arg, max 1 per the spec) — lazy `import()` each command module from the action handler to keep startup fast.
- **tsdown** to bundle `src/cli.ts` → `dist/cli.js`, `format: "esm"`, `platform: "node"`, shebang preserved automatically. `package.json`: `"type": "module"`, `bin: { autoqq: "./dist/cli.js" }`, `engines.node >= 20.12` (matches clack's floor).
- Project layout: `src/cli.ts` (thin entry) → `src/commands/{init,install,scheduler}.ts` → `src/lib/{config,tools/,process,logger}.ts` → `src/utils/`.
- Binary detection via the `which` npm package (`nothrow: true`); global installs via `execa("npm", ["install", "-g", pkg], { stdio: "inherit" })` so the user sees real npm progress/errors.
- Config via `conf` (→ `~/.config/autoqq/config.json`, schema + defaults built in); state/logs via `env-paths` (→ `~/.local/state/autoqq`), consistent with the scheduling doc's XDG guidance.

---

## 5. Mapping to the product spec's `autoqq init` wizard steps

1. **Timezone** — `autocomplete()` over `Intl.supportedValuesOf('timeZone')`, default = `Intl.DateTimeFormat().resolvedOptions().timeZone`, manual entry (e.g. `+3`) validated via `Intl.DateTimeFormat` construction (catch `RangeError`), orange warning text via raw ANSI 256 that this is the **user's** timezone, not the server's.
2. **Rate-limit window hours** — `text()` prompt, default `5`.
3. **Work start time** — `text()` prompt, default `8:00`, interpreted in the timezone from step 1.
4. **Hours-remaining-to-leave threshold** — `text()` prompt, default `2` (drives the renewal-timer math in §3).
5. **Custom greeting message** — `text()` prompt, default the built-in `"qq"` message.
6. All wrapped in a single `p.group()` for centralized cancel handling, then written to `conf` config, then systemd units generated/installed + `loginctl enable-linger` run.

Then `autoqq install <tool>` (max 1 arg) per §2 above: detect → offer install → run login → verify via tool-specific signal → register the scheduled ping for that tool, repeatable per tool.
