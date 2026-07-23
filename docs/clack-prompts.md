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
