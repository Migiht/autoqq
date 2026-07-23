# autoqq — All Research Docs (merged)

Merged via bash cat on 2026-07-23. Individual files remain in this folder.


<!-- ============================================================ -->
<!-- SOURCE FILE: RESEARCH.md -->
<!-- ============================================================ -->

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


<!-- ============================================================ -->
<!-- SOURCE FILE: clack-prompts.md -->
<!-- ============================================================ -->

# @clack/prompts Research Notes

Research for `autoqq`'s interactive setup wizard (`autoqq init`, `autoqq install <tool>`). Compiled 2026-07-23.

Sources:
- npm: https://www.npmjs.com/package/@clack/prompts
- GitHub monorepo: https://github.com/bombshell-dev/clack
- Package source: https://github.com/bombshell-dev/clack/tree/main/packages/prompts
- Docs site: https://bomb.sh/docs/clack/packages/prompts
- CHANGELOG: https://github.com/bombshell-dev/clack/blob/main/packages/prompts/CHANGELOG.md
- README: https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md

---

## 1. Version, install, runtime requirements

- **Current version**: `1.7.0` (published ~19 days before 2026-07-23, per npm search results).
- **Module format**: ESM-only. `package.json` has `"type": "module"`, and the `exports` field only publishes `.mjs`/`.d.mts` — there is **no CommonJS build**. `autoqq` must be an ESM package (or use dynamic `import()` from CJS) to consume it.
- **Node version**: `engines.node: ">= 20.12.0"`. This is a hard floor — worth calling out in autoqq's own `engines` field and README since we're Linux-only tooling likely running on developer/CI machines.
- **Dependencies** (all bundled/transitive, no need to hand-manage): `@clack/core`, `fast-string-width`, `fast-wrap-ansi`, `sisteransi`.
- **Install**:

```bash
npm install @clack/prompts
# or
pnpm add @clack/prompts
# or
yarn add @clack/prompts
```

- **License**: MIT.
- Monorepo layout: `@clack/core` (headless/unstyled primitives) + `@clack/prompts` (pre-styled, opinionated components built on core, "80% smaller" than comparable libraries per its own docs framing). autoqq should only need `@clack/prompts`; `@clack/core` is only relevant if we ever need a fully custom prompt type.

---

## 2. Full list of prompt/utility exports

Confirmed present in `@clack/prompts` v1.7.0 (from source tree + docs):

| Category | Exports |
|---|---|
| Session framing | `intro`, `outro`, `cancel` |
| Cancellation | `isCancel` |
| Text input | `text`, `password`, `multiline` |
| Boolean | `confirm` |
| Single choice | `select`, `selectKey` |
| Multiple choice | `multiselect`, `groupMultiselect` |
| Searchable single choice | `autocomplete` |
| Searchable multiple choice | `autocompleteMultiselect` |
| Specialized pickers | `date`, `path` (file/dir picker built on autocomplete) |
| Feedback / output | `note`, `log` (with `.info/.success/.step/.warn/.error/.message`, plus a `stream` variant), `taskLog` |
| Async / progress | `spinner`, `progress`, `tasks` |
| Composition | `group` (sequential prompt orchestration with shared `onCancel`) |

**All prompts requested by autoqq exist**, including the two we were unsure about — see §3.

---

## 3. `autocomplete` and `autocompleteMultiselect` — confirmed real, not deprecated/experimental

These are **not community add-ons** — they ship directly in `@clack/prompts`, built on a first-class `AutocompletePrompt` class in `@clack/core`. Verified directly against source: `packages/prompts/src/autocomplete.ts`.

History (from CHANGELOG.md):
- Introduced together in an early `1.0.0`-era release: *"Add `AutocompletePrompt` to core with comprehensive tests and implement both `autocomplete` and `autocomplete-multiselect` components."*
- `1.0.1`: disabled options can no longer be selected; line-wrapping fixes.
- `1.2.0`: `placeholder` option added (Tab copies placeholder into the input when input is empty); `withGuide: false` respected.
- `1.4.0`: wrapping support for long option lists.
- `1.5.0`: Standard Schema (`validate`) support.
- `1.6.0`: keyboard instruction footers added.
- `1.7.0` (current): `showInstructions` option added to `select`/`multiselect`/`groupMultiselect` (not autocomplete-specific, but same release train). `required` option and a custom `filter` function were also added to `autocompleteMultiselect` for cases like fuzzy search.

There is a currently-open bug worth being aware of before we build on it: **[Issue #439](https://github.com/bombshell-dev/clack/issues/439)** — "user input not displayed while typing (only placeholder shown)" in `autocomplete`. Worth pinning/testing against before relying on it in `autoqq init`.

### Exact type signatures (from source)

Shared base (both `autocomplete` and `autocompleteMultiselect` extend this):

```typescript
interface AutocompleteSharedOptions<Value> extends CommonOptions {
  message: string;

  // Static array, OR a function for dynamic/computed option lists.
  // `this` inside the function is the underlying AutocompletePrompt instance,
  // so it can be re-invoked whenever the search text changes.
  options: Option<Value>[] | ((this: AutocompletePrompt<Option<Value>>) => Option<Value>[]);

  maxItems?: number;        // visible window size for the option list
  placeholder?: string;     // shown when search input is empty; Tab copies it into input
  validate?: Validate<Value | Value[]>; // fn or Standard Schema; return string|Error to reject
  filter?: (search: string, option: Option<Value>) => boolean; // custom match logic (e.g. fuzzy)
}
```

`Option<Value>` (from `select.ts`, reused by autocomplete):

```typescript
interface Option<Value> {
  value: Value;
  label?: string;   // defaults to String(value) if omitted
  hint?: string;
  disabled?: boolean;
}
```

**`autocomplete`** — single selection:

```typescript
export interface AutocompleteOptions<Value> extends AutocompleteSharedOptions<Value> {
  initialValue?: Value;       // pre-selected option
  initialUserInput?: string;  // pre-filled search text
}

export const autocomplete = <Value>(opts: AutocompleteOptions<Value>) => Promise<Value | symbol>;
```

**`autocompleteMultiselect`** — multiple selection:

```typescript
export interface AutocompleteMultiSelectOptions<Value> extends AutocompleteSharedOptions<Value> {
  initialValues?: Value[];
  required?: boolean;   // default false; if true, must select ≥1 or validation fails
}

export const autocompleteMultiselect = <Value>(
  opts: AutocompleteMultiSelectOptions<Value>
) => Promise<Value[] | symbol>;
```

### Default filter behavior

If no custom `filter` is supplied, matching is case-insensitive substring match across **label, hint, and value** simultaneously (from source):

```typescript
function getFilteredOption<T>(searchText: string, option: Option<T>): boolean {
  if (!searchText) return true;
  const label = (option.label ?? String(option.value ?? '')).toLowerCase();
  const hint = (option.hint ?? '').toLowerCase();
  const value = String(option.value).toLowerCase();
  const term = searchText.toLowerCase();
  return label.includes(term) || hint.includes(term) || value.includes(term);
}
```

### Keyboard/interaction behavior (from source's rendered instruction footers)

- `autocomplete`: `↑/↓` to select, `Enter` to confirm, typing filters live.
- `autocompleteMultiselect`: `↑/↓` to navigate, `Space`/`Tab` to toggle-select the focused item (label changes to "Tab: select" while actively typing a search vs "Space/Tab: select" while navigating), `Enter` to confirm, typing filters live. Selected items render with a filled checkbox glyph; unmatched search shows "No matches found" in yellow.

### Code examples

```typescript
import { autocomplete, autocompleteMultiselect } from '@clack/prompts';

// Single-select searchable list
const framework = await autocomplete({
  message: 'Search for a framework',
  options: [
    { value: 'next', label: 'Next.js', hint: 'React framework' },
    { value: 'astro', label: 'Astro', hint: 'Content-focused' },
    { value: 'svelte', label: 'SvelteKit', hint: 'Compile-time framework' },
    { value: 'remix', label: 'Remix', hint: 'Full stack framework' },
    { value: 'nuxt', label: 'Nuxt', hint: 'Vue framework' },
  ],
  placeholder: 'Type to search...',
  maxItems: 5,
});

// Multi-select searchable list, with a required selection
const tools = await autocompleteMultiselect({
  message: 'Select tools to install',
  options: [
    { value: 'eslint', label: 'ESLint', hint: 'lint' },
    { value: 'prettier', label: 'Prettier', hint: 'format' },
    { value: 'vitest', label: 'Vitest', hint: 'test runner' },
  ],
  placeholder: 'Type to search...',
  maxItems: 5,
  required: true,
});
```

**Verdict for autoqq**: these are exactly what we want for a tool picker in `autoqq init` — no need to reach for `enquirer` / `inquirer-autocomplete-prompt` or hand-roll a filtered `select`. Use `autocomplete`/`autocompleteMultiselect` directly.

---

## 4. Other prompt types (signatures + examples)

### `intro` / `outro`

```typescript
intro(title?: string, opts?: CommonOptions): void
outro(message?: string, opts?: CommonOptions): void
```

```typescript
import { intro, outro } from '@clack/prompts';

intro('autoqq init');
// ...prompts...
outro("You're all set!");
```

### `text`

```typescript
text(opts: {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (value: string) => string | Error | undefined;
}): Promise<string | symbol>
```

### `password`

```typescript
password(opts: {
  message: string;
  mask?: string;       // default: '▪'
  validate?: (value: string) => string | Error | undefined;
}): Promise<string | symbol>
```

### `confirm`

```typescript
confirm(opts: {
  message: string;
  active?: string;     // label for "true", default "Yes"
  inactive?: string;    // label for "false", default "No"
  initialValue?: boolean;
}): Promise<boolean | symbol>
```

```typescript
const shouldContinue = await confirm({ message: 'Proceed with install?' });
```

### `select`

```typescript
select<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label?: string; hint?: string; disabled?: boolean }>;
  initialValue?: Value;
  maxItems?: number;
}): Promise<Value | symbol>
```

### `multiselect`

```typescript
multiselect<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label?: string; hint?: string; disabled?: boolean }>;
  initialValues?: Value[];
  required?: boolean;     // default false
  cursorAt?: Value;
}): Promise<Value[] | symbol>
```

```typescript
const tools = await multiselect({
  message: 'Select tools to install',
  options: [
    { value: 'eslint', label: 'ESLint' },
    { value: 'prettier', label: 'Prettier' },
  ],
  required: true,
});
```

### `groupMultiselect`

```typescript
groupMultiselect<Value>(opts: {
  message: string;
  options: Record<string, Array<{ value: Value; label?: string; hint?: string }>>;
  selectableGroups?: boolean;
  groupSpacing?: number;
  required?: boolean;
}): Promise<Value[] | symbol>
```

```typescript
const selections = await groupMultiselect({
  message: 'Pick your stack',
  options: {
    'Linters': [{ value: 'eslint', label: 'ESLint' }],
    'Formatters': [{ value: 'prettier', label: 'Prettier' }],
  },
});
```

### `spinner`

```typescript
spinner(opts?: SpinnerOptions): {
  start(message?: string): void;
  stop(message?: string, code?: number): void;
  message(message?: string): void;
  error?(message?: string): void;
  isCancelled?: boolean;
}
```

```typescript
const s = spinner();
s.start('Installing dependencies');
await installDeps();
s.stop('Dependencies installed');
```

### `note`

```typescript
note(message?: string, title?: string): void
```

### `log`

```typescript
log.info(message: string): void
log.success(message: string): void
log.warn(message: string): void
log.error(message: string): void
log.step(message: string): void
log.message(message: string, opts?): void
```

```typescript
import { log } from '@clack/prompts';

log.info('Checking for existing config...');
log.success('Config written to autoqq.config.json');
log.warn('No package.json found — creating one');
log.error('Failed to install tool: permission denied');
```

### `tasks`

```typescript
tasks(tasks: Array<{
  title: string;
  task: (message: (msg: string) => void) => string | Promise<string>;
  enabled?: boolean;
}>): Promise<void>
```

```typescript
await tasks([
  {
    title: 'Installing ESLint',
    task: async (message) => {
      message('Resolving version...');
      await installTool('eslint');
      return 'ESLint installed';
    },
  },
]);
```

### `group`

Runs a set of prompts sequentially, threading prior answers into later prompt functions via `{ results }`, with a single shared cancel handler.

```typescript
group<T>(
  prompts: { [K in keyof T]: (ctx: { results: Partial<T> }) => Promise<T[K] | symbol> },
  opts?: { onCancel?: (ctx: { results: Partial<T> }) => void }
): Promise<T>
```

```typescript
import * as p from '@clack/prompts';

const answers = await p.group(
  {
    name: () => p.text({ message: 'What is your name?' }),
    age: () => p.text({ message: 'What is your age?' }),
    tools: ({ results }) =>
      p.multiselect({
        message: `Tools for ${results.name}?`,
        options: [{ value: 'eslint', label: 'ESLint' }],
      }),
  },
  {
    onCancel: ({ results }) => {
      p.cancel('Operation cancelled.');
      process.exit(0);
    },
  }
);
```

---

## 5. Cancellation handling

Every prompt call resolves to either the value the user entered, or a special `symbol` if the user cancels (Ctrl+C). `isCancel()` is a type guard for that symbol. The standard pattern (from the official README):

```typescript
import { intro, outro, isCancel, cancel, text } from '@clack/prompts';

intro('create-my-app');

const value = await text({ message: 'What is the meaning of life?' });

if (isCancel(value)) {
  cancel('Operation cancelled.');
  process.exit(0);
}

outro("You're all set!");
```

Key points for autoqq:
- Check `isCancel(result)` **after every individual prompt call** unless using `group()`, which centralizes cancellation via a single `onCancel` handler (see §4 `group` example) — much less boilerplate for multi-step flows like `autoqq init`.
- `cancel(message)` prints a styled cancellation message; it does **not** exit the process — you must call `process.exit(0)` yourself afterward. This is a deliberate design choice so library consumers control exit codes/cleanup.
- Prompts also support a `signal?: AbortSignal` option on `CommonOptions` for programmatic cancellation (e.g. wiring to `SIGINT`/timeout logic beyond the built-in Ctrl+C handling).

---

## 6. Theming / colorizing text

`@clack/prompts` v1.7.0 has moved to Node's built-in `node:util` `styleText` internally (seen directly in the `autocomplete.ts` source: `import { styleText } from 'node:util';`) rather than bundling its own color library — this is itself useful to know, since it means clack's own internal rendering requires Node's `styleText` (stable since Node 20.12, matching the package's `engines` floor).

For autoqq's **own** custom output (banners, extra hints, orange-colored text, etc. that isn't inside clack's built-in prompt chrome), pair clack with `picocolors` — it's the de facto standard lightweight color lib used across the JS tooling ecosystem (Vite, Next.js, etc.) and composes cleanly with clack's own escape sequences since both target ANSI.

```bash
npm install picocolors
```

```typescript
import color from 'picocolors';
import { note, log, select } from '@clack/prompts';

// picocolors has no built-in "orange" — compose using its available palette
// (red/yellow/bright variants) or use raw ANSI 256-color codes if a precise
// orange is required, e.g.:
const orange = (text: string) => `\x1b[38;5;208m${text}\x1b[0m`;

note(`${color.cyan('autoqq')} will install: ${orange('eslint, prettier')}`);

log.info(`Detected ${color.bold('Node 20.12.0')}`);

const tool = await select({
  message: 'Pick a tool',
  options: [
    { value: 'eslint', label: 'ESLint', hint: color.dim('recommended') },
  ],
});
```

Notes:
- `option.hint` strings passed into `select`/`multiselect`/`autocomplete` are auto-dimmed by clack's own renderer (wrapped in `styleText('dim', ...)`), so you generally do **not** need to pre-colorize hints yourself — doing so can double-wrap escape codes. Only use picocolors for text rendered *outside* clack's prompt components (via `note`, `log`, or plain `console.log`/`process.stdout.write`).
- picocolors has no native "orange" function; use ANSI 256 (`\x1b[38;5;208m`) or an RGB truecolor escape if the brand needs a specific orange, as shown above.

---

## 7. Summary for autoqq implementation

- Add `"@clack/prompts": "^1.7.0"` and `"picocolors": "^1"` as dependencies; keep autoqq's `package.json` as `"type": "module"` and set `"engines": { "node": ">=20.12.0" }` to match clack's floor.
- Use `autocomplete` for single-tool search/select flows and `autocompleteMultiselect` (with `required: true` where appropriate) for multi-tool install flows in `autoqq init` / `autoqq install`.
- Wrap the whole `init` flow in `p.group()` with a single `onCancel` for clean Ctrl+C handling instead of checking `isCancel()` after every prompt.
- Use `spinner()` / `tasks()` around actual install work (network calls, package manager invocations), and `log.*` / `note` for status messages, reserving picocolors only for text outside clack's own components.
- Before shipping, smoke-test `autocomplete` against known bug [#439](https://github.com/bombshell-dev/clack/issues/439) (typed input not rendering, only placeholder shown) on the pinned version.


<!-- ============================================================ -->
<!-- SOURCE FILE: ai-cli-tools.md -->
<!-- ============================================================ -->

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


<!-- ============================================================ -->
<!-- SOURCE FILE: linux-scheduling.md -->
<!-- ============================================================ -->

# Linux Scheduling & Service Architecture for autoqq

Research notes for implementing autoqq's daily-message and renewal-message scheduling on
"always-on" Linux servers, distributed as an npm-installed CLI plus a `curl | sh` installer.

Every claim below is sourced. Where a source uses a code/config example, the example is
reproduced verbatim (or lightly trimmed) so it can be adapted directly.

---

## 1. systemd user timers vs system timers vs cron vs an in-process Node scheduler

### Architectural difference: systemd timers vs cron

- systemd timers split "what to run" (a `.service` unit) from "when to run it" (a `.timer`
  unit), whereas cron mixes schedule and command in one crontab line.
  ([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))
- "Systemd timer and service units do not need to be installed at the system level; instead,
  they can be installed per user in `~/.config/systemd/user/` and run within the user service
  manager." ([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

### Cron: pros / cons

**Pros**: extremely simple, preinstalled almost everywhere including non-systemd systems
(BSD, macOS, minimal containers), universally understood syntax.
([xtom.com](https://xtom.com/blog/systemd-vs-cron-linux-task-scheduling/),
[cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

**Cons**: weak logging (mail-based or silently swallowed output), no resource control, no
overlap protection (a slow job can double-fire), no built-in catch-up after downtime, and
only minute-level scheduling granularity.

### systemd timers: pros / cons

**Pros**, per [`systemd.timer(5)`](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)
and comparative writeups:

- `RandomizedDelaySec=` spreads a fleet of installs' fire times to avoid a thundering herd.
- Monotonic timers (`OnUnitActiveSec=`) fire relative to when the unit last *finished*, not
  wall-clock time — useful for "N hours after the previous run" style jobs.
- Sub-second precision available via `AccuracySec=` (default is 1 minute, coalesced for power
  efficiency; can be tightened to `1us`).
- Every timer-triggered job is a normal systemd **service**, so it inherits cgroup-based
  resource limits (CPU/memory/IO) and centralized `journald` logging for free.
  ([trstringer.com](https://trstringer.com/systemd-timer-vs-cronjob/))
- "Systemd timers guarantee that only one instance of a task is in execution at any given
  moment, and if a task takes longer than expected, systemd ensures the subsequent scheduled
  instance waits patiently." ([trstringer.com](https://trstringer.com/systemd-timer-vs-cronjob/))
- `Persistent=true` — from the man page: "If true, the time when the service unit was last
  triggered is stored on disk... upon timer activation, the service triggers immediately if
  it would have fired during inactive periods" — i.e. it catches up a missed daily run if the
  server was down/rebooting at the scheduled time.
  ([man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html))
- Timer units automatically depend on `time-set.target` / `time-sync.target`, so a calendar
  timer won't fire using a wrong system clock before NTP sync.
  ([man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html))
- `OnTimezoneChange=` / `OnClockChange=` can re-trigger evaluation if the local timezone or
  clock is changed underneath a running timer.

**Cons**: more setup boilerplate — two unit files instead of one crontab line — and it is
Linux/systemd-specific (a non-issue since autoqq is explicitly Linux-only).
([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

### In-process Node scheduler that daemonizes itself (node-cron / node-schedule)

Not recommended as the primary mechanism, because:

- The Node process itself must survive reboots and crashes — which means you still need a
  process supervisor (systemd, pm2, etc.) wrapping it, making the in-process scheduler an
  *addition* on top of systemd rather than a replacement for it.
- It must stay resident in memory 24/7 just to wait for the next tick, vs. a systemd
  `Type=oneshot` service that consumes zero resources between scheduled runs.
- Reboot-survival, log rotation, resource isolation, and crash-restart semantics (`Restart=`)
  all have to be hand-rolled in JavaScript instead of being free properties of the OS's init
  system.

### Recommendation

> "New production services on modern Linux should default to systemd timers, while for
> personal scripts and anything where you need portability or quick setup, cron is still
> perfectly fine." ([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

For an enterprise, thousands-of-users, self-hosted CLI installed per-user on always-on Linux
servers: **systemd user timers** are the idiomatic modern approach — no root required to
install, native reboot survival (with lingering, see §2), native structured logging via
`journald`, automatic catch-up via `Persistent=true`, and no need to keep a Node process
resident between runs.

**Sources**: [cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html),
[trstringer.com](https://trstringer.com/systemd-timer-vs-cronjob/),
[xtom.com](https://xtom.com/blog/systemd-vs-cron-linux-task-scheduling/),
[man7.org — systemd.timer(5)](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)

---

## 2. How other tools install systemd user units, and `loginctl enable-linger`

### Real-world unit file: Syncthing (user mode)

Syncthing ships a ready-to-use **user-mode** service unit at
`etc/linux-systemd/user/syncthing.service` in its repo
([github.com/syncthing/syncthing](https://github.com/syncthing/syncthing/blob/main/etc/linux-systemd/user/syncthing.service)):

```ini
[Unit]
Description=Syncthing - Open Source Continuous File Synchronization
Documentation=man:syncthing(1)
StartLimitIntervalSec=60
StartLimitBurst=4

[Service]
Environment="STLOGFORMATTIMESTAMP="
Environment="STLOGFORMATLEVELSTRING=false"
Environment="STLOGFORMATLEVELSYSLOG=true"
ExecStart=/usr/bin/syncthing serve --no-browser --no-restart
Restart=on-failure
RestartSec=1
SuccessExitStatus=3 4
RestartForceExitStatus=3 4
# Hardening
SystemCallArchitectures=native
MemoryDenyWriteExecute=true
NoNewPrivileges=true
#AmbientCapabilities=CAP_CHOWN CAP_FOWNER

[Install]
WantedBy=default.target
```

Note the `[Install] WantedBy=default.target` — this is the correct target for **user**-mode
units (system-mode units instead target `multi-user.target`).

Documented install steps
([docs.syncthing.net](https://docs.syncthing.net/v1.0.0/users/autostart.html)): copy the unit
to `~/.config/systemd/user/`, then:

```bash
systemctl --user enable syncthing.service
systemctl --user start syncthing.service
systemctl --user status syncthing.service
```

### npm package pattern: `add-to-systemd`

[`mafintosh/add-to-systemd`](https://github.com/mafintosh/add-to-systemd) (installable via
`npm install -g add-to-systemd`) demonstrates the **templated-unit-file** pattern commonly
used by Node tooling. Its bundled `template.service`:

```ini
[Unit]
After={after}
{unit-options}
[Service]
ExecStart={command}
Restart=always
{service-options}
[Install]
WantedBy=multi-user.target
```

The CLI parses flags (`--user`, `--cwd`, `--nice`, `--env`, custom `--option` pairs) with
`minimist`, defaults `After=` to `syslog.target network.target remote-fs.target
nss-lookup.target`, substitutes the template placeholders, writes the result to
`/etc/systemd/system/[name].service` (system-level in this tool's case), then calls
`systemctl enable` and reloads the daemon. An autoqq installer should mirror this
templated-unit + `systemctl` pattern but write to `~/.config/systemd/user/` and use
`systemctl --user` throughout, so no root is required.

### Backup-tool pattern: restic / litestream

Community `.service`/`.timer` pairs for restic
([larsks/restic-systemd-units](https://github.com/larsks/restic-systemd-units),
[cdroege/systemd-restic-simple](https://github.com/cdroege/systemd-restic-simple)) and
Litestream's official guide ([litestream.io/guides/systemd](https://litestream.io/guides/systemd/))
both install at the **system** level (`/etc/systemd/system/`, requiring `sudo`), driven by
`systemctl daemon-reload` / `systemctl restart`. This is a useful contrast: those tools assume
a dedicated system service account, whereas autoqq — installed per human user to act on their
behalf — fits the **user**-level model (Syncthing's pattern) much better.

### `loginctl enable-linger`

This is the load-bearing detail for "survives reboot / works on a headless always-on server":

> "The `loginctl enable-linger` command tells systemd to keep your user services running even
> when no login session exists. By default, systemd user services only run while a login
> session exists (`Linger=no`)."
> ([oneuptime.com](https://oneuptime.com/blog/post/2026-03-17-use-loginctl-enable-linger-rootless-podman/view))

> "On a headless Ubuntu server, created systemd user services will stop working when the SSH
> session ends unless `loginctl enable-linger` has been configured... [Lingering] tells
> systemd to start your user manager at boot and keep it running after logout."
> ([akmatori.com](https://akmatori.com/blog/systemd-user-units))

Without lingering, an autoqq user timer installed over SSH would stop firing the instant the
installing SSH session ends, and would only resume the next time that user logs in
interactively — unacceptable for a daily scheduled job on an unattended server. **The autoqq
installer must run `loginctl enable-linger` as part of setup.**

Exact commands:

```bash
loginctl enable-linger                 # enable for the current user
sudo loginctl enable-linger username   # enable for another user (requires root)
loginctl show-user "$USER" --property=Linger   # verify — should print "Linger=yes"
```

### Full install sequence for autoqq (composited pattern)

```bash
mkdir -p ~/.config/systemd/user
cp autoqq.service autoqq.timer ~/.config/systemd/user/
cp autoqq-renewal.service autoqq-renewal.timer ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now autoqq.timer
systemctl --user enable --now autoqq-renewal.timer
systemctl --user list-timers

loginctl enable-linger "$USER"   # required for headless/server persistence
```

**Sources**:
[github.com/syncthing/syncthing/.../syncthing.service](https://github.com/syncthing/syncthing/blob/main/etc/linux-systemd/user/syncthing.service),
[docs.syncthing.net/v1.0.0/users/autostart.html](https://docs.syncthing.net/v1.0.0/users/autostart.html),
[github.com/mafintosh/add-to-systemd](https://github.com/mafintosh/add-to-systemd),
[github.com/larsks/restic-systemd-units](https://github.com/larsks/restic-systemd-units),
[litestream.io/guides/systemd](https://litestream.io/guides/systemd/),
[oneuptime.com](https://oneuptime.com/blog/post/2026-03-17-use-loginctl-enable-linger-rootless-podman/view),
[akmatori.com/blog/systemd-user-units](https://akmatori.com/blog/systemd-user-units)

---

## 3. Timezone handling in Node.js

### Enumerating IANA timezones: `Intl.supportedValuesOf('timeZone')`

`Intl.supportedValuesOf()` "returns an array containing the supported calendar, collation,
currency, numbering systems, or unit values supported by the implementation." It was added in
Node.js 18 (sourced from V8 v9.9), and works from Node 14.18+.
([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf))

```js
const zones = Intl.supportedValuesOf('timeZone');
// -> ["Africa/Abidjan", "Africa/Accra", ..., "UTC", ...]  (~428 IANA identifiers)
```

Known limitation: the list is not guaranteed exhaustive — a system's `TZ` env var can
validly reference a zone not present in this array's output. Tracked upstream at
[nodejs/node#43678](https://github.com/nodejs/node/issues/43678). For autoqq, use this API to
populate a timezone picker/autocomplete during setup, but don't hard-reject a manually-typed
value that fails to appear in the list — validate instead by constructing an
`Intl.DateTimeFormat` with the candidate zone and catching the thrown `RangeError`.

### Detecting the user's current timezone

```js
Intl.DateTimeFormat().resolvedOptions().timeZone; // e.g. "America/Sao_Paulo"
```
(standard `Intl` behavior, used as the sensible default to pre-fill during `autoqq init`.)

### Scheduling libraries and their timezone/DST behavior

**`cron-parser`** ([npmjs.com/package/cron-parser](https://www.npmjs.com/package/cron-parser)):
provides timezone support "using Luxon, handling DST transitions correctly," via a `tz` option:

```js
import { CronExpressionParser } from 'cron-parser';

const options = {
  currentDate: '2023-03-26T01:00:00',
  tz: 'Europe/London',
};

const interval = CronExpressionParser.parse('0 * * * *', options);
console.log(interval.next().toString());
console.log(interval.next().toString());
console.log(interval.next().toString());
```
This steps correctly through the UK's March 26 2023 spring-forward transition without manual
adjustment, because the underlying date math runs through Luxon's timezone-aware `DateTime`.

**`node-cron`** ([github.com/node-cron/node-cron](https://github.com/node-cron/node-cron)):
timezone is a scheduling option:

```js
const task = cron.schedule('0 3 * * *', doWork, {
  name: 'nightly-backup',
  timezone: 'America/Sao_Paulo',
});
```
"Schedules match wall-clock time in the task's timezone." Documented DST caveat: across a
fall-back transition, the repeated hour runs only once, so a sub-hourly schedule (e.g.
`*/15`) can pause for up to the length of the DST shift during that hour; the docs recommend
`timezone: 'UTC'` if a fixed interval must never pause.

**`node-schedule`** ([github.com/node-schedule/node-schedule](https://github.com/node-schedule/node-schedule)):
timezone set on a `RecurrenceRule`:

```js
const rule = new schedule.RecurrenceRule();
rule.hour = 0;
rule.minute = 0;
rule.tz = 'Etc/UTC';

const job = schedule.scheduleJob(rule, function () {
  console.log('A new day has begun in the UTC timezone!');
});
```
Valid `tz` values are standard [tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
identifiers. The README does not document explicit DST edge-case guarantees.

**Croner** ([croner.56k.guru](https://croner.56k.guru/),
[github.com/Hexagon/croner](https://github.com/hexagon/croner)):

```js
new Cron('2024-01-23T00:00:00', { timezone: 'Asia/Kolkata' }, () => {
  console.log('Yay!');
});
```
Zero runtime dependencies (resolves timezones via the native `Intl` API rather than an
external datetime library). Explicit, well-documented DST semantics:
- **Spring-forward (gap)**: "Jobs scheduled during DST gaps are skipped" — a wall-clock time
  that never occurs is simply not run.
- **Fall-back (overlap)**: "Jobs in DST overlaps run once at first occurrence" — a wall-clock
  time that occurs twice fires only once, preventing an accidental double-send.

### Comparison and recommendation for autoqq

| Library | TZ engine | DST gap (spring-fwd) | DST overlap (fall-back) |
|---|---|---|---|
| cron-parser | Luxon | handled via Luxon | handled via Luxon |
| node-cron | native `Intl`/JS `Date` | not explicitly documented | repeated hour runs once; can pause sub-hourly schedules |
| node-schedule | native `Intl`/JS `Date` | not documented | not documented |
| Croner | native `Intl`, zero deps | explicitly skipped | explicitly fires once |

Because autoqq's two jobs are **once-per-day, specific-wall-clock-time** triggers (not
sub-hourly), the DST-overlap "fires twice" failure mode is the one that actually matters — a
naive implementation could send the daily message twice on the one day per year that 1:00 AM
happens twice. **Croner's explicit "fire once on overlap" guarantee**, combined with zero
external dependencies, makes it the strongest fit if scheduling is computed in-process (e.g.
to render an `OnCalendar=` expression, or to compute one-shot fire times for a
`systemd-run --user --on-calendar` style transient timer). If autoqq instead generates a
systemd `OnCalendar=` timer directly (recommended primary path, see §1–2), systemd's own
calendar-time engine already resolves local-time-in-a-given-TZ correctly including DST,
since a `.timer` unit inherits the system/user timezone.

**Sources**:
[MDN — Intl.supportedValuesOf](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf),
[nodejs/node#43678](https://github.com/nodejs/node/issues/43678),
[npmjs.com/package/cron-parser](https://www.npmjs.com/package/cron-parser),
[github.com/node-cron/node-cron](https://github.com/node-cron/node-cron),
[github.com/node-schedule/node-schedule](https://github.com/node-schedule/node-schedule),
[croner.56k.guru](https://croner.56k.guru/)

---

## 4. Structured logging: CLI log vs service log

### pino vs winston

- Throughput: "On Node.js 22 LTS, Pino sustains roughly 650k–720k ops/sec for 1KB JSON
  messages, which is 7–8x faster than Winston in JSON mode... Pino is 5x faster with
  worker-thread I/O."
  ([betterstack.com](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/))
- "For most applications processing fewer than 1,000 requests/second, the difference is
  negligible — both loggers add sub-millisecond overhead per log call."
  ([betterstack.com](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/))
- Pino's design: "focusing on speed and efficiency through structured JSON output and minimal
  overhead... 5–10x faster than Winston by avoiding synchronous string formatting in the hot
  path and offloading I/O to worker threads."
  ([betterstack.com](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/))
- Winston's design: "an extensive plugin architecture with 80+ community transports, custom
  formatters" and rich built-in configuration.
  ([dev.to/chintanshah35](https://dev.to/chintanshah35/winston-vs-pino-in-2026-a-production-tested-comparison-6o0))
- 2026 guidance: pino is the safer default for new projects; pick Winston only with an
  existing deep investment in custom Winston transports.

**For autoqq**: log volume is inherently low (two scheduled fires/day plus occasional CLI
invocations), so raw throughput is not the deciding factor — but pino's low per-call overhead
matters for the CLI path specifically (you don't want logging setup to add noticeable latency
to a `autoqq status` command a human is waiting on), and its JSON-structured-by-default output
is easy to grep/ship/parse later. Recommend **pino** for both logs, using two separate
`pino.destination()` file targets (or two logger instances) rather than two separate library
choices.

### Log rotation options

- `winston-daily-rotate-file` ([github.com/winstonjs/winston-daily-rotate-file](https://github.com/winstonjs/winston-daily-rotate-file)):
  "A transport for winston which logs to a rotating file each day. Logs can be rotated based
  on a date, size limit, and old logs can be removed based on count or elapsed days." Key
  options: `maxSize` (bytes, or `'k'`/`'m'`/`'g'` suffix), `maxFiles` (count, or day-count
  with a `'d'` suffix).
- Pino's own guidance: "Pino recommends using the logrotate tool for log rotation" — i.e.
  delegate rotation to the OS-level `logrotate` utility rather than doing it in-process.
  ([techinsights.manisuec.com](https://techinsights.manisuec.com/nodejs/pino-with-logrotate-utility/))
- For pure in-app rotation without an external OS dependency, **`pino-roll`** "handles daily
  rotation and size limits, and can create directories automatically."
  ([betterstack.com](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/))
- `logrotate` itself "has been designed to ease the administration of systems that generate
  large numbers of log files," typically configured via `/etc/logrotate.d/<app>`, and
  triggered by the `logrotate.timer` that ships with systemd on most distros.

**For autoqq**: since a per-user systemd timer setup is already the chosen architecture (§1–2)
and per-user `logrotate` config is more fragile to install without root (a *system*
`/etc/logrotate.d/` entry needs `sudo`, and user-level logrotate cron jobs are non-standard),
prefer **`pino-roll`** for self-contained, no-root, no-external-dependency size/daily rotation
of both log files. This also keeps rotation working identically regardless of whether the host
distro even has `logrotate` installed.

### Where to store logs: XDG Base Directory Specification

Per the spec ([specifications.freedesktop.org/basedir-spec](http://specifications.freedesktop.org/basedir/latest/)):

- `XDG_DATA_HOME` (default `$HOME/.local/share`): "base directory relative to which
  user-specific data files should be stored."
- `XDG_CONFIG_HOME` (default `$HOME/.config`): "base directory relative to which user-specific
  configuration files should be stored." — this is where the systemd unit files themselves
  belong (`~/.config/systemd/user/`), consistent with §2.
- `XDG_STATE_HOME` (default `$HOME/.local/state`): "base directory relative to which
  user-specific state files should be stored" — holds "state data that should persist between
  (application) restarts, but that is not important or portable enough to the user that it
  should be stored in `$XDG_DATA_HOME`." The spec's own examples of what belongs here:
  **"actions history (logs, history, recently used files, …)"**.
- `XDG_CACHE_HOME` (default `$HOME/.cache`): non-essential, disposable data.
- "All paths must be absolute; relative paths should be considered invalid and ignored."

**Applied to autoqq**: both logs are exactly the spec's worked example ("logs" under state
data), so they belong under `XDG_STATE_HOME`, respecting the env var if set and falling back
to the documented default otherwise:

```
$XDG_STATE_HOME/autoqq/logs/cli.log        # -> ~/.local/state/autoqq/logs/cli.log
$XDG_STATE_HOME/autoqq/logs/scheduler.log  # -> ~/.local/state/autoqq/logs/scheduler.log
```

Config (including any generated systemd units before install, and user preferences like the
configured timezone/send time) belongs under `XDG_CONFIG_HOME` (`~/.config/autoqq/`).

**Sources**:
[betterstack.com — pino vs winston](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/),
[betterstack.com — best nodejs logging libraries](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/),
[dev.to/chintanshah35](https://dev.to/chintanshah35/winston-vs-pino-in-2026-a-production-tested-comparison-6o0),
[github.com/winstonjs/winston-daily-rotate-file](https://github.com/winstonjs/winston-daily-rotate-file),
[techinsights.manisuec.com](https://techinsights.manisuec.com/nodejs/pino-with-logrotate-utility/),
[XDG Base Directory Specification](http://specifications.freedesktop.org/basedir/latest/)

---

## 5. `curl | sh` install script patterns (bun, deno, rustup)

### Bun (`bun.sh/install`)

Platform/arch detection via `uname -ms`:

```bash
platform=$(uname -ms)
case $platform in
'Darwin x86_64') target=darwin-x64 ;;
'Darwin arm64') target=darwin-aarch64 ;;
'Linux aarch64' | 'Linux arm64') target=linux-aarch64 ;;
'MINGW64'*) target=windows-x64 ;;
'Linux x86_64' | *) target=linux-x64 ;;
esac
```

CPU-feature and libc detection (AVX2 baseline build, musl for Alpine):

```bash
if [[ $(cat /proc/cpuinfo | grep avx2) = '' ]]; then
    target="$target-baseline"
fi
if [ -f /etc/alpine-release ]; then
    target="$target-musl"
fi
```

Downloads a prebuilt binary directly (no Node/npm dependency), extracts, and installs:

```bash
curl --fail --location --progress-bar --output "$exe.zip" "$bun_uri" || error "Failed to download bun from \"$bun_uri\""
unzip -oqd "$bin_dir" "$exe.zip" || error 'Failed to extract bun'
mv "$bin_dir/bun-$target/$exe_name" "$exe" || error 'Failed to move extracted bun to destination'
chmod +x "$exe" || error 'Failed to set permissions on bun executable'
```

Installs to `$HOME/.bun/bin/bun` by default (overridable via `$BUN_INSTALL`). PATH setup is
done by directly appending `export BUN_INSTALL=...` / `export PATH="$BUN_INSTALL/bin:$PATH"`
lines to detected shell rc files (`~/.bashrc`, `~/.zshrc`, `~/.config/fish/config.fish`).
Finishes with `command -v bun` verification, shell-completion install, and a
"Run 'bun --help' to get started" message. Requires `unzip`; uses `set -euo pipefail` and
TTY-conditional colorized errors; detects Rosetta 2 on macOS.

### Deno (`deno.land/install.sh`)

Similar `uname -sm` detection plus a `Windows_NT` branch:

```sh
if [ "$OS" = "Windows_NT" ]; then
    target="x86_64-pc-windows-msvc"
else
    case $(uname -sm) in
    "Darwin x86_64") target="x86_64-apple-darwin" ;;
    "Darwin arm64") target="aarch64-apple-darwin" ;;
    "Linux aarch64") target="aarch64-unknown-linux-gnu" ;;
    *) target="x86_64-unknown-linux-gnu" ;;
    esac
fi
```

Downloads a prebuilt zip (`curl --fail --location --progress-bar --output "$exe.zip"
"$deno_uri"`), extracts with `unzip` or falls back to `7z x`. Supports `--no-modify-path` to
skip PATH mutation. Runs a post-install version-gate check using the freshly downloaded binary
itself:

```sh
$exe eval 'const [major, minor] = Deno.version.deno.split("."); if (major < 2 && minor < 42) Deno.exit(1)'
```

### Rustup (`sh.rustup.rs`)

A minimal bootstrap shim — the real logic lives in a downloaded second-stage `rustup-init`
binary. The outer shell script:

- Detects OS/arch via `uname` plus ELF binary analysis (distinguishing musl vs glibc,
  32-/64-bit userlands), including Rosetta 2 special-casing on macOS.
- Builds a download URL (`"${RUSTUP_UPDATE_ROOT}/dist/${_arch}/rustup-init${_ext}"`), fetches
  with `curl`, falling back to `wget`, with retry logic.
- Handles `/tmp` mounted `noexec` by copying the binary somewhere executable first.
- Explicitly connects `/dev/tty` so interactive prompts still work even though the script
  itself arrived via a piped `curl ... | sh`.
- Parses top-level flags (`--quiet`, `--help`, `-y` to skip confirmation) and forwards
  platform overrides to the second-stage binary.
- Notably does **not** itself check for an existing install, does **not** modify `PATH`, and
  performs **no** signature verification — all deferred to the downloaded `rustup-init`, which
  historically writes `~/.cargo/env`, sourced by the shell rc.

### Common pattern across bun / deno / rustup

1. Detect OS + CPU arch (and sometimes libc/CPU-feature variant) via `uname`.
2. Download a prebuilt, platform-specific binary/archive over HTTPS with `curl` (`wget`/`7z`
   fallbacks where relevant) — none of these compile from source or require a package manager
   at install time.
3. Install into a per-user directory under `$HOME` (`~/.bun/bin`, `~/.deno/bin`,
   `~/.cargo/bin`) — no root/`sudo` needed.
4. Mutate the user's shell rc file(s) to add the install dir to `PATH` (bun/deno do this
   directly; rustup defers to a sourced `~/.cargo/env`).
5. Verify via `command -v <tool>` and/or a version check; print next-step guidance.
6. Defensive scripting throughout: `set -euo pipefail` (or equivalent), explicit error
   functions, checks for required external tools, TTY-aware colored output, and handling
   `noexec /tmp` / piped-stdin edge cases.

### Applying this to autoqq's `install.sh`

autoqq is an **npm package**, not a standalone compiled binary, so the script diverges from
the bun/deno "download a prebuilt binary" pattern at step 2 — but should keep steps 1, 3–6:

1. Detect distro/arch only as needed to pick a Node install method (not to pick an autoqq
   binary, since npm packages are OS/arch-agnostic at the package level).
2. **Check for Node.js and the minimum required version** (e.g. via `node --version`); if
   missing or too old, either instruct the user to install Node via their distro's package
   manager / nvm, or (mirroring bun/deno's self-sufficiency) offer to install a
   user-local Node via a method that needs no root (e.g. nvm, or fnm).
3. Run `npm install -g autoqq` (a global npm install already places the binary on `PATH` via
   npm's own global bin directory — so unlike bun/deno there is typically no manual `PATH`
   line-appending needed, *unless* npm's global prefix itself isn't on `PATH`, which the
   script should detect and offer to fix, following the same "append export PATH=... to rc
   file" pattern bun/deno use).
4. Run `autoqq init` (or equivalent) as a follow-up step to install the systemd user units and
   run `loginctl enable-linger` (§2) — this is the autoqq-specific analogue of bun's
   "shell completions + finishing message" step.
5. Verify with `command -v autoqq` and `autoqq --version`; print next-step guidance
   (e.g. "run `autoqq setup` to configure your schedule").
6. Use the same defensive-scripting posture: `set -euo pipefail`, explicit `error()` helper,
   required-tool checks (`node`, `npm`, `curl`), TTY-conditional colored output.

**Sources**: [bun.sh/install](https://bun.sh/install),
[deno.land/install.sh](https://deno.land/install.sh), [sh.rustup.rs](https://sh.rustup.rs)

---

## Summary recommendation for autoqq

1. **Scheduler**: generate and install per-user `systemd` `.service` + `.timer` unit pairs
   under `~/.config/systemd/user/` for both the daily-message job and the renewal job (two
   independent timer pairs, or one timer with `OnUnitActiveSec=` chaining — evaluate against
   the exact cool-down semantics), enabled via `systemctl --user enable --now`, with
   `Persistent=true` for catch-up-after-reboot and `RandomizedDelaySec=` for fleet-wide jitter.
   The installer must also run `loginctl enable-linger "$USER"` so timers keep firing on a
   headless server with no active login session — this is the single most important
   correctness requirement and the most commonly missed step in similar tools' docs.
2. **Timezone**: let `systemd`'s own calendar-time engine (`OnCalendar=`) resolve the
   user-configured IANA timezone and DST correctly (it inherits the system/user TZ and is
   DST-aware natively); use `Intl.supportedValuesOf('timeZone')` purely for the setup-time
   picker/validation UI, not as the runtime scheduling engine.
3. **Logging**: use `pino` for both logs, with `pino-roll` for self-contained rotation (no
   root-owned `/etc/logrotate.d/` dependency), writing to
   `~/.local/state/autoqq/logs/cli.log` and `~/.local/state/autoqq/logs/scheduler.log` per the
   XDG Base Directory Specification's own "logs belong in state" guidance.


<!-- ============================================================ -->
<!-- SOURCE FILE: ts-cli-tooling.md -->
<!-- ============================================================ -->

# TypeScript CLI Tooling Research (2026)

Research for building `autoqq`, a Linux-only TypeScript CLI published to npm (and via `curl | sh`), with subcommands `init`, `install <tool>`, and a background scheduler service.

---

## 1. Argument/subcommand parsing library

### Recommendation: **Commander.js**

For an npm-published CLI expected to be installed by thousands of users, Commander.js remains the default 2026 recommendation:

- **Zero dependencies.** When you publish a CLI that depends on Commander, users install nothing extra transitively — smaller install footprint, fewer supply-chain risk surfaces. Yargs pulls in several sub-packages and has a larger total install size.
- **~35M weekly downloads**, the most widely used and battle-tested option, with excellent TypeScript typings (including type-level command argument inference in modern versions).
- **Minimal API surface** that doesn't fight you — you can bolt on exactly what you need (custom validators, coercion) instead of adopting a framework's opinions.
- Guidance from CLI-comparison writeups in 2026: *"Commander is the better choice when building a CLI that ships as part of an npm library or as a standalone installable tool. Yargs is the better choice when building an internal tool ... where built-in validation, shell completion, and detailed help text matter more than package weight."* The general advice is to start with Commander and only reach for a heavier framework (e.g. oclif) if you find yourself reimplementing plugin/validation infrastructure across many commands.

**Alternatives considered:**
- **yargs** (~30M downloads) — richer built-in middleware, type coercion, and validation, but heavier install size and more "magic." Better suited to internal tooling than a lean public CLI.
- **citty** (unjs) — a modern, zero-dependency, TypeScript-first CLI builder built on native Node.js arg parsing (`defineCommand`, lazy-loaded `subCommands`, auto-generated `--help`/`--version`). Attractive if you're already in the UnJS ecosystem (e.g. using `unbuild`), but smaller community/ecosystem and less proven at scale than Commander.
- **cac** — very lightweight ("Command And Conquer"), nice git-style subcommand API (`cli.command('install <tool>', 'Install a tool')`), good for small tools, but less mature TypeScript support and smaller community than Commander.

### Code example: `init` and `install <tool>` subcommands

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("autoqq")
  .description("Interactive setup and installer for AI coding CLIs")
  .version("1.0.0");

// `autoqq init` — no positional args, interactive wizard
program
  .command("init")
  .description("Run the interactive setup wizard")
  .action(async () => {
    const { runInitWizard } = await import("../commands/init.js");
    await runInitWizard();
  });

// `autoqq install <tool>` — single required positional argument
program
  .command("install <tool>")
  .description("Install and configure a target AI coding CLI")
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (tool: string, options: { yes?: boolean }) => {
    const { runInstall } = await import("../commands/install.js");
    await runInstall(tool, options);
  });

program.parse();
```

The action handler receives one parameter per declared command-argument, followed by the parsed options object and the `Command` instance itself. Lazy-loading command modules via dynamic `import()` inside the action keeps CLI startup fast as more subcommands are added.

**Sources:**
- [Commander.js Readme](https://github.com/tj/commander.js/blob/master/Readme.md)
- [Commander vs Yargs in 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/commander-vs-yargs-2026)
- [CLI Framework Comparison: Commander vs Yargs vs Oclif](https://www.grizzlypeaksoftware.com/library/cli-framework-comparison-commander-vs-yargs-utxlf9v9)
- [unjs/citty — Elegant CLI Builder](https://github.com/unjs/citty)
- [cacjs/cac Readme](https://github.com/cacjs/cac/blob/main/README.md)

---

## 2. Build/bundling setup

### Recommendation: **tsdown** (successor to tsup)

- **tsup is no longer actively maintained**; its own maintainers and the wider ecosystem now point users to **tsdown**. Migration is close to a drop-in rename (`tsup.config.ts` → `tsdown.config.ts`, swap the import).
- tsdown is built on **Rolldown** (Vite's Rust-based bundler successor to Rollup) — it's ESM-first and is the tool Evan You has signaled as the long-term path as the Vite ecosystem migrates off Rollup/esbuild.
- tsup/older tools are CJS-first with ESM support bolted on; tsdown does ESM correctly out of the box, which matters since **Node 22 LTS treats ESM as the stable default** (native `require(esm)` interop also landed).
- Zero/low config: generates the bundled JS output (and `.d.ts` if you're also shipping a library surface) from a single `entry` array.

### Minimal `tsdown.config.ts` for a CLI

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  // Keeps the shebang line from src/cli.ts intact in dist output
  shims: false,
});
```

`src/cli.ts` should start with:

```typescript
#!/usr/bin/env node
```

tsdown/esbuild-family bundlers preserve a leading shebang comment in the emitted file automatically — no extra plugin needed for a plain "bundle to one JS file with shebang" setup.

### `package.json` `bin` field

```json
{
  "name": "autoqq",
  "type": "module",
  "bin": {
    "autoqq": "./dist/cli.js"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsdown"
  }
}
```

After `npm install -g autoqq` (or local `npm link`), npm makes `dist/cli.js` executable and symlinks it onto `PATH` as `autoqq`, using the shebang to invoke `node`.

### ESM vs CJS in 2026

- Node 20/22 LTS: ship `"type": "module"` + native ESM (`format: "esm"`). This is now the mainstream default for new CLIs — avoids the historical CJS/ESM interop pitfalls, and Commander, most `unjs` libraries, and the modern npm ecosystem are ESM-first or dual-published.
- Only fall back to CJS output if a dependency you must use is CJS-only and doesn't interop cleanly (rare in 2026, since `require(esm)` is now supported and most popular packages ship ESM).

### Alternative: Node Single Executable Applications (SEA) via `tsdown --exe`

Since `autoqq` is also installed via `curl | sh`, it's worth knowing tsdown has an experimental **`exe`** option that uses Node's Single Executable Applications feature to produce a genuine standalone native binary (no Node.js runtime required on the target machine):

```typescript
export default defineConfig({
  entry: ["src/cli.ts"],
  exe: { fileName: "autoqq" },
});
```

This requires Node.js ≥ 25.7.0 at *build* time and disables `dts`/code-splitting/multi-entry. For a curl-install script it's tempting, but given the tool is also npm-published (where you want a normal `bin` script, not a multi-hundred-MB binary), the practical recommendation is: **bundle to plain JS with tsdown for the npm package**, and have the `curl | sh` installer simply do `npm install -g autoqq` (or download the npm tarball) rather than shipping a separate SEA binary — one build artifact, one code path, less to maintain.

**Sources:**
- [tsdown — The Elegant Bundler for Libraries](https://tsdown.dev/guide/)
- [tsdown exe option docs](https://tsdown.dev/options/exe)
- [Switching from tsup to tsdown — Alan Norbauer](https://alan.norbauer.com/articles/tsdown-bundler/)
- [tsup vs tsdown vs unbuild 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/tsup-vs-tsdown-vs-unbuild-typescript-library-bundling-2026)
- [ESM vs CommonJS in 2026 — Webcoderspeed](https://webcoderspeed.com/blog/scaling/esm-to-cjs-interop-2026)

---

## 3. Recommended project structure

A conventional, scalable layout for a multi-command TS CLI:

```
autoqq/
├── src/
│   ├── cli.ts                 # entry point: builds Commander program, registers commands
│   ├── commands/
│   │   ├── init.ts            # `autoqq init` wizard (uses @clack/prompts)
│   │   ├── install.ts         # `autoqq install <tool>`
│   │   └── scheduler.ts       # background scheduler subcommand(s)
│   ├── lib/
│   │   ├── config.ts          # XDG config read/write (wraps `conf`/`env-paths`)
│   │   ├── tools/              # per-target-CLI installer definitions
│   │   │   ├── claude-code.ts
│   │   │   └── vercel-cli.ts
│   │   ├── process.ts         # spawn helpers, PATH detection
│   │   └── logger.ts
│   ├── utils/
│   │   └── strings.ts         # small stateless helpers shared across commands/lib
│   └── types.ts
├── dist/                       # tsdown build output (gitignored)
├── scripts/
│   └── install.sh              # the `curl | sh` installer script
├── package.json
├── tsdown.config.ts
├── tsconfig.json
└── docs/
```

Guidelines:
- **`src/commands/`** — one file per CLI subcommand; each file exports a single async function the entry point wires into Commander via lazy `import()`. Keeps the entry file from becoming a giant switch statement as commands grow.
- **`src/lib/`** — core domain logic (config persistence, installer logic per target tool, process/PATH utilities). This is what commands call into, and what unit tests target directly (independent of Commander/CLI parsing).
- **`src/utils/`** — small, stateless, cross-cutting helpers (string/formatting/date helpers) with no domain knowledge.
- Keep `src/cli.ts` thin: construct the Commander program, register commands, `program.parse()`. No business logic here.

**Sources:**
- [nodejs-cli-apps-best-practices (lirantal)](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [Building a CLI with Node.js — Evgeni Gomziakov](https://gomzkov.medium.com/building-a-cli-with-node-js-in-2024-c278802a3ef5)

---

## 4. Detecting a binary on PATH + installing global npm packages programmatically

### Detecting a binary on PATH: use `which` (npm package)

Rolling your own by shelling out to `command -v foo` or `which foo` works but is Unix-only and fragile to quote/parse. Since `autoqq` is Linux-only this is viable, but the npm package **`which`** (the same resolution logic npm itself uses) is the standard, well-maintained cross-platform-safe choice and avoids spawning a subprocess just to check existence:

```typescript
import { which } from "which"; // or: import which from "which"

// Returns the resolved path, or null instead of throwing when not found
export async function findOnPath(bin: string): Promise<string | null> {
  return which(bin, { nothrow: true });
}

// Sync variant, same nothrow semantics
export function findOnPathSync(bin: string): string | null {
  return which.sync(bin, { nothrow: true });
}
```

By default `which()`/`which.sync()` **throw** `ENOENT` if the executable isn't found; pass `{ nothrow: true }` to get `null` back instead. This is preferable to invoking the target binary with `--version` to "probe" it — that fails for binaries with no version flag and is slower (spawns a real process).

### Installing global npm packages from Node

Spawn `npm install -g <pkg>` as a child process rather than trying to call npm's internal API (unsupported/unstable across npm versions). Use Node's `child_process` (or the `execa` package for a nicer async/streaming API) and stream output so the user sees progress:

```typescript
import { execa } from "execa";

export async function installGlobalPackage(pkg: string): Promise<void> {
  await execa("npm", ["install", "-g", pkg], {
    stdio: "inherit", // stream npm's own progress/output to the user
  });
}
```

Notes for an "enterprise-grade" installer:
- Always resolve/verify `npm` itself is on PATH first via the `which` helper above, and fail with a clear error message pointing at Node/npm install instructions if missing.
- Prefer `stdio: "inherit"` (or capture + relay) so users get npm's native progress bars/errors rather than a silent hang.
- Consider detecting and respecting an existing global package manager the user already uses for global installs (npm vs pnpm vs corepack-shimmed installs) — at minimum, document that `autoqq install <tool>` uses `npm i -g` under the hood.
- Wrap the spawn in try/catch and surface `execa`'s `exitCode`/`stderr` to the user instead of a raw stack trace.

**Sources:**
- [which — npm package](https://www.npmjs.com/package/which) / [npm/node-which](https://github.com/npm/node-which)
- [Checking if an executable exists in PATH using Node.js — abdus.dev](https://abdus.dev/posts/checking-executable-exists-in-path-using-node/)
- [springernature/hasbin](https://github.com/springernature/hasbin) (alternative, less actively maintained)

---

## 5. Config/state file storage: XDG Base Directory spec

### Recommendation: **`conf`** (built on `env-paths`) for config; XDG paths directly for state/logs

Since `autoqq` is explicitly Linux-only, following the **XDG Base Directory specification** is the correct target:

| Purpose | XDG variable | Default | 
|---|---|---|
| Config | `$XDG_CONFIG_HOME` | `~/.config` |
| State (logs, scheduler run history) | `$XDG_STATE_HOME` | `~/.local/state` |
| Cache | `$XDG_CACHE_HOME` | `~/.cache` |
| Data | `$XDG_DATA_HOME` | `~/.local/share` |

Library choice:
- **[`conf`](https://github.com/sindresorhus/conf)** (by sindresorhus) — a complete config management solution: atomic JSON read/write, schema validation, migrations, defaults. It uses **`env-paths`** internally to pick the OS-appropriate config directory, and on Linux that resolves to `$XDG_CONFIG_HOME` (defaulting to `~/.config/<app-name>`), i.e. exactly `~/.config/autoqq/config.json` for this project. This is the pragmatic choice: don't hand-roll JSON read/write/atomic-save logic.
- **[`env-paths`](https://github.com/sindresorhus/env-paths)** — the lower-level primitive `conf` is built on. Use it directly (without `conf`) for the **state/log directory**, since `conf` itself is scoped to config only:

  ```typescript
  import envPaths from "env-paths";

  const paths = envPaths("autoqq", { suffix: "" }); // suffix:"" avoids the default "-nodejs" suffix
  // paths.config -> ~/.config/autoqq
  // paths.data   -> ~/.local/share/autoqq
  // paths.cache  -> ~/.cache/autoqq
  // paths.log    -> ~/.local/state/autoqq (env-paths maps "log" to XDG state dir)
  ```

- There's also **`xdg-basedir`** (sindresorhus) and **`@folder/xdg`** if you want *raw* XDG path resolution without any macOS/Windows fallback behavior — appropriate here since the project is explicitly Linux-only, but `env-paths`/`conf` already resolve correctly on Linux and give you a migration path for free if `autoqq` ever needs to run on macOS/WSL later, so there's little reason to hand-code XDG parsing.

### Example wiring

```typescript
// src/lib/config.ts
import Conf from "conf";
import envPaths from "env-paths";
import path from "node:path";

export interface AutoqqConfig {
  installedTools: string[];
  scheduler: { enabled: boolean; intervalMinutes: number };
}

export const config = new Conf<AutoqqConfig>({
  projectName: "autoqq", // -> ~/.config/autoqq/config.json
  defaults: {
    installedTools: [],
    scheduler: { enabled: false, intervalMinutes: 60 },
  },
});

const paths = envPaths("autoqq", { suffix: "" });
export const stateDir = paths.log;               // ~/.local/state/autoqq
export const logFile = path.join(stateDir, "autoqq.log");
```

**Sources:**
- [conf — npm](https://www.npmjs.com/package/conf) / [sindresorhus/conf](https://github.com/sindresorhus/conf)
- [env-paths — npm](https://www.npmjs.com/package/env-paths)
- [xdg-basedir — sindresorhus](https://github.com/sindresorhus/xdg-basedir)
- [nodejs/node XDG discussion #59334](https://github.com/nodejs/node/issues/59334)

---

## Summary of recommendations

| Concern | Choice |
|---|---|
| Arg/subcommand parsing | **Commander.js** |
| Bundler | **tsdown** (ESM output, `format: "esm"`, `platform: "node"`) |
| Package format | ESM, `"type": "module"`, `bin` pointing at bundled `dist/cli.js` with shebang |
| Project structure | `src/{cli.ts, commands/, lib/, utils/}` |
| PATH detection | `which` npm package (`nothrow: true`) |
| Programmatic global installs | spawn `npm install -g <pkg>` via `execa`, `stdio: "inherit"` |
| Config storage | `conf` → `~/.config/autoqq/config.json` |
| State/log storage | `env-paths` → `~/.local/state/autoqq` |

